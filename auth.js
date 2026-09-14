// ---------------------------------------------------------------------------
// Profil-Anmeldung: spricht mit dem /auth/*-Teil des Cloudflare-Workers.
//
// Grundsätze:
//   - Die PIN wird nur zum Prüfen an den Worker geschickt und danach sofort
//     verworfen. Sie wird nie gespeichert und steht nirgends im Code.
//   - Gespeichert wird ausschließlich ein vom Worker signiertes Token. Wer es im
//     Browser-Speicher verändert, macht es ungültig — die Signatur lässt sich
//     ohne das Server-Secret nicht nachbauen.
//   - Beim Laden der Seite wird das Token immer beim Worker gegengeprüft, nicht
//     nur lokal "geglaubt".
// ---------------------------------------------------------------------------
window.MarvelAuth = (function () {
  "use strict";

  const CFG = window.MARVEL_CONFIG || {};
  // Auth läuft auf demselben Worker wie der TMDB-Proxy.
  const BASE = (CFG.tmdbProxyUrl || "").trim().replace(/\/+$/, "");
  const TOKEN_KEY = "marvelSession";

  let statusCache = null;

  function hasBackend() {
    return BASE.length > 0;
  }

  // Token liegt entweder nur für diese Browser-Sitzung (sessionStorage) oder
  // für den gemerkten Zeitraum (localStorage).
  function readToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || null;
    } catch (e) {
      return null;
    }
  }

  function storeToken(token, remember) {
    clearToken();
    try {
      if (remember) localStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.setItem(TOKEN_KEY, token);
    } catch (e) {
      /* Speicher gesperrt — dann gilt die Sitzung nur bis zum Neuladen */
    }
  }

  function clearToken() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* ignorieren */
    }
  }

  function post(path, body) {
    return fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // Ist die Anmeldung auf dem Worker überhaupt eingerichtet?
  // Solange nicht, läuft die Seite wie bisher ohne PIN weiter — sonst wäre man
  // nach dem Einbau vor der eigenen Tür ausgesperrt.
  function status() {
    if (!hasBackend()) return Promise.resolve({ configured: false, reachable: false, profiles: [] });
    if (statusCache) return Promise.resolve(statusCache);

    return fetch(BASE + "/auth/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        statusCache = data
          ? { configured: Boolean(data.configured), reachable: true, profiles: data.profiles || [] }
          : { configured: false, reachable: false, profiles: [] };
        return statusCache;
      })
      .catch(() => {
        statusCache = { configured: false, reachable: false, profiles: [] };
        return statusCache;
      });
  }

  /**
   * Meldet ein Profil mit PIN an.
   * Rückgabe: { ok: true, profile } oder { ok: false, reason, retryAfter }
   */
  function login(profile, pin, remember) {
    if (!hasBackend()) return Promise.resolve({ ok: false, reason: "offline" });

    return post("/auth/login", { profile, pin, remember: Boolean(remember) })
      .then((response) =>
        response
          .json()
          .catch(() => ({}))
          .then((data) => ({ response, data }))
      )
      .then(({ response, data }) => {
        if (response.ok && data.token) {
          storeToken(data.token, remember);
          return { ok: true, profile: data.profile };
        }
        if (response.status === 429) {
          return { ok: false, reason: "locked", retryAfter: data.retryAfter || 30 };
        }
        if (response.status === 503) return { ok: false, reason: "not-configured" };
        return { ok: false, reason: "denied", slowDown: Boolean(data.slowDown) };
      })
      .catch(() => ({ ok: false, reason: "offline" }));
  }

  /**
   * Prüft die gespeicherte Sitzung beim Worker.
   * Rückgabe: Profil-Kennung oder null.
   */
  function verify() {
    const token = readToken();
    if (!token || !hasBackend()) return Promise.resolve(null);

    return post("/auth/verify", { token })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.valid) return data.profile;
        clearToken();
        return null;
      })
      .catch(() => null);
  }

  function logout() {
    clearToken();
    statusCache = null;
  }

  return { status, login, verify, logout, hasBackend, clearToken };
})();
