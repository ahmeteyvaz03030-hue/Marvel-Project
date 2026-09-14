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

  return { STAT_DEFS, statsFor, relationsFor, findCharacter, baseName };
})();
