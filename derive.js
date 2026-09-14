// ---------------------------------------------------------------------------
// Abgeleitete Charakterdaten: Power-Stats, Beziehungen, Varianten und
// Zugehörigkeiten werden aus den vorhandenen Daten (Kräfte, Biografie,
// Gesinnung, Universum) berechnet — deterministisch, d.h. ein Charakter bekommt
// bei jedem Aufruf dieselben Werte.
// ---------------------------------------------------------------------------
window.MarvelDerive = (function () {
  "use strict";

  const STAT_DEFS = [
    { key: "staerke", label: "Stärke" },
    { key: "intelligenz", label: "Intelligenz" },
    { key: "geschwindigkeit", label: "Geschwindigkeit" },
    { key: "kampf", label: "Kampf" },
    { key: "technologie", label: "Technologie" },
    { key: "energie", label: "Energie" },
    { key: "ausdauer", label: "Ausdauer" },
  ];

  // Schlüsselwörter aus Kräften/Biografie erhöhen die jeweilige Statistik.
  const STAT_RULES = {
    staerke: [
      [/unbegrenzte wutkraft|hulk/, 46],
      [/übermenschliche (kraft|stärke)/, 34],
      [/gottheit|donnergott|asgard/, 32],
      [/super-soldat|serum/, 22],
      [/gesteinsk|felskörper|the thing/, 30],
      [/dehnbar|elastisch/, 14],
      [/stärke|kraft/, 14],
      [/titan|thanos/, 34],
    ],
    intelligenz: [
      [/genie|intellekt|erfinder|wissenschaftl/, 40],
      [/strateg|taktik|anführer/, 20],
      [/telepath|gedanken/, 26],
      [/professor|doktor|forscher/, 18],
      [/manipulat|täusch|illusion|trickster/, 16],
      [/magie|mystis|zauber/, 14],
    ],
    geschwindigkeit: [
      [/geschwindigkeit|schnelligkeit/, 34],
      [/reflexe|agilität|akrobat/, 26],
      [/flug|fliegen|flügel/, 22],
      [/teleport|portal/, 24],
      [/wandkletter|schwing/, 16],
      [/kosmisch|silver surfer/, 26],
    ],
    kampf: [
      [/kampf|nahkampf|meisterhaft|kampferprobt/, 34],
      [/assassin|spion|attentäter/, 30],
      [/schild|wurfschild/, 22],
      [/kralle|klinge|schwert|waffen/, 26],
      [/training|militär|soldat|air-force/, 20],
      [/söldner/, 24],
    ],
    technologie: [
      [/rüstung|anzug|repulsor|panzerung/, 40],
      [/technolog|hightech|gadget/, 30],
      [/erfinder|ingenieur/, 26],
      [/netzschützer|netzwerfer/, 18],
      [/kybernetisch|prothese|arm aus/, 22],
      [/drohn|ki |künstliche intelligenz/, 18],
    ],
    energie: [
      [/kosmisch|photonen|binär/, 42],
      [/blitz|elektro|donner/, 34],
      [/feuer|flamme|plasma/, 30],
      [/laser|strahl|repulsor|optik/, 28],
      [/magie|zauber|mystis|chaos|hex/, 34],
      [/energie|kraftfeld/, 22],
      [/infinity|stein/, 26],
    ],
    ausdauer: [
      [/regenerat|heilung|unsterblich/, 42],
      [/ausdauer|zäh|unverwüstlich/, 28],
      [/serum|super-soldat/, 24],
      [/gottheit|asgard|kosmisch/, 30],
      [/gesteinsk|panzerhaut|felskörper/, 32],
      [/rüstung|panzerung/, 16],
    ],
  };

  // Kleiner, stabiler Hash für eine leichte Streuung zwischen ähnlichen Figuren.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function statsFor(character) {
    const text = [
      (character.powers || []).join(" "),
      character.bio || "",
      character.name || "",
      character.role || "",
    ]
      .join(" ")
      .toLowerCase();

    const civilian = character.alignment === "Zivilist";
    const stats = [];

    STAT_DEFS.forEach((def) => {
      // Grundwert: Zivilisten starten niedriger als übermenschliche Figuren.
      let value = (civilian ? 14 : 24) + hash(`${character.name}|${character.role}|${def.key}`) * 16;
      (STAT_RULES[def.key] || []).forEach(([re, boost]) => {
        if (re.test(text)) value += boost;
      });
      if (civilian && ["staerke", "kampf", "energie", "geschwindigkeit", "ausdauer"].indexOf(def.key) !== -1) {
        value -= 16;
      }
      stats.push({
        key: def.key,
        label: def.label,
        value: Math.max(8, Math.min(100, Math.round(value))),
      });
    });

    return stats;
  }

  // "Peter Parker / Spider-Man" → "peter parker" (Grundlage für Varianten)
  function baseName(name) {
    return String(name || "")
      .split(" / ")[0]
      .trim()
      .toLowerCase();
  }

  function findCharacter(universeId, name) {
    const universe = UNIVERSES.find((u) => u.id === universeId);
    if (!universe) return null;
    const character = universe.characters.find((c) => c.name === name);
    return character ? { character, universe } : null;
  }

  // Teams/Organisationen, die sich aus Biografie und Kräften ablesen lassen.
  const TEAM_PATTERNS = [
    [/avengers|rächer/i, "Avengers"],
    [/x-men|mutant/i, "X-Men"],
    [/thunderbolts/i, "Thunderbolts*"],
    [/s\.?h\.?i\.?e\.?l\.?d/i, "S.H.I.E.L.D."],
    [/guardians|wächter der galaxis/i, "Guardians of the Galaxy"],
    [/fantastic four|erste familie|fantastischen vier/i, "Fantastic Four"],
    [/hydra/i, "HYDRA"],
    [/asgard/i, "Asgard"],
    [/wakanda/i, "Wakanda"],
    [/oscorp/i, "Oscorp"],
    [/stark industries|stark-/i, "Stark Industries"],
    [/daily bugle/i, "Daily Bugle"],
    [/roter raum|red room|witwen-?programm/i, "Roter Raum"],
    [/latveria/i, "Latveria"],
    [/schwarzer orden|black order/i, "Schwarzer Orden"],
  ];

  // Teams, die sich zusätzlich verlässlich aus Filmtiteln ableiten lassen.
  const FILM_TEAM_PATTERNS = [
    [/avengers/i, "Avengers"],
    [/x-men/i, "X-Men"],
    [/fantastic four/i, "Fantastic Four"],
    [/guardians/i, "Guardians of the Galaxy"],
    [/thunderbolts/i, "Thunderbolts*"],
  ];

  function relationsFor(character, universe) {
    const villain = character.alignment === "Bösewicht";
    const allies = [];
    const enemies = [];

    universe.characters.forEach((other) => {
      if (other.name === character.name && other.role === character.role) return;
      const otherVillain = other.alignment === "Bösewicht";
      const entry = { character: other, universe };
      if (villain === otherVillain) allies.push(entry);
      else enemies.push(entry);
    });

    // Varianten: gleiche Figur in einem anderen Universum (bzw. anderer Besetzung).
    const base = baseName(character.name);
    const variants = [];
    UNIVERSES.forEach((u) => {
      u.characters.forEach((other) => {
        if (baseName(other.name) !== base) return;
        if (u.id === universe.id && other.name === character.name && other.role === character.role) return;
        variants.push({ character: other, universe: u });
      });
    });

    // Zugehörigkeiten: Universen, in denen die Figur auftaucht, plus erkannte Teams.
    const universeChips = [];
    UNIVERSES.forEach((u) => {
      const appears = u.characters.some((other) => baseName(other.name) === base);
      if (appears) universeChips.push({ label: u.name, sub: u.earth || "", accent: u.accent });
    });

    const text = [character.bio || "", (character.powers || []).join(" "), character.name || ""].join(" ");
    const filmText = (character.films || []).map((f) => f.title).join(" ");
    const teams = [];
    TEAM_PATTERNS.forEach(([re, label]) => {
      if (re.test(text) && teams.indexOf(label) === -1) teams.push(label);
    });
    FILM_TEAM_PATTERNS.forEach(([re, label]) => {
      if (re.test(filmText) && teams.indexOf(label) === -1) teams.push(label);
    });

    return {
      allies: allies.slice(0, 8),
      enemies: enemies.slice(0, 8),
      variants,
      affiliations: universeChips,
      teams,
    };
  }

  // ---------- Film- und Universums-Metadaten ----------
  function filmInfo(title) {
    return (typeof FILM_INFO !== "undefined" && FILM_INFO[title]) || null;
  }

  function phaseFor(title) {
    const info = filmInfo(title);
    return info ? info.phase : "";
  }

  function eraFor(title) {
    if (typeof MCU_CHRONO_TIMELINE === "undefined") return null;
    for (let i = 0; i < MCU_CHRONO_TIMELINE.length; i++) {
      const era = MCU_CHRONO_TIMELINE[i];
      if (era.films.some((f) => f.title === title)) {
        return { era: era.era, years: era.years, index: i, total: MCU_CHRONO_TIMELINE.length };
      }
    }
    return null;
  }

  // Status eines Universums aus den Erscheinungsjahren seiner Filme ableiten.
  function universeMeta(universe) {
    const movies = universe.movies || [];
    const years = movies.map((m) => m.year).filter(Boolean);
    const firstYear = years.length ? Math.min.apply(null, years) : null;
    const lastYear = years.length ? Math.max.apply(null, years) : null;
    const nowYear = new Date().getFullYear();

    let status = "Abgeschlossen";
    if (universe.releaseDate && new Date(universe.releaseDate).getTime() > Date.now()) {
      status = "In Produktion";
    } else if (lastYear !== null && lastYear >= nowYear) {
      status = "Laufend";
    }

    // Zeitleisten-Position: Epoche(n) und Phase(n), in denen die Filme liegen.
    const eras = [];
    const phases = [];
    movies.forEach((m) => {
      const era = eraFor(m.title);
      if (era && eras.indexOf(era.era) === -1) eras.push(era.era);
      const phase = phaseFor(m.title);
      if (phase && phases.indexOf(phase) === -1) phases.push(phase);
    });

    // Verwandte Universen: teilen sich mindestens eine Figur.
    const ownBaseNames = (universe.characters || []).map((c) => baseName(c.name));
    const related = [];
    UNIVERSES.forEach((other) => {
      if (other.id === universe.id) return;
      const shared = (other.characters || []).filter((c) => ownBaseNames.indexOf(baseName(c.name)) !== -1);
      if (shared.length) related.push({ universe: other, shared: shared.length });
    });
    related.sort((a, b) => b.shared - a.shared);

    // Verwandte Filme: Filme derselben MCU-Phase aus anderen Universen.
    const ownTitles = movies.map((m) => m.title);
    const relatedFilms = [];
    if (typeof FILM_INFO !== "undefined") {
      Object.keys(FILM_INFO).forEach((title) => {
        if (ownTitles.indexOf(title) !== -1) return;
        if (phases.indexOf(FILM_INFO[title].phase) === -1) return;
        relatedFilms.push({ title, phase: FILM_INFO[title].phase, desc: FILM_INFO[title].desc });
      });
    }

    return {
      firstYear,
      lastYear,
      status,
      eras,
      phases,
      related,
      relatedFilms: relatedFilms.slice(0, 8),
      mainFilm: movies.length ? movies[movies.length - 1] : null,
    };
  }

  // ---------- Verbindungen zwischen Universen (Multiverse Map) ----------
  function universeConnections() {
    const links = [];
    for (let i = 0; i < UNIVERSES.length; i++) {
      for (let j = i + 1; j < UNIVERSES.length; j++) {
        const a = UNIVERSES[i];
        const b = UNIVERSES[j];
        const aNames = (a.characters || []).map((c) => baseName(c.name));
        const sharedNames = (b.characters || [])
          .map((c) => baseName(c.name))
          .filter((n) => aNames.indexOf(n) !== -1);
        const unique = sharedNames.filter((n, idx) => sharedNames.indexOf(n) === idx);
        if (unique.length) links.push({ a, b, shared: unique.length, names: unique });
      }
    }
    return links;
  }

  // ---------- Duell-Bewertung ("Wer würde gewinnen?") ----------
  // Bewusst spielerisch: gewichtete Summe der abgeleiteten Werte, keine
  // offizielle oder objektive Aussage.
  const BATTLE_WEIGHTS = {
    staerke: 1.15,
    geschwindigkeit: 1.0,
    intelligenz: 0.85,
    kampf: 1.2,
    technologie: 0.9,
    energie: 1.25,
    ausdauer: 1.05,
  };

  function battleScore(character) {
    const stats = statsFor(character);
    let sum = 0;
    let weight = 0;
    stats.forEach((s) => {
      const w = BATTLE_WEIGHTS[s.key] || 1;
      sum += s.value * w;
      weight += w;
    });
    return { stats, score: Math.round(sum / weight) };
  }

  return {
    STAT_DEFS,
    statsFor,
    relationsFor,
    findCharacter,
    baseName,
    filmInfo,
    phaseFor,
    eraFor,
    universeMeta,
    universeConnections,
    battleScore,
  };
})();
