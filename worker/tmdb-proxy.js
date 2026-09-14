/**
 * TMDB-Proxy als Cloudflare Worker
 * ---------------------------------------------------------------------------
 * Zweck: Die Marvel-Multiverse-Seite liegt als statische Seite auf GitHub Pages.
 * Ein API-Key im Browser wäre dort für jeden lesbar. Dieser Worker hält den Key
 * serverseitig, nimmt die Anfragen der Seite entgegen und reicht sie an TMDB
 * weiter.
 *
 * Sicherheitsregeln in dieser Datei:
 *   - Der Key steht ausschließlich im Worker-Secret TMDB_API_KEY.
 *   - Der Key wird niemals geloggt, in eine Antwort geschrieben oder an den
 *     Browser zurückgegeben. Die Datei enthält bewusst KEIN console.log, damit
 *     auch versehentlich nichts in den Cloudflare-Logs landet.
 *   - Nur die tatsächlich benötigten TMDB-Endpunkte sind freigegeben.
 *   - Nur Anfragen von der eigenen GitHub-Pages-Adresse werden beantwortet.
 *
 * Bilder (image.tmdb.org) laufen NICHT über diesen Proxy — sie brauchen keinen
 * Key und werden vom Browser direkt geladen.
 */

// Adressen, die den Proxy benutzen dürfen.
// Für lokales Testen hier vorübergehend die eigene Adresse ergänzen,
// z.B. "http://localhost:8756".
const ALLOWED_ORIGINS = ["https://ahmeteyvaz03030-hue.github.io"];

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
// Besetzung und Logos ändern sich praktisch nie, Suchergebnisse selten.
function cacheSeconds(path) {
  if (/\/credits$/.test(path) || /\/images$/.test(path)) return 86400; // 24 Stunden
  return 21600; // 6 Stunden
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Fehlerantworten bleiben bewusst allgemein — sie enthalten weder den Key
// noch die aufgerufene TMDB-Adresse.
function deny(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  Object.entries(extra).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, headers });
}

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

    if (request.method !== "GET") {
      return deny(405, "Nur GET wird unterstützt", allowedOrigin);
    }

    // Nur die eigene Seite darf den Proxy benutzen.
    if (!allowedOrigin) {
      return deny(403, "Origin nicht erlaubt");
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Kurzer Statuscheck, praktisch nach dem Deployen ("läuft der Worker?").
    // Gibt absichtlich nur zurück, OB ein Key hinterlegt ist — nie den Key selbst.
    if (path === "/health") {
      return new Response(
        JSON.stringify({ ok: true, keyConfigured: Boolean(env.TMDB_API_KEY) }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...corsHeaders(allowedOrigin),
          },
        }
      );
    }

    if (!ALLOWED_PATHS.some((re) => re.test(path))) {
      return deny(404, "Dieser Endpunkt ist nicht freigegeben", allowedOrigin);
    }

    if (!env.TMDB_API_KEY) {
      return deny(500, "Proxy ist nicht konfiguriert", allowedOrigin);
    }

    const ttl = cacheSeconds(path);

    // ---- Zwischenspeicher am Rand des Netzwerks ----
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

    // ---- Anfrage an TMDB ----
    // Diese Adresse enthält den Key und wird deshalb weder geloggt noch
    // irgendwo ausgegeben.
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

    // Ohne CORS-Kopfzeilen ablegen; die werden beim Ausliefern gesetzt.
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
  },
};
