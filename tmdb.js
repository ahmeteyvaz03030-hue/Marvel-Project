// ---------------------------------------------------------------------------
// Bild-Service: lädt Filmposter, Backdrops und Personen-Porträts dynamisch über
// die TMDB-API. Keine Bild-URL ist fest im Code hinterlegt.
//
// Verhalten ohne API-Key (oder bei Netzwerkfehlern): jede Anfrage liefert null,
// die Oberfläche fällt automatisch auf ihre generierten Grafiken zurück.
// ---------------------------------------------------------------------------
window.TMDB = (function () {
  "use strict";

  const CFG = window.MARVEL_CONFIG || {};
  const KEY = (CFG.tmdbApiKey || "").trim();
  const LANG = CFG.tmdbLanguage || "de-DE";
  const TTL_MS = (CFG.imageCacheHours || 168) * 3600 * 1000;
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p";
  const CACHE_PREFIX = "tmdbCache:";

  // Läuft nur, wenn ein Key konfiguriert ist.
  function enabled() {
    return KEY.length > 0;
  }

  // ---------- Cache (localStorage, mit Ablaufzeit; auch negative Treffer) ----------
  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return undefined;
      const entry = JSON.parse(raw);
      if (!entry || typeof entry.ts !== "number") return undefined;
      if (Date.now() - entry.ts > TTL_MS) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return undefined;
      }
      return entry.value;
    } catch (e) {
      return undefined;
    }
  }

  function cacheSet(key, value) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), value }));
    } catch (e) {
      /* Speicher voll oder gesperrt — Cache ist optional */
    }
  }

  // ---------- Netzwerk ----------
  const inFlight = new Map();

  function request(pathname, params) {
    const url = new URL(API + pathname);
    url.searchParams.set("api_key", KEY);
    url.searchParams.set("language", LANG);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });
    const href = url.toString();

    if (inFlight.has(href)) return inFlight.get(href);
    const p = fetch(href)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .finally(() => inFlight.delete(href));
    inFlight.set(href, p);
    return p;
  }

  function imageUrl(filePath, size) {
    return filePath ? `${IMG}/${size}${filePath}` : null;
  }

  // ---------- Filme ----------
  // Titel werden vorher von Zusätzen wie "(Cameo)" oder "*" befreit, damit die
  // Suche auch bei den Anzeigetiteln der Seite trifft.
  function normalizeTitle(title) {
    return String(title || "")
      .replace(/\s*\(.*?\)\s*/g, " ")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function movieImages(title, year) {
    const clean = normalizeTitle(title);
    if (!enabled() || !clean) return Promise.resolve(null);

    const key = `movie:${clean.toLowerCase()}:${year || ""}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return Promise.resolve(cached);

    return request("/search/movie", { query: clean, year: year, include_adult: "false" }).then((data) => {
      const hit = data && Array.isArray(data.results) && data.results.length ? data.results[0] : null;
      const value = hit
        ? {
            poster: imageUrl(hit.poster_path, "w342"),
            backdrop: imageUrl(hit.backdrop_path, "w1280"),
            tmdbId: hit.id,
          }
        : null;
      cacheSet(key, value);
      return value;
    });
  }

  function moviePoster(title, year) {
    return movieImages(title, year).then((m) => (m && m.poster) || null);
  }

  function movieBackdrop(title, year) {
    return movieImages(title, year).then((m) => (m && m.backdrop) || null);
  }

  // ---------- Personen (Schauspieler-Porträts) ----------
  // Der Rollen-Text der Seite enthält teils Zusätze wie "Robert Downey Jr." mit
  // Kommentaren — hier wird nur der reine Name verwendet.
  function normalizePerson(name) {
    return String(name || "")
      .replace(/\s*\(.*?\)\s*/g, " ")
      .replace(/\s*[–—-]\s*.*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function personPhoto(name) {
    const clean = normalizePerson(name);
    if (!enabled() || !clean) return Promise.resolve(null);

    const key = `person:${clean.toLowerCase()}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return Promise.resolve(cached);

    return request("/search/person", { query: clean, include_adult: "false" }).then((data) => {
      const hit = data && Array.isArray(data.results) && data.results.length ? data.results[0] : null;
      const value = hit ? imageUrl(hit.profile_path, "w342") : null;
      cacheSet(key, value);
      return value;
    });
  }

  return {
    enabled,
    moviePoster,
    movieBackdrop,
    movieImages,
    personPhoto,
  };
})();
