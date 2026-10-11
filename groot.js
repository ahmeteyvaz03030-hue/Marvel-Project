// ---------------------------------------------------------------------------
// Groot — wachsender Begleiter auf einer JARVIS-Plattform (eigenständige Komponente)
//
// - Die Komponente (Stufen, Wachstums- und Animations-Timing, HUD, Sprechblase,
//   Trefferfläche, Kamera, Plattform, Partikel, Pausen, API) spricht mit der
//   Figur nur über ein austauschbares 3D-Modell — Schnittstelle unten bei
//   „3D-Modell“, Anleitung für ein lizenziertes GLB in GROOT-MODELL.md.
// - Standardmodell „procedural“ (ganz unten): stilisierter, prozeduraler
//   Platzhalter (kein offizielles Marvel-Modell, keine externen Assets): ein
//   Rig aus Gruppen/Segmenten, dessen Proportionen zwischen fünf
//   Entwicklungsstufen per Position/Skalierung überblendet werden. Die
//   Geometrie wird genau einmal gebaut, nie pro Frame.
// - Das Wachstum folgt allein MarvelProgress.stats().all.percent (derselbe
//   gerundete Wert wie im Fortschritts-Widget); eigener Zustand nur für die
//   Animationen.
// - Eigener kleiner Renderer in einem transparenten Canvas, auf ~30 fps
//   gedrosselt; pausiert bei Vollbild-Overlays (MarvelGroot.setPaused), bei
//   verstecktem Tab und solange das Widget ausgeblendet ist.
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  const STAGES = [
    { name: "Baby Groot", from: 0, to: 20 },
    { name: "Größerer Baby Groot", from: 20, to: 40 },
    { name: "Junger Groot", from: 40, to: 60 },
    { name: "Teenager Groot", from: 60, to: 80 },
    { name: "Erwachsener Groot", from: 80, to: 100 },
  ];

  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function easeOutBack(t) {
    const c1 = 1.15;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function stageFor(percent) {
    const p = clamp(Number(percent) || 0, 0, 100);
    let index = 0;
    STAGES.forEach((s, i) => {
      if (p >= s.from) index = i;
    });
    const s = STAGES[index];
    return { index, name: s.name, from: s.from, to: s.to, within: clamp((p - s.from) / (s.to - s.from), 0, 1) };
  }

  // Wachstumswert 0..5 = Stufe + Anteil innerhalb der Stufe. Bis zur nächsten
  // Stufe wird nur halb zu deren Proportionen überblendet, damit der
  // Stufenwechsel selbst sichtbar bleibt; die letzte Stufe wächst bis 100 % aus.
  function growthFor(percent) {
    const s = stageFor(percent);
    return s.index + s.within * (s.index === STAGES.length - 1 ? 1 : 0.5);
  }

  // ---------- 3D-Modell: Schnittstelle und Registrierung ----------
  // Die Figur ist austauschbar. Ein Modell entsteht über eine Fabrik
  //   factory(ctx) → model   oder   Promise<model>
  //   ctx = { THREE, scene, renderer, config, stages, growthMax, reduceMotion() }
  //   (config = window.MARVEL_GROOT_CONFIG; scene nur lesen — alles, was zur
  //   Figur gehört, hängt unter model.object)
  // Pflicht:
  //   object         THREE.Object3D; Fußpunkt bei y = 0 (Plattformoberfläche),
  //                  Blick nach +z. Die Komponente bewegt es nicht — Drehung
  //                  und Haltung kommen über pose().
  //   setGrowth(g)   Wachstum g = 0 … growthMax (0 = Baby bei 0 %, 1 = 20 %,
  //                  2 = 40 %, 3 = 60 %, 4 = Erwachsen bei 80 %, 5 = voll
  //                  ausgewachsen bei 100 %; Zwischenwerte überblenden).
  //   height()       Körperhöhe laut Proportionen (ohne Idle-Bewegung)
  //   pose(s, dt)    Idle-/Winke-Pose, jeden Frame; s = poseState (s.u.)
  // Optional (sonst einfache Rückfälle, siehe checkModel):
  //   headTop(v)     Weltposition knapp über dem Kopf → v (Sprechblase)
  //   head()         { y, size }: Kopfmitte über dem Fußpunkt, Kopfhöhe
  //                  (runder Kompaktausschnitt auf Smartphones)
  //   bounds(box)    Welt-Hüllquader der Figur → box (Trefferfläche)
  //   setGlow(v)     grünes Wachstums-Leuchten 0..1
  //   emitters()     { radius, y0, y1 }: Startbereich der Blätter-Partikel
  //   triangles()    Dreiecke der Figur (debugInfo)
  //   credit         Hinweis- bzw. Lizenztext für das Groot-HUD
  //   dispose()      GPU-Ressourcen freigeben
  // Nach setGrowth() und pose() muss das Modell renderbereit sein (gerendert
  // wird teils ohne weiteren Aufruf, z.B. nach debugSetPercent).
  // Auswahl: window.MARVEL_GROOT_CONFIG = { model: "<name>" } vor dem Start
  // oder MarvelGroot.useModel(name). Bis ein anderes Modell bereitsteht oder
  // wenn es fehlschlägt, zeigt Groot den prozeduralen Platzhalter.
  const factories = Object.create(null);
  factories.procedural = createProceduralModel;
  let requestedModel = null;
  let onModelWish = null; // ab dem Start: gewünschtes Modell anfordern

  function wantedModel() {
    if (requestedModel) return requestedModel;
    const cfg = window.MARVEL_GROOT_CONFIG;
    return cfg && typeof cfg.model === "string" && cfg.model ? cfg.model : "procedural";
  }

  // Bis zum Start (erst mit aktivem Profil) nehmen Platzhalter die Aufrufe an.
  let earlyPaused = false;
  const api = {
    setPaused(v) {
      earlyPaused = Boolean(v);
    },
    refresh() {
      ensureStarted();
      if (started && api.refresh !== stubRefresh) api.refresh();
    },
    stageFor,
    debugSetPercent(p) {
      ensureStarted();
      if (started && api.debugSetPercent !== stubDebug) api.debugSetPercent(p);
    },
    debugInfo: () => null,
    registerModel(name, factory) {
      if (!name || typeof name !== "string" || name === "procedural" || typeof factory !== "function") {
        if (window.console) console.warn("Groot: registerModel(name, factory) erwartet einen Namen (nicht „procedural“) und eine Fabrikfunktion.");
        return false;
      }
      factories[name] = factory;
      // Spät registriert (z.B. nachgeladenes Skript): jetzt laden, falls gewünscht
      if (onModelWish && wantedModel() === name) onModelWish(name);
      return true;
    },
    useModel(name) {
      requestedModel = typeof name === "string" && name ? name : null;
      if (onModelWish) onModelWish(wantedModel());
    },
  };
  const stubRefresh = api.refresh;
  const stubDebug = api.debugSetPercent;
  window.MarvelGroot = api;

  const widget = document.getElementById("groot-widget");
  if (!widget || !window.THREE || !window.MarvelProgress) return;

  const THREE = window.THREE;

  let started = false;
  let scheduled = false;
  function ensureStarted() {
    if (started) return;
    started = true;
    try {
      start();
    } catch (err) {
      // Ohne WebGL bleibt das Widget einfach verborgen — die Seite funktioniert weiter.
      if (window.console) console.warn("Groot: 3D-Ansicht nicht verfügbar.", err);
      widget.classList.add("hidden");
    }
  }

  // Renderer, Geometrie und Shader entstehen erst, wenn ein Profil aktiv ist —
  // in einer Leerlaufphase, damit Seitenaufbau und Login-Animation nicht stocken.
  function scheduleStart() {
    if (started || scheduled) return;
    scheduled = true;
    const run = () => ensureStarted();
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 250);
  }

  const unsubscribeBoot = window.MarvelProgress.subscribe(() => {
    if (window.MarvelProgress.profile()) scheduleStart();
  });
  if (window.MarvelProgress.profile()) scheduleStart();

  function start() {
    unsubscribeBoot();
    const MP = window.MarvelProgress;
    const HUD = window.MarvelHUD || null;

    // ---------- Renderer (zuerst: wirft ohne WebGL, bevor DOM verändert wird) ----------
    const canvas = document.createElement("canvas");
    canvas.className = "groot-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(24, 0.74, 0.1, 40);

    const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = Boolean((HUD && HUD.reduceMotion) || reduceMQ.matches);
    const onReduceChange = () => {
      reduce = reduceMQ.matches;
    };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", onReduceChange);
    else if (reduceMQ.addListener) reduceMQ.addListener(onReduceChange);

    // ---------- Hilfen ----------
    // Weicher Lichtpunkt auf Schwarz (für additive Funken).
    function sparkTexture() {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const x = c.getContext("2d");
      const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.25, "#9a9a9a");
      g.addColorStop(1, "#000000");
      x.fillStyle = g;
      x.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    }

    function blobTexture() {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const x = c.getContext("2d");
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(0,0,0,0.85)");
      g.addColorStop(0.55, "rgba(0,0,0,0.45)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    // Additives Leuchten, das den Alphakanal des Canvas nicht verändert: die
    // Plattform „strahlt“ dadurch auf die Seite dahinter, statt sie abzudunkeln.
    function glowBlend(mat) {
      mat.transparent = true;
      mat.depthWrite = false;
      mat.blending = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneFactor;
      mat.blendSrcAlpha = THREE.ZeroFactor;
      mat.blendDstAlpha = THREE.OneFactor;
      return mat;
    }

    // ---------- Lichter ----------
    scene.add(new THREE.HemisphereLight(0x9cc4ff, 0x1c1008, 0.42));
    const key = add(scene, new THREE.DirectionalLight(0xffe2c4, 1.7));
    key.position.set(3.6, 4.2, 3.4);
    const fill = add(scene, new THREE.DirectionalLight(0x86aaff, 0.38));
    fill.position.set(-4.5, 1.0, 3);
    const rimBlue = add(scene, new THREE.DirectionalLight(0x5abeff, 0.75));
    rimBlue.position.set(-3.5, 2.4, -4);
    const rimGreen = add(scene, new THREE.DirectionalLight(0x7dff9a, 0.45));
    rimGreen.position.set(3.8, 2.0, -3.6);
    const platLight = add(scene, new THREE.PointLight(0x46d8ff, 0.7, 2.6, 2));
    platLight.position.set(0, 0.35, 0.6);

    // =====================================================================
    // Figur: austauschbares 3D-Modell (Schnittstelle oben)
    // =====================================================================
    let model = null;
    let modelName = "";
    let modelPending = null; // Name eines noch ladenden Modells
    let modelError = null;
    let modelToken = 0;
    const _mbox = new THREE.Box3();

    function modelContext() {
      return {
        THREE,
        scene,
        renderer,
        config: window.MARVEL_GROOT_CONFIG || {},
        stages: STAGES.map((s) => Object.assign({}, s)),
        growthMax: STAGES.length,
        reduceMotion: () => reduce,
      };
    }

    // Prüft die Pflichtteile und ergänzt fehlende optionale Methoden.
    function checkModel(m, name) {
      if (!m || !m.object || !m.object.isObject3D || typeof m.setGrowth !== "function" || typeof m.height !== "function" || typeof m.pose !== "function") {
        throw new Error("Modell „" + name + "“ erfüllt die Schnittstelle nicht (object, setGrowth, height, pose)");
      }
      if (typeof m.bounds !== "function") m.bounds = (box) => box.setFromObject(m.object);
      if (typeof m.head !== "function") {
        m.head = () => {
          const h = m.height();
          return { y: h * 0.85, size: h * 0.25 };
        };
      }
      if (typeof m.headTop !== "function") {
        m.headTop = (v) => {
          m.bounds(_mbox);
          return v.set((_mbox.min.x + _mbox.max.x) / 2, _mbox.max.y, (_mbox.min.z + _mbox.max.z) / 2);
        };
      }
      if (typeof m.emitters !== "function") {
        m.emitters = () => {
          const h = m.height();
          return { radius: h * 0.2, y0: h * 0.25, y1: h * 1.05 };
        };
      }
      if (typeof m.setGlow !== "function") m.setGlow = () => {};
      if (typeof m.dispose !== "function") m.dispose = () => {};
      return m;
    }

    function discardModel(m) {
      try {
        if (m && typeof m.dispose === "function") m.dispose();
      } catch (e) {
        /* ignorieren */
      }
    }

    // Setzt ein geprüftes Modell ein. Beim Tausch übernimmt das neue Modell
    // zuerst Wachstum, Leuchten und Pose — wirft es dabei, bleibt das alte.
    function installModel(next, name) {
      const prev = model;
      if (prev) {
        next.setGrowth(anim.g);
        next.setGlow(glowValue);
        if (posed) next.pose(poseState, 0);
      }
      model = next;
      modelName = name;
      if (prev) scene.remove(prev.object);
      scene.add(next.object);
      if (!prev) return;
      discardModel(prev);
      applyCredit();
      hitDirty = true;
      if (compact) placeCamera();
      renderer.compile(scene, camera);
      if (shown && !running) renderOnce();
    }

    function useProcedural() {
      if (modelName === "procedural") return;
      installModel(checkModel(createProceduralModel(modelContext()), "procedural"), "procedural");
    }

    function modelFailed(name, err) {
      modelError = name + ": " + ((err && err.message) || String(err));
      if (window.console) console.warn("Groot: Modell „" + name + "“ nicht verfügbar – der prozedurale Platzhalter bleibt.", err);
      useProcedural();
    }

    // Fordert ein registriertes Modell an: ein synchron geliefertes sofort,
    // ein Promise nach dem Laden. Eine neuere Anfrage verwirft ältere.
    function requestModel(name) {
      const token = ++modelToken;
      modelPending = null;
      if (name === modelName) return;
      const factory = factories[name];
      if (!factory) {
        modelFailed(name, new Error("nicht registriert"));
        return;
      }
      const accept = (m) => {
        try {
          installModel(checkModel(m, name), name);
          modelError = null;
        } catch (err) {
          discardModel(m);
          modelFailed(name, err);
        }
      };
      let out;
      try {
        out = factory(modelContext());
      } catch (err) {
        modelFailed(name, err);
        return;
      }
      if (out && typeof out.then === "function") {
        modelPending = name;
        out.then(
          (m) => {
            if (token !== modelToken) {
              discardModel(m);
              return;
            }
            modelPending = null;
            accept(m);
          },
          (err) => {
            if (token !== modelToken) return;
            modelPending = null;
            modelFailed(name, err);
          }
        );
        return;
      }
      accept(out);
    }

    requestModel(wantedModel());
    // Lädt das gewünschte Modell noch (oder fehlt es), steht der Platzhalter da
    if (!model) useProcedural();

    // =====================================================================
    // JARVIS-Plattform
    // =====================================================================
    const PLAT_R = 0.78;
    const platform = group(scene);
    const platUniforms = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uPulse: { value: 0 },
      uHover: { value: 0 },
    };
    const base = mesh(
      new THREE.CylinderGeometry(PLAT_R * 0.98, PLAT_R * 0.84, 0.1, 48, 1, false),
      new THREE.MeshStandardMaterial({ color: 0x070c16, metalness: 0.75, roughness: 0.34, emissive: 0x01050b }),
      platform
    );
    base.position.y = -0.052;
    const shadow = mesh(
      new THREE.CircleGeometry(0.62, 32),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, toneMapped: false }),
      platform
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.003;
    shadow.renderOrder = 1;

    const DISC_R = PLAT_R * 1.25;
    const disc = mesh(
      new THREE.CircleGeometry(DISC_R, 72),
      glowBlend(
        new THREE.ShaderMaterial({
          uniforms: platUniforms,
          // fwidth braucht unter WebGL1 die Ableitungs-Erweiterung
          extensions: { derivatives: true },
          vertexShader: `
            varying vec2 vPos;
            void main() {
              vPos = position.xy / ${DISC_R.toFixed(4)};
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: `
            uniform float uTime;
            uniform float uProgress;
            uniform float uPulse;
            uniform float uHover;
            varying vec2 vPos;
            float ring(float r, float c, float w) { return 1.0 - smoothstep(0.0, w, abs(r - c)); }
            void main() {
              float r = length(vPos);
              if (r > 1.0) discard;
              float a = atan(vPos.y, vPos.x);
              float a01 = fract((a + 1.5707963) / 6.2831853);
              vec3 cyan = vec3(0.26, 0.72, 1.0);
              vec3 green = vec3(0.36, 1.0, 0.55);
              vec3 gold = vec3(1.0, 0.78, 0.3);
              float fw = fwidth(r) * 1.2;
              vec3 col = cyan * smoothstep(0.8, 0.0, r) * 0.03;
              col += cyan * ring(r, 0.2, fw + 0.006) * 0.26;
              col += cyan * ring(r, 0.47, fw + 0.004) * 0.2 * step(0.45, fract(a01 * 40.0 + uTime * 0.05));
              float seg = step(0.0, sin((a01 * 3.0 - uTime * 0.06) * 6.2831853) + 0.4);
              col += cyan * ring(r, 0.62, fw + 0.01) * 0.3 * seg;
              float track = ring(r, 0.76, fw + 0.014);
              float filled = step(a01, uProgress);
              col += mix(cyan * 0.08, mix(green, gold, a01) * 0.95, filled) * track;
              float mk = 0.0;
              for (int i = 1; i < 5; i++) mk += 1.0 - smoothstep(0.0, 0.006, abs(a01 - float(i) * 0.2));
              col += gold * mk * ring(r, 0.76, 0.045) * 0.6;
              float tick = step(0.8, fract(a01 * 72.0)) * ring(r, 0.86, 0.02);
              col += cyan * tick * 0.22;
              col += cyan * ring(r, 0.97, fw + 0.02) * 0.18;
              float sweep = pow(max(0.0, cos(a - uTime * 0.7)), 24.0) * smoothstep(0.8, 0.15, r);
              col += cyan * sweep * 0.1;
              col *= 0.8 + 0.2 * sin(vPos.y * 90.0 - uTime * 3.0);
              float wave = ring(r, 0.18 + fract(uTime * 0.7) * 0.75, 0.06);
              col += green * uPulse * (wave * 0.6 + smoothstep(0.8, 0.0, r) * 0.22);
              col *= 1.0 + uHover * 0.6;
              gl_FragColor = vec4(col, 1.0);
            }`,
        })
      ),
      platform
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.004;
    disc.renderOrder = 2;

    const rimMat = glowBlend(new THREE.MeshBasicMaterial({ color: 0x2a86d6, toneMapped: false }));
    const rimRing = mesh(new THREE.TorusGeometry(PLAT_R * 0.98, 0.011, 4, 72), rimMat, platform);
    rimRing.rotation.x = Math.PI / 2;
    rimRing.renderOrder = 3;
    const lowRing = mesh(new THREE.TorusGeometry(PLAT_R * 0.85, 0.008, 4, 64), rimMat, platform);
    lowRing.rotation.x = Math.PI / 2;
    lowRing.position.y = -0.1;
    lowRing.renderOrder = 3;

    const beamUniforms = { uTime: platUniforms.uTime, uPulse: platUniforms.uPulse };
    const beam = mesh(
      new THREE.CylinderGeometry(PLAT_R * 0.9, PLAT_R * 0.96, 0.5, 48, 1, true).translate(0, 0.25, 0),
      glowBlend(
        new THREE.ShaderMaterial({
          uniforms: beamUniforms,
          side: THREE.DoubleSide,
          vertexShader: `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: `
            uniform float uTime;
            uniform float uPulse;
            varying vec2 vUv;
            void main() {
              float f = pow(1.0 - vUv.y, 2.6);
              float lines = 0.7 + 0.3 * sin(vUv.y * 70.0 - uTime * 4.0);
              vec3 c = mix(vec3(0.2, 0.62, 1.0), vec3(0.35, 1.0, 0.55), uPulse);
              gl_FragColor = vec4(c * f * lines * (0.035 + uPulse * 0.16), 1.0);
            }`,
        })
      ),
      platform
    );
    beam.renderOrder = 4;

    // =====================================================================
    // Wachstums-Effekte: fliegende Blätter + Funken
    // =====================================================================
    // Eigene Uniforms (gleiche Werte wie die Figur), damit die Effekte nicht
    // vom eingesetzten Modell abhängen
    const fxUniforms = {
      uTime: { value: 0 },
      uGlow: { value: 0 },
      uGlowColor: { value: new THREE.Color(0x3cff6a) },
      uFlutter: { value: 1 },
    };
    const P_COUNT = 22;
    const particleMesh = new THREE.InstancedMesh(leafGeometry(), leafMaterial(leafTexture(), fxUniforms, 0.4), P_COUNT);
    particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particleMesh.frustumCulled = false;
    particleMesh.visible = false;
    scene.add(particleMesh);
    const particles = [];
    for (let i = 0; i < P_COUNT; i++) {
      particles.push({ age: 1, life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 0, 1), rot: 0, spin: 0, size: 0.1 });
    }

    const S_COUNT = 40;
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPos = new Float32Array(S_COUNT * 3);
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = glowBlend(
      new THREE.PointsMaterial({ size: 0.07, map: sparkTexture(), color: 0x000000, sizeAttenuation: true, toneMapped: false })
    );
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.frustumCulled = false;
    sparks.visible = false;
    scene.add(sparks);
    const sparkData = [];
    for (let i = 0; i < S_COUNT; i++) sparkData.push({ a: 0, r: 0, y: 0, v: 0, delay: 0 });

    // =====================================================================
    // DOM: Trefferfläche, Sprechblase, HUD
    // =====================================================================
    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "groot-hit";
    hit.setAttribute("aria-label", "Groot – Entwicklungsstufe anzeigen");
    hit.setAttribute("aria-expanded", "false");
    hit.setAttribute("aria-controls", "groot-hud");

    const bubble = document.createElement("div");
    bubble.className = "groot-bubble";
    bubble.setAttribute("aria-hidden", "true");
    bubble.textContent = "I am Groot.";

    const hud = document.createElement("div");
    hud.id = "groot-hud";
    hud.className = "groot-hud";
    hud.setAttribute("role", "dialog");
    hud.setAttribute("aria-label", "Groot – Entwicklungsstand");
    hud.hidden = true;
    hud.innerHTML = `
      <div class="groot-hud-top">
        <span class="panel-eyebrow">BEGLEITER</span>
        <button type="button" class="groot-hud-close" aria-label="Schließen">✕</button>
      </div>
      <h3 class="groot-hud-title">GROOT</h3>
      <div class="groot-hud-stage"><span data-g="stage"></span><small data-g="step"></small></div>
      <div class="groot-hud-pips" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="groot-hud-row"><span>Fortschritt</span><strong data-g="percent"></strong></div>
      <div class="groot-hud-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Fortschritt">
        <i data-g="fill"></i><b style="left:20%"></b><b style="left:40%"></b><b style="left:60%"></b><b style="left:80%"></b>
      </div>
      <div class="groot-hud-count" data-g="count"></div>
      <div class="groot-hud-next" data-g="next"></div>
      <p class="groot-hud-note">Stilisierter 3D-Platzhalter – kein offizielles Marvel-Modell</p>`;
    const hudRef = {};
    hud.querySelectorAll("[data-g]").forEach((el) => (hudRef[el.dataset.g] = el));
    const hudPips = hud.querySelectorAll(".groot-hud-pips i");
    const hudBar = hud.querySelector(".groot-hud-bar");
    const hudNote = hud.querySelector(".groot-hud-note");
    // Hinweis- bzw. Lizenztext des Modells (Platzhalter: „Stilisierter …“)
    function applyCredit() {
      hudNote.textContent = model.credit || "";
      hudNote.hidden = !model.credit;
    }
    applyCredit();

    widget.textContent = "";
    widget.append(canvas, hit, bubble, hud);
    widget.classList.remove("hidden");
    widget.setAttribute("aria-hidden", "true");

    // =====================================================================
    // Zustand
    // =====================================================================
    let debugPercent = null;
    let paused = earlyPaused;
    let shown = false;
    let running = false;
    let rafId = 0;
    let lastFrame = 0;
    let clock = 0;
    let compact = false;
    let compactSide = 1;
    let viewW = 1;
    let viewH = 1;

    const anim = { g: 0, from: 0, to: 0, t: 0, dur: 1, delay: 0, active: false, celebrate: false };
    const glow = { t: -100, dur: 2.6 };
    const blink = { next: 2.5, t: -1, second: false };
    const look = { yaw: 0, pitch: 0, roll: 0, tYaw: 0, tPitch: 0, tRoll: 0, next: 1.5 };
    const wave = { t: -1, dur: 2.6, next: 14 + Math.random() * 12 };
    const bubbleState = { next: 40 + Math.random() * 50, hideAt: 0 };
    let hover = 0;
    let hoverTarget = 0;
    let hitDirty = true;
    let glowValue = 0;
    let posed = false;

    // Pose für model.pose(): neutral, ohne Bezug zu einem bestimmten Rig
    const poseState = {
      time: 0, // Uhr in Sekunden (Pendeln, Blätterflattern)
      reduceMotion: false,
      compact: false, // runder Kompaktausschnitt (Smartphone)
      bodyYaw: 0, // Drehung des ganzen Körpers um die Hochachse (rad)
      breath: 0, // Atem-Auslenkung, vorzeichenbehaftet (±0,011; reduziert ±0,0025)
      yaw: 0, // Blick (rad)
      pitch: 0,
      roll: 0,
      blink: 0, // 0 = Augen offen … 1 = geschlossen
      wave: 0, // Winken 0..1 (weich ein- und ausgeblendet)
      waveSide: -1, // winkender Arm: -1 = links im Bild (x < 0), 1 = rechts
      waveTime: -1, // Sekunden seit Beginn des Winkens (Hin und Her)
    };

    function currentPercent() {
      if (debugPercent != null) return debugPercent;
      if (!MP.profile()) return 0;
      return MP.stats().all.percent;
    }

    function setGrowth(g) {
      anim.g = g;
      model.setGrowth(g);
      hitDirty = true;
      if (compact) placeCamera();
    }

    // ---------- Kamera ----------
    const CAM_FOV = 24;
    function placeCamera() {
      const tanH = Math.tan((CAM_FOV * Math.PI) / 360);
      if (!compact) {
        // Fester Ausschnitt (erwachsener Groot + Plattform), damit das Wachstum sichtbar bleibt
        const lookY = 1.04;
        let dist = 6.0;
        const needW = PLAT_R * 2.3;
        if (camera.aspect * 2 * dist * tanH < needW) dist = needW / (camera.aspect * 2 * tanH);
        camera.position.set(0, lookY + dist * 0.095, dist);
        camera.lookAt(0, lookY, 0);
      } else {
        // Kompakt (Smartphone): Kopf/Oberkörper im runden Ausschnitt
        const head = model.head();
        const frame = Math.max(head.size * 2.3, 0.66);
        const lookY = head.y - frame * 0.05;
        const dist = frame / (2 * tanH) / Math.min(1, camera.aspect);
        camera.position.set(0, lookY + dist * 0.08, dist);
        camera.lookAt(0, lookY, 0);
      }
      camera.updateProjectionMatrix();
    }

    function resize() {
      const w = Math.max(1, widget.clientWidth);
      const h = Math.max(1, widget.clientHeight);
      viewW = w;
      viewH = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const compactNow = compactMQ.matches;
      if (compactNow !== compact) {
        compact = compactNow;
        platform.visible = !compact;
        widget.classList.toggle("groot-compact", compact);
      }
      const rect = widget.getBoundingClientRect();
      compactSide = rect.left + rect.width / 2 < window.innerWidth / 2 ? 1 : -1;
      placeCamera();
      hitDirty = true;
      if (shown && !running) renderOnce();
    }

    const compactMQ = window.matchMedia("(max-width: 640px), (max-height: 480px) and (orientation: landscape)");

    // ---------- Trefferfläche & Sprechblase ----------
    const _v = new THREE.Vector3();
    const _box = new THREE.Box3();
    const _corner = new THREE.Vector3();
    function projectToPx(v) {
      _v.copy(v).project(camera);
      return { x: (_v.x * 0.5 + 0.5) * viewW, y: (-_v.y * 0.5 + 0.5) * viewH };
    }

    function updateHitArea() {
      hitDirty = false;
      if (compact) {
        hit.style.left = hit.style.top = "0px";
        hit.style.width = viewW + "px";
        hit.style.height = viewH + "px";
        hit.style.clipPath = "";
        return;
      }
      model.bounds(_box);
      _box.expandByPoint(_corner.set(-PLAT_R, -0.1, PLAT_R));
      _box.expandByPoint(_corner.set(PLAT_R, -0.1, -PLAT_R));
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        _corner.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z);
        const p = projectToPx(_corner);
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      x0 = clamp(x0, 0, viewW);
      x1 = clamp(x1, 0, viewW);
      y0 = clamp(y0 - 4, 0, viewH);
      y1 = clamp(y1, 0, viewH);
      hit.style.left = x0.toFixed(0) + "px";
      hit.style.top = y0.toFixed(0) + "px";
      hit.style.width = (x1 - x0).toFixed(0) + "px";
      hit.style.height = (y1 - y0).toFixed(0) + "px";

      // Klickbar ist nur die Figur (mittlere Säule) und die flache Plattform —
      // der transparente Raum neben Kopf, Ästen und Armen lässt Klicks zur
      // 3D-Szene (Planeten, Drehen) durch. clip-path begrenzt auch das Hit-Testing.
      const c = projectToPx(_corner.set(0, 0.05, 0));
      const rx = Math.abs(projectToPx(_corner.set(PLAT_R * 0.98, 0.05, 0)).x - c.x);
      const ry = Math.max(4, Math.abs(projectToPx(_corner.set(0, 0.05, PLAT_R * 0.98)).y - c.y));
      // Mitte etwas tiefer und großzügiger, damit auch die Vorderkante der
      // (dicken) Plattform klickbar ist
      const cx = c.x - x0;
      const cy = c.y - y0 + ry * 0.25;
      const rxs = rx * 1.04;
      const rys = ry * 1.35 + 4;
      const half = Math.min(rxs * 0.92, Math.max(14, (x1 - x0) * 0.24));
      const colL = cx - half;
      const colR = cx + half;
      const tR = Math.acos(clamp((colR - cx) / rxs, -1, 1));
      const tL = Math.acos(clamp((colL - cx) / rxs, -1, 1));
      const pts = [colL + "px 0px", colR + "px 0px"];
      const steps = 14;
      const span = tR + (2 * Math.PI - tL);
      for (let i = 0; i <= steps; i++) {
        const t = tR - (span * i) / steps;
        pts.push((cx + rxs * Math.cos(t)).toFixed(1) + "px " + (cy - rys * Math.sin(t)).toFixed(1) + "px");
      }
      hit.style.clipPath = "polygon(" + pts.join(", ") + ")";
    }

    const _headTop = new THREE.Vector3();
    function showBubble(ms) {
      if (!shown) return;
      if (!compact) {
        const p = projectToPx(model.headTop(_headTop));
        bubble.style.left = "auto";
        bubble.style.right = Math.max(0, viewW - p.x - 14).toFixed(0) + "px";
        bubble.style.bottom = Math.max(0, viewH - p.y + 6).toFixed(0) + "px";
      } else {
        bubble.style.left = bubble.style.right = bubble.style.bottom = "";
      }
      bubble.classList.add("show");
      bubbleState.hideAt = clock + (ms || 2800) / 1000;
    }

    function hideBubble() {
      bubble.classList.remove("show");
      bubbleState.hideAt = 0;
    }

    // ---------- HUD ----------
    function titlesUntil(threshold, all) {
      for (let k = 1; all.watched + k <= all.total; k++) {
        if (MP.percent(all.watched + k, all.total) >= threshold) return k;
      }
      return null;
    }

    function updateHud() {
      if (hud.hidden) return;
      const preview = debugPercent != null;
      const all = MP.profile() ? MP.stats().all : { total: 0, watched: 0, percent: 0 };
      const p = preview ? debugPercent : all.percent;
      const st = stageFor(p);
      hudRef.stage.textContent = st.name;
      hudRef.step.textContent = "Stufe " + (st.index + 1) + "/" + STAGES.length;
      hudPips.forEach((pip, i) => pip.classList.toggle("on", i <= st.index));
      hudRef.percent.textContent = Math.round(p) + " %";
      hudRef.fill.style.width = clamp(p, 0, 100) + "%";
      hudBar.setAttribute("aria-valuenow", String(Math.round(p)));
      hudRef.count.textContent = preview
        ? "Vorschau mit fiktivem Fortschritt"
        : all.watched + " von " + all.total + " Titeln gesehen";
      if (st.index >= STAGES.length - 1) {
        hudRef.next.textContent = "Maximale Stufe erreicht";
      } else {
        const nxt = STAGES[st.index + 1];
        const n = preview ? null : titlesUntil(nxt.from, all);
        hudRef.next.textContent = nxt.name + " ab " + nxt.from + " %" + (n != null ? " · noch " + n + " Titel" : "");
      }
    }

    function openHud() {
      if (!shown) return;
      hud.hidden = false;
      hit.setAttribute("aria-expanded", "true");
      widget.classList.add("groot-hud-open");
      updateHud();
    }

    function closeHud(focusBack) {
      if (hud.hidden) return;
      hud.hidden = true;
      hit.setAttribute("aria-expanded", "false");
      widget.classList.remove("groot-hud-open");
      if (focusBack) hit.focus({ preventScroll: true });
    }

    hit.addEventListener("click", () => {
      if (hud.hidden) {
        openHud();
        showBubble();
        if (!reduce) startWave();
        if (HUD && HUD.playClick) HUD.playClick();
      } else {
        closeHud();
      }
    });
    hit.addEventListener("pointerenter", () => (hoverTarget = 1));
    hit.addEventListener("pointerleave", () => (hoverTarget = 0));
    hit.addEventListener("focus", () => (hoverTarget = 1));
    hit.addEventListener("blur", () => (hoverTarget = 0));
    hud.querySelector(".groot-hud-close").addEventListener("click", () => closeHud(true));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !hud.hidden) closeHud(true);
    });
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (hud.hidden) return;
        if (hud.contains(e.target) || hit.contains(e.target)) return;
        closeHud();
      },
      true
    );

    // ---------- Sichtbarkeit & Pausen ----------
    const jarvisPanel = document.getElementById("jarvis-panel");
    function computeShown() {
      if (!MP.profile() && debugPercent == null) return false;
      if (document.body.classList.contains("panel-open")) return false;
      // Das J.A.R.V.I.S.-Chatfenster liegt ohnehin über Groot — dann ruht er.
      if (jarvisPanel && !jarvisPanel.classList.contains("hidden")) return false;
      return true;
    }

    function updateShown() {
      const s = computeShown();
      if (s === shown) return;
      shown = s;
      widget.classList.toggle("groot-shown", s);
      widget.setAttribute("aria-hidden", s ? "false" : "true");
      if (!s) {
        closeHud();
        hideBubble();
      } else {
        hitDirty = true;
      }
      updateRun();
    }

    function updateRun() {
      const should = shown && !paused && !document.hidden;
      if (should === running) return;
      running = should;
      if (running) {
        lastFrame = performance.now();
        rafId = requestAnimationFrame(loop);
        if (pendingGrowth) {
          const pg = pendingGrowth;
          pendingGrowth = null;
          startGrowth(pg.to, pg.celebrate && pg.to >= anim.g - 1e-6, 0.45);
        }
      } else {
        cancelAnimationFrame(rafId);
      }
    }

    const mo = new MutationObserver(updateShown);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    if (jarvisPanel) mo.observe(jarvisPanel, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", updateRun);

    if (window.ResizeObserver) new ResizeObserver(resize).observe(widget);
    window.addEventListener("resize", resize);

    // ---------- Wachstum ----------
    // Läuft Groot gerade nicht (z.B. hinter „Entdecken“ oder dem Film-Fenster,
    // wo Titel meist markiert werden), wird die Animation nachgeholt, sobald er
    // wieder sichtbar ist.
    let pendingGrowth = null;
    function growTo(g, mode) {
      if (mode === "instant") {
        pendingGrowth = null;
        anim.active = false;
        glow.t = -100;
        setGrowth(g);
        return;
      }
      const celebrate = mode === "celebrate";
      if (!running) {
        pendingGrowth = { to: g, celebrate: celebrate || Boolean(pendingGrowth && pendingGrowth.celebrate) };
        return;
      }
      startGrowth(g, celebrate, 0);
    }

    function startGrowth(g, celebrate, extraDelay) {
      anim.from = anim.g;
      anim.to = g;
      anim.t = 0;
      anim.celebrate = celebrate && !reduce;
      anim.delay = (anim.celebrate ? 0.3 : 0) + extraDelay;
      anim.dur = reduce ? 0.35 : celebrate ? 2.1 : 1.2;
      anim.active = true;
      if (celebrate) {
        glow.t = -extraDelay;
        glow.dur = reduce ? 0.9 : 2.7;
        if (!reduce) spawnEffects(extraDelay);
      }
    }

    function spawnEffects(delay) {
      const em = model.emitters();
      particles.forEach((p, i) => {
        const a = Math.random() * Math.PI * 2;
        const rad = em.radius * (0.4 + Math.random() * 0.9);
        p.pos.set(Math.cos(a) * rad, lerp(em.y0, em.y1, Math.random()), Math.sin(a) * rad * 0.6);
        p.vel.set(Math.cos(a) * (0.25 + Math.random() * 0.4), 0.45 + Math.random() * 0.55, Math.sin(a) * 0.3 + 0.2);
        p.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        p.rot = Math.random() * 6;
        p.spin = (Math.random() - 0.5) * 9;
        p.size = 0.07 + Math.random() * 0.06;
        p.life = 1.5 + Math.random() * 0.9;
        p.age = -i * 0.03 - delay;
      });
      particleMesh.visible = true;
      sparkData.forEach((s, i) => {
        s.a = Math.random() * Math.PI * 2;
        s.r = PLAT_R * (0.3 + Math.random() * 0.65);
        s.y = 0;
        s.v = 0.5 + Math.random() * 0.9;
        s.delay = Math.random() * 0.9 + i * 0.005 + delay;
      });
      sparks.visible = true;
    }

    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _sc = new THREE.Vector3();
    function updateEffects(dt) {
      if (particleMesh.visible) {
        let alive = 0;
        particles.forEach((p, i) => {
          p.age += dt;
          let s = 0;
          if (p.age > 0 && p.age < p.life) {
            alive++;
            p.vel.y -= 0.12 * dt;
            p.vel.multiplyScalar(0.985);
            p.pos.addScaledVector(p.vel, dt);
            p.rot += p.spin * dt;
            const k = p.age / p.life;
            s = p.size * Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.6;
          } else if (p.age <= 0) {
            alive++;
          }
          _q.setFromAxisAngle(p.axis, p.rot);
          _m.compose(p.pos, _q, _sc.set(s + 1e-4, s + 1e-4, s + 1e-4));
          particleMesh.setMatrixAt(i, _m);
        });
        particleMesh.instanceMatrix.needsUpdate = true;
        if (!alive) particleMesh.visible = false;
      }
      if (sparks.visible) {
        let alive = 0;
        let fade = 0;
        const yMax = model.height() * 1.05;
        sparkData.forEach((s, i) => {
          s.delay -= dt;
          if (s.delay < 0) s.y += s.v * dt;
          if (s.y < yMax) alive++;
          sparkPos[i * 3] = Math.cos(s.a + s.y * 1.5) * s.r * (1 - s.y * 0.15);
          sparkPos[i * 3 + 1] = s.delay < 0 && s.y < yMax ? s.y : -50;
          sparkPos[i * 3 + 2] = Math.sin(s.a + s.y * 1.5) * s.r * (1 - s.y * 0.15);
          fade = Math.max(fade, s.delay < 0 ? 1 - s.y / yMax : 0);
        });
        sparkGeo.attributes.position.needsUpdate = true;
        sparkMat.color.setRGB(0.45, 1.0, 0.6).multiplyScalar(0.25 + 0.75 * clamp(fade, 0, 1));
        if (!alive) sparks.visible = false;
      }
    }

    function startWave() {
      if (wave.t < 0) wave.t = 0;
    }

    // ---------- Synchronisierung mit MarvelProgress ----------
    function targetGrowth() {
      return growthFor(currentPercent());
    }

    function refreshFromProgress(mode) {
      const pct = currentPercent();
      platUniforms.uProgress.value = pct / 100;
      widget.style.setProperty("--groot-p", String(pct));
      growTo(targetGrowth(), mode);
      updateHud();
    }

    let swapTimer = 0;
    function swapProfile() {
      // Profilwechsel: kurz ausblenden, neue Stufe setzen, wieder einblenden
      clearTimeout(swapTimer);
      if (!shown || reduce) {
        refreshFromProgress("instant");
        updateShown();
        return;
      }
      widget.classList.add("groot-swap");
      swapTimer = setTimeout(() => {
        refreshFromProgress("instant");
        widget.classList.remove("groot-swap");
        updateShown();
      }, 230);
    }

    MP.subscribe((ev) => {
      if (ev.type === "watched") {
        refreshFromProgress(ev.value ? "celebrate" : "shrink");
      } else if (ev.type === "profile" || ev.type === "sync") {
        if (!MP.profile()) {
          updateShown();
          refreshFromProgress("instant");
        } else if (!shown) {
          refreshFromProgress("instant");
          updateShown();
        } else {
          swapProfile();
        }
      } else if (ev.type === "achievement" || ev.type === "universe-complete") {
        if (!reduce && shown) startWave();
      }
    });

    // =====================================================================
    // Animation
    // =====================================================================
    function damp(cur, target, rate, dt) {
      return lerp(cur, target, 1 - Math.exp(-rate * dt));
    }

    // Zeitsteuerung von Atmen, Blick, Winken und Blinzeln; wie das aussieht,
    // entscheidet das Modell in pose().
    function animateIdle(dt) {
      const t = clock;
      const ps = poseState;

      // Atmen
      const br = Math.sin(t * ((Math.PI * 2) / 3.8));
      const breathAmp = reduce ? 0.0025 : 0.011;
      ps.breath = br * breathAmp;

      // Grundhaltung: leicht zur Bildschirmmitte gedreht
      const baseYaw = (compact ? compactSide : -1) * 0.24;
      ps.bodyYaw = baseYaw + (reduce ? 0 : Math.sin(t * 0.33) * 0.07);

      // Kopf: gelegentlich umsehen, neigen; meist zum Betrachter
      if (!reduce) {
        look.next -= dt;
        if (look.next <= 0) {
          const toViewer = Math.random() < 0.45;
          look.tYaw = toViewer ? -baseYaw * 0.6 : (Math.random() - 0.5) * 0.9;
          look.tPitch = toViewer ? -0.04 : (Math.random() - 0.4) * 0.3;
          look.tRoll = (Math.random() - 0.5) * (toViewer ? 0.32 : 0.2);
          look.next = 1.8 + Math.random() * 3.4;
        }
      } else {
        look.tYaw = look.tPitch = look.tRoll = 0;
      }
      let waveK = 0;
      if (wave.t >= 0) {
        wave.t += dt;
        waveK = smoothstep(0, 0.45, wave.t) * (1 - smoothstep(wave.dur - 0.5, wave.dur, wave.t));
        if (wave.t >= wave.dur) {
          wave.t = -1;
          wave.next = 16 + Math.random() * 16;
        }
      } else if (!reduce) {
        wave.next -= dt;
        if (wave.next <= 0) startWave();
      }
      look.yaw = damp(look.yaw, lerp(look.tYaw, -baseYaw * 0.5, waveK), 3.2, dt);
      look.pitch = damp(look.pitch, lerp(look.tPitch, -0.06, waveK), 3.2, dt);
      look.roll = damp(look.roll, lerp(look.tRoll, 0.12, waveK), 3.2, dt);

      // Blinzeln (gelegentlich doppelt)
      blink.next -= dt;
      if (blink.t < 0 && blink.next <= 0) blink.t = 0;
      let closed = 0;
      if (blink.t >= 0) {
        blink.t += dt;
        const d = 0.17;
        closed = Math.sin(Math.PI * clamp(blink.t / d, 0, 1));
        if (blink.t >= d) {
          blink.t = -1;
          blink.second = !blink.second && Math.random() < 0.2;
          blink.next = blink.second ? 0.12 : (reduce ? 4 : 2.2) + Math.random() * 3.6;
        }
      }

      ps.time = t;
      ps.reduceMotion = reduce;
      ps.compact = compact;
      ps.yaw = look.yaw;
      ps.pitch = look.pitch;
      ps.roll = look.roll;
      ps.blink = closed;
      ps.wave = waveK;
      // Es winkt der zur Bildmitte zeigende Arm
      ps.waveSide = compact ? compactSide : -1;
      ps.waveTime = wave.t;
      model.pose(ps, dt);
      posed = true;

      // Blätter-Partikel flattern wie die Blätter der Figur
      fxUniforms.uFlutter.value = reduce ? 0.2 : 1;
    }

    function update(dt) {
      clock += dt;
      fxUniforms.uTime.value = clock;
      platUniforms.uTime.value = reduce ? 0 : clock;

      if (anim.active) {
        anim.t += dt;
        const k = clamp((anim.t - anim.delay) / anim.dur, 0, 1);
        const e = anim.celebrate ? easeOutBack(k) : easeInOut(k);
        setGrowth(lerp(anim.from, anim.to, e));
        if (k >= 1) {
          anim.active = false;
          setGrowth(anim.to);
          if (anim.celebrate) showBubble(2600);
        }
      }

      let glowV = 0;
      if (glow.t > -10) {
        glow.t += dt;
        glowV = smoothstep(0, 0.35, glow.t) * (1 - smoothstep(glow.dur - 1.0, glow.dur, glow.t));
        glowV *= 0.85 + 0.15 * Math.sin(glow.t * 14);
        if (glow.t >= glow.dur) glow.t = -100;
      }
      glowValue = glowV;
      model.setGlow(glowV);
      fxUniforms.uGlow.value = glowV;
      platUniforms.uPulse.value = glowV;
      platLight.color.setHex(glowV > 0.05 ? 0x5dffa0 : 0x46d8ff);
      platLight.intensity = 1.1 + glowV * 1.5;

      hover = damp(hover, hoverTarget, 8, dt);
      platUniforms.uHover.value = hover;

      animateIdle(dt);
      updateEffects(dt);

      // Sprechblase: selten von selbst, sonst nach Klick/Wachstum
      if (bubbleState.hideAt && clock >= bubbleState.hideAt) hideBubble();
      bubbleState.next -= dt;
      if (bubbleState.next <= 0) {
        bubbleState.next = 40 + Math.random() * 50;
        showBubble();
      }
    }

    let frameCount = 0;
    function renderOnce() {
      if (hitDirty) updateHitArea();
      renderer.render(scene, camera);
    }

    function loop(now) {
      if (!running) return;
      rafId = requestAnimationFrame(loop);
      const elapsed = now - lastFrame;
      if (elapsed < 1000 / 30 - 3) return; // ~30 fps genügen für die kleine Figur
      lastFrame = now;
      try {
        update(Math.min(0.1, elapsed / 1000));
        frameCount++;
        if (hitDirty && (frameCount % 6 === 0 || !anim.active)) updateHitArea();
      } catch (err) {
        // Fehler eines externen Modells: zurück zum Platzhalter statt eines Fehlers je Frame
        if (modelName === "procedural") throw err;
        modelFailed(modelName, err);
        return;
      }
      renderer.render(scene, camera);
    }

    // ---------- Öffentliche API ----------
    api.setPaused = (v) => {
      paused = Boolean(v);
      updateRun();
    };
    api.refresh = () => {
      refreshFromProgress("instant");
      updateShown();
    };
    api.debugSetPercent = (p) => {
      debugPercent = p == null || p === "" ? null : clamp(Number(p) || 0, 0, 100);
      refreshFromProgress("instant");
      updateShown();
      if (shown) renderOnce();
    };
    api.debugInfo = () => {
      model.bounds(_box);
      const size = model.height();
      return {
        percent: currentPercent(),
        stage: stageFor(currentPercent()),
        growth: anim.g,
        target: targetGrowth(),
        animating: anim.active,
        glow: glowValue,
        effects: particleMesh.visible || sparks.visible,
        height: _box.max.y - _box.min.y,
        // Körpergröße laut Proportionen (ohne Idle-Bewegung wie erhobene Arme)
        size,
        headRatio: model.head().size / size,
        triangles: renderer.info.render.triangles,
        waving: wave.t >= 0,
        headTurn: Math.abs(look.pitch) + Math.abs(look.yaw) + Math.abs(look.roll),
        shown,
        running,
        compact,
        paused,
        model: modelName,
        modelPending,
        modelError,
        modelTriangles: typeof model.triangles === "function" ? model.triangles() : null,
      };
    };

    // ---------- Start ----------
    resize();
    refreshFromProgress("instant");
    // Alle Shader vorab übersetzen — auch die der (noch unsichtbaren) Effekte,
    // sonst stockt die erste Wachstumsanimation.
    const hiddenForCompile = [particleMesh, sparks, platform].filter((o) => !o.visible);
    hiddenForCompile.forEach((o) => (o.visible = true));
    renderer.compile(scene, camera);
    hiddenForCompile.forEach((o) => (o.visible = false));
    updateShown();
    if (shown) renderOnce();
    onModelWish = requestModel;
  }

  // =====================================================================
  // Gemeinsame Bausteine (Komponente und prozeduraler Platzhalter)
  // =====================================================================
  function makeRng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  }

  function add(parent, obj) {
    parent.add(obj);
    return obj;
  }

  function mesh(geo, mat, parent) {
    const m = new THREE.Mesh(geo, mat);
    if (parent) parent.add(m);
    return m;
  }

  function group(parent) {
    const g = new THREE.Group();
    if (parent) parent.add(g);
    return g;
  }

  function leafGeometry() {
    return new THREE.PlaneGeometry(0.75, 1, 1, 2).translate(0, 0.5, 0);
  }

  // ---------- Texturen (Canvas, keine Dateien) ----------
  function leafTexture() {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 128;
    const x = c.getContext("2d");
    const path = () => {
      x.beginPath();
      x.moveTo(48, 124);
      x.bezierCurveTo(8, 104, 6, 46, 48, 5);
      x.bezierCurveTo(90, 46, 88, 104, 48, 124);
      x.closePath();
    };
    const grad = x.createLinearGradient(0, 124, 0, 4);
    grad.addColorStop(0, "#173f12");
    grad.addColorStop(0.5, "#2f7a1f");
    grad.addColorStop(1, "#6cb83a");
    path();
    x.fillStyle = grad;
    x.fill();
    // Seitliche Aufhellung (Wölbung)
    const side = x.createLinearGradient(8, 0, 88, 0);
    side.addColorStop(0, "rgba(0,0,0,0.28)");
    side.addColorStop(0.5, "rgba(255,255,255,0.06)");
    side.addColorStop(1, "rgba(0,0,0,0.2)");
    x.fillStyle = side;
    x.fill();
    // Blattadern
    x.strokeStyle = "rgba(170,230,120,0.6)";
    x.lineWidth = 2.4;
    x.beginPath();
    x.moveTo(48, 122);
    x.quadraticCurveTo(47, 60, 48, 12);
    x.stroke();
    x.lineWidth = 1.2;
    x.strokeStyle = "rgba(160,225,110,0.35)";
    for (let i = 0; i < 6; i++) {
      const y = 100 - i * 14;
      x.beginPath();
      x.moveTo(48, y);
      x.quadraticCurveTo(34, y - 8, 22 + i * 2, y - 18);
      x.moveTo(48, y);
      x.quadraticCurveTo(62, y - 8, 74 - i * 2, y - 18);
      x.stroke();
    }
    path();
    x.strokeStyle = "rgba(20,60,15,0.9)";
    x.lineWidth = 2;
    x.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // Blattmaterial; u = { uTime, uGlow, uGlowColor, uFlutter } (geteilte Uniforms)
  function leafMaterial(tex, u, glowScale) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0,
      emissive: 0x0b2208,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uGlow = u.uGlow;
      shader.uniforms.uGlowColor = u.uGlowColor;
      shader.uniforms.uFlutter = u.uFlutter;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uFlutter;")
        .replace(
          "#include <begin_vertex>",
          // Blätter flattern leicht, jede Instanz mit eigener Phase
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float leafPh = instanceMatrix[3][0] * 17.0 + instanceMatrix[3][1] * 11.0 + instanceMatrix[3][2] * 7.0;
          #else
            float leafPh = 0.0;
          #endif
          float leafF = sin(uTime * 2.4 + leafPh) * uFlutter * uv.y;
          transformed.z += leafF * 0.22;
          transformed.x += leafF * 0.07;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uGlow;\nuniform vec3 uGlowColor;")
        .replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlowColor * uGlow * " + glowScale.toFixed(2) + ";"
        );
    };
    mat.customProgramCacheKey = () => "groot-leaf-" + glowScale;
    return mat;
  }

  // =====================================================================
  // Modell „procedural“: stilisierter Platzhalter (Rig + Proportions-Keyframes)
  // =====================================================================
  // Erfüllt die Modell-Schnittstelle (siehe oben). Alles Figur-Spezifische
  // liegt hier: Geometrie, Rinden-/Blattmaterialien, Rig, FORMS/applyForm und
  // die Posen von Körper, Kopf, Lidern und Armen. Braucht keinen ctx — THREE
  // und die gemeinsamen Bausteine liegen in diesem Skript.
  function createProceduralModel() {
    function scaleUV(geo, u, v) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
      return geo;
    }

    // Rotationskörper; die Naht (u = 0/1) liegt hinten. uRep ganzzahlig,
    // damit die Rindenstreifen nahtlos umlaufen.
    function lathe(points, segments, uRep, vRep) {
      const g = new THREE.LatheGeometry(points, segments);
      g.rotateY(Math.PI);
      return scaleUV(g, uRep, vRep);
    }

    function splineProfile(pts, n) {
      const curve = new THREE.SplineCurve(pts.map((p) => new THREE.Vector2(p[0], p[1])));
      return curve.getPoints(n).map((p) => new THREE.Vector2(Math.max(0.0005, p.x), p.y));
    }

    // Holzsegment der Länge 1 (y 0..1), Radius r0 unten, r1 oben, mit breiten
    // Wölbungen (Muskeln/Holzmasse) statt ringförmiger Knoten.
    function trunkProfile(r0, r1, bumps) {
      const pts = [new THREE.Vector2(0.0005, -0.035)];
      const N = 12;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        let r = lerp(r0, r1, t);
        (bumps || []).forEach((b) => {
          r *= 1 + b.a * Math.exp(-Math.pow((t - b.t) / b.w, 2));
        });
        const cap = Math.sqrt(clamp(t / 0.07, 0, 1)) * Math.sqrt(clamp((1 - t) / 0.07, 0, 1));
        pts.push(new THREE.Vector2(Math.max(0.0005, r * (0.5 + 0.5 * cap)), t));
      }
      pts.push(new THREE.Vector2(0.0005, 1.035));
      return pts;
    }

    // Hängendes Glied (y 0..-1): rTop am Gelenk oben, rBot unten.
    function limbGeo(rTop, rBot, bumps) {
      return lathe(trunkProfile(rBot, rTop, bumps), 10, 1, 1.6).translate(0, -1, 0);
    }

    // Spitz zulaufende Röhre entlang einer Kurve (Äste, Finger, Wurzeln, Ranken).
    const _tp = new THREE.Vector3();
    const _tn = new THREE.Vector3();
    function taperTube(points, r0, r1, segs, radial, uRep, vRep) {
      const curve = new THREE.CatmullRomCurve3(points);
      const frames = curve.computeFrenetFrames(segs, false);
      const pos = [];
      const nor = [];
      const uv = [];
      const idx = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        curve.getPointAt(t, _tp);
        const r = lerp(r0, r1, Math.pow(t, 0.85));
        const n = frames.normals[i];
        const b = frames.binormals[i];
        for (let j = 0; j <= radial; j++) {
          const a = (j / radial) * Math.PI * 2;
          const s = Math.sin(a);
          const c = -Math.cos(a);
          _tn.set(c * n.x + s * b.x, c * n.y + s * b.y, c * n.z + s * b.z).normalize();
          pos.push(_tp.x + r * _tn.x, _tp.y + r * _tn.y, _tp.z + r * _tn.z);
          nor.push(_tn.x, _tn.y, _tn.z);
          uv.push((j / radial) * uRep, t * vRep);
        }
      }
      for (let i = 0; i < segs; i++) {
        for (let j = 0; j < radial; j++) {
          const a = i * (radial + 1) + j;
          const bb = (i + 1) * (radial + 1) + j;
          idx.push(a, bb, a + 1, bb, bb + 1, a + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      return { geo, curve };
    }

    // Auge: Pupille am Nordpol der Kugel (wird nach vorne gedreht), darum eine
    // warme braune Iris mit feinen Strahlen; der Rest bleibt fast schwarz.
    function eyeTexture() {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 64;
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, "#020101");
      g.addColorStop(0.12, "#040201");
      g.addColorStop(0.16, "#2a1508");
      g.addColorStop(0.27, "#5b3416");
      g.addColorStop(0.33, "#1a0c05");
      g.addColorStop(0.38, "#0b0603");
      g.addColorStop(1, "#070403");
      x.fillStyle = g;
      x.fillRect(0, 0, 128, 64);
      const R = makeRng(77);
      for (let i = 0; i < 90; i++) {
        const px = R() * 128;
        x.strokeStyle = R() < 0.5 ? "rgba(140,90,40,0.35)" : "rgba(10,5,2,0.4)";
        x.lineWidth = 0.8;
        x.beginPath();
        x.moveTo(px, 10);
        x.lineTo(px + (R() - 0.5) * 2, 21);
        x.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      return tex;
    }

    // ---------- Rinden-Shader (MeshStandardMaterial + onBeforeCompile) ----------
    const NOISE_GLSL = `
      vec3 gMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 gMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 gPermute(vec4 x) { return gMod289(((x * 34.0) + 1.0) * x); }
      vec4 gTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
      float gNoise(vec3 v) {
        const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = gMod289(i);
        vec4 p = gPermute(gPermute(gPermute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0) * 2.0 + 1.0;
        vec4 s1 = floor(b1) * 2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        vec4 norm = gTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
      }
    `;

    // u läuft um das Teil herum, v entlang: längliche Fasern und Furchen folgen
    // also der Wuchsrichtung. Zu feine Muster werden je Pixelgröße
    // ausgeblendet, damit die kleine Figur nicht flimmert.
    const BARK_PARS = `
      uniform float uBarkStripes;
      uniform float uBarkDepth;
      uniform vec3 uBarkTint;
      uniform float uFiberLen;
      uniform float uRim;
      uniform float uGlow;
      uniform vec3 uGlowColor;
      uniform vec3 uRimColor;
      uniform float uMoss;
      uniform float uGapDark;
      ${NOISE_GLSL}
      float gHash(float n) { return fract(sin(n * 127.1 + 1.3) * 43758.5453); }
      // An der Naht springt u um eine ganze Zahl — Ableitungen darüber hinweg glätten
      vec2 gWrapDu(vec2 d) { return vec2(d.x - floor(d.x + 0.5), d.y); }
      // Rindenhöhe: Stränge, Furchen, Fasern. Nebenwerte für die Farbe.
      float barkHeight(vec2 uv, float fw, out float ridge, out float streak, out float id, out vec2 cs) {
        float ang = uv.x * 6.2831853;
        cs = vec2(cos(ang), sin(ang));
        float v = uv.y * uFiberLen;
        // Unregelmäßige, leicht verdrehte Holzstränge (Phase driftet entlang der Länge)
        float warp = gNoise(vec3(cs * 0.8, v * 0.45)) * 0.8 + gNoise(vec3(cs * 1.9, v * 1.2) + 5.2) * 0.35;
        float s1 = uv.x * uBarkStripes + warp * 1.3 + v * 0.3;
        id = mod(floor(s1), uBarkStripes);
        float x = fract(s1) - 0.5;
        // Durchgehende Furchen, deren Breite entlang des Strangs schwankt
        float gw = mix(0.06, 0.32, smoothstep(-0.4, 0.7, gNoise(vec3(cs * 1.3, v * 1.6) + id * 0.71)));
        float edge = 0.5 - abs(x);
        float aa = max(fw * 0.7, 0.05);
        float inStrand = smoothstep(gw * 0.5 - aa, gw * 0.5 + aa, edge);
        float crown = cos(x * 3.14159);
        // lange, feine Fasern entlang der Stränge
        streak = gNoise(vec3(cs * 9.0, v * 1.4) + id * 0.9) * 0.5 + 0.5;
        float far = smoothstep(0.35, 0.9, fw);
        float streakAA = 1.0 - smoothstep(0.12, 0.35, fw);
        ridge = mix(inStrand, 0.82, far);
        return mix(inStrand * (0.55 + 0.45 * crown + (streak - 0.5) * 0.2 * streakAA), 0.66, far);
      }
      vec3 barkColor(vec2 uv, float h, float ridge, float streak, float id, vec2 cs, float fw) {
        float v = uv.y * uFiberLen;
        float streakAA = 1.0 - smoothstep(0.12, 0.35, fw);
        float fib = gNoise(vec3(cs * 4.0, v * 3.5) + id * 1.3) * 0.5 + 0.5;
        float tintVar = mix(0.86, 1.14, gHash(id + 3.1)) * (0.88 + 0.24 * fib);
        vec3 dark = mix(vec3(0.05, 0.028, 0.014), vec3(0.008, 0.004, 0.002), uGapDark);
        vec3 mid = vec3(0.078, 0.04, 0.016) * tintVar;
        vec3 light = vec3(0.17, 0.1, 0.044) * tintVar;
        vec3 col = mix(dark, mid, smoothstep(0.0, 0.6, h));
        col = mix(col, light, smoothstep(0.7, 1.0, h) * (0.3 + 0.7 * streak) * 0.75);
        col *= mix(1.0, 0.82 + 0.36 * streak, streakAA * ridge);
        // grauer Altholz-Schimmer und etwas Moos in den Furchen
        float grey = smoothstep(0.6, 0.9, gNoise(vec3(cs * 0.7, v * 0.4) + 21.0) * 0.5 + 0.5);
        col = mix(col, vec3(0.1, 0.088, 0.072), grey * 0.3 * ridge);
        float mossN = gNoise(vec3(cs * 1.2, v * 0.9) + 11.0) * 0.5 + 0.5;
        col = mix(col, vec3(0.03, 0.07, 0.014), smoothstep(0.6, 0.86, mossN) * (1.0 - ridge * 0.8) * uMoss);
        return col * uBarkTint;
      }
      // Liefert Farbe, Höhe und deren Bildschirm-Gradienten. Der Gradient wird
      // pro Pixel über Nachbar-UVs ausgewertet statt mit dFdx(Höhe): das
      // vermeidet die blockigen 2×2-Treppen des klassischen Ableitungs-Bumps.
      vec3 grootBark(vec2 uv, out float h, out float ridge, out vec2 dHdxy) {
        vec2 dx = gWrapDu(dFdx(uv));
        vec2 dy = gWrapDu(dFdy(uv));
        float fw = (abs(dx.x) + abs(dy.x)) * uBarkStripes;
        float streak; float id; vec2 cs;
        float r2; float s2; float i2; vec2 c2;
        h = barkHeight(uv, fw, ridge, streak, id, cs);
        float hx = barkHeight(uv + dx, fw, r2, s2, i2, c2);
        float hy = barkHeight(uv + dy, fw, r2, s2, i2, c2);
        dHdxy = vec2(hx - h, hy - h);
        return barkColor(uv, h, ridge, streak, id, cs, fw);
      }
    `;

    const shared = {
      uTime: { value: 0 },
      uGlow: { value: 0 },
      uGlowColor: { value: new THREE.Color(0x3cff6a) },
      uRimColor: { value: new THREE.Color(0x5abeff) },
      uMoss: { value: 0.2 },
      uFlutter: { value: 1 },
    };

    function barkMaterial(opts) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
      const uniforms = {
        uBarkStripes: { value: opts.stripes },
        uBarkDepth: { value: opts.depth },
        uBarkTint: { value: new THREE.Color(opts.tint || 0xffffff) },
        uFiberLen: { value: opts.fiber || 1 },
        uRim: { value: opts.rim == null ? 0.55 : opts.rim },
        uGlow: shared.uGlow,
        uGlowColor: shared.uGlowColor,
        uRimColor: shared.uRimColor,
        uMoss: shared.uMoss,
        uGapDark: { value: opts.gapDark == null ? 1 : opts.gapDark },
      };
      mat.defines = Object.assign({}, mat.defines, { USE_UV: "" });
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\n" + BARK_PARS)
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
            float barkH; float barkRidge; vec2 barkDH;
            diffuseColor.rgb *= grootBark(vUv, barkH, barkRidge, barkDH);
            float barkRough = mix(1.0, 0.82, barkRidge);`
          )
          .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor *= barkRough;")
          .replace(
            "#include <normal_fragment_maps>",
            // Relief über Bildschirm-Ableitungen der Rindenhöhe (wie Bump-Mapping ohne Textur)
            `#include <normal_fragment_maps>
            {
              vec3 vSigmaX = dFdx(-vViewPosition);
              vec3 vSigmaY = dFdy(-vViewPosition);
              vec3 R1 = cross(vSigmaY, normal);
              vec3 R2 = cross(normal, vSigmaX);
              float fDet = dot(vSigmaX, R1);
              vec2 dHdxy = barkDH * uBarkDepth;
              vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
              normal = normalize(abs(fDet) * normal - vGrad);
            }`
          )
          .replace(
            "#include <emissivemap_fragment>",
            // Fresnel-Rand in JARVIS-Blau, beim Wachsen grünes Leuchten (Rand + Furchen)
            `#include <emissivemap_fragment>
            {
              // Fresnel über die geometrische Normale, damit Furchen nicht bläulich glitzern
              float fres = pow(1.0 - clamp(abs(dot(geometryNormal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
              totalEmissiveRadiance += uRimColor * uRim * fres * 0.45;
              totalEmissiveRadiance += uGlowColor * uGlow * (0.035 + 0.75 * fres + (1.0 - barkRidge) * 0.3);
            }`
          );
      };
      mat.customProgramCacheKey = () => "groot-bark";
      return mat;
    }

    const barkBody = barkMaterial({ stripes: 11, depth: 0.018, fiber: 1.1 });
    const barkFace = barkMaterial({ stripes: 22, depth: 0.0055, fiber: 1.2, tint: 0xfff2e6, rim: 0.4, gapDark: 0.4 });
    // Gesichtsdetails (Brauen, Wangen, Kinn): wenige, breite Fasern, damit die
    // kleinen Teile nicht wie dicht gekämmt wirken
    const barkFeature = barkMaterial({ stripes: 6, depth: 0.004, fiber: 0.9, tint: 0xfff2e6, rim: 0.25, gapDark: 0.3 });
    // Zweige, Ranken, Finger: dünne Röhren bekommen kaum Fresnel-Rand, sonst
    // leuchten sie als blaue Linien
    const barkTwig = barkMaterial({ stripes: 4, depth: 0.005, fiber: 2.2, tint: 0xe6d6c2, rim: 0.18 });
    // Wurzelstränge auf Armen und Beinen
    const barkStrand = barkMaterial({ stripes: 3, depth: 0.004, fiber: 1.6, tint: 0xf4e4d0, rim: 0.2 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x060302, roughness: 1, metalness: 0, emissive: 0x020100 });
    const eyeMat = new THREE.MeshStandardMaterial({ map: eyeTexture(), roughness: 0.2, metalness: 0 });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

    const leafTex = leafTexture();
    // ---------- Gemeinsame Basisgeometrien ----------
    const sphereGeo = scaleUV(new THREE.SphereGeometry(1, 14, 10), 2, 1);
    // Pole auf der x-Achse: die Maserung läuft entlang länglicher Querteile (Brauen)
    const sphereGeoX = new THREE.SphereGeometry(1, 14, 10).rotateZ(Math.PI / 2);
    const smallSphereGeo = new THREE.SphereGeometry(1, 10, 7);
    const eyeGeo = new THREE.SphereGeometry(1, 16, 12);
    const lidGeo = scaleUV(new THREE.SphereGeometry(1.08, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 6, 0.6);
    const glintGeo = new THREE.SphereGeometry(1, 6, 5);
    const leafGeo = leafGeometry();

    // =====================================================================
    // Figur (Fußpunkt y = 0, Blick nach +z)
    // =====================================================================
    const root = new THREE.Group();
    root.name = "groot-procedural";
    const fig = group(root);
    const hips = group(fig);
    const spine = group(hips);
    const leafAnchors = []; // { parent, matrix, th, kind }
    const branches = []; // { group, kind, dir, len, th, quat, side }

    // Wurzelstränge, die sich leicht verdreht an einem Glied entlangziehen
    // (Einheitsraum des Glieds: y 0..-1, Radius rTop oben, rBot unten). Die
    // Enden tauchen in die Oberfläche ein; skaliert wird mit dem Glied.
    function addStrands(parent, rTop, rBot, count, seed) {
      const R = makeRng(seed);
      for (let k = 0; k < count; k++) {
        const a0 = (k / count) * Math.PI * 2 + R() * 0.9;
        const twist = (R() - 0.5) * 1.4;
        const y0 = -0.03 - R() * 0.12;
        const y1 = -0.88 - R() * 0.1;
        const pts = [];
        for (let i = 0; i <= 4; i++) {
          const t = i / 4;
          const y = lerp(y0, y1, t);
          const ang = a0 + twist * t;
          const r = lerp(rTop, rBot, -y) * (0.8 + 0.18 * Math.sin(Math.PI * t));
          pts.push(new THREE.Vector3(Math.sin(ang) * r, y, Math.cos(ang) * r));
        }
        const tube = taperTube(pts, 0.2 + R() * 0.06, 0.1, 10, 4, 1, 1.4);
        mesh(tube.geo, barkStrand, parent);
      }
    }

    // ---------- Beine ----------
    const legs = [-1, 1].map((side) => {
      const root = group(hips);
      const hipKnot = mesh(sphereGeo, barkBody, root);
      const thigh = mesh(limbGeo(1.04, 0.78, [{ t: 0.66, a: 0.1, w: 0.26 }]), barkBody, root);
      addStrands(thigh, 1.04, 0.8, 3, 11 + side);
      const knee = group(root);
      const kneeKnot = mesh(sphereGeo, barkBody, knee);
      const shin = mesh(limbGeo(0.95, 0.72, [{ t: 0.72, a: 0.13, w: 0.2 }]), barkBody, knee);
      addStrands(shin, 0.98, 0.74, 3, 21 + side);
      const ankle = group(knee);
      const foot = group(ankle);
      const footMesh = mesh(sphereGeo, barkBody, foot);
      footMesh.scale.set(0.46, 0.3, 0.78);
      footMesh.position.set(0, -0.12, 0.2);
      // Wurzel-Zehen
      const R = makeRng(40 + side);
      for (let k = 0; k < 3; k++) {
        const x0 = (k - 1) * 0.2;
        const tube = taperTube(
          [
            new THREE.Vector3(x0, -0.2, 0.5),
            new THREE.Vector3(x0 * 1.7, -0.33, 0.88 + R() * 0.08),
            new THREE.Vector3(x0 * 2.3, -0.4, 1.18 + R() * 0.12),
          ],
          0.13,
          0.03,
          7,
          5,
          1,
          1
        );
        mesh(tube.geo, barkTwig, foot);
      }
      const heel = taperTube(
        [new THREE.Vector3(side * 0.1, -0.22, -0.15), new THREE.Vector3(side * 0.25, -0.36, -0.42), new THREE.Vector3(side * 0.34, -0.41, -0.62)],
        0.12,
        0.03,
        6,
        5,
        1,
        1
      );
      mesh(heel.geo, barkTwig, foot);
      return { side, root, hipKnot, thigh, knee, kneeKnot, shin, ankle, foot };
    });

    // ---------- Rumpf ----------
    const TORSO_PROFILE = [
      [0.46, 0.0],
      [0.56, 0.12],
      [0.58, 0.3],
      [0.8, 0.55],
      [1.0, 0.8],
      [0.95, 0.92],
      [0.6, 1.0],
    ];
    const torsoPts = splineProfile(TORSO_PROFILE, 16);
    torsoPts.unshift(new THREE.Vector2(0.0005, -0.02));
    torsoPts.push(new THREE.Vector2(0.0005, 1.03));
    function torsoRadius(t) {
      for (let i = 1; i < TORSO_PROFILE.length; i++) {
        if (t <= TORSO_PROFILE[i][1]) {
          const a = TORSO_PROFILE[i - 1];
          const b = TORSO_PROFILE[i];
          return lerp(a[0], b[0], (t - a[1]) / (b[1] - a[1]));
        }
      }
      return TORSO_PROFILE[TORSO_PROFILE.length - 1][0];
    }

    const pelvis = mesh(sphereGeo, barkBody, spine);
    const torso = mesh(lathe(torsoPts, 18, 2, 1.4), barkBody, spine);
    const belly = mesh(sphereGeo, barkBody, spine);
    // Ranken, die sich um Bauch und Brust winden (wachsen mit dem Rumpf mit)
    (function buildVines() {
      const R = makeRng(303);
      const COUNT = 9;
      for (let k = 0; k < COUNT; k++) {
        const phase = (k / COUNT) * Math.PI * 2 + R() * 0.35;
        const dir = 1;
        const turns = 0.06 + R() * 0.1;
        const t0 = 0.02 + R() * 0.1;
        const t1 = 0.7 + R() * 0.24;
        const pts = [];
        for (let st = 0; st <= 6; st++) {
          const t = lerp(t0, t1, st / 6);
          const ang = phase + dir * turns * Math.PI * 2 * (st / 6);
          const r = torsoRadius(t) * 0.985;
          pts.push(new THREE.Vector3(Math.sin(ang) * r, t, Math.cos(ang) * r));
        }
        const tube = taperTube(pts, 0.075 + R() * 0.035, 0.03, 22, 4, 1, 1.6);
        mesh(tube.geo, barkTwig, torso);
      }
    })();

    // ---------- Arme ----------
    function buildHand(side) {
      const g = new THREE.Group();
      const palm = mesh(sphereGeo, barkBody, g);
      palm.scale.set(0.22, 0.48, 0.34);
      palm.position.set(0, -0.36, 0.02);
      const R = makeRng(90 + side);
      // Lange Holzfinger, leicht zum Körper eingerollt
      for (let k = 0; k < 3; k++) {
        const z0 = (k - 1) * 0.17;
        const curl = -side * (0.12 + R() * 0.06);
        const len = 0.66 + (k === 1 ? 0.1 : 0) + R() * 0.08;
        const tube = taperTube(
          [
            new THREE.Vector3(0, -0.7, z0),
            new THREE.Vector3(curl * 0.4, -0.7 - len * 0.5, z0 * 1.25 + 0.04),
            new THREE.Vector3(curl, -0.7 - len, z0 * 1.4 + 0.14),
          ],
          0.13,
          0.04,
          7,
          5,
          1,
          1
        );
        mesh(tube.geo, barkTwig, g);
      }
      const thumb = taperTube(
        [new THREE.Vector3(-side * 0.04, -0.42, 0.26), new THREE.Vector3(-side * 0.12, -0.72, 0.42), new THREE.Vector3(-side * 0.18, -0.98, 0.46)],
        0.09,
        0.035,
        6,
        5,
        1,
        1
      );
      mesh(thumb.geo, barkTwig, g);
      return g;
    }

    const traps = [-1, 1].map((side) => {
      const m = mesh(sphereGeo, barkBody, spine);
      m.rotation.z = -side * 0.42;
      return m;
    });
    const shoulderLine = group(spine);
    const arms = [-1, 1].map((side) => {
      const shoulder = group(shoulderLine);
      const deltoid = mesh(sphereGeo, barkBody, shoulder);
      const armRoot = group(shoulder);
      const upper = mesh(limbGeo(1.12, 0.8, [{ t: 0.6, a: 0.12, w: 0.24 }]), barkBody, armRoot);
      addStrands(upper, 1.12, 0.82, 3, 31 + side);
      const elbow = group(armRoot);
      const elbowKnot = mesh(sphereGeo, barkBody, elbow);
      const fore = mesh(limbGeo(0.95, 0.66, [{ t: 0.74, a: 0.18, w: 0.2 }]), barkBody, elbow);
      addStrands(fore, 1.0, 0.7, 3, 41 + side);
      const wrist = group(elbow);
      const hand = add(wrist, buildHand(side));
      return { side, shoulder, deltoid, armRoot, upper, elbow, elbowKnot, fore, wrist, hand };
    });

    // ---------- Hals & Kopf ----------
    const neck = group(spine);
    const neckMesh = mesh(lathe(trunkProfile(1.15, 0.85), 10, 1, 1), barkBody, neck);
    const headPivot = group(neck);
    headPivot.rotation.order = "YXZ";
    const headShape = group(headPivot);

    // Kopfprofil (Einheitsraum: y -1 Kinn .. 1 Scheitel, Radius ~1). Oben breit,
    // zum kleinen Kinn hin schmaler — skaliert ergibt das rund (Baby) bis
    // länglich (erwachsen).
    const HEAD_PROFILE = [
      [0.0, -1.0],
      [0.32, -0.96],
      [0.56, -0.84],
      [0.72, -0.64],
      [0.84, -0.38],
      [0.93, -0.08],
      [0.99, 0.2],
      [1.0, 0.42],
      [0.95, 0.64],
      [0.8, 0.84],
      [0.52, 0.97],
      [0.2, 1.01],
      [0.0, 1.02],
    ];
    const headPts = splineProfile(HEAD_PROFILE, 22);
    const headRadiusTable = headPts.map((p) => [p.y, p.x]);
    function headRadius(y) {
      for (let i = 1; i < headRadiusTable.length; i++) {
        if (y <= headRadiusTable[i][0]) {
          const a = headRadiusTable[i - 1];
          const b = headRadiusTable[i];
          return lerp(a[1], b[1], clamp((y - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1));
        }
      }
      return 0;
    }
    function headSurfaceZ(x, y) {
      const r = headRadius(y);
      return Math.sqrt(Math.max(0, r * r - x * x));
    }

    const cranium = mesh(lathe(headPts, 24, 1, 1.25), barkFace, headShape);
    const brows = [-1, 1].map(() => mesh(sphereGeoX, barkFeature, headShape));
    const browBridge = mesh(sphereGeoX, barkFeature, headShape);
    const cheeks = [-1, 1].map(() => mesh(sphereGeo, barkFeature, headShape));
    const nose = mesh(smallSphereGeo, barkFeature, headShape);
    const chin = mesh(sphereGeo, barkFeature, headShape);
    const mouthArc = 2.0;
    const mouth = mesh(new THREE.TorusGeometry(1, 0.2, 6, 14, mouthArc), darkMat, headShape);

    // Augen: in einer Gruppe, deren Skalierung die ungleichmäßige Kopfskalierung
    // aufhebt — so bleiben sie rund. Lid = Halbkugel-Schale, die beim Blinzeln
    // nach vorn klappt.
    const eyes = [-1, 1].map((side) => {
      const g = group(headShape);
      const socket = mesh(sphereGeo, darkMat, g);
      socket.scale.set(1.36, 1.3, 1.3);
      socket.position.z = -0.3;
      const ball = mesh(eyeGeo, eyeMat, g);
      ball.rotation.x = Math.PI / 2;
      const lid = mesh(lidGeo, barkFace, g);
      const glint = mesh(glintGeo, glintMat, g);
      glint.position.set(0.36, 0.38, 0.85).normalize().multiplyScalar(0.9);
      glint.scale.setScalar(0.15);
      const glint2 = mesh(glintGeo, glintMat, g);
      glint2.position.set(-0.32, -0.3, 0.9).normalize().multiplyScalar(0.92);
      glint2.scale.setScalar(0.07);
      return { side, g, socket, ball, lid, glints: [glint, glint2] };
    });

    // ---------- Äste & Blätter ----------
    function quatFromDir(dir, twist) {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      if (twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), twist));
      return q;
    }

    function addLeaf(parent, pos, dir, size, th, R) {
      const twist = R() * Math.PI * 2;
      const tilt = new THREE.Vector3((R() - 0.5) * 1.2, 0.6 + R() * 0.4, (R() - 0.5) * 1.2);
      const d = dir.clone().normalize().multiplyScalar(0.7).add(tilt.normalize().multiplyScalar(0.6)).normalize();
      const q = quatFromDir(d, twist);
      const m = new THREE.Matrix4().compose(pos.clone(), q, new THREE.Vector3(size, size, size));
      leafAnchors.push({ parent, matrix: m, th });
    }

    function buildBranch(seed, twigCount, r0, leafCount, leafTh, leafSize) {
      const R = makeRng(seed);
      const g = new THREE.Group();
      const bx = (R() - 0.5) * 0.8;
      const bz = (R() - 0.5) * 0.8;
      const pts = [
        new THREE.Vector3(0, -0.1, 0),
        new THREE.Vector3(bx * 0.15, 0.3, bz * 0.15),
        new THREE.Vector3(bx * 0.55, 0.66, bz * 0.55),
        new THREE.Vector3(bx, 1, bz),
      ];
      const main = taperTube(pts, r0, r0 * 0.16, 10, 6, 1, 1.6);
      mesh(main.geo, barkTwig, g);
      const tips = [{ p: pts[3].clone(), d: main.curve.getTangentAt(1) }];
      for (let k = 0; k < twigCount; k++) {
        const t = 0.42 + R() * 0.32;
        const p0 = main.curve.getPointAt(t);
        const ang = R() * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(ang) * 0.85, 0.75, Math.sin(ang) * 0.85).normalize();
        const L = 0.32 + R() * 0.2;
        const p1 = p0.clone().addScaledVector(dir, L * 0.5).add(new THREE.Vector3(0, 0.03, 0));
        const p2 = p0.clone().addScaledVector(dir, L).add(new THREE.Vector3(0, 0.09, 0));
        const tw = taperTube([p0, p1, p2], r0 * 0.5, r0 * 0.1, 6, 5, 1, 1);
        mesh(tw.geo, barkTwig, g);
        tips.push({ p: p2, d: tw.curve.getTangentAt(1) });
      }
      for (let k = 0; k < leafCount; k++) {
        const tip = tips[k % tips.length];
        addLeaf(g, tip.p, tip.d, leafSize * (0.8 + R() * 0.4), leafTh <= 0 ? 0 : clamp(leafTh + R() * 0.2, 0, 0.98), R);
      }
      return g;
    }

    function registerBranch(parent, kind, spec, seed) {
      const g = buildBranch(seed, spec.twigs || 0, spec.r0 || 0.07, spec.leaves || 0, spec.leafTh == null ? spec.th : spec.leafTh, spec.leafSize || 0.34);
      parent.add(g);
      const dir = new THREE.Vector3(spec.d[0], spec.d[1], spec.d[2]).normalize();
      branches.push({
        group: g,
        kind,
        dir,
        len: spec.len,
        th: spec.th,
        side: spec.side || 0,
        quat: quatFromDir(dir, spec.twist || 0),
      });
    }

    // Kopfäste: Richtung im Kopf-Einheitsraum, Länge relativ zur Kopfhöhe,
    // Schwelle = ab welchem Astwachstum der Ast erscheint. Der erste ist der
    // kleine Spross, den schon Baby Groot trägt.
    const HEAD_BRANCHES = [
      { d: [0.08, 1, -0.12], len: 0.55, th: -1, twigs: 0, leaves: 2, leafTh: 0, leafSize: 0.62, r0: 0.09 },
      { d: [0.5, 0.86, -0.25], len: 0.9, th: 0.05, twigs: 1, leaves: 2, leafTh: 0.2 },
      { d: [-0.52, 0.82, -0.3], len: 0.95, th: 0.16, twigs: 1, leaves: 3, leafTh: 0.25 },
      { d: [0.8, 0.45, -0.45], len: 0.78, th: 0.3, twigs: 1, leaves: 2, leafTh: 0.4 },
      { d: [-0.78, 0.5, -0.42], len: 0.82, th: 0.4, twigs: 1, leaves: 3, leafTh: 0.45 },
      { d: [0.25, 0.72, -0.72], len: 1.1, th: 0.5, twigs: 2, leaves: 3, leafTh: 0.55 },
      { d: [-0.3, 0.6, -0.8], len: 1.0, th: 0.6, twigs: 2, leaves: 3, leafTh: 0.62 },
      { d: [0.92, 0.08, -0.45], len: 0.62, th: 0.72, twigs: 1, leaves: 2, leafTh: 0.72 },
      { d: [-0.9, 0.12, -0.42], len: 0.66, th: 0.8, twigs: 1, leaves: 2, leafTh: 0.8 },
      { d: [0.02, 0.38, -0.96], len: 0.9, th: 0.88, twigs: 2, leaves: 3, leafTh: 0.86 },
    ];
    HEAD_BRANCHES.forEach((spec, i) => registerBranch(headPivot, "head", spec, 500 + i * 31));

    // Schulter-, Rücken- und Unterarmzweige (ab dem jungen Groot)
    arms.forEach((arm) => {
      const s = arm.side;
      [
        { d: [s * 0.35, 1, -0.35], len: 0.75, th: 0.05, twigs: 1, leaves: 2, leafTh: 0.25 },
        { d: [s * 0.85, 0.6, -0.2], len: 0.6, th: 0.3, twigs: 1, leaves: 2, leafTh: 0.45 },
        { d: [s * 0.15, 0.7, -0.9], len: 0.85, th: 0.55, twigs: 2, leaves: 3, leafTh: 0.6 },
      ].forEach((spec, i) => registerBranch(arm.shoulder, "shoulder", Object.assign({ side: s }, spec), 700 + i * 13 + (s > 0 ? 50 : 0)));
      registerBranch(arm.elbow, "fore", { d: [s * 0.7, -0.35, 0.6], len: 0.5, th: 0.62, twigs: 0, leaves: 2, leafTh: 0.7, side: s, r0: 0.08 }, 800 + (s > 0 ? 7 : 0));
    });
    [
      { d: [0.4, 0.75, -0.9], len: 0.8, th: 0.7, twigs: 2, leaves: 3, leafTh: 0.75, side: 1 },
      { d: [-0.45, 0.7, -0.9], len: 0.75, th: 0.82, twigs: 1, leaves: 2, leafTh: 0.85, side: -1 },
    ].forEach((spec, i) => registerBranch(spine, "back", spec, 900 + i * 17));

    // Die Blätter liegen neben der Figur unter root; ihre Matrizen sind
    // Weltmatrizen (root bleibt im Ursprung, siehe Schnittstelle).
    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMaterial(leafTex, shared, 0.25), leafAnchors.length);
    leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    leafMesh.frustumCulled = false;
    root.add(leafMesh);

    // =====================================================================
    // Proportionen der Stufen
    // =====================================================================
    // Keyframes: Baby, Größerer Baby, Jung, Teenager, Erwachsen, voll ausgewachsen (100 %)
    const FORMS = [
      // Baby: riesiger runder Kopf (~47 % der Körperhöhe), kurzer Rumpf, Stummelbeine, sehr große Augen
      { hip: 0.2, legR: 0.072, torsoH: 0.27, shoulderW: 0.135, chestR: 0.15, chestD: 0.125, waistR: 0.138, belly: 1, neckH: 0.0, neckR: 0.068, headH: 0.42, headW: 0.218, headD: 0.2, armL: 0.3, armR: 0.046, handS: 1.0, eye: 0.06, eyeX: 0.4, eyeY: -0.05, lid: -0.95, branch: 0.1, leaves: 0.2, twigs: 0, moss: 0.03, footL: 0.12, splay: 0.38, elbow: -0.38, brow: 0.75 },
      { hip: 0.33, legR: 0.074, torsoH: 0.37, shoulderW: 0.17, chestR: 0.165, chestD: 0.128, waistR: 0.13, belly: 0.6, neckH: 0.018, neckR: 0.066, headH: 0.44, headW: 0.196, headD: 0.188, armL: 0.45, armR: 0.049, handS: 1.0, eye: 0.049, eyeX: 0.41, eyeY: -0.06, lid: -0.85, branch: 0.28, leaves: 0.36, twigs: 0.1, moss: 0.07, footL: 0.14, splay: 0.3, elbow: -0.32, brow: 0.85 },
      // Jung: schlanker, Kopf ~27 %
      { hip: 0.53, legR: 0.078, torsoH: 0.5, shoulderW: 0.22, chestR: 0.19, chestD: 0.135, waistR: 0.12, belly: 0.2, neckH: 0.04, neckR: 0.06, headH: 0.41, headW: 0.165, headD: 0.168, armL: 0.66, armR: 0.054, handS: 1.0, eye: 0.04, eyeX: 0.42, eyeY: -0.08, lid: -0.72, branch: 0.48, leaves: 0.52, twigs: 0.35, moss: 0.12, footL: 0.16, splay: 0.23, elbow: -0.28, brow: 1.0 },
      // Teenager: schlaksig, lange Arme/Beine, schmalerer Kopf (~19 %)
      { hip: 0.8, legR: 0.072, torsoH: 0.58, shoulderW: 0.245, chestR: 0.19, chestD: 0.13, waistR: 0.105, belly: 0, neckH: 0.06, neckR: 0.052, headH: 0.36, headW: 0.128, headD: 0.15, armL: 0.93, armR: 0.052, handS: 1.15, eye: 0.032, eyeX: 0.43, eyeY: -0.1, lid: -0.62, branch: 0.68, leaves: 0.68, twigs: 0.6, moss: 0.17, footL: 0.17, splay: 0.17, elbow: -0.24, brow: 1.15 },
      // Erwachsen: groß, breite Schultern, lange kräftige Arme, kleiner länglicher Kopf (~16 %)
      { hip: 0.86, legR: 0.094, torsoH: 0.71, shoulderW: 0.345, chestR: 0.3, chestD: 0.18, waistR: 0.15, belly: 0, neckH: 0.06, neckR: 0.074, headH: 0.31, headW: 0.118, headD: 0.145, armL: 1.03, armR: 0.082, handS: 1.25, eye: 0.028, eyeX: 0.44, eyeY: -0.12, lid: -0.55, branch: 0.88, leaves: 0.86, twigs: 0.88, moss: 0.22, footL: 0.2, splay: 0.15, elbow: -0.32, brow: 1.3 },
      // Voll ausgewachsen (100 %): Kopf ~15 %, die meisten Äste
      { hip: 0.9, legR: 0.098, torsoH: 0.75, shoulderW: 0.37, chestR: 0.32, chestD: 0.19, waistR: 0.16, belly: 0, neckH: 0.06, neckR: 0.078, headH: 0.3, headW: 0.116, headD: 0.145, armL: 1.09, armR: 0.088, handS: 1.25, eye: 0.028, eyeX: 0.44, eyeY: -0.12, lid: -0.55, branch: 1, leaves: 1, twigs: 1, moss: 0.26, footL: 0.21, splay: 0.15, elbow: -0.32, brow: 1.35 },
    ];
    const FORM_KEYS = Object.keys(FORMS[0]);

    function formAt(g) {
      const i = clamp(Math.floor(g), 0, FORMS.length - 2);
      const t = clamp(g - i, 0, 1);
      const a = FORMS[i];
      const b = FORMS[i + 1];
      const f = {};
      FORM_KEYS.forEach((k) => (f[k] = lerp(a[k], b[k], t)));
      return f;
    }

    let form = formAt(0);
    let growth = 0;

    function figureHeight(P) {
      return P.hip + P.torsoH * 0.93 + P.neckH + P.headH;
    }

    // Setzt alle Positionen/Skalierungen des Rigs (keine Geometrie-Änderung).
    function applyForm(P) {
      form = P;
      hips.position.y = P.hip;

      const ankleH = P.footL * 0.42;
      const legLen = Math.max(0.02, P.hip - ankleH);
      legs.forEach((leg) => {
        const s = leg.side;
        leg.root.position.set(s * P.waistR * 0.52, 0, 0);
        leg.root.rotation.z = s * 0.05;
        // Oberschenkel beginnt im Becken (Hüftkugel rundet den Übergang ab)
        leg.hipKnot.scale.set(P.legR * 1.12, P.legR * 1.2, P.legR * 1.1);
        leg.hipKnot.position.y = P.legR * 0.35;
        // Segmente überlappen am Knie, damit die abgerundeten Enden keine Ringe bilden
        const ov = P.legR * 0.55;
        leg.thigh.position.y = P.legR * 0.6;
        leg.thigh.scale.set(P.legR * 1.1, legLen * 0.5 + P.legR * 0.6 + ov, P.legR * 1.1);
        leg.knee.position.y = -legLen * 0.5;
        leg.kneeKnot.scale.set(P.legR * 0.9, P.legR * 1.1, P.legR * 1.0);
        leg.shin.position.y = ov;
        leg.shin.scale.set(P.legR, legLen * 0.5 + ov, P.legR);
        leg.ankle.position.y = -legLen * 0.5;
        leg.ankle.rotation.z = -s * 0.05;
        leg.foot.scale.setScalar(P.footL);
        leg.foot.rotation.y = s * 0.22;
      });

      // Becken nur so breit wie der Rumpfansatz — sonst wirkt es wie eine Windel
      pelvis.scale.set(P.waistR * 0.98, P.waistR * 0.95, P.waistR * 0.86);
      pelvis.position.y = P.waistR * 0.45;
      torso.scale.set(P.chestR, P.torsoH, P.chestD);
      const b = P.belly;
      belly.visible = b > 0.03;
      belly.scale.set(P.chestR * (0.6 + 0.35 * b), P.torsoH * (0.22 + 0.14 * b), P.chestD * (0.55 + 0.35 * b));
      belly.position.set(0, P.torsoH * 0.34, P.chestD * 0.32 * b);

      shoulderLine.position.y = P.torsoH * 0.86;
      traps.forEach((m, i) => {
        const s = i ? 1 : -1;
        m.position.set(s * P.shoulderW * 0.5, P.torsoH * 0.9, -P.chestD * 0.12);
        m.scale.set(P.shoulderW * 0.55, P.torsoH * 0.09 + 0.01, P.chestD * 0.62);
      });
      const upperL = P.armL * 0.42;
      const foreL = P.armL * 0.36;
      arms.forEach((arm) => {
        arm.shoulder.position.set(arm.side * P.shoulderW, 0, -P.chestD * 0.05);
        arm.deltoid.scale.set(P.armR * 1.24, P.armR * 1.34, P.armR * 1.26);
        // Oberarm reicht in die Schulter hinein, Unterarm über den Ellbogen
        const aov = P.armR * 0.5;
        arm.upper.position.y = P.armR * 0.3;
        arm.upper.scale.set(P.armR * 1.08, upperL + aov + P.armR * 0.3, P.armR * 1.08);
        arm.elbow.position.y = -upperL;
        arm.elbowKnot.scale.set(P.armR * 0.88, P.armR * 1.05, P.armR * 0.95);
        arm.fore.position.y = aov;
        arm.fore.scale.set(P.armR * 0.92, foreL + aov, P.armR * 0.92);
        arm.wrist.position.y = -foreL;
        arm.hand.scale.setScalar(P.armL * 0.2 * P.handS);
      });

      neck.position.y = P.torsoH * 0.93;
      neckMesh.scale.set(P.neckR, P.neckH + P.headH * 0.3 + 0.03, P.neckR);
      neckMesh.position.y = -0.03;
      headPivot.position.y = P.neckH + P.headH * 0.2;
      headShape.position.set(0, P.headH * 0.3, 0);
      const hw = P.headW;
      const hh = P.headH * 0.5;
      const hd = P.headD;
      headShape.scale.set(hw, hh, hd);

      // Gesicht im Kopf-Einheitsraum, abhängig von der Augengröße
      const ex = P.eyeX;
      const ey = P.eyeY;
      const rx = P.eye / hw;
      const ry = P.eye / hh;
      const rz = P.eye / hd;
      eyes.forEach((eye) => {
        const x = eye.side * ex;
        eye.g.position.set(x, ey, headSurfaceZ(Math.abs(x), ey) - 0.5 * rz);
        eye.g.scale.set(rx, ry, rz);
      });
      const browY = ey + ry * 0.98 + 0.035;
      brows.forEach((m, i) => {
        const s = i ? 1 : -1;
        const bxp = ex * 0.95;
        // Brauenwulst wird mit dem Alter kräftiger und ragt über die Augen
        m.position.set(s * bxp, browY, headSurfaceZ(bxp, browY) - 0.075 + 0.025 * P.brow);
        m.scale.set(rx * 1.15 + 0.08, (0.07 + ry * 0.08) * P.brow, 0.15 + 0.04 * P.brow);
        m.rotation.set(-0.2, s * 0.45, -s * 0.16);
      });
      browBridge.position.set(0, browY - 0.05, headSurfaceZ(0, browY - 0.05) - 0.05);
      browBridge.scale.set(0.15, 0.075 * P.brow, 0.11);
      const cheekY = ey - ry - 0.04;
      cheeks.forEach((m, i) => {
        const s = i ? 1 : -1;
        const cx = ex * 1.2;
        m.position.set(s * cx, cheekY, headSurfaceZ(cx, cheekY) - 0.11);
        m.scale.set(0.24, 0.15, 0.15);
        m.rotation.z = s * 0.5;
      });
      const noseY = ey - ry * 0.62;
      nose.position.set(0, noseY, headSurfaceZ(0, noseY) - 0.025);
      nose.scale.set(0.08, Math.max(0.085, ry * 0.45), 0.075);
      const mouthY = ey - ry - 0.24;
      const mr = 0.12 + rx * 0.12;
      mouth.position.set(0, mouthY, headSurfaceZ(0, mouthY - mr * 0.7) - 0.01);
      mouth.scale.set(mr, mr * 0.7, mr);
      mouth.rotation.set(0.1, 0, -Math.PI / 2 - mouthArc / 2);
      chin.position.set(0, -0.8, headSurfaceZ(0, -0.8) - 0.12);
      chin.scale.set(0.3, 0.2, 0.2);

      // Äste
      branches.forEach((br) => {
        let scale = 0;
        if (br.kind === "head") {
          const d = br.dir;
          const k = 1 / Math.sqrt(Math.pow(d.x / hw, 2) + Math.pow(d.y / hh, 2) + Math.pow(d.z / hd, 2));
          br.group.position.set(d.x * k * 0.9, P.headH * 0.3 + d.y * k * 0.9, d.z * k * 0.9);
          const gate = br.th < 0 ? 1 : smoothstep(br.th, br.th + 0.2, P.branch);
          scale = (br.th < 0 ? P.headH * (0.55 + 0.45 * (1 - P.branch)) : P.headH * (0.6 + 0.5 * P.branch)) * br.len * gate;
        } else if (br.kind === "shoulder") {
          br.group.position.set(br.dir.x * P.armR * 0.9, P.armR * 1.2, br.dir.z * P.armR * 1.1);
          scale = (P.chestR * 1.1 + 0.08) * br.len * smoothstep(br.th, br.th + 0.25, P.twigs);
        } else if (br.kind === "back") {
          br.group.position.set(br.side * P.chestR * 0.45, P.torsoH * 0.8, -P.chestD * 0.75);
          scale = (P.chestR * 1.1 + 0.08) * br.len * smoothstep(br.th, br.th + 0.2, P.twigs);
        } else if (br.kind === "fore") {
          br.group.position.set(br.side * P.armR * 0.7, -foreL * 0.5, P.armR * 0.5);
          scale = P.armL * 0.3 * br.len * smoothstep(br.th, br.th + 0.2, P.twigs);
        }
        br.group.quaternion.copy(br.quat);
        br.group.scale.setScalar(Math.max(scale, 1e-4));
        br.group.visible = scale > 0.002;
        br.leafGate = P.leaves;
      });

      shared.uMoss.value = P.moss;
    }

    // Blätter folgen ihren Ästen (Weltmatrix) — eine Instanz pro Blatt, ein Draw-Call.
    const _m = new THREE.Matrix4();
    const _s = new THREE.Matrix4();
    function updateLeaves() {
      fig.updateMatrixWorld(true);
      for (let i = 0; i < leafAnchors.length; i++) {
        const a = leafAnchors[i];
        const gate = smoothstep(a.th, a.th + 0.12, form.leaves);
        _m.multiplyMatrices(a.parent.matrixWorld, a.matrix);
        if (gate < 1) _m.multiply(_s.makeScale(gate + 1e-4, gate + 1e-4, gate + 1e-4));
        leafMesh.setMatrixAt(i, _m);
      }
      leafMesh.instanceMatrix.needsUpdate = true;
    }

    // Idle-/Winke-Pose aus dem neutralen Zustand der Komponente
    function pose(s) {
      const P = form;
      const t = s.time;
      const reduce = s.reduceMotion;
      shared.uTime.value = t;

      // Atmen
      spine.scale.set(1 + s.breath * 0.8, 1 + s.breath, 1 + s.breath * 0.8);
      shoulderLine.position.y = P.torsoH * 0.86 + s.breath * P.torsoH * 0.6;

      fig.rotation.y = s.bodyYaw;
      headPivot.rotation.set(s.pitch, s.yaw, s.roll);

      // Arme: leichtes Pendeln; der Arm auf s.waveSide winkt
      arms.forEach((arm, i) => {
        const side = arm.side;
        const sway = reduce ? 0 : Math.sin(t * 0.9 + i * 1.7) * 0.045;
        let rz = side * (P.splay + sway);
        let rx = -0.1 + (reduce ? 0 : Math.sin(t * 0.7 + i) * 0.04);
        let ez = 0;
        let ex = P.elbow + (reduce ? 0 : Math.sin(t * 0.8 + i * 2.1) * 0.05);
        const waveK = s.wave;
        if (side === s.waveSide && waveK > 0) {
          const osc = Math.sin(s.waveTime * 13.0);
          // Großer Groot: Oberarm unten lassen und den Unterarm vorn hochklappen —
          // sonst ragt die Hand im festen Desktop-Ausschnitt über den Canvas-Rand.
          const big = s.compact ? 0 : smoothstep(1.0, 2.5, growth);
          rz = lerp(rz, side * lerp(2.55, 0.3, big), waveK);
          rx = lerp(rx, -0.25, waveK);
          ez = lerp(0, side * (lerp(0.55, 0.2, big) + osc * lerp(0.4, 0.3, big)), waveK);
          ex = lerp(ex, lerp(-0.15, -2.4, big), waveK);
        }
        arm.armRoot.rotation.set(rx, 0, rz);
        arm.elbow.rotation.set(ex, 0, ez);
      });

      // Lider (Blinzeln)
      eyes.forEach((eye) => {
        eye.lid.rotation.x = lerp(P.lid, 1.62, s.blink);
        const showGlint = s.blink < 0.45;
        eye.glints[0].visible = eye.glints[1].visible = showGlint;
      });

      shared.uFlutter.value = reduce ? 0.2 : 1;
      updateLeaves();
    }

    return {
      object: root,
      credit: "Stilisierter 3D-Platzhalter – kein offizielles Marvel-Modell",
      setGrowth(g) {
        growth = g;
        applyForm(formAt(g));
        updateLeaves();
      },
      height: () => figureHeight(form),
      head: () => ({ y: form.hip + form.torsoH * 0.93 + form.neckH + form.headH * 0.5, size: form.headH }),
      headTop(v) {
        fig.updateMatrixWorld(true);
        return headPivot.localToWorld(v.set(0, form.headH * 0.9, 0));
      },
      // Nur die Figur — die Blatt-Instanzen (eigenes Mesh) zählen nicht mit
      bounds(box) {
        fig.updateMatrixWorld(true);
        return box.setFromObject(fig);
      },
      pose,
      setGlow(v) {
        shared.uGlow.value = v;
      },
      emitters() {
        const H = figureHeight(form);
        return { radius: form.shoulderW, y0: H * 0.25, y1: H * 1.05 };
      },
      triangles() {
        let n = 0;
        root.traverseVisible((o) => {
          if (!o.isMesh) return;
          const g = o.geometry;
          n += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
        });
        return Math.round(n);
      },
      dispose() {
        const seen = new Set();
        root.traverse((o) => {
          if (o.geometry) seen.add(o.geometry);
          if (o.material) seen.add(o.material);
        });
        seen.forEach((x) => x.dispose());
        leafTex.dispose();
        eyeMat.map.dispose();
        if (root.parent) root.parent.remove(root);
      },
    };
  }
})();
