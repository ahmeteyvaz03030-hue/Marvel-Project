# Cloudflare-Worker einrichten

Der Worker macht zwei Dinge:

1. **TMDB-Proxy** — holt Poster und Porträts von TMDB, ohne dass der API-Key im
   Browser landet.
2. **Profil-Anmeldung** — prüft die PIN für die Profile beim Öffnen der Seite.

Beides steckt in **einer** Datei (`worker/marvel-worker.js`) und läuft unter
**einer** Adresse. Du musst also nur einmal deployen.

**Warum überhaupt?** Die Marvel-Seite liegt als statische Seite auf GitHub Pages.
Alles, was dort ausgeliefert wird, kann jeder Besucher lesen — ein TMDB-Key oder
eine PIN im JavaScript wäre also öffentlich. Der Worker läuft stattdessen auf
einem Server bei Cloudflare, kennt die Geheimnisse und gibt sie nie heraus.

---

## Vorher: neuen TMDB-Key erzeugen

Der bisherige Key war kurzzeitig im öffentlichen Repository sichtbar und gilt
damit als kompromittiert.

1. Auf <https://www.themoviedb.org> anmelden
2. Profilbild → **Einstellungen** → **API**
3. Beim vorhandenen API-Key (v3 auth) auf **Regenerate** klicken
4. Den **neuen** Key kopieren — er wird gleich bei Cloudflare gebraucht

Trage diesen Key **nirgendwo** im Marvel-Projekt ein.

---

## Schritt 1: Cloudflare-Konto anlegen

1. <https://dash.cloudflare.com/sign-up> öffnen
2. Mit E-Mail-Adresse registrieren und die Bestätigungsmail anklicken

Kostenlos, keine Kreditkarte nötig. Der kostenlose Tarif erlaubt 100.000
Anfragen pro Tag — für diese Seite um ein Vielfaches mehr als nötig.

## Schritt 2: Worker anlegen

1. Links im Menü **Compute (Workers)** → **Workers & Pages** anklicken
2. Button **Create application** → Reiter **Workers** → **Create Worker**
3. Einen Namen vergeben (z.B. `marvel-tmdb`)
4. Auf **Deploy** klicken (es wird zunächst ein Beispiel-Worker angelegt)

> Hast du den Worker schon von früher? Dann überspringe diesen Schritt und
> ersetze in Schritt 3 einfach den Code des vorhandenen Workers.

## Schritt 3: Den Code einsetzen

1. Auf **Edit code** klicken (öffnet den Online-Editor)
2. Den **gesamten** vorhandenen Code links markieren und löschen
3. Den kompletten Inhalt von `worker/marvel-worker.js` aus diesem Repository
   hineinkopieren
4. Oben rechts auf **Deploy** klicken

> Die frühere Datei `worker/tmdb-proxy.js` gibt es nicht mehr — `marvel-worker.js`
> enthält den TMDB-Teil unverändert plus die Anmeldung.

## Schritt 4: Die Secrets hinterlegen

Ein „Secret" ist ein Wert, den nur der Worker kennt. Cloudflare zeigt ihn nach
dem Speichern nicht mehr im Klartext an — das ist gewollt.

So legst du jedes Secret an:

