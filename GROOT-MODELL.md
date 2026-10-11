# Groot: 3D-Modell austauschen

Groot besteht aus zwei Teilen:

- **Komponente** (`groot.js`): Stufen und Wachstum aus dem Fortschritt, Animations-Timing, HUD, Sprechblase, Trefferfläche, Kamera, JARVIS-Plattform, Blätter-Partikel und Funken, Pausen, reduzierte Bewegung, öffentliche API `window.MarvelGroot`.
- **Modell** (die Figur): Standard ist `"procedural"`, der stilisierte Platzhalter am Ende von `groot.js` (`createProceduralModel`). Ein hochwertigeres Modell wird zusätzlich registriert und ersetzt nur die Figur. Die Wachstumsmechanik bleibt unverändert.

Ohne Konfiguration ändert sich nichts: Die Seite zeigt den Platzhalter.

## Was die Komponente weiter übernimmt

| Bereich | Verhalten |
|---|---|
| Stufe | `MarvelProgress.stats().all.percent` → Wachstum `g` = 0 … 5 (fünf Stufen à 20 %, innerhalb einer Stufe halbe Überblendung zur nächsten, ab 80 % bis 100 % voll) |
| Wachstum | Animation mit Easing, Feier beim Markieren (grünes Leuchten, Blätter-Partikel, Funken, Plattform-Puls), Schrumpfen beim Entfernen, Überblenden beim Profilwechsel, Nachholen nach Overlays |
| Idle | Zeitsteuerung für Blick, Blinzeln, Atmen, Körperdrehung und Winken (Klick, Erfolge, gelegentlich von selbst) |
| Darstellung | Renderer, Licht, Kamera (Desktop: fester Ausschnitt; Smartphone: runder Kopf-Ausschnitt im Fortschritts-Widget), Trefferfläche, Sprechblase, HUD |
| Robustheit | Lädt ein Modell noch oder schlägt es fehl (auch zur Laufzeit), zeigt Groot den Platzhalter — ohne JS-Fehler |

## Schnittstelle

Ein Modell entsteht über eine Fabrik:

```js
MarvelGroot.registerModel("name", function (ctx) {
  // ctx = { THREE, scene, renderer, config, stages, growthMax, reduceMotion() }
  return model; // oder ein Promise, das das Modell liefert
});
```

| Teil | Pflicht | Bedeutung |
|---|---|---|
| `object` | ja | `THREE.Object3D`; Fußpunkt bei y = 0, Blick nach +z. Die Komponente bewegt es nicht. |
| `setGrowth(g)` | ja | Größe/Proportionen für `g` = 0 (Baby, 0 %) … 4 (Erwachsen, 80 %) … 5 (100 %); Zwischenwerte stufenlos |
| `height()` | ja | Körperhöhe laut Proportionen (Kamera, Funken, Partikel) |
| `pose(s, dt)` | ja | jeden Frame; `s` siehe unten |
| `headTop(v)` | nein | Weltposition knapp über dem Kopf (Sprechblase); Rückfall: Oberkante der Hülle |
| `head()` | nein | `{ y, size }` Kopfmitte und Kopfhöhe (Smartphone-Ausschnitt); Rückfall aus `height()` |
| `bounds(box)` | nein | Welt-Hüllquader (Trefferfläche); Rückfall: `box.setFromObject(object)` |
| `setGlow(v)` | nein | Wachstums-Leuchten 0 … 1 |
| `emitters()` | nein | `{ radius, y0, y1 }` Startbereich der Blätter-Partikel |
| `triangles()` | nein | für `debugInfo()` |
| `credit` | nein | Text für den Hinweis im Groot-HUD (z.B. Lizenz-Nennung) |
| `dispose()` | nein | GPU-Ressourcen freigeben |

Nach `setGrowth()` und `pose()` muss das Modell ohne weiteren Aufruf renderbereit sein.

Pose-Zustand `s` (neutral, ohne Bezug zu einem Rig):

