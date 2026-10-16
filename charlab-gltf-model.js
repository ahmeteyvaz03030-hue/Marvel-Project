// ---------------------------------------------------------------------------
// Character Lab: Adapter für spätere, lizenzierte GLB/GLTF-Modelle (VORLAGE)
//
// Diese Datei wird von index.html bewusst NICHT geladen. Solange sie fehlt,
// zeigt das Lab den prozeduralen Platzhalter aus charlab.js. Ein echtes
// Captain-America-Modell gehört nicht zum Projekt — der Adapter ist nur mit
// Ersatz-Szenen erprobt. Knotennamen, Achsen und Blickrichtung müssen an das
// konkrete Modell angepasst werden. Anleitung: CHARACTER-LAB.md.
//
// Voraussetzung: THREE.GLTFLoader passend zu three.js r128 (Datei
// examples/js/loaders/GLTFLoader.js der Version r128), geladen vor dieser
// Datei. Fehlt er, bleibt der Platzhalter. Schlägt das Laden zur Laufzeit
// fehl, fällt das Lab automatisch auf den Platzhalter zurück.
//
// Das Modell wird erst geladen, wenn das Lab für die Figur geöffnet wird,
// und beim Schließen vollständig freigegeben (siehe charlab.js).
//
// Beispiel (vor dieser Datei setzen):
//   window.MARVEL_CHARLAB_CONFIG = {
//     models: {
//       "steve-rogers": {                       // id wie in charlab.js (SUBJECTS)
//         url: "assets/charlab/captain-america.glb",
//         credit: "3D-Modell „…“ von …, Lizenz …",
//         height: 1.86,                         // Zielhöhe (Meter), Füße auf y = 0
//         yaw: 0,                               // Drehung (rad), falls nicht nach +z blickend
//         anchors: {                            // Knoten im Modell je Analysepunkt
//           schild: "Shield",
//           anzug: "Spine2",
//           koerper: "RightArm",
//         },
//         shieldNormal: [0.7, 0, 0.7],          // optional: Blickrichtung auf den Schild
//         defaultSpot: "anzug",                 // Klick auf nicht zugeordnete Meshes
//       },
//     },
//   };
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  if (!window.MarvelCharLab || typeof window.MarvelCharLab.registerModel !== "function") {
    if (window.console) console.warn("CharacterLab-GLTF: charlab.js muss vor charlab-gltf-model.js geladen werden.");
    return;
  }
  if (typeof THREE === "undefined" || typeof THREE.GLTFLoader !== "function") {
    if (window.console) console.warn("CharacterLab-GLTF: THREE.GLTFLoader (r128) fehlt — Platzhalter bleibt aktiv.");
    return;
  }

  const config = (window.MARVEL_CHARLAB_CONFIG && window.MARVEL_CHARLAB_CONFIG.models) || {};

  // Ersatz-Anker aus der Bounding-Box, falls ein Knoten im Modell fehlt
  function estimateAnchor(id, box) {
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const o = new THREE.Object3D();
    if (id === "schild") o.position.set(c.x + size.x * 0.3, box.min.y + size.y * 0.53, c.z + size.z * 0.3);
    else if (id === "anzug") o.position.set(c.x, box.min.y + size.y * 0.72, box.max.z);
    else o.position.set(c.x - size.x * 0.32, box.min.y + size.y * 0.7, c.z);
    return o;
  }

  Object.keys(config).forEach((id) => {
    const cfg = config[id];
    if (!cfg || !cfg.url) return;
    const pattern = cfg.namePattern ? new RegExp(cfg.namePattern, "i") : new RegExp("^" + id.replace(/-/g, " ") + "\\b", "i");

    MarvelCharLab.registerModel({
      id,
      kind: "gltf",
      subject: id,
      note: "3D-Modell (GLB)" + (cfg.credit ? " · " + cfg.credit : ""),
      match: (c) => pattern.test(String(c && c.name)),
      build: (ctx) =>
        new Promise((resolve, reject) => {
          const loader = new THREE.GLTFLoader();
          if (cfg.draco && typeof THREE.DRACOLoader === "function") {
            const draco = new THREE.DRACOLoader();
            draco.setDecoderPath(cfg.draco);
            loader.setDRACOLoader(draco);
          }
          loader.load(
            cfg.url,
            (gltf) => {
              const root = new THREE.Group();
              const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
              if (!model) {
                reject(new Error("GLB enthält keine Szene"));
                return;
              }
              model.rotation.y = cfg.yaw || 0;
              root.add(model);

              // Auf Zielhöhe skalieren, Füße auf die Plattform, mittig ausrichten
              let box = new THREE.Box3().setFromObject(model);
              const h = box.max.y - box.min.y || 1;
              model.scale.multiplyScalar((cfg.height || 1.86) / h);
              box = new THREE.Box3().setFromObject(model);
              model.position.x -= (box.min.x + box.max.x) / 2;
              model.position.z -= (box.min.z + box.max.z) / 2;
              model.position.y -= box.min.y;
              root.updateMatrixWorld(true);
              box = new THREE.Box3().setFromObject(root);

              // Analysepunkte: benannte Knoten oder Schätzung aus der Bounding-Box
              const spots = {};
              const anchorNodes = new Map();
              ["schild", "anzug", "koerper"].forEach((spot) => {
                const name = cfg.anchors && cfg.anchors[spot];
                let node = name ? model.getObjectByName(name) : null;
                if (node) anchorNodes.set(node, spot);
                else {
                  node = estimateAnchor(spot, box);
                  root.add(node);
                }
                spots[spot] = { marker: node, focus: node };
              });
              if (cfg.shieldNormal) spots.schild.normal = new THREE.Vector3().fromArray(cfg.shieldNormal).normalize();

              // Klick-Zuordnung: Mesh erbt den Analysepunkt des nächsten Anker-Vorfahren
              model.traverse((o) => {
                if (!o.isMesh) return;
                o.castShadow = true;
                o.receiveShadow = true;
                let p = o;
                while (p && !anchorNodes.has(p)) p = p.parent;
                o.userData.spot = p ? anchorNodes.get(p) : cfg.defaultSpot || "anzug";
                // Texturen schärfer darstellen
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach((m) => {
                  if (m && m.map) m.map.anisotropy = ctx.anisotropy;
                });
              });

              resolve({
                root,
                spots,
                center: box.getCenter(new THREE.Vector3()),
                top: box.max.y,
              });
            },
            undefined,
            (err) => reject(err || new Error("GLB konnte nicht geladen werden"))
          );
        }),
    });
  });
})();
