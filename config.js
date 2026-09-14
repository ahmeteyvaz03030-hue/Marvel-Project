// ---------------------------------------------------------------------------
// Konfiguration für dynamisch geladene Bilder (Filmposter, Backdrops, Porträts)
// ---------------------------------------------------------------------------
// WICHTIG: Hier steht bewusst KEIN API-Key mehr.
//
// Diese Datei wird von GitHub Pages unverändert an jeden Besucher ausgeliefert.
// Alles, was hier drinsteht, ist öffentlich lesbar — ein API-Key gehört daher
// niemals in diese Datei (auch nicht über ein GitHub-Secret beim Build, weil
// der Wert dabei ebenfalls in die ausgelieferte Datei geschrieben würde).
//
// Der Key wird stattdessen serverseitig gehalten. Die Seite spricht dann nicht
// mehr direkt mit api.themoviedb.org, sondern mit einem kleinen Proxy, der den
// Key kennt und die Anfragen weiterreicht.
window.MARVEL_CONFIG = {
  // Adresse des TMDB-Proxys (ohne abschließenden Schrägstrich), z.B.
  // "https://marvel-tmdb.<name>.workers.dev". Solange der Wert leer ist, werden
  // keine TMDB-Anfragen gestellt und überall greifen die generierten Grafiken.
  tmdbProxyUrl: "https://restless-base-c561.ahmeteyvaz85.workers.dev",

  // Sprache für Titel/Bilder der TMDB-Suche.
  tmdbLanguage: "de-DE",

  // Wie lange geladene Bild-URLs lokal zwischengespeichert werden (Stunden).
  imageCacheHours: 168,

  // Auf true setzen, um die Bildsuche Schritt für Schritt in der Browser-Konsole
  // mitzuschreiben (Film-ID, gefundene Besetzung, profile_path, fertige Bild-URL).
  debugImages: falsse,
};
