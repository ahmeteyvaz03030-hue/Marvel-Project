/**
 * Marvel-Multiverse Worker (Cloudflare)
 * ===========================================================================
 * Dieser eine Worker erfüllt zwei klar getrennte Aufgaben:
 *
 *   TEIL 1 — TMDB-Proxy   (alle Pfade außer /auth/*)
 *            Hält den TMDB-Key serverseitig und reicht erlaubte Anfragen weiter.
 *
 *   TEIL 2 — Profil-Anmeldung (/auth/*)
 *            Prüft die PIN eines Profils gegen einen serverseitig hinterlegten
 *            Hash und stellt ein signiertes Sitzungs-Token aus.
 *
 * Beide Teile teilen sich nur die CORS-/Origin-Prüfung. Der TMDB-Key wird
 * ausschließlich in Teil 1 gelesen, die Anmelde-Secrets ausschließlich in Teil 2.
 *
 * Secrets, die im Cloudflare-Dashboard hinterlegt sein müssen:
 *   TMDB_API_KEY     — TMDB-Schlüssel (war schon vorhanden, bitte unverändert lassen)
 *   AUTH_SECRET      — langer Zufallstext zum Signieren der Sitzungen
 *   AHMET_PIN_HASH   — PIN-Hash von Ahmet  (mit worker/pin-hash-tool.html erzeugt)
 *   BURAK_PIN_HASH   — PIN-Hash von Burak  (mit worker/pin-hash-tool.html erzeugt)
 *
 * In dieser Datei stehen absichtlich KEINE console.log-Aufrufe: weder PIN noch
 * Hash, Token oder TMDB-Adresse dürfen je in einem Protokoll landen.
 */

// Adressen, die den Worker benutzen dürfen.
// Für lokales Testen hier vorübergehend die eigene Adresse ergänzen,
// z.B. "http://localhost:8756".
const ALLOWED_ORIGINS = ["https://ahmeteyvaz03030-hue.github.io"];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Fehlerantworten bleiben bewusst allgemein — sie enthalten weder Secrets
// noch die aufgerufene TMDB-Adresse.
function deny(status, message, origin, extra) {
  return new Response(JSON.stringify(Object.assign({ error: message }, extra || {})), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

function jsonResponse(data, origin, status, cacheControl) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl || "no-store",
      ...corsHeaders(origin),
    },
  });
}

function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  Object.entries(extra).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, headers });
}

/* ===========================================================================
 * TEIL 1 — TMDB-Proxy
 * ======================================================================== */

// Freigegebene TMDB-Pfade. Alles andere wird abgewiesen.
const ALLOWED_PATHS = [
  /^\/search\/movie$/, // Filmsuche (Poster, Backdrops, Film-ID)
  /^\/search\/person$/, // Personensuche (Schauspieler-Porträts)
  /^\/search\/tv$/, // Seriensuche (Serien-Poster)
  /^\/movie\/\d+$/, // Filmdetails (Beschreibung, Kinostart)
  /^\/movie\/\d+\/images$/, // Film-Logos
  /^\/movie\/\d+\/credits$/, // Besetzung (z.B. Reed Richards / Pedro Pascal)
];

// Nur diese Query-Parameter werden weitergereicht. Ein vom Browser
// mitgeschickter api_key würde hier ohnehin verworfen.
const ALLOWED_PARAMS = [
  "query",
  "year",
  "language",
  "include_adult",
  "include_image_language",
  "first_air_date_year",
  "page",
];

const TMDB_BASE = "https://api.themoviedb.org/3";

// Wie lange eine Antwort zwischengespeichert werden darf.
function cacheSeconds(path) {
  if (/\/credits$/.test(path) || /\/images$/.test(path)) return 86400; // 24 Stunden
  return 21600; // 6 Stunden
}