1. Zurück zur Worker-Übersicht (Brotkrümel oben links, auf den Worker klicken)
2. Reiter **Settings** öffnen
3. Abschnitt **Variables and Secrets** → **Add**
4. **Type**: `Secret` (nicht „Text"!), dann Name und Wert eintragen
5. **Deploy** / **Save** klicken

Diese vier Secrets brauchst du:

| Name | Wert | Wofür |
|---|---|---|
| `TMDB_API_KEY` | dein neuer TMDB-Key | Poster und Porträts |
| `AUTH_SECRET` | langer Zufallswert (siehe unten) | signiert die Anmelde-Sitzungen |
| `AHMET_PIN_HASH` | Hash von Ahmets PIN (siehe unten) | Profil „Ahmet" |
| `BURAK_PIN_HASH` | Hash von Buraks PIN (siehe unten) | Profil „Burak" |

### AUTH_SECRET und die PIN-Hashes erzeugen

Öffne die Datei `worker/pin-hash-tool.html` per Doppelklick in deinem Browser.
Sie rechnet komplett auf deinem Gerät — es geht dabei nichts ins Internet.

1. Auf **Zufälliges AUTH_SECRET erzeugen** klicken → Wert kopieren → als Secret
   `AUTH_SECRET` bei Cloudflare eintragen
2. Profil **Ahmet** auswählen, die gewünschte PIN eingeben, **Hash erzeugen** →
   den langen Wert kopieren → als Secret `AHMET_PIN_HASH` eintragen
3. Dasselbe für **Burak** → Secret `BURAK_PIN_HASH`
4. Das Werkzeug wieder schließen

Aus dem Hash lässt sich die PIN nicht zurückrechnen. Trotzdem gilt: Hash und
`AUTH_SECRET` gehören **ausschließlich** in die Cloudflare-Secrets, niemals in
eine Datei des Projekts.

> **PIN vergessen oder ändern?** Einfach einen neuen Hash erzeugen und das
> Secret bei Cloudflare überschreiben. Sonst ändert sich nichts.

## Schritt 5: Adresse des Workers kopieren

Im Reiter **Settings** → **Domains & Routes** (oder direkt oben auf der
Worker-Seite) steht die Adresse. Sie sieht so aus:

```
https://marvel-tmdb.DEIN-SUBDOMAIN.workers.dev
```

`DEIN-SUBDOMAIN` legt Cloudflare beim ersten Worker automatisch an (oft dein
Kontoname). Diese komplette Adresse kopieren.

## Schritt 6: Adresse im Projekt eintragen

In `config.js` im Marvel-Projekt:

```js
tmdbProxyUrl: "https://marvel-tmdb.DEIN-SUBDOMAIN.workers.dev",
```

Wichtig: **ohne** Schrägstrich am Ende. Es ist dieselbe Adresse für Bilder und
Anmeldung — eine zweite Angabe gibt es nicht. Datei speichern, committen,
pushen — GitHub Pages übernimmt die Änderung nach etwa einer Minute.

## Schritt 7: Prüfen

1. Die Seite öffnen: <https://ahmeteyvaz03030-hue.github.io/Marvel-Project/>
2. Mit `Strg`+`F5` neu laden (alte Dateien aus dem Browser-Zwischenspeicher werfen)
3. Es erscheint der Startbildschirm mit den Profilen. Ein Profil anklicken → die
   PIN-Eingabe erscheint → richtige PIN eingeben → die Seite öffnet sich
4. Ein Universum öffnen und einen Charakter anklicken — es sollten echte Poster
   und Porträts erscheinen
5. Mit `F12` die Entwicklerwerkzeuge öffnen, Reiter **Network**: Die Anfragen
   gehen an `...workers.dev` und enthalten **keinen** `api_key`

---

## Alternative: per Kommandozeile (wenn du lieber tippst)

```bash
npm install -g wrangler
wrangler login
cd worker
wrangler deploy marvel-worker.js --name marvel-tmdb --compatibility-date 2024-11-01
wrangler secret put TMDB_API_KEY   --name marvel-tmdb   # Wert wird abgefragt
wrangler secret put AUTH_SECRET    --name marvel-tmdb
wrangler secret put AHMET_PIN_HASH --name marvel-tmdb
wrangler secret put BURAK_PIN_HASH --name marvel-tmdb
```

---

## Wenn etwas nicht klappt

| Symptom | Ursache und Lösung |
|---|---|
| Keine Bilder, Konsole zeigt `403` | Die Adresse in `ALLOWED_ORIGINS` (oben in `marvel-worker.js`) stimmt nicht mit deiner Seite überein. Anpassen und erneut deployen. |
| Konsole zeigt `500 Proxy ist nicht konfiguriert` | Das Secret `TMDB_API_KEY` fehlt oder heißt anders. Schritt 4 wiederholen. |
| Konsole zeigt `401` oder `404 TMDB-Anfrage fehlgeschlagen` | Der TMDB-Key ist ungültig oder abgelaufen. Neuen Key erzeugen und Secret aktualisieren. |
| Weiterhin die gezeichneten Grafiken | `tmdbProxyUrl` in `config.js` ist leer oder hat einen Tippfehler (z.B. Schrägstrich am Ende). |
| Es wird **keine** PIN verlangt | Die PIN-Secrets fehlen. Solange `AUTH_SECRET` und mindestens ein `*_PIN_HASH` nicht gesetzt sind, läuft die Seite bewusst wie früher ohne PIN weiter (damit du dich beim Einbau nicht aussperrst). Schritt 4 nachholen. |
| „ZUGANG VERWEIGERT" trotz richtiger PIN | Der Hash bei Cloudflare gehört zu einer anderen PIN oder steht beim falschen Profil. Neuen Hash erzeugen und das passende Secret überschreiben. |
| „Zu viele Versuche" | Schutz gegen Durchprobieren. Eine halbe Minute warten, dann geht es weiter. |
| Nichts passiert, keine Netzwerkanfragen | Browser-Zwischenspeicher: mit `Strg`+`F5` neu laden. |

**Schnelltest, ob der Worker läuft:** Öffne die Seite, dann `F12` → Reiter
**Console** und tippe:

```js
fetch(MARVEL_CONFIG.tmdbProxyUrl + "/health").then(r => r.json()).then(console.log)
```

Erwartete Antwort: `{ ok: true, tmdb: { keyConfigured: true }, auth: { configured: true } }`.
Die Werte selbst werden nicht angezeigt — nur ob sie gesetzt sind.

---

## Lokales Testen (optional)

Beim Testen über `http://localhost:...` weist der Worker die Anfragen ab, weil
die Adresse nicht in `ALLOWED_ORIGINS` steht. Für lokale Tests die eigene
Adresse dort ergänzen und erneut deployen:

```js
const ALLOWED_ORIGINS = [
  "https://ahmeteyvaz03030-hue.github.io",
  "http://localhost:8756",
];
```

---

## Was der Worker absichtlich NICHT tut

- Er gibt den TMDB-Key niemals zurück und schreibt ihn in kein Protokoll
  (die Datei enthält bewusst kein `console.log`).
- Er speichert **keine PIN**. Gespeichert ist nur der Hash als Cloudflare-Secret;
  aus ihm lässt sich die PIN nicht zurückrechnen. Die PIN steht auch in keiner
  Fehlermeldung und in keiner Antwort an den Browser.
- Er schickt beim Anmelden nur ein signiertes Ticket zurück. Wer dieses Ticket im
  Browser-Speicher verändert oder selbst erfindet, kommt nicht hinein — die
  Unterschrift lässt sich ohne `AUTH_SECRET` nicht nachbauen, und sie wird bei
  jedem Seitenaufruf beim Worker gegengeprüft.
- Er erlaubt beim TMDB-Teil nur GET und nur diese Pfade:
  `/search/movie`, `/search/person`, `/search/tv`,
  `/movie/{id}`, `/movie/{id}/images`, `/movie/{id}/credits`.
- Er reicht nur bekannte Parameter weiter; ein mitgeschickter `api_key` aus dem
  Browser wird verworfen.

**Ehrlicher Hinweis:** Die Worker-Adresse selbst ist öffentlich. Jemand, der sie
kennt, könnte darüber Anfragen stellen und dein TMDB-Kontingent mitbenutzen. Die
Origin-Prüfung hält normale Browser-Zugriffe von fremden Seiten ab, lässt sich
aber außerhalb eines Browsers umgehen. Dein **Key** und deine **PIN** bleiben in
jedem Fall geschützt — und das Kontingent (Cloudflare 100.000 Anfragen/Tag) ist
für diese Seite reichlich bemessen. Bei Missbrauch: Worker umbenennen oder in den
Cloudflare-Einstellungen eine Rate-Limit-Regel ergänzen.