| Feld | Inhalt |
|---|---|
| `time` | Uhr in Sekunden |
| `reduceMotion`, `compact` | reduzierte Bewegung; runder Smartphone-Ausschnitt |
| `bodyYaw` | Drehung des ganzen Körpers (rad) |
| `breath` | Atem-Auslenkung, etwa ±0,011 (reduziert ±0,0025) |
| `yaw`, `pitch`, `roll` | Blickrichtung des Kopfes (rad) |
| `blink` | 0 = offen … 1 = geschlossen |
| `wave`, `waveSide`, `waveTime` | Winken 0 … 1; Arm-Seite (−1 = links im Bild, also die rechte Hand der Figur); Sekunden seit Beginn |

Auswahl des Modells: `window.MARVEL_GROOT_CONFIG = { model: "name" }` vor `groot.js` oder zur Laufzeit `MarvelGroot.useModel("name")`. Prüfen mit `MarvelGroot.debugInfo()` → `model`, `modelPending`, `modelError`.

## Lizenziertes GLB einbinden

`groot-gltf-model.js` ist ein fertiger Adapter (Vorlage, standardmäßig nicht geladen). Er ist nur mit Ersatz-Szenen erprobt — mit einem echten Modell müssen Namen, Achsen und Maße geprüft werden.

1. **GLB-Dateien** nach `assets/groot/` legen.
2. **GLTFLoader passend zu r128**: Aus dem three.js-Repository, Tag `r128`, die Datei `examples/js/loaders/GLTFLoader.js` als `vendor/GLTFLoader.js` ablegen. Die Version muss zu `vendor/three.min.js` (r128) passen; neuere Loader sind ES-Module und funktionieren hier nicht. Für Draco-komprimierte Dateien zusätzlich `examples/js/loaders/DRACOLoader.js` und die Decoder aus `examples/js/libs/draco/` (dann `gltf.draco: "vendor/draco/"`).
3. **index.html** ergänzen:

   ```html
   <script src="vendor/three.min.js"></script>
   <script src="vendor/GLTFLoader.js"></script>
   …
   <script>
     window.MARVEL_GROOT_CONFIG = {
       model: "gltf",
       gltf: {
         // Weg A: ein Modell pro Stufe, Reihenfolge Baby → Erwachsen
         stages: [
           "assets/groot/groot-1-baby.glb",
           "assets/groot/groot-2-baby-gross.glb",
           "assets/groot/groot-3-jung.glb",
           "assets/groot/groot-4-teenager.glb",
           "assets/groot/groot-5-erwachsen.glb",
         ],
         // Weg B stattdessen: url: "assets/groot/groot-rig.glb",
         credit: "3D-Modell „…“ von …, Lizenz …",
       },
     };
   </script>
   <script src="groot.js?v=37"></script>
   <script src="groot-gltf-model.js?v=37"></script>
   ```

   Versionsparameter (`?v=`) aller geänderten Dateien erhöhen, sonst liefert der Browser-Cache alte Stände.
4. **Testen**: `MarvelGroot.debugInfo()` muss `model: "gltf"` und `modelError: null` zeigen; mit `MarvelGroot.debugSetPercent(8 | 28 | 48 | 68 | 95)` alle Stufen ansehen (`debugSetPercent(null)` beendet die Vorschau), dazu die Smartphone-Ansicht.

**Weg A — ein Modell pro Stufe**: Beim Stufenwechsel blendet der Adapter über (`fade`, Sekunden), innerhalb einer Stufe wächst das Modell leicht mit. Alle fünf Dateien werden beim Start geladen.

**Weg B — ein Modell mit Skelett/Morph-Targets**: Größe aus `heights`, Proportionen je Stufe optional über Morph-Targets (`morphs.growth: [null, "Stufe2", "Stufe3", "Stufe4", "Stufe5", "Stufe5"]`, `null` = Grundform). Erwartet werden, jeweils erster gefundener Name:

