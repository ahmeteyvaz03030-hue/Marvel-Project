(function () {
  "use strict";

  const canvas = document.getElementById("scene");
  const labelsLayer = document.getElementById("labels-layer");
  const panel = document.getElementById("panel");
  const hint = document.getElementById("hint");

  let currentUser = null;

  // ---------- Sound (synthetisiert per Web Audio API, keine externen Dateien) ----------
  function initSound() {
    let ctx = null;
    let masterGain = null;
    let ambientStarted = false;
    let muted = false;
    try {
      muted = localStorage.getItem("marvelMuted") === "1";
    } catch (e) {
      muted = false;
    }

    function ensureCtx() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.35;
      masterGain.connect(ctx.destination);
      return ctx;
    }

    function startAmbient() {
      if (!ensureCtx() || ambientStarted) return;
      ambientStarted = true;
      [55, 82.5, 110].forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.05 + i * 0.01;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05 + i * 0.02;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.02;
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);
        osc.connect(g);
        g.connect(masterGain);
        osc.start();
        lfo.start();
      });
    }

    function blip(freq, duration, type, peak) {
      if (muted || !ensureCtx()) return;
      const osc = ctx.createOscillator();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(peak || 0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(g);
      g.connect(masterGain);
      osc.start();
      osc.stop(ctx.currentTime + duration + 0.05);
    }

    function playClick() {
      blip(660, 0.12, "triangle", 0.18);
    }

    function playWhoosh() {
      if (muted || !ensureCtx()) return;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(120, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(480, ctx.currentTime + 0.4);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(filter);
      filter.connect(g);
      g.connect(masterGain);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    }

    function playCollect() {
      blip(880, 0.3, "sine", 0.3);
      setTimeout(() => blip(1320, 0.35, "sine", 0.25), 90);
    }

    function playPower() {
      if (muted || !ensureCtx()) return;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(100, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
      osc.connect(g);
      g.connect(masterGain);
      osc.start();
      osc.stop(ctx.currentTime + 1.25);
    }

    function setMuted(v) {
      muted = v;
      try {
        localStorage.setItem("marvelMuted", v ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
      if (masterGain) masterGain.gain.value = v ? 0 : 0.35;
    }

    return { ensureCtx, startAmbient, playClick, playWhoosh, playCollect, playPower, setMuted, isMuted: () => muted };
  }
  const Sound = initSound();

  // Startet den Ambient-Sound beim ersten Nutzer-Klick (Browser-Autoplay-Policy).
  function unlockAudioOnce() {
    Sound.ensureCtx();
    Sound.startAmbient();
    document.removeEventListener("pointerdown", unlockAudioOnce);
  }
  document.addEventListener("pointerdown", unlockAudioOnce);

  const soundToggleBtn = document.getElementById("sound-toggle");
  soundToggleBtn.textContent = Sound.isMuted() ? "🔇" : "🔊";
  soundToggleBtn.addEventListener("click", () => {
    const nowMuted = !Sound.isMuted();
    Sound.setMuted(nowMuted);
    soundToggleBtn.textContent = nowMuted ? "🔇" : "🔊";
  });

  // ---------- Toast-Benachrichtigungen ----------
  function showToast(msg, duration) {
    const layer = document.getElementById("toast-layer");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    layer.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 400);
    }, duration || 3200);
  }

  // ---------- Suchindex (gemeinsam für Suche, Favoriten & Vergleich) ----------
  function buildSearchIndex() {
    const index = [];
    UNIVERSES.forEach((u) => {
      u.characters.forEach((c) => {
        index.push({
          type: "character",
          label: c.name,
          sub: `${c.role} · ${u.name}`,
          universe: u,
          character: c,
        });
      });
      u.movies.forEach((m) => {
        index.push({
          type: "movie",
          label: m.title,
          sub: `${m.year} · ${u.name}`,
          universe: u,
        });
      });
    });
    return index;
  }
  const SEARCH_INDEX = buildSearchIndex();

  // ---------- Favoriten (pro Profil in localStorage gespeichert) ----------
  function getFavorites() {
    try {
      return JSON.parse(localStorage.getItem(`marvelFavorites_${currentUser || "guest"}`) || "[]");
    } catch (e) {
      return [];
    }
  }
  function setFavorites(arr) {
    try {
      localStorage.setItem(`marvelFavorites_${currentUser || "guest"}`, JSON.stringify(arr));
    } catch (e) {
      /* ignore */
    }
  }
  function isFavorite(uid, name) {
    return getFavorites().includes(`${uid}::${name}`);
  }
  function toggleFavorite(uid, name) {
    const key = `${uid}::${name}`;
    const favs = getFavorites();
    const idx = favs.indexOf(key);
    if (idx === -1) favs.push(key);
    else favs.splice(idx, 1);
    setFavorites(favs);
    return idx === -1;
  }

  // ---------- User gate (Profilauswahl) ----------
  const GATE_COLORS = ["#ff4d4d", "#5b8bff", "#38d4e0", "#ffce54", "#8a2be2", "#2ecc71", "#ff6a3c", "#ff4d9e"];

  function loadCustomUsers() {
    try {
      return JSON.parse(localStorage.getItem("marvelCustomUsers") || "{}");
    } catch (e) {
      return {};
    }
  }
  function saveCustomUsers(map) {
    try {
      localStorage.setItem("marvelCustomUsers", JSON.stringify(map));
    } catch (e) {
      /* ignore */
    }
  }

  function initUserGate() {
    const gate = document.getElementById("user-gate");
    const cardsWrap = document.getElementById("gate-cards");
    const createForm = document.getElementById("gate-create-form");
    const nameInput = document.getElementById("gate-create-name");
    const heroInput = document.getElementById("gate-create-hero");
    const colorPicker = document.getElementById("gate-color-picker");

    let customUsers = loadCustomUsers();
    let allUsers = Object.assign({}, AVATARS, customUsers);
    let pickedColor = GATE_COLORS[0];

    function avatarSvgFor(u) {
      return u.svg || characterFigureSVG(u.color, getInitials(u.name));
    }

    function renderCards() {
      cardsWrap.innerHTML = "";
      Object.entries(allUsers).forEach(([id, u]) => {
        const card = document.createElement("button");
        card.className = "gate-card";
        card.style.setProperty("--hero-color", u.color);
        card.innerHTML = `
          <div class="gate-avatar">${avatarSvgFor(u)}</div>
          <div class="gate-name">${u.name}</div>
          <div class="gate-hero">${u.hero}</div>`;
        card.addEventListener("click", () => selectUser(id));
        if (customUsers[id]) {
          const remove = document.createElement("button");
          remove.className = "gate-card-remove";
          remove.type = "button";
          remove.title = "Profil löschen";
          remove.textContent = "✕";
          remove.addEventListener("click", (e) => {
            e.stopPropagation();
            delete customUsers[id];
            delete allUsers[id];
            saveCustomUsers(customUsers);
            renderCards();
          });
          card.appendChild(remove);
        }
        cardsWrap.appendChild(card);
      });

      const createCard = document.createElement("button");
      createCard.className = "gate-card gate-card-create";
      createCard.innerHTML = `
        <div class="gate-avatar-plus">+</div>
        <div class="gate-name">Neuer Benutzer</div>
        <div class="gate-hero">Eigenes Profil erstellen</div>`;
      createCard.addEventListener("click", openCreateForm);
      cardsWrap.appendChild(createCard);
    }

    function openCreateForm() {
      cardsWrap.classList.add("hidden");
      createForm.classList.remove("hidden");
      nameInput.value = "";
      heroInput.value = "";
      pickedColor = GATE_COLORS[Math.floor(Math.random() * GATE_COLORS.length)];
      colorPicker.innerHTML = "";
      GATE_COLORS.forEach((c) => {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "gate-color-swatch" + (c === pickedColor ? " active" : "");
        sw.style.background = c;
        sw.addEventListener("click", () => {
          pickedColor = c;
          colorPicker.querySelectorAll(".gate-color-swatch").forEach((el) => el.classList.remove("active"));
          sw.classList.add("active");
        });
        colorPicker.appendChild(sw);
      });
      nameInput.focus();
    }

    function closeCreateForm() {
      createForm.classList.add("hidden");
      cardsWrap.classList.remove("hidden");
    }

    document.getElementById("gate-create-cancel").addEventListener("click", closeCreateForm);

    document.getElementById("gate-create-confirm").addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const hero = heroInput.value.trim() || "Multiversum-Reisende:r";
      const id = "u" + Date.now().toString(36);
      const user = { name, hero, color: pickedColor };
      customUsers[id] = user;
      allUsers[id] = user;
      saveCustomUsers(customUsers);
      closeCreateForm();
      renderCards();
      selectUser(id);
    });

    function applyUser(id) {
      const u = allUsers[id];
      if (!u) return;
      currentUser = id;
      document.getElementById("profile-avatar").innerHTML = avatarSvgFor(u);
      document.getElementById("profile-name").textContent = u.name;
      document.getElementById("profile-hero").textContent = u.hero;
      const badge = document.getElementById("profile-badge");
      badge.classList.remove("hidden");
      badge.style.setProperty("--hero-color", u.color);
    }

    function selectUser(id) {
      localStorage.setItem("marvelUser", id);
      applyUser(id);
      gate.classList.add("hidden");
      Sound.ensureCtx();
      Sound.startAmbient();
      Sound.playPower();
    }

    renderCards();

    let saved = null;
    try {
      saved = localStorage.getItem("marvelUser");
    } catch (e) {
      saved = null;
    }
    if (saved && allUsers[saved]) {
      applyUser(saved);
      gate.classList.add("hidden");
    }

    document.getElementById("profile-switch").addEventListener("click", () => {
      closeCreateForm();
      gate.classList.remove("hidden");
    });
  }
  initUserGate();

  // ---------- Marvel Travel (MCU-Chronologie) ----------
  function initTravel() {
    const btn = document.getElementById("travel-btn");
    const overlay = document.getElementById("travel-overlay");
    const closeBtn = document.getElementById("travel-close");
    const container = document.getElementById("travel-timeline");
    const storyBtn = document.getElementById("travel-mode-story");
    const releaseBtn = document.getElementById("travel-mode-release");
    const PHASE_COLORS = ["#ff4d4d", "#5b8bff", "#ffce54", "#38d4e0", "#8a2be2", "#ff5a3c"];
    const SKIP_WORDS = ["the", "of", "and", "a", "to", "in"];

    function posterAbbrev(title) {
      const words = title
        .replace(/[:*]/g, "")
        .split(" ")
        .filter((w) => w && !SKIP_WORDS.includes(w.toLowerCase()));
      return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
    }

    function render(mode) {
      container.innerHTML = "";
      const line = document.createElement("div");
      line.className = "mcu-line";
      container.appendChild(line);

      const groups = mode === "release" ? MCU_TIMELINE : MCU_CHRONO_TIMELINE;
      let side = 0;
      groups.forEach((group, groupIdx) => {
        const marker = document.createElement("div");
        marker.className = "mcu-phase-marker";
        marker.textContent = mode === "release" ? group.phase : `${group.era} · ${group.years}`;
        container.appendChild(marker);

        const color = PHASE_COLORS[groupIdx % PHASE_COLORS.length];
        group.films.forEach((f) => {
          const item = document.createElement("div");
          item.className = "mcu-item " + (side === 0 ? "left" : "right") + (f.finale ? " finale" : "");
          item.style.setProperty("--item-color", color);
          item.innerHTML = `
            <span class="mcu-dot"></span>
            <div class="mcu-poster">${posterAbbrev(f.title)}</div>
            <div class="mcu-card">
              <span class="mcu-year">${f.year}</span>
              <span class="mcu-title">${f.title}</span>
              ${f.note ? `<span class="mcu-note">${f.note}</span>` : ""}
            </div>`;
          container.appendChild(item);
          side = 1 - side;
        });
      });
    }

    render("story");

    storyBtn.addEventListener("click", () => {
      storyBtn.classList.add("active");
      releaseBtn.classList.remove("active");
      render("story");
      Sound.playClick();
    });
    releaseBtn.addEventListener("click", () => {
      releaseBtn.classList.add("active");
      storyBtn.classList.remove("active");
      render("release");
      Sound.playClick();
    });

    btn.addEventListener("click", () => {
      overlay.classList.remove("hidden");
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
  }
  initTravel();

  // ---------- Theorien-Board (Fan-Theorien zu kommenden Filmen) ----------
  function initTheories() {
    const STORAGE_KEY = "marvelTheories";
    const btn = document.getElementById("theories-btn");
    const overlay = document.getElementById("theories-overlay");
    const closeBtn = document.getElementById("theories-close");
    const filmSelect = document.getElementById("theory-film");
    const textInput = document.getElementById("theory-text");
    const submitBtn = document.getElementById("theory-submit");
    const list = document.getElementById("theories-list");
    const emptyMsg = document.getElementById("theories-empty");

    function loadTheories() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      } catch (e) {
        return [];
      }
    }
    function saveTheories(theories) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(theories));
      } catch (e) {}
    }

    function render() {
      const theories = loadTheories().sort((a, b) => b.ts - a.ts);
      list.innerHTML = "";
      emptyMsg.classList.toggle("hidden", theories.length > 0);
      theories.forEach((t) => {
        const card = document.createElement("div");
        card.className = "theory-card";
        const date = new Date(t.ts).toLocaleDateString("de-DE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
        card.innerHTML = `
          <div class="theory-head">
            <span class="theory-film-tag">${t.film}</span>
            <span class="theory-meta">${t.author} · ${date}</span>
          </div>
          <p class="theory-text"></p>
          <button class="theory-delete" title="Theorie löschen">🗑</button>`;
        card.querySelector(".theory-text").textContent = t.text;
        card.querySelector(".theory-delete").addEventListener("click", () => {
          const remaining = loadTheories().filter((x) => x.id !== t.id);
          saveTheories(remaining);
          render();
          Sound.playClick();
        });
        list.appendChild(card);
      });
    }

    submitBtn.addEventListener("click", () => {
      const text = textInput.value.trim();
      if (!text) return;
      const theories = loadTheories();
      theories.push({
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        film: filmSelect.value,
        text,
        author: document.getElementById("profile-name").textContent || "Anonym",
        ts: Date.now(),
      });
      saveTheories(theories);
      textInput.value = "";
      render();
      Sound.playClick();
    });

    btn.addEventListener("click", () => {
      overlay.classList.remove("hidden");
      render();
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
  }
  initTheories();

  // ---------- Suche (Charaktere & Filme) ----------
  function initSearch() {
    const searchIndex = SEARCH_INDEX;
    const wrap = document.getElementById("search-wrap");
    const input = document.getElementById("search-input");
    const results = document.getElementById("search-results");

    function renderResults(matches) {
      results.innerHTML = "";
      if (matches.length === 0) {
        results.innerHTML = `<div class="search-empty">Keine Treffer</div>`;
        results.classList.remove("hidden");
        return;
      }
      matches.slice(0, 8).forEach((m) => {
        const item = document.createElement("div");
        item.className = "search-item";
        item.style.setProperty("--accent-color", m.universe.accent);
        item.innerHTML = `
          <span class="search-tag">${m.type === "character" ? "★" : "🎬"}</span>
          <div class="search-text">
            <span class="search-label">${m.label}</span>
            <span class="search-sub">${m.sub}</span>
          </div>`;
        item.addEventListener("click", () => {
          selectUniverse(m.universe.id);
          if (m.type === "character") {
            setTimeout(() => openCharacterModal(m.character, m.universe), 300);
          }
          input.value = "";
          results.classList.add("hidden");
        });
        results.appendChild(item);
      });
      results.classList.remove("hidden");
    }

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        results.classList.add("hidden");
        return;
      }
      renderResults(searchIndex.filter((m) => m.label.toLowerCase().includes(q)));
    });

    input.addEventListener("focus", () => {
      if (input.value.trim()) results.classList.remove("hidden");
    });

    document.addEventListener("pointerdown", (e) => {
      if (!wrap.contains(e.target)) results.classList.add("hidden");
    });
  }
  initSearch();

  // ---------- Favoriten-Sammlung ----------
  function renderFavoritesList() {
    const list = document.getElementById("favorites-list");
    const empty = document.getElementById("favorites-empty");
    const favs = getFavorites();
    list.innerHTML = "";
    if (favs.length === 0) {
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    favs.forEach((key) => {
      const sep = key.indexOf("::");
      const uid = key.slice(0, sep);
      const name = key.slice(sep + 2);
      const entry = SEARCH_INDEX.find((e) => e.type === "character" && e.universe.id === uid && e.character.name === name);
      if (!entry) return;
      const row = document.createElement("div");
      row.className = "favorite-item";
      row.style.setProperty("--accent-color", entry.universe.accent);
      row.innerHTML = `
        <div class="avatar">${characterFigureSVG(entry.universe.accent, getInitials(entry.character.name))}</div>
        <div class="info">
          <span class="fname">${entry.character.name}</span>
          <span class="funiverse">${entry.universe.name}</span>
        </div>
        <button class="fav-heart active" type="button" title="Entfernen">♥</button>`;
      row.addEventListener("click", (e) => {
        if (e.target.closest(".fav-heart")) return;
        selectUniverse(uid);
        setTimeout(() => openCharacterModal(entry.character, entry.universe), 300);
        document.getElementById("favorites-overlay").classList.add("hidden");
      });
      row.querySelector(".fav-heart").addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFavorite(uid, name);
        Sound.playClick();
        renderFavoritesList();
      });
      list.appendChild(row);
    });
  }

  function initFavorites() {
    const btn = document.getElementById("favorites-btn");
    const overlay = document.getElementById("favorites-overlay");
    const closeBtn = document.getElementById("favorites-close");
    btn.addEventListener("click", () => {
      renderFavoritesList();
      overlay.classList.remove("hidden");
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
  }
  initFavorites();

  // ---------- Charakter-Vergleich ----------
  function initCompare() {
    const btn = document.getElementById("compare-btn");
    const overlay = document.getElementById("compare-overlay");
    const closeBtn = document.getElementById("compare-close");
    const resultEl = document.getElementById("compare-result");
    const picked = { a: null, b: null };

    function renderComparison() {
      if (!picked.a || !picked.b) {
        resultEl.innerHTML = "";
        return;
      }
      const card = (entry) => {
        const films = entry.character.films || [];
        const firstYear = films.length ? Math.min(...films.map((f) => f.year)) : "–";
        const powerChips = powerChipsHTML(entry.character.powers, entry.universe.accent);
        return `
          <div class="compare-card" style="--accent-color:${entry.universe.accent}">
            <div class="compare-avatar-wrap">
              <div class="compare-avatar">${characterActionFigureSVG(entry.universe.accent, entry.character.alignment, poseFor(entry.character), getInitials(entry.character.name))}</div>
            </div>
            <h3>${entry.character.name}</h3>
            <div class="compare-role">${entry.character.role}</div>
            <div class="compare-universe">${entry.universe.name}</div>
            <div class="compare-stat"><span>Filmauftritte</span><strong>${films.length}</strong></div>
            <div class="compare-stat"><span>Erstauftritt</span><strong>${firstYear}</strong></div>
            <div class="compare-powers">${powerChips}</div>
          </div>`;
      };
      resultEl.innerHTML = `${card(picked.a)}<div class="compare-vs">VS</div>${card(picked.b)}`;
    }

    function makePicker(inputId, resultsId, slot) {
      const input = document.getElementById(inputId);
      const results = document.getElementById(resultsId);
      input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        results.innerHTML = "";
        if (!q) {
          results.classList.add("hidden");
          return;
        }
        const matches = SEARCH_INDEX.filter((e) => e.type === "character" && e.label.toLowerCase().includes(q)).slice(0, 8);
        if (!matches.length) {
          results.innerHTML = `<div class="search-empty">Keine Treffer</div>`;
          results.classList.remove("hidden");
          return;
        }
        matches.forEach((m) => {
          const item = document.createElement("div");
          item.className = "search-item";
          item.style.setProperty("--accent-color", m.universe.accent);
          item.innerHTML = `
            <span class="search-tag">★</span>
            <div class="search-text">
              <span class="search-label">${m.label}</span>
              <span class="search-sub">${m.sub}</span>
            </div>`;
          item.addEventListener("click", () => {
            picked[slot] = m;
            input.value = m.label;
            results.classList.add("hidden");
            Sound.playClick();
            renderComparison();
          });
          results.appendChild(item);
        });
        results.classList.remove("hidden");
      });
      document.addEventListener("pointerdown", (e) => {
        if (!input.parentElement.contains(e.target)) results.classList.add("hidden");
      });
    }
    makePicker("compare-input-a", "compare-results-a", "a");
    makePicker("compare-input-b", "compare-results-b", "b");

    btn.addEventListener("click", () => {
      overlay.classList.remove("hidden");
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
  }
  initCompare();

  // ---------- Renderer / Scene / Camera ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060c, 0.0035);

  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 2000);
  const DEFAULT_CAM_POS = new THREE.Vector3(0, 16, 58);
  camera.position.copy(DEFAULT_CAM_POS);

  let camTarget = new THREE.Vector3(0, 0, 0);
  let camPosTarget = DEFAULT_CAM_POS.clone();
  let lookTarget = new THREE.Vector3(0, 0, 0);
  let flying = false;

  // ---------- Freie Kamerasteuerung: Ziehen = drehen (360°), Scrollen/Pinch = zoomen ----------
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 150;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.8;
  controls.target.copy(lookTarget);
  canvas.style.touchAction = "none";

  // ---------- Lights ----------
  scene.add(new THREE.AmbientLight(0x404060, 1.1));
  const coreLight = new THREE.PointLight(0xffb37a, 6, 300, 1.5);
  coreLight.position.set(0, 0, 0);
  scene.add(coreLight);
  const fillLight = new THREE.DirectionalLight(0x6a7bff, 0.6);
  fillLight.position.set(-40, 30, 20);
  scene.add(fillLight);

  // ---------- Starfield ----------
  function createStarfield() {
    const count = 4200;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 220 + Math.random() * 550;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      sizes[i] = Math.random() * 1.6 + 0.3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    return points;
  }
  const starfield = createStarfield();

  // ---------- Core "sun" ----------
  function createCore() {
    const group = new THREE.Group();
    const coreGeo = new THREE.SphereGeometry(3.4, 48, 48);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffb066 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    [1.15, 1.4, 1.75].forEach((scale, i) => {
      const glowGeo = new THREE.SphereGeometry(3.4 * scale, 32, 32);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xff8c42,
        transparent: true,
        opacity: 0.14 - i * 0.03,
        depthWrite: false,
      });
      group.add(new THREE.Mesh(glowGeo, glowMat));
    });
    return group;
  }
  scene.add(createCore());

  // ---------- Procedural planet texture ----------
  function makePlanetTexture(colorA, colorB, seedOffset) {
    const size = 512;
    const cvs = document.createElement("canvas");
    cvs.width = size;
    cvs.height = size / 2;
    const ctx = cvs.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, 0, cvs.height);
    grad.addColorStop(0, colorA);
    grad.addColorStop(0.5, colorB);
    grad.addColorStop(1, colorA);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    // banding / swirl stripes
    let seed = seedOffset * 999.7;
    function rand() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 10; i++) {
      const y = rand() * cvs.height;
      const h = 4 + rand() * 22;
      ctx.fillStyle = rand() > 0.5 ? "#ffffff" : "#000000";
      ctx.beginPath();
      ctx.ellipse(cvs.width / 2, y, cvs.width / 2, h, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // craters / spots
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 40; i++) {
      const x = rand() * cvs.width;
      const y = rand() * cvs.height;
      const r = 4 + rand() * 14;
      ctx.fillStyle = rand() > 0.5 ? "#000000" : "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  // ---------- Orbit ring (visual path) ----------
  function createOrbitRing(radius) {
    const ringGeo = new THREE.RingGeometry(radius - 0.02, radius + 0.02, 128);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x8892c9,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    return ring;
  }

  // ---------- Build planets ----------
  const planetObjects = []; // { data, group, mesh, angle, orbitRadius, orbitSpeed, yOffset }

  UNIVERSES.forEach((u, idx) => {
    if (u.orbitRadius > 0) scene.add(createOrbitRing(u.orbitRadius));

    const group = new THREE.Group();

    const texture = makePlanetTexture(u.colorA, u.colorB, idx + 1);
    const geo = new THREE.SphereGeometry(u.radius, 48, 48);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.75,
      metalness: 0.15,
      emissive: new THREE.Color(u.accent),
      emissiveIntensity: 0.12,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.id = u.id;
    group.add(mesh);

    // atmosphere glow
    const glowGeo = new THREE.SphereGeometry(u.radius * 1.18, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(u.accent),
      transparent: true,
      opacity: 0.18,
      side: THREE.BackSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(glowGeo, glowMat));

    // ring for a few "special" planets
    if (u.id === "fantasticfour" || u.id === "xmen" || u.id === "doomsday" || u.id === "titan") {
      const ringGeo = new THREE.RingGeometry(u.radius * 1.5, u.radius * 2.1, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(u.accent),
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2.3;
      ring.rotation.z = idx * 0.4;
      group.add(ring);
    }

    scene.add(group);

    planetObjects.push({
      data: u,
      group,
      mesh,
      angle: u.startAngle,
      orbitRadius: u.orbitRadius,
      orbitSpeed: u.orbitSpeed,
      yOffset: u.yOffset,
      spinSpeed: 0.15 + Math.random() * 0.1,
    });
  });

  // ---------- Doctor Doom (stilisierte Wächter-Figur) ----------
  // Kein echtes Schauspielerfoto (Urheber-/Persönlichkeitsrechte) — stattdessen eine
  // bewusst erwachsen und bedrohlich wirkende, hochaufgelöste Metall-Silhouette.
  function createDoomFigure() {
    const group = new THREE.Group();

    // Bodenlanger Umhang — breite Basis, schmale Schultern für eine hochgewachsene Silhouette
    const cloakMat = new THREE.MeshStandardMaterial({
      color: 0x0d3320,
      roughness: 0.82,
      metalness: 0.18,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    const cloak = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 2.5, 5.6, 10, 1, true), cloakMat);
    cloak.position.y = -1.7;
    group.add(cloak);

    // Schulterpanzer — sorgt für eine breite, erwachsene Statur statt rundlicher Proportionen
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x2b2e33,
      roughness: 0.32,
      metalness: 0.9,
      flatShading: true,
    });
    const shoulderGeo = new THREE.BoxGeometry(1.15, 0.5, 0.9);
    const shoulderL = new THREE.Mesh(shoulderGeo, armorMat);
    shoulderL.position.set(-1.2, 0.75, 0.1);
    shoulderL.rotation.z = 0.18;
    const shoulderR = shoulderL.clone();
    shoulderR.position.x = 1.2;
    shoulderR.rotation.z = -0.18;
    group.add(shoulderL, shoulderR);

    // Metallkragen am Hals
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.15, 8, 20), armorMat);
    collar.position.y = 0.62;
    collar.rotation.x = Math.PI / 2;
    group.add(collar);

    // Metallmaske — glatt schattiert für einen polierten, realistischeren Metalleindruck
    const maskMat = new THREE.MeshStandardMaterial({
      color: 0x6d7178,
      roughness: 0.2,
      metalness: 1,
      flatShading: false,
      emissive: 0x14150f,
      emissiveIntensity: 0.25,
    });
    const mask = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 2), maskMat);
    mask.scale.set(0.94, 1.18, 0.92);
    mask.position.set(0, 1.55, 0.5);
    group.add(mask);

    // Kantige Stirn-/Augenbrauenpartie für einen strengeren, weniger rundlichen Ausdruck
    const brow = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.26, 0.55), armorMat);
    brow.position.set(0, 1.98, 1.2);
    group.add(brow);

    // Kinnpartie
    const chin = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.55, 5), maskMat);
    chin.rotation.x = Math.PI;
    chin.position.set(0, 0.68, 0.75);
    group.add(chin);

    // Kapuze über der Maske, mit spitzem Abschluss
    const hoodMat = new THREE.MeshStandardMaterial({
      color: 0x0d3320,
      roughness: 0.78,
      metalness: 0.2,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    const hood = new THREE.Mesh(new THREE.SphereGeometry(1.4, 9, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), hoodMat);
    hood.position.set(0, 2.05, -0.3);
    group.add(hood);
    const hoodPoint = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.85, 6), hoodMat);
    hoodPoint.position.set(0, 3.05, -0.55);
    group.add(hoodPoint);

    // Schmale, glühende Augenschlitze
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x39ff6a });
    const eyeGeo = new THREE.BoxGeometry(0.32, 0.09, 0.12);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.34, 1.62, 1.35);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.34;
    group.add(eyeL, eyeR);

    const eyeLight = new THREE.PointLight(0x39ff6a, 2.6, 16, 2);
    eyeLight.position.set(0, 1.6, 1.7);
    group.add(eyeLight);

    const clickTargets = [];
    group.traverse((o) => {
      if (o.isMesh) {
        o.userData.id = "doomsday";
        clickTargets.push(o);
      }
    });

    group.scale.setScalar(1.7);
    group.position.set(-26, 12, -8);
    group.rotation.y = 0.45;

    return { group, eyeLight, clickTargets };
  }
  const doomFigure = createDoomFigure();
  scene.add(doomFigure.group);

  // ---------- Infinity-Steine (Sammel-Easter-Egg) ----------
  function stonesStorageKey() {
    return `marvelStones_${currentUser || "guest"}`;
  }
  function getCollectedStones() {
    try {
      return JSON.parse(localStorage.getItem(stonesStorageKey()) || "[]");
    } catch (e) {
      return [];
    }
  }
  function setCollectedStones(arr) {
    try {
      localStorage.setItem(stonesStorageKey(), JSON.stringify(arr));
    } catch (e) {
      /* ignore */
    }
  }
  function renderStonesTracker() {
    const el = document.getElementById("stones-tracker");
    const collected = getCollectedStones();
    el.innerHTML = "";
    INFINITY_STONES.forEach((s) => {
      const dot = document.createElement("div");
      dot.className = "stone-dot" + (collected.includes(s.id) ? " collected" : "");
      dot.style.setProperty("--stone-color", "#" + s.color.toString(16).padStart(6, "0"));
      dot.title = s.name;
      el.appendChild(dot);
    });
    el.classList.remove("hidden");
  }

  function createInfinityStones() {
    const collected = getCollectedStones();
    const group = new THREE.Group();
    const stoneMeshes = [];
    INFINITY_STONES.forEach((s) => {
      if (collected.includes(s.id)) return;
      const geo = new THREE.OctahedronGeometry(0.6, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: s.color,
        emissive: s.color,
        emissiveIntensity: 1.1,
        metalness: 0.2,
        roughness: 0.25,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(s.position[0], s.position[1], s.position[2]);
      mesh.userData.stoneId = s.id;
      mesh.userData.basePos = mesh.position.clone();
      mesh.userData.phase = Math.random() * Math.PI * 2;
      const light = new THREE.PointLight(s.color, 1.8, 12, 2);
      mesh.add(light);
      group.add(mesh);
      stoneMeshes.push(mesh);
    });
    scene.add(group);
    return { group, stoneMeshes };
  }
  const infinityStones = createInfinityStones();
  renderStonesTracker();

  function collectStone(mesh) {
    const stoneId = mesh.userData.stoneId;
    const stoneData = INFINITY_STONES.find((s) => s.id === stoneId);
    const collected = getCollectedStones();
    if (!collected.includes(stoneId)) collected.push(stoneId);
    setCollectedStones(collected);
    infinityStones.group.remove(mesh);
    const idx = infinityStones.stoneMeshes.indexOf(mesh);
    if (idx !== -1) infinityStones.stoneMeshes.splice(idx, 1);
    Sound.playCollect();
    showToast(`💎 ${stoneData.name} gesammelt! (${collected.length}/${INFINITY_STONES.length})`);
    renderStonesTracker();
    if (collected.length >= INFINITY_STONES.length) {
      setTimeout(() => {
        Sound.playPower();
        document.getElementById("snap-overlay").classList.remove("hidden");
      }, 600);
    }
  }

  document.getElementById("snap-close").addEventListener("click", () => {
    document.getElementById("snap-overlay").classList.add("hidden");
  });

  // ---------- Achievement: alle Universen besucht ----------
  function recordVisit(id) {
    const key = `marvelVisited_${currentUser || "guest"}`;
    let visited = [];
    try {
      visited = JSON.parse(localStorage.getItem(key) || "[]");
    } catch (e) {
      visited = [];
    }
    if (!visited.includes(id)) {
      visited.push(id);
      try {
        localStorage.setItem(key, JSON.stringify(visited));
      } catch (e) {
        /* ignore */
      }
      if (visited.length === UNIVERSES.length) {
        showToast("🏆 Achievement freigeschaltet: Multiversum-Entdecker — alle Universen besucht!");
      }
    }
  }

  // ---------- HTML labels ----------
  const labelEls = {};
  planetObjects.forEach((p) => {
    const el = document.createElement("div");
    el.className = "planet-label" + (p.data.isDoomsday ? " doomsday" : "");
    el.style.setProperty("--dot-color", p.data.accent);
    el.innerHTML = `<div class="dot"></div><div class="name">${p.data.name}</div>`;
    el.addEventListener("click", () => selectUniverse(p.data.id));
    labelsLayer.appendChild(el);
    labelEls[p.data.id] = el;
  });

  // ---------- Raycast click on planets ----------
  // Klick wird erst bei pointerup mit geringer Bewegung ausgelöst, damit ein
  // Dreh-Drag (OrbitControls) über einem Planeten nicht versehentlich als Klick zählt.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownAt = null;

  canvas.addEventListener("pointerdown", (e) => {
    pointerDownAt = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!pointerDownAt) return;
    const moved = Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y);
    pointerDownAt = null;
    if (moved > 6) return;

    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const stoneHits = raycaster.intersectObjects(infinityStones.stoneMeshes);
    if (stoneHits.length > 0) {
      collectStone(stoneHits[0].object);
      return;
    }

    const meshes = planetObjects.map((p) => p.mesh).concat(doomFigure.clickTargets);
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length > 0) {
      selectUniverse(hits[0].object.userData.id);
    }
  });

  // ---------- Selection state ----------
  let activeId = null;

  function selectUniverse(id) {
    const p = planetObjects.find((pl) => pl.data.id === id);
    if (!p) return;
    activeId = id;
    hint.style.display = "none";
    Sound.playWhoosh();
    recordVisit(id);
    flying = true;

    Object.values(labelEls).forEach((el) => el.classList.remove("active"));
    labelEls[id].classList.add("active");

    fillPanel(p.data);
    panel.classList.add("open");
    document.body.classList.add("panel-open");
  }

  function deselect() {
    activeId = null;
    flying = true;
    document.body.classList.remove("panel-open");
    Object.values(labelEls).forEach((el) => el.classList.remove("active"));
    panel.classList.remove("open");
    camPosTarget.copy(DEFAULT_CAM_POS);
    lookTarget.set(0, 0, 0);
    // Der Trailer läuft bewusst im Mini-Player weiter (nicht hier stoppen).
  }

  // ---------- Persistenter Trailer-Mini-Player (läuft im Hintergrund weiter) ----------
  function openTrailerWidget(u) {
    const widget = document.getElementById("trailer-widget");
    const frame = document.getElementById("trailer-widget-frame");
    const title = document.getElementById("trailer-widget-title");
    if (widget.dataset.currentId === u.trailerYouTubeId) {
      widget.classList.remove("hidden");
      return;
    }
    widget.dataset.currentId = u.trailerYouTubeId;
    title.textContent = `🎬 ${u.name} — Trailer`;
    frame.innerHTML = `<iframe src="https://www.youtube.com/embed/${u.trailerYouTubeId}?autoplay=1" title="${u.name} Trailer" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    widget.classList.remove("hidden");
  }

  document.getElementById("trailer-widget-close").addEventListener("click", () => {
    const widget = document.getElementById("trailer-widget");
    widget.classList.add("hidden");
    widget.dataset.currentId = "";
    document.getElementById("trailer-widget-frame").innerHTML = "";
  });

  document.getElementById("panel-close").addEventListener("click", deselect);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      deselect();
      document.getElementById("travel-overlay").classList.add("hidden");
      document.getElementById("character-modal").classList.add("hidden");
      document.getElementById("favorites-overlay").classList.add("hidden");
      document.getElementById("compare-overlay").classList.add("hidden");
      document.getElementById("snap-overlay").classList.add("hidden");
    }
  });

  // ---------- Countdown ----------
  let countdownInterval = null;
  function startCountdown(targetIso) {
    clearInterval(countdownInterval);
    const target = new Date(targetIso).getTime();

    function tick() {
      const now = Date.now();
      let diff = target - now;
      if (diff < 0) diff = 0;
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      document.getElementById("cd-days").textContent = String(days).padStart(2, "0");
      document.getElementById("cd-hours").textContent = String(hours).padStart(2, "0");
      document.getElementById("cd-min").textContent = String(mins).padStart(2, "0");
      document.getElementById("cd-sec").textContent = String(secs).padStart(2, "0");
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  // ---------- Character Steckbrief modal ----------
  function getInitials(name) {
    return name
      .split(" / ")[0]
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  // Bestimmt eine grobe "Pose" für die animierte Aktionsfigur anhand der
  // Kräfte des Charakters (Flug/Energie-Blast/Schild/neutrale Kampfhaltung).
  function poseFor(character) {
    const powers = (character.powers || []).join(" ").toLowerCase();
    if (/flug|fliegen/.test(powers)) return "flight";
    if (/schild/.test(powers)) return "shield";
    if (/blitz|elektro|feuer|laser|strahl|repulsor|kosmisch/.test(powers)) return "blast";
    return "stance";
  }

  // Hellt (percent>0) oder dunkelt (percent<0) eine Hex-Farbe ab — für
  // Gürtel/Stiefel/Umhang-Farbtöne, die zur Akzentfarbe des Universums passen.
  function shadeColor(hex, percent) {
    const num = parseInt(hex.replace("#", ""), 16);
    const clamp = (v) => Math.max(0, Math.min(255, v));
    const r = clamp(((num >> 16) & 0xff) + Math.round(2.55 * percent));
    const g = clamp(((num >> 8) & 0xff) + Math.round(2.55 * percent));
    const b = clamp((num & 0xff) + Math.round(2.55 * percent));
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function eyeColorFor(alignment) {
    if (alignment === "Bösewicht") return "#ff3b4e";
    if (alignment === "Antiheld") return "#c98bff";
    return "#eef2ff";
  }

  const COMIC_INK = "#14151d";

  // Comic-Held-Figur statt echtem Schauspieler-Foto: eine flach eingefärbte,
  // dick schwarz konturierte Vektor-Figur im klassischen Comic-Stil (Maske mit
  // Augenlinsen, breite Schultern, Gürtel/Stiefel, Brust-Emblem, optionaler
  // Umhang) — je nach Kräften in einer passenden Pose, animiert mit sanftem
  // Schweben, pulsierender Handenergie und wehendem Umhang bei Flug.
  function characterActionFigureSVG(accent, alignment, pose, initials) {
    const secondary = shadeColor(accent, -35);
    const eye = eyeColorFor(alignment);
    const ink = COMIC_INK;
    const inkAttrs = `stroke="${ink}" stroke-width="3" stroke-linejoin="round"`;

    let cape = "";
    let arms;
    let extra = "";

    if (pose === "flight") {
      cape = `<path class="figure-cape" d="M32 56 Q4 104 20 158 Q60 130 60 92 Q60 130 100 158 Q116 104 88 56 Z" fill="${secondary}" ${inkAttrs}/>`;
      arms = `
        <path d="M32 60 L14 76 L20 90 L36 100 L40 82 Z" fill="${accent}" ${inkAttrs}/>
        <path d="M88 60 L106 76 L100 90 L84 100 L80 82 Z" fill="${accent}" ${inkAttrs}/>
        <circle class="hand-glow" cx="17" cy="88" r="7" fill="${accent}"/>
        <circle class="hand-glow" cx="103" cy="88" r="7" fill="${accent}"/>`;
    } else if (pose === "blast") {
      arms = `
        <path d="M32 60 L16 34 L26 20 L42 40 L40 62 Z" fill="${accent}" ${inkAttrs}/>
        <path d="M88 60 L104 34 L94 20 L78 40 L80 62 Z" fill="${accent}" ${inkAttrs}/>
        <circle class="hand-glow hand-glow-strong" cx="19" cy="24" r="9" fill="${accent}"/>
        <circle class="hand-glow hand-glow-strong" cx="101" cy="24" r="9" fill="${accent}"/>`;
    } else if (pose === "shield") {
      arms = `
        <path d="M32 60 L16 74 L20 92 L36 98 L40 80 Z" fill="${accent}" ${inkAttrs}/>
        <path d="M88 60 L74 66 L58 62 L58 78 L82 82 L88 82 Z" fill="${accent}" ${inkAttrs}/>`;
      extra = `<circle class="figure-shield" cx="22" cy="82" r="17" fill="${secondary}" stroke="${ink}" stroke-width="3"/>
        <path d="M22 69 L22 95 M9 82 L35 82" stroke="${accent}" stroke-width="3"/>`;
    } else {
      arms = `
        <path d="M32 60 L18 78 L24 96 L38 98 L42 80 Z" fill="${accent}" ${inkAttrs}/>
        <path d="M88 60 L102 78 L96 96 L82 98 L78 80 Z" fill="${accent}" ${inkAttrs}/>
        <circle cx="24" cy="96" r="6" fill="${secondary}" stroke="${ink}" stroke-width="2.5"/>
        <circle cx="96" cy="96" r="6" fill="${secondary}" stroke="${ink}" stroke-width="2.5"/>`;
    }

    return `<svg viewBox="0 0 120 170" xmlns="http://www.w3.org/2000/svg" class="figure-pose-${pose}">
      <defs>
        <radialGradient id="fg" cx="50%" cy="26%" r="78%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="120" height="170" fill="#0a0b12"/>
      <circle cx="60" cy="60" r="76" fill="url(#fg)"/>
      <ellipse class="figure-shadow" cx="60" cy="160" rx="28" ry="6" fill="#000"/>
      <g class="figure-body">
        ${cape}
        <path d="M44 108 L34 154 L50 154 L56 112 Z" fill="${accent}" ${inkAttrs}/>
        <path d="M76 108 L86 154 L70 154 L64 112 Z" fill="${accent}" ${inkAttrs}/>
        <path d="M30 150 L52 150 L52 162 L26 162 Z" fill="${secondary}" ${inkAttrs}/>
        <path d="M68 150 L90 150 L94 162 L68 162 Z" fill="${secondary}" ${inkAttrs}/>
        <path d="M26 58 Q60 42 94 58 L88 106 Q60 118 32 106 Z" fill="${accent}" ${inkAttrs}/>
        <path d="M44 60 L60 100 L76 60 Q60 70 44 60 Z" fill="${secondary}" opacity="0.9"/>
        <rect x="32" y="103" width="56" height="11" rx="4" fill="${secondary}" ${inkAttrs}/>
        <path class="figure-chest" d="M60 68 L70 78 L60 88 L50 78 Z" fill="${ink}" stroke="${accent}" stroke-width="2.5"/>
        <text x="60" y="81.5" text-anchor="middle" font-family="Orbitron, sans-serif" font-size="8.5" font-weight="700" fill="${accent}">${initials}</text>
        ${arms}
        ${extra}
        <path d="M42 34 Q42 12 60 12 Q78 12 78 34 Q78 52 60 54 Q42 52 42 34 Z" fill="${accent}" ${inkAttrs}/>
        <path d="M47 30 Q53 24 59 29 Q53 33 47 30 Z" fill="${eye}"/>
        <path d="M73 30 Q67 24 61 29 Q67 33 73 30 Z" fill="${eye}"/>
      </g>
    </svg>`;
  }

  const POWER_ICON_RULES = [
    [/blitz|elektro/i, "⚡"],
    [/feuer|flamme/i, "🔥"],
    [/eis|kälte|frost/i, "❄️"],
    [/flug|fliegen/i, "✈️"],
    [/schild/i, "🛡️"],
    [/netz/i, "🕸️"],
    [/unsichtbar/i, "👻"],
    [/telepath|geist|magie|zauber|mystis|portal|dimension/i, "✨"],
    [/heilung|regenerat/i, "💚"],
    [/laser|strahl|repulsor/i, "🔴"],
    [/gift|säure/i, "☠️"],
    [/klettern/i, "🕷️"],
    [/geschwindigkeit|schnelligkeit|reflexe/i, "💨"],
    [/rüstung|anzug|panzer|technolog/i, "🤖"],
    [/kralle|klinge/i, "🗡️"],
    [/wasser/i, "💧"],
    [/sinn|sonar|gehör/i, "📡"],
    [/kraft|stärke/i, "💪"],
    [/intellekt|genie|erfinder/i, "🧠"],
  ];
  function powerIcon(power) {
    const hit = POWER_ICON_RULES.find(([re]) => re.test(power));
    return hit ? hit[1] : "⭐";
  }
  function powerChipsHTML(powers, accent) {
    return (powers && powers.length ? powers : ["Keine Angaben"])
      .map(
        (p, i) => `<span class="power-chip" style="--accent-color:${accent}; --i:${i}">
          <span class="power-chip-icon">${powerIcon(p)}</span>${p}</span>`
      )
      .join("");
  }

  // Stilisierte "Figur" statt echtem Foto: Büsten-Silhouette mit Initialen,
  // eingefärbt in der Akzentfarbe des jeweiligen Universums.
  function characterFigureSVG(accent, initials) {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g" cx="50%" cy="32%" r="75%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0.35"/>
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="#0d0e16"/>
      <circle cx="50" cy="50" r="50" fill="url(#g)"/>
      <path d="M14 96 Q14 60 50 58 Q86 60 86 96 Z" fill="#0b0c14" opacity="0.68"/>
      <circle cx="50" cy="40" r="19" fill="#0b0c14" opacity="0.68"/>
      <text x="50" y="46" text-anchor="middle" font-family="Orbitron, sans-serif" font-size="19" font-weight="700" fill="#fff">${initials}</text>
    </svg>`;
  }

  function openCharacterModal(c, universe) {
    Sound.playClick();
    const accent = universe.accent;
    const modal = document.getElementById("character-modal");
    document.getElementById("character-card").style.setProperty("--accent-color", accent);
    document.getElementById("character-avatar").innerHTML = characterActionFigureSVG(accent, c.alignment, poseFor(c), getInitials(c.name));
    document.getElementById("character-name").textContent = c.name;
    document.getElementById("character-role").textContent = c.role;

    const alignColors = {
      Held: "#3fd0ff",
      Bösewicht: "#ff4d5e",
      Antiheld: "#c98bff",
      Zivilist: "#9aa3b5",
    };
    const alignBadge = document.getElementById("character-alignment");
    if (c.alignment) {
      alignBadge.textContent = c.alignment.toUpperCase();
      alignBadge.style.setProperty("--badge-color", alignColors[c.alignment] || accent);
      alignBadge.classList.remove("hidden");
    } else {
      alignBadge.classList.add("hidden");
    }

    const debutBadge = document.getElementById("character-debut");
    const debutYear = (c.films || []).reduce(
      (min, f) => (f.year && (min === null || f.year < min) ? f.year : min),
      null
    );
    if (debutYear !== null) {
      debutBadge.textContent = "ERSTAUFTRITT " + debutYear;
      debutBadge.classList.remove("hidden");
    } else {
      debutBadge.classList.add("hidden");
    }

    document.getElementById("character-bio").textContent =
      c.bio || "Zu diesem Charakter liegt noch kein ausführlicher Steckbrief vor.";

    const favBtn = document.getElementById("character-fav");
    const syncFav = () => {
      const active = isFavorite(universe.id, c.name);
      favBtn.textContent = active ? "♥" : "♡";
      favBtn.classList.toggle("active", active);
    };
    syncFav();
    favBtn.onclick = () => {
      toggleFavorite(universe.id, c.name);
      Sound.playClick();
      syncFav();
    };

    const powersWrap = document.getElementById("character-powers");
    powersWrap.innerHTML = powerChipsHTML(c.powers, accent);

    const filmsList = document.getElementById("character-films");
    filmsList.innerHTML = "";
    (c.films || []).forEach((f) => {
      const li = document.createElement("li");
      li.style.setProperty("--accent-color", accent);
      li.innerHTML = `
        <div class="cf-top"><span>${f.title}</span><span class="cf-year">${f.year}</span></div>
        ${f.note ? `<div class="cf-note">${f.note}</div>` : ""}`;
      filmsList.appendChild(li);
    });

    modal.classList.remove("hidden");
  }

  document.getElementById("character-close").addEventListener("click", () => {
    document.getElementById("character-modal").classList.add("hidden");
  });

  // ---------- Fill side panel ----------
  function fillPanel(u) {
    document.getElementById("panel-eyebrow").textContent = u.eyebrow.toUpperCase();
    document.getElementById("panel-title").textContent = u.name;
    document.getElementById("panel-desc").textContent = u.desc;

    const countdownBlock = document.getElementById("countdown-block");
    if (u.isDoomsday) {
      countdownBlock.classList.remove("hidden");
      startCountdown(u.releaseDate);
      const d = new Date(u.releaseDate);
      document.getElementById("countdown-date").textContent =
        "Kinostart: " + d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
    } else {
      countdownBlock.classList.add("hidden");
      clearInterval(countdownInterval);
    }

    const trailerBlock = document.getElementById("trailer-block");
    if (u.trailerYouTubeId) {
      // Öffnet/startet den persistenten Mini-Player (läuft auch beim Planetenwechsel weiter).
      openTrailerWidget(u);
      trailerBlock.classList.remove("hidden");
      document.getElementById("trailer-reopen-btn").onclick = () => openTrailerWidget(u);
    } else {
      trailerBlock.classList.add("hidden");
    }

    const charList = document.getElementById("panel-characters");
    charList.innerHTML = "";
    u.characters.forEach((c) => {
      const li = document.createElement("li");
      const favActive = isFavorite(u.id, c.name);
      li.innerHTML = `
        <div class="avatar">${characterFigureSVG(u.accent, getInitials(c.name))}</div>
        <div class="info">
          <span class="cname">${c.name}</span>
          <span class="crole">${c.role}</span>
        </div>
        <button class="fav-heart${favActive ? " active" : ""}" type="button" title="Favorit">${favActive ? "♥" : "♡"}</button>`;
      li.addEventListener("click", () => openCharacterModal(c, u));
      const heart = li.querySelector(".fav-heart");
      heart.addEventListener("click", (e) => {
        e.stopPropagation();
        const nowFav = toggleFavorite(u.id, c.name);
        heart.textContent = nowFav ? "♥" : "♡";
        heart.classList.toggle("active", nowFav);
        Sound.playClick();
      });
      charList.appendChild(li);
    });

    const movieList = document.getElementById("panel-movies");
    movieList.innerHTML = "";
    u.movies.forEach((m) => {
      const li = document.createElement("li");
      li.style.setProperty("--accent-color", u.accent);
      li.innerHTML = `<span class="mtitle">${m.title}</span><span class="myear">${m.year}</span>`;
      movieList.appendChild(li);
    });
  }

  // ---------- Resize ----------
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- Animate ----------
  const clock = new THREE.Clock();

  function updateLabels() {
    planetObjects.forEach((p) => {
      const worldPos = new THREE.Vector3();
      p.mesh.getWorldPosition(worldPos);
      const projected = worldPos.clone().project(camera);
      const el = labelEls[p.data.id];
      if (projected.z > 1) {
        el.style.display = "none";
        return;
      }
      const rawX = (projected.x * 0.5 + 0.5) * window.innerWidth;
      const rawY = (-projected.y * 0.5 + 0.5) * window.innerHeight;
      const x = rawX;
      const y = Math.min(Math.max(rawY, 100), window.innerHeight - 150);
      el.style.display = "flex";
      el.style.left = x + "px";
      el.style.top = (y - 30) + "px";

      // Label nach dem Positionieren am tatsächlichen Rand einfangen, egal wie
      // breit sein Text ist (variiert je nach Sprache/Universumsname).
      const rect = el.getBoundingClientRect();
      let dx = 0;
      if (rect.left < 6) dx = 6 - rect.left;
      else if (rect.right > window.innerWidth - 6) dx = window.innerWidth - 6 - rect.right;
      if (dx !== 0) el.style.left = x + dx + "px";
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    planetObjects.forEach((p) => {
      // Der fokussierte Planet bleibt während der Ansicht an Ort und Stelle stehen,
      // damit man frei um ihn herum drehen kann, ohne dass er wegdriftet.
      if (p.data.id !== activeId) {
        if (p.orbitRadius > 0) {
          p.angle += p.orbitSpeed * dt;
          p.group.position.set(
            Math.cos(p.angle) * p.orbitRadius,
            p.yOffset + Math.sin(t * 0.3 + p.angle) * 0.6,
            Math.sin(p.angle) * p.orbitRadius
          );
        } else {
          p.group.position.set(0, p.yOffset + Math.sin(t * 0.4) * 0.4, 0);
        }
      }
      p.mesh.rotation.y += p.spinSpeed * dt;
    });

    // Beim Auswählen/Verlassen eines Universums fliegt die Kamera einmalig zur
    // Zielposition; danach übernimmt OrbitControls die freie Steuerung (Drehen/Zoomen).
    if (flying) {
      if (activeId) {
        const p = planetObjects.find((pl) => pl.data.id === activeId);
        if (p) {
          const wp = new THREE.Vector3();
          p.mesh.getWorldPosition(wp);
          const dir = wp.clone().normalize();
          camPosTarget.copy(wp).addScaledVector(dir, p.data.radius * 3.2 + 6);
          camPosTarget.y += p.data.radius * 1.4 + 2;
          lookTarget.copy(wp);
        }
      }
      camera.position.lerp(camPosTarget, 1 - Math.pow(0.001, dt));
      camTarget.lerp(lookTarget, 1 - Math.pow(0.001, dt));
      if (camera.position.distanceTo(camPosTarget) < 0.05 && camTarget.distanceTo(lookTarget) < 0.05) {
        flying = false;
      }
    }
    controls.target.copy(camTarget);
    controls.update();

    starfield.rotation.y += dt * 0.004;

    doomFigure.group.rotation.y = 0.45 + Math.sin(t * 0.15) * 0.3;
    doomFigure.group.position.y = 12 + Math.sin(t * 0.4) * 0.5;
    doomFigure.eyeLight.intensity = 2.6 + Math.sin(t * 3) * 0.9;

    infinityStones.stoneMeshes.forEach((m) => {
      m.rotation.x += dt * 0.6;
      m.rotation.y += dt * 0.8;
      m.position.y = m.userData.basePos.y + Math.sin(t * 0.8 + m.userData.phase) * 0.6;
    });

    updateLabels();
    renderer.render(scene, camera);
  }

  animate();
})();