async function handleTmdb(request, env, ctx, url, path, allowedOrigin) {
  if (request.method !== "GET") {
    return deny(405, "Nur GET wird unterstützt", allowedOrigin);
  }

  if (!ALLOWED_PATHS.some((re) => re.test(path))) {
    return deny(404, "Dieser Endpunkt ist nicht freigegeben", allowedOrigin);
  }

  if (!env.TMDB_API_KEY) {
    return deny(500, "Proxy ist nicht konfiguriert", allowedOrigin);
  }

  const ttl = cacheSeconds(path);

  // Der Cache-Schlüssel ist die Anfrage der Seite (ohne Key), nicht die
  // TMDB-Adresse — dadurch landet der Key nie im Cache-Schlüssel.
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return withHeaders(cached, { ...corsHeaders(allowedOrigin), "X-Proxy-Cache": "HIT" });
    }
  } catch (e) {
    // Cache ist optional — bei Problemen wird einfach frisch geladen.
  }

  // Diese Adresse enthält den Key und wird deshalb weder geloggt noch ausgegeben.
  const upstream = new URL(TMDB_BASE + path);
  ALLOWED_PARAMS.forEach((name) => {
    const value = url.searchParams.get(name);
    if (value !== null && value !== "") upstream.searchParams.set(name, value);
  });
  upstream.searchParams.set("api_key", env.TMDB_API_KEY);

  let tmdbResponse;
  try {
    tmdbResponse = await fetch(upstream.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cf: { cacheTtl: ttl, cacheEverything: true },
    });
  } catch (e) {
    return deny(502, "TMDB ist derzeit nicht erreichbar", allowedOrigin);
  }

  if (!tmdbResponse.ok) {
    // Statuscode wird durchgereicht, der Antworttext von TMDB bewusst nicht.
    return deny(tmdbResponse.status, "TMDB-Anfrage fehlgeschlagen", allowedOrigin);
  }

  const body = await tmdbResponse.text();

  const toCache = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${ttl}`,
    },
  });

  try {
    ctx.waitUntil(cache.put(cacheKey, toCache.clone()));
  } catch (e) {
    // Auch ohne Cache funktioniert der Proxy.
  }

  return withHeaders(toCache, { ...corsHeaders(allowedOrigin), "X-Proxy-Cache": "MISS" });
}

/* ===========================================================================
 * TEIL 2 — Profil-Anmeldung mit PIN
 * ======================================================================== */

// Welches Profil welches Secret benutzt. Die Anzeigenamen stehen weiterhin
// ausschließlich im Frontend (data.js) — hier steht nur die Zuordnung.
const PROFILE_SECRETS = {
  ahmet: "AHMET_PIN_HASH",
  burak: "BURAK_PIN_HASH",
};

const SESSION_SECONDS = 12 * 3600; // normale Sitzung: 12 Stunden
const REMEMBER_SECONDS = 14 * 24 * 3600; // "Auf diesem Gerät merken": 14 Tage

const encoder = new TextEncoder();

function base64urlFromBytes(bytes) {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromBase64url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64urlFromString(text) {
  return base64urlFromBytes(encoder.encode(text));
}

function stringFromBase64url(text) {
  return new TextDecoder().decode(bytesFromBase64url(text));
}

// Vergleich ohne Zeitunterschiede, damit sich ein Hash nicht Byte für Byte erraten lässt.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Prüft eine PIN gegen einen gespeicherten Hash.
 * Format des Hashes: pbkdf2$sha256$<iterationen>$<salt base64url>$<hash base64url>
 * Die PIN selbst wird nirgends gespeichert, geloggt oder zurückgegeben.
 */
async function verifyPin(pin, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;

  const iterations = parseInt(parts[2], 10);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 1000000) return false;

  const salt = bytesFromBase64url(parts[3]);
  const expected = bytesFromBase64url(parts[4]);

  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    expected.length * 8
  );

  return timingSafeEqual(new Uint8Array(bits), expected);
}

// ---- Sitzungs-Token (signiert, damit es sich im Browser nicht fälschen lässt) ----
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createToken(profile, seconds, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    p: profile,
    iat: now,
    exp: now + seconds,
    jti: base64urlFromBytes(crypto.getRandomValues(new Uint8Array(12))),
  };
  const body = base64urlFromString(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return { token: `${body}.${base64urlFromBytes(signature)}`, expiresAt: payload.exp };
}

async function readToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;

  const key = await hmacKey(secret);
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", key, bytesFromBase64url(parts[1]), encoder.encode(parts[0]));
  } catch (e) {
    return null;
  }
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(stringFromBase64url(parts[0]));
  } catch (e) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload.exp !== "number" || payload.exp <= now) return null;
  if (!Object.prototype.hasOwnProperty.call(PROFILE_SECRETS, payload.p)) return null;
  return payload;
}

// ---- Schutz gegen sehr viele Versuche ----
// Zähler im Arbeitsspeicher des Workers: bremst Rateversuche spürbar aus, sperrt
// aber niemanden dauerhaft aus. (Best effort — Cloudflare kann Instanzen neu
// starten. Für mehr Härte ließe sich später Cloudflare KV ergänzen.)
const attempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const SOFT_LIMIT = 5; // ab hier kurze Verzögerung
const HARD_LIMIT = 8; // ab hier kurze Sperre
const LOCK_MS = 30 * 1000;

function attemptKey(request, profile) {
  const ip = request.headers.get("CF-Connecting-IP") || "unbekannt";
  return `${ip}|${profile}`;
}

function attemptState(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > ATTEMPT_WINDOW_MS) {
    const fresh = { count: 0, first: now, lockedUntil: 0 };
    attempts.set(key, fresh);
    return fresh;
  }
  return entry;
}

function noteFailure(key) {
  const state = attemptState(key);
  state.count++;
  if (state.count >= HARD_LIMIT) state.lockedUntil = Date.now() + LOCK_MS;

  // Alte Einträge gelegentlich aufräumen, damit die Map nicht wächst.
  if (attempts.size > 500) {
    const now = Date.now();
    attempts.forEach((value, mapKey) => {
      if (now - value.first > ATTEMPT_WINDOW_MS) attempts.delete(mapKey);
    });
  }
  return state;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleAuth(request, env, url, path, allowedOrigin) {
  const configured = Boolean(env.AUTH_SECRET) &&
    Object.values(PROFILE_SECRETS).some((name) => Boolean(env[name]));

  // ---- Status: sagt dem Frontend nur, OB die Anmeldung eingerichtet ist ----
  if (path === "/auth/status" && request.method === "GET") {
    return jsonResponse(
      {
        configured,
        profiles: Object.keys(PROFILE_SECRETS).filter((id) => Boolean(env[PROFILE_SECRETS[id]])),
      },
      allowedOrigin
    );
  }

  if (request.method !== "POST") {
    return deny(405, "Nur POST wird unterstützt", allowedOrigin);
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (e) {
    return deny(400, "Ungültige Anfrage", allowedOrigin);
  }

  // ---- Anmelden ----
  if (path === "/auth/login") {
    const profile = String(payload.profile || "").toLowerCase();
    const pin = String(payload.pin || "");
    const remember = payload.remember === true;

    if (!configured || !env.AUTH_SECRET) {
      return deny(503, "Anmeldung ist noch nicht eingerichtet", allowedOrigin);
    }
    if (!Object.prototype.hasOwnProperty.call(PROFILE_SECRETS, profile)) {
      return deny(403, "Zugang verweigert", allowedOrigin);
    }

    const key = attemptKey(request, profile);
    const state = attemptState(key);
    if (state.lockedUntil > Date.now()) {
      const retryAfter = Math.ceil((state.lockedUntil - Date.now()) / 1000);
      return deny(429, "Zu viele Versuche", allowedOrigin, { retryAfter });
    }

    // Grundverzögerung gegen schnelles Durchprobieren, zusätzlich ab SOFT_LIMIT.
    await wait(state.count >= SOFT_LIMIT ? 2000 : 150);

    const storedHash = env[PROFILE_SECRETS[profile]];
    if (!storedHash) {
      return deny(503, "Für dieses Profil ist noch keine PIN hinterlegt", allowedOrigin);
    }

    let ok = false;
    try {
      ok = await verifyPin(pin, storedHash);
    } catch (e) {
      ok = false;
    }

    if (!ok) {
      const after = noteFailure(key);
      const body = { error: "Zugang verweigert" };
      if (after.count >= SOFT_LIMIT) body.slowDown = true;
      return deny(401, body.error, allowedOrigin, body.slowDown ? { slowDown: true } : {});
    }

    attempts.delete(key);
    const { token, expiresAt } = await createToken(
      profile,
      remember ? REMEMBER_SECONDS : SESSION_SECONDS,
      env.AUTH_SECRET
    );
    // Zurück geht nur das Token — niemals PIN oder Hash.
    return jsonResponse({ ok: true, profile, token, expiresAt }, allowedOrigin);
  }

  // ---- Sitzung prüfen ----
  if (path === "/auth/verify") {
    if (!env.AUTH_SECRET) return deny(503, "Anmeldung ist noch nicht eingerichtet", allowedOrigin);
    const data = await readToken(payload.token, env.AUTH_SECRET);
    if (!data) return deny(401, "Sitzung ungültig", allowedOrigin);
    return jsonResponse({ valid: true, profile: data.p, expiresAt: data.exp }, allowedOrigin);
  }

  return deny(404, "Unbekannter Endpunkt", allowedOrigin);
}

/* ===========================================================================
 * Einstiegspunkt
 * ======================================================================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : null;

    // Vorabfrage des Browsers (CORS-Preflight)
    if (request.method === "OPTIONS") {
      if (!allowedOrigin) return deny(403, "Origin nicht erlaubt");
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }

    // Nur die eigene Seite darf den Worker benutzen.
    if (!allowedOrigin) return deny(403, "Origin nicht erlaubt");

    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Kurzer Statuscheck nach dem Deployen. Gibt nur zurück, OB etwas hinterlegt
    // ist — niemals einen Wert.
    if (path === "/health") {
      return jsonResponse(
        {
          ok: true,
          keyConfigured: Boolean(env.TMDB_API_KEY),
          authConfigured: Boolean(env.AUTH_SECRET) &&
            Object.values(PROFILE_SECRETS).some((name) => Boolean(env[name])),
        },
        allowedOrigin
      );
    }

    if (path.indexOf("/auth/") === 0) {
      return handleAuth(request, env, url, path, allowedOrigin);
    }

    return handleTmdb(request, env, ctx, url, path, allowedOrigin);
  },
};
