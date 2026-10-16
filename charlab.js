// ---------------------------------------------------------------------------
// J.A.R.V.I.S. Character Lab — interaktive 3D-Analyse einzelner Figuren
//
// Eigenständiges Modul mit eigenem Renderer und eigener Szene. Beides entsteht
// erst beim Öffnen des Labs und wird beim Schließen vollständig freigegeben
// (Geometrien, Materialien, Texturen, Schattenkarten, WebGL-Kontext). Die
// Planeten-Szene aus script.js bleibt unverändert; sie pausiert nur, solange
// das Lab offen ist ("charlab-overlay" steht in BLOCKING_OVERLAY_IDS).
//
// Modelle kommen aus einer Registry (registerModel). Mitgeliefert ist ein
// stilisierter, prozedural in Three.js gebauter Platzhalter für Steve Rogers /
// Captain America — KEIN lizenziertes Originalmodell. Ein späteres GLB/GLTF-
// Modell lässt sich über charlab-gltf-model.js einhängen (CHARACTER-LAB.md).
//
// Alle angezeigten Power-Stats stammen aus MarvelDerive.statsFor (dieselben
// Werte wie im Charakterprofil) — das Lab erfindet keine eigenen Zahlen.
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  if (typeof THREE === "undefined") return;

  const HUD = () => window.MarvelHUD || null;
  const qualityParam = new URLSearchParams(window.location.search).get("quality");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  function lowTier() {
    return qualityParam ? qualityParam === "low" : coarsePointer || window.innerWidth < 900;
  }

  // Farben werden im sRGB-Raum angegeben; der Renderer arbeitet linear.
  function lin(hex) {
    return new THREE.Color(hex).convertSRGBToLinear();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ---------- Analyse-Inhalte je Figur ----------
  // Unabhängig vom 3D-Modell: ein späteres GLB-Modell mit derselben id nutzt
  // dieselben Analysepunkte. Zahlenwerte kommen ausschließlich aus statsFor.
  const SUBJECTS = {
    "steve-rogers": {
      overview: { rX: 0.66, rY: 1.0, dir: [-0.36, 0.16, 1] },
      hotspots: [
        {
          id: "schild",
          label: "SCHILD",
          title: "Vibranium-Schild",
          dir: [0.55, 0.16, 0.82],
          r: [0.42, 0.42],
          facts: [
            ["MATERIAL", "Vibranium – das seltenste Metall der Erde, es stammt aus Wakanda."],
            ["SCHUTZ", "Nimmt Stöße und Erschütterungen nahezu vollständig auf und schützt so vor Schlägen, Kugeln und Explosionen."],
            ["GESCHICHTE", "Howard Stark fertigte den runden Schild im Zweiten Weltkrieg für Steve Rogers an."],
            ["EINSATZ", "Deckung im Nahkampf und Wurfwaffe, die von Wänden und Gegnern abprallt."],
          ],
          powers: /schild|vibranium/i,
          stats: ["kampf"],
          log: "Vibranium-Signatur erkannt · Schild wird analysiert",
        },
        {
          id: "anzug",
          label: "ANZUG",
          title: "Kampfanzug & Ausrüstung",
          dir: [-0.22, 0.1, 1],
          r: [0.34, 0.42],
          facts: [
            ["AUSRÜSTUNG", "Anzug in Rot, Weiß und Blau mit Stern auf der Brust, Helm mit „A“, Handschuhe und Einsatzgürtel."],
            ["KAMPFSCHUTZ", "Verstärkte Partien an Brust, Schultern und Knien schützen im Nahkampf, ohne die Beweglichkeit einzuschränken."],
            ["ENTWICKLUNG", "Das Design wandelt sich über die Filme – von der Uniform im Zweiten Weltkrieg bis zum Anzug in „Avengers: Endgame“."],
          ],
          powers: /taktisch/i,
          stats: ["kampf", "technologie"],
          log: "Ausrüstung wird erfasst · Anzugstruktur intakt",
        },
        {
          id: "koerper",
          label: "KÖRPER",
          title: "Supersoldaten-Serum",
          dir: [-0.82, 0.18, 0.62],
          r: [0.42, 0.52],
          facts: [
            ["URSPRUNG", "Dr. Abraham Erskines Supersoldaten-Serum verwandelte den schmächtigen Rekruten im Zweiten Weltkrieg."],
            ["WIRKUNG", "Kraft, Schnelligkeit, Ausdauer und Heilung am Maximum menschlicher Möglichkeiten."],
            ["FÄHIGKEITEN", "Überragender Nahkämpfer und taktischer Anführer der Avengers."],
          ],
          bio: true,
          powers: /serum|kraft|ausdauer|taktisch/i,
          stats: ["staerke", "geschwindigkeit", "ausdauer"],
          log: "Biometrie wird gemessen · Serum-Werte stabil",
        },
      ],
    },
  };

  // ---------- Modell-Registry ----------
  // Ein Modell liefert nur Geometrie und Ankerpunkte; Texte kommen aus SUBJECTS.
  // build(ctx) gibt (auch als Promise) zurück:
  //   { root, spots: { <hotspotId>: { marker: Object3D, focus?: Object3D, normal?: Vector3 } },
  //     center?: Vector3, top?: number, update?(t, dt), dispose?() }
  // Meshes können userData.spot = <hotspotId> tragen (Klick-Zuordnung).
  const models = [];

  function registerModel(def) {
    if (!def || !def.id || typeof def.match !== "function" || typeof def.build !== "function") {
      throw new Error("CharacterLab: Modell braucht id, match() und build()");
    }
    const i = models.findIndex((m) => m.id === def.id && m.kind === def.kind);
    if (i !== -1) models.splice(i, 1);
    // Spätere Registrierungen (z.B. ein GLB-Modell) haben Vorrang vor dem Platzhalter.
    models.unshift(def);
  }

  function modelsFor(c, u) {
    return models.filter((m) => {
      try {
        return !!m.match(c, u);
      } catch (e) {
        return false;
      }
    });
  }

  // ---------- Prozedurale Hilfen ----------
  const DOWN = new THREE.Vector3(0, -1, 0);

  function lathe(points, segs, phiStart) {
    return new THREE.LatheGeometry(
      points.map((p) => new THREE.Vector2(p[0], p[1])),
      segs,
      phiStart || 0,
      Math.PI * 2
    );
  }

  // Gliedmaße entlang -y (oben = Gelenk): r0 oben, r1 unten, Muskelwölbung bei "at".
  function limbGeo(len, r0, r1, bulge, at, segs) {
    const pts = [];
    const N = 18;
    for (let i = 0; i <= N; i++) {
      const t = i / N; // 0 = unten
      const s = 1 - t; // 0 = oberes Gelenk
      let r = r0 + (r1 - r0) * s + bulge * Math.exp(-Math.pow((s - at) / 0.24, 2));
      const edge = Math.min(t, 1 - t);
      if (edge < 0.07) r *= 0.78 + 0.22 * (edge / 0.07);
      pts.push([Math.max(0.002, r), -len * s]);
    }
    pts.unshift([0.002, -len]);
    pts.push([0.002, 0]);
    return lathe(pts, segs);
  }

  // Zwei-Knochen-IK: Ellbogen/Knie aus Schulter, Ziel, Längen und Richtungshinweis.
  function solveJoint(a, target, l1, l2, pole) {
    const ab = target.clone().sub(a);
    const d = clamp(ab.length(), 0.05, l1 + l2 - 1e-4);
    ab.normalize();
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const perp = pole.clone().sub(ab.clone().multiplyScalar(pole.dot(ab))).normalize();
    return a.clone().add(ab.multiplyScalar(l1 * cosA)).add(perp.multiplyScalar(l1 * sinA));
  }

  function canvasTex(w, h, draw, srgb) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // Fünfzackiger Stern (Spitze oben) als Pfad
  function starPath(ctx, cx, cy, ro, ri) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? ri : ro;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  function starShape(ro, ri) {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? ri : ro;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i) s.lineTo(x, y);
      else s.moveTo(x, y);
    }
    s.closePath();
    return s;
  }

  // Feines Stoffmuster als Bump-Map (Waben-Struktur wie bei Kampfanzügen)
  function fabricBump(cw, ch, cell) {
    return canvasTex(cw || 256, ch || 256, (g, w, h) => {
      g.fillStyle = "#808080";
      g.fillRect(0, 0, w, h);
      const s = cell || 16;
      g.strokeStyle = "rgba(60,60,60,0.5)";
      g.lineWidth = 1.5;
      for (let y = 0; y < h + s; y += s * 0.866) {
        const row = Math.round(y / (s * 0.866));
        for (let x = 0; x < w + s; x += s) {
          const ox = row % 2 ? s / 2 : 0;
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k + Math.PI / 6;
            const px = x + ox + Math.cos(a) * s * 0.5;
            const py = y + Math.sin(a) * s * 0.5;
            if (k) g.lineTo(px, py);
            else g.moveTo(px, py);
          }
          g.closePath();
          g.stroke();
        }
      }
    });
  }

  // ---------- Platzhalter: Steve Rogers / Captain America ----------
  // Stilisierte, prozedurale Figur (ca. 1,87 m, Füße auf y = 0, Blick nach +z).
  // Wiedererkennbar über Farben, Stern, Streifen, Helm mit „A“ und den runden Schild.
  function buildCaptainAmerica(ctx) {
    const low = ctx.low;
    const SEG = low ? 20 : 32;
    const root = new THREE.Group();
    root.name = "CaptainAmericaPlaceholder";
    const aniso = ctx.anisotropy;

    // Rumpf: eigenes, feines Muster (die UV-Wiederholung folgt bei three.js r128
    // der Farbtextur, daher keine repeat-Werte auf der Bump-Map des Rumpfs).
    const bump = fabricBump(1024, 720, 11);
    const limbBump = fabricBump(256, 256, 16);
    limbBump.wrapS = limbBump.wrapT = THREE.RepeatWrapping;
    limbBump.repeat.set(3, 6);

    // Rumpf-Textur: Navy-Grundton, Brustplatte, rot-weiße Bauchstreifen, Nähte.
    // Lathe mit phiStart = PI: Naht hinten, Vorderseite bei u = 0.5.
    const Y0 = 0.84;
    const Y1 = 1.605;
    const torsoTex = canvasTex(
      1024,
      1024,
      (g, w, h) => {
        const yy = (y) => (1 - (y - Y0) / (Y1 - Y0)) * h;
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "#22385f");
        grad.addColorStop(1, "#1b2d4f");
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        // Seitenpaneele (dunkler) von der Hüfte bis unter die Achsel
        g.fillStyle = "#15243f";
        [0.25, 0.75].forEach((u) => g.fillRect((u - 0.045) * w, yy(1.38), 0.09 * w, yy(0.98) - yy(1.38)));
        // Brustplatte etwas heller, mit abgerundeten Ecken
        g.fillStyle = "#29457a";
        const bx = 0.355 * w;
        const bw = 0.29 * w;
        const by = yy(1.47);
        const bh = yy(1.235) - by;
        g.beginPath();
        g.moveTo(bx + 20, by);
        g.lineTo(bx + bw - 20, by);
        g.quadraticCurveTo(bx + bw, by, bx + bw, by + 20);
        g.lineTo(bx + bw - 14, by + bh);
        g.lineTo(bx + 14, by + bh);
        g.lineTo(bx, by + 20);
        g.quadraticCurveTo(bx, by, bx + 20, by);
        g.fill();
        // Rot-weiße Streifen über dem Bauch bis zum Gürtel
        const sx0 = 0.432 * w;
        const sw = (0.136 * w) / 5;
        for (let i = 0; i < 5; i++) {
          g.fillStyle = i % 2 ? "#e6e7ec" : "#b3202a";
          g.fillRect(sx0 + i * sw, yy(1.235), sw + 0.5, yy(0.995) - yy(1.235));
        }
        // Nähte
        g.strokeStyle = "rgba(8,14,28,0.85)";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(bx, by + 20);
        g.lineTo(bx + 14, by + bh);
        g.lineTo(bx + bw - 14, by + bh);
        g.lineTo(bx + bw, by + 20);
        g.stroke();
        [0.205, 0.295, 0.705, 0.795].forEach((u) => {
          g.beginPath();
          g.moveTo(u * w, yy(1.4));
          g.lineTo(u * w, yy(0.98));
          g.stroke();
        });
        g.beginPath();
        g.moveTo(0, yy(1.47));
        g.lineTo(w, yy(1.47));
        g.stroke();
        g.strokeStyle = "rgba(255,255,255,0.08)";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(bx + 4, by + 22);
        g.lineTo(bx + bw - 4, by + 22);
        g.stroke();
        // Rückenmittelnaht (bei u = 0 / 1)
        g.strokeStyle = "rgba(8,14,28,0.7)";
        g.lineWidth = 3;
        [2, w - 2].forEach((x) => {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, h);
          g.stroke();
        });
      },
      true
    );
    torsoTex.anisotropy = aniso;

    const M = {
      torso: new THREE.MeshStandardMaterial({ map: torsoTex, roughness: 0.56, metalness: 0.12, bumpMap: bump, bumpScale: 0.02 }),
      suit: new THREE.MeshStandardMaterial({ color: lin(0x1f3459), roughness: 0.58, metalness: 0.1, bumpMap: limbBump, bumpScale: 0.016 }),
      pants: new THREE.MeshStandardMaterial({ color: lin(0x18284a), roughness: 0.64, metalness: 0.08, bumpMap: limbBump, bumpScale: 0.014 }),
      pad: new THREE.MeshStandardMaterial({ color: lin(0x111c33), roughness: 0.45, metalness: 0.35 }),
      leather: new THREE.MeshStandardMaterial({ color: lin(0x5e3620), roughness: 0.55, metalness: 0.05 }),
      darkLeather: new THREE.MeshStandardMaterial({ color: lin(0x3a2416), roughness: 0.6, metalness: 0.05 }),
      helmet: new THREE.MeshStandardMaterial({ color: lin(0x26427c), roughness: 0.3, metalness: 0.45 }),
      white: new THREE.MeshStandardMaterial({ color: lin(0xeef0f4), roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }),
      silver: new THREE.MeshStandardMaterial({ color: lin(0xc9ced8), roughness: 0.22, metalness: 1 }),
      skin: new THREE.MeshStandardMaterial({ color: lin(0xc98f6e), roughness: 0.62, metalness: 0 }),
      eye: new THREE.MeshStandardMaterial({ color: lin(0x22303e), roughness: 0.15, metalness: 0 }),
    };

    function mesh(geo, mat, spot, parent) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.spot = spot;
      (parent || root).add(m);
      return m;
    }

    // --- Rumpf (elliptischer Querschnitt, ausgeprägte Brust) ---
    const torsoGeo = lathe(
      [
        [0.002, 0.84], [0.12, 0.845], [0.155, 0.87], [0.172, 0.92], [0.176, 0.97], [0.168, 1.02],
        [0.155, 1.07], [0.154, 1.11], [0.166, 1.17], [0.186, 1.23], [0.204, 1.29], [0.214, 1.35],
        [0.216, 1.4], [0.209, 1.445], [0.187, 1.485], [0.145, 1.515], [0.097, 1.535], [0.07, 1.56],
        [0.064, 1.6], [0.002, 1.605],
      ],
      low ? 28 : 48,
      Math.PI
    );
    {
      const pos = torsoGeo.attributes.position;
      const uv = torsoGeo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        let z = pos.getZ(i) * 0.66;
        if (z > 0) {
          // Brustmuskeln nach vorn, Bauch flacher
          const chest = Math.exp(-Math.pow((y - 1.36) / 0.085, 2));
          const pec = Math.exp(-Math.pow((Math.abs(x) - 0.085) / 0.07, 2));
          z *= 1 + 0.16 * chest + 0.06 * chest * pec;
        } else {
          z *= 0.94; // Rücken etwas flacher
        }
        pos.setZ(i, z);
        uv.setY(i, (y - Y0) / (Y1 - Y0));
      }
      torsoGeo.computeVertexNormals();
    }
    mesh(torsoGeo, M.torso, "anzug");

    // Stern auf der Brust (silbern, leicht erhaben)
    const starGeo = new THREE.ExtrudeGeometry(starShape(0.07, 0.028), {
      depth: 0.008,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 2,
      curveSegments: 1,
    });
    const star = mesh(starGeo, M.silver, "anzug");
    star.position.set(0, 1.36, 0.16);
    star.rotation.x = -0.12;

    // Gürtel mit Schnalle und Taschen
    const belt = mesh(
      lathe([[0.166, 0.968], [0.176, 0.972], [0.179, 0.995], [0.176, 1.024], [0.165, 1.028]], low ? 28 : 48),
      M.leather,
      "anzug"
    );
    belt.scale.z = 0.68;
    const buckle = mesh(new THREE.BoxGeometry(0.06, 0.045, 0.014), M.silver, "anzug");
    buckle.position.set(0, 0.997, 0.123);
    [-1.05, -1.65, 1.05, 1.65].forEach((a) => {
      const p = mesh(new THREE.BoxGeometry(0.048, 0.05, 0.03), M.darkLeather, "anzug");
      p.position.set(Math.sin(a) * 0.184, 0.99, Math.cos(a) * 0.184 * 0.68);
      p.rotation.y = a;
    });

    // Hals
    mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.1, SEG), M.skin, "koerper").position.set(0, 1.612, 0.005);
    const collar = mesh(new THREE.CylinderGeometry(0.066, 0.07, 0.04, SEG, 1, true), M.suit, "anzug");
    collar.position.set(0, 1.585, 0);

    // --- Kopf mit Helm ---
    const head = new THREE.Group();
    head.position.set(0, 1.726, 0.012);
    head.scale.setScalar(0.95);
    root.add(head);
    const skullGeo = new THREE.SphereGeometry(0.11, low ? 24 : 40, low ? 18 : 30);
    {
      const pos = skullGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i) * 0.92;
        let y = pos.getY(i) * 1.12;
        let z = pos.getZ(i);
        if (y < -0.015) {
          // kantigeres Kinn, schmaler Kiefer
          const k = (-y - 0.015) / 0.11;
          x *= 1 - 0.2 * k;
          if (z > 0) z += 0.012 * k;
        }
        pos.setXYZ(i, x, y, z);
      }
      skullGeo.computeVertexNormals();
    }
    mesh(skullGeo, M.skin, "koerper", head);
    // Nase, Augen, Mund
    const nose = mesh(new THREE.SphereGeometry(1, 16, 12), M.skin, "koerper", head);
    nose.scale.set(0.014, 0.026, 0.016);
    nose.position.set(0, -0.018, 0.108);
    nose.rotation.x = 0.25;
    [-1, 1].forEach((s) => {
      const e = mesh(new THREE.SphereGeometry(0.0105, 12, 10), M.eye, "koerper", head);
      e.position.set(s * 0.034, 0.006, 0.096);
    });
    const mouth = mesh(new THREE.SphereGeometry(1, 12, 8), M.eye, "koerper", head);
    mouth.scale.set(0.02, 0.0028, 0.006);
    mouth.position.set(0, -0.056, 0.1);

    // Helm: Kappe bis knapp über die Augen, Seitenteile mit Gesichtsöffnung
    const HR = 0.118;
    const cap = mesh(new THREE.SphereGeometry(HR, low ? 28 : 44, 16, 0, Math.PI * 2, 0, Math.PI * 0.446), M.helmet, "anzug", head);
    cap.scale.set(0.94, 1.12, 1.03);
    const gap = 0.86;
    const sides = mesh(
      new THREE.SphereGeometry(HR, low ? 24 : 40, 10, Math.PI / 2 + gap, Math.PI * 2 - gap * 2, Math.PI * 0.44, Math.PI * 0.27),
      M.helmet,
      "anzug",
      head
    );
    sides.scale.set(0.94, 1.12, 1.03);
    // „A“ auf der Stirn
    const aShape = new THREE.Shape();
    aShape.moveTo(-0.024, -0.024);
    aShape.lineTo(-0.012, -0.024);
    aShape.lineTo(-0.008, -0.012);
    aShape.lineTo(0.008, -0.012);
    aShape.lineTo(0.012, -0.024);
    aShape.lineTo(0.024, -0.024);
    aShape.lineTo(0.006, 0.024);
    aShape.lineTo(-0.006, 0.024);
    aShape.closePath();
    const aHole = new THREE.Path();
    aHole.moveTo(-0.0045, -0.003);
    aHole.lineTo(0.0045, -0.003);
    aHole.lineTo(0, 0.01);
    aHole.closePath();
    aShape.holes.push(aHole);
    const letterA = mesh(new THREE.ExtrudeGeometry(aShape, { depth: 0.003, bevelEnabled: false }), M.white, "anzug", head);
    letterA.position.set(0, 0.066, 0.104);
    letterA.rotation.x = -0.5;
    // Flügel an den Seiten
    const wing = new THREE.Shape();
    wing.moveTo(0, 0);
    wing.lineTo(0.046, 0.01);
    wing.lineTo(0.05, 0.02);
    wing.lineTo(0.034, 0.019);
    wing.lineTo(0.04, 0.03);
    wing.lineTo(0.024, 0.027);
    wing.lineTo(0.027, 0.037);
    wing.lineTo(0.002, 0.022);
    wing.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 0.003, bevelEnabled: false });
    [-1, 1].forEach((s) => {
      const wm = mesh(wingGeo, M.white, "anzug", head);
      wm.position.set(s * 0.112, 0.004, 0.022);
      wm.rotation.y = s * (Math.PI / 2);
      if (s < 0) wm.scale.x = -1;
      wm.rotation.z = 0.12;
    });

    // --- Arme und Beine (IK für eine natürliche, leicht angewinkelte Haltung) ---
    const parts = {};
    function joint(p, r, mat, spot) {
      const j = mesh(new THREE.SphereGeometry(r, SEG, Math.round(SEG * 0.7)), mat, spot);
      j.position.copy(p);
      return j;
    }
    function limb(a, b, r0, r1, bulge, at, mat, spot) {
      const len = a.distanceTo(b);
      const m = mesh(limbGeo(len, r0, r1, bulge, at, SEG), mat, spot);
      m.position.copy(a);
      m.quaternion.setFromUnitVectors(DOWN, b.clone().sub(a).normalize());
      return m;
    }
    function sleeve(a, b, from, to, r0, r1, mat, spot) {
      // Teilstück zwischen den Anteilen from..to der Strecke a→b (Handschuh, Stiefelschaft)
      const p0 = a.clone().lerp(b, from);
      const p1 = a.clone().lerp(b, to);
      const len = p0.distanceTo(p1);
      const geo = lathe(
        [[0.002, -len], [r1 * 0.9, -len], [r1, -len * 0.96], [r0 * 0.98, -len * 0.08], [r0 * 1.06, -len * 0.02], [r0, 0], [0.002, 0]],
        SEG
      );
      const m = mesh(geo, mat, spot);
      m.position.copy(p0);
      m.quaternion.setFromUnitVectors(DOWN, p1.clone().sub(p0).normalize());
      return m;
    }

    // Faust: Quader, dessen Ecken zur Kugel hin abgerundet werden
    const fistGeo = new THREE.BoxGeometry(1, 1, 1, 5, 5, 5);
    {
      const pos = fistGeo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const sph = v.clone().normalize().multiplyScalar(0.62);
        v.lerp(sph, 0.45);
        pos.setXYZ(i, v.x * 0.082, v.y * 0.1, v.z * 0.07);
      }
      fistGeo.computeVertexNormals();
    }

    const UPPER = 0.29;
    const FORE = 0.27;
    function arm(side, wrist, pole, spotUpper) {
      const S = new THREE.Vector3(side * 0.222, 1.425, 0);
      const E = solveJoint(S, wrist, UPPER, FORE, pole);
      const W = E.clone().add(wrist.clone().sub(E).normalize().multiplyScalar(FORE));
      const d = joint(S, 0.078, M.suit, "anzug");
      d.scale.set(1.06, 1.04, 0.94);
      limb(S, E, 0.068, 0.052, 0.015, 0.36, M.suit, spotUpper);
      joint(E, 0.053, M.suit, "koerper");
      limb(E, W, 0.056, 0.04, 0.01, 0.25, M.suit, "koerper");
      sleeve(E, W, 0.5, 1.02, 0.06, 0.045, M.leather, "anzug");
      const dir = W.clone().sub(E).normalize();
      const fist = mesh(fistGeo, M.leather, "koerper");
      fist.position.copy(W).add(dir.clone().multiplyScalar(0.048));
      fist.quaternion.setFromUnitVectors(DOWN, dir);
      const thumb = mesh(new THREE.SphereGeometry(1, 12, 10), M.leather, "koerper", fist);
      thumb.scale.set(0.014, 0.03, 0.014);
      thumb.position.set(0, -0.004, 0.034);
      thumb.rotation.x = 0.5;
      return { S, E, W, dir };
    }
    parts.right = arm(-1, new THREE.Vector3(-0.3, 0.88, 0.04), new THREE.Vector3(-0.6, 0, -1), "koerper");
    parts.left = arm(1, new THREE.Vector3(0.385, 0.975, 0.075), new THREE.Vector3(1, -0.1, -0.7), "koerper");

    const THIGH = 0.43;
    const SHIN = 0.42;
    [-1, 1].forEach((side) => {
      const H = new THREE.Vector3(side * 0.092, 0.93, 0);
      const A = new THREE.Vector3(side * 0.128, 0.085, -0.012);
      const K = solveJoint(H, A, THIGH, SHIN, new THREE.Vector3(side * 0.15, 0, 1));
      const A2 = K.clone().add(A.clone().sub(K).normalize().multiplyScalar(SHIN));
      limb(H, K, 0.095, 0.062, 0.011, 0.3, M.pants, "koerper");
      joint(K, 0.058, M.pants, "koerper");
      const pad = mesh(new THREE.SphereGeometry(1, SEG, 14), M.pad, "anzug");
      pad.position.copy(K).add(new THREE.Vector3(0, 0.01, 0.05));
      pad.scale.set(0.044, 0.052, 0.024);
      limb(K, A2, 0.058, 0.04, 0.014, 0.3, M.pants, "koerper");
      sleeve(K, A2, 0.42, 1.0, 0.062, 0.05, M.darkLeather, "anzug");
      const foot = mesh(new THREE.SphereGeometry(1, 20, 14), M.darkLeather, "anzug");
      foot.scale.set(0.05, 0.042, 0.125);
      foot.position.set(A2.x, 0.04, A2.z + 0.045);
      const sole = mesh(new THREE.BoxGeometry(0.1, 0.014, 0.25), M.pad, "anzug");
      sole.position.set(A2.x, 0.007, A2.z + 0.045);
    });

    // --- Schild am linken Unterarm ---
    const L = parts.left;
    const fore = L.W.clone().sub(L.E).normalize();
    const want = new THREE.Vector3(0.7, 0.04, 0.72);
    const n = want.sub(fore.clone().multiplyScalar(want.dot(fore))).normalize();
    const xAxis = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    const yAxis = n.clone().cross(xAxis).normalize();
    const shield = new THREE.Group();
    shield.name = "Schild";
    shield.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, n));
    shield.position.copy(L.W.clone().multiplyScalar(0.72).add(L.E.clone().multiplyScalar(0.28))).add(n.clone().multiplyScalar(0.062));
    root.add(shield);

    const R = 0.36;
    const DOME = 0.045;
    const shieldTex = canvasTex(
      1024,
      1024,
      (g, w, h) => {
        const cx = w / 2;
        const cy = h / 2;
        const rr = w / 2;
        const ring = (f, color) => {
          g.fillStyle = color;
          g.beginPath();
          g.arc(cx, cy, rr * f, 0, Math.PI * 2);
          g.fill();
        };
        ring(1, "#a3111b");
        ring(0.8, "#e8e9ee");
        ring(0.6, "#a3111b");
        ring(0.4, "#1d3f8f");
        g.fillStyle = "#eef0f5";
        starPath(g, cx, cy + rr * 0.02, rr * 0.36, rr * 0.142);
        g.fill();
        // leichte Gebrauchsspuren und Glanzverlauf
        for (let i = 0; i < 900; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * rr;
          g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
          g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + Math.random() * 6, 1);
        }
        const sheen = g.createRadialGradient(cx - rr * 0.3, cy - rr * 0.35, rr * 0.05, cx, cy, rr);
        sheen.addColorStop(0, "rgba(255,255,255,0.10)");
        sheen.addColorStop(1, "rgba(0,0,0,0.10)");
        g.fillStyle = sheen;
        g.fillRect(0, 0, w, h);
      },
      true
    );
    shieldTex.anisotropy = aniso;
    const shieldRough = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = "#5a5a5a";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.18})`;
        g.lineWidth = 0.6 + Math.random();
        const x = Math.random() * w;
        const y = Math.random() * h;
        const a = Math.random() * Math.PI;
        const l = 6 + Math.random() * 40;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
    });
    const dishGeo = new THREE.RingGeometry(0.0005, R, low ? 64 : 112, low ? 10 : 18);
    {
      const pos = dishGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i)) / R;
        pos.setZ(i, DOME * (1 - r * r));
      }
      dishGeo.computeVertexNormals();
    }
    const front = new THREE.MeshPhysicalMaterial({
      map: shieldTex,
      roughnessMap: shieldRough,
      roughness: 0.42,
      metalness: 0.45,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
    });
    const back = new THREE.MeshStandardMaterial({ color: lin(0x8d95a3), roughness: 0.38, metalness: 1, side: THREE.BackSide });
    mesh(dishGeo, front, "schild", shield);
    const backMesh = mesh(dishGeo, back, "schild", shield);
    backMesh.position.z = -0.006;
    const rim = mesh(new THREE.TorusGeometry(R, 0.011, 10, low ? 64 : 112), M.silver, "schild", shield);
    rim.position.z = -0.003;
    [0.8, 0.6, 0.4].forEach((f) => {
      const ridge = mesh(new THREE.TorusGeometry(R * f, 0.0022, 6, low ? 48 : 96), M.silver, "schild", shield);
      ridge.position.z = DOME * (1 - f * f) + 0.0005;
    });
    // Halteriemen auf der Rückseite
    [-0.07, 0.07].forEach((y) => {
      const strap = mesh(new THREE.BoxGeometry(0.2, 0.03, 0.012), M.leather, "schild", shield);
      strap.position.set(0, y, -0.03);
    });

    // Ankerpunkte für Markierungen und Kamerafahrten
    const marker = (parent, x, y, z) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    const shieldMarker = marker(shield, 0, 0, DOME + 0.01);
    const suitMarker = marker(root, 0, 1.36, 0.16);
    const rA = parts.right;
    const bodyMid = rA.S.clone().lerp(rA.E, 0.4).add(new THREE.Vector3(-0.07, 0, 0.02));
    const bodyMarker = marker(root, bodyMid.x, bodyMid.y, bodyMid.z);
    const bodyFocus = marker(root, -0.1, 1.3, 0.02);
    const suitFocus = marker(root, 0, 1.24, 0.08);

    return {
      root,
      center: new THREE.Vector3(0.1, 0.97, 0.05),
      top: 1.86,
      spots: {
        schild: { marker: shieldMarker, focus: shieldMarker, normal: n.clone() },
        anzug: { marker: suitMarker, focus: suitFocus },
        koerper: { marker: bodyMarker, focus: bodyFocus },
      },
    };
  }

  registerModel({
    id: "steve-rogers",
    kind: "placeholder",
    label: "Steve Rogers / Captain America",
    note: "Stilisierter Platzhalter · prozedural in Three.js gebaut, kein lizenziertes Originalmodell",
    match: (c) => /^steve rogers\b/i.test(String(c && c.name)),
    build: buildCaptainAmerica,
  });

  // ---------- Szene: Licht, Umgebung, Plattform, Partikel ----------
  // Kleine prozedurale Studio-Umgebung für Metallreflexe (Schild, Stern).
  function studioEnvironment(renderer) {
    const tex = canvasTex(
      512,
      256,
      (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "#0b1a33");
        grad.addColorStop(0.5, "#08101f");
        grad.addColorStop(1, "#020409");
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        const box = (x, y, bw, bh, color, blur) => {
          g.filter = `blur(${blur}px)`;
          g.fillStyle = color;
          g.fillRect(x, y, bw, bh);
        };
        box(w * 0.18, h * 0.12, w * 0.16, h * 0.18, "#fff4e6", 6); // Key
        box(w * 0.62, h * 0.18, w * 0.1, h * 0.3, "#5ec8ff", 8); // Rim blau
        box(w * 0.86, h * 0.22, w * 0.08, h * 0.25, "#9fdcff", 8);
        box(0, h * 0.46, w, h * 0.04, "#1d6fb0", 10); // Horizontlinie der Plattform
        box(w * 0.4, h * 0.02, w * 0.2, h * 0.06, "#cfe6ff", 6);
        g.filter = "none";
      },
      true
    );
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    tex.dispose();
    return rt;
  }

  const HOLO_VERT = `
    varying vec3 vWorld;
    varying vec3 vNormalW;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    }`;
  const HOLO_FRAG = `
    uniform float uScanY;
    uniform float uFade;
    uniform float uLine;
    uniform float uTime;
    uniform vec3 uColor;
    varying vec3 vWorld;
    varying vec3 vNormalW;
    void main() {
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - abs(dot(normalize(vNormalW), v)), 2.2);
      float d = vWorld.y - uScanY;
      float line = exp(-abs(d) * 60.0) * uLine;
      float scanned = step(0.0, d) * uFade;
      float grid = step(0.86, fract(vWorld.y * 42.0 - uTime * 0.8));
      float a = line * 1.3 + scanned * (fres * 1.05 + grid * 0.22 + 0.07);
      gl_FragColor = vec4(uColor * a, a);
    }`;

  function holoMaterial(color) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uScanY: { value: -10 },
        uFade: { value: 1 },
        uLine: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }

  const POINT_VERT = `
    attribute float aSize;
    attribute float aAlpha;
    uniform float uPR;
    varying float vAlpha;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uPR / max(0.2, -mv.z);
      vAlpha = aAlpha;
    }`;
  const POINT_FRAG = `
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d);
      a *= a * vAlpha;
      gl_FragColor = vec4(uColor * a, a);
    }`;

  function pointsMaterial(color, pr) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uPR: { value: pr } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  function buildPlatform(scene, low, aniso) {
    const group = new THREE.Group();
    scene.add(group);
    const lineTex = canvasTex(1024, 1024, (g, w, h) => {
      const c = w / 2;
      g.fillStyle = "#000";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#ffffff";
      const circle = (r, lw, dash) => {
        g.lineWidth = lw;
        g.setLineDash(dash || []);
        g.beginPath();
        g.arc(c, c, r * c, 0, Math.PI * 2);
        g.stroke();
      };
      circle(0.985, 6);
      circle(0.93, 2, [18, 10]);
      circle(0.78, 3);
      circle(0.74, 1.5, [4, 8]);
      circle(0.42, 2);
      circle(0.3, 1.5, [10, 6]);
      g.setLineDash([]);
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        const r0 = i % 10 === 0 ? 0.82 : 0.86;
        g.lineWidth = i % 10 === 0 ? 3 : 1.5;
        g.beginPath();
        g.moveTo(c + Math.cos(a) * r0 * c, c + Math.sin(a) * r0 * c);
        g.lineTo(c + Math.cos(a) * 0.9 * c, c + Math.sin(a) * 0.9 * c);
        g.stroke();
      }
      // Wabenraster im Inneren
      g.globalAlpha = 0.35;
      g.lineWidth = 1.2;
      const s = 34;
      for (let y = -s; y < h + s; y += s * 0.866) {
        const row = Math.round(y / (s * 0.866));
        for (let x = -s; x < w + s; x += s) {
          const px0 = x + (row % 2 ? s / 2 : 0);
          if (Math.hypot(px0 - c, y - c) > 0.7 * c) continue;
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k + Math.PI / 6;
            const px = px0 + Math.cos(a) * s * 0.5;
            const py = y + Math.sin(a) * s * 0.5;
            if (k) g.lineTo(px, py);
            else g.moveTo(px, py);
          }
          g.closePath();
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    });
    lineTex.anisotropy = aniso;

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.12, 1.24, 0.1, low ? 48 : 96),
      new THREE.MeshStandardMaterial({ color: lin(0x0c1424), roughness: 0.35, metalness: 0.85 })
    );
    base.position.y = -0.05;
    base.receiveShadow = true;
    group.add(base);

    const top = new THREE.Mesh(
      new THREE.CircleGeometry(1.12, low ? 48 : 96),
      new THREE.MeshStandardMaterial({
        color: lin(0x0a1322),
        roughness: 0.4,
        metalness: 0.6,
        emissive: new THREE.Color(0x2aa8ff),
        emissiveMap: lineTex,
        emissiveIntensity: 0.9,
      })
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.001;
    top.receiveShadow = true;
    group.add(top);

    const glowMat = new THREE.MeshBasicMaterial({ color: 0x47c2ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const edge = new THREE.Mesh(new THREE.TorusGeometry(1.13, 0.008, 8, low ? 64 : 128), glowMat);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.002;
    group.add(edge);

    // Schwebende, rotierende Holo-Ringe
    const dashTex = canvasTex(1024, 64, (g, w, h) => {
      g.fillStyle = "#000";
      g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 24) {
        g.fillStyle = x % 96 === 0 ? "#fff" : "#7fd8ff";
        g.fillRect(x, 0, x % 96 === 0 ? 14 : 8, h);
      }
    });
    dashTex.wrapS = THREE.RepeatWrapping;
    const rings = [];
    [
      [1.3, 1.34, 0.03, 0.12],
      [1.42, 1.44, 0.05, -0.07],
      [0.98, 1.0, 0.08, 0.2],
    ].forEach(([r0, r1, y, speed]) => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x5fd0ff,
        map: dashTex,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, low ? 64 : 128, 1), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = y;
      ring.userData.speed = speed;
      group.add(ring);
      rings.push(ring);
    });

    // Lichtsäule (sehr dezent)
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){
          float a = pow(1.0 - vUv.y, 2.4) * 0.16;
          a *= 0.75 + 0.25 * sin(vUv.y * 60.0 - uTime * 2.0);
          gl_FragColor = vec4(vec3(0.25, 0.7, 1.0) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.12, 2.4, low ? 48 : 96, 1, true), beamMat);
    beam.position.y = 1.2;
    group.add(beam);

    // Bodenraster mit radialem Ausblenden
    const gridMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP;
        void main(){
          vec2 g = abs(fract(vP.xz * 2.0 - 0.5) - 0.5) / fwidth(vP.xz * 2.0);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float r = length(vP.xz);
          float fade = smoothstep(7.0, 1.4, r);
          float a = line * fade * 0.28;
          gl_FragColor = vec4(vec3(0.16, 0.55, 0.9) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      extensions: { derivatives: true },
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -0.1;
    group.add(grid);

    return {
      group,
      update(t, dt) {
        rings.forEach((r) => {
          r.rotation.z += r.userData.speed * dt;
        });
        beamMat.uniforms.uTime.value = t;
      },
    };
  }

  // Aufsteigende Holo-Partikel rund um die Plattform
  function buildAmbientParticles(scene, count, pr) {
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    const speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.5 + Math.random() * 1.1;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 2.6;
      pos[i * 3 + 2] = Math.sin(a) * r;
      size[i] = 6 + Math.random() * 12;
      speed[i] = 0.05 + Math.random() * 0.12;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    const pts = new THREE.Points(geo, pointsMaterial(0x6fd2ff, pr));
    pts.frustumCulled = false;
    scene.add(pts);
    return {
      points: pts,
      update(dt) {
        for (let i = 0; i < count; i++) {
          let y = pos[i * 3 + 1] + speed[i] * dt;
          if (y > 2.6) y -= 2.6;
          pos[i * 3 + 1] = y;
          alpha[i] = Math.sin((y / 2.6) * Math.PI) * 0.55;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aAlpha.needsUpdate = true;
      },
    };
  }

  // Funken entlang der Scanlinie
  function buildScanParticles(scene, count, pr) {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const life = new Float32Array(count);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    const pts = new THREE.Points(geo, pointsMaterial(0x9fe6ff, pr));
    pts.frustumCulled = false;
    scene.add(pts);
    let next = 0;
    return {
      points: pts,
      emit(y, n, cx, cz) {
        for (let k = 0; k < n; k++) {
          const i = next;
          next = (next + 1) % count;
          const a = Math.random() * Math.PI * 2;
          const r = 0.12 + Math.random() * 0.42;
          pos[i * 3] = cx + Math.cos(a) * r;
          pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.03;
          pos[i * 3 + 2] = cz + Math.sin(a) * r * 0.8;
          vel[i * 3] = Math.cos(a) * (0.08 + Math.random() * 0.2);
          vel[i * 3 + 1] = 0.05 + Math.random() * 0.25;
          vel[i * 3 + 2] = Math.sin(a) * (0.08 + Math.random() * 0.2);
          life[i] = 1;
          size[i] = 5 + Math.random() * 10;
        }
      },
      update(dt) {
        for (let i = 0; i < count; i++) {
          if (life[i] <= 0) {
            alpha[i] = 0;
            continue;
          }
          life[i] -= dt * 0.9;
          pos[i * 3] += vel[i * 3] * dt;
          pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
          pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
          alpha[i] = Math.max(0, life[i]) * 0.9;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aAlpha.needsUpdate = true;
      },
    };
  }

  // ---------- Overlay (DOM) ----------
  let overlay = null;
  let ui = null;
  let session = null;
  let lastProfile = null;
  let lastDisposeInfo = null;
  let returnFocus = null;

  function buildOverlay() {
    const el = document.createElement("div");
    el.id = "charlab-overlay";
    el.className = "hidden";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "cl-title");
    el.innerHTML = `
      <div class="cl-shell">
        <div class="cl-stage"></div>
        <div class="cl-fx" aria-hidden="true">
          <div class="cl-vignette"></div>
          <div class="cl-sweep"></div>
          <span class="cl-corner tl"></span><span class="cl-corner tr"></span>
          <span class="cl-corner bl"></span><span class="cl-corner br"></span>
        </div>
        <div class="cl-markers"></div>
        <header class="cl-top">
          <div class="cl-brand">
            <span class="cl-radar" aria-hidden="true"><i></i></span>
            <span class="cl-logo">J.A.R.V.I.S.</span>
            <span class="cl-sub" id="cl-title">CHARACTER LAB · 3D-ANALYSE</span>
          </div>
          <div class="cl-status"><span class="cl-dot"></span><span class="cl-status-text">SYSTEM ONLINE</span><span class="cl-clock"></span></div>
          <button class="cl-close" type="button" aria-label="Character Lab schließen">✕</button>
        </header>
        <aside class="cl-left">
          <section class="cl-win cl-subject">
            <h3 class="cl-win-title"><span>SUBJEKT</span><span class="cl-win-id">ID-01</span></h3>
            <div class="cl-subject-name"></div>
            <div class="cl-subject-alias"></div>
            <dl class="cl-data"></dl>
            <div class="cl-model-note"></div>
          </section>
          <section class="cl-win cl-log-win">
            <h3 class="cl-win-title"><span>SYSTEMPROTOKOLL</span><span class="cl-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></h3>
            <ol class="cl-log" aria-live="polite"></ol>
          </section>
        </aside>
        <aside class="cl-right">
          <section class="cl-win cl-info hidden" aria-live="polite">
            <h3 class="cl-win-title"><span class="cl-info-eyebrow">ANALYSE</span><button class="cl-info-close" type="button" aria-label="Analyse schließen">✕</button></h3>
            <div class="cl-info-title"></div>
            <dl class="cl-facts"></dl>
            <div class="cl-info-extra"></div>
          </section>
          <section class="cl-win cl-scan-win hidden">
            <h3 class="cl-win-title"><span>J.A.R.V.I.S. SCAN</span><span class="cl-scan-pct">0 %</span></h3>
            <div class="cl-scan-bar"><span></span></div>
            <div class="cl-scan-result"></div>
          </section>
        </aside>
        <footer class="cl-bottom">
          <div class="cl-spot-list" role="group" aria-label="Analysepunkte"></div>
          <button class="cl-scan-btn" type="button"><span class="cl-scan-ico" aria-hidden="true"></span><span class="cl-scan-label">SCAN STARTEN</span></button>
          <div class="cl-hint"></div>
        </footer>
        <div class="cl-loading hidden"><span class="cl-loading-ring"></span><span class="cl-loading-text">MODELL WIRD GELADEN …</span></div>
      </div>`;
    document.body.appendChild(el);
    const q = (s) => el.querySelector(s);
    ui = {
      el,
      stage: q(".cl-stage"),
      markers: q(".cl-markers"),
      top: q(".cl-top"),
      left: q(".cl-left"),
      right: q(".cl-right"),
      bottom: q(".cl-bottom"),
      close: q(".cl-close"),
      clock: q(".cl-clock"),
      statusText: q(".cl-status-text"),
      name: q(".cl-subject-name"),
      alias: q(".cl-subject-alias"),
      data: q(".cl-data"),
      modelNote: q(".cl-model-note"),
      log: q(".cl-log"),
      info: q(".cl-info"),
      infoEyebrow: q(".cl-info-eyebrow"),
      infoTitle: q(".cl-info-title"),
      facts: q(".cl-facts"),
      infoExtra: q(".cl-info-extra"),
      infoClose: q(".cl-info-close"),
      scanWin: q(".cl-scan-win"),
      scanPct: q(".cl-scan-pct"),
      scanBar: q(".cl-scan-bar span"),
      scanResult: q(".cl-scan-result"),
      spotList: q(".cl-spot-list"),
      scanBtn: q(".cl-scan-btn"),
      scanLabel: q(".cl-scan-label"),
      hint: q(".cl-hint"),
      loading: q(".cl-loading"),
      loadingText: q(".cl-loading-text"),
    };
    ui.close.addEventListener("click", () => close());
    ui.infoClose.addEventListener("click", () => session && session.select(null));
    ui.scanBtn.addEventListener("click", () => session && session.scan());
    ui.hint.textContent = coarsePointer
      ? "Wischen: 360° drehen · Zwei Finger: zoomen · Punkte antippen"
      : "Ziehen: 360° drehen · Mausrad: zoomen · Analysepunkte anklicken";

    // Escape schließt nur das Lab (nicht zusätzlich das Charakterprofil darunter).
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && isOpen()) {
          e.stopPropagation();
          close();
        }
      },
      true
    );
    // Sicherheitsnetz: wird das Overlay von außen ausgeblendet, Ressourcen freigeben.
    new MutationObserver(() => {
      if (el.classList.contains("hidden") && session) teardown();
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
    overlay = el;
    return el;
  }

  // Systemprotokoll mit Schreibmaschinen-Effekt
  const logQueue = [];
  let logTimer = null;
  function log(text, cls) {
    if (!ui) return;
    logQueue.push({ text, cls });
    if (!logTimer) pumpLog();
  }
  function pumpLog() {
    const item = logQueue.shift();
    if (!item) {
      logTimer = null;
      return;
    }
    const li = document.createElement("li");
    if (item.cls) li.className = item.cls;
    const stamp = new Date().toTimeString().slice(0, 8);
    li.innerHTML = `<span class="cl-log-t">${stamp}</span><span class="cl-log-m"></span>`;
    ui.log.appendChild(li);
    while (ui.log.children.length > 7) ui.log.removeChild(ui.log.firstChild);
    const target = li.querySelector(".cl-log-m");
    if (reduceMotion) {
      target.textContent = item.text;
      logTimer = setTimeout(pumpLog, 60);
      return;
    }
    let i = 0;
    const step = () => {
      i += 2;
      target.textContent = item.text.slice(0, i);
      if (i < item.text.length) logTimer = setTimeout(step, 16);
      else logTimer = setTimeout(pumpLog, 140);
    };
    step();
  }
  function clearLog() {
    logQueue.length = 0;
    clearTimeout(logTimer);
    logTimer = null;
    if (ui) ui.log.innerHTML = "";
  }

  function fillSubject(c, universe, model) {
    const parts = String(c.name).split(" / ");
    ui.name.textContent = parts[0].trim();
    ui.alias.textContent = parts.length > 1 ? parts.slice(1).join(" / ").trim().toUpperCase() : "";
    const debut = (c.films || []).reduce((m, f) => (f.year && (m === null || f.year < m) ? f.year : m), null);
    const rows = [
      ["DARSTELLER", c.role],
      ["UNIVERSUM", universe && universe.name],
      ["AUSRICHTUNG", c.alignment],
      ["ERSTAUFTRITT", debut],
      ["AUFTRITTE", c.films && c.films.length ? `${c.films.length} Filme` : null],
    ].filter((r) => r[1] !== null && r[1] !== undefined && r[1] !== "");
    ui.data.innerHTML = rows.map((r) => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join("");
    ui.modelNote.innerHTML = `<span class="cl-tag">${model.kind === "placeholder" ? "PLATZHALTER" : "3D-MODELL"}</span>${esc(model.note || "")}`;
  }

  function statsRows(stats, keys, animate) {
    const list = keys ? stats.filter((s) => keys.indexOf(s.key) !== -1) : stats;
    return list
      .map(
        (s, i) => `
        <div class="cl-stat" style="--i:${i}">
          <span class="cl-stat-name">${esc(s.label)}</span>
          <span class="cl-stat-track"><span class="cl-stat-fill${animate ? " cl-anim" : ""}" style="--v:${s.value}%"></span></span>
          <span class="cl-stat-val">${s.value}</span>
        </div>`
      )
      .join("");
  }

  // ---------- Lab-Sitzung (Renderer, Szene, Steuerung) ----------
  function createSession(model, subject, c, universe) {
    const low = lowTier();
    const canvas = document.createElement("canvas");
    canvas.className = "cl-canvas";
    canvas.setAttribute("aria-label", "3D-Ansicht: ziehen zum Drehen, scrollen zum Zoomen");
    ui.stage.appendChild(canvas);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (e) {
      canvas.remove();
      return null;
    }
    const pr = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2);
    renderer.setPixelRatio(pr);
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.physicallyCorrectLights = false;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const scene = new THREE.Scene();
    const envRT = studioEnvironment(renderer);
    scene.environment = envRT.texture;

    const BASE_FOV = 32;
    const TAN = Math.tan((BASE_FOV * Math.PI) / 360);
    const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 60);
    camera.position.set(1.4, 2.2, 7.5);

    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 0.55;
    controls.maxDistance = 7.5;
    controls.minPolarAngle = 0.22;
    controls.maxPolarAngle = 1.66;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.9;
    controls.target.set(0.1, 0.97, 0.05);
    canvas.style.touchAction = "none";

    // Licht: warmes Führungslicht mit weichen Schatten, blaue Kanten, Plattform-Glühen
    scene.add(new THREE.HemisphereLight(0x9cc8ff, 0x0a1224, 0.42));
    const key = new THREE.DirectionalLight(0xfff0de, 2.3);
    key.position.set(2.2, 4.6, 3.4);
    key.target.position.set(0, 0.95, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    key.shadow.camera.left = -1.4;
    key.shadow.camera.right = 1.4;
    key.shadow.camera.top = 1.6;
    key.shadow.camera.bottom = -1.4;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.012;
    key.shadow.camera.updateProjectionMatrix();
    scene.add(key, key.target);
    const rimA = new THREE.DirectionalLight(0x4fb8ff, 1.9);
    rimA.position.set(-3.5, 2.8, -3.2);
    const rimB = new THREE.DirectionalLight(0x8fd8ff, 1.1);
    rimB.position.set(3.6, 1.6, -2.6);
    const fill = new THREE.DirectionalLight(0x8aa6ff, 0.45);
    fill.position.set(-3, 1.2, 2.5);
    const under = new THREE.PointLight(0x2f9dff, 0.9, 3.2, 2);
    under.position.set(0, 0.18, 0.7);
    scene.add(rimA, rimB, fill, under);

    const platform = buildPlatform(scene, low, aniso);
    const ambient = buildAmbientParticles(scene, low ? 120 : 240, pr * (canvas.clientHeight || 600) * 0.0025);
    const sparks = buildScanParticles(scene, low ? 220 : 420, pr * (canvas.clientHeight || 600) * 0.0025);

    // Scan-Ebene: leuchtende Scheibe, die mit der Scanlinie über die Figur läuft
    const scanPlaneMat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uAlpha; uniform float uTime; varying vec2 vUv;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          if (r > 1.0) discard;
          float edge = smoothstep(0.9, 0.975, r) * smoothstep(1.0, 0.975, r);
          float fill = 0.1 + smoothstep(0.35, 1.0, r) * 0.22;
          float rings = step(0.9, fract(r * 8.0 - uTime * 1.5)) * 0.35 * (1.0 - r);
          float a = (edge * 1.6 + fill + rings) * uAlpha;
          gl_FragColor = vec4(vec3(0.3, 0.78, 1.0) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), scanPlaneMat);
    scanPlane.rotation.x = -Math.PI / 2;
    scanPlane.visible = false;
    scanPlane.renderOrder = 3;
    scene.add(scanPlane);

    const scanMat = holoMaterial(0x47c8ff);
    const focusMat = holoMaterial(0x5fd6ff);
    focusMat.uniforms.uFade.value = 0.85;

    const st = {
      model: null,
      meshes: [],
      holos: [],
      spots: {},
      selected: null,
      flight: null,
      scan: null,
      scanned: false,
      raf: 0,
      last: performance.now(),
      t: 0,
      alive: true,
      offset: { x: 0, y: 0, tx: 0, ty: 0, freeW: 1, freeH: 1 },
      w: 1,
      h: 1,
      frame: 0,
      autoRotateAt: 0,
      markerEls: {},
      hoverSpot: null,
    };

    const hotspots = subject.hotspots;
    const stats = window.MarvelDerive && MarvelDerive.statsFor ? MarvelDerive.statsFor(c) : [];

    // ---- Layout: freie Fläche zwischen den Panels bestimmen ----
    function measure() {
      ui.el.classList.toggle(
        "cl-sheet-open",
        Array.prototype.some.call(ui.right.children, (k) => !k.classList.contains("hidden"))
      );
      const rect = ui.stage.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      // Hochformat: Analyse-Blatt sitzt direkt über der Fußleiste
      if (ui.bottom.offsetParent !== null) {
        const bt = ui.bottom.getBoundingClientRect().top - rect.top;
        ui.el.style.setProperty("--cl-bottom-h", Math.round(h - bt + 8) + "px");
      }
      let L = 0;
      let T = 0;
      let R = w;
      let B = h;
      [ui.top, ui.left, ui.right, ui.bottom].forEach((el) => {
        if (!el || el.offsetParent === null) return;
        if (!Array.prototype.some.call(el.children, (k) => !k.classList.contains("hidden") && k.offsetParent !== null)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const x0 = r.left - rect.left;
        const y0 = r.top - rect.top;
        const x1 = x0 + r.width;
        const y1 = y0 + r.height;
        // Breite Leisten/Blätter oben oder unten schneiden die Höhe, Spalten die Breite
        const band = r.width / w > 0.7 || (r.height / h < 0.22 && (y1 > h * 0.72 || y0 < h * 0.2));
        if (band) {
          if ((y0 + y1) / 2 < h / 2) T = Math.max(T, y1);
          else B = Math.min(B, y0);
        } else if ((x0 + x1) / 2 < w / 2) L = Math.max(L, x1);
        else R = Math.min(R, x0);
      });
      const freeW = Math.max(w * 0.3, R - L);
      const freeH = Math.max(h * 0.3, B - T);
      st.offset.tx = (L + R) / 2 - w / 2;
      st.offset.ty = (T + B) / 2 - h / 2;
      st.offset.freeW = freeW;
      st.offset.freeH = freeH;
    }

    function resize() {
      const rect = ui.stage.getBoundingClientRect();
      st.w = Math.max(1, Math.round(rect.width));
      st.h = Math.max(1, Math.round(rect.height));
      renderer.setSize(st.w, st.h, false);
      measure();
      applyOffset(true);
      const ps = pr * st.h * 0.0025;
      ambient.points.material.uniforms.uPR.value = ps;
      sparks.points.material.uniforms.uPR.value = ps;
    }

    function applyOffset(snap) {
      const o = st.offset;
      if (snap) {
        o.x = o.tx;
        o.y = o.ty;
      }
      const sx = Math.round(o.x);
      const sy = Math.round(o.y);
      // Größeres virtuelles Bild, aus dem der sichtbare Ausschnitt versetzt
      // geschnitten wird: die Figur rückt in die freie Fläche zwischen den
      // Panels, ohne dass sich das sichtbare Sichtfeld ändert.
      const W = st.w + 2 * Math.abs(sx);
      const H = st.h + 2 * Math.abs(sy);
      camera.fov = (2 * Math.atan(TAN * (H / st.h)) * 180) / Math.PI;
      camera.aspect = W / H;
      camera.setViewOffset(W, H, Math.abs(sx) - sx, Math.abs(sy) - sy, st.w, st.h);
      camera.updateProjectionMatrix();
    }

    // Abstand, damit ein Bereich (Halbachsen rX/rY) in die freie Fläche passt
    function fitDistance(rX, rY) {
      const fill = 0.86;
      const dY = (rY * st.h) / (st.offset.freeH * fill * TAN);
      const dX = (rX * st.w) / (st.offset.freeW * fill * TAN * (st.w / st.h));
      return clamp(Math.max(dX, dY), controls.minDistance, controls.maxDistance);
    }

    function viewFor(id) {
      root.updateMatrixWorld(true);
      if (!id) {
        const ov = subject.overview;
        const target = (st.model && st.model.center ? st.model.center.clone() : new THREE.Vector3(0, 0.95, 0));
        const dir = new THREE.Vector3().fromArray(ov.dir).normalize();
        return { target, pos: target.clone().add(dir.multiplyScalar(fitDistance(ov.rX, ov.rY))) };
      }
      const h = hotspots.find((x) => x.id === id);
      const spot = st.spots[id];
      const target = new THREE.Vector3();
      (spot.focus || spot.marker).getWorldPosition(target);
      let dir;
      if (spot.normal) {
        dir = spot.normal.clone().applyQuaternion(root.quaternion);
        dir.y += 0.16;
        dir.normalize();
      } else dir = new THREE.Vector3().fromArray(h.dir).normalize();
      return { target, pos: target.clone().add(dir.multiplyScalar(fitDistance(h.r[0], h.r[1]))) };
    }

    // Weiche Kamerafahrt auf einer Kreisbahn um das Ziel (fliegt nicht durch die Figur)
    function flyTo(view, duration) {
      const fromOff = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      const toOff = new THREE.Spherical().setFromVector3(view.pos.clone().sub(view.target));
      let dTheta = toOff.theta - fromOff.theta;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;
      st.flight = {
        fromT: controls.target.clone(),
        toT: view.target.clone(),
        from: fromOff,
        dTheta,
        to: toOff,
        t: 0,
        dur: reduceMotion ? 0.001 : duration || 1.25,
      };
      controls.autoRotate = false;
    }

    function stepFlight(dt) {
      const f = st.flight;
      if (!f) return;
      f.t += dt;
      const k = easeInOutCubic(Math.min(1, f.t / f.dur));
      controls.target.lerpVectors(f.fromT, f.toT, k);
      const s = new THREE.Spherical(
        f.from.radius + (f.to.radius - f.from.radius) * k,
        f.from.phi + (f.to.phi - f.from.phi) * k,
        f.from.theta + f.dTheta * k
      );
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
      if (f.t >= f.dur) st.flight = null;
    }

    controls.addEventListener("start", () => {
      st.flight = null;
      controls.autoRotate = false;
      st.autoRotateAt = st.t + 9;
    });

    // ---- Modell laden ----
    const root = new THREE.Group();
    scene.add(root);
    const ctx = { THREE, lin, low, anisotropy: aniso, renderer, canvasTex };
    ui.loading.classList.remove("hidden");
    const ready = Promise.resolve()
      .then(() => model.build(ctx))
      .then((m) => {
        if (!st.alive) {
          if (m && m.dispose) m.dispose();
          return;
        }
        st.model = m;
        root.add(m.root);
        st.spots = m.spots || {};
        m.root.traverse((o) => {
          if (o.isMesh) st.meshes.push(o);
        });
        // Hologramm-Hülle je Mesh (teilt die Geometrie; nur bei Scan/Fokus sichtbar)
        st.meshes.forEach((o) => {
          const holo = new THREE.Mesh(o.geometry, scanMat);
          holo.visible = false;
          holo.castShadow = false;
          holo.receiveShadow = false;
          holo.renderOrder = 2;
          holo.userData.holo = true;
          holo.userData.spot = o.userData.spot;
          o.add(holo);
          st.holos.push(holo);
        });
        ui.loading.classList.add("hidden");
        buildMarkers();
        resize();
        const view = viewFor(null);
        if (reduceMotion) {
          controls.target.copy(view.target);
          camera.position.copy(view.pos);
        } else {
          // Intro: aus der Distanz heranfliegen
          controls.target.copy(view.target);
          camera.position.copy(view.target.clone().add(view.pos.clone().sub(view.target).multiplyScalar(2.1)).add(new THREE.Vector3(-1.2, 0.8, 0)));
          flyTo(view, 1.8);
        }
        st.autoRotateAt = st.t + 4;
        log(`Subjekt erfasst: ${c.name}`);
        if (model.kind === "placeholder") log("Hinweis: stilisiertes Platzhaltermodell (prozedural)", "cl-log-warn");
        log("Analysepunkte bereit: " + hotspots.map((h) => h.label).join(" · "));
      })
      .catch((err) => {
        if (!st.alive) return;
        ui.loadingText.textContent = "MODELL KONNTE NICHT GELADEN WERDEN";
        if (window.console) console.warn("CharacterLab:", err);
        if (model.fallback && st.alive) {
          // Ein fehlgeschlagenes GLB fällt auf den Platzhalter zurück
          teardown();
          openWith(model.fallback, c, universe);
        }
      });

    // ---- HTML-Markierungen der Analysepunkte ----
    function buildMarkers() {
      ui.markers.innerHTML = "";
      st.markerEls = {};
      hotspots.forEach((h) => {
        if (!st.spots[h.id]) return;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cl-marker";
        b.dataset.spot = h.id;
        b.setAttribute("aria-label", `Analysepunkt ${h.title}`);
        b.innerHTML = `<span class="cl-marker-dot"></span><span class="cl-marker-label">${esc(h.label)}</span>`;
        b.addEventListener("click", () => select(h.id));
        ui.markers.appendChild(b);
        st.markerEls[h.id] = b;
      });
    }

    const tmpV = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    function updateMarkers() {
      const occlCheck = st.frame % 6 === 0;
      const boxes = [];
      hotspots.forEach((h) => {
        const el = st.markerEls[h.id];
        const spot = st.spots[h.id];
        if (!el || !spot) return;
        spot.marker.getWorldPosition(tmpV);
        const dist = tmpV.distanceTo(camera.position);
        if (occlCheck) {
          ray.set(camera.position, tmpV.clone().sub(camera.position).normalize());
          ray.far = dist;
          const hit = ray.intersectObjects(st.meshes, false)[0];
          el.classList.toggle("occluded", !!hit && hit.distance < dist - 0.06);
        }
        tmpV.project(camera);
        const off = tmpV.z > 1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05;
        el.classList.toggle("offscreen", off);
        const x = ((tmpV.x + 1) / 2) * st.w;
        const y = ((1 - tmpV.y) / 2) * st.h;
        // Beschriftung links vom Punkt, wenn der Marker links der Bildmitte liegt
        const lw = el.offsetWidth || 120;
        let flip = x < st.w / 2 + st.offset.x - 4;
        if (flip && x - lw < 6) flip = false;
        else if (!flip && x + lw > st.w - 6 && x - lw >= 6) flip = true;
        el.classList.toggle("flip", flip);
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${flip ? " translateX(-100%)" : ""}`;
        if (!off) boxes.push({ el, x0: flip ? x - lw : x - 11, x1: flip ? x + 11 : x + lw, y });
      });
      // Beschriftungen, die sich überlagern würden, vertikal auseinanderschieben
      boxes.sort((a, b) => a.y - b.y);
      const placed = [];
      boxes.forEach((b) => {
        let dy = 0;
        placed.forEach((p) => {
          if (b.x0 < p.x1 && b.x1 > p.x0 && Math.abs(b.y + dy - (p.y + p.dy)) < 26) dy = p.y + p.dy + 26 - b.y;
        });
        b.dy = dy;
        placed.push(b);
        b.el.style.setProperty("--dy", dy.toFixed(0) + "px");
      });
    }

    // ---- Auswahl eines Analysepunkts ----
    function select(id) {
      if (!st.model) return;
      if (id && !hotspots.some((h) => h.id === id)) return;
      st.selected = id || null;
      const hud = HUD();
      if (hud) hud.playClick();
      Array.prototype.forEach.call(ui.spotList.children, (b) => {
        const on = (b.dataset.spot || null) === (id || null) || (!id && b.dataset.spot === "");
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      Object.keys(st.markerEls).forEach((k) => st.markerEls[k].classList.toggle("active", k === id));
      if (id) {
        const h = hotspots.find((x) => x.id === id);
        renderInfo(h);
        ui.info.classList.remove("hidden");
        log(h.log || `Analysiere ${h.title}`);
      } else {
        ui.info.classList.add("hidden");
      }
      updateHolo();
      measure();
      flyTo(viewFor(id), id ? 1.25 : 1.4);
      if (!id) st.autoRotateAt = st.t + 6;
    }

    function renderInfo(h) {
      ui.infoEyebrow.textContent = `ANALYSE · ${h.label}`;
      ui.infoTitle.textContent = h.title;
      ui.facts.innerHTML = h.facts.map((f) => `<div><dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd></div>`).join("");
      let extra = "";
      if (h.bio && c.bio) extra += `<div class="cl-sub-title">ARCHIV</div><p class="cl-bio">${esc(c.bio)}</p>`;
      const powers = (c.powers || []).filter((p) => h.powers && h.powers.test(p));
      if (powers.length) {
        extra += `<div class="cl-sub-title">FÄHIGKEITEN LAUT PROFIL</div><div class="cl-chips">${powers.map((p) => `<span>${esc(p)}</span>`).join("")}</div>`;
      }
      if (h.stats && stats.length) {
        extra += `<div class="cl-sub-title">POWER-STATS LAUT PROFIL</div><div class="cl-stats">${statsRows(stats, h.stats, true)}</div>`;
      }
      ui.infoExtra.innerHTML = extra;
      ui.info.scrollTop = 0;
    }

    function updateHolo() {
      const scanning = !!st.scan;
      st.holos.forEach((m) => {
        if (scanning || st.scanFade > 0) {
          m.material = scanMat;
          m.visible = true;
        } else if (st.selected && m.userData.spot === st.selected) {
          m.material = focusMat;
          m.visible = true;
        } else m.visible = false;
      });
    }

    // ---- J.A.R.V.I.S.-Scan ----
    st.scanFade = 0;
    function scan() {
      if (!st.model || st.scan) return;
      const hud = HUD();
      if (hud) hud.playClick();
      const top = (st.model.top || 1.9) + 0.06;
      st.scan = { t: 0, dur: reduceMotion ? 1.2 : 3.6, top, steps: 0 };
      st.scanFade = 1;
      ui.scanWin.classList.remove("hidden");
      ui.scanResult.innerHTML = "";
      ui.scanBtn.disabled = true;
      ui.scanBtn.classList.add("busy");
      ui.scanLabel.textContent = "SCAN LÄUFT …";
      ui.statusText.textContent = "SCAN AKTIV";
      ui.el.classList.add("cl-scanning");
      log("Tiefenscan initialisiert");
      if (st.selected) {
        st.selected = null;
        Array.prototype.forEach.call(ui.spotList.children, (b) => b.classList.toggle("active", b.dataset.spot === ""));
        Object.keys(st.markerEls).forEach((k) => st.markerEls[k].classList.remove("active"));
        ui.info.classList.add("hidden");
      }
      measure();
      flyTo(viewFor(null), 1.0);
      updateHolo();
    }

    const SCAN_LOG = [
      [0.22, "Erfasse Körperstruktur"],
      [0.48, "Gleiche Profil mit Datenbank ab"],
      [0.74, "Berechne Power-Stats aus Profildaten"],
    ];

    function stepScan(dt) {
      const s = st.scan;
      if (!s) {
        if (st.scanFade > 0) {
          st.scanFade = Math.max(0, st.scanFade - dt * 0.8);
          scanMat.uniforms.uFade.value = st.scanFade;
          scanMat.uniforms.uLine.value = 0;
          if (st.scanFade === 0) updateHolo();
        }
        return;
      }
      s.t += dt;
      const p = Math.min(1, s.t / s.dur);
      const y = s.top - (s.top + 0.02) * easeInOutCubic(p);
      scanMat.uniforms.uScanY.value = y;
      scanMat.uniforms.uLine.value = 1;
      scanMat.uniforms.uFade.value = 1;
      const c0 = st.model.center || new THREE.Vector3();
      scanPlane.visible = true;
      scanPlane.position.set(c0.x * 0.6, y, c0.z);
      scanPlaneMat.uniforms.uAlpha.value = Math.min(1, p * 12, (1 - p) * 12);
      scanPlaneMat.uniforms.uTime.value = st.t;
      sparks.emit(y, reduceMotion ? 0 : low ? 3 : 6, c0.x * 0.4, c0.z);
      ui.scanPct.textContent = Math.round(p * 100) + " %";
      ui.scanBar.style.width = p * 100 + "%";
      while (s.steps < SCAN_LOG.length && p >= SCAN_LOG[s.steps][0]) {
        log(SCAN_LOG[s.steps][1]);
        s.steps++;
      }
      if (p >= 1) {
        st.scan = null;
        st.scanned = true;
        scanPlane.visible = false;
        scanMat.uniforms.uLine.value = 0;
        ui.scanBtn.disabled = false;
        ui.scanBtn.classList.remove("busy");
        ui.scanLabel.textContent = "SCAN WIEDERHOLEN";
        ui.statusText.textContent = "SYSTEM ONLINE";
        ui.el.classList.remove("cl-scanning");
        showScanResult();
        log("Scan abgeschlossen · Ergebnisse rechts", "cl-log-ok");
      }
    }

    function showScanResult() {
      if (!stats.length) {
        ui.scanResult.innerHTML = `<p class="cl-bio">Für diese Figur liegen keine Power-Stats vor.</p>`;
        return;
      }
      const top = stats.reduce((a, b) => (b.value > a.value ? b : a), stats[0]);
      ui.scanResult.innerHTML = `
        <div class="cl-sub-title">POWER-STATS</div>
        <div class="cl-stats">${statsRows(stats, null, true)}</div>
        <div class="cl-scan-summary"><span>HÖCHSTER WERT</span><strong>${esc(top.label)} · ${top.value}</strong></div>
        <p class="cl-source">Quelle: dieselben Werte wie im Charakterprofil.</p>`;
      measure();
    }

    // ---- Klicks auf die Figur ----
    let downAt = null;
    function onPointerDown(e) {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    }
    function onPointerUp(e) {
      if (!downAt || !st.model) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      const quick = performance.now() - downAt.t < 600;
      downAt = null;
      if (moved > 6 || !quick) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.far = Infinity;
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(st.meshes, false)[0];
      if (hit && hit.object.userData.spot) select(hit.object.userData.spot);
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    if (ro) ro.observe(ui.stage);
    else window.addEventListener("resize", resize);
    resize();

    // ---- Renderschleife (nur solange das Lab offen ist) ----
    function frame(now) {
      if (!st.alive) return;
      st.raf = requestAnimationFrame(frame);
      if (document.hidden) {
        st.last = now;
        return;
      }
      const dt = Math.min(0.1, (now - st.last) / 1000);
      st.last = now;
      st.t += dt;
      st.frame++;

      const o = st.offset;
      if (Math.abs(o.x - o.tx) > 0.5 || Math.abs(o.y - o.ty) > 0.5) {
        const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 6);
        o.x += (o.tx - o.x) * k;
        o.y += (o.ty - o.y) * k;
        applyOffset(false);
      }
      if (!reduceMotion && !st.flight && !st.selected && !st.scan && st.model && st.t > st.autoRotateAt) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.45;
      }
      stepFlight(dt);
      controls.update();
      stepScan(dt);
      platform.update(st.t, reduceMotion ? 0 : dt);
      if (!reduceMotion) ambient.update(dt);
      sparks.update(dt);
      scanMat.uniforms.uTime.value = st.t;
      focusMat.uniforms.uTime.value = st.t;
      focusMat.uniforms.uFade.value = 0.85 + Math.sin(st.t * 3) * 0.25;
      if (st.model && st.model.update) st.model.update(st.t, dt);
      renderer.render(scene, camera);
      if (st.model) updateMarkers();
    }
    st.raf = requestAnimationFrame(frame);

    // ---- Freigabe ----
    function dispose() {
      st.alive = false;
      cancelAnimationFrame(st.raf);
      controls.dispose();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
      if (st.model && st.model.dispose) st.model.dispose();
      const res = new Set();
      scene.traverse((o) => {
        if (o.geometry) res.add(o.geometry);
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => {
          res.add(m);
          Object.keys(m).forEach((k) => {
            const v = m[k];
            if (v && v.isTexture) res.add(v);
          });
          if (m.uniforms) Object.keys(m.uniforms).forEach((k) => {
            const v = m.uniforms[k].value;
            if (v && v.isTexture) res.add(v);
          });
        });
        if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
      });
      res.add(scanMat);
      res.add(focusMat);
      res.add(scanPlaneMat);
      res.forEach((r) => r.dispose && r.dispose());
      envRT.dispose();
      scene.environment = null;
      const info = renderer.info.memory;
      lastDisposeInfo = { geometries: info.geometries, textures: info.textures };
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      ui.markers.innerHTML = "";
    }

    return {
      ready,
      select,
      scan,
      dispose,
      remeasure: measure,
      debug: () => ({
        selected: st.selected,
        scanning: !!st.scan,
        scanned: st.scanned,
        flying: !!st.flight,
        meshes: st.meshes.length,
        camera: camera.position.toArray().map((v) => +v.toFixed(3)),
        target: controls.target.toArray().map((v) => +v.toFixed(3)),
        distance: +camera.position.distanceTo(controls.target).toFixed(3),
        memory: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
        calls: renderer.info.render.calls,
        spotScreen: Object.keys(st.markerEls).reduce((acc, k) => {
          const r = st.markerEls[k].getBoundingClientRect();
          acc[k] = { x: Math.round(r.left), y: Math.round(r.top), occluded: st.markerEls[k].classList.contains("occluded") };
          return acc;
        }, {}),
      }),
    };
  }

  // ---------- Öffnen / Schließen ----------
  function isOpen() {
    return !!(overlay && !overlay.classList.contains("hidden"));
  }

  function openWith(model, c, universe) {
    const subject = SUBJECTS[model.subject || model.id];
    if (!subject) return false;
    if (!overlay) buildOverlay();
    returnFocus = document.activeElement;
    clearLog();
    fillSubject(c, universe, model);
    ui.info.classList.add("hidden");
    ui.scanWin.classList.add("hidden");
    ui.scanBtn.disabled = false;
    ui.scanBtn.classList.remove("busy");
    ui.scanLabel.textContent = "SCAN STARTEN";
    ui.statusText.textContent = "SYSTEM ONLINE";
    ui.el.classList.remove("cl-scanning");
    ui.loadingText.textContent = "MODELL WIRD GELADEN …";
    ui.spotList.innerHTML =
      subject.hotspots
        .map((h) => `<button type="button" class="cl-chip" data-spot="${esc(h.id)}" aria-pressed="false">${esc(h.label)}</button>`)
        .join("") + `<button type="button" class="cl-chip active" data-spot="" aria-pressed="true">GESAMT</button>`;
    Array.prototype.forEach.call(ui.spotList.children, (b) => {
      b.addEventListener("click", () => session && session.select(b.dataset.spot || null));
    });

    const hud = HUD();
    if (hud && hud.openOverlay) hud.openOverlay(overlay);
    else overlay.classList.remove("hidden");
    log("J.A.R.V.I.S. Character Lab online");
    session = createSession(model, subject, c, universe);
    if (!session) {
      ui.loading.classList.remove("hidden");
      ui.loadingText.textContent = "3D-ANSICHT NICHT VERFÜGBAR (WEBGL)";
    }
    startClock();
    ui.close.focus({ preventScroll: true });
    return true;
  }

  function open(c, universe) {
    const list = modelsFor(c || {}, universe);
    if (!list.length) return false;
    // Das zuerst registrierte passende Modell (GLB vor Platzhalter); der
    // Platzhalter dient als Rückfallebene, falls ein GLB nicht lädt.
    const model = list[0];
    if (!model.fallback && list.length > 1) model.fallback = list[list.length - 1];
    if (session) teardown();
    return openWith(model, c, universe);
  }

  let clockTimer = null;
  function startClock() {
    clearInterval(clockTimer);
    const tick = () => {
      if (ui) ui.clock.textContent = new Date().toTimeString().slice(0, 8);
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  function teardown() {
    clearInterval(clockTimer);
    clockTimer = null;
    clearLog();
    if (session) {
      const s = session;
      session = null;
      s.dispose();
    }
    if (ui) ui.loading.classList.add("hidden");
  }

  function close(silent) {
    if (!overlay) return;
    teardown();
    const hud = HUD();
    if (!overlay.classList.contains("hidden")) {
      if (hud && hud.closeOverlay) hud.closeOverlay(overlay);
      else overlay.classList.add("hidden");
    }
    if (!silent && returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  }

  // Profil-Button: nur sichtbar, wenn für die Figur ein Modell registriert ist.
  function bindProfile(c, universe) {
    lastProfile = { c, universe };
    const btn = document.getElementById("character-lab-btn");
    if (!btn) return;
    const has = modelsFor(c || {}, universe).length > 0;
    btn.classList.toggle("hidden", !has);
    btn.onclick = has ? () => open(c, universe) : null;
  }

  window.MarvelCharLab = {
    registerModel,
    bindProfile,
    open,
    close: () => close(),
    isOpen,
    select: (id) => session && session.select(id),
    scan: () => session && session.scan(),
    ready: () => (session ? session.ready : Promise.resolve()),
    debug: () => ({ open: isOpen(), session: session ? session.debug() : null, lastDispose: lastDisposeInfo }),
    subjects: SUBJECTS,
    hasModel: (c, u) => modelsFor(c || {}, u).length > 0,
    lastProfile: () => lastProfile,
  };
})();
