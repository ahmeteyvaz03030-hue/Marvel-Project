// ---------------------------------------------------------------------------
// Konfiguration für dynamisch geladene Bilder (Filmposter, Backdrops, Porträts)
// ---------------------------------------------------------------------------
// Die Seite lädt Bilder NICHT fest im Code hinterlegt, sondern zur Laufzeit über
// die kostenlose TMDB-API (https://www.themoviedb.org).
//
// So aktivierst du echte Bilder:
//   1. Kostenloses Konto auf https://www.themoviedb.org anlegen
//   2. Unter Einstellungen → API einen (kostenlosen) API-Key beantragen
//   3. Den Key unten bei tmdbApiKey eintragen und die Datei speichern/pushen
//
// Ohne Key funktioniert die Seite unverändert weiter: überall, wo ein Bild
// fehlt, greift automatisch die generierte Grafik als Fallback.
window.MARVEL_CONFIG = {
  // TMDB API-Key (v3). Leer lassen = Bilder aus, generierte Grafiken werden genutzt.
  tmdbApiKey: "d7b2e68bd235042bd3e895e8eb7522a2",

  // Sprache für Titel/Bilder der TMDB-Suche.
  tmdbLanguage: "de-DE",

  // Wie lange geladene Bild-URLs lokal zwischengespeichert werden (Stunden).
  imageCacheHours: 168,

  // Auf true setzen, um die Bildsuche Schritt für Schritt in der Browser-Konsole
  // mitzuschreiben (Film-ID, gefundene Besetzung, profile_path, fertige Bild-URL).
  debugImages: true,
};
