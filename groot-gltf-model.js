// ---------------------------------------------------------------------------
// Groot: Adapter für ein späteres, lizenziertes GLB/GLTF-Modell (VORLAGE)
//
// Diese Datei wird von index.html bewusst NICHT geladen. Solange sie fehlt,
// zeigt groot.js den prozeduralen Platzhalter. Ein echtes Groot-Modell gehört
// nicht zum Projekt — der Adapter ist nur mit Ersatz-Szenen erprobt. Knochen-
// und Morph-Namen, Achsen und Blickrichtung müssen an das konkrete Modell
// angepasst werden. Anleitung: GROOT-MODELL.md.
//
// Voraussetzung: THREE.GLTFLoader passend zu three.js r128 (Datei
// examples/js/loaders/GLTFLoader.js der Version r128). Fehlt er oder schlägt
// das Laden fehl, lehnt die Fabrik ab und der Platzhalter bleibt.
//
// Zwei Wege:
//   A) gltf.stages: ein Modell pro Entwicklungsstufe (5 Dateien, Baby …
//      Erwachsen). Beim Stufenwechsel wird überblendet; innerhalb einer Stufe
//      wächst das Modell leicht mit (Höhe aus heights).
//   B) gltf.url: ein Modell mit Skelett und/oder Morph-Targets. Größe aus
//      heights, Proportionen optional über Morph-Targets je Stufe, Kopf und
//      Atmen über Knochen, Blinzeln über ein Morph-Target, Winken über einen
//      Clip oder den Oberarm-Knochen; Clips laufen über THREE.AnimationMixer.
//
// Beispiel (vor groot.js und dieser Datei setzen):
//   window.MARVEL_GROOT_CONFIG = {
//     model: "gltf",
//     gltf: {
//       // Weg A — fünf Dateien, Reihenfolge wie die Stufen in groot.js
//       stages: [
//         "assets/groot/groot-1-baby.glb",
//         "assets/groot/groot-2-baby-gross.glb",
//         "assets/groot/groot-3-jung.glb",
//         "assets/groot/groot-4-teenager.glb",
//         "assets/groot/groot-5-erwachsen.glb",
//       ],
//       // Weg B — stattdessen eine Datei mit Skelett/Morph-Targets:
//       // url: "assets/groot/groot-rig.glb",
//       // morphs: { growth: [null, "Stufe2", "Stufe3", "Stufe4", "Stufe5", "Stufe5"] },
//       credit: "3D-Modell „…“ von …, Lizenz CC BY 4.0",
//     },
//   };
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  if (!window.MarvelGroot || typeof window.MarvelGroot.registerModel !== "function") {
    if (window.console) console.warn("Groot-GLTF: groot.js muss vor groot-gltf-model.js geladen werden.");
    return;
  }

  // Körperhöhe (Szeneneinheiten, Plattformradius 0,78) je Wachstumspunkt
  // g = 0 … 5 und Kopfanteil an der Höhe — Werte wie beim Platzhalter
  const DEFAULTS = {
    stages: null,
    url: null,
    heights: [0.87, 1.13, 1.45, 1.76, 1.89, 1.96],
    headRatio: [0.48, 0.39, 0.28, 0.2, 0.16, 0.15],
    yaw: 0, // Drehung (rad), falls das Modell nicht nach +z blickt
    fade: 0.6, // Überblenden zwischen Stufenmodellen (Sekunden)
    glow: 0.35, // Stärke des grünen Wachstums-Leuchtens auf den Materialien
    draco: null, // Pfad zu den Draco-Decodern (z.B. "vendor/draco/"), braucht THREE.DRACOLoader
    // Knochen: erster gefundener Name gewinnt. „R“ ist die rechte Seite der
    // Figur — sie liegt bei x < 0, also links im Bild (dort winkt Groot am Desktop).
    bones: {
      head: ["Head", "head", "mixamorig:Head"],
      spine: ["Spine1", "Spine", "spine", "chest", "mixamorig:Spine1"],
      armR: ["UpperArm.R", "upper_arm.R", "RightArm", "mixamorig:RightArm"],
      armL: ["UpperArm.L", "upper_arm.L", "LeftArm", "mixamorig:LeftArm"],
      foreR: ["LowerArm.R", "forearm.R", "RightForeArm", "mixamorig:RightForeArm"],
      foreL: ["LowerArm.L", "forearm.L", "LeftForeArm", "mixamorig:LeftForeArm"],
    },
    // Lokale Achse, um die der Oberarm zum Winken seitlich gehoben wird
    // (rig-abhängig; bei Bedarf eigene pose-Funktion, s.u.)
    armAxis: "z",
    morphs: {
      blink: ["Blink", "blink", "EyesClosed", "eyesClosed", "eyeBlink"],
      // Weg B: Morph-Target je Wachstumspunkt g = 0 … 5 (null = Grundform)
      growth: null,
    },
    clips: { idle: "Idle", wave: "Wave" },
    // Optional: eigene Pose für ein Rig mit anderen Achsen,
    // pose(rig, state, THREE) — rig = { head, spine, arm, fore, setMorph, root }
    pose: null,
    credit: "",
  };

  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }

  // Wert einer Stützstellen-Liste an der Stelle g (0 … growthMax), linear
  function sample(list, g, gMax) {
    if (!list.length) return 1;
    const x = clamp(g / gMax, 0, 1) * (list.length - 1);
    const i = Math.min(Math.floor(x), list.length - 2);
    if (i < 0) return list[0];
    return list[i] + (list[i + 1] - list[i]) * (x - i);
  }

  function options(cfg) {
    const o = Object.assign({}, DEFAULTS, cfg || {});
    o.bones = Object.assign({}, DEFAULTS.bones, (cfg && cfg.bones) || {});
    o.morphs = Object.assign({}, DEFAULTS.morphs, (cfg && cfg.morphs) || {});
    o.clips = Object.assign({}, DEFAULTS.clips, (cfg && cfg.clips) || {});
    return o;
  }

  window.MarvelGroot.registerModel("gltf", function (ctx) {
    const THREE = ctx.THREE;
    const opt = options(ctx.config && ctx.config.gltf);
    if (!THREE.GLTFLoader) {
      return Promise.reject(new Error("THREE.GLTFLoader fehlt (vendor/GLTFLoader.js aus three.js r128 einbinden)"));
    }
    const perStage = Array.isArray(opt.stages) && opt.stages.length > 0;
    if (perStage && opt.stages.length !== ctx.stages.length) {
      return Promise.reject(new Error("gltf.stages braucht genau " + ctx.stages.length + " Dateien (eine pro Stufe)"));
    }
    const urls = perStage ? opt.stages : opt.url ? [opt.url] : null;
    if (!urls) return Promise.reject(new Error("keine Modelldatei konfiguriert (gltf.stages oder gltf.url)"));

    const loader = new THREE.GLTFLoader();
    if (opt.draco && THREE.DRACOLoader && loader.setDRACOLoader) {
      const draco = new THREE.DRACOLoader();
      draco.setDecoderPath(opt.draco);
      loader.setDRACOLoader(draco);
    }
    const load = (url) =>
      new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, (err) => reject(new Error("Laden fehlgeschlagen: " + url + (err && err.message ? " (" + err.message + ")" : ""))));
      });
    return Promise.all(urls.map(load)).then((gltfs) => buildModel(THREE, ctx, opt, gltfs, perStage));
  });

  function buildModel(THREE, ctx, opt, gltfs, perStage) {
    const gMax = ctx.growthMax;
    const root = new THREE.Group();
    root.name = "groot-gltf";
    const turn = new THREE.Group(); // Körperdrehung aus pose()
    root.add(turn);
    const box = new THREE.Box3();
    const glowColor = new THREE.Color(0x3cff6a);
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler(0, 0, 0, "YXZ");
    const _axis = new THREE.Vector3(opt.armAxis === "x" ? 1 : 0, opt.armAxis === "y" ? 1 : 0, opt.armAxis === "z" ? 1 : 0);

    // GLTFLoader entfernt . : / [ ] aus Knotennamen und ersetzt Leerzeichen
    const clean = (n) => (THREE.PropertyBinding ? THREE.PropertyBinding.sanitizeNodeName(n) : n);
    function find(scene, names) {
      const list = [].concat(names || []);
      for (let i = 0; i < list.length; i++) {
        const o = scene.getObjectByName(clean(list[i])) || scene.getObjectByName(list[i]);
        if (o) return o;
      }
      return null;
    }

    function prepare(gltf, index) {
      const scene = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!scene) throw new Error("GLB ohne Szene");
      const holder = new THREE.Group(); // wird auf die Zielhöhe skaliert
      holder.add(scene);
      scene.rotation.y += opt.yaw;
      holder.updateMatrixWorld(true);
      box.setFromObject(scene);
      if (box.isEmpty()) throw new Error("GLB ohne Geometrie");
      // Fußpunkt auf y = 0, mittig über der Plattform
      const c = box.getCenter(new THREE.Vector3());
      scene.position.x -= c.x;
      scene.position.z -= c.z;
      scene.position.y -= box.min.y;
      const baseH = Math.max(1e-4, box.max.y - box.min.y);

      const mats = [];
      const morphMeshes = [];
      scene.traverse((o) => {
        if (!o.isMesh) return;
        // Skinning verschiebt Ecken außerhalb der Bounding-Sphere
        if (o.isSkinnedMesh) o.frustumCulled = false;
        if (o.morphTargetDictionary) morphMeshes.push(o);
        [].concat(o.material).forEach((m) => {
          if (!m || mats.some((e) => e.m === m)) return;
          mats.push({ m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, emissive: m.emissive ? m.emissive.clone() : null });
        });
      });

      // Knochen + Ruhelage; von Clips animierte Knochen starten jeden Frame
      // von der Clip-Pose, alle anderen von der Ruhelage
      const animated = new Set();
      (gltf.animations || []).forEach((clip) => clip.tracks.forEach((t) => animated.add(t.name.split(".")[0])));
      const bone = (names) => {
        const b = find(scene, names);
        if (b) b.userData.grootRest = { q: b.quaternion.clone(), s: b.scale.clone(), animated: animated.has(b.name) };
        return b;
      };
      const rig = {
        root: scene,
        head: bone(opt.bones.head),
        spine: bone(opt.bones.spine),
        arm: { "-1": bone(opt.bones.armR), 1: bone(opt.bones.armL) },
        fore: { "-1": bone(opt.bones.foreR), 1: bone(opt.bones.foreL) },
        setMorph(names, v) {
          [].concat(names || []).forEach((n) => {
            morphMeshes.forEach((m) => {
              const i = m.morphTargetDictionary[n];
              if (i !== undefined) m.morphTargetInfluences[i] = v;
            });
          });
        },
      };

      let mixer = null;
      let idle = null;
      let wave = null;
      if (gltf.animations && gltf.animations.length && THREE.AnimationMixer) {
        mixer = new THREE.AnimationMixer(scene);
        const clip = (name) => THREE.AnimationClip.findByName(gltf.animations, name);
        if (opt.clips.idle && clip(opt.clips.idle)) {
          idle = mixer.clipAction(clip(opt.clips.idle));
          idle.play();
        }
        if (opt.clips.wave && clip(opt.clips.wave)) {
          wave = mixer.clipAction(clip(opt.clips.wave));
          wave.setEffectiveWeight(0);
          wave.play();
        }
      }
      turn.add(holder);
      return { scene, holder, baseH, mats, rig, mixer, idle, wave, weight: index === 0 ? 1 : 0, faded: false };
    }

    const parts = gltfs.map(prepare);
    let growth = 0;
    let target = 0;
    let placed = false;

    // Überblenden über die Deckkraft (nur während des Wechsels transparent)
    function applyWeight(p) {
      p.holder.visible = p.weight > 0.002;
      const fading = p.weight < 0.999 && p.holder.visible;
      if (fading === p.faded && !fading) return;
      p.mats.forEach((e) => {
        const m = e.m;
        if (m.transparent !== (fading || e.transparent)) {
          m.transparent = fading || e.transparent;
          m.needsUpdate = true;
        }
        m.opacity = e.opacity * (fading ? p.weight : 1);
        m.depthWrite = fading ? p.weight > 0.5 : e.depthWrite;
      });
      p.faded = fading;
    }

    function rotate(b, x, y, z) {
      if (!b) return;
      const rest = b.userData.grootRest;
      if (!rest.animated) b.quaternion.copy(rest.q);
      b.quaternion.multiply(_q.setFromEuler(_e.set(x, y, z, "YXZ")));
    }

    function poseRig(p, s, dt) {
      if (p.mixer) {
        if (p.wave) p.wave.setEffectiveWeight(s.wave);
        if (p.idle) p.idle.setEffectiveWeight(1 - s.wave * (p.wave ? 1 : 0));
        p.mixer.timeScale = s.reduceMotion ? 0 : 1;
        p.mixer.update(dt);
      }
      const r = p.rig;
      if (typeof opt.pose === "function") {
        opt.pose(r, s, THREE);
        return;
      }
      rotate(r.head, s.pitch, s.yaw, s.roll);
      if (r.spine) {
        const rest = r.spine.userData.grootRest;
        r.spine.scale.set(rest.s.x * (1 + s.breath * 0.8), rest.s.y * (1 + s.breath), rest.s.z * (1 + s.breath * 0.8));
      }
      r.setMorph(opt.morphs.blink, s.blink);
      // Winken ohne Clip: Oberarm seitlich heben, Unterarm schwingen lassen
      if (!p.wave) {
        [-1, 1].forEach((side) => {
          const k = side === s.waveSide ? s.wave : 0;
          const arm = r.arm[side];
          if (arm) {
            const rest = arm.userData.grootRest;
            if (!rest.animated) arm.quaternion.copy(rest.q);
            arm.quaternion.multiply(_q.setFromAxisAngle(_axis, -side * 2.2 * k));
          }
          const fore = r.fore[side];
          if (fore) {
            const rest = fore.userData.grootRest;
            if (!rest.animated) fore.quaternion.copy(rest.q);
            fore.quaternion.multiply(_q.setFromAxisAngle(_axis, -side * (0.5 + Math.sin(s.waveTime * 13) * 0.4) * k));
          }
        });
      }
    }

    const height = () => sample(opt.heights, growth, gMax);
    const active = () => parts[perStage ? target : 0];

    function bounds(b) {
      root.updateMatrixWorld(true);
      return b.setFromObject(active().holder);
    }

    return {
      object: root,
      credit: opt.credit || "",
      setGrowth(g) {
        growth = g;
        const H = height();
        parts.forEach((p) => p.holder.scale.setScalar(H / p.baseH));
        if (perStage) {
          target = clamp(Math.floor(g + 1e-6), 0, parts.length - 1);
          if (!placed) parts.forEach((p, i) => (p.weight = i === target ? 1 : 0));
          parts.forEach(applyWeight);
        } else if (Array.isArray(opt.morphs.growth)) {
          // Proportionen über Morph-Targets je Wachstumspunkt überblenden
          const list = opt.morphs.growth;
          const x = clamp(g / gMax, 0, 1) * (list.length - 1);
          const i = Math.min(Math.floor(x), list.length - 2);
          const t = x - i;
          const w = {};
          list.forEach((name) => name && (w[name] = 0));
          if (list[i]) w[list[i]] += 1 - t;
          if (list[i + 1]) w[list[i + 1]] += t;
          Object.keys(w).forEach((name) => parts[0].rig.setMorph(name, w[name]));
        }
        placed = true;
      },
      height,
      head() {
        const H = height();
        const size = H * sample(opt.headRatio, growth, gMax);
        const h = active().rig.head;
        if (!h) return { y: H - size * 0.5, size };
        root.updateMatrixWorld(true);
        return { y: h.getWorldPosition(new THREE.Vector3()).y + size * 0.5, size };
      },
      headTop(v) {
        const h = active().rig.head;
        if (h) {
          root.updateMatrixWorld(true);
          h.getWorldPosition(v);
          v.y += height() * sample(opt.headRatio, growth, gMax) * 1.05;
          return v;
        }
        bounds(box);
        return v.set((box.min.x + box.max.x) / 2, box.max.y + 0.03, (box.min.z + box.max.z) / 2);
      },
      bounds,
      pose(s, dt) {
        turn.rotation.y = s.bodyYaw;
        if (perStage) {
          const k = s.reduceMotion || opt.fade <= 0 ? 1 : dt / opt.fade;
          parts.forEach((p, i) => {
            const goal = i === target ? 1 : 0;
            p.weight = p.weight < goal ? Math.min(goal, p.weight + k) : Math.max(goal, p.weight - k);
            applyWeight(p);
          });
        }
        parts.forEach((p) => {
          if (p.holder.visible) poseRig(p, s, dt);
        });
      },
      setGlow(v) {
        parts.forEach((p) =>
          p.mats.forEach((e) => {
            if (e.emissive) e.m.emissive.copy(glowColor).multiplyScalar(v * opt.glow).add(e.emissive);
          })
        );
      },
      emitters() {
        const H = height();
        return { radius: H * 0.18, y0: H * 0.25, y1: H * 1.05 };
      },
      triangles() {
        let n = 0;
        root.traverseVisible((o) => {
          if (!o.isMesh) return;
          const g = o.geometry;
          n += (g.index ? g.index.count : g.attributes.position.count) / 3;
        });
        return Math.round(n);
      },
      dispose() {
        parts.forEach((p) => p.mixer && p.mixer.stopAllAction());
        root.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          [].concat(o.material || []).forEach((m) => {
            Object.keys(m).forEach((k) => m[k] && m[k].isTexture && m[k].dispose());
            m.dispose();
          });
        });
        if (root.parent) root.parent.remove(root);
      },
    };
  }
})();
