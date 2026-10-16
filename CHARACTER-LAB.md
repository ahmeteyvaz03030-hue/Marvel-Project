# J.A.R.V.I.S. Character Lab

Interaktives 3D-Analyse-Labor, erreichbar über den Button **„3D-ANALYSE STARTEN“**
im Charakterprofil. Der Button erscheint nur bei Figuren, für die ein 3D-Modell
registriert ist (derzeit: Steve Rogers / Captain America).

## Aktueller Stand: stilisierter Platzhalter

Die Figur im Lab ist **kein lizenziertes Originalmodell**. Sie wird beim Öffnen
prozedural in Three.js aufgebaut (`buildCaptainAmerica` in `charlab.js`) und ist
über Farben, Stern, rot-weiße Streifen, Helm mit „A“ und den runden
Vibranium-Schild erkennbar. Im Lab steht das sichtbar als „PLATZHALTER“ dabei.
Es wurden keine fremden 3D-Modelle heruntergeladen oder eingebunden.

## Bedienung

| Aktion | Desktop | Smartphone |
| --- | --- | --- |
| Figur 360° drehen | Maus ziehen | Wischen |
| Zoomen | Mausrad | Zwei Finger (Pinch) |
| Analysepunkt wählen | Punkt im Raum, Leiste unten oder Klick auf das Bauteil | Antippen |
| Gesamtansicht | „GESAMT“ | „GESAMT“ |
| J.A.R.V.I.S.-Scan | „SCAN STARTEN“ | „SCAN STARTEN“ |
| Schließen | ✕ oder Escape | ✕ |

Die Kamera fliegt beim Öffnen heran und beim Wählen eines Analysepunkts weich
(auf einer Kreisbahn um die Figur) zum Bereich. In der Gesamtansicht dreht sie
sich nach einigen Sekunden ohne Eingabe langsam um die Figur.

Analysepunkte (Texte in `SUBJECTS` in `charlab.js`):

- **Schild** – Material Vibranium, Schutzwirkung, Geschichte, Einsatz
- **Anzug** – Ausrüstung, Kampfschutz, Entwicklung über die Filme
- **Körper** – Supersoldaten-Serum, Wirkung, Fähigkeiten + Biografie aus dem Profil

**Power-Stats:** Scan und Analysepunkte zeigen ausschließlich die Werte aus
`MarvelDerive.statsFor` – dieselben wie im Charakterprofil. Das Lab erfindet
keine eigenen Zahlen. Fähigkeiten stammen aus `powers` der Figur in `data.js`.

## Technik

- `charlab.js` / `charlab.css` – eigenständiges Modul mit eigenem Renderer und
  eigener Szene. Beides entsteht erst beim Öffnen; beim Schließen werden
  Geometrien, Materialien, Texturen, Schattenkarte, Umgebungs-Map und der
  WebGL-Kontext freigegeben.
- Die Planeten-Szene (`script.js`) bleibt unverändert und pausiert, solange das
  Lab offen ist (`charlab-overlay` steht in `BLOCKING_OVERLAY_IDS`).
- Einbindung in `script.js`: eine Zeile in `openCharacterModal`
  (`MarvelCharLab.bindProfile(c, universe)`).
- Qualitätsstufen: Touch-Geräte und schmale Bildschirme bekommen kleinere
  Schattenkarten, weniger Partikel und Segmente und eine begrenzte Pixeldichte
  (`?quality=low|high` erzwingt die Stufe, wie auf der Startseite).
- `prefers-reduced-motion`: keine Kamerafahrten, keine Auto-Drehung, kürzerer Scan.

## Späteres GLB/GLTF-Modell einbinden

Voraussetzung ist ein Modell mit **passender Lizenz** (Nutzung auf einer
öffentlichen Website erlaubt, Namensnennung beachten). Marvel-Figuren sind
markenrechtlich geschützt – Fan-Modelle sind meist nur für private Zwecke
freigegeben.

1. `GLTFLoader.js` aus three.js **r128** (`examples/js/loaders/GLTFLoader.js`)
   nach `vendor/` legen.
2. Modell z.B. als `assets/charlab/captain-america.glb` ablegen (Draco optional,
   dann zusätzlich `DRACOLoader.js` r128 und Decoder-Pfad `draco`).
3. In `index.html` **nach** `charlab.js` einfügen:

   ```html
   <script>
     window.MARVEL_CHARLAB_CONFIG = {
       models: {
         "steve-rogers": {
           url: "assets/charlab/captain-america.glb",
           credit: "3D-Modell „…“ von …, Lizenz …",
           height: 1.86,
           yaw: 0,
           anchors: { schild: "Shield", anzug: "Spine2", koerper: "RightArm" },
         },
       },
     };
   </script>
   <script src="vendor/GLTFLoader.js"></script>
   <script src="charlab-gltf-model.js?v=37"></script>
   ```

4. `anchors` auf die Knotennamen des Modells anpassen (fehlende Knoten werden
   aus der Bounding-Box geschätzt). Meshes unterhalb eines Anker-Knotens werden
   beim Anklicken diesem Analysepunkt zugeordnet.

Das GLB wird erst beim Öffnen des Labs geladen. Schlägt das Laden fehl, fällt
das Lab automatisch auf den prozeduralen Platzhalter zurück.

## Weitere Figuren

1. In `charlab.js` unter `SUBJECTS` einen Eintrag mit Analysepunkten anlegen
   (`id`, `label`, `title`, `dir`, `r`, `facts`, optional `powers`, `stats`, `bio`).
2. Ein Modell mit derselben `id` registrieren:

   ```js
   MarvelCharLab.registerModel({
     id: "tony-stark",
     kind: "placeholder", // oder "gltf"
     note: "…",
     match: (c) => /^tony stark\b/i.test(c.name),
     build: (ctx) => ({ root, spots: { … }, center, top }),
   });
   ```

   `spots` liefert je Analysepunkt ein `marker`-Objekt (Position der
   Markierung), optional `focus` (Kameraziel) und `normal` (Blickrichtung).
