// ---------------------------------------------------------------------------
// Persönliches Fortschrittssystem (Datenebene, ohne DOM)
//
// - Katalog: alle Filme und Serien aus data.js genau einmal, mit stabiler ID
//   ("movie:iron-man-2008", "series:loki-2021"). TMDB-IDs sind in den Daten
//   nicht hinterlegt, deshalb wird ein stabiler Schlüssel aus Originaltitel
//   und Erscheinungsjahr gebildet. Ein Film, der in mehreren Universen oder
//   Listen vorkommt, ist trotzdem nur ein Katalogeintrag.
// - Speicherung: ein Datensatz pro Profil ("marvel_progress_ahmet"). Die
//   Speicherschicht ist austauschbar (Adapter), damit später eine
//   serverseitige Speicherung über den Cloudflare Worker ergänzt werden kann.
//   Hinweis: localStorage gilt nur für diesen Browser auf diesem Gerät und
//   kann vom Benutzer selbst verändert werden — eine Komfortfunktion, kein
//   manipulationssicheres oder geräteübergreifendes System.
// - Alle Oberflächen (Entdecken, Marvel Travel, Planeten, Profil, Groot)
//   lesen über diese eine Quelle und hören über subscribe() auf Änderungen.
// ---------------------------------------------------------------------------
window.MarvelProgress = (function () {
  "use strict";

  const STORAGE_PREFIX = "marvel_progress_";
  const SCHEMA_VERSION = 1;

  // ---------- Stabile Schlüssel ----------
  function slugify(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function makeId(type, title, year) {
    return (type === "series" ? "series:" : "movie:") + slugify(title) + "-" + year;
  }

  // " (Cameo)" / " (Ursprung)" sind in den Universum-Listen nur Notizen.
  function stripAnnotation(title) {
    return String(title || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  function normTitle(title) {
    return stripAnnotation(title).toLowerCase();
  }

  // ---------- Katalog ----------
  let catalogCache = null;
  let byId = null;
  let byKey = null; // "titel|jahr" -> Eintrag
  let byTitle = null; // "titel" -> [Einträge]

  function buildCatalog() {
    const entries = [];
    byId = new Map();
    byKey = new Map();
    byTitle = new Map();

    function add(type, rawTitle, year, extra) {
      const title = stripAnnotation(rawTitle);
      const key = type + "|" + title.toLowerCase() + "|" + year;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          id: makeId(type, title, year),
          type,
          title,
          year,
          phase: "",
          mcu: false,
          universes: [],
          franchises: [],
          releaseDate: null,
        };
        entries.push(entry);
        byKey.set(key, entry);
        byId.set(entry.id, entry);
        const t = title.toLowerCase();
        if (!byTitle.has(t)) byTitle.set(t, []);
        byTitle.get(t).push(entry);
      }
      if (extra) {
        if (extra.phase && !entry.phase) entry.phase = extra.phase;
        if (extra.mcu) entry.mcu = true;
        if (extra.universe && entry.universes.indexOf(extra.universe) === -1) entry.universes.push(extra.universe);
        if (extra.franchise && entry.franchises.indexOf(extra.franchise) === -1) entry.franchises.push(extra.franchise);
        if (extra.releaseDate && !entry.releaseDate) entry.releaseDate = extra.releaseDate;
      }
      return entry;
    }

    // 1) Vollständige MCU-Liste (mit Phase)
    if (typeof MCU_TIMELINE !== "undefined") {
      MCU_TIMELINE.forEach((group) => {
        group.films.forEach((f) => {
          add("movie", f.title, f.year, {
            phase: group.phase,
            mcu: true,
            franchise: f.franchise,
            releaseDate: f.releaseDate,
          });
        });
      });
    }

    // 2) Bestehende Zuordnung Universum -> Filme (und ggf. Serien)
    if (typeof UNIVERSES !== "undefined") {
      UNIVERSES.forEach((u) => {
        (u.movies || []).forEach((m) => {
          add("movie", m.title, m.year, { universe: u.id, franchise: m.franchise, releaseDate: m.releaseDate });
        });
        (u.series || []).forEach((sr) => {
          add("series", sr.title, sr.year, { universe: u.id });
        });
      });
    }

    // 3) Disney+-Serien
    if (typeof SERIES !== "undefined") {
      SERIES.forEach((sr) => {
        add("series", sr.title, sr.year, { phase: sr.phase, mcu: true, releaseDate: sr.releaseDate });
      });
    }

    catalogCache = entries;
    return entries;
  }

  function catalog() {
    return catalogCache || buildCatalog();
  }

  function get(id) {
    catalog();
    return byId.get(id) || null;
  }

  // Findet den Katalogeintrag zu einem Titel aus einer der Listen. Erst exakt
  // über Titel+Jahr; Marvel Travel zeigt im Handlungsmodus aber Handlungsjahre
  // (z.B. 1942), daher als Zweites über den Titel, sofern er eindeutig ist.
  function resolve(title, year, type) {
    catalog();
    const t = normTitle(title);
    const types = type ? [type] : ["movie", "series"];
    for (let i = 0; i < types.length; i++) {
      const e = byKey.get(types[i] + "|" + t + "|" + year);
      if (e) return e;
    }
    const list = (byTitle.get(t) || []).filter((e) => !type || e.type === type);
    return list.length === 1 ? list[0] : null;
  }

  function idFor(title, year, type) {
    const e = resolve(title, year, type);
    return e ? e.id : null;
  }

  // "Verfügbar" = bereits erschienen. Noch nicht erschienene Titel (z.B.
  // Avengers: Doomsday vor dem Kinostart) stehen im Katalog, zählen aber erst
  // ab ihrem Erscheinungstermin zur Gesamtzahl und können erst dann als
  // gesehen markiert werden (auf die Watchlist dürfen sie jederzeit).
  function isReleased(entryOrId, now) {
    const e = typeof entryOrId === "string" ? get(entryOrId) : entryOrId;
    if (!e) return false;
    const t = now || Date.now();
    if (e.releaseDate) return new Date(e.releaseDate + (e.releaseDate.length <= 10 ? "T00:00:00" : "")).getTime() <= t;
    return e.year <= new Date(t).getFullYear();
  }

  // ---------- Speicherschicht (austauschbar) ----------
  // Ein Adapter braucht nur load(profil) -> Datensatz|null und save(profil,
  // Datensatz). Ein späterer Worker-Adapter kann dieselbe Schnittstelle
  // asynchron im Hintergrund synchronisieren.
  const localAdapter = {
    name: "localStorage",
    load(profile) {
      try {
        const raw = localStorage.getItem(STORAGE_PREFIX + profile);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    save(profile, data) {
      try {
        localStorage.setItem(STORAGE_PREFIX + profile, JSON.stringify(data));
        return true;
      } catch (e) {
        return false;
      }
    },
  };
  let adapter = localAdapter;

  function emptyState() {
    return { v: SCHEMA_VERSION, watched: {}, watchlist: {}, ratings: {}, visited: {}, achievements: {}, completed: {}, updatedAt: 0 };
  }

  function sanitize(raw) {
    const s = emptyState();
    if (!raw || typeof raw !== "object") return s;
    ["watched", "watchlist", "visited", "achievements", "completed"].forEach((k) => {
      const src = raw[k];
      if (src && typeof src === "object") {
        Object.keys(src).forEach((id) => {
          const v = Number(src[id]);
          s[k][id] = isFinite(v) && v > 0 ? v : 1;
        });
      }
    });
    if (raw.ratings && typeof raw.ratings === "object") {
      Object.keys(raw.ratings).forEach((id) => {
        const r = Math.round(Number(raw.ratings[id]));
        if (r >= 1 && r <= 5) s.ratings[id] = r;
      });
    }
    s.updatedAt = Number(raw.updatedAt) || 0;
    return s;
  }

  // Übernimmt die bisher getrennt gespeicherten "besuchten Universen"
  // (marvelVisited_<profil>), damit der Multiverse-Explorer-Fortschritt
  // nicht verloren geht. Der alte Schlüssel bleibt unverändert bestehen.
  function migrateLegacy(profile, state) {
    try {
      const legacy = JSON.parse(localStorage.getItem("marvelVisited_" + profile) || "[]");
      if (Array.isArray(legacy)) {
        legacy.forEach((uid) => {
          if (typeof uid === "string" && !state.visited[uid]) state.visited[uid] = 1;
        });
      }
    } catch (e) {
      /* ignorieren */
    }
  }

  // ---------- Zustand ----------
  let profile = null;
  let state = emptyState();
  const listeners = [];

  function persist() {
    if (!profile) return;
    state.updatedAt = Date.now();
    adapter.save(profile, state);
  }

  function emit(event) {
    event.profile = profile;
    listeners.slice().forEach((fn) => {
      try {
        fn(event);
      } catch (e) {
        if (window.console) console.error("MarvelProgress-Listener:", e);
      }
    });
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  function setProfile(id) {
    const next = id || null;
    if (next === profile) return;
    profile = next;
    if (profile) {
      const loaded = adapter.load(profile);
      state = sanitize(loaded);
      if (!loaded) migrateLegacy(profile, state);
      // Bereits erfüllte, aber noch nicht gespeicherte Erfolge und Universums-
      // Abschlüsse still nachtragen (z.B. nach der Übernahme alter Daten).
      evaluateAchievements(true);
      checkUniverseCompletion(true);
      persist();
    } else {
      state = emptyState();
    }
    emit({ type: "profile" });
  }

  function currentProfile() {
    return profile;
  }

  // ---------- Statistik ----------
  // Prozent mathematisch korrekt gerundet: (gesehen * 100) / gesamt ist bei
  // ganzzahligen Eingaben exakt genug, dass x,5 sicher aufgerundet wird
  // (anders als (gesehen / gesamt) * 100, das z.B. 17,4999… ergeben kann).
  // 100 % ist dem vollständigen Abschluss vorbehalten.
  function percent(watched, total) {
    if (!total) return 0;
    let p = Math.round((watched * 100) / total);
    if (p >= 100 && watched < total) p = 99;
    return p;
  }

  // Effektstufe der Planeten: 0 = normal, 1 = Glow, 2 = Energiering,
  // 3 = verstärkte Atmosphäre, 4 = goldener Abschluss.
  function tierFor(watched, total) {
    if (!total) return 0;
    if (watched >= total) return 4;
    const r = watched / total;
    if (r >= 0.75) return 3;
    if (r >= 0.5) return 2;
    if (r >= 0.25) return 1;
    return 0;
  }

  function isWatched(id) {
    return Boolean(state.watched[id]);
  }

  function counts(entries, now) {
    const res = { total: 0, watched: 0, upcoming: 0 };
    entries.forEach((e) => {
      if (!isReleased(e, now)) {
        res.upcoming++;
        return;
      }
      res.total++;
      if (state.watched[e.id]) res.watched++;
    });
    res.percent = percent(res.watched, res.total);
    return res;
  }

  function universeList() {
    return typeof UNIVERSES !== "undefined" ? UNIVERSES : [];
  }

  function universeStats(universeId, now) {
    const u = universeList().find((x) => x.id === universeId);
    const entries = catalog().filter((e) => e.universes.indexOf(universeId) !== -1);
    const movies = counts(entries.filter((e) => e.type === "movie"), now);
    const series = counts(entries.filter((e) => e.type === "series"), now);
    const all = counts(entries, now);
    return {
      id: universeId,
      name: u ? u.name : universeId,
      accent: u ? u.accent : "#ffffff",
      movies,
      series,
      all,
      tier: tierFor(all.watched, all.total),
      complete: all.total > 0 && all.watched >= all.total,
      entries,
    };
  }

  function completedUniverseSet() {
    const set = new Set();
    universeList().forEach((u) => {
      if (universeStats(u.id).complete) set.add(u.id);
    });
    return set;
  }

  function stats(now) {
    const all = catalog();
    const movies = counts(all.filter((e) => e.type === "movie"), now);
    const series = counts(all.filter((e) => e.type === "series"), now);
    const total = counts(all, now);
    const universes = universeList().map((u) => universeStats(u.id, now));

    // Bewertungen nur von angesehenen Titeln
    let ratingSum = 0;
    let ratingCount = 0;
    Object.keys(state.ratings).forEach((id) => {
      if (state.watched[id] && byId.has(id)) {
        ratingSum += state.ratings[id];
        ratingCount++;
      }
    });

    const recent = Object.keys(state.watched)
      .filter((id) => byId.has(id))
      .sort((a, b) => state.watched[b] - state.watched[a])
      .map((id) => byId.get(id));

    // Watchlist in der Reihenfolge des Hinzufügens; "als Nächstes" = noch nicht gesehen
    const watchlist = Object.keys(state.watchlist)
      .filter((id) => byId.has(id))
      .sort((a, b) => state.watchlist[a] - state.watchlist[b])
      .map((id) => byId.get(id));

    const ach = achievements(now);
    return {
      movies,
      series,
      all: total,
      universes,
      // Wie bei den Titeln zählen nur Universen mit bereits erschienenen Titeln
      // (Doomsday kommt mit dem Kinostart automatisch hinzu).
      universesCompleted: universes.filter((x) => x.complete).length,
      universesTotal: universes.filter((x) => x.all.total > 0).length,
      universesUpcoming: universes.filter((x) => x.all.total === 0).length,
      averageRating: ratingCount ? ratingSum / ratingCount : null,
      ratingCount,
      recent,
      watchlist,
      watchlistNext: watchlist.filter((e) => !state.watched[e.id]),
      achievements: ach,
      achievementsUnlocked: ach.filter((a) => a.unlocked).length,
      visited: Object.keys(state.visited),
    };
  }

  // ---------- Erfolge ----------
  function allWatched(entries, now) {
    const available = entries.filter((e) => isReleased(e, now));
    return available.length > 0 && available.every((e) => state.watched[e.id]);
  }

  const ACHIEVEMENTS = [
    {
      id: "first-avenger",
      title: "First Avenger",
      desc: "Ersten Film als gesehen markiert",
      icon: "🛡️",
      check: (now) => catalog().some((e) => e.type === "movie" && state.watched[e.id] && isReleased(e, now)),
    },
    {
      id: "iron-man",
      title: "Iron Man",
      desc: "Alle Iron-Man-Filme gesehen",
      icon: "🦾",
      check: (now) => allWatched(catalog().filter((e) => e.franchises.indexOf("ironman") !== -1), now),
    },
    {
      id: "spider-verse",
      title: "Spider-Verse",
      desc: "Alle Spider-Man-Filme gesehen",
      icon: "🕷️",
      check: (now) => allWatched(catalog().filter((e) => e.franchises.indexOf("spiderman") !== -1), now),
    },
    {
      id: "infinity-saga",
      title: "Infinity Saga",
      desc: "Alle MCU-Filme der Phasen 1–3 gesehen",
      icon: "💎",
      check: (now) =>
        allWatched(
          catalog().filter((e) => e.type === "movie" && e.mcu && /^Phase [123]$/.test(e.phase)),
          now
        ),
    },
    {
      id: "multiverse-explorer",
      title: "Multiverse Explorer",
      desc: "Alle neun Universen mindestens einmal geöffnet",
      icon: "🌌",
      check: () => {
        const list = universeList();
        return list.length > 0 && list.every((u) => state.visited[u.id]);
      },
    },
    {
      id: "marvel-legend",
      title: "Marvel Legend",
      desc: "Alle verfügbaren Filme und Serien gesehen",
      icon: "🏆",
      check: (now) => allWatched(catalog(), now),
    },
  ];

  function achievements(now) {
    return ACHIEVEMENTS.map((a) => ({
      id: a.id,
      title: a.title,
      desc: a.desc,
      icon: a.icon,
      unlocked: Boolean(state.achievements[a.id]),
      unlockedAt: state.achievements[a.id] || null,
      // Live-Bedingung (z.B. für eine Fortschrittsanzeige); freigeschaltet
      // bleibt ein Erfolg auch dann, wenn später etwas entfernt wird.
      conditionMet: Boolean(a.check(now)),
    }));
  }

  // Schaltet neu erfüllte Erfolge frei. Einmal freigeschaltet bleibt ein
  // Erfolg bestehen (wie bei Erfolgen üblich), auch wenn danach ein Titel
  // wieder als ungesehen markiert wird.
  function evaluateAchievements(silent) {
    const unlocked = [];
    ACHIEVEMENTS.forEach((a) => {
      if (state.achievements[a.id]) return;
      if (a.check()) {
        state.achievements[a.id] = Date.now();
        unlocked.push({ id: a.id, title: a.title, desc: a.desc, icon: a.icon });
      }
    });
    if (unlocked.length && !silent) emit({ type: "achievement", achievements: unlocked });
    return unlocked;
  }

  // Meldet ein Universum nur beim ERSTEN Abschluss pro Profil (gespeichert in
  // state.completed) — wird es später unvollständig und wieder vollständig,
  // gibt es keine erneute Meldung. Die Gold-Optik kommt weiterhin live aus
  // universeStats().complete.
  function checkUniverseCompletion(silent) {
    const newly = [];
    completedUniverseSet().forEach((id) => {
      if (state.completed[id]) return;
      state.completed[id] = Date.now();
      newly.push(id);
    });
    if (newly.length && !silent) {
      emit({
        type: "universe-complete",
        universes: newly.map((id) => {
          const u = universeList().find((x) => x.id === id);
          return { id, name: u ? u.name : id };
        }),
      });
    }
  }

  // ---------- Änderungen ----------
  function afterChange(event) {
    persist();
    emit(event);
    checkUniverseCompletion();
    evaluateAchievements(false);
    persist();
  }

  function setWatched(id, value) {
    if (!profile) return false;
    const e = get(id);
    if (!e) return false;
    const want = Boolean(value);
    if (want === isWatched(id)) return true;
    if (want && !isReleased(e)) return false;
    if (want) state.watched[id] = Date.now();
    else delete state.watched[id];
    afterChange({ type: "watched", id, value: want });
    return true;
  }

  function toggleWatched(id) {
    const ok = setWatched(id, !isWatched(id));
    return ok ? isWatched(id) : null;
  }

  function inWatchlist(id) {
    return Boolean(state.watchlist[id]);
  }

  function setWatchlist(id, value) {
    if (!profile || !get(id)) return false;
    const want = Boolean(value);
    if (want === inWatchlist(id)) return true;
    if (want) state.watchlist[id] = Date.now();
    else delete state.watchlist[id];
    afterChange({ type: "watchlist", id, value: want });
    return true;
  }

  function toggleWatchlist(id) {
    const ok = setWatchlist(id, !inWatchlist(id));
    return ok ? inWatchlist(id) : null;
  }

  function rating(id) {
    return state.ratings[id] || 0;
  }

  // Bewertet werden können nur angesehene Titel; 0 entfernt die Bewertung.
  function setRating(id, stars) {
    if (!profile || !get(id)) return false;
    const n = Math.round(Number(stars) || 0);
    if (n < 0 || n > 5) return false;
    if (n > 0 && !isWatched(id)) return false;
    if (n === rating(id)) return true;
    if (n === 0) delete state.ratings[id];
    else state.ratings[id] = n;
    afterChange({ type: "rating", id, value: n });
    return true;
  }

  function recordVisit(universeId) {
    if (!profile || !universeId || state.visited[universeId]) return false;
    state.visited[universeId] = Date.now();
    afterChange({ type: "visit", id: universeId });
    return true;
  }

  function useAdapter(next) {
    if (next && typeof next.load === "function" && typeof next.save === "function") adapter = next;
    return adapter;
  }

  // Änderungen aus einem anderen Tab desselben Browsers übernehmen.
  window.addEventListener("storage", (e) => {
    if (!profile || e.key !== STORAGE_PREFIX + profile) return;
    state = sanitize(adapter.load(profile));
    emit({ type: "sync" });
  });

  return {
    STORAGE_PREFIX,
    catalog,
    get,
    resolve,
    idFor,
    isReleased,
    makeId,
    slugify,
    setProfile,
    profile: currentProfile,
    isWatched,
    setWatched,
    toggleWatched,
    inWatchlist,
    setWatchlist,
    toggleWatchlist,
    rating,
    setRating,
    recordVisit,
    stats,
    universeStats,
    achievements,
    percent,
    tierFor,
    subscribe,
    useAdapter,
    storageName: () => adapter.name || "custom",
  };
})();
