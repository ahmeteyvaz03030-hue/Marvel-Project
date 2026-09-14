# TMDB-Proxy einrichten (Cloudflare Worker)

Diese Anleitung ist für den einmaligen Aufbau gedacht. Danach musst du hier
nichts mehr anfassen.

**Warum überhaupt?** Die Marvel-Seite liegt als statische Seite auf GitHub Pages.
Alles, was dort ausgeliefert wird, kann jeder Besucher lesen — ein TMDB-Key im
JavaScript wäre also öffentlich. Der Worker läuft stattdessen auf einem Server
bei Cloudflare, kennt den Key und reicht nur die erlaubten Anfragen an TMDB
weiter. Der Browser sieht den Key nie.

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
3. Als Namen `marvel-tmdb` eintragen
4. Auf **Deploy** klicken (es wird zunächst ein Beispiel-Worker angelegt)

## Schritt 3: Den Code einsetzen

1. Auf **Edit code** klicken (öffnet den Online-Editor)
2. Den **gesamten** vorhandenen Beispielcode links markieren und löschen
3. Den kompletten Inhalt von `worker/tmdb-proxy.js` aus diesem Repository
   hineinkopieren
4. Oben rechts auf **Deploy** klicken

## Schritt 4: TMDB-Key als Secret hinterlegen

> Genau hier kommt dein Key hin — und nur hier.

1. Zurück zur Worker-Übersicht (Brotkrümel oben links, auf `marvel-tmdb` klicken)
2. Reiter **Settings** öffnen
3. Abschnitt **Variables and Secrets** → **Add**
4. Ausfüllen:
   - **Type**: `Secret` (nicht „Text"!)
   - **Variable name**: `TMDB_API_KEY`
   - **Value**: dein neuer TMDB-Key
5. **Deploy** / **Save** klicken

Cloudflare zeigt den Wert danach nicht mehr im Klartext an — das ist gewollt.

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

Wichtig: **ohne** Schrägstrich am Ende. Datei speichern, committen, pushen —
GitHub Pages übernimmt die Änderung nach etwa einer Minute.

## Schritt 7: Prüfen

1. Die Seite öffnen: <https://ahmeteyvaz03030-hue.github.io/Marvel-Project/>
2. Mit `Strg`+`F5` neu laden (alte Dateien aus dem Browser-Zwischenspeicher werfen)
3. Ein Universum öffnen und einen Charakter anklicken — es sollten echte Poster
   und Porträts erscheinen
4. Mit `F12` die Entwicklerwerkzeuge öffnen, Reiter **Network**: Die Anfragen
   gehen an `marvel-tmdb...workers.dev` und enthalten **keinen** `api_key`

---

## Alternative: per Kommandozeile (wenn du lieber tippst)

```bash
npm install -g wrangler
wrangler login
cd worker
wrangler deploy tmdb-proxy.js --name marvel-tmdb --compatibility-date 2024-11-01
wrangler secret put TMDB_API_KEY --name marvel-tmdb   # Key wird abgefragt
```

---

## Wenn etwas nicht klappt

| Symptom | Ursache und Lösung |
|---|---|
| Keine Bilder, Konsole zeigt `403` | Die Adresse in `ALLOWED_ORIGINS` (oben in `tmdb-proxy.js`) stimmt nicht mit deiner Seite überein. Anpassen und erneut deployen. |
| Konsole zeigt `500 Proxy ist nicht konfiguriert` | Das Secret `TMDB_API_KEY` fehlt oder heißt anders. Schritt 4 wiederholen. |
| Konsole zeigt `401` oder `404 TMDB-Anfrage fehlgeschlagen` | Der TMDB-Key ist ungültig oder abgelaufen. Neuen Key erzeugen und Secret aktualisieren. |
| Weiterhin die gezeichneten Grafiken | `tmdbProxyUrl` in `config.js` ist leer oder hat einen Tippfehler (z.B. Schrägstrich am Ende). |
| Nichts passiert, keine Netzwerkanfragen | Browser-Zwischenspeicher: mit `Strg`+`F5` neu laden. |

**Schnelltest, ob der Worker läuft:** Öffne die Seite, dann `F12` → Reiter
**Console** und tippe:

```js
fetch(MARVEL_CONFIG.tmdbProxyUrl + "/health").then(r => r.json()).then(console.log)
```

Erwartete Antwort: `{ ok: true, keyConfigured: true }`.
Steht dort `keyConfigured: false`, fehlt das Secret aus Schritt 4.

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

- Er gibt den Key niemals zurück und schreibt ihn in kein Protokoll
  (die Datei enthält bewusst kein `console.log`).
- Er erlaubt nur GET und nur diese Pfade:
  `/search/movie`, `/search/person`, `/search/tv`,
  `/movie/{id}`, `/movie/{id}/images`, `/movie/{id}/credits`.
- Er reicht nur bekannte Parameter weiter; ein mitgeschickter `api_key` aus dem
  Browser wird verworfen.

**Ehrlicher Hinweis:** Die Worker-Adresse selbst ist öffentlich. Jemand, der sie
kennt, könnte darüber Anfragen stellen und dein TMDB-Kontingent mitbenutzen. Die
Origin-Prüfung hält normale Browser-Zugriffe von fremden Seiten ab, lässt sich
aber außerhalb eines Browsers umgehen. Dein **Key** bleibt in jedem Fall
geschützt — und das Kontingent (Cloudflare 100.000 Anfragen/Tag) ist für diese
Seite reichlich bemessen. Bei Missbrauch: Worker umbenennen oder in den
Cloudflare-Einstellungen eine Rate-Limit-Regel ergänzen.