| Zweck | Knochen / Morph (Standardnamen, über `gltf.bones`/`gltf.morphs` änderbar) |
|---|---|
| Blick | Knochen `Head` (Drehung um die lokalen Achsen y/x/z = yaw/pitch/roll) |
| Atmen | Knochen `Spine1` bzw. `Spine` (leichte Skalierung) |
| Winken | `UpperArm.R/L`, `LowerArm.R/L` (auch Blender-Metarig- und Mixamo-Namen); Hebeachse `armAxis` |
| Blinzeln | Morph-Target `Blink` (auch `EyesClosed`, `eyeBlink`) |
| Clips (optional) | `Idle` läuft dauerhaft, `Wave` wird beim Winken eingeblendet (`THREE.AnimationMixer`) |

Passen die Achsen des Rigs nicht, kann `gltf.pose(rig, s, THREE)` die Pose komplett selbst setzen.

## Anforderungen an das Modell

- **Format**: glTF 2.0 als GLB (Texturen eingebettet), PBR-Materialien (metallic-roughness).
- **Ausrichtung**: y oben, Blick nach +z (sonst `gltf.yaw` in Radiant). Lage und Maßstab normiert der Adapter: Fußpunkt auf die Plattform, Höhe aus `heights` (Standard wie der Platzhalter: 0,87 … 1,96 Einheiten bei einem Plattformradius von 0,78). Weg A: alle fünf Dateien gleich ausgerichtet.
- **Proportionen**: wie im Film vom Baby (Kopf ≈ 45 % der Höhe) bis zum Erwachsenen (≈ 15 %); Äste/Blätter sollen mit den Stufen zunehmen.
- **Budget für Smartphones**: Der Platzhalter hat ≈ 18 000–22 000 Dreiecke inklusive Plattform. Ziel für die Figur: höchstens ≈ 30 000 Dreiecke je Stufe, wenige Materialien (≤ 4), Texturen höchstens 1024 × 1024 (Basisfarbe, Normal, ORM), etwa 1–3 MB je GLB. Bei Weg A zählt die Summe aller fünf Dateien. Blätter möglichst mit `alphaMode: MASK` statt `BLEND`.
- **Licht**: Die Szene bringt eigenes Licht mit (Key/Fill/Rim, ACES-Tonemapping, Belichtung 0,8), abgestimmt auf die dunkle Rinde des Platzhalters. Helle Albedo-Texturen wirken darunter schnell blass. Das grüne Wachstums-Leuchten nutzt den `emissive`-Kanal der Materialien.
- **Lizenz**: Die Lizenz muss die Nutzung im Web erlauben — eine GLB-Datei kann jeder Besucher herunterladen. Bei CC BY o.ä. gehört die Nennung in `gltf.credit` (erscheint im Groot-HUD). Groot ist eine geschützte Marvel-Figur: Die Lizenz eines 3D-Modells regelt nur die Rechte des Modell-Erstellers, nicht die Rechte an der Figur.

## Eigenes Modell ohne GLB

Jede Fabrik, die die Pflichtteile erfüllt, funktioniert — z.B. für Tests:

```js
MarvelGroot.registerModel("saeule", ({ THREE }) => {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x6b4423 }));
  root.add(body);
  let h = 0.6;
  return {
    object: root,
    setGrowth(g) { h = 0.6 + g * 0.27; body.scale.y = h; },
    height: () => h,
    pose(s) { root.rotation.y = s.bodyYaw; },
  };
});
MarvelGroot.useModel("saeule");
```

## Fehlersuche

- `MarvelGroot.debugInfo().modelError` nennt den Grund, warum der Platzhalter aktiv ist (z.B. „THREE.GLTFLoader fehlt“, „Laden fehlgeschlagen: …“, „nicht registriert“); dazu eine Warnung in der Konsole.
- `modelPending` zeigt ein noch ladendes Modell.
- Wirft ein externes Modell zur Laufzeit, schaltet Groot auf den Platzhalter zurück und meldet den Fehler in `modelError`.
- `groot-gltf-model.js` muss **nach** `groot.js` geladen werden.
