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

  // ---------- Overlay-Übergänge & Render-Pause ----------
  // Alle Vollbild-Ebenen laufen über dieselben Helfer: sie starten die kurze
  // Einblend-Animation neu und pausieren die 3D-Szene, solange etwas davor liegt
  // (spart Rechenzeit, wenn die Planeten ohnehin verdeckt sind).
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const BLOCKING_OVERLAY_IDS = [
    "travel-overlay",
    "discover-overlay",
    "favorites-overlay",
    "compare-overlay",
    "theories-overlay",
    "character-modal",
    "film-modal",
    "map-overlay",
    "snap-overlay",
    "secret-overlay",
    "stats-overlay",
    "profile-dashboard",
    "charlab-overlay",
  ];

  let renderPaused = false;

  function updateRenderPause() {
    const covered = BLOCKING_OVERLAY_IDS.some((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains("hidden");
    });
    renderPaused = covered || document.hidden;
    if (window.MarvelGroot && MarvelGroot.setPaused) MarvelGroot.setPaused(renderPaused);
  }

  document.addEventListener("visibilitychange", updateRenderPause);

  function openOverlay(el) {
    if (!el) return;
    el.classList.remove("hidden");
    // Einblend-Animation des Inhalts neu starten
    const inner = el.firstElementChild;
    if (inner && !reduceMotion) {
      inner.style.animation = "none";
      void inner.offsetWidth;
      inner.style.animation = "";
    }
    updateRenderPause();
  }

  function closeOverlay(el) {
    if (!el) return;
    el.classList.add("hidden");
    updateRenderPause();
  }

  // Kurzer Warp-Effekt beim Sprung zu einem Planeten (nur transform/opacity).
  function playWarpFlash(color) {
    if (reduceMotion) return;
    const flash = document.createElement("div");
    flash.className = "warp-flash";
    flash.style.setProperty("--warp-color", color || "#ffffff");
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
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
          year: m.year,
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

  // ---------- User gate (Profilauswahl + PIN-Zugang) ----------
  // Die Profile selbst stehen zentral in data.js (AVATARS). Hier kommt nur der
  // Ablauf dazu: Profil wählen → PIN prüfen lassen → Multiversum öffnen.
  function initUserGate() {
    const gate = document.getElementById("user-gate");
    const cardsWrap = document.getElementById("gate-cards");
    const notice = document.getElementById("gate-notice");

    const dialog = document.getElementById("pin-dialog");
    const pinInput = document.getElementById("pin-input");
    const pinDots = document.getElementById("pin-dots");
    const pinKeypad = document.getElementById("pin-keypad");
    const pinStatus = document.getElementById("pin-status");
    const pinSubmit = document.getElementById("pin-submit");
    const pinRemember = document.getElementById("pin-remember");
    const success = document.getElementById("gate-success");

    const MIN_PIN = 4;
    const MAX_PIN = 8;

    const allUsers = AVATARS;
    let authRequired = false; // wird aus dem Worker-Status gesetzt
    let pendingId = null; // Profil, dessen PIN gerade abgefragt wird
    let busy = false;

    function avatarSvgFor(u) {
      return u.svg || characterFigureSVG(u.color, getInitials(u.name));
    }

    function showNotice(text) {
      notice.textContent = text;
      notice.classList.remove("hidden");
      clearTimeout(showNotice.timer);
      showNotice.timer = setTimeout(() => notice.classList.add("hidden"), 4200);
    }

    // ---------- Profilkarten ----------
    function renderCards() {
      cardsWrap.innerHTML = "";
      Object.entries(allUsers).forEach(([id, u]) => {
        const card = document.createElement("button");
        card.className = "gate-card";
        card.type = "button";
        card.dataset.profile = id;
        card.style.setProperty("--hero-color", u.color);
        card.innerHTML = `
          <span class="gate-card-glow" aria-hidden="true"></span>
          <span class="gate-card-lock" aria-hidden="true">🔒</span>
          <div class="gate-avatar">${avatarSvgFor(u)}</div>
          <div class="gate-name">${u.name}</div>
          <div class="gate-hero">${u.hero}</div>`;
        card.addEventListener("click", () => chooseProfile(id));
        cardsWrap.appendChild(card);
      });

      // Bleibt erhalten, legt aber bewusst noch kein Profil an: dafür bräuchte
      // es eine sichere serverseitige Ablage der PIN.
      const createCard = document.createElement("button");
      createCard.className = "gate-card gate-card-create";
      createCard.type = "button";
      createCard.innerHTML = `
        <div class="gate-avatar-plus">+</div>
        <div class="gate-name">Neuer Benutzer</div>
        <div class="gate-hero">Eigenes Profil erstellen</div>`;
      createCard.addEventListener("click", () => {
        Sound.playClick();
        showNotice("Neue Profile werden demnächst unterstützt.");
      });
      cardsWrap.appendChild(createCard);
    }

    // ---------- PIN-Dialog ----------
    function renderDots() {
      const filled = pinInput.value.length;
      const slots = Math.max(MIN_PIN, Math.min(MAX_PIN, filled + (filled >= MIN_PIN ? 1 : 0)));
      pinDots.innerHTML = "";
      for (let i = 0; i < slots; i++) {
        const dot = document.createElement("span");
        dot.className = "pin-dot" + (i < filled ? " filled" : "");
        pinDots.appendChild(dot);
      }
      pinSubmit.disabled = filled < MIN_PIN;
    }

    function buildKeypad() {
      pinKeypad.innerHTML = "";
      const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];
      keys.forEach((key) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pin-key" + (key === "clear" || key === "back" ? " pin-key-alt" : "");
        btn.textContent = key === "clear" ? "C" : key === "back" ? "⌫" : key;
        btn.setAttribute("aria-label", key === "clear" ? "Eingabe löschen" : key === "back" ? "Letzte Ziffer löschen" : key);
        btn.addEventListener("click", () => {
          if (key === "clear") pinInput.value = "";
          else if (key === "back") pinInput.value = pinInput.value.slice(0, -1);
          else if (pinInput.value.length < MAX_PIN) pinInput.value += key;
          clearError();
          renderDots();
          pinInput.focus();
        });
        pinKeypad.appendChild(btn);
      });
    }

    function clearError() {
      pinStatus.textContent = "";
      pinStatus.className = "";
      document.getElementById("pin-card").classList.remove("error");
    }

    function showError(text) {
      const card = document.getElementById("pin-card");
      pinStatus.textContent = text;
      pinStatus.className = "denied";
      card.classList.remove("error");
      // Neustart der Shake-Animation erzwingen
      void card.offsetWidth;
      card.classList.add("error");
      pinInput.value = "";
      renderDots();
    }

    function openPinDialog(id) {
      const u = allUsers[id];
      if (!u) return;
      pendingId = id;

      document.getElementById("pin-avatar").innerHTML = avatarSvgFor(u);
      document.getElementById("pin-name").textContent = u.name.toUpperCase();
      document.getElementById("pin-hero").textContent = u.hero;
      document.getElementById("pin-card").style.setProperty("--hero-color", u.color);

      pinInput.value = "";
      pinRemember.checked = false;
      clearError();
      renderDots();

      gate.classList.add("picking");
      cardsWrap.querySelectorAll(".gate-card").forEach((card) => {
        card.classList.toggle("chosen", card.dataset.profile === id);
      });

      dialog.classList.remove("hidden");
      setTimeout(() => pinInput.focus(), 120);
    }

    function closePinDialog() {
      pendingId = null;
      dialog.classList.add("hidden");
      gate.classList.remove("picking");
      cardsWrap.querySelectorAll(".gate-card").forEach((card) => card.classList.remove("chosen"));
      pinInput.value = "";
      clearError();
    }

    // ---------- Anmelden ----------
    function chooseProfile(id) {
      Sound.playClick();
      if (!authRequired) {
        // Anmeldung ist (noch) nicht eingerichtet → bisheriges Verhalten.
        enterMultiverse(id, true);
        return;
      }
      openPinDialog(id);
    }

    function submitPin() {
      if (busy || !pendingId) return;
      const pin = pinInput.value;
      if (pin.length < MIN_PIN) {
        showError("Bitte mindestens " + MIN_PIN + " Ziffern eingeben.");
        return;
      }

      busy = true;
      pinSubmit.disabled = true;
      pinStatus.className = "checking";
      pinStatus.textContent = "Autorisierung läuft…";

      MarvelAuth.login(pendingId, pin, pinRemember.checked)
        .then((result) => {
          busy = false;
          // Die eingegebene PIN wird sofort verworfen.
          pinInput.value = "";
          renderDots();

          if (result.ok) {
            const id = pendingId;
            dialog.classList.add("hidden");
            enterMultiverse(id, false);
            return;
          }
          if (result.reason === "locked") {
            showError("Zu viele Versuche — bitte " + result.retryAfter + " Sekunden warten.");
          } else if (result.reason === "offline") {
            showError("Zugangsserver nicht erreichbar.");
          } else if (result.reason === "not-configured") {
            showError("Für dieses Profil ist noch keine PIN hinterlegt.");
          } else {
            showError("ZUGANG VERWEIGERT");
          }
        })
        .catch(() => {
          busy = false;
          pinInput.value = "";
          renderDots();
          showError("ZUGANG VERWEIGERT");
        });
    }

    // ---------- Übergang ins Multiversum ----------
    function enterMultiverse(id, skipAnimation) {
      const u = allUsers[id];
      applyUser(id);
      try {
        localStorage.setItem("marvelUser", id);
      } catch (e) {
        /* ignorieren */
      }
      Sound.ensureCtx();
      Sound.startAmbient();
      Sound.playPower();

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (skipAnimation || reduce) {
        gate.classList.add("hidden");
        gate.classList.remove("picking");
        return;
      }

      document.getElementById("gate-success-name").textContent = `Willkommen zurück, ${u.name}.`;
      success.classList.remove("hidden");
      gate.classList.add("confirmed");

      setTimeout(() => {
        gate.classList.add("hidden");
        gate.classList.remove("picking", "confirmed");
        success.classList.add("hidden");
        cardsWrap.querySelectorAll(".gate-card").forEach((card) => card.classList.remove("chosen"));
      }, 1500);
    }

    function applyUser(id) {
      const u = allUsers[id];
      if (!u) return;
      currentUser = id;
      // Eigener Fortschritt pro Profil (gesehen, Watchlist, Bewertungen, Erfolge)
      if (window.MarvelProgress) MarvelProgress.setProfile(id);
      document.getElementById("profile-avatar").innerHTML = avatarSvgFor(u);
      document.getElementById("profile-name").textContent = u.name;
      document.getElementById("profile-hero").textContent = u.hero;
      const badge = document.getElementById("profile-badge");
      badge.classList.remove("hidden");
      badge.style.setProperty("--hero-color", u.color);
    }

    // ---------- Abmelden / Profil wechseln ----------
    function showGate() {
      closePinDialog();
      gate.classList.remove("hidden");
    }

    function endSession() {
      MarvelAuth.logout();
      currentUser = null;
      if (window.MarvelProgress) MarvelProgress.setProfile(null);
      document.getElementById("profile-badge").classList.add("hidden");
      try {
        localStorage.removeItem("marvelUser");
      } catch (e) {
        /* ignorieren */
      }
    }

    document.getElementById("profile-switch").addEventListener("click", () => {
      Sound.playClick();
      endSession();
      showGate();
    });

    document.getElementById("profile-logout").addEventListener("click", () => {
      Sound.playClick();
      endSession();
      showGate();
      showNotice("Abgemeldet. Bitte Profil wählen.");
    });

    // ---------- Eingabe: Tastatur, Ziffernfeld, Touch ----------
    pinInput.addEventListener("input", () => {
      pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, MAX_PIN);
      clearError();
      renderDots();
    });

    pinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitPin();
      }
    });

    pinSubmit.addEventListener("click", submitPin);
    document.getElementById("pin-close").addEventListener("click", () => {
      Sound.playClick();
      closePinDialog();
    });

    // Escape schließt den Dialog, Klick auf den Hintergrund ebenfalls.
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePinDialog();
      }
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closePinDialog();
    });

    buildKeypad();
    renderCards();
    renderDots();

    // ---------- Start: Status holen und ggf. bestehende Sitzung fortsetzen ----------
    MarvelAuth.status().then((state) => {
      authRequired = state.configured;
      gate.classList.toggle("auth-on", authRequired);

      if (!authRequired) {
        // Ohne eingerichtete Anmeldung verhält sich die Seite wie bisher.
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
        return;
      }

      // Mit Anmeldung: nur eine vom Worker bestätigte Sitzung öffnet die Seite.
      MarvelAuth.verify().then((profile) => {
        if (profile && allUsers[profile]) {
          applyUser(profile);
          gate.classList.add("hidden");
        }
      });
    });
  }
  initUserGate();

  // Kürzel eines Filmtitels — dient überall als Fallback, wenn kein Poster geladen wird.
  const POSTER_SKIP_WORDS = ["the", "of", "and", "a", "to", "in"];
  function posterAbbrev(title) {
    const words = String(title)
      .replace(/[:*'’]/g, "")
      .split(" ")
      .filter((w) => w && POSTER_SKIP_WORDS.indexOf(w.toLowerCase()) === -1);
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  // ---------- Gesehen / Watchlist / Bewertung (gemeinsame Bausteine) ----------
  // Entdecken, Marvel Travel, Universum-Panel und Film-Detail lesen denselben
  // Stand aus window.MarvelProgress (keine eigenen Speicherstände). Jedes
  // gebundene Element trägt data-watch-id; bei einer Änderung werden genau
  // diese Elemente abgeglichen (Klassen, aria-pressed, Sterne) — Karten und
  // Poster bleiben stehen und werden nie neu gebaut oder neu geladen.
  const Watch = (function () {
    const P = window.MarvelProgress || null;

    const ICONS = {
      seen:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle class="wi-ring" cx="12" cy="12" r="9"/><path class="wi-check" d="M7.7 12.4l2.9 2.9 5.7-6.1"/></svg>',
      check:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="wi-check" d="M6.2 12.6l3.7 3.7 7.9-8.4"/></svg>',
      bookmark:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="wi-mark" d="M7 3.6h10a1.2 1.2 0 0 1 1.2 1.2v15.6L12 16.5l-6.2 3.9V4.8A1.2 1.2 0 0 1 7 3.6z"/></svg>',
      star:
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="wi-star" d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.85 1.03-6L3.3 9.6l6-.9z"/></svg>',
    };

    const STATUS_FILTERS = [
      { id: "all", label: "Alle" },
      { id: "watched", label: "Gesehen" },
      { id: "unwatched", label: "Ungesehen" },
      { id: "watchlist", label: "Watchlist" },
    ];

    function signedIn() {
      return Boolean(P && P.profile());
    }

    // "2026-12-18" → "18.12.2026" (ohne Datum: Erscheinungsjahr)
    function releaseLabel(entry) {
      if (!entry) return "";
      if (entry.releaseDate) {
        const d = new Date(entry.releaseDate + (entry.releaseDate.length <= 10 ? "T00:00:00" : ""));
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
        }
      }
      return String(entry.year || "");
    }

    // ---------- Markup-Bausteine (Zustand setzt apply()) ----------
    function seenButtonHTML(variant) {
      return `<button type="button" class="watch-btn watch-btn-seen${variant ? " watch-btn-" + variant : ""}" data-watch-action="seen" data-variant="${variant || "card"}" aria-pressed="false">${ICONS.seen}<span class="watch-btn-label">Gesehen</span></button>`;
    }

    function listButtonHTML(variant) {
      const label = variant === "lg" ? '<span class="watch-btn-label">Watchlist</span>' : "";
      return `<button type="button" class="watch-btn watch-btn-list${variant ? " watch-btn-" + variant : ""}" data-watch-action="list" data-variant="${variant || "card"}" aria-pressed="false">${ICONS.bookmark}${label}</button>`;
    }

    function starsHTML(variant) {
      let html = `<div class="watch-stars${variant ? " watch-stars-" + variant : ""}" role="group">`;
      for (let n = 1; n <= 5; n++) {
        html += `<button type="button" class="watch-star" data-watch-action="star" data-star="${n}" aria-pressed="false" aria-label="Mit ${n} von 5 Sternen bewerten">${ICONS.star}</button>`;
      }
      return html + "</div>";
    }

    // Poster-Overlay der Entdecken-Karten: liegt neben (nicht in) .film-poster,
    // weil loadPosterInto den Poster-Inhalt beim Nachladen ersetzt.
    function posterBadgesHTML() {
      return `<div class="watch-badges" aria-hidden="true">
          <span class="watch-badge watch-badge-seen">${ICONS.check}</span>
          <span class="watch-badge watch-badge-list">${ICONS.bookmark}</span>
          <span class="watch-badge watch-badge-soon">Demnächst</span>
        </div>`;
    }

    function cardActionsHTML() {
      return `<div class="watch-actions">
          <div class="watch-actions-row">${seenButtonHTML("")}${listButtonHTML("")}</div>
          ${starsHTML("")}
        </div>`;
    }

    function miniBadgeHTML() {
      return `<span class="watch-badge watch-badge-seen watch-badge-mini" aria-hidden="true">${ICONS.check}</span>`;
    }

    function pillHTML() {
      return `<button type="button" class="watch-btn watch-btn-seen watch-btn-pill" data-watch-action="seen" data-variant="pill" aria-pressed="false">${ICONS.seen}<span class="watch-btn-label">Gesehen</span></button>`;
    }

    function iconButtonHTML() {
      return `<button type="button" class="watch-btn watch-btn-seen watch-btn-icon" data-watch-action="seen" data-variant="icon" aria-pressed="false">${ICONS.seen}</button>`;
    }

    function modalActionsHTML() {
      return `${seenButtonHTML("lg")}${listButtonHTML("lg")}${starsHTML("lg")}<span class="watch-hint" aria-live="polite"></span>`;
    }

    // ---------- Zustand ins DOM übertragen ----------
    function apply(node) {
      const id = node.getAttribute("data-watch-id");
      const entry = P && id ? P.get(id) : null;
      const on = signedIn() && Boolean(entry);
      const released = entry ? P.isReleased(entry) : true;
      const watched = on && P.isWatched(id);
      const listed = on && P.inWatchlist(id);
      const stars = watched ? P.rating(id) : 0;
      const title = entry ? entry.title : "";
      const when = entry && !released ? releaseLabel(entry) : "";

      node.classList.toggle("is-watched", watched);
      node.classList.toggle("is-listed", listed);
      node.classList.toggle("is-upcoming", Boolean(entry) && !released);
      node.classList.toggle("is-rated", stars > 0);

      node.querySelectorAll('[data-watch-action="seen"]').forEach((btn) => {
        const variant = btn.getAttribute("data-variant");
        // Bewusst kein disabled-Attribut: Klicks darauf würden vom Browser
        // verschluckt — so erscheint beim Tippen der Hinweis zum Kinostart.
        btn.classList.toggle("is-disabled", !released);
        if (released) btn.removeAttribute("aria-disabled");
        else btn.setAttribute("aria-disabled", "true");
        btn.setAttribute("aria-pressed", watched ? "true" : "false");
        btn.setAttribute("aria-label", `Gesehen: ${title}`);
        btn.title = !released
          ? `Erscheint am ${when}`
          : watched
          ? "Gesehen — erneut klicken entfernt die Markierung"
          : "Als gesehen markieren";
        const label = btn.querySelector(".watch-btn-label");
        if (label) {
          label.textContent = released ? "Gesehen" : variant === "lg" ? `Erscheint am ${when}` : `Ab ${when}`;
        }
      });

      node.querySelectorAll('[data-watch-action="list"]').forEach((btn) => {
        btn.setAttribute("aria-pressed", listed ? "true" : "false");
        btn.setAttribute("aria-label", `Watchlist: ${title}`);
        btn.title = listed ? "Von der Watchlist entfernen" : "Zur Watchlist hinzufügen";
        const label = btn.querySelector(".watch-btn-label");
        if (label) label.textContent = listed ? "Auf der Watchlist" : "Watchlist";
      });

      node.querySelectorAll(".watch-stars").forEach((group) => {
        group.classList.toggle("is-locked", !watched);
        group.setAttribute("aria-disabled", watched ? "false" : "true");
        group.setAttribute(
          "aria-label",
          watched
            ? `Bewertung für ${title}: ${stars ? stars + " von 5 Sternen" : "noch nicht bewertet"}`
            : `Bewertung für ${title} — erst nach dem Ansehen möglich`
        );
        group.title = !watched
          ? released
            ? "Erst als gesehen markieren, dann bewerten"
            : `Bewertung ab dem Kinostart am ${when}`
          : stars
          ? `${stars} von 5 Sternen — Klick auf den aktuellen Stern entfernt die Bewertung`
          : "Jetzt bewerten";
        group.querySelectorAll(".watch-star").forEach((star) => {
          const n = Number(star.getAttribute("data-star"));
          star.classList.toggle("is-on", n <= stars);
          star.setAttribute("aria-pressed", n === stars ? "true" : "false");
        });
      });

      const hint = node.querySelector(".watch-hint");
      if (hint) {
        hint.textContent = !released
          ? "Auf die Watchlist setzen und am Kinostart als gesehen markieren."
          : watched
          ? ""
          : "Als gesehen markieren, um zu bewerten.";
      }
    }

    function sync(id) {
      document.body.classList.toggle("watch-signed-out", !signedIn());
      const selector = id ? `[data-watch-id="${id}"]` : "[data-watch-id]";
      document.querySelectorAll(selector).forEach(apply);
    }

    // ---------- Aktionen ----------
    function handleClick(e) {
      // Aktions-Klicks dürfen die Karte (Film-Detail / Serien-Info) nie öffnen —
      // auch nicht der Zwischenraum zwischen den Knöpfen.
      e.stopPropagation();
      const btn = e.target.closest("[data-watch-action]");
      if (!btn || !e.currentTarget.contains(btn) || !P) return;
      const root = btn.closest("[data-watch-id]");
      const id = root ? root.getAttribute("data-watch-id") : null;
      const entry = id ? P.get(id) : null;
      if (!entry) return;
      if (!signedIn()) {
        showToast("Bitte zuerst ein Profil wählen.");
        return;
      }
      const action = btn.getAttribute("data-watch-action");
      if (action === "seen") {
        if (!P.isReleased(entry)) {
          showToast(`📅 ${entry.title} erscheint am ${releaseLabel(entry)} — danach kannst du ihn als gesehen markieren.`, 4200);
          return;
        }
        P.toggleWatched(id);
      } else if (action === "list") {
        P.toggleWatchlist(id);
      } else if (action === "star") {
        if (!P.isWatched(id)) {
          showToast(
            P.isReleased(entry)
              ? `Markiere „${entry.title}“ zuerst als gesehen, um ihn zu bewerten.`
              : `„${entry.title}“ kann erst nach dem Kinostart bewertet werden.`
          );
          return;
        }
        const n = Number(btn.getAttribute("data-star")) || 0;
        P.setRating(id, P.rating(id) === n ? 0 : n);
      }
      Sound.playClick();
    }

    // Sterne-Vorschau beim Überfahren (nur Maus, damit auf Touch nichts hängen bleibt)
    function bindStarPreview(group) {
      group.addEventListener("pointerover", (e) => {
        if (e.pointerType !== "mouse" || group.classList.contains("is-locked")) return;
        const star = e.target.closest(".watch-star");
        if (!star) return;
        const n = Number(star.getAttribute("data-star"));
        group.classList.add("is-previewing");
        group.querySelectorAll(".watch-star").forEach((s) => {
          s.classList.toggle("is-preview", Number(s.getAttribute("data-star")) <= n);
        });
      });
      group.addEventListener("pointerleave", () => {
        group.classList.remove("is-previewing");
        group.querySelectorAll(".is-preview").forEach((s) => s.classList.remove("is-preview"));
      });
    }

    function bind(container) {
      if (!container) return;
      container.addEventListener("click", handleClick);
      if (container.classList.contains("watch-stars")) bindStarPreview(container);
      container.querySelectorAll(".watch-stars").forEach(bindStarPreview);
    }

    // ---------- Status-Filter (Alle / Gesehen / Ungesehen / Watchlist) ----------
    function matchesStatus(id, status) {
      if (!status || status === "all" || !signedIn()) return true;
      if (!id) return false;
      if (status === "watched") return P.isWatched(id);
      if (status === "unwatched") return !P.isWatched(id);
      if (status === "watchlist") return P.inWatchlist(id);
      return true;
    }

    function statusCounts(ids) {
      const counts = { all: ids.length, watched: 0, unwatched: 0, watchlist: 0 };
      if (!signedIn()) return counts;
      ids.forEach((id) => {
        if (!id) return;
        if (P.isWatched(id)) counts.watched++;
        else counts.unwatched++;
        if (P.inWatchlist(id)) counts.watchlist++;
      });
      return counts;
    }

    // Baut die Chips einmalig und aktualisiert danach nur Text/Zustand
    // (Fokus bleibt bei Live-Aktualisierungen erhalten).
    function renderStatusChips(row, active, counts, onSelect) {
      if (!row) return;
      if (!row.hasAttribute("data-watch-built")) {
        row.setAttribute("data-watch-built", "");
        row.classList.add("watch-filter-row");
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", "Nach Status filtern");
        row.innerHTML =
          '<span class="watch-filter-label" aria-hidden="true">Status</span>' +
          STATUS_FILTERS.map(
            (s) =>
              `<button type="button" class="discover-chip watch-chip watch-chip-${s.id}" data-status="${s.id}" aria-pressed="false"><span class="watch-chip-dot" aria-hidden="true"></span><span class="watch-chip-text">${s.label}</span><span class="watch-chip-count"></span></button>`
          ).join("");
        row.addEventListener("click", (e) => {
          const chip = e.target.closest("[data-status]");
          if (chip && row.contains(chip)) onSelect(chip.getAttribute("data-status"));
        });
      }
      row.querySelectorAll("[data-status]").forEach((chip) => {
        const s = chip.getAttribute("data-status");
        chip.classList.toggle("active", s === active);
        chip.setAttribute("aria-pressed", s === active ? "true" : "false");
        chip.querySelector(".watch-chip-count").textContent = String(counts[s] || 0);
      });
    }

    function isRelevant(ev) {
      return ["profile", "sync", "watched", "watchlist", "rating"].indexOf(ev && ev.type) !== -1;
    }

    if (P) {
      P.subscribe((ev) => {
        if (ev.type === "profile" || ev.type === "sync") sync();
        else if (isRelevant(ev)) sync(ev.id);
      });
    }
    document.body.classList.toggle("watch-signed-out", !signedIn());

    return {
      P,
      signedIn,
      releaseLabel,
      posterBadgesHTML,
      cardActionsHTML,
      miniBadgeHTML,
      pillHTML,
      iconButtonHTML,
      modalActionsHTML,
      apply,
      sync,
      bind,
      matchesStatus,
      statusCounts,
      renderStatusChips,
      isRelevant,
    };
  })();

  // ---------- Marvel Travel (MCU-Chronologie) ----------
  function initTravel() {
    const btn = document.getElementById("travel-btn");
    const overlay = document.getElementById("travel-overlay");
    const closeBtn = document.getElementById("travel-close");
    const panel = document.getElementById("travel-panel");
    const container = document.getElementById("travel-timeline");
    const storyBtn = document.getElementById("travel-mode-story");
    const releaseBtn = document.getElementById("travel-mode-release");
    const PHASE_COLORS = ["#ff4d4d", "#5b8bff", "#ffce54", "#38d4e0", "#8a2be2", "#ff5a3c"];

    let progressLine = null;
    let revealObserver = null;

    // Die Linie zwischen den Filmen wird beim Scrollen Stück für Stück beleuchtet.
    function updateLineProgress() {
      if (!progressLine) return;
      const max = panel.scrollHeight - panel.clientHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, panel.scrollTop / max)) : 1;
      progressLine.style.transform = `scaleY(${ratio})`;
    }

    function render(mode) {
      if (revealObserver) revealObserver.disconnect();
      container.innerHTML = "";
      // Grid-Layout der Zeitleiste (Mittellinie + abwechselnd links/rechts)
      container.className = "mcu-timeline";

      const line = document.createElement("div");
      line.className = "mcu-line";
      container.appendChild(line);

      progressLine = document.createElement("div");
      progressLine.className = "mcu-line-progress";
      container.appendChild(progressLine);

      const groups = mode === "release" ? MCU_TIMELINE : MCU_CHRONO_TIMELINE;
      let side = 0;
      groups.forEach((group, groupIdx) => {
        const color = PHASE_COLORS[groupIdx % PHASE_COLORS.length];

        const marker = document.createElement("div");
        marker.className = "mcu-phase-marker reveal";
        marker.style.setProperty("--item-color", color);
        marker.textContent = mode === "release" ? group.phase : `${group.era} · ${group.years}`;
        container.appendChild(marker);

        group.films.forEach((f) => {
          const info = MarvelDerive.filmInfo(f.title);
          const phase = info ? info.phase : "";
          const desc = info ? info.desc : "";
          // Handlungsjahr (Anzeige) kann vom echten Kinostart-Jahr abweichen
          // (z.B. Captain America: The First Avenger spielt 1942, kam aber 2011
          // ins Kino) — für die TMDB-Suche wird deshalb immer das echte
          // Kinostart-Jahr verwendet, sonst findet TMDB keinen Treffer.
          const tmdbYear = MarvelDerive.releaseYearFor(f.title) || f.year;
          // Gemeinsamer Gesehen-Status (dieselbe Katalog-ID wie in Entdecken)
          const watchId = Watch.P ? Watch.P.idFor(f.title, tmdbYear, "movie") : null;

          const item = document.createElement("div");
          item.className =
            "mcu-item reveal " + (side === 0 ? "left" : "right") + (f.finale ? " finale" : "") +
            (watchId ? " watch-travel" : "");
          item.style.setProperty("--item-color", color);
          if (watchId) item.setAttribute("data-watch-id", watchId);
          item.innerHTML = `
            <span class="mcu-dot"></span>
            <div class="mcu-poster-wrap">
              <div class="mcu-poster">${posterAbbrev(f.title)}</div>
              ${watchId ? Watch.miniBadgeHTML() : ""}
            </div>
            <div class="mcu-card">
              <span class="mcu-year">${f.year}${phase && mode !== "release" ? ` · ${phase}` : ""}</span>
              <span class="mcu-title">${f.title}</span>
              ${desc ? `<span class="mcu-desc">${desc}</span>` : ""}
              ${f.note ? `<span class="mcu-note">${f.note}</span>` : ""}
              ${watchId ? Watch.pillHTML() : ""}
            </div>`;
          if (watchId) {
            Watch.bind(item.querySelector(".watch-btn-pill"));
            Watch.apply(item);
          }
          container.appendChild(item);

          // Echtes Poster nachladen, Kürzel bleibt als Fallback stehen.
          loadPosterInto(item.querySelector(".mcu-poster"), f.title, tmdbYear);

          // Beim Überfahren erscheint das Szenenbild des Films dezent im Hintergrund.
          let backdropLoaded = false;
          item.addEventListener("pointerenter", () => {
            if (backdropLoaded || !window.TMDB || !TMDB.enabled()) return;
            backdropLoaded = true;
            TMDB.movieBackdrop(f.title, tmdbYear)
              .then((url) => (url ? preload(url) : null))
              .then((url) => {
                if (url) item.style.setProperty("--item-backdrop", `url("${url}")`);
              })
              .catch(() => {});
          });

          item.addEventListener("click", () => openFilmModal(f.title, f.year, tmdbYear));
          side = 1 - side;
        });
      });

      // Kapitel und Filme cineastisch einblenden, sobald sie in Sicht kommen.
      if ("IntersectionObserver" in window && !reduceMotion) {
        revealObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.classList.add("visible");
                revealObserver.unobserve(entry.target);
              }
            });
          },
          { root: panel, rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
        );
        Array.prototype.forEach.call(container.querySelectorAll(".reveal"), (el) => revealObserver.observe(el));
      } else {
        Array.prototype.forEach.call(container.querySelectorAll(".reveal"), (el) => el.classList.add("visible"));
      }

      panel.scrollTop = 0;
      requestAnimationFrame(updateLineProgress);
    }

    // Scroll-Fortschritt gebündelt pro Frame auswerten (kein Layout-Thrashing).
    let scrollQueued = false;
    panel.addEventListener("scroll", () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        updateLineProgress();
      });
    });

    // Kleine Fortschrittsangabe im Kopf ("MCU: 12 / 37 gesehen"); gezählt
    // werden nur bereits erschienene Filme der Kinostart-Liste.
    const mcuWatchIds = [];
    if (Watch.P) {
      MCU_TIMELINE.forEach((group) => {
        group.films.forEach((f) => {
          const id = Watch.P.idFor(f.title, f.year, "movie");
          if (id && mcuWatchIds.indexOf(id) === -1) mcuWatchIds.push(id);
        });
      });
    }
    let travelProgressEl = null;

    function updateTravelProgress() {
      if (!Watch.P || !mcuWatchIds.length) return;
      if (!travelProgressEl) {
        travelProgressEl = document.createElement("div");
        travelProgressEl.className = "watch-travel-progress";
        travelProgressEl.setAttribute("role", "status");
        travelProgressEl.innerHTML = `
          <span class="wtp-label">MCU</span>
          <span class="wtp-value"></span>
          <span class="wtp-bar" aria-hidden="true"><i></i></span>`;
        document.getElementById("travel-toggle").appendChild(travelProgressEl);
      }
      const released = mcuWatchIds.filter((id) => Watch.P.isReleased(id));
      const watched = released.filter((id) => Watch.P.isWatched(id)).length;
      const pct = Watch.P.percent(watched, released.length);
      travelProgressEl.hidden = !Watch.signedIn();
      travelProgressEl.classList.toggle("is-complete", released.length > 0 && watched >= released.length);
      travelProgressEl.querySelector(".wtp-value").innerHTML = `<strong>${watched}</strong> / ${released.length} gesehen`;
      travelProgressEl.querySelector(".wtp-bar i").style.width = pct + "%";
      travelProgressEl.title = `${pct} % der erschienenen MCU-Filme gesehen`;
    }

    render("story");
    updateTravelProgress();
    if (Watch.P) {
      Watch.P.subscribe((ev) => {
        if (Watch.isRelevant(ev)) updateTravelProgress();
      });
    }

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
      openOverlay(overlay);
      requestAnimationFrame(updateLineProgress);
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => closeOverlay(overlay));
  }
  initTravel();

  // ---------- Entdecken (Film-/Serien-/Charakter-Bibliothek) ----------
  // Baut auf denselben Funktionen wie Marvel Travel & die Suche auf:
  // openFilmModal für den Filmklick, loadPosterInto/TMDB.seriesPoster für
  // Poster, SEARCH_INDEX/openCharacterModal für Charaktere. Keine zweite
  // TMDB-Anbindung, keine neue Filmdatenbank — nur MarvelDerive.allFilms().
  function initDiscover() {
    const btn = document.getElementById("discover-btn");
    const overlay = document.getElementById("discover-overlay");
    const closeBtn = document.getElementById("discover-close");
    const tabButtons = Array.prototype.slice.call(document.querySelectorAll("#discover-tabs button"));
    const views = {
      movies: document.getElementById("discover-view-movies"),
      series: document.getElementById("discover-view-series"),
      characters: document.getElementById("discover-view-characters"),
    };

    // Kurze Anzeigenamen für die Universum-Filter-Chips (nur Beschriftung —
    // welche Universen überhaupt als Chip erscheinen, ergibt sich unten rein
    // aus den tatsächlich vorhandenen Filmen).
    const UNIVERSE_LABELS = {
      mcu: "MCU",
      xmen: "X-Men",
      tobey: "Raimi",
      garfield: "Amazing Spider-Man",
      fantasticfour: "Fantastic Four",
    };
    const UNIVERSE_ORDER = ["mcu", "xmen", "tobey", "garfield", "fantasticfour"];

    function labelFor(f) {
      return UNIVERSE_LABELS[f.universeId] || f.universeName;
    }

    const films = MarvelDerive.allFilms();

    const universeIds = [];
    films.forEach((f) => {
      if (universeIds.indexOf(f.universeId) === -1) universeIds.push(f.universeId);
    });
    universeIds.sort((a, b) => {
      const ia = UNIVERSE_ORDER.indexOf(a);
      const ib = UNIVERSE_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const phases = [];
    films.forEach((f) => {
      if (f.universeId === "mcu" && f.phase && phases.indexOf(f.phase) === -1) phases.push(f.phase);
    });

    // ---------- Filme-Tab ----------
    const movieState = { query: "", universe: "all", phase: "all", sort: "year-asc", status: "all" };
    let moviesBuilt = false;
    const movieCards = new Map(); // key -> Karten-Element (wird nie neu erzeugt, nur verschoben/versteckt)
    // key -> Katalog-ID im gemeinsamen Fortschritt (gesehen / Watchlist / Bewertung)
    const filmWatchIds = new Map();
    films.forEach((f) => filmWatchIds.set(f.key, Watch.P ? Watch.P.idFor(f.title, f.year, "movie") : null));

    function buildMovieGrid() {
      if (moviesBuilt) return;
      moviesBuilt = true;
      const grid = document.getElementById("discover-grid");
      films.forEach((f) => {
        const tag =
          f.universeId === "mcu"
            ? f.phase
              ? `<span class="film-universe-tag">${f.phase}</span>`
              : ""
            : `<span class="film-universe-tag">${labelFor(f)}</span>`;
        const watchId = filmWatchIds.get(f.key);
        const card = document.createElement("div");
        card.className = "film-card" + (watchId ? " watch-card" : "");
        if (watchId) card.setAttribute("data-watch-id", watchId);
        card.innerHTML = `
          <div class="film-poster"><span class="film-abbrev">${posterAbbrev(f.title)}</span></div>
          ${watchId ? Watch.posterBadgesHTML() : ""}
          <div class="film-meta">
            <span class="film-title">${f.title}</span>
            <span class="film-year">${f.year}</span>
            ${tag}
          </div>
          ${watchId ? Watch.cardActionsHTML() : ""}`;
        card.addEventListener("click", () => openFilmModal(f.title, f.year));
        if (watchId) {
          Watch.bind(card.querySelector(".watch-actions"));
          Watch.apply(card);
        }
        grid.appendChild(card);
        // Reuse dieselbe Poster-/Cache-Logik wie Marvel Travel & Filmgrids.
        loadPosterInto(card.querySelector(".film-poster"), f.title, f.year);
        movieCards.set(f.key, card);
      });
    }

    function buildUniverseFilters() {
      const row = document.getElementById("discover-filter-universe");
      const items = [{ id: "all", label: "Alle" }].concat(universeIds.map((id) => ({ id, label: UNIVERSE_LABELS[id] || id })));
      row.innerHTML = "";
      items.forEach((item) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "discover-chip" + (movieState.universe === item.id ? " active" : "");
        chip.textContent = item.label;
        chip.addEventListener("click", () => {
          movieState.universe = item.id;
          if (item.id !== "mcu" && item.id !== "all") movieState.phase = "all";
          renderMovieFilters();
          renderMovies();
          Sound.playClick();
        });
        row.appendChild(chip);
      });
    }

    function buildPhaseFilters() {
      const row = document.getElementById("discover-filter-phase");
      const items = [{ id: "all", label: "Alle" }].concat(phases.map((p) => ({ id: p, label: p })));
      row.innerHTML = "";
      items.forEach((item) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "discover-chip" + (movieState.phase === item.id ? " active" : "");
        chip.textContent = item.label;
        chip.addEventListener("click", () => {
          movieState.phase = item.id;
          buildPhaseFilters();
          renderMovies();
          Sound.playClick();
        });
        row.appendChild(chip);
      });
    }

    function renderMovieFilters() {
      buildUniverseFilters();
      const phaseRow = document.getElementById("discover-filter-phase");
      const showPhases = phases.length > 0 && (movieState.universe === "all" || movieState.universe === "mcu");
      phaseRow.classList.toggle("hidden", !showPhases);
      if (showPhases) buildPhaseFilters();
    }

    function sortFilms(list) {
      const arr = list.slice();
      if (movieState.sort === "year-desc") arr.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title, "de"));
      else if (movieState.sort === "title-asc") arr.sort((a, b) => a.title.localeCompare(b.title, "de"));
      else arr.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title, "de"));
      return arr;
    }

    // status: optional abweichender Status-Filter (für die Anzahl an den Chips)
    function filterFilms(status) {
      const q = movieState.query.trim().toLowerCase();
      const st = status || movieState.status;
      return films.filter((f) => {
        if (movieState.universe !== "all" && f.universeId !== movieState.universe) return false;
        if (movieState.phase !== "all" && f.phase !== movieState.phase) return false;
        if (q && f.title.toLowerCase().indexOf(q) === -1) return false;
        if (!Watch.matchesStatus(filmWatchIds.get(f.key), st)) return false;
        return true;
      });
    }

    // Bei einer Live-Aktualisierung verschwindet eine Karte, die gerade bedient
    // wird (Zeiger oder Fokus darauf), nicht unter dem Klick — sonst rückt die
    // nächste Karte nach und ein Doppelklick träfe sie. Sie bleibt abgedimmt
    // stehen, bis Zeiger und Fokus sie verlassen haben.
    // Nur Tastatur-Fokus zählt: nach einem Mausklick behält der Knopf zwar den
    // Fokus, die Karte soll aber verschwinden, sobald der Zeiger sie verlässt.
    function keyboardFocusIn(card) {
      try {
        return Boolean(card.querySelector(":focus-visible"));
      } catch (e) {
        return card.contains(document.activeElement);
      }
    }

    function setCardVisible(card, show, live, rerender) {
      if (show || !live || card.classList.contains("hidden")) {
        card.classList.remove("is-leaving");
        card.classList.toggle("hidden", !show);
        return;
      }
      const engaged = () => card.matches(":hover") || keyboardFocusIn(card);
      if (!engaged()) {
        card.classList.remove("is-leaving");
        card.classList.add("hidden");
        return;
      }
      if (card.classList.contains("is-leaving")) return;
      card.classList.add("is-leaving");
      const settle = () => {
        if (!card.classList.contains("is-leaving")) return cleanup();
        if (keyboardFocusIn(card)) return;
        cleanup();
        rerender();
      };
      // focusout feuert, bevor der Fokus weitergewandert ist
      const onFocusOut = () => setTimeout(settle, 0);
      function cleanup() {
        card.removeEventListener("pointerleave", settle);
        card.removeEventListener("focusout", onFocusOut);
      }
      card.addEventListener("pointerleave", settle);
      card.addEventListener("focusout", onFocusOut);
    }

    // Status-Zeile: die Anzahl je Chip bezieht sich auf die übrigen aktiven
    // Filter (Universum, Phase, Suche) — also genau das, was ein Klick zeigt.
    function renderMovieStatusFilters() {
      const base = filterFilms("all");
      Watch.renderStatusChips(
        document.getElementById("discover-filter-status"),
        movieState.status,
        Watch.statusCounts(base.map((f) => filmWatchIds.get(f.key))),
        (status) => {
          movieState.status = status;
          renderMovies();
          Sound.playClick();
        }
      );
    }

    // Sortiert/filtert nur die einmalig gebauten Karten neu (verschiebt
    // bestehende DOM-Knoten statt sie neu zu erzeugen) — Poster werden dabei
    // nie erneut nachgeladen oder erneut bei TMDB gesucht. keepOrder: nur
    // Sichtbarkeit abgleichen (Live-Aktualisierung; der Fokus bleibt erhalten).
    function renderMovies(keepOrder) {
      buildMovieGrid();
      const grid = document.getElementById("discover-grid");
      const empty = document.getElementById("discover-empty");
      const count = document.getElementById("discover-count");
      const list = sortFilms(filterFilms());
      const visible = new Set(list.map((f) => f.key));
      if (keepOrder !== true) {
        list.forEach((f) => {
          const card = movieCards.get(f.key);
          if (card) grid.appendChild(card);
        });
      }
      movieCards.forEach((card, key) => setCardVisible(card, visible.has(key), keepOrder === true, () => renderMovies(true)));
      empty.classList.toggle("hidden", list.length > 0);
      count.textContent = `${list.length} Film${list.length === 1 ? "" : "e"}`;
      renderMovieStatusFilters();
    }

    document.getElementById("discover-search").addEventListener("input", (e) => {
      movieState.query = e.target.value;
      renderMovies();
    });
    document.getElementById("discover-sort").addEventListener("change", (e) => {
      movieState.sort = e.target.value;
      renderMovies();
    });
    document.getElementById("discover-reset").addEventListener("click", () => {
      movieState.query = "";
      movieState.universe = "all";
      movieState.phase = "all";
      movieState.sort = "year-asc";
      movieState.status = "all";
      document.getElementById("discover-search").value = "";
      document.getElementById("discover-sort").value = "year-asc";
      renderMovieFilters();
      renderMovies();
      Sound.playClick();
    });

    renderMovieFilters();

    // ---------- Serien-Tab (bestehende TMDB.seriesPoster-Anbindung aus der Suche) ----------
    let seriesBuilt = false;
    const seriesState = { status: "all" };
    const seriesList = typeof SERIES !== "undefined" ? SERIES : [];
    const seriesWatchIds = seriesList.map((sr) => (Watch.P ? Watch.P.idFor(sr.title, sr.year, "series") : null));
    const seriesCards = [];

    function buildSeriesGrid() {
      if (seriesBuilt) return;
      seriesBuilt = true;
      const grid = document.getElementById("discover-series-grid");
      seriesList.forEach((sr, idx) => {
        const watchId = seriesWatchIds[idx];
        const card = document.createElement("div");
        card.className = "film-card" + (watchId ? " watch-card" : "");
        if (watchId) card.setAttribute("data-watch-id", watchId);
        card.innerHTML = `
          <div class="film-poster"><span class="film-abbrev">${posterAbbrev(sr.title)}</span></div>
          ${watchId ? Watch.posterBadgesHTML() : ""}
          <div class="film-meta">
            <span class="film-title">${sr.title}</span>
            <span class="film-year">${sr.year}${sr.phase ? " · " + sr.phase : ""}</span>
          </div>
          ${watchId ? Watch.cardActionsHTML() : ""}`;
        card.addEventListener("click", () => showToast(`📺 ${sr.title} (${sr.year}) — ${sr.desc}`, 5200));
        if (watchId) {
          Watch.bind(card.querySelector(".watch-actions"));
          Watch.apply(card);
        }
        seriesCards.push(card);
        grid.appendChild(card);
        if (window.TMDB && TMDB.enabled()) {
          const posterEl = card.querySelector(".film-poster");
          TMDB.seriesPoster(sr.title, sr.year)
            .then((url) => (url ? preload(url) : null))
            .then((url) => {
              if (url && posterEl.isConnected) {
                posterEl.innerHTML = `<img src="${escapeAttr(url)}" alt="${escapeAttr(sr.title)}" loading="lazy">`;
              }
            })
            .catch(() => {});
        }
      });
    }

    // Status-Filter und eigene kleine Anzahl für die Serien (gleiche Karten,
    // nur ein-/ausgeblendet). live: Aufruf durch eine Fortschrittsänderung.
    function renderSeries(live) {
      buildSeriesGrid();
      const row = document.getElementById("discover-series-filter-status");
      Watch.renderStatusChips(row, seriesState.status, Watch.statusCounts(seriesWatchIds), (status) => {
        seriesState.status = status;
        renderSeries();
        Sound.playClick();
      });
      let visible = 0;
      seriesCards.forEach((card, idx) => {
        const show = Watch.matchesStatus(seriesWatchIds[idx], seriesState.status);
        setCardVisible(card, show, live === true, () => renderSeries(true));
        if (show) visible++;
      });
      let countEl = row.querySelector(".watch-filter-count");
      if (!countEl) {
        countEl = document.createElement("span");
        countEl.className = "watch-filter-count";
        countEl.id = "discover-series-count";
        row.appendChild(countEl);
      }
      countEl.textContent = `${visible} Serie${visible === 1 ? "" : "n"}`;
      let empty = document.getElementById("discover-series-empty");
      if (!empty) {
        empty = document.createElement("p");
        empty.id = "discover-series-empty";
        empty.className = "travel-sub";
        empty.textContent = "Keine Serien gefunden.";
        document.getElementById("discover-series-grid").after(empty);
      }
      empty.classList.toggle("hidden", visible > 0);
    }

    // Live-Aktualisierung: Zustände der Karten gleicht Watch.sync ab; hier
    // nur Sichtbarkeit (aktiver Status-Filter) und Anzahlen.
    if (Watch.P) {
      Watch.P.subscribe((ev) => {
        if (!Watch.isRelevant(ev)) return;
        // Ein neues Profil startet ohne den Status-Filter des vorherigen.
        if (ev.type === "profile") {
          movieState.status = "all";
          seriesState.status = "all";
        }
        if (moviesBuilt) renderMovies(ev.type !== "profile");
        if (seriesBuilt) renderSeries(ev.type !== "profile");
      });
    }

    // ---------- Charaktere-Tab (bestehender SEARCH_INDEX + openCharacterModal) ----------
    let charsBuilt = false;
    function buildCharactersGrid() {
      if (charsBuilt) return;
      charsBuilt = true;
      const grid = document.getElementById("discover-characters-grid");
      SEARCH_INDEX.filter((m) => m.type === "character").forEach((entry) => {
        const c = entry.character;
        const u = entry.universe;
        const card = document.createElement("button");
        card.type = "button";
        card.className = "discover-character-card";
        card.style.setProperty("--accent-color", u.accent);
        card.innerHTML = `
          <span class="discover-character-avatar">${characterFigureSVG(u.accent, getInitials(c.name))}</span>
          <span class="discover-character-name">${c.name.split(" / ")[0]}</span>
          <span class="discover-character-sub">${u.name}</span>`;
        card.addEventListener("click", () => {
          closeOverlay(overlay);
          selectUniverse(u.id);
          setTimeout(() => openCharacterModal(c, u), 300);
        });
        grid.appendChild(card);
        loadPersonInto(card.querySelector(".discover-character-avatar"), c);
      });
    }

    document.getElementById("discover-char-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      const grid = document.getElementById("discover-characters-grid");
      Array.prototype.forEach.call(grid.children, (card) => {
        const name = card.querySelector(".discover-character-name").textContent.toLowerCase();
        card.classList.toggle("hidden", Boolean(q) && name.indexOf(q) === -1);
      });
    });

    // ---------- Tabs ----------
    function activateTab(tab) {
      tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
      Object.keys(views).forEach((key) => views[key].classList.toggle("hidden", key !== tab));
      if (tab === "movies") renderMovies();
      else if (tab === "series") renderSeries();
      else if (tab === "characters") buildCharactersGrid();
    }

    tabButtons.forEach((b) => {
      b.addEventListener("click", () => {
        activateTab(b.dataset.tab);
        Sound.playClick();
      });
    });

    btn.addEventListener("click", () => {
      openOverlay(overlay);
      renderMovies();
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => closeOverlay(overlay));
  }
  initDiscover();

  // ---------- J.A.R.V.I.S. (Befehls-Assistent) ----------
  // Die Befehle werden lokal ausgewertet. Die Struktur ist bewusst als Liste von
  // Mustern + Aktionen aufgebaut: eine echte KI-Schnittstelle kann später einfach
  // eingehängt werden, indem sie denselben Aktionen einen Treffer zurückgibt
  // (siehe JARVIS.runCommand weiter unten).
  const JARVIS = (function () {
    const log = () => document.getElementById("jarvis-log");

    function say(text, who) {
      const entry = document.createElement("div");
      entry.className = "jarvis-msg " + (who || "jarvis");
      entry.innerHTML = text;
      log().appendChild(entry);
      log().scrollTop = log().scrollHeight;
    }

    function findUniverse(query) {
      const q = query.toLowerCase();
      return (
        UNIVERSES.find((u) => u.name.toLowerCase().indexOf(q) !== -1) ||
        UNIVERSES.find((u) => u.id.toLowerCase().indexOf(q) !== -1) ||
        UNIVERSES.find((u) => u.eyebrow.toLowerCase().indexOf(q) !== -1)
      );
    }

    function findCharacters(query) {
      const q = query.toLowerCase();
      const hits = [];
      UNIVERSES.forEach((u) => {
        u.characters.forEach((c) => {
          if (c.name.toLowerCase().indexOf(q) !== -1) hits.push({ character: c, universe: u });
        });
      });
      return hits;
    }

    // Jede Regel: Muster + Aktion. Rückgabe = Antworttext.
    const COMMANDS = [
      {
        name: "variants",
        test: /(varianten|versionen)/i,
        run: (m, input) => {
          // Beide Satzstellungen abdecken: "Varianten von X" und "alle X Varianten"
          const after = input.match(/(?:varianten|versionen)\s+(?:von\s+)?(.+)/i);
          const before = input.match(/(?:alle\s+)?([^,.!?]+?)\s+(?:varianten|versionen)/i);
          let query = (after && after[1]) || (before && before[1]) || "";

          // Füllwörter am Anfang entfernen ("zeige mir alle ...")
          let prev;
          do {
            prev = query;
            query = query.replace(/^(?:zeig(?:e)?|mir|alle|die|der|das|den|von|bitte)\s+/i, "");
          } while (query !== prev);
          query = query.trim().replace(/[?.!]+$/, "");

          if (!query) return "Zu welcher Figur möchtest du die Varianten sehen?";
          const hits = findCharacters(query);
          if (!hits.length) return `Keine Figur gefunden, die zu „${query}“ passt.`;

          const base = MarvelDerive.baseName(hits[0].character.name);
          const variants = hits.filter((h) => MarvelDerive.baseName(h.character.name) === base);
          openCharacterModal(variants[0].character, variants[0].universe);
          setTimeout(() => {
            const section = document.getElementById("section-variants");
            if (section) section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
          }, 400);
          return `${variants.length} Fassung${variants.length === 1 ? "" : "en"} von <strong>${
            variants[0].character.name
          }</strong> gefunden — Profil mit Varianten geöffnet.`;
        },
      },
      {
        name: "openUniverse",
        test: /(öffne|zeige|zeig mir|geh(e)? zu)\s+(das\s+)?(.+?)(-universum|universum|planet)?$/i,
        run: (m) => {
          const query = m[4].trim().replace(/[?.!]+$/, "");
          const universe = findUniverse(query);
          if (universe) {
            closeJarvisSoft();
            selectUniverse(universe.id);
            return `Kurs auf <strong>${universe.name}</strong> gesetzt.`;
          }
          const hits = findCharacters(query);
          if (hits.length) {
            openCharacterModal(hits[0].character, hits[0].universe);
            return `Profil von <strong>${hits[0].character.name}</strong> geöffnet.`;
          }
          return `Ich finde weder ein Universum noch eine Figur namens „${query}“.`;
        },
      },
      {
        name: "compare",
        test: /vergleiche?\s+(.+?)\s+(?:und|mit|gegen|vs\.?)\s+(.+)/i,
        run: (m) => {
          const a = findCharacters(m[1].trim());
          const b = findCharacters(m[2].trim().replace(/[?.!]+$/, ""));
          if (!a.length || !b.length) return "Mindestens eine der beiden Figuren kenne ich nicht.";
          openCompareWith(a[0], b[0]);
          return `Duell-Analyse: <strong>${a[0].character.name}</strong> gegen <strong>${b[0].character.name}</strong>.`;
        },
      },
      {
        name: "after",
        test: /(nach|ab)\s+(.+?)\??$/i,
        run: (m) => {
          const query = m[2].trim().toLowerCase();
          const all = [];
          MCU_CHRONO_TIMELINE.forEach((era) => era.films.forEach((f) => all.push(f)));
          const idx = all.findIndex((f) => f.title.toLowerCase().indexOf(query) !== -1);
          if (idx === -1) return `Den Film „${m[2].trim()}“ finde ich nicht in der Zeitleiste.`;
          const next = all.slice(idx + 1, idx + 5);
          if (!next.length) return `<strong>${all[idx].title}</strong> ist der letzte Eintrag der Zeitleiste.`;
          return (
            `Nach <strong>${all[idx].title}</strong> folgt:<br>` +
            next.map((f) => `• ${f.title} (${f.year})`).join("<br>")
          );
        },
      },
      {
        name: "timeline",
        test: /(timeline|zeitleiste|marvel travel|chronologie)/i,
        run: () => {
          closeJarvisSoft();
          document.getElementById("travel-btn").click();
          return "Zeitleiste geöffnet.";
        },
      },
      {
        name: "map",
        test: /(multiverse map|karte|verbindungen)/i,
        run: () => {
          closeJarvisSoft();
          document.getElementById("map-btn").click();
          return "Multiverse Map geöffnet.";
        },
      },
      {
        name: "favorites",
        test: /(favoriten|lieblings)/i,
        run: () => {
          closeJarvisSoft();
          document.getElementById("favorites-btn").click();
          return "Deine Favoriten.";
        },
      },
      {
        name: "theories",
        test: /(theorie|theorien)/i,
        run: () => {
          closeJarvisSoft();
          document.getElementById("theories-btn").click();
          return "Theorien-Board geöffnet.";
        },
      },
      {
        name: "countdown",
        test: /(countdown|doomsday|wann kommt)/i,
        run: () => {
          closeJarvisSoft();
          selectUniverse("doomsday");
          return "Avengers: Doomsday — Countdown läuft.";
        },
      },
      {
        name: "help",
        test: /(hilfe|help|was kannst du|befehle)/i,
        run: () =>
          'Ich kann unter anderem:<br>' +
          '• „Zeige mir alle Spider-Man Varianten.“<br>' +
          '• „Öffne das Raimi-Universum.“<br>' +
          '• „Welche Filme kommen nach Endgame?“<br>' +
          '• „Vergleiche Thor und Hulk.“<br>' +
          '• „Öffne die Zeitleiste“ / „Multiverse Map“ / „Favoriten“',
      },
    ];

    // Einstiegspunkt: hier könnte später eine KI-API andocken, die denselben
    // Befehlsnamen samt Parametern zurückgibt.
    function runCommand(text) {
      const input = String(text || "").trim();
      if (!input) return null;
      for (let i = 0; i < COMMANDS.length; i++) {
        const match = input.match(COMMANDS[i].test);
        if (match) {
          try {
            return COMMANDS[i].run(match, input);
          } catch (e) {
            return "Dabei ist etwas schiefgelaufen.";
          }
        }
      }
      return null;
    }

    return { say, runCommand, commands: COMMANDS };
  })();

  function closeJarvis() {
    closeOverlay(document.getElementById("jarvis-panel"));
    document.getElementById("jarvis-panel").classList.add("hidden");
    document.getElementById("jarvis-btn").classList.remove("active");
  }

  // Schließt das Fenster, ohne die Render-Pause zu beeinflussen (JARVIS ist klein
  // und verdeckt die Szene nicht).
  function closeJarvisSoft() {
    document.getElementById("jarvis-panel").classList.add("hidden");
    document.getElementById("jarvis-btn").classList.remove("active");
  }

  function initJarvis() {
    const btn = document.getElementById("jarvis-btn");
    const panelEl = document.getElementById("jarvis-panel");
    const closeBtn = document.getElementById("jarvis-close");
    const form = document.getElementById("jarvis-form");
    const input = document.getElementById("jarvis-input");
    let greeted = false;

    btn.addEventListener("click", () => {
      const nowOpen = panelEl.classList.contains("hidden");
      panelEl.classList.toggle("hidden", !nowOpen);
      btn.classList.toggle("active", nowOpen);
      Sound.playClick();
      if (nowOpen) {
        if (!greeted) {
          greeted = true;
          JARVIS.say(
            "Systeme online. Frag mich nach Varianten, Universen, Filmen oder einem Duell — z.B. <em>„Vergleiche Thor und Hulk“</em>."
          );
        }
        input.focus();
      }
    });

    closeBtn.addEventListener("click", closeJarvis);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      JARVIS.say(text, "user");
      input.value = "";
      const answer = JARVIS.runCommand(text);
      setTimeout(() => {
        JARVIS.say(
          answer ||
            "Diesen Befehl kenne ich noch nicht. Tippe <em>Hilfe</em> für eine Übersicht — später kann hier eine KI andocken."
        );
      }, 220);
    });
  }
  initJarvis();

  // ---------- Easter Eggs ----------
  function showSecret(icon, title, text) {
    document.getElementById("secret-icon").textContent = icon;
    document.getElementById("secret-title").textContent = title;
    document.getElementById("secret-text").textContent = text;
    openOverlay(document.getElementById("secret-overlay"));
    Sound.playPower();
  }

  document.getElementById("secret-close").addEventListener("click", () => {
    closeOverlay(document.getElementById("secret-overlay"));
  });

  // 1) Tastenfolge "TVA" schaltet den TVA-Modus um (Sepia-HUD der Zeitbehörde).
  const TVA_SEQUENCE = ["t", "v", "a"];
  let tvaProgress = 0;
  window.addEventListener("keydown", (e) => {
    const target = e.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const key = (e.key || "").toLowerCase();
    if (key === TVA_SEQUENCE[tvaProgress]) {
      tvaProgress++;
      if (tvaProgress === TVA_SEQUENCE.length) {
        tvaProgress = 0;
        const active = document.body.classList.toggle("tva-mode");
        if (active) {
          showSecret(
            "⧗",
            "TVA-Modus aktiviert",
            "Alle Zeitlinien werden überwacht. Abweichungen wurden protokolliert. Drücke erneut T-V-A, um zur heiligen Zeitlinie zurückzukehren."
          );
        } else {
          showToast("⧗ Zeitlinie zurückgesetzt.");
        }
      }
    } else {
      tvaProgress = key === TVA_SEQUENCE[0] ? 1 : 0;
    }
  });

  // 2) Mehrfaches Anklicken eines Infinity-Steins löst eine Spezialanimation aus.
  const stoneClickCounts = {};
  function registerStoneClick(stoneId, stoneName) {
    stoneClickCounts[stoneId] = (stoneClickCounts[stoneId] || 0) + 1;
    if (stoneClickCounts[stoneId] === 5) {
      stoneClickCounts[stoneId] = 0;
      document.body.classList.add("stone-surge");
      Sound.playPower();
      setTimeout(() => document.body.classList.remove("stone-surge"), 2400);
      showToast(`💥 Der ${stoneName} reagiert auf deine Berührung…`, 4200);
    }
  }

  // 3) Bestimmte Suchbegriffe schalten versteckte Multiversums-Nachrichten frei.
  const SECRET_SEARCHES = [
    {
      test: /^(he who remains|der bleibt|kang)$/,
      icon: "⌛",
      title: "Am Ende der Zeit",
      text: "Jemand sitzt seit jeher in der Zitadelle und schreibt jede Zeitlinie mit. Du warst hier schon einmal. Und wirst es wieder sein.",
    },
    {
      test: /^(excelsior|stan lee)$/,
      icon: "✶",
      title: "Excelsior!",
      text: "Immer weiter nach oben. Danke, dass du dieses Multiversum erkundest, True Believer.",
    },
    {
      test: /^(i am iron man|ich bin iron man)$/,
      icon: "◉",
      title: "Arc-Reaktor online",
      text: "Manche Sätze verändern ein ganzes Universum. Dieser hat es zweimal getan.",
    },
    {
      test: /^(42|sokovia|ultron)$/,
      icon: "⚙",
      title: "Protokoll gefunden",
      text: "In einer verworfenen Zeitlinie wurde dieses Protokoll nie gestartet. In dieser hier schon.",
    },
  ];

  let lastSecretSearch = "";
  function checkSecretSearch(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q || q === lastSecretSearch) return;
    const hit = SECRET_SEARCHES.find((s) => s.test.test(q));
    if (!hit) return;
    lastSecretSearch = q;
    showSecret(hit.icon, hit.title, hit.text);
  }

  // ---------- Multiverse Map (Verbindungen zwischen den Universen) ----------
  function initMultiverseMap() {
    const btn = document.getElementById("map-btn");
    const overlay = document.getElementById("map-overlay");
    const closeBtn = document.getElementById("map-close");
    const canvas = document.getElementById("map-canvas");
    const detail = document.getElementById("map-detail");

    function render() {
      const W = 720;
      const H = 440;
      const cx = W / 2;
      const cy = H / 2;
      const links = MarvelDerive.universeConnections();

      // Universen kreisförmig anordnen; große Universen weiter innen.
      const nodes = UNIVERSES.map((u, i) => {
        const angle = -Math.PI / 2 + (i / UNIVERSES.length) * Math.PI * 2;
        const radius = u.isDoomsday ? 108 : 176;
        return {
          universe: u,
          x: cx + Math.cos(angle) * radius * 1.32,
          y: cy + Math.sin(angle) * radius * 0.82,
        };
      });

      const nodeById = {};
      nodes.forEach((n) => (nodeById[n.universe.id] = n));

      const lineEls = links
        .map((l) => {
          const a = nodeById[l.a.id];
          const b = nodeById[l.b.id];
          if (!a || !b) return "";
          const width = Math.min(3.4, 0.9 + l.shared * 0.5);
          return `<line class="map-link" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
                     stroke="${l.a.accent}" stroke-width="${width}"
                     data-a="${l.a.id}" data-b="${l.b.id}" data-shared="${l.shared}"/>`;
        })
        .join("");

      const nodeEls = nodes
        .map(
          (n) => `
        <g class="map-node" data-id="${n.universe.id}">
          <circle class="map-halo" cx="${n.x}" cy="${n.y}" r="26" fill="${n.universe.accent}" fill-opacity="0.12"/>
          <circle class="map-core" cx="${n.x}" cy="${n.y}" r="13" fill="${n.universe.accent}"
                  fill-opacity="0.35" stroke="${n.universe.accent}" stroke-width="2"/>
          <text class="map-label" x="${n.x}" y="${n.y + 34}">${n.universe.name}</text>
          <text class="map-earth" x="${n.x}" y="${n.y + 46}">${n.universe.earth || ""}</text>
        </g>`
        )
        .join("");

      canvas.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img"
             aria-label="Karte der Verbindungen zwischen den Universen">
          <g class="map-links">${lineEls}</g>
          ${nodeEls}
        </svg>`;

      // Hover hebt ein Universum samt seiner Verbindungen hervor.
      Array.prototype.forEach.call(canvas.querySelectorAll(".map-node"), (g) => {
        const id = g.dataset.id;
        const universe = UNIVERSES.find((u) => u.id === id);

        g.addEventListener("pointerenter", () => {
          canvas.querySelectorAll(".map-link").forEach((line) => {
            const active = line.dataset.a === id || line.dataset.b === id;
            line.classList.toggle("active", active);
          });
          const connected = links.filter((l) => l.a.id === id || l.b.id === id);
          detail.innerHTML = `
            <strong style="color:${universe.accent}">${universe.name}</strong>
            <span>${universe.earth || ""} · ${universe.characters.length} Figuren</span>
            <span>${
              connected.length
                ? "Verbunden mit: " +
                  connected
                    .map((l) => (l.a.id === id ? l.b.name : l.a.name))
                    .join(", ")
                : "Keine geteilten Figuren mit anderen Universen"
            }</span>`;
        });

        g.addEventListener("pointerleave", () => {
          canvas.querySelectorAll(".map-link").forEach((line) => line.classList.remove("active"));
        });

        // Klick fliegt direkt zum passenden Planeten.
        g.addEventListener("click", () => {
          closeOverlay(overlay);
          selectUniverse(id);
        });
      });

      detail.innerHTML = `<span>Fahre über ein Universum, um seine Verbindungen zu sehen.</span>`;
    }

    btn.addEventListener("click", () => {
      render();
      openOverlay(overlay);
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => closeOverlay(overlay));
  }
  initMultiverseMap();

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
      openOverlay(overlay);
      render();
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => closeOverlay(overlay));
  }
  initTheories();

  // ---------- Suche (Charaktere, Filme, Universen, Serien) ----------
  function initSearch() {
    const wrap = document.getElementById("search-wrap");
    const input = document.getElementById("search-input");
    const results = document.getElementById("search-results");

    const CATEGORIES = [
      { key: "character", label: "Charaktere", limit: 5 },
      { key: "movie", label: "Filme", limit: 4 },
      { key: "universe", label: "Universen", limit: 3 },
      { key: "series", label: "Serien", limit: 3 },
    ];

    // Universen und Serien ergänzen den bestehenden Index aus Figuren und Filmen.
    const FULL_INDEX = SEARCH_INDEX.concat(
      UNIVERSES.map((u) => ({
        type: "universe",
        label: u.name,
        sub: `${u.earth || "Eigene Zeitlinie"} · ${u.characters.length} Figuren`,
        universe: u,
      })),
      (typeof SERIES !== "undefined" ? SERIES : []).map((sr) => ({
        type: "series",
        label: sr.title,
        sub: `${sr.year} · ${sr.phase || "Serie"}`,
        series: sr,
      }))
    );

    // Doppelte Filmtitel (mehrere Universen) nur einmal anzeigen.
    function dedupeMovies(list) {
      const seen = {};
      return list.filter((m) => {
        if (m.type !== "movie") return true;
        if (seen[m.label]) return false;
        seen[m.label] = true;
        return true;
      });
    }

    function thumbHTML(m) {
      if (m.type === "character") {
        return `<span class="search-thumb round">${characterFigureSVG(m.universe.accent, getInitials(m.character.name))}</span>`;
      }
      if (m.type === "movie" || m.type === "series") {
        return `<span class="search-thumb poster">${posterAbbrev(m.label)}</span>`;
      }
      return `<span class="search-thumb universe" style="--u-a:${m.universe.colorA};--u-b:${m.universe.colorB}"></span>`;
    }

    // Lädt das passende Bild zum Treffer nach (Porträt, Poster oder Backdrop).
    function loadThumb(el, m) {
      const thumb = el.querySelector(".search-thumb");
      if (!thumb) return;
      if (m.type === "character") {
        loadPersonInto(thumb, m.character);
      } else if (m.type === "movie") {
        loadPosterInto(thumb, m.label, m.year);
      } else if (m.type === "series" && window.TMDB && TMDB.enabled()) {
        TMDB.seriesPoster(m.label, m.series.year)
          .then((url) => (url ? preload(url) : null))
          .then((url) => {
            if (url && thumb.isConnected) thumb.innerHTML = `<img src="${escapeAttr(url)}" alt="" loading="lazy">`;
          })
          .catch(() => {});
      } else if (m.type === "universe") {
        const meta = MarvelDerive.universeMeta(m.universe);
        if (meta.mainFilm) loadPosterInto(thumb, meta.mainFilm.title, meta.mainFilm.year);
      }
    }

    function activate(m) {
      input.value = "";
      results.classList.add("hidden");
      if (m.type === "character") {
        selectUniverse(m.universe.id);
        setTimeout(() => openCharacterModal(m.character, m.universe), 300);
      } else if (m.type === "movie") {
        openFilmModal(m.label, m.year);
      } else if (m.type === "universe") {
        selectUniverse(m.universe.id);
      } else if (m.type === "series") {
        showToast(`📺 ${m.label} (${m.series.year}) — ${m.series.desc}`, 5200);
      }
    }

    function renderResults(matches) {
      results.innerHTML = "";
      if (!matches.length) {
        results.innerHTML = `<div class="search-empty">Keine Treffer</div>`;
        results.classList.remove("hidden");
        return;
      }

      CATEGORIES.forEach((cat) => {
        const group = matches.filter((m) => m.type === cat.key).slice(0, cat.limit);
        if (!group.length) return;

        const heading = document.createElement("div");
        heading.className = "search-group";
        heading.textContent = cat.label;
        results.appendChild(heading);

        group.forEach((m) => {
          const item = document.createElement("div");
          item.className = "search-item";
          item.style.setProperty("--accent-color", m.universe ? m.universe.accent : "#5b8bff");
          item.innerHTML = `
            ${thumbHTML(m)}
            <div class="search-text">
              <span class="search-label">${m.label}</span>
              <span class="search-sub">${m.sub}</span>
            </div>`;
          loadThumb(item, m);
          item.addEventListener("click", () => activate(m));
          results.appendChild(item);
        });
      });

      results.classList.remove("hidden");
    }

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        results.classList.add("hidden");
        return;
      }
      checkSecretSearch(q);
      const hits = FULL_INDEX.filter(
        (m) => m.label.toLowerCase().indexOf(q) !== -1 || (m.sub || "").toLowerCase().indexOf(q) !== -1
      );
      renderResults(dedupeMovies(hits));
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
        closeOverlay(document.getElementById("favorites-overlay"));
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
      openOverlay(overlay);
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => closeOverlay(overlay));
  }
  initFavorites();

  // ---------- Charakter-Vergleich ----------
  let compareApi = null;

  function openCompareWith(entryA, entryB) {
    if (!compareApi) return;
    closeJarvisSoft();
    compareApi.set(entryA, entryB);
  }

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

      const battleA = MarvelDerive.battleScore(picked.a.character);
      const battleB = MarvelDerive.battleScore(picked.b.character);

      const card = (entry) => {
        const films = entry.character.films || [];
        const firstYear = films.length ? Math.min.apply(null, films.map((f) => f.year)) : "–";
        const powerChips = powerChipsHTML(entry.character.powers, entry.universe.accent);
        return `
          <div class="compare-card" style="--accent-color:${entry.universe.accent}">
            <div class="compare-avatar-wrap">
              <div class="compare-avatar" data-portrait="${entry === picked.a ? "a" : "b"}">${characterVisualHTML(entry.character, entry.universe, getInitials(entry.character.name))}</div>
            </div>
            <h3>${entry.character.name}</h3>
            <div class="compare-role">${entry.character.role}</div>
            <div class="compare-universe">${entry.universe.name}</div>
            <div class="compare-stat"><span>Filmauftritte</span><strong>${films.length}</strong></div>
            <div class="compare-stat"><span>Erstauftritt</span><strong>${firstYear}</strong></div>
            <div class="compare-powers">${powerChips}</div>
          </div>`;
      };

      // Gegenüberstellung der Werte: zwei Balken, die aus der Mitte wachsen.
      const duelRows = battleA.stats
        .map((statA, i) => {
          const statB = battleB.stats[i];
          const leadA = statA.value > statB.value;
          const leadB = statB.value > statA.value;
          return `
            <div class="duel-row">
              <span class="duel-value${leadA ? " lead" : ""}">${statA.value}</span>
              <span class="duel-track left">
                <span class="duel-fill" data-value="${statA.value}" style="--fill-color:${picked.a.universe.accent}"></span>
              </span>
              <span class="duel-label">${statA.label}</span>
              <span class="duel-track right">
                <span class="duel-fill" data-value="${statB.value}" style="--fill-color:${picked.b.universe.accent}"></span>
              </span>
              <span class="duel-value${leadB ? " lead" : ""}">${statB.value}</span>
            </div>`;
        })
        .join("");

      const winner =
        battleA.score === battleB.score
          ? null
          : battleA.score > battleB.score
          ? picked.a
          : picked.b;

      const verdict = winner
        ? `Nach dieser Rechnung hätte <strong style="color:${winner.universe.accent}">${winner.character.name}</strong> die besseren Karten.`
        : "Nach dieser Rechnung steht es exakt unentschieden.";

      resultEl.innerHTML = `
        ${card(picked.a)}<div class="compare-vs">VS</div>${card(picked.b)}
        <div class="duel-block">
          <h3 class="duel-heading">Wer würde gewinnen?</h3>
          <div class="duel-rows">${duelRows}</div>
          <div class="duel-total">
            <div class="duel-total-side" style="--accent-color:${picked.a.universe.accent}">
              <span class="duel-total-name">${picked.a.character.name}</span>
              <span class="duel-total-score${battleA.score >= battleB.score ? " lead" : ""}">${battleA.score}</span>
            </div>
            <span class="duel-total-label">GESAMTWERTUNG</span>
            <div class="duel-total-side" style="--accent-color:${picked.b.universe.accent}">
              <span class="duel-total-name">${picked.b.character.name}</span>
              <span class="duel-total-score${battleB.score >= battleA.score ? " lead" : ""}">${battleB.score}</span>
            </div>
          </div>
          <p class="duel-verdict">${verdict}</p>
          <p class="duel-disclaimer">
            Spielerische Einschätzung: Die Werte werden aus Kräften und Biografie dieser Seite
            berechnet und sind keine offiziellen Marvel-Angaben. Im Film entscheiden Drehbuch,
            Umgebung und Verbündete — nicht diese Tabelle.
          </p>
        </div>`;

      // Balken animiert aus der Mitte wachsen lassen
      requestAnimationFrame(() => {
        Array.prototype.forEach.call(resultEl.querySelectorAll(".duel-fill"), (el, i) => {
          el.style.transitionDelay = (i % 2 === 0 ? i * 35 : (i - 1) * 35) + "ms";
          el.style.width = el.dataset.value + "%";
        });
      });

      // Echte Porträts nachladen, sobald verfügbar
      const portraitA = resultEl.querySelector('[data-portrait="a"]');
      const portraitB = resultEl.querySelector('[data-portrait="b"]');
      if (portraitA) loadPersonInto(portraitA, picked.a.character);
      if (portraitB) loadPersonInto(portraitB, picked.b.character);
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

    // Erlaubt anderen Teilen der Seite (z.B. J.A.R.V.I.S.), den Vergleich direkt
    // mit zwei Figuren zu öffnen.
    compareApi = {
      set(entryA, entryB) {
        picked.a = entryA;
        picked.b = entryB;
        document.getElementById("compare-input-a").value = entryA.character.name;
        document.getElementById("compare-input-b").value = entryB.character.name;
        renderComparison();
        openOverlay(overlay);
      },
    };

    btn.addEventListener("click", () => {
      openOverlay(overlay);
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => closeOverlay(overlay));
  }
  initCompare();

  // ---------- Renderer / Scene / Camera ----------
  const SH = window.SCENE_SHADERS;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });

  // Qualitätsstufe: Touch-Geräte und schmale Bildschirme bekommen kleinere
  // Texturen, weniger Partikel und eine begrenzte Pixeldichte. Zum Testen lässt
  // sich die Stufe mit ?quality=high bzw. ?quality=low erzwingen.
  const qualityParam = new URLSearchParams(window.location.search).get("quality");
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const LOW_TIER = qualityParam ? qualityParam === "low" : coarsePointer || window.innerWidth < 900;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, LOW_TIER ? 1.5 : 2);
  const pixelRatioUniform = { value: pixelRatio };
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060c, 0.0035);

  // Im Hochformat wird das vertikale Sichtfeld weiter, damit die Szene auf
  // schmalen Displays nicht seitlich abgeschnitten wird.
  const BASE_FOV = 49;
  function fovForAspect(aspect) {
    return Math.max(BASE_FOV, (2 * Math.atan(0.36 / aspect) * 180) / Math.PI);
  }
  const initialAspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.PerspectiveCamera(fovForAspect(initialAspect), initialAspect, 0.1, 2400);
  // Leicht erhöhter, flacher Blick auf die Orbitalebene (wie in der Referenz);
  // der Blickpunkt liegt etwas unter dem Stern, damit er über der Bildmitte sitzt.
  const DEFAULT_CAM_POS = new THREE.Vector3(0, 8.5, 52);
  const DEFAULT_LOOK = new THREE.Vector3(0, -3.2, 0);
  camera.position.copy(DEFAULT_CAM_POS);
  camera.lookAt(DEFAULT_LOOK);

  let camTarget = DEFAULT_LOOK.clone();
  let camPosTarget = DEFAULT_CAM_POS.clone();
  let lookTarget = DEFAULT_LOOK.clone();

  // Weiche, cineastische Kamerafahrt: einmalige Tween-Bewegung mit Ease-In-Out.
  // Danach übernimmt OrbitControls wieder die freie Steuerung.
  let flight = null;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function startFlight(toPos, toLook, duration) {
    flight = {
      fromPos: camera.position.clone(),
      toPos: toPos.clone(),
      fromLook: camTarget.clone(),
      toLook: toLook.clone(),
      elapsed: 0,
      duration: duration || 1.5,
    };
  }

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

  // Greift der Nutzer während einer Kamerafahrt selbst ein, bricht die Fahrt ab.
  controls.addEventListener("start", () => {
    flight = null;
  });

  // ---------- Lights ----------
  // Die Planeten berechnen ihr Sonnenlicht selbst im Shader. Diese Lichter
  // beleuchten die übrigen Objekte (Doom-Figur, Infinity-Steine, Asteroiden).
  scene.add(new THREE.AmbientLight(0x2a3050, 0.55));
  const coreLight = new THREE.PointLight(0xffb37a, 9, 400, 1.6);
  coreLight.position.set(0, 0, 0);
  scene.add(coreLight);
  const fillLight = new THREE.DirectionalLight(0x6a7bff, 0.35);
  fillLight.position.set(-40, 30, 20);
  scene.add(fillLight);

  // ---------- GPU-Backen prozeduraler Texturen ----------
  // Aufwendiges Noise wird einmalig in Render-Targets gerechnet und danach nur
  // noch als Textur gelesen — die Planeten-Shader bleiben zur Laufzeit günstig.
  const bakeScene = new THREE.Scene();
  const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  bakeQuad.frustumCulled = false;
  bakeScene.add(bakeQuad);

  function bakeTexture(material, width, height, mipmaps) {
    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      generateMipmaps: Boolean(mipmaps),
      depthBuffer: false,
      stencilBuffer: false,
      anisotropy: mipmaps ? maxAnisotropy : 1,
    });
    bakeQuad.material = material;
    material.uniformsNeedUpdate = true;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(bakeScene, bakeCamera);
    renderer.setRenderTarget(previous);
    return target.texture;
  }

  function makeBakeMaterial(fragmentShader, uniforms, derivatives) {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SH.bakeVertex,
      fragmentShader,
      extensions: { derivatives: Boolean(derivatives) },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
  }

  // ---------- Kleine Canvas-Texturen (weiche Punkte, Glühen, Strahlen) ----------
  // Deterministischer Zufall, damit die Szene bei jedem Laden gleich aussieht.
  function seededRandom(seedOffset) {
    let seed = seedOffset * 999.7 + 13;
    return function rand() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  function makeRadialTexture(size, stops) {
    const cvs = document.createElement("canvas");
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext("2d");
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([offset, color]) => grad.addColorStop(offset, color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cvs);
  }

  const softDotTexture = makeRadialTexture(64, [
    [0, "rgba(255,255,255,1)"],
    [0.22, "rgba(255,255,255,0.8)"],
    [0.55, "rgba(255,255,255,0.14)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  const glowTexture = makeRadialTexture(256, [
    [0, "rgba(255,255,255,1)"],
    [0.16, "rgba(255,255,255,0.6)"],
    [0.42, "rgba(255,255,255,0.16)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  // Halo für Planeten: die Mitte verdeckt ohnehin der Planet, sichtbar ist nur
  // der weiche Saum um den Rand.
  const haloTexture = makeRadialTexture(256, [
    [0, "rgba(255,255,255,1)"],
    [0.45, "rgba(255,255,255,0.55)"],
    [0.56, "rgba(255,255,255,0.32)"],
    [0.72, "rgba(255,255,255,0.1)"],
    [0.86, "rgba(255,255,255,0.025)"],
    [1, "rgba(255,255,255,0)"],
  ]);

  function makeRaysTexture() {
    const size = 512;
    const cvs = document.createElement("canvas");
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext("2d");
    const rand = seededRandom(7);
    ctx.translate(size / 2, size / 2);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 44; i++) {
      const angle = (i / 44) * Math.PI * 2 + rand() * 0.12;
      const len = size * (0.2 + rand() * 0.28);
      const width = 1.2 + rand() * 4;
      ctx.save();
      ctx.rotate(angle);
      const grad = ctx.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, `rgba(255,236,200,${(0.3 + rand() * 0.35).toFixed(2)})`);
      grad.addColorStop(1, "rgba(255,200,140,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -width);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, width);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    return new THREE.CanvasTexture(cvs);
  }

  // ---------- Weltraum-Hintergrund ----------
  // Gebackene Himmelskugel: dunkle blau/violette Nebel, rote Regionen, Staubband.
  const nebulaBakeMaterial = makeBakeMaterial(SH.nebulaBakeFragment, {
    uSeed: { value: new THREE.Vector3(3.7, 1.9, 5.3) },
  });
  const skyTexture = bakeTexture(nebulaBakeMaterial, LOW_TIER ? 1024 : 2048, LOW_TIER ? 512 : 1024, true);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 64, 32),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // Sterne in drei Tiefen (runde, weiche Punkte statt Quadrate).
  function createStarLayer(count, minR, maxR, size, opacity, palette) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const colorSet = palette || [
      [1.0, 1.0, 1.0],
      [0.78, 0.86, 1.0],
      [1.0, 0.92, 0.78],
      [0.86, 0.8, 1.0],
    ];
    for (let i = 0; i < count; i++) {
      const r = minR + Math.random() * (maxR - minR);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const c = colorSet[Math.floor(Math.random() * colorSet.length)];
      const shade = 0.45 + Math.random() * 0.55;
      colors[i * 3] = c[0] * shade;
      colors[i * 3 + 1] = c[1] * shade;
      colors[i * 3 + 2] = c[2] * shade;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size,
        map: softDotTexture,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      })
    );
    points.renderOrder = -6;
    scene.add(points);
    return points;
  }

  const starfield = createStarLayer(LOW_TIER ? 2600 : 4400, 260, 820, 3.4, 0.85);
  const starfieldNear = createStarLayer(LOW_TIER ? 420 : 720, 140, 260, 3.2, 0.7);
  const starfieldBright = createStarLayer(LOW_TIER ? 60 : 150, 320, 760, 10, 0.95, [
    [0.82, 0.9, 1.0],
    [1.0, 1.0, 1.0],
    [1.0, 0.9, 0.78],
  ]);

  // Nebelschwaden als Parallax-Ebene zwischen Himmel und Szene.
  function createNebula() {
    const group = new THREE.Group();
    const cloudMaterial = makeBakeMaterial(SH.nebulaCloudBakeFragment, { uSeed: { value: new THREE.Vector3() } });
    const specs = [
      { color: 0x4a36c8, size: 560, pos: [-230, 110, -330], opacity: 0.34, seed: [1.3, 4.2, 0.7] },
      { color: 0xc0203e, size: 480, pos: [290, -20, -310], opacity: 0.3, seed: [7.1, 2.4, 3.3] },
      { color: 0x2266c8, size: 620, pos: [30, 200, -400], opacity: 0.26, seed: [5.5, 8.8, 1.9] },
    ];
    const used = LOW_TIER ? specs.slice(0, 2) : specs;
    used.forEach((s) => {
      cloudMaterial.uniforms.uSeed.value.set(s.seed[0], s.seed[1], s.seed[2]);
      const tex = bakeTexture(cloudMaterial, 512, 512, false);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          color: s.color,
          transparent: true,
          opacity: s.opacity,
          depthWrite: false,
          fog: false,
          blending: THREE.AdditiveBlending,
        })
      );
      sprite.scale.set(s.size, s.size, 1);
      sprite.position.set(s.pos[0], s.pos[1], s.pos[2]);
      sprite.renderOrder = -8;
      group.add(sprite);
    });
    scene.add(group);
    return group;
  }
  const nebula = createNebula();

  // ---------- Staub: feiner Schwebstaub + ferne Staubscheibe ----------
  function createDust() {
    const count = LOW_TIER ? 260 : 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 180;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 90;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 180;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x9fb4ff,
        size: 0.8,
        map: softDotTexture,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    scene.add(points);
    return points;
  }
  const dust = createDust();

  function createFarDust() {
    const count = LOW_TIER ? 900 : 2200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 110 + Math.pow(Math.random(), 0.7) * 190;
      const a = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = (Math.random() - 0.5) * (18 + r * 0.12);
      positions[i * 3 + 2] = Math.sin(a) * r;
      const warm = Math.random() < 0.2;
      colors[i * 3] = warm ? 0.9 : 0.45 + Math.random() * 0.25;
      colors[i * 3 + 1] = warm ? 0.45 : 0.45 + Math.random() * 0.2;
      colors[i * 3 + 2] = warm ? 0.5 : 0.95;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 1.8,
        map: softDotTexture,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      })
    );
    points.renderOrder = -4;
    scene.add(points);
    return points;
  }
  const farDust = createFarDust();

  // ---------- Planeten-Material (eigener Shader, Sonne im Zentrum) ----------
  const SUN_POS = new THREE.Vector3(0, 0, 0);
  const SUN_COLOR = new THREE.Vector3(1.42, 1.18, 0.9);
  // Cineastisches Licht: die Planeten werden von einem Punkt zwischen Stern und
  // Kamera beleuchtet. So zeigen auch die nahen Welten ihre Tagseite zur Mitte
  // hin (wie in der Referenz), statt der Kamera nur die Nachtseite zuzuwenden.
  const PLANET_LIGHT_BLEND = 0.42;
  const planetLightPos = SUN_POS.clone().lerp(DEFAULT_CAM_POS, PLANET_LIGHT_BLEND);
  const sharedPlanetUniforms = {
    uSunPos: { value: planetLightPos },
    uSunColor: { value: SUN_COLOR.clone() },
    uAmbient: { value: new THREE.Vector3(0.06, 0.068, 0.1) },
    uExposure: { value: 1.65 },
  };

  function makePlanetMaterial(surface, look) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTexA: { value: surface.texA },
        uTexB: { value: surface.texB },
        uSunPos: sharedPlanetUniforms.uSunPos,
        uSunColor: sharedPlanetUniforms.uSunColor,
        uAmbient: sharedPlanetUniforms.uAmbient,
        uExposure: sharedPlanetUniforms.uExposure,
        uAtmo: { value: new THREE.Color(look.atmo) },
        uAtmo2: { value: new THREE.Color(look.atmo2 || look.atmo) },
        uEmit: { value: new THREE.Color(look.emit || "#000000") },
        uEmitAlways: { value: look.emitAlways || 0 },
        uEmitPulse: { value: 1 },
        uBump: { value: look.bump === undefined ? 1.5 : look.bump },
        uSpecPower: { value: look.specPower || 30 },
        uSpecStrength: { value: look.spec || 0 },
        uRim: { value: look.rim === undefined ? 0.85 : look.rim },
        uHover: { value: 0 },
      },
      vertexShader: SH.planetVertex,
      fragmentShader: SH.planetFragment,
    });
  }

  const surfaceBakeMaterial = makeBakeMaterial(
    SH.surfaceBakeFragment,
    {
      uStyle: { value: 0 },
      uPass: { value: 0 },
      uSeed: { value: new THREE.Vector3() },
      uC0: { value: new THREE.Color() },
      uC1: { value: new THREE.Color() },
      uC2: { value: new THREE.Color() },
      uC3: { value: new THREE.Color() },
      uC4: { value: new THREE.Color() },
      uSea: { value: 0.5 },
    },
    true
  );
  const SURFACE_SIZE = LOW_TIER ? 512 : 1024;

  function bakeSurface(look, size) {
    const u = surfaceBakeMaterial.uniforms;
    const s = look.seed || 1;
    u.uStyle.value = look.style;
    u.uSeed.value.set((s * 1.37) % 17, (s * 2.11) % 13, (s * 0.73) % 11);
    for (let i = 0; i < 5; i++) {
      u["uC" + i].value.set(look.palette[Math.min(i, look.palette.length - 1)]);
    }
    u.uSea.value = look.sea === undefined ? 0.5 : look.sea;
    u.uPass.value = 0;
    const texA = bakeTexture(surfaceBakeMaterial, size, size / 2, true);
    u.uPass.value = 1;
    const texB = bakeTexture(surfaceBakeMaterial, size, size / 2, true);
    return { texA, texB };
  }

  // Aussehen je Universum: Oberflächenstil, Farbpalette, Leuchten, Atmosphäre,
  // Halo, Wolken, Ring und Monde. Stile: 0 erdähnlich, 1 Eis, 2 kosmischer
  // Eisriese, 3 dunkle Vulkanwelt, 4 elektrisch, 5 Inferno, 6 metallisch,
  // 7 zerstört, 8 Gestein (Monde).
  const PLANET_LOOKS = {
    xmen: {
      style: 1,
      palette: ["#08224a", "#3f86c9", "#d8f3ff", "#39d0ff", "#ffffff"],
      seed: 11,
      emit: "#5fe6ff",
      emitAlways: 0.25,
      bump: 1.8,
      specPower: 40,
      spec: 0.55,
      atmo: "#4fc8ff",
      atmo2: "#a6ecff",
      atmoScale: 1.24,
      atmoIntensity: 1.3,
      rim: 0.95,
      halo: { color: "#3aa8ff", scale: 4.2, opacity: 0.42 },
      clouds: 0.45,
      moon: { size: 0.19, dist: 1.7, speed: 0.22, tilt: -0.95 },
      spin: 0.06,
      labelColor: "#4fb4ff",
    },
    titan: {
      style: 7,
      palette: ["#1d1411", "#523627", "#5a3558", "#ff7a2a", "#000000"],
      seed: 23,
      emit: "#ff7b2a",
      emitAlways: 0.45,
      bump: 2.2,
      specPower: 12,
      spec: 0.05,
      atmo: "#8a4dff",
      atmo2: "#ff7a3a",
      atmoScale: 1.22,
      atmoIntensity: 1.25,
      rim: 0.9,
      halo: { color: "#9b5cff", scale: 4.0, opacity: 0.32 },
      ring: { inner: 1.5, outer: 2.25, colorA: "#3a2a22", colorB: "#8a5a3c", opacity: 0.62, tilt: [1.2, 0.35] },
      spin: 0.05,
      labelColor: "#a36bff",
    },
    holland: {
      style: 0,
      palette: ["#0a1838", "#1e5a96", "#7a221c", "#c24a34", "#f3e6e6"],
      seed: 37,
      sea: 0.5,
      emit: "#ffbf73",
      bump: 1.4,
      specPower: 60,
      spec: 0.8,
      atmo: "#5d8dff",
      atmo2: "#ff6a6a",
      atmoScale: 1.2,
      atmoIntensity: 1.2,
      rim: 0.85,
      halo: { color: "#ff5a6a", scale: 3.8, opacity: 0.28 },
      clouds: 0.75,
      spin: 0.08,
      labelColor: "#ff4040",
    },
    tobey: {
      style: 3,
      palette: ["#16070f", "#4a1222", "#6a2a5c", "#ff3b2a", "#000000"],
      seed: 51,
      emit: "#ff4030",
      emitAlways: 0.2,
      bump: 2.0,
      specPower: 20,
      spec: 0.06,
      atmo: "#b3285a",
      atmo2: "#ff4d5e",
      atmoScale: 1.2,
      atmoIntensity: 1.25,
      rim: 0.9,
      halo: { color: "#d4285a", scale: 3.8, opacity: 0.32 },
      clouds: 0.35,
      spin: 0.07,
      labelColor: "#ff3a3a",
    },
    garfield: {
      style: 4,
      palette: ["#031022", "#0b3a5e", "#1c7797", "#3fe6ff", "#000000"],
      seed: 67,
      emit: "#62f2ff",
      emitAlways: 0.55,
      bump: 1.4,
      specPower: 50,
      spec: 0.4,
      atmo: "#2fd8ff",
      atmo2: "#a6f6ff",
      atmoScale: 1.24,
      atmoIntensity: 1.4,
      rim: 1.0,
      halo: { color: "#2fd8ff", scale: 4.2, opacity: 0.4 },
      clouds: 0.6,
      spin: 0.09,
      labelColor: "#3fa9ff",
    },
    fantasticfour: {
      style: 2,
      palette: ["#0b2462", "#3574d4", "#cfe9ff", "#f2fbff", "#9fd8ff"],
      seed: 79,
      emit: "#a8dcff",
      emitAlways: 0.35,
      bump: 0.6,
      specPower: 30,
      spec: 0.12,
      atmo: "#4f8fff",
      atmo2: "#9cc8ff",
      atmoScale: 1.34,
      atmoIntensity: 1.2,
      rim: 0.95,
      halo: { color: "#4f8cff", scale: 4.6, opacity: 0.36 },
      labelColor: "#5aa2ff",
      ring: { inner: 1.55, outer: 2.65, colorA: "#5f8fe0", colorB: "#cfe2ff", opacity: 0.55, tilt: [1.28, -0.22] },
      spin: 0.05,
    },
    doomsday: {
      style: 5,
      palette: ["#110504", "#3b1109", "#5c2a18", "#ff5a1f", "#000000"],
      seed: 83,
      emit: "#ff4418",
      emitAlways: 0.75,
      bump: 2.2,
      specPower: 10,
      spec: 0.03,
      atmo: "#ff2a14",
      atmo2: "#ff6a2a",
      atmoScale: 1.26,
      atmoIntensity: 1.6,
      rim: 1.0,
      halo: { color: "#ff3a1a", scale: 4.9, opacity: 0.58 },
      clouds: 0.4,
      moon: { size: 0.15, dist: 1.5, speed: -0.18, tilt: 0.95 },
      spin: 0.045,
      labelColor: "#ff3b2a",
    },
    thunderbolts: {
      style: 6,
      palette: ["#131119", "#3a3450", "#4b2f7a", "#b07bff", "#000000"],
      seed: 97,
      emit: "#b07bff",
      emitAlways: 0.25,
      bump: 1.5,
      specPower: 28,
      spec: 0.9,
      atmo: "#9a78ff",
      atmo2: "#dccfff",
      atmoScale: 1.18,
      atmoIntensity: 1.05,
      rim: 0.8,
      halo: { color: "#8c6cff", scale: 3.6, opacity: 0.28 },
      spin: 0.1,
      labelColor: "#ffcf3a",
    },
    avengers: {
      style: 0,
      palette: ["#05183a", "#0f4c87", "#2e5f2a", "#8f7a52", "#eef3f8"],
      seed: 101,
      sea: 0.53,
      emit: "#ffc27a",
      bump: 1.5,
      specPower: 70,
      spec: 0.9,
      atmo: "#5d9dff",
      atmo2: "#b0d8ff",
      atmoScale: 1.22,
      atmoIntensity: 1.3,
      rim: 0.95,
      halo: { color: "#4a8cff", scale: 4.2, opacity: 0.36 },
      clouds: 0.85,
      moon: { size: 0.21, dist: 1.7, speed: 0.15, tilt: 0.7 },
      spin: 0.07,
      labelColor: "#5a9bff",
    },
  };

  function lookFor(u) {
    return (
      PLANET_LOOKS[u.id] || {
        style: 3,
        palette: [u.colorA, u.colorB, u.colorB, u.accent, "#ffffff"],
        seed: u.id.length * 7,
        emit: u.accent,
        emitAlways: 0.2,
        atmo: u.accent,
        halo: { color: u.accent, scale: 3.8, opacity: 0.28 },
      }
    );
  }

  // Einheitskugeln, die je Planet über body.scale auf den Radius gebracht werden.
  const planetGeometry = new THREE.SphereGeometry(1, LOW_TIER ? 64 : 96, LOW_TIER ? 48 : 64);
  const shellGeometry = new THREE.SphereGeometry(1, 64, 40);

  const moonMaterial = makePlanetMaterial(
    bakeSurface({ style: 8, palette: ["#34312e", "#8d8680"], seed: 5 }, 256),
    { atmo: "#9aa4b8", atmo2: "#d8dce6", rim: 0.25, bump: 2.2, spec: 0.02 }
  );

  // ---------- Energiekern im Zentrum ----------
  const SUN_RADIUS = 2.4;
  const sunUniforms = { uTime: { value: 0 }, uPulse: { value: 1 } };

  function createOrbitParticles(count, radiusFn, heightFn, sizeFn, colorFn, speed, twinkle, opacity) {
    const geo = new THREE.BufferGeometry();
    const aRadius = new Float32Array(count);
    const aAngle = new Float32Array(count);
    const aHeight = new Float32Array(count);
    const aSize = new Float32Array(count);
    const aPhase = new Float32Array(count);
    const aColor = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      aRadius[i] = radiusFn(i);
      aAngle[i] = Math.random() * Math.PI * 2;
      aHeight[i] = heightFn(aRadius[i]);
      aSize[i] = sizeFn();
      aPhase[i] = Math.random() * Math.PI * 2;
      const c = colorFn(aRadius[i]);
      aColor[i * 3] = c[0];
      aColor[i * 3 + 1] = c[1];
      aColor[i * 3 + 2] = c[2];
    }
    // "position" wird nur für die Anzahl der Punkte gebraucht; die echte
    // Position rechnet der Vertex-Shader aus Radius, Winkel und Zeit.
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("aRadius", new THREE.BufferAttribute(aRadius, 1));
    geo.setAttribute("aAngle", new THREE.BufferAttribute(aAngle, 1));
    geo.setAttribute("aHeight", new THREE.BufferAttribute(aHeight, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3));
    const points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: sunUniforms.uTime,
          uSpeed: { value: speed },
          uPixelRatio: pixelRatioUniform,
          uTwinkle: { value: twinkle },
          uOpacity: { value: opacity },
        },
        vertexShader: SH.orbitParticleVertex,
        fragmentShader: SH.orbitParticleFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    points.frustumCulled = false;
    return points;
  }

  function createOrbitRing(spec) {
    const geo = new THREE.RingGeometry(spec.r - spec.w * 3, spec.r + spec.w * 3, spec.r > 15 ? 360 : 220, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(spec.color) },
        uRadius: { value: spec.r },
        uWidth: { value: spec.w },
        uOpacity: { value: spec.opacity },
        uTime: sunUniforms.uTime,
        uSpark: { value: spec.spark || 0 },
        uSparkSpeed: { value: spec.speed || 0 },
        uPhase: { value: Math.random() },
      },
      vertexShader: SH.orbitRingVertex,
      fragmentShader: SH.orbitRingFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    return ring;
  }

  function createSun() {
    const group = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS, 64, 48),
      new THREE.ShaderMaterial({ uniforms: sunUniforms, vertexShader: SH.sunVertex, fragmentShader: SH.sunFragment })
    );
    group.add(core);

    // Mehrschichtige Corona (additiv): heißer Kern bis weiter, rötlicher Schein.
    const coronaSprites = [
      { color: 0xfff0c8, scale: 4.4, opacity: 0.95 },
      { color: 0xffb04a, scale: 9.5, opacity: 0.55 },
      { color: 0xff6a2a, scale: 19, opacity: 0.24 },
      { color: 0xff3a1e, scale: 34, opacity: 0.08 },
    ].map((layer) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: layer.color,
          transparent: true,
          opacity: layer.opacity,
          depthWrite: false,
          fog: false,
          blending: THREE.AdditiveBlending,
        })
      );
      sprite.scale.setScalar(SUN_RADIUS * layer.scale);
      sprite.userData.base = SUN_RADIUS * layer.scale;
      sprite.userData.baseOpacity = layer.opacity;
      group.add(sprite);
      return sprite;
    });

    const rays = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeRaysTexture(),
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      })
    );
    rays.scale.setScalar(SUN_RADIUS * 13);
    group.add(rays);

    // Flammenzungen der Corona (nur auf leistungsfähigen Geräten).
    let flare = null;
    if (!LOW_TIER) {
      flare = new THREE.Mesh(
        new THREE.PlaneGeometry(SUN_RADIUS * 7, SUN_RADIUS * 7),
        new THREE.ShaderMaterial({
          uniforms: { uTime: sunUniforms.uTime, uCore: { value: 1 / 3.5 }, uStrength: { value: 0.85 } },
          vertexShader: SH.flareVertex,
          fragmentShader: SH.flareFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      group.add(flare);
    }

    // Energiepartikel, die aus dem Kern strömen.
    const energyCount = LOW_TIER ? 140 : 320;
    const dirs = new Float32Array(energyCount * 3);
    const offsets = new Float32Array(energyCount);
    const speeds = new Float32Array(energyCount);
    for (let i = 0; i < energyCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      dirs[i * 3] = Math.sin(phi) * Math.cos(theta);
      dirs[i * 3 + 1] = Math.cos(phi);
      dirs[i * 3 + 2] = Math.sin(phi) * Math.sin(theta);
      offsets[i] = Math.random();
      speeds[i] = 0.05 + Math.random() * 0.12;
    }
    const energyGeo = new THREE.BufferGeometry();
    energyGeo.setAttribute("position", new THREE.BufferAttribute(dirs, 3));
    energyGeo.setAttribute("aDir", new THREE.BufferAttribute(dirs, 3));
    energyGeo.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 1));
    energyGeo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    const energy = new THREE.Points(
      energyGeo,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: sunUniforms.uTime,
          uCore: { value: SUN_RADIUS },
          uSpan: { value: SUN_RADIUS * 2.6 },
          uSize: { value: 5.0 },
          uPixelRatio: pixelRatioUniform,
          uColor: { value: new THREE.Color(0xffc070) },
        },
        vertexShader: SH.energyVertex,
        fragmentShader: SH.energyFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    energy.frustumCulled = false;
    group.add(energy);

    // Glitzernde Staubscheibe (keplerähnlich: innen schneller als außen).
    const bandCenters = [2.6, 3.8, 5.4];
    const disk = createOrbitParticles(
      LOW_TIER ? 1300 : 3200,
      () => {
        if (Math.random() < 0.6) {
          const c = bandCenters[Math.floor(Math.random() * bandCenters.length)];
          const g = (Math.random() + Math.random() + Math.random() - 1.5) * 0.35;
          return SUN_RADIUS * (c + g);
        }
        return SUN_RADIUS * (1.8 + Math.pow(Math.random(), 1.3) * 6.2);
      },
      (r) => (Math.random() - 0.5) * 0.05 * r,
      () => (Math.random() < 0.08 ? 2.4 + Math.random() * 1.6 : 0.7 + Math.random() * 1.1),
      (r) => {
        const t = Math.min(1, (r / SUN_RADIUS - 1.8) / 6.2);
        const white = [1.0, 0.95, 0.85];
        const orange = [1.0, 0.6, 0.28];
        const k = t * (0.7 + Math.random() * 0.3);
        return [white[0] + (orange[0] - white[0]) * k, white[1] + (orange[1] - white[1]) * k, white[2] + (orange[2] - white[2]) * k];
      },
      0.18,
      0.45,
      0.85
    );
    group.add(disk);

    // Dunkle Gesteinsbrocken in der Scheibe, vom Kern beleuchtet.
    const rockCount = LOW_TIER ? 70 : 160;
    const rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x3b312b, roughness: 0.95, metalness: 0.05, flatShading: true }),
      rockCount
    );
    const rockRand = seededRandom(31);
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (let i = 0; i < rockCount; i++) {
      const r = SUN_RADIUS * (2.2 + rockRand() * 5.6);
      const a = rockRand() * Math.PI * 2;
      pos.set(Math.cos(a) * r, (rockRand() - 0.5) * 0.35, Math.sin(a) * r);
      euler.set(rockRand() * Math.PI, rockRand() * Math.PI, rockRand() * Math.PI);
      quat.setFromEuler(euler);
      const sc = 0.05 + Math.pow(rockRand(), 2.2) * 0.2;
      scl.set(sc * (0.7 + rockRand() * 0.6), sc * (0.7 + rockRand() * 0.6), sc * (0.7 + rockRand() * 0.6));
      m4.compose(pos, quat, scl);
      rocks.setMatrixAt(i, m4);
    }
    rocks.instanceMatrix.needsUpdate = true;
    group.add(rocks);

    // Leuchtende Orbitalbahnen: goldene innere Ringe, weite bläuliche Bahnen.
    [
      { r: SUN_RADIUS * 2.3, w: 0.07, color: 0xffc46a, opacity: 0.6, spark: 1, speed: 0.05 },
      { r: SUN_RADIUS * 3.25, w: 0.07, color: 0xffb04a, opacity: 0.45 },
      { r: SUN_RADIUS * 4.5, w: 0.08, color: 0xff9a4a, opacity: 0.4, spark: 1, speed: 0.03 },
      { r: SUN_RADIUS * 6.2, w: 0.09, color: 0xe8a070, opacity: 0.32 },
      { r: 21, w: 0.14, color: 0x8f9cff, opacity: 0.2, spark: 1, speed: 0.012 },
      { r: 31, w: 0.17, color: 0x7f86d9, opacity: 0.13 },
      { r: 44, w: 0.2, color: 0x7a74c9, opacity: 0.09, spark: 1, speed: 0.008 },
    ].forEach((spec) => group.add(createOrbitRing(spec)));

    // Einzelne Teilchen entlang zweier Bahnen.
    group.add(
      createOrbitParticles(
        LOW_TIER ? 120 : 260,
        () => SUN_RADIUS * 6.2 + (Math.random() - 0.5) * 0.5,
        () => (Math.random() - 0.5) * 0.12,
        () => 0.8 + Math.random() * 1.4,
        () => [1.0, 0.78, 0.55],
        0.18,
        0.7,
        0.8
      )
    );
    group.add(
      createOrbitParticles(
        LOW_TIER ? 80 : 180,
        () => 21 + (Math.random() - 0.5) * 0.8,
        () => (Math.random() - 0.5) * 0.3,
        () => 1.2 + Math.random() * 1.8,
        () => [0.7, 0.78, 1.0],
        0.35,
        0.8,
        0.65
      )
    );

    // Kleine Monde, die den Kern auf den inneren Bahnen umrunden.
    const sunMoons = [
      { r: SUN_RADIUS * 3.25, size: 0.2, speed: 0.12, phase: 0.8 },
      { r: SUN_RADIUS * 4.5, size: 0.28, speed: 0.08, phase: 3.6 },
      { r: SUN_RADIUS * 6.2, size: 0.34, speed: 0.05, phase: 5.2 },
    ].map((spec) => {
      const pivot = new THREE.Group();
      const moon = new THREE.Mesh(planetGeometry, moonMaterial);
      moon.scale.setScalar(spec.size);
      moon.position.set(spec.r, 0, 0);
      pivot.add(moon);
      pivot.userData = spec;
      group.add(pivot);
      return pivot;
    });

    scene.add(group);

    function update(time, pulse) {
      coronaSprites.forEach((sprite, i) => {
        const breathe = 1 + Math.sin(time * (0.9 + i * 0.35) + i) * 0.03;
        sprite.scale.setScalar(sprite.userData.base * breathe * (0.98 + (pulse - 1)));
        sprite.material.opacity = sprite.userData.baseOpacity * (0.92 + (pulse - 1) * 1.5);
      });
      rays.material.rotation = time * 0.02;
      if (flare) flare.quaternion.copy(camera.quaternion);
      rocks.rotation.y = time * 0.02;
      sunMoons.forEach((pivot) => {
        pivot.rotation.y = time * pivot.userData.speed + pivot.userData.phase;
      });
    }

    return { group, flare, update };
  }
  const sunSystem = createSun();

  // ---------- Planeten ----------
  const planetObjects = [];

  UNIVERSES.forEach((u, idx) => {
    const look = lookFor(u);
    const surface = bakeSurface(look, SURFACE_SIZE);

    // group: Position, Hover-Skalierung, Neigung · body: Radius · mesh: Eigenrotation
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);

    const material = makePlanetMaterial(surface, look);
    const mesh = new THREE.Mesh(planetGeometry, material);
    mesh.userData.id = u.id;
    mesh.rotation.y = idx * 1.3;
    body.add(mesh);

    // Wolkendecke dreht sich eigenständig (auf schwächeren Geräten nur bei
    // den dichtesten Wolkenwelten).
    let clouds = null;
    if (look.clouds && (!LOW_TIER || look.clouds >= 0.8)) {
      clouds = new THREE.Mesh(
        shellGeometry,
        new THREE.ShaderMaterial({
          uniforms: {
            uTexB: { value: surface.texB },
            uSunPos: sharedPlanetUniforms.uSunPos,
            uSunColor: sharedPlanetUniforms.uSunColor,
            uExposure: sharedPlanetUniforms.uExposure,
            uOpacity: { value: look.clouds },
          },
          vertexShader: SH.cloudVertex,
          fragmentShader: SH.cloudFragment,
          transparent: true,
          depthWrite: false,
        })
      );
      clouds.scale.setScalar(1.012);
      clouds.rotation.y = idx * 0.7;
      body.add(clouds);
    }

    const atmoScale = look.atmoScale || 1.22;
    const atmosphere = new THREE.Mesh(
      shellGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(look.atmo) },
          uColor2: { value: new THREE.Color(look.atmo2 || look.atmo) },
          uSunPos: sharedPlanetUniforms.uSunPos,
          uIntensity: { value: look.atmoIntensity || 1.2 },
          uLimb: { value: Math.sqrt(1 - 1 / (atmoScale * atmoScale)) },
          uHover: material.uniforms.uHover,
        },
        vertexShader: SH.atmosphereVertex,
        fragmentShader: SH.atmosphereFragment,
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    atmosphere.scale.setScalar(atmoScale);
    body.add(atmosphere);

    let halo = null;
    if (look.halo) {
      halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTexture,
          color: look.halo.color,
          transparent: true,
          opacity: look.halo.opacity,
          depthWrite: false,
          fog: false,
          blending: THREE.AdditiveBlending,
        })
      );
      halo.scale.setScalar(look.halo.scale);
      halo.userData.baseOpacity = look.halo.opacity;
      body.add(halo);
    }

    let ring = null;
    if (look.ring) {
      const rs = look.ring;
      ring = new THREE.Mesh(
        new THREE.RingGeometry(rs.inner, rs.outer, 180, 1),
        new THREE.ShaderMaterial({
          uniforms: {
            uColorA: { value: new THREE.Color(rs.colorA) },
            uColorB: { value: new THREE.Color(rs.colorB) },
            uSunPos: sharedPlanetUniforms.uSunPos,
            uPlanetPos: { value: new THREE.Vector3() },
            uPlanetRadius: { value: 1 },
            uInner: { value: rs.inner },
            uOuter: { value: rs.outer },
            uOpacity: { value: rs.opacity },
            uSeed: { value: idx * 1.7 },
          },
          vertexShader: SH.planetRingVertex,
          fragmentShader: SH.planetRingFragment,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      ring.rotation.set(rs.tilt[0], rs.tilt[1], 0);
      body.add(ring);
    }

    let moonOrbit = null;
    if (look.moon) {
      const pivot = new THREE.Group();
      pivot.rotation.z = look.moon.tilt || 0;
      moonOrbit = new THREE.Group();
      moonOrbit.rotation.y = idx * 1.1;
      const moon = new THREE.Mesh(planetGeometry, moonMaterial);
      moon.scale.setScalar(look.moon.size);
      moon.position.set(look.moon.dist, 0, 0);
      moonOrbit.add(moon);
      pivot.add(moonOrbit);
      body.add(pivot);
    }

    scene.add(group);

    planetObjects.push({
      data: u,
      look,
      group,
      body,
      mesh,
      clouds,
      atmosphere,
      halo,
      ring,
      moonOrbit,
      moonSpeed: look.moon ? look.moon.speed : 0,
      uniforms: material.uniforms,
      // Komposition: Ankerpunkt + Radius werden aus dem Bildschirm-Layout
      // berechnet (siehe applyLayout) und bei Größenänderung weich angefahren.
      anchor: new THREE.Vector3(),
      anchorTarget: new THREE.Vector3(),
      radius: 1,
      radiusTarget: 1,
      tangent: new THREE.Vector3(1, 0, 0),
      driftAmp: 0,
      driftSpeed: (Math.PI * 2) / (70 + idx * 9),
      driftPhase: idx * 1.7,
      bobPhase: idx * 0.9,
      spinSpeed: look.spin || 0.07,
      hover: 0, // 0..1, steuert Glow/Vergrößerung beim Überfahren
      tilt: new THREE.Vector2(0, 0),
    });
  });

  // ---------- Fortschritts-Effekte an den Planeten ----------
  // Eigene, leichte Zusatzebene je Planet, abhängig von der Effektstufe aus
  // MarvelProgress.universeStats(id).tier (kumulativ): 1 zusätzlicher Glow,
  // 2 feiner Energiering, 3 dichtere Atmosphäre, 4 goldener Abschluss.
  // Alles hängt an p.body (Einheitsradius), damit Größe, Drift, Neigung und
  // Hover automatisch mitgehen; Planetenmaterial, Atmosphäre und Raycast (prüft
  // nur p.mesh) bleiben unberührt. Die Objekte entstehen erst, wenn eine Welt
  // zum ersten Mal eine Stufe erreicht; ausgeblendete Ebenen sind unsichtbar
  // (kein zusätzlicher Draw-Call).
  const progressFx = (function createProgressFx() {
    const GOLD = new THREE.Color("#ffb52e");
    const GOLD_RING = new THREE.Color("#ffc94a");
    const GOLD_ATMO = new THREE.Color("#ff9a2e");
    const GOLD_ATMO2 = new THREE.Color("#ffbf4d");
    const RING_WIDTH = 0.011; // relativ zum Ringradius
    const FADE_SPEED = 2.2; // weiches Ein-/Ausblenden (pro Sekunde)
    const LAYERS = ["glow", "ring", "atmo", "gold"];
    const RING_VIEW = 1.18; // Winkel zwischen Ringachse und Blickrichtung (Ellipse ~0,38)
    let ringGeometry = null;
    let coronaTexture = null;
    // Wiederverwendete Hilfsobjekte (keine Allokationen pro Frame)
    const _view = new THREE.Vector3();
    const _up = new THREE.Vector3();
    const _right = new THREE.Vector3();
    const _axisX = new THREE.Vector3();
    const _axisY = new THREE.Vector3();
    const _axisZ = new THREE.Vector3();
    const _basis = new THREE.Matrix4();
    const _groupInv = new THREE.Quaternion();

    const items = planetObjects.map((p, idx) => ({
      p,
      idx,
      built: false,
      active: false,
      target: { glow: 0, ring: 0, atmo: 0, gold: 0 },
      value: { glow: 0, ring: 0, atmo: 0, gold: 0 },
    }));

    function additiveSprite(map, color) {
      return new THREE.Sprite(
        new THREE.SpriteMaterial({
          map,
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          fog: false,
          blending: THREE.AdditiveBlending,
        })
      );
    }

    function build(it) {
      const p = it.p;
      const look = p.look;
      const atmoScale = look.atmoScale || 1.22;

      // Stufe 1: weiches Glühen in der Halo-Farbe, etwas weiter als der vorhandene Halo.
      it.glowScale = (look.halo ? look.halo.scale : 4) * 1.14;
      it.glow = additiveSprite(haloTexture, new THREE.Color(look.halo ? look.halo.color : look.atmo));
      it.glow.scale.setScalar(it.glowScale);

      // Stufe 2: feiner, leicht geneigter Energiering. Bei beringten Welten in
      // dieselbe Richtung geneigt wie der vorhandene Ring (liegt innerhalb davon
      // und wirkt so als Teil des Ringsystems statt ihn zu kreuzen). Die
      // Ausrichtung folgt der Blickrichtung (siehe orientRing), damit der Ring
      // auch in der Nahansicht nie hochkant als Strich über dem Planeten liegt.
      if (!ringGeometry) {
        ringGeometry = new THREE.RingGeometry(1 - RING_WIDTH * 6, 1 + RING_WIDTH * 6, LOW_TIER ? 128 : 192, 1);
      }
      it.ringColor = new THREE.Color(look.atmo2 || look.atmo);
      it.ring = new THREE.Mesh(
        ringGeometry,
        new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: it.ringColor.clone() },
            uOpacity: { value: 0 },
            uWidth: { value: RING_WIDTH },
            uTime: sunUniforms.uTime, // steht bei "Bewegung reduzieren" still
            uSpeed: { value: 0.032 + (it.idx % 3) * 0.006 },
            uPhase: { value: it.idx * 0.37 },
          },
          vertexShader: SH.progressRingVertex,
          fragmentShader: SH.progressRingFragment,
          extensions: { derivatives: true },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        })
      );
      const side = look.ring ? -Math.sign(look.ring.tilt[1]) || 1 : it.idx % 2 ? 1 : -1;
      it.ringTilt = 0.3 * side;
      it.ring.scale.setScalar(Math.max(1.38, atmoScale + 0.12));

      // Stufe 3: zusätzliche, größere Atmosphärenschale mit eigenem Material
      // (Band knapp außerhalb der vorhandenen Atmosphäre, die unverändert bleibt).
      const shellScale = atmoScale * 1.2;
      it.atmoColor = new THREE.Color(look.atmo);
      it.atmoColor2 = new THREE.Color(look.atmo2 || look.atmo);
      it.atmoIntensity = 0.28;
      it.atmo = new THREE.Mesh(
        shellGeometry,
        new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: it.atmoColor.clone() },
            uColor2: { value: it.atmoColor2.clone() },
            uSunPos: sharedPlanetUniforms.uSunPos,
            uIntensity: { value: 0 },
            uScale: { value: shellScale },
            uPeak: { value: atmoScale - 0.05 },
            uHover: p.uniforms.uHover,
          },
          vertexShader: SH.atmosphereVertex,
          fragmentShader: SH.progressAtmoFragment,
          transparent: true,
          side: THREE.BackSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      it.atmo.scale.setScalar(shellScale);

      // Stufe 4: goldene Korona — ein Lichtkranz, der knapp außerhalb der
      // Atmosphäre liegt (innen leer), damit das Gold nicht mit der
      // Planetenfarbe zu Weiß verschwimmt.
      if (!coronaTexture) {
        coronaTexture = makeRadialTexture(256, [
          [0, "rgba(255,255,255,0)"],
          [0.47, "rgba(255,255,255,0)"],
          [0.56, "rgba(255,255,255,0.4)"],
          [0.63, "rgba(255,255,255,0.85)"],
          [0.69, "rgba(255,255,255,0.55)"],
          [0.79, "rgba(255,255,255,0.18)"],
          [0.9, "rgba(255,255,255,0.04)"],
          [1, "rgba(255,255,255,0)"],
        ]);
      }
      it.goldScale = atmoScale * 3.2;
      it.gold = additiveSprite(coronaTexture, GOLD.clone());
      it.gold.scale.setScalar(it.goldScale);

      [it.glow, it.ring, it.atmo, it.gold].forEach((obj) => {
        obj.visible = false;
        p.body.add(obj);
      });
      it.built = true;
    }

    // Stufen neu berechnen (nur bei Fortschrittsänderungen, nicht pro Frame).
    function refresh() {
      const MP = window.MarvelProgress;
      const hasProfile = Boolean(MP && MP.profile && MP.profile());
      items.forEach((it) => {
        let tier = 0;
        if (hasProfile) {
          try {
            tier = MP.universeStats(it.p.data.id).tier || 0;
          } catch (e) {
            tier = 0;
          }
        }
        if (tier > 0 && !it.built) build(it);
        it.target.glow = tier >= 1 ? 1 : 0;
        it.target.ring = tier >= 2 ? 1 : 0;
        it.target.atmo = tier >= 3 ? 1 : 0;
        it.target.gold = tier >= 4 ? 1 : 0;
        if (it.built && tier > 0) it.active = true;
      });
    }

    // Ring wie von leicht oben gesehen ausrichten: Achse um RING_VIEW aus der
    // Blickrichtung zur Bildoberkante gekippt, im Bild um ringTilt geneigt.
    // Die vordere Hälfte liegt damit immer unten vor dem Planeten.
    function orientRing(it, tm) {
      const g = it.p.group; // direktes Kind der Szene, body ist nicht gedreht
      _view.copy(camera.position).sub(g.position).normalize();
      _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      _up.addScaledVector(_view, -_up.dot(_view)).normalize();
      _right.crossVectors(_up, _view);
      const tilt = it.ringTilt + (reduceMotion ? 0 : Math.sin(tm * 0.11 + it.idx) * 0.05);
      const c = Math.cos(tilt);
      const s = Math.sin(tilt);
      _axisX.copy(_right).multiplyScalar(c).addScaledVector(_up, -s);
      _axisY.copy(_up).multiplyScalar(c).addScaledVector(_right, s);
      _axisZ.copy(_view).multiplyScalar(Math.cos(RING_VIEW)).addScaledVector(_axisY, Math.sin(RING_VIEW));
      _axisY.crossVectors(_axisZ, _axisX);
      _basis.makeBasis(_axisX, _axisY, _axisZ);
      it.ring.quaternion.setFromRotationMatrix(_basis);
      it.ring.quaternion.premultiply(_groupInv.copy(g.quaternion).invert());
    }

    function update(dt, tm) {
      const k = 1 - Math.exp(-dt * FADE_SPEED);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.active) continue;
        const v = it.value;
        let settledToZero = true;
        for (let j = 0; j < LAYERS.length; j++) {
          const key = LAYERS[j];
          const target = it.target[key];
          v[key] += (target - v[key]) * k;
          if (Math.abs(target - v[key]) < 0.008) v[key] = target;
          if (v[key] > 0 || target > 0) settledToZero = false;
        }

        // Sanftes Pulsieren nur im goldenen Abschluss (bei reduzierter Bewegung aus).
        const wave = reduceMotion ? 0 : Math.sin(tm * 1.3 + it.idx * 0.8) * v.gold;
        const hover = 1 + it.p.hover * 0.5;

        // Im goldenen Abschluss ersetzt die Korona den farbigen Glow.
        const glowOpacity = 0.25 * v.glow * (1 - v.gold) * hover;
        it.glow.material.opacity = glowOpacity;
        it.glow.visible = glowOpacity > 0.002;

        const goldOpacity = 0.4 * v.gold * (1 + 0.18 * wave) * hover;
        it.gold.material.opacity = goldOpacity;
        it.gold.scale.setScalar(it.goldScale * (1 + 0.015 * wave));
        it.gold.visible = goldOpacity > 0.002;

        const ringU = it.ring.material.uniforms;
        const ringOpacity = (0.55 + 0.25 * v.gold) * v.ring * (1 + 0.12 * wave) * hover;
        ringU.uColor.value.copy(it.ringColor).lerp(GOLD_RING, v.gold);
        ringU.uOpacity.value = ringOpacity;
        it.ring.visible = ringOpacity > 0.002;
        if (it.ring.visible) orientRing(it, tm);

        const atmoU = it.atmo.material.uniforms;
        const atmoIntensity = it.atmoIntensity * v.atmo * (1 - 0.3 * v.gold) * (1 + 0.1 * wave);
        atmoU.uColor.value.copy(it.atmoColor).lerp(GOLD_ATMO, v.gold);
        atmoU.uColor2.value.copy(it.atmoColor2).lerp(GOLD_ATMO2, v.gold);
        atmoU.uIntensity.value = atmoIntensity;
        it.atmo.visible = atmoIntensity > 0.002;

        // Vollständig ausgeblendet: bis zur nächsten Stufe nichts mehr rechnen.
        if (settledToZero) {
          it.active = false;
          it.glow.visible = false;
          it.ring.visible = false;
          it.atmo.visible = false;
          it.gold.visible = false;
        }
      }
    }

    if (window.MarvelProgress && MarvelProgress.subscribe) {
      MarvelProgress.subscribe((ev) => {
        if (ev && (ev.type === "profile" || ev.type === "sync" || ev.type === "watched")) refresh();
      });
    }
    refresh();

    return { update, refresh };
  })();

  // ---------- Doctor Doom (prozedurale Wächter-Figur) ----------
  // Kein echtes Schauspielerfoto und kein fremdes 3D-Modell (Urheber-/Lizenzrechte) —
  // die Figur wird vollständig prozedural modelliert: polierte Silbermaske,
  // dunkelgrüne Kapuze mit langem Umhang, Metallrüstung und dezente grüne Energie.
  // Modellmaße in Kopfhöhen (Fußsohle y = 0, Scheitel ≈ 7,8): natürliche, erwachsene
  // Proportionen mit breiten Schultern und schmaler Taille.
  function createDoomFigure() {
    const group = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = -4; // Dreh- und Schwebepunkt etwa auf halber Höhe (Gürtel)
    group.add(body);

    // Schwache Geräte: weniger Segmente — die Figur ist ohnehin klein im Bild.
    const detail = LOW_TIER ? 0.6 : 1;
    const seg = (n) => Math.max(6, Math.round(n * detail));
    const sstep = (a, b, x) => {
      const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };
    const gauss = (d, w) => Math.exp(-(d * d) / (w * w));
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    // Gemeinsame Zeit für Umhang-Schwung und Energie-Partikel (Shader-Uniform)
    const doomTime = { value: 0 };

    // Kleine prozedurale Studio-Umgebung nur für die Doom-Materialien: ohne
    // Spiegelbild wirkt Metall in dieser Szene (kein scene.environment) stumpf.
    function makeEnvironment() {
      const w = LOW_TIER ? 128 : 256;
      const h = w / 2;
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const g = cv.getContext("2d");
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#4a5464");
      sky.addColorStop(0.38, "#8794a5");
      sky.addColorStop(0.48, "#d3dae4");
      sky.addColorStop(0.53, "#6a717b");
      sky.addColorStop(0.64, "#2e333a");
      sky.addColorStop(0.85, "#151a18");
      sky.addColorStop(1, "#0c1a10");
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      // Weiche Lichtflächen: u = Himmelsrichtung (≈ 0,69 liegt Richtung Kamera), v = Höhe
      const blob = (u, v, rx, ry, rgb, a) => {
        g.save();
        g.translate(u * w, (1 - v) * h);
        g.scale(rx * w, ry * h);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, `rgba(${rgb},${a})`);
        gr.addColorStop(0.55, `rgba(${rgb},${a * 0.6})`);
        gr.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = gr;
        g.beginPath();
        g.arc(0, 0, 1, 0, Math.PI * 2);
        g.fill();
        g.restore();
      };
      blob(0.86, 0.72, 0.09, 0.17, "235,242,255", 1); // Hauptlicht oben links
      blob(0.7, 0.62, 0.13, 0.07, "205,214,228", 0.7); // frontale Aufhellung
      blob(0.12, 0.6, 0.045, 0.28, "160,185,255", 0.9); // kühles Kantenlicht links hinten
      blob(0.37, 0.58, 0.045, 0.26, "255,205,160", 0.75); // warmes Kantenlicht rechts hinten
      blob(0.6, 0.47, 0.08, 0.08, "255,160,90", 0.55); // Widerschein des Energiekerns
      blob(0.72, 0.18, 0.3, 0.14, "40,170,90", 0.45); // grüner Schimmer von unten
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const target = pmrem.fromEquirectangular(tex);
      pmrem.dispose();
      tex.dispose();
      return target.texture;
    }
    const envMap = makeEnvironment();

    // Materialien: polierte Silbermaske, gebürsteter Stahl, dunkles Metall und
    // dunkelgrüner Stoff — glatt schattiert, Spiegelungen aus der Studio-Umgebung.
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ envMap }, o));
    const maskMat = std({ color: 0xd8dfe7, metalness: 1, roughness: 0.24, envMapIntensity: 1.4 });
    const armorMat = std({ color: 0x737c87, metalness: 1, roughness: 0.48, envMapIntensity: 1.2, side: THREE.DoubleSide });
    const darkMat = std({ color: 0x1c2025, metalness: 0.7, roughness: 0.5, envMapIntensity: 0.7 });
    const clothMat = std({ color: 0x0c3d1f, metalness: 0, roughness: 0.86, envMapIntensity: 0.45, side: THREE.DoubleSide });
    const capeMat = std({ color: 0x0a351b, metalness: 0, roughness: 0.88, envMapIntensity: 0.45, side: THREE.DoubleSide });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xa8ffc0, fog: false });

    // Gemeinsamer Shader-Zusatz (nur Werte per Uniform, damit alle Doom-Materialien
    // dasselbe Programm teilen können):
    // - uDirect dämpft das direkte Licht des Energiekerns, das die weit entfernte
    //   Figur sonst grell überstrahlt (Planeten und übrige Szene bleiben unberührt)
    // - Stoff: Innenseiten liegen im Schatten (uBack), ein feiner grüner Saum (uRim)
    //   trennt den dunklen Stoff vom Weltraum
    // - Umhang: langsamer Schwung im Vertex-Shader (uSway), kein Neuaufbau pro Frame
    function patchMaterial(mat, o) {
      const uniforms = {
        uDoomTime: doomTime,
        uDirect: { value: o.direct },
        uBack: { value: o.back || 1 },
        uRim: { value: new THREE.Color(o.rim || 0) },
        uSway: { value: o.sway || 0 },
      };
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader =
          "uniform float uDoomTime;\nuniform float uSway;\n" +
          shader.vertexShader.replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            float sw = uSway * clamp((6.4 - position.y) / 6.3, 0.0, 1.0);
            sw *= sw;
            transformed.x += sw * (sin(uDoomTime * 0.55 + position.y * 0.8) * 0.07 + sin(uDoomTime * 0.9 + position.x * 2.1) * 0.025);
            transformed.z += sw * (sin(uDoomTime * 0.43 + position.x * 1.4 + position.y * 0.6) * 0.1 - 0.03);`
          );
        shader.fragmentShader =
          "uniform vec3 uRim;\nuniform float uDirect;\nuniform float uBack;\n" +
          shader.fragmentShader
            .replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb *= gl_FrontFacing ? 1.0 : uBack;")
            .replace(
              "#include <emissivemap_fragment>",
              `#include <emissivemap_fragment>
              float rimF = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
              totalEmissiveRadiance += uRim * rimF * rimF * rimF;`
            )
            .replace(
              "#include <lights_fragment_end>",
              "#include <lights_fragment_end>\n reflectedLight.directDiffuse *= uDirect;\n reflectedLight.directSpecular *= uDirect;"
            );
      };
    }
    patchMaterial(maskMat, { direct: 0.55 });
    patchMaterial(armorMat, { direct: 0.5 });
    patchMaterial(darkMat, { direct: 0.5 });
    patchMaterial(clothMat, { direct: 0.38, back: 0.38, rim: 0x0a3519 });
    patchMaterial(capeMat, { direct: 0.38, back: 0.38, rim: 0x0a3519, sway: 1 });

    // ---- Geometrie-Helfer ----
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3();
    const _up = new THREE.Vector3(0, 1, 0);

    // Position, Drehung (Euler) und Skalierung direkt in die Geometrie übernehmen
    function place(geo, px, py, pz, rx, ry, rz, sx, sy, sz) {
      _e.set(rx || 0, ry || 0, rz || 0);
      _q.setFromEuler(_e);
      _s.set(sx || 1, sy || sx || 1, sz || sx || 1);
      return geo.applyMatrix4(_m.compose(_p.set(px, py, pz), _q, _s));
    }

    // Glatter Körperteil entlang a → b mit Radienprofil [[t, r], …] (Drehkörper)
    function limb(a, b, profile) {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const geo = new THREE.LatheGeometry(profile.map(([t, r]) => new THREE.Vector2(r, t * len)), seg(14));
      _q.setFromUnitVectors(_up, dir.normalize());
      return geo.applyMatrix4(_m.compose(a, _q, _s.set(1, 1, 1)));
    }

    // Drehkörper um die Hochachse aus [[Radius, y], …]; flatZ staucht ihn zur Ellipse
    function lathe(points, segments, flatZ) {
      const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg(segments));
      if (flatZ) geo.scale(1, 1, flatZ);
      return geo;
    }

    // Normalen an deckungsgleichen Nahtpunkten (Kugelnaht, Pole) angleichen
    function smoothNormals(geo) {
      geo.computeVertexNormals();
      const p = geo.attributes.position;
      const n = geo.attributes.normal;
      const shared = new Map();
      for (let i = 0; i < p.count; i++) {
        const key = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
        const list = shared.get(key);
        if (list) list.push(i);
        else shared.set(key, [i]);
      }
      shared.forEach((list) => {
        if (list.length < 2) return;
        let x = 0;
        let y = 0;
        let z = 0;
        list.forEach((i) => {
          x += n.getX(i);
          y += n.getY(i);
          z += n.getZ(i);
        });
        const l = Math.hypot(x, y, z) || 1;
        list.forEach((i) => n.setXYZ(i, x / l, y / l, z / l));
      });
      return geo;
    }

    // Fügt mehrere Teile zu einer Geometrie zusammen — ein Draw-Call pro Material
    function merge(list) {
      let vCount = 0;
      let iCount = 0;
      list.forEach((g) => {
        vCount += g.attributes.position.count;
        iCount += g.index ? g.index.count : g.attributes.position.count;
      });
      const pos = new Float32Array(vCount * 3);
      const nor = new Float32Array(vCount * 3);
      const uv = new Float32Array(vCount * 2);
      const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
      let vo = 0;
      let io = 0;
      list.forEach((g) => {
        const count = g.attributes.position.count;
        pos.set(g.attributes.position.array, vo * 3);
        nor.set(g.attributes.normal.array, vo * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
        if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
        else for (let i = 0; i < count; i++) idx[io++] = i + vo;
        vo += count;
        g.dispose();
      });
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      out.setIndex(new THREE.BufferAttribute(idx, 1));
      out.computeBoundingSphere();
      return out;
    }

    // Fläche aus einem Raster (rows × cols) mit Positionsfunktion fn(u, v)
    function gridSurface(rows, cols, fn) {
      const pos = new Float32Array((rows + 1) * (cols + 1) * 3);
      const uv = new Float32Array((rows + 1) * (cols + 1) * 2);
      const idx = [];
      const out = new THREE.Vector3();
      for (let i = 0; i <= rows; i++) {
        for (let j = 0; j <= cols; j++) {
          const k = i * (cols + 1) + j;
          fn(j / cols, i / rows, out);
          pos[k * 3] = out.x;
          pos[k * 3 + 1] = out.y;
          pos[k * 3 + 2] = out.z;
          uv[k * 2] = j / cols;
          uv[k * 2 + 1] = i / rows;
        }
      }
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const a = i * (cols + 1) + j;
          const b = a + cols + 1;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      return smoothNormals(geo);
    }

    const maskParts = [];
    const armorParts = [];
    const darkParts = [];
    const clothParts = [];
    const glowParts = [];

    // ---- Maske: verformte Kugel mit flacher Gesichtsplatte, kantigen Brauen,
    // Nasengrat, Wangenknochen, Mundschlitz, eckigem Kinn und Plattennaht ----
    const HEAD = V(0, 7.28, 0.05);
    const seamX = (y) => 0.255 - 0.08 * sstep(-0.05, -0.42, y);
    function shapeMask(v) {
      let x = v.x * 0.35;
      let y = v.y * 0.49;
      let z = v.z * 0.43;
      // Schädel oben etwas breiter, Kiefer zum eckigen Kinn hin schmaler
      const jaw = sstep(0.02, -0.46, y);
      x *= 1.02 - 0.3 * jaw;
      if (z < 0) z *= 1 - 0.18 * jaw;
      if (y < -0.41) y = -0.41 + (y + 0.41) * 0.3; // flacher Kinnboden
      // Gesichtsplatte: Vorderseite weitgehend flach, nur leicht gewölbt
      const front = sstep(0.05, 0.3, z);
      const plate = 0.355 - 0.75 * x * x - 0.25 * Math.max(0, y - 0.18) ** 2;
      if (z > plate) z = plate + (z - plate) * 0.18;
      const ax = Math.abs(x);
      let dz = 0;
      // Brauenwulst, zur Mitte hin abgesenkt (strenger, finsterer Blick)
      dz += 0.055 * gauss(y - (0.085 + 0.13 * ax), 0.03) * sstep(0.31, 0.2, ax);
      // Augenhöhlen unter den Brauen
      dz -= 0.04 * gauss(ax - 0.13, 0.075) * gauss(y - 0.015, 0.035);
      // Nasengrat, nach unten breiter und höher
      const nt = sstep(0.06, -0.16, y);
      dz += (0.02 + 0.055 * nt) * gauss(x, 0.022 + 0.035 * nt) * sstep(-0.21, -0.165, y) * sstep(0.12, 0.04, y);
      // Wangenknochen und eingefallene Wangen
      dz += 0.025 * gauss(ax - 0.17, 0.06) * gauss(y + 0.08, 0.05);
      dz -= 0.02 * gauss(ax - 0.15, 0.06) * gauss(y + 0.24, 0.06);
      // Mundschlitz
      dz -= 0.04 * sstep(0.15, 0.115, ax) * sstep(0.03, 0.016, Math.abs(y + 0.3));
      // Kinn
      dz += 0.022 * gauss(x, 0.09) * gauss(y + 0.4, 0.05);
      // Plattennaht an Wangen und Kiefer
      dz -= 0.012 * gauss(ax - seamX(y), 0.01) * sstep(0.1, 0.0, y);
      v.set(x, y, z + dz * front);
    }
    const maskGeo = new THREE.SphereGeometry(1, seg(64), seg(56));
    maskGeo.rotateY(-Math.PI / 2); // Naht nach hinten (unter die Kapuze)
    {
      const p = maskGeo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        shapeMask(v.fromBufferAttribute(p, i));
        p.setXYZ(i, v.x, v.y, v.z);
      }
      smoothNormals(maskGeo);
    }
    // Oberfläche der Maske abtasten, um Details exakt aufzusetzen
    const maskProbe = new THREE.Mesh(maskGeo, maskMat);
    const probe = new THREE.Raycaster();
    const probeDir = V(0, 0, -1);
    const surfaceZ = (x, y) => {
      probe.set(_p.set(x, y, 2), probeDir);
      const hit = probe.intersectObject(maskProbe)[0];
      return hit ? hit.point.z : 0.3;
    };
    // Schmale, schräg gestellte Augenschlitze (innen tiefer — bedrohlicher Blick)
    [-1, 1].forEach((s) => {
      const x = s * 0.128;
      const eye = new THREE.BoxGeometry(0.125, 0.026, 0.03);
      place(eye, x, 0.02, surfaceZ(x, 0.02) - 0.006, 0, 0, s * 0.2);
      glowParts.push(eye);
    });
    // Mundgitter: dunkle Öffnung mit senkrechten Stäben
    const mouthZ = surfaceZ(0, -0.3);
    darkParts.push(place(new THREE.BoxGeometry(0.25, 0.036, 0.012), 0, -0.3, mouthZ + 0.002));
    for (let i = -2; i <= 2; i++) {
      const x = i * 0.042;
      maskParts.push(place(new THREE.BoxGeometry(0.011, 0.046, 0.022), x, -0.3, surfaceZ(x, -0.272) - 0.008));
    }
    // Nieten entlang der Wangen- und Kiefernaht
    [-1, 1].forEach((s) => {
      [0.02, -0.09, -0.2, -0.31].forEach((y) => {
        const x = s * (seamX(y) + 0.024);
        maskParts.push(place(new THREE.SphereGeometry(0.013, 6, 4), x, y, surfaceZ(x, y) - 0.002));
      });
    });
    maskParts.push(maskGeo);
    [maskParts, darkParts, glowParts].forEach((list) => list.forEach((g) => g.translate(HEAD.x, HEAD.y, HEAD.z)));

    // ---- Kapuze und Kragen als eine durchgehende Stofffläche: Profil (Radius
    // über Höhe), vorne offen; die Öffnung schließt sich über der Stirn ----
    const hoodProfile = new THREE.SplineCurve(
      [
        [1.08, 6.2], [1.0, 6.36], [0.82, 6.55], [0.62, 6.72], [0.555, 6.9], [0.545, 7.15],
        [0.535, 7.4], [0.5, 7.65], [0.42, 7.85], [0.22, 7.98], [0.0, 8.02],
      ].map(([r, y]) => new THREE.Vector2(r, y))
    );
    const hoodRows = seg(30);
    const hoodPts = hoodProfile.getSpacedPoints(hoodRows);
    const hoodGap = (y) => (0.3 + 0.38 * sstep(6.75, 7.1, y)) * (1 - sstep(7.45, 7.72, y));
    function hoodPoint(u, vRow, out) {
      const pr = hoodPts[Math.round(vRow * hoodRows)];
      const y = pr.y;
      const head = sstep(6.45, 6.95, y);
      const sx = 1 + 0.02 * head;
      const sz = 0.62 + 0.38 * head;
      const g = hoodGap(y);
      const a = g + (Math.PI * 2 - 2 * g) * u;
      // Falten: weich fallender Kragen auf den Schultern, kaum Falten am Kopf
      let r = pr.x;
      r += 0.045 * Math.sin(a * 6 + 0.5) * sstep(6.95, 6.3, y) * sstep(0.02, 0.2, Math.min(u, 1 - u));
      r += 0.012 * Math.sin(a * 9 + y * 4) * head;
      // Leicht gerollter Saum an der Gesichtsöffnung
      r += 0.02 * Math.max(0, 1 - Math.min(u, 1 - u) / 0.05);
      // Kragen fällt vorne auf die Brust und hinten auf den Rücken
      const drape = sstep(6.7, 6.2, y);
      const ca = Math.cos(a);
      r += 0.06 * drape;
      out.set(Math.sin(a) * r * sx, y - drape * (0.3 * Math.pow(Math.max(0, ca), 1.5) + 0.12 * Math.max(0, -ca)), ca * r * sz + 0.02);
      // Spitz zulaufende Kapuze am Hinterkopf
      out.z -= 0.14 * sstep(7.45, 7.95, y) * Math.max(0, -Math.cos(a));
    }
    const hoodGeo = gridSurface(hoodRows, seg(40), hoodPoint);
    clothParts.push(hoodGeo);
    // Saum der Kapuzenöffnung als weicher Wulst
    {
      const left = [];
      const right = [];
      const tmp = new THREE.Vector3();
      for (let i = 0; i <= hoodRows; i++) {
        if (hoodGap(hoodPts[i].y) < 0.001) break;
        hoodPoint(0, i / hoodRows, tmp);
        left.push(tmp.clone());
        hoodPoint(1, i / hoodRows, tmp);
        right.push(tmp.clone());
      }
      const top = left[left.length - 1].clone().add(right[right.length - 1]).multiplyScalar(0.5);
      const curve = new THREE.CatmullRomCurve3(left.concat([top], right.reverse()));
      clothParts.push(new THREE.TubeGeometry(curve, seg(64), 0.03, 6, false));
    }

    // Zwei runde Mantelschließen an der Kragenöffnung
    [0, 1].forEach((u) => {
      const c = new THREE.Vector3();
      hoodPoint(u, 0.12, c);
      maskParts.push(place(new THREE.CylinderGeometry(0.075, 0.075, 0.035, seg(18)), c.x * 0.97, c.y, c.z + 0.02, Math.PI / 2));
      maskParts.push(place(new THREE.TorusGeometry(0.075, 0.016, 6, seg(18)), c.x * 0.97, c.y, c.z + 0.038));
    });

    // Querschnitts-Tabellen glatt interpolieren (Catmull-Rom je Spalte)
    function sampleRows(rows, f, out) {
      const x = f * (rows.length - 1);
      const i = Math.min(rows.length - 2, Math.floor(x));
      const t = x - i;
      const r0 = rows[Math.max(0, i - 1)];
      const r1 = rows[i];
      const r2 = rows[i + 1];
      const r3 = rows[Math.min(rows.length - 1, i + 2)];
      for (let k = 0; k < r1.length; k++) {
        const p0 = r0[k];
        const p1 = r1[k];
        const p2 = r2[k];
        const p3 = r3[k];
        out[k] = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
      }
      return out;
    }
    // Körperhülle mit abgerundet-kantigem Querschnitt (Superellipse), vorne und
    // hinten unterschiedlich tief: rows = [[y, halbe Breite, Tiefe vorn, Tiefe hinten], …]
    function shell(rows, nRows, nCols, power, extra) {
      const row = [];
      const ex = 2 / power;
      return gridSurface(seg(nRows), seg(nCols), (u, v, out) => {
        sampleRows(rows, v, row);
        const th = u * Math.PI * 2;
        const s = Math.sin(th);
        const c = Math.cos(th);
        const x = Math.sign(s) * Math.pow(Math.abs(s), ex) * row[1];
        const z = Math.sign(c) * Math.pow(Math.abs(c), ex) * (c > 0 ? row[2] : row[3]);
        out.set(x, row[0], z);
        if (extra) extra(out, th, v);
      });
    }

    // ---- Rumpf: grüne Tunika über breiter Brust (V-Form), schmale Taille ----
    clothParts.push(
      shell(
        [
          [3.82, 0.5, 0.3, 0.34], [4.15, 0.62, 0.34, 0.38], [4.72, 0.55, 0.31, 0.32], [5.15, 0.64, 0.36, 0.35],
          [5.55, 0.79, 0.42, 0.38], [5.9, 0.86, 0.46, 0.4], [6.12, 0.84, 0.42, 0.39], [6.32, 0.68, 0.34, 0.34],
          [6.5, 0.4, 0.26, 0.27], [6.62, 0.24, 0.2, 0.2], [6.78, 0.21, 0.18, 0.18],
        ],
        30,
        32,
        2.6,
        (out) => {
          // Brustmuskulatur unter dem Stoff andeuten
          if (out.z > 0) out.z += 0.05 * gauss(out.y - 5.85, 0.22) * gauss(Math.abs(out.x) - 0.33, 0.25);
        }
      )
    );
    // Tunika-Rock bis knapp über das Knie, unten weiter, mit Faltenwurf
    clothParts.push(
      shell(
        [[2.85, 0.95, 0.6, 0.68], [3.3, 0.88, 0.55, 0.62], [3.85, 0.79, 0.47, 0.52], [4.35, 0.68, 0.39, 0.42], [4.8, 0.58, 0.34, 0.35]],
        12,
        44,
        2.2,
        (out, th, v) => {
          const w = Math.pow(1 - v, 1.5);
          const d = (0.05 * Math.sin(th * 11 + 0.3) + 0.02 * Math.sin(th * 5 + 1)) * w;
          out.x += Math.sin(th) * d;
          out.z += Math.cos(th) * d;
          out.y += 0.015 * Math.sin(th * 11 + 0.3) * Math.pow(1 - v, 4);
        }
      )
    );

    // ---- Gürtel mit runder Schnalle (klassischer Doom-Look) ----
    darkParts.push(shell([[4.6, 0.6, 0.36, 0.37], [4.63, 0.635, 0.39, 0.4], [4.78, 0.635, 0.39, 0.4], [4.81, 0.6, 0.36, 0.37]], 4, 36, 2.4));
    maskParts.push(place(new THREE.CylinderGeometry(0.12, 0.12, 0.05, seg(24)), 0, 4.705, 0.4, Math.PI / 2));
    maskParts.push(place(new THREE.TorusGeometry(0.12, 0.02, 6, seg(24)), 0, 4.705, 0.425));

    // ---- Rüstung: Halskragen (dunkel, im Schatten der Kapuze), Schulterplatten,
    // Arme, Hände, Beine, Stiefel ----
    darkParts.push(place(lathe([[0.23, 6.86], [0.27, 6.76], [0.32, 6.62], [0.45, 6.52], [0.52, 6.46], [0.47, 6.42]], 28, 0.72), 0, 0, 0.02));
    [-1, 1].forEach((s) => {
      // Dreilagige Schulterplatte, nach außen geneigt
      armorParts.push(place(new THREE.SphereGeometry(0.48, seg(22), seg(10), 0, Math.PI * 2, 0, 1.4), s * 1.03, 6.18, -0.02, 0, 0, -s * 0.42, 1, 0.72, 0.95));
      armorParts.push(place(new THREE.SphereGeometry(0.5, seg(22), 3, 0, Math.PI * 2, 1.12, 0.36), s * 1.07, 6.06, -0.02, 0, 0, -s * 0.5, 1, 0.78, 0.98));
      armorParts.push(place(new THREE.SphereGeometry(0.52, seg(22), 3, 0, Math.PI * 2, 1.22, 0.34), s * 1.1, 5.95, -0.02, 0, 0, -s * 0.58, 1, 0.78, 1));
    });
    // Oberarm mit Deltamuskel und Bizeps, Unterarm als Panzerhandschuh
    const upperArm = [[0, 0], [0.03, 0.18], [0.12, 0.23], [0.35, 0.21], [0.38, 0.198], [0.41, 0.213], [0.55, 0.218], [0.8, 0.168], [0.94, 0.145], [1, 0]];
    const forearm = [[0, 0], [0.03, 0.15], [0.12, 0.17], [0.3, 0.19], [0.55, 0.16], [0.8, 0.125], [0.94, 0.112], [1, 0]];
    function arm(sh, el, wr) {
      armorParts.push(limb(sh, el, upperArm), limb(el, wr, forearm));
      // ausgestellte Stulpe des Handschuhs
      armorParts.push(limb(el.clone().lerp(wr, 0.3), el.clone().lerp(wr, 0.46), [[0, 0.225], [0.2, 0.218], [1, 0.17]]));
      // Ellbogenkachel
      armorParts.push(place(new THREE.SphereGeometry(0.13, seg(10), seg(6)), el.x, el.y, el.z - 0.06, 0, 0, 0, 1, 1, 0.8));
    }
    // Rechter Arm hängt locker herab, Faust geballt
    const rS = V(-1.04, 6.1, -0.02);
    const rE = V(-1.25, 5.0, -0.12);
    const rW = V(-1.38, 4.0, 0.14);
    arm(rS, rE, rW);
    armorParts.push(place(new THREE.SphereGeometry(0.5, seg(12), seg(8)), rW.x - 0.01, rW.y - 0.14, rW.z + 0.02, 0, 0, 0, 0.26, 0.34, 0.3));
    armorParts.push(place(new THREE.SphereGeometry(0.5, seg(8), seg(6)), rW.x + 0.06, rW.y - 0.1, rW.z + 0.12, 0, 0, 0, 0.09, 0.14, 0.09));
    // Linker Arm angewinkelt, die offene Hand trägt eine Energiekugel
    const lS = V(1.04, 6.1, -0.02);
    const lE = V(1.3, 5.05, -0.1);
    const lW = V(1.92, 5.56, 0.5);
    const lDir = new THREE.Vector3().subVectors(lW, lE).normalize();
    arm(lS, lE, lW);
    const palm = lW.clone().addScaledVector(lDir, 0.14);
    armorParts.push(place(new THREE.SphereGeometry(0.5, seg(12), seg(8)), palm.x, palm.y - 0.02, palm.z, 0, Math.atan2(lDir.x, lDir.z), 0, 0.28, 0.12, 0.36));
    const orbPos = palm.clone().add(V(0, 0.25, 0));
    // Beine: Panzerschenkel, Kniekacheln, Beinschienen, Stiefel mit Stulpe
    [-1, 1].forEach((s) => {
      const hip = V(s * 0.34, 3.95, 0);
      const knee = V(s * 0.38, 2.15, 0.04);
      const ankle = V(s * 0.41, 0.42, -0.03);
      armorParts.push(
        limb(hip, knee, [[0, 0], [0.03, 0.29], [0.15, 0.33], [0.45, 0.305], [0.48, 0.29], [0.51, 0.302], [0.8, 0.24], [0.95, 0.205], [1, 0]]),
        limb(knee, ankle, [[0, 0], [0.04, 0.195], [0.2, 0.232], [0.45, 0.218], [0.48, 0.205], [0.51, 0.215], [0.75, 0.165], [0.95, 0.14], [1, 0]]),
        limb(V(s * 0.41, 0.3, -0.03), V(s * 0.4, 0.88, -0.01), [[0, 0.16], [0.6, 0.178], [0.94, 0.222], [1, 0.205]])
      );
      armorParts.push(place(new THREE.SphereGeometry(0.18, seg(12), seg(8)), knee.x, knee.y + 0.03, knee.z + 0.11, 0, 0, 0, 1, 1.25, 0.55));
      // Stiefel: flache Sohle, schmal zulaufende Spitze
      const foot = new THREE.SphereGeometry(0.5, seg(16), seg(10));
      const p = foot.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i) * 0.31;
        let y = p.getY(i) * 0.26;
        const z = p.getZ(i) * 0.66;
        if (y < 0) y *= 0.35;
        x *= 1 - 0.35 * sstep(0.0, 0.33, z);
        y *= 1 - 0.35 * sstep(0.05, 0.33, z);
        p.setXYZ(i, x, y, z);
      }
      smoothNormals(foot);
      armorParts.push(place(foot, s * 0.42, 0.09, 0.12));
    });

    // ---- Umhang: von den Schultern bis zum Boden, nach unten ausgestellt,
    // mit Faltenwurf; der Schwung kommt aus dem Vertex-Shader ----
    const capeGeo = gridSurface(seg(26), seg(44), (u, v, out) => {
      const a = (u * 2 - 1) * (1.36 - 0.08 * v);
      const fold = (0.03 + 0.16 * v) * (0.6 * Math.sin(a * 6.5 + 0.7) + 0.4 * Math.sin(a * 12 + 1.9 + v * 2.5));
      const rx = 1.05 + 0.8 * Math.pow(v, 0.85) + fold;
      const rz = 0.5 + 0.7 * v + fold;
      out.set(Math.sin(a) * rx, 6.38 - v * 6.32 + 0.06 * v * v * Math.sin(a * 6.5 + 0.7), -Math.cos(a) * rz - 0.04 - 0.22 * v);
    });

    // Energiekern in der Hand
    glowParts.push(place(new THREE.SphereGeometry(0.15, seg(16), seg(12)), orbPos.x, orbPos.y, orbPos.z));

    const meshes = [
      new THREE.Mesh(merge(maskParts), maskMat),
      new THREE.Mesh(merge(armorParts), armorMat),
      new THREE.Mesh(merge(darkParts), darkMat),
      new THREE.Mesh(merge(clothParts), clothMat),
      new THREE.Mesh(capeGeo, capeMat),
      new THREE.Mesh(merge(glowParts), glowMat),
    ];
    meshes.forEach((m) => body.add(m));

    // ---- Dezente grüne Energie: Augenglühen, Kugel-Halo, schwache Aura ----
    const glowTex = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const g = cv.getContext("2d");
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.25, "rgba(255,255,255,0.55)");
      gr.addColorStop(0.6, "rgba(255,255,255,0.12)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    const glowSprite = (color, opacity, x, y, z, sx, sy) => {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color,
          opacity,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        })
      );
      sp.position.set(x, y, z);
      sp.scale.set(sx, sy, 1);
      body.add(sp);
      return sp;
    };
    const eyeGlows = [-1, 1].map((s) => glowSprite(0x5cff88, 0.95, HEAD.x + s * 0.13, HEAD.y + 0.025, HEAD.z + 0.44, 0.42, 0.19));
    const orbHalo = glowSprite(0x3dff7a, 0.7, orbPos.x, orbPos.y, orbPos.z, 0.85, 0.85);
    glowSprite(0x1fd45e, 0.1, 0, 4.6, -0.7, 5.2, 8.6);

    // Wenige, langsam aufsteigende Funken und ein feines Knistern um die Kugel —
    // Bewegung komplett im Shader (keine Pufferänderung pro Frame).
    const motes = LOW_TIER ? 10 : 18;
    const sparks = LOW_TIER ? 6 : 10;
    const seeds = new Float32Array((motes + sparks) * 4);
    for (let i = 0; i < motes + sparks; i++) {
      const spark = i >= motes;
      seeds[i * 4] = Math.random() * Math.PI * 2;
      seeds[i * 4 + 1] = spark ? -(0.16 + Math.random() * 0.14) : 0.9 + Math.random() * 1.3;
      seeds[i * 4 + 2] = spark ? 0.35 + Math.random() * 0.3 : 0.03 + Math.random() * 0.03;
      seeds[i * 4 + 3] = Math.random();
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((motes + sparks) * 3), 3));
    pGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    const pMat = new THREE.PointsMaterial({
      color: 0x7dffa2,
      map: glowTex,
      size: 0.75,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    pMat.onBeforeCompile = (shader) => {
      shader.uniforms.uDoomTime = doomTime;
      shader.uniforms.uOrb = { value: orbPos };
      shader.vertexShader =
        "uniform float uDoomTime;\nuniform vec3 uOrb;\nattribute vec4 aSeed;\nvarying float vFade;\n" +
        shader.vertexShader
          .replace(
            "#include <begin_vertex>",
            `float life = fract(aSeed.w + uDoomTime * aSeed.z);
            vec3 transformed;
            if (aSeed.y > 0.0) {
              float ang = aSeed.x + uDoomTime * 0.1;
              transformed = vec3(cos(ang) * aSeed.y, mix(0.5, 8.2, life), sin(ang) * aSeed.y * 0.5 - 0.3);
              vFade = sin(life * 3.14159) * 0.6;
            } else {
              float ang = aSeed.x + uDoomTime * 2.2;
              float rr = -aSeed.y * (0.7 + 0.5 * life);
              transformed = uOrb + vec3(cos(ang) * rr, (life - 0.35) * 0.45, sin(ang) * rr);
              vFade = 1.0 - life;
            }`
          )
          .replace("gl_PointSize = size;", "gl_PointSize = size * (aSeed.y > 0.0 ? 1.0 : 0.6);");
      shader.fragmentShader = "varying float vFade;\n" + shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.a *= vFade;");
    };
    const particles = new THREE.Points(pGeo, pMat);
    particles.frustumCulled = false;
    body.add(particles);

    // Grünes Augenlicht: kurze Reichweite, färbt nur Maske, Kapuzeninneres und Halskragen
    const eyeLight = new THREE.PointLight(0x39ff6a, 2.4, 2.4, 2);
    eyeLight.position.set(HEAD.x, HEAD.y + 0.02, HEAD.z + 0.6);
    body.add(eyeLight);

    const clickTargets = [];
    group.traverse((o) => {
      if (o.isMesh) {
        o.userData.id = "doomsday";
        clickTargets.push(o);
      }
    });

    // Langsames Pulsieren von Augen und Energiekugel (bei reduzierter Bewegung ruhig)
    function update(tm) {
      doomTime.value = tm;
      const eye = Math.sin(tm * 2.1);
      eyeLight.intensity = 2.4 + 0.5 * eye;
      eyeGlows[0].material.opacity = eyeGlows[1].material.opacity = 0.85 + 0.15 * eye;
      const orb = 0.5 + 0.5 * Math.sin(tm * 1.6);
      orbHalo.material.opacity = 0.55 + 0.3 * orb;
      orbHalo.scale.setScalar(0.78 + 0.16 * orb);
    }

    group.position.set(-26, 12, -8);
    group.rotation.y = 0.45;

    return { group, eyeLight, clickTargets, update };
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
      // Easter Egg: einen gesammelten Stein mehrfach antippen
      dot.addEventListener("click", () => {
        if (!collected.includes(s.id)) return;
        dot.classList.add("pulse");
        setTimeout(() => dot.classList.remove("pulse"), 400);
        registerStoneClick(s.id, s.name);
      });
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
        openOverlay(document.getElementById("snap-overlay"));
      }, 600);
    }
  }

  document.getElementById("snap-close").addEventListener("click", () => {
    closeOverlay(document.getElementById("snap-overlay"));
  });

  // ---------- Besuchte Universen (Erfolg "Multiverse Explorer") ----------
  // Läuft über das gemeinsame Fortschrittssystem (pro Profil gespeichert);
  // die frühere Einzelspeicherung marvelVisited_<profil> wird dort übernommen.
  function recordVisit(id) {
    if (window.MarvelProgress) MarvelProgress.recordVisit(id);
  }

  // ---------- Komposition der Szene ----------
  // Planeten werden nicht auf einer Ebene um den Stern verteilt, sondern an
  // echten 3D-Positionen, die aus einer Bildschirm-Komposition (wie in der
  // Referenz) berechnet werden: [x, y] in Bildschirmkoordinaten (-1..1),
  // Größe als Anteil der halben Bildhöhe, d = Abstand zur Kamera. Große Welten
  // liegen nah an der Kamera, kleinere weiter hinten. "wide" gilt für
  // Querformat, "tall" für Hochformat; dazwischen wird weich überblendet.
  const PLANET_LAYOUT = {
    xmen: { wide: [-0.72, 0.36, 0.225], tall: [-0.55, 0.5, 0.11], d: 36 },
    titan: { wide: [-0.34, 0.5, 0.13], tall: [0.1, 0.6, 0.07], d: 72 },
    holland: { wide: [0.12, 0.36, 0.1], tall: [0.55, 0.28, 0.06], d: 82 },
    thunderbolts: { wide: [0.46, 0.5, 0.11], tall: [0.62, 0.48, 0.07], d: 90 },
    doomsday: { wide: [0.76, 0.04, 0.29], tall: [0.6, -0.1, 0.13], d: 30 },
    garfield: { wide: [-0.33, -0.04, 0.175], tall: [-0.6, 0.02, 0.09], d: 44 },
    tobey: { wide: [0.27, -0.065, 0.11], tall: [0.06, -0.2, 0.065], d: 60 },
    fantasticfour: { wide: [0.15, -0.5, 0.24], tall: [0.06, -0.53, 0.11], d: 26 },
    avengers: { wide: [-0.76, -0.5, 0.2], tall: [-0.62, -0.38, 0.095], d: 32 },
  };
  // Drift entlang der Umlaufbahn (Anteil des Planetenradius) und Mindestabstand
  // der Planeten zum Bildschirmrand in Pixeln.
  const PLANET_DRIFT = 0.3;
  const EDGE_MARGIN_PX = 18;
  const FALLBACK_LAYOUT = { wide: [0, 0.68, 0.08], tall: [0, 0.66, 0.06], d: 95 };
  // Die Doom-Figur schwebt als entfernte, bedrohliche Silhouette im Hintergrund;
  // scale = [Querformat, Hochformat] (Modell ≈ 8 Einheiten hoch).
  const DOOM_LAYOUT = { wide: [-0.58, 0.765], tall: [-0.66, 0.248], d: 125, scale: [1.8, 1.5] };
  const STONE_LAYOUT = {
    space: { wide: [0.4, 0.22], tall: [0.3, 0.1], d: 64 },
    mind: { wide: [-0.14, 0.58], tall: [-0.25, 0.3], d: 58 },
    reality: { wide: [0.58, -0.36], tall: [0.35, -0.38], d: 40 },
    power: { wide: [-0.56, 0.02], tall: [-0.35, -0.15], d: 66 },
    time: { wide: [0.02, -0.12], tall: [-0.12, -0.05], d: 46 },
    soul: { wide: [0.3, 0.62], tall: [-0.3, 0.66], d: 75 },
  };

  const doomAnchor = new THREE.Vector3();
  const layoutCam = new THREE.PerspectiveCamera();
  const _lf = new THREE.Vector3();
  const _lr = new THREE.Vector3();
  const _lu = new THREE.Vector3();
  const _ld = new THREE.Vector3();

  // Ab 16:10 gilt die volle Querformat-Komposition; schmalere Querformate
  // (4:3, 5:4) mischen etwas vom Hochformat bei, damit nichts gedrängt wirkt.
  function layoutBlend(aspect) {
    const t = Math.min(1, Math.max(0, (aspect - 0.62) / (1.6 - 0.62)));
    return t * t * (3 - 2 * t);
  }

  // Wie weit ein Planet samt Atmosphäre, Mond bzw. Ring über seinen Radius
  // hinausreicht (horizontal / vertikal, in Planetenradien).
  function planetReach(look) {
    let rx = 1.14;
    let ry = 1.14;
    if (look.moon) {
      const tilt = look.moon.tilt || 0;
      rx = Math.max(rx, look.moon.dist * Math.cos(tilt) + look.moon.size);
      ry = Math.max(ry, look.moon.dist * Math.abs(Math.sin(tilt)) + look.moon.size);
    }
    if (look.ring) rx = Math.max(rx, look.ring.outer * Math.cos(look.ring.tilt[1]));
    return { x: rx, y: ry };
  }

  // Hält die Bildschirmposition so weit vom Rand weg, dass der Planet inklusive
  // Atmosphäre, Drift und Mond/Ring immer vollständig sichtbar bleibt.
  function fitInView(p, x, y, size, aspect, tanV, tanH) {
    const reach = planetReach(p.look);
    const margin = EDGE_MARGIN_PX / (window.innerHeight / 2);
    for (let i = 0; i < 3; i++) {
      // Perspektivische Streckung zum Bildrand hin
      const sec = Math.sqrt(1 + (x * tanH) * (x * tanH) + (y * tanV) * (y * tanV));
      const ex = size * (reach.x * sec + PLANET_DRIFT);
      const ey = size * (reach.y * sec + 0.1);
      const maxX = Math.max(0, (aspect - margin - ex) / aspect);
      const maxY = Math.max(0, 1 - margin - ey);
      x = Math.min(maxX, Math.max(-maxX, x));
      y = Math.min(maxY, Math.max(-maxY, y));
    }
    _fit.x = x;
    _fit.y = y;
    return _fit;
  }
  const _fit = { x: 0, y: 0 };

  // Tablets im Hochformat haben unten mehr Platz als Smartphones: dort wird die
  // Hochformat-Komposition etwas gestreckt und vergrößert.
  let tallStretch = 1;
  let tallGrow = 1;

  // Liefert die Weltposition zu einem Bildschirmpunkt in Abstand d und gibt
  // die Tiefe entlang der Blickrichtung zurück (für die Größenberechnung).
  function screenPos(entry, t) {
    _sp.x = entry.tall[0] + (entry.wide[0] - entry.tall[0]) * t;
    _sp.y = entry.tall[1] * tallStretch + (entry.wide[1] - entry.tall[1] * tallStretch) * t;
    return _sp;
  }
  const _sp = { x: 0, y: 0 };

  function placeAt(x, y, d, tanV, tanH, out) {
    _ld.copy(_lf).addScaledVector(_lr, x * tanH).addScaledVector(_lu, y * tanV).normalize();
    out.copy(DEFAULT_CAM_POS).addScaledVector(_ld, d);
    return d * _ld.dot(_lf);
  }

  function placeFromScreen(entry, t, tanV, tanH, out) {
    const s = screenPos(entry, t);
    return placeAt(s.x, s.y, entry.d, tanV, tanH, out);
  }

  function applyLayout(initial) {
    const aspect = window.innerWidth / window.innerHeight;
    const tanV = Math.tan((fovForAspect(aspect) * Math.PI) / 360);
    const tanH = tanV * aspect;
    const t = layoutBlend(aspect);
    const tabletBoost = Math.min(1, Math.max(0, (aspect - 0.5) / 0.3));
    tallStretch = 1 + 0.16 * tabletBoost;
    tallGrow = 1 + 0.22 * tabletBoost;
    layoutCam.position.copy(DEFAULT_CAM_POS);
    layoutCam.lookAt(DEFAULT_LOOK);
    _lf.set(0, 0, -1).applyQuaternion(layoutCam.quaternion);
    _lr.set(1, 0, 0).applyQuaternion(layoutCam.quaternion);
    _lu.set(0, 1, 0).applyQuaternion(layoutCam.quaternion);

    planetObjects.forEach((p) => {
      const entry = PLANET_LAYOUT[p.data.id] || FALLBACK_LAYOUT;
      const size = entry.tall[2] * tallGrow + (entry.wide[2] - entry.tall[2] * tallGrow) * t;
      const s = screenPos(entry, t);
      const f = fitInView(p, s.x, s.y, size, aspect, tanV, tanH);
      const depth = placeAt(f.x, f.y, entry.d, tanV, tanH, p.anchorTarget);
      p.radiusTarget = size * tanV * depth;
      // Drift entlang der Umlaufrichtung um den Stern
      p.tangent.set(p.anchorTarget.z, 0, -p.anchorTarget.x).normalize();
      p.driftAmp = p.radiusTarget * PLANET_DRIFT;
      if (initial) {
        p.anchor.copy(p.anchorTarget);
        p.radius = p.radiusTarget;
        p.group.position.copy(p.anchor);
        p.body.scale.setScalar(p.radius);
      }
    });

    placeFromScreen(DOOM_LAYOUT, t, tanV, tanH, doomAnchor);
    if (initial) doomFigure.group.position.copy(doomAnchor);
    // Im Hochformat etwas kleiner, damit die Figur zwischen die Planeten passt
    const doomScale = DOOM_LAYOUT.scale[1] * tallGrow + (DOOM_LAYOUT.scale[0] - DOOM_LAYOUT.scale[1] * tallGrow) * t;
    doomFigure.group.scale.setScalar(doomScale);

    infinityStones.stoneMeshes.forEach((m) => {
      const entry = STONE_LAYOUT[m.userData.stoneId];
      if (!entry) return;
      placeFromScreen(entry, t, tanV, tanH, m.userData.basePos);
      m.position.copy(m.userData.basePos);
    });
  }
  applyLayout(true);

  // ---------- HTML labels ----------
  // Beschriftung mit Universum-Symbol, seitlich über dem Planeten (wie in der Referenz).
  const LABEL_ICONS = {
    xmen: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    spider:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><ellipse cx="12" cy="10.2" rx="2.1" ry="2.4" fill="currentColor" stroke="none"/><ellipse cx="12" cy="15.4" rx="2.6" ry="3.4" fill="currentColor" stroke="none"/><path d="M10.2 9.4L6.5 5.5 4 7M13.8 9.4l3.7-3.9L20 7M10 12.4l-4.6-1.6L3 12.6M14 12.4l4.6-1.6 2.4 1.8M10 15.2l-4.4 1.8-2 3M14 15.2l4.4 1.8 2 3M10.6 17.6l-2.8 3M13.4 17.6l2.8 3"/></svg>',
    four: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.4 6.8L8.2 13.6h7.4M13.4 6.8v10.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    asterisk:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 4v16M5.1 8l13.8 8M18.9 8L5.1 16"/></svg>',
    avengers:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="currentColor" fill-rule="evenodd" d="M12 5.6 7 18.4h2.5l.9-2.4h2.4v2.4H15V5.6zm.8 3.8v4.4h-1.6z"/><path fill="currentColor" d="M15 10.4h3.4L15 13.6z"/></svg>',
    titan:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M7 7.5c0-2.2 2.2-3.8 5-3.8s5 1.6 5 3.8V13c0 3.4-2.2 6.5-5 7.3-2.8-.8-5-3.9-5-7.3z"/><path d="M9.2 12.4h1.8M13 12.4h1.8M9.6 16.4c.8.7 1.6 1 2.4 1s1.6-.3 2.4-1M10.4 14.6v3M13.6 14.6v3"/></svg>',
  };
  const LABEL_ICON_FOR = {
    xmen: "xmen",
    tobey: "spider",
    garfield: "spider",
    holland: "spider",
    fantasticfour: "four",
    thunderbolts: "asterisk",
    avengers: "avengers",
    doomsday: "avengers",
    titan: "titan",
  };

  const labelEls = {};
  planetObjects.forEach((p) => {
    const el = document.createElement("div");
    el.className = "planet-label" + (p.data.isDoomsday ? " doomsday" : "");
    el.style.setProperty("--dot-color", p.look.labelColor || p.look.atmo || p.data.accent);
    const icon = LABEL_ICONS[LABEL_ICON_FOR[p.data.id]] || "";
    el.innerHTML = `<div class="dot">${icon}</div><div class="name">${p.data.name}</div>`;
    el.dataset.id = p.data.id;
    el.addEventListener("click", () => selectUniverse(p.data.id));
    labelsLayer.appendChild(el);
    labelEls[p.data.id] = el;
  });

  // Label-Größen einmalig messen (statt jedes Frame das Layout abzufragen).
  const labelSize = {};
  function measureLabels() {
    planetObjects.forEach((p) => {
      const el = labelEls[p.data.id];
      const wasHidden = el.style.display === "none";
      if (wasHidden) el.style.display = "flex";
      labelSize[p.data.id] = { w: el.offsetWidth || 160, h: el.offsetHeight || 30 };
      if (wasHidden) el.style.display = "none";
    });
  }
  measureLabels();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureLabels);
  // Ändert sich die Label-Breite später (z.B. Webfont lädt nach), wird neu
  // gemessen, damit die Randbegrenzung immer mit der echten Breite rechnet.
  if (window.ResizeObserver) {
    const labelObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        if (el.offsetWidth) labelSize[el.dataset.id] = { w: el.offsetWidth, h: el.offsetHeight };
      });
    });
    Object.values(labelEls).forEach((el) => labelObserver.observe(el));
  }

  // ---------- Raycast click on planets ----------
  // Klick wird erst bei pointerup mit geringer Bewegung ausgelöst, damit ein
  // Dreh-Drag (OrbitControls) über einem Planeten nicht versehentlich als Klick zählt.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownAt = null;

  canvas.addEventListener("pointerdown", (e) => {
    pointerDownAt = { x: e.clientX, y: e.clientY };
  });

  // ---------- Hover & Mausbewegung ----------
  // Normalisierte Mausposition (-1..1) für die leichte Neigung der Planeten und
  // die Parallaxe von Nebel/Sternen.
  const mouseNorm = new THREE.Vector2(0, 0);
  let hoveredId = null;
  let hoverCheckQueued = false;

  canvas.addEventListener("pointermove", (e) => {
    mouseNorm.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseNorm.y = -(e.clientY / window.innerHeight) * 2 + 1;

    if (e.pointerType === "touch" || hoverCheckQueued) return;
    hoverCheckQueued = true;
    requestAnimationFrame(() => {
      hoverCheckQueued = false;
      pointer.set(mouseNorm.x, mouseNorm.y);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(planetObjects.map((p) => p.mesh));
      const id = hits.length ? hits[0].object.userData.id : null;
      if (id === hoveredId) return;
      hoveredId = id;
      canvas.style.cursor = id ? "pointer" : "";
      Object.keys(labelEls).forEach((key) => labelEls[key].classList.toggle("hovered", key === id));
    });
  });

  canvas.addEventListener("pointerleave", () => {
    hoveredId = null;
    canvas.style.cursor = "";
    Object.values(labelEls).forEach((el) => el.classList.remove("hovered"));
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
    playWarpFlash(p.data.accent);
    recordVisit(id);

    // Zielposition der Kamera: vor dem Planeten, leicht zur Sonnenseite
    // versetzt (damit die beleuchtete Hälfte zu sehen ist), dann sanft
    // dorthin fliegen (der aktive Planet bleibt währenddessen stehen).
    const wp = new THREE.Vector3();
    p.mesh.getWorldPosition(wp);
    const toCam = camera.position.clone().sub(wp).normalize();
    const toSun = SUN_POS.clone().sub(wp).normalize();
    const dir = toCam.multiplyScalar(0.6).add(toSun.multiplyScalar(0.4)).normalize();
    const toPos = wp.clone().addScaledVector(dir, p.radius * 3.6 + 5);
    toPos.y += p.radius * 0.5;
    lookTarget.copy(wp);
    camPosTarget.copy(toPos);
    startFlight(toPos, wp, 1.6);

    Object.values(labelEls).forEach((el) => el.classList.remove("active"));
    labelEls[id].classList.add("active");

    fillPanel(p.data);
    panel.classList.add("open");
    document.body.classList.add("panel-open");
  }

  function deselect() {
    activeId = null;
    document.body.classList.remove("panel-open");
    Object.values(labelEls).forEach((el) => el.classList.remove("active"));
    panel.classList.remove("open");
    camPosTarget.copy(DEFAULT_CAM_POS);
    lookTarget.copy(DEFAULT_LOOK);
    startFlight(DEFAULT_CAM_POS, lookTarget, 1.4);
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
      BLOCKING_OVERLAY_IDS.forEach((id) => closeOverlay(document.getElementById(id)));
      closeJarvis();
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

  // Bestimmt, welcher Kraft-Effekt zum Charakter passt (für das Poster-Portrait).
  function powerEffectFor(character) {
    const powers = (character.powers || []).join(" ").toLowerCase();
    if (/blitz|elektro/.test(powers)) return "lightning";
    if (/feuer|flamme/.test(powers)) return "fire";
    if (/netz|klettern/.test(powers)) return "web";
    if (/schild/.test(powers)) return "shield";
    if (/laser|strahl|repulsor|kosmisch|magie|zauber|mystis|energie/.test(powers)) return "energy";
    return "aura";
  }

  // Erkennt ikonische Ausrüstung anhand von Name/Rolle/Kräften, damit das
  // Poster-Portrait passendes Zubehör bekommt (Schild, Flügel, Rüstung).
  function gearFor(character) {
    const name = `${character.name} ${character.role} ${character.bio || ""}`.toLowerCase();
    const powers = (character.powers || []).join(" ").toLowerCase();
    const gear = [];
    if (/captain america/.test(name) || /vibranium-schild|wurfschild/.test(powers)) gear.push("shield");
    if (/falcon/.test(name)) gear.push("wings");
    if (/iron man|war machine|rescue|iron patriot/.test(name) || /rüstung|anzug|panzer|technolog/.test(powers)) gear.push("armor");
    return gear;
  }

  function gearSVG(accent, gear) {
    if (gear === "shield") {
      return `<g class="poster-gear poster-gear-shield">
        <circle cx="80" cy="100" r="16" fill="${accent}" stroke="#e9edf7" stroke-width="2.5"/>
        <circle cx="80" cy="100" r="11" fill="none" stroke="#e9edf7" stroke-width="2"/>
        <circle cx="80" cy="100" r="6" fill="#e9edf7"/>
        <path d="M80 92 L82.5 97.5 L88.5 98 L84 102 L85.5 108 L80 104.5 L74.5 108 L76 102 L71.5 98 L77.5 97.5 Z" fill="${accent}"/>
      </g>`;
    }
    if (gear === "wings") {
      return `<g class="poster-gear poster-gear-wings">
        <path class="wing wing-left" d="M26 86 Q2 80 0 56 Q18 64 30 82 Z" fill="${accent}" opacity="0.9"/>
        <path class="wing wing-right" d="M74 86 Q98 80 100 56 Q82 64 70 82 Z" fill="${accent}" opacity="0.9"/>
      </g>`;
    }
    if (gear === "armor") {
      return `<g class="poster-gear poster-gear-armor">
        <path d="M40 86 L44 116 M60 86 L56 116" stroke="#05060a" stroke-width="1.4" opacity="0.55"/>
        <path d="M30 94 L38 90 M70 94 L62 90" stroke="#05060a" stroke-width="1.4" opacity="0.4"/>
        <circle class="gear-core" cx="50" cy="94" r="8" fill="none" stroke="${accent}" stroke-width="1.6"/>
        <circle class="gear-core" cx="50" cy="94" r="4.2" fill="#f4f8ff"/>
      </g>`;
    }
    return "";
  }

  // Hellt (percent>0) oder dunkelt (percent<0) eine Hex-Farbe ab.
  function shadeColor(hex, percent) {
    const num = parseInt(hex.replace("#", ""), 16);
    const clamp = (v) => Math.max(0, Math.min(255, v));
    const r = clamp(((num >> 16) & 0xff) + Math.round(2.55 * percent));
    const g = clamp(((num >> 8) & 0xff) + Math.round(2.55 * percent));
    const b = clamp((num & 0xff) + Math.round(2.55 * percent));
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  // Rand-/Konturlicht-Farbe je nach Gesinnung — Bösewichte bekommen ein
  // unheilvolles rotes Licht, Antihelden ein violettes, alle anderen das
  // normale Universum-Akzentlicht.
  function rimColorFor(accent, alignment) {
    if (alignment === "Bösewicht") return "#ff3b4e";
    if (alignment === "Antiheld") return "#c98bff";
    return accent;
  }

  function powerEffectSVG(accent, effect) {
    if (effect === "lightning") {
      return `<g class="poster-effect poster-effect-lightning">
        <path class="bolt bolt-1" d="M22 8 L30 32 L20 34 L32 64" stroke="#cfe8ff" stroke-width="2.2" fill="none" stroke-linejoin="round"/>
        <path class="bolt bolt-2" d="M80 4 L72 28 L82 30 L70 58" stroke="#cfe8ff" stroke-width="1.8" fill="none" stroke-linejoin="round" opacity="0.85"/>
      </g>`;
    }
    if (effect === "fire") {
      return `<g class="poster-effect poster-effect-fire">
        <circle class="flame flame-1" cx="13" cy="90" r="4" fill="#ff8a3c"/>
        <circle class="flame flame-2" cx="19" cy="70" r="2.6" fill="#ffcf6b"/>
        <circle class="flame flame-3" cx="87" cy="88" r="3.6" fill="#ff6a2e"/>
        <circle class="flame flame-4" cx="81" cy="66" r="2.3" fill="#ffcf6b"/>
      </g>`;
    }
    if (effect === "web") {
      return `<g class="poster-effect poster-effect-web" stroke="${accent}" stroke-width="0.8" opacity="0.4">
        <path d="M100 0 L58 42 M100 0 L82 58 M100 0 L100 46 M100 22 L70 50" fill="none"/>
      </g>`;
    }
    if (effect === "shield") {
      return `<g class="poster-effect poster-effect-shield" fill="none">
        <path class="shield-arc shield-arc-1" d="M10 54 A44 44 0 0 1 28 16" stroke="${accent}" stroke-width="2.2"/>
        <path class="shield-arc shield-arc-2" d="M90 54 A44 44 0 0 0 72 16" stroke="${accent}" stroke-width="2.2"/>
      </g>`;
    }
    if (effect === "energy") {
      return `<g class="poster-effect poster-effect-energy">
        <circle class="orb orb-1" cx="16" cy="28" r="2.6" fill="${accent}"/>
        <circle class="orb orb-2" cx="86" cy="22" r="2.1" fill="${accent}"/>
        <circle class="orb orb-3" cx="10" cy="66" r="1.8" fill="${accent}"/>
        <circle class="ring" cx="50" cy="42" r="36" fill="none" stroke="${accent}" stroke-width="1"/>
      </g>`;
    }
    return `<g class="poster-effect poster-effect-aura">
      <circle class="spark spark-1" cx="14" cy="24" r="1.5" fill="${accent}"/>
      <circle class="spark spark-2" cx="88" cy="30" r="1.3" fill="${accent}"/>
    </g>`;
  }

  // Zeigt ein eigenes Bild (character.image, z.B. selbst erzeugte/legal
  // nutzbare Kunst aus assets/characters/), falls hinterlegt — sonst greift
  // automatisch das generierte Poster-Portrait als Fallback.
  function characterVisualHTML(character, universe, initials) {
    if (character.image) {
      return `<img src="${character.image}" alt="${character.name}" loading="lazy">`;
    }
    return characterActionFigureSVG(
      universe.accent,
      character.alignment,
      powerEffectFor(character),
      gearFor(character),
      initials
    );
  }

  // Stilisiertes Poster-Portrait statt echtem Schauspieler-Foto: eine
  // schattierte Büsten-Silhouette mit dramatischem Streiflicht (wie ein
  // Filmposter) und einem zur Kraft passenden Leucht-Effekt (Blitze, Feuer,
  // Energie-Orbs, Schild-Bögen, Netz-Linien oder sanfte Aura) im Hintergrund.
  function characterActionFigureSVG(accent, alignment, effect, gear, initials) {
    const rim = rimColorFor(accent, alignment);
    const silhouette = shadeColor(accent, -46);
    const wingsHTML = gear.includes("wings") ? gearSVG(accent, "wings") : "";
    const armorHTML = gear.includes("armor") ? gearSVG(accent, "armor") : "";
    const shieldHTML = gear.includes("shield") ? gearSVG(accent, "shield") : "";

    return `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg" class="poster-pose-${effect}">
      <defs>
        <radialGradient id="key" cx="32%" cy="14%" r="80%">
          <stop offset="0%" stop-color="${rim}" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="${rim}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="head-shade" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${shadeColor(silhouette, 18)}"/>
          <stop offset="100%" stop-color="${silhouette}"/>
        </linearGradient>
      </defs>
      <rect width="100" height="130" fill="#090a11"/>
      <rect width="100" height="130" fill="url(#key)"/>
      ${powerEffectSVG(accent, effect)}
      ${wingsHTML}
      <path d="M8 130 Q6 96 22 84 Q34 78 50 78 Q66 78 78 84 Q94 96 92 130 Z" fill="${silhouette}"/>
      ${armorHTML}
      <path d="M34 40 Q34 18 50 16 Q66 18 66 40 Q66 56 58 62 Q50 66 42 62 Q34 56 34 40 Z" fill="url(#head-shade)"/>
      <path class="poster-rim" d="M66 40 Q66 56 58 62 M78 84 Q94 96 92 130" stroke="${rim}" stroke-width="2" fill="none" opacity="0.85"/>
      ${shieldHTML}
      <g class="poster-badge">
        <rect x="6" y="106" width="30" height="18" rx="4" fill="rgba(6,7,14,0.72)" stroke="${accent}" stroke-width="1.5"/>
        <text x="21" y="118.5" text-anchor="middle" font-family="Orbitron, sans-serif" font-size="9" font-weight="700" fill="${accent}">${initials}</text>
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

  const ALIGN_COLORS = {
    Held: "#3fd0ff",
    Bösewicht: "#ff4d5e",
    Antiheld: "#c98bff",
    Zivilist: "#9aa3b5",
  };

  // Zähler, damit asynchron nachgeladene Bilder eines bereits geschlossenen bzw.
  // gewechselten Profils nicht mehr eingeblendet werden.
  let modalToken = 0;

  function escapeAttr(value) {
    return String(value == null ? "" : value).replace(/"/g, "&quot;");
  }

  // Lädt ein Bild erst nach dem Dekodieren ein, damit nie ein halbes Bild aufblitzt.
  function preload(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = reject;
      img.src = url;
    });
  }

  // ---------- Backdrop im Hero (dynamisch, mit Verlauf-Fallback) ----------
  function applyHeroBackdrop(el, character, accent) {
    el.classList.remove("loaded");
    el.classList.add("fallback");
    el.style.backgroundImage = "";
    const films = character.films || [];
    if (!films.length || !window.TMDB || !TMDB.enabled()) return;

    const token = modalToken;
    const film = films[0];
    TMDB.movieBackdrop(film.title, film.year)
      .then((url) => (url ? preload(url) : null))
      .then((url) => {
        if (!url || token !== modalToken) return;
        el.style.backgroundImage = `url("${url}")`;
        el.classList.remove("fallback");
        el.classList.add("loaded");
      })
      .catch(() => {
        /* Fallback-Verlauf bleibt bestehen */
      });
  }

  // ---------- Porträt: echtes Foto, sonst generierte Grafik ----------
  function applyPortrait(el, character, universe) {
    // Die generierte Grafik steht sofort da und bleibt als Fallback stehen,
    // falls kein Bild geladen werden kann.
    el.innerHTML = characterVisualHTML(character, universe, getInitials(character.name));
    if (character.image || !window.TMDB || !TMDB.enabled()) return;

    const token = modalToken;
    const credit = character.tmdbCredit;

    // Ist für die Figur ein Filmcredit hinterlegt, wird das Porträt über die
    // Besetzungsliste dieses Films geholt (genauer als die reine Personensuche).
    const lookup = credit
      ? TMDB.castPhoto(credit.film, credit.year, credit.character, credit.actor)
      : TMDB.personPhoto(character.role);

    lookup
      .then((url) => {
        if (!url && credit) {
          // Kein Treffer über die Besetzung → Personensuche als zweiter Versuch,
          // bevor die generierte Grafik stehen bleibt.
          console.warn(
            `[Porträt] Kein TMDB-Bild über die Besetzung von „${credit.film}“ für ${character.name} — versuche Personensuche.`
          );
          return TMDB.personPhoto(credit.actor || character.role);
        }
        return url;
      })
      .then((url) => (url ? preload(url) : null))
      .then((url) => {
        if (!url) {
          if (credit) {
            console.warn(`[Porträt] Für ${character.name} liefert TMDB kein Bild — generierte Grafik bleibt sichtbar.`);
          }
          return;
        }
        if (token !== modalToken) return;
        el.innerHTML = `<img src="${escapeAttr(url)}" alt="${escapeAttr(character.name)}">`;
      })
      .catch((err) => {
        // Generierte Grafik bleibt stehen; Ursache wird für die Fehlersuche gemeldet.
        // Betrifft sowohl fehlgeschlagene TMDB-Anfragen als auch nicht ladbare Bilder.
        if (credit) {
          console.warn(`[Porträt] Bild für ${character.name} konnte nicht geladen werden:`, err && err.type ? err.type : err);
        }
      });
  }

  // ---------- Filmposter (dynamisch nachgeladen, Kürzel als Fallback) ----------
  function loadPosterInto(posterEl, title, year) {
    if (!window.TMDB || !TMDB.enabled()) return;
    TMDB.moviePoster(title, year)
      .then((url) => (url ? preload(url) : null))
      .then((url) => {
        if (!url || !posterEl.isConnected) return;
        posterEl.innerHTML = `<img src="${escapeAttr(url)}" alt="${escapeAttr(title)}" loading="lazy">`;
      })
      .catch(() => {
        /* Kürzel bleibt sichtbar */
      });
  }

  // Ersetzt eine generierte Avatar-Grafik durch ein echtes Porträt, sobald verfügbar.
  function loadPersonInto(el, character) {
    if (!el || character.image || !window.TMDB || !TMDB.enabled()) {
      if (el && character.image) el.innerHTML = `<img src="${escapeAttr(character.image)}" alt="${escapeAttr(character.name)}">`;
      return;
    }
    TMDB.personPhoto(character.role)
      .then((url) => (url ? preload(url) : null))
      .then((url) => {
        if (!url || !el.isConnected) return;
        el.innerHTML = `<img src="${escapeAttr(url)}" alt="${escapeAttr(character.role)}" loading="lazy">`;
      })
      .catch(() => {
        /* generierte Grafik bleibt stehen */
      });
  }

  function renderFilmGrid(container, films, accent) {
    container.innerHTML = (films || [])
      .map(
        (f) => `
        <div class="film-card" style="--accent-color:${accent}">
          <div class="film-poster"><span class="film-abbrev">${posterAbbrev(f.title)}</span></div>
          <div class="film-meta">
            <span class="film-title">${f.title}</span>
            <span class="film-year">${f.year}</span>
            ${f.note ? `<span class="film-note">${f.note}</span>` : ""}
          </div>
        </div>`
      )
      .join("");

    Array.prototype.forEach.call(container.querySelectorAll(".film-card"), (card, i) => {
      const film = films[i];
      if (film) loadPosterInto(card.querySelector(".film-poster"), film.title, film.year);
    });
  }

  // ---------- Power-Stats mit Einblend-Animation ----------
  function animateNumber(el, target, duration, delay) {
    const start = performance.now() + (delay || 0);
    function step(now) {
      if (now < start) {
        requestAnimationFrame(step);
        return;
      }
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function renderPowerStats(container, character) {
    const stats = MarvelDerive.statsFor(character);
    container.innerHTML = stats
      .map(
        (s) => `
        <div class="stat-row">
          <span class="stat-name">${s.label}</span>
          <span class="stat-track"><span class="stat-fill" data-value="${s.value}"></span></span>
          <span class="stat-value" data-value="${s.value}">0</span>
        </div>`
      )
      .join("");

    requestAnimationFrame(() => {
      Array.prototype.forEach.call(container.querySelectorAll(".stat-fill"), (el, i) => {
        el.style.transitionDelay = i * 70 + "ms";
        el.style.width = el.dataset.value + "%";
      });
      Array.prototype.forEach.call(container.querySelectorAll(".stat-value"), (el, i) => {
        animateNumber(el, Number(el.dataset.value), 900, i * 70);
      });
    });
  }

  // ---------- Beziehungs-Chips ----------
  function aliasOf(name) {
    const parts = String(name).split(" / ");
    return parts.length > 1 ? parts[1].trim() : parts[0].trim();
  }

  function renderRelationChips(container, entries, color, emptyText) {
    if (!entries.length) {
      container.innerHTML = `<span class="relation-empty">${emptyText}</span>`;
      return;
    }
    container.innerHTML = entries
      .map(
        (e, i) => `
        <button class="relation-chip" type="button" data-idx="${i}" style="--chip-color:${color || e.universe.accent}">
          <span class="chip-dot"></span>
          <span class="chip-text">
            <span>${e.character.name}</span>
            <span class="chip-sub">${e.universe.name}</span>
          </span>
        </button>`
      )
      .join("");

    Array.prototype.forEach.call(container.querySelectorAll(".relation-chip"), (chip) => {
      chip.addEventListener("click", () => {
        const entry = entries[Number(chip.dataset.idx)];
        if (entry) openCharacterModal(entry.character, entry.universe);
      });
    });
  }

  function renderStaticChips(container, items, emptyText) {
    if (!items.length) {
      container.innerHTML = `<span class="relation-empty">${emptyText}</span>`;
      return;
    }
    container.innerHTML = items
      .map(
        (it) => `
        <span class="relation-chip static" style="--chip-color:${it.accent || "var(--accent)"}">
          <span class="chip-dot"></span>
          <span class="chip-text">
            <span>${it.label}</span>
            ${it.sub ? `<span class="chip-sub">${it.sub}</span>` : ""}
          </span>
        </span>`
      )
      .join("");
  }

  // ---------- Varianten-Karten (dieselbe Figur in anderen Universen) ----------
  function renderVariantCards(container, character, universe, variants) {
    // Die aktuelle Fassung steht als erste Karte mit dabei, damit der Vergleich
    // zwischen den Universen sofort sichtbar ist.
    const all = [{ character, universe, current: true }].concat(
      variants.map((v) => ({ character: v.character, universe: v.universe, current: false }))
    );

    if (all.length < 2) {
      container.classList.remove("variant-grid");
      container.innerHTML = `<span class="relation-empty">Keine weiteren Varianten dieser Figur bekannt.</span>`;
      return;
    }

    container.classList.add("variant-grid");
    container.innerHTML = all
      .map(
        (v, i) => `
        <button class="variant-card${v.current ? " current" : ""}" type="button" data-idx="${i}"
                style="--accent-color:${v.universe.accent}">
          <span class="variant-portrait" data-portrait="${i}"></span>
          <span class="variant-meta">
            <span class="variant-universe">${v.universe.name}</span>
            <span class="variant-role">${v.character.role}</span>
            <span class="variant-earth">${v.universe.earth || ""}</span>
          </span>
          ${v.current ? '<span class="variant-flag">AKTUELL</span>' : ""}
        </button>`
      )
      .join("");

    Array.prototype.forEach.call(container.querySelectorAll(".variant-card"), (card) => {
      const entry = all[Number(card.dataset.idx)];
      const portrait = card.querySelector(".variant-portrait");
      portrait.innerHTML = characterVisualHTML(entry.character, entry.universe, getInitials(entry.character.name));
      loadPersonInto(portrait, entry.character);
      card.addEventListener("click", () => {
        if (entry.current) return;
        openCharacterModal(entry.character, entry.universe);
      });
    });
  }

  // ---------- Interaktives Verbindungs-Netzwerk ----------
  const NET_COLORS = {
    ally: "#3fd0ff",
    enemy: "#ff4d5e",
    variant: "#c98bff",
    team: "#ffce54",
  };

  function renderNetwork(container, character, universe, relations) {
    const W = 340;
    const H = 250;
    const cx = W / 2;
    const cy = H / 2;

    const nodes = [];
    relations.allies.slice(0, 4).forEach((e) => nodes.push({ type: "ally", entry: e, label: aliasOf(e.character.name) }));
    relations.enemies.slice(0, 3).forEach((e) => nodes.push({ type: "enemy", entry: e, label: aliasOf(e.character.name) }));
    relations.variants.slice(0, 2).forEach((e) =>
      nodes.push({ type: "variant", entry: e, label: e.universe.name })
    );
    relations.teams.slice(0, 2).forEach((t) => nodes.push({ type: "team", entry: null, label: t }));

    if (!nodes.length) {
      container.innerHTML = `<div style="padding:18px"><span class="relation-empty">Keine Verbindungen hinterlegt.</span></div>`;
      return;
    }

    nodes.forEach((n, i) => {
      const angle = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
      n.x = cx + Math.cos(angle) * 126;
      n.y = cy + Math.sin(angle) * 88;
      n.color = NET_COLORS[n.type];
    });

    const links = nodes
      .map((n) => `<line class="net-link" x1="${cx}" y1="${cy}" x2="${n.x}" y2="${n.y}" stroke="${n.color}"/>`)
      .join("");

    const nodeEls = nodes
      .map((n, i) => {
        const short = n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label;
        return `
        <g class="net-node${n.entry ? "" : " center"}" data-idx="${i}">
          <circle cx="${n.x}" cy="${n.y}" r="9" fill="${n.color}" fill-opacity="0.22" stroke="${n.color}" stroke-width="1.4"/>
          <text class="net-label" x="${n.x}" y="${n.y + 21}">${short}</text>
        </g>`;
      })
      .join("");

    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img"
           aria-label="Verbindungen von ${escapeAttr(character.name)}">
        ${links}
        ${nodeEls}
        <g class="net-node center">
          <circle cx="${cx}" cy="${cy}" r="17" fill="${universe.accent}" fill-opacity="0.3"
                  stroke="${universe.accent}" stroke-width="2"/>
          <text class="net-label center-label" x="${cx}" y="${cy + 4}">${aliasOf(character.name).slice(0, 14)}</text>
        </g>
      </svg>
      <div class="net-legend">
        <span style="color:${NET_COLORS.ally}"><i></i>Verbündete</span>
        <span style="color:${NET_COLORS.enemy}"><i></i>Gegner</span>
        <span style="color:${NET_COLORS.variant}"><i></i>Varianten</span>
        <span style="color:${NET_COLORS.team}"><i></i>Teams</span>
      </div>`;

    Array.prototype.forEach.call(container.querySelectorAll(".net-node[data-idx]"), (g) => {
      const node = nodes[Number(g.dataset.idx)];
      if (!node || !node.entry) return;
      g.addEventListener("click", () => openCharacterModal(node.entry.character, node.entry.universe));
    });
  }

  // ---------- Parallax im Hero (einmalig verdrahtet) ----------
  function initHeroParallax() {
    const hero = document.getElementById("character-hero");
    const bg = document.getElementById("character-hero-bg");
    const portrait = document.getElementById("character-avatar-wrap");
    if (!hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    hero.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const rect = hero.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      bg.style.transform = `translate3d(${nx * -18}px, ${ny * -12}px, 0) scale(1.06)`;
      portrait.style.transform = `translate3d(${nx * 10}px, ${ny * 7}px, 0)`;
    });

    hero.addEventListener("pointerleave", () => {
      bg.style.transform = "";
      portrait.style.transform = "";
    });
  }
  initHeroParallax();

  function openCharacterModal(c, universe) {
    Sound.playClick();
    modalToken++;

    const accent = universe.accent;
    const modal = document.getElementById("character-modal");
    const card = document.getElementById("character-card");
    card.style.setProperty("--accent-color", accent);
    card.scrollTop = 0;

    // ---- Hero ----
    const nameParts = String(c.name).split(" / ");
    document.getElementById("character-name").textContent = nameParts[0].trim();
    const aliasEl = document.getElementById("character-alias");
    if (nameParts.length > 1) {
      aliasEl.textContent = nameParts.slice(1).join(" / ").trim();
      aliasEl.style.display = "";
    } else {
      aliasEl.textContent = "";
      aliasEl.style.display = "none";
    }
    document.getElementById("character-role").textContent = c.role;

    applyPortrait(document.getElementById("character-avatar"), c, universe);
    applyHeroBackdrop(document.getElementById("character-hero-bg"), c, accent);

    const alignBadge = document.getElementById("character-alignment");
    if (c.alignment) {
      alignBadge.textContent = c.alignment.toUpperCase();
      alignBadge.style.setProperty("--badge-color", ALIGN_COLORS[c.alignment] || accent);
      alignBadge.classList.remove("hidden");
    } else {
      alignBadge.classList.add("hidden");
    }

    const earthBadge = document.getElementById("character-earth");
    if (universe.earth) {
      earthBadge.textContent = universe.earth.toUpperCase();
      earthBadge.classList.remove("hidden");
    } else {
      earthBadge.classList.add("hidden");
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

    // ---- Inhalt ----
    document.getElementById("character-bio").textContent =
      c.bio || "Zu diesem Charakter liegt noch kein ausführlicher Steckbrief vor.";

    renderPowerStats(document.getElementById("character-powerstats"), c);
    document.getElementById("character-powers").innerHTML = powerChipsHTML(c.powers, accent);
    renderFilmGrid(document.getElementById("character-films"), c.films, accent);

    const relations = MarvelDerive.relationsFor(c, universe);
    renderNetwork(document.getElementById("character-network"), c, universe, relations);
    renderRelationChips(
      document.getElementById("character-allies"),
      relations.allies,
      NET_COLORS.ally,
      "Keine Verbündeten in diesem Universum hinterlegt."
    );
    renderRelationChips(
      document.getElementById("character-enemies"),
      relations.enemies,
      NET_COLORS.enemy,
      "Keine Gegner in diesem Universum hinterlegt."
    );
    renderStaticChips(
      document.getElementById("character-affiliations"),
      relations.affiliations.concat(relations.teams.map((t) => ({ label: t, sub: "", accent: NET_COLORS.team }))),
      "Keine Zugehörigkeiten hinterlegt."
    );
    renderVariantCards(document.getElementById("character-variants"), c, universe, relations.variants);

    // J.A.R.V.I.S. Character Lab (charlab.js): Button nur bei vorhandenem 3D-Modell
    if (window.MarvelCharLab) MarvelCharLab.bindProfile(c, universe);

    openOverlay(modal);
  }

  document.getElementById("character-close").addEventListener("click", () => {
    closeOverlay(document.getElementById("character-modal"));
  });

  // ---------- Film-Detailansicht ----------
  let filmToken = 0;

  // Gesehen / Watchlist / Sterne für genau diesen Film. Ohne Katalogeintrag
  // (oder ohne Profil, siehe watch.css) bleibt der Bereich verborgen; die
  // Live-Aktualisierung übernimmt Watch.sync über data-watch-id.
  function renderFilmWatchActions(title, year) {
    const box = document.getElementById("film-progress-actions");
    if (!box) return;
    const entry = Watch.P ? Watch.P.resolve(title, year, "movie") : null;
    if (!entry) {
      box.hidden = true;
      box.removeAttribute("data-watch-id");
      return;
    }
    if (!box.hasAttribute("data-watch-built")) {
      box.setAttribute("data-watch-built", "");
      box.classList.add("watch-modal-actions");
      box.innerHTML = Watch.modalActionsHTML();
      Watch.bind(box);
    }
    box.setAttribute("data-watch-id", entry.id);
    box.hidden = false;
    Watch.apply(box);
  }

  function openFilmModal(title, year, lookupYear) {
    Sound.playClick();
    filmToken++;
    const token = filmToken;
    // TMDB-Suche nutzt bevorzugt das echte Kinostart-Jahr (lookupYear); die
    // Anzeige des übergebenen "year" (z.B. Handlungsjahr in Marvel Travel)
    // bleibt davon unberührt.
    const tmdbYear = lookupYear || year;

    const info = MarvelDerive.filmInfo(title);
    const era = MarvelDerive.eraFor(title);
    const modal = document.getElementById("film-modal");
    const card = document.getElementById("film-card");

    // Universen, in denen dieser Film vorkommt (färbt auch den Akzent)
    const universes = UNIVERSES.filter((u) => (u.movies || []).some((m) => m.title === title));
    const accent = universes.length ? universes[0].accent : "#ff4d4d";
    card.style.setProperty("--accent-color", accent);
    card.scrollTop = 0;

    document.getElementById("film-title").textContent = title;
    document.getElementById("film-phase").textContent = info ? info.phase.toUpperCase() : "FILM";
    const yearBadge = document.getElementById("film-year");
    if (year) {
      yearBadge.textContent = String(year);
      yearBadge.classList.remove("hidden");
    } else {
      yearBadge.classList.add("hidden");
    }
    const eraBadge = document.getElementById("film-era");
    if (era) {
      eraBadge.textContent = era.era.toUpperCase();
      eraBadge.classList.remove("hidden");
    } else {
      eraBadge.classList.add("hidden");
    }
    document.getElementById("film-desc").textContent = info
      ? info.desc
      : "Zu diesem Film liegt noch keine Beschreibung vor.";

    // Poster + Backdrop dynamisch, Kürzel/Verlauf als Fallback
    const posterEl = document.getElementById("film-poster");
    posterEl.innerHTML = `<span class="film-abbrev">${posterAbbrev(title)}</span>`;
    loadPosterInto(posterEl, title, tmdbYear);

    const bg = document.getElementById("film-hero-bg");
    bg.classList.remove("loaded");
    bg.classList.add("fallback");
    bg.style.backgroundImage = "";
    if (window.TMDB && TMDB.enabled()) {
      TMDB.movieBackdrop(title, tmdbYear)
        .then((url) => (url ? preload(url) : null))
        .then((url) => {
          if (!url || token !== filmToken) return;
          bg.style.backgroundImage = `url("${url}")`;
          bg.classList.remove("fallback");
          bg.classList.add("loaded");
        })
        .catch(() => {});

      // Ausführlichere Beschreibung, falls die API eine liefert
      TMDB.movieDetails(title, tmdbYear)
        .then((details) => {
          if (!details || !details.overview || token !== filmToken) return;
          document.getElementById("film-desc").textContent = details.overview;
        })
        .catch(() => {});
    }

    // Universen als klickbare Chips
    const uniWrap = document.getElementById("film-universes");
    document.getElementById("film-universes-section").hidden = universes.length === 0;
    uniWrap.innerHTML = universes
      .map(
        (u, i) => `
        <button class="relation-chip" type="button" data-idx="${i}" style="--chip-color:${u.accent}">
          <span class="chip-dot"></span>
          <span class="chip-text">
            <span>${u.name}</span>
            <span class="chip-sub">${u.earth || ""}</span>
          </span>
        </button>`
      )
      .join("");
    Array.prototype.forEach.call(uniWrap.querySelectorAll(".relation-chip"), (chip) => {
      chip.addEventListener("click", () => {
        const u = universes[Number(chip.dataset.idx)];
        if (!u) return;
        closeOverlay(modal);
        closeOverlay(document.getElementById("travel-overlay"));
        selectUniverse(u.id);
      });
    });

    // Figuren, die in diesem Film auftreten
    const charWrap = document.getElementById("film-characters");
    const entries = [];
    UNIVERSES.forEach((u) => {
      (u.characters || []).forEach((c) => {
        if ((c.films || []).some((f) => f.title === title)) entries.push({ character: c, universe: u });
      });
    });
    document.getElementById("film-characters-section").hidden = entries.length === 0;
    renderRelationChips(charWrap, entries.slice(0, 16), null, "Keine Figuren hinterlegt.");

    renderFilmWatchActions(title, tmdbYear);

    openOverlay(modal);
  }

  document.getElementById("film-close").addEventListener("click", () => {
    closeOverlay(document.getElementById("film-modal"));
  });

  // ---------- Fill side panel ----------
  let panelToken = 0;

  // Großes Hintergrundbild des Panels: Backdrop des Hauptfilms, sonst Verlauf.
  function applyPanelHero(u, meta) {
    const bg = document.getElementById("panel-hero-bg");
    const logo = document.getElementById("panel-logo");
    bg.classList.remove("loaded");
    bg.classList.add("fallback");
    bg.style.backgroundImage = "";
    logo.hidden = true;
    logo.removeAttribute("src");

    if (!meta.mainFilm || !window.TMDB || !TMDB.enabled()) return;
    const token = panelToken;

    TMDB.movieBackdrop(meta.mainFilm.title, meta.mainFilm.year)
      .then((url) => (url ? preload(url) : null))
      .then((url) => {
        if (!url || token !== panelToken) return;
        bg.style.backgroundImage = `url("${url}")`;
        bg.classList.remove("fallback");
        bg.classList.add("loaded");
      })
      .catch(() => {});

    TMDB.movieLogo(meta.mainFilm.title, meta.mainFilm.year)
      .then((url) => (url ? preload(url) : null))
      .then((url) => {
        if (!url || token !== panelToken) return;
        logo.src = url;
        logo.alt = meta.mainFilm.title;
        logo.hidden = false;
      })
      .catch(() => {});
  }

  // Trailer-Vorschaubild (YouTube-Standbild, funktioniert ohne TMDB-Key).
  function applyTrailerThumb(u) {
    const thumb = document.getElementById("trailer-thumb");
    thumb.innerHTML = "";
    thumb.style.backgroundImage = "";
    if (!u.trailerYouTubeId || !window.TMDB) return;
    const url = TMDB.youtubeThumb(u.trailerYouTubeId);
    const token = panelToken;
    preload(url)
      .then(() => {
        if (token !== panelToken) return;
        thumb.style.backgroundImage = `url("${url}")`;
      })
      .catch(() => {
        // maxresdefault existiert nicht für jedes Video — auf hqdefault ausweichen
        const fallbackUrl = `https://img.youtube.com/vi/${u.trailerYouTubeId}/hqdefault.jpg`;
        preload(fallbackUrl)
          .then(() => {
            if (token === panelToken) thumb.style.backgroundImage = `url("${fallbackUrl}")`;
          })
          .catch(() => {});
      });
  }

  // ---------- Universum-Panel: persönlicher Fortschritt ----------
  // Zahlen aus MarvelProgress.universeStats (ein Film in mehreren Universen
  // zählt dort in jedem). Noch nicht erschienene Titel zählen nicht zur
  // Gesamtzahl und werden separat erwähnt; ohne verfügbare Titel gibt es
  // statt "0 / 0" einen Hinweis auf den Kinostart.
  let panelWatchUniverse = null;

  function renderPanelProgress(u, rebuild) {
    const section = document.getElementById("panel-progress");
    if (!section || !u) return;
    panelWatchUniverse = u;
    if (!Watch.P || !Watch.signedIn()) {
      section.hidden = true;
      return;
    }
    const P = Watch.P;
    const st = P.universeStats(u.id);
    const fresh = rebuild || section.getAttribute("data-universe") !== u.id;
    if (fresh) {
      section.setAttribute("data-universe", u.id);
      section.innerHTML = `
        <h3>Fortschritt</h3>
        <div class="pp-card">
          <div class="pp-head">
            <span class="pp-name"></span>
            <span class="pp-percent"></span>
          </div>
          <div class="pp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100">
            <span class="pp-fill"></span>
            <span class="pp-tick" style="left:25%"></span>
            <span class="pp-tick" style="left:50%"></span>
            <span class="pp-tick" style="left:75%"></span>
          </div>
          <div class="pp-rows"></div>
          <p class="pp-note"></p>
          <div class="pp-complete">★ Universum abgeschlossen</div>
        </div>`;
    }
    const card = section.querySelector(".pp-card");
    const total = st.all.total;
    const pending = total === 0;
    const pct = st.all.percent;

    card.style.setProperty("--pp-color", u.accent);
    card.classList.toggle("is-complete", st.complete);
    card.classList.toggle("is-pending", pending);
    for (let t = 0; t <= 4; t++) card.classList.toggle("tier-" + t, st.tier === t);

    section.querySelector(".pp-name").textContent = `${String(u.name).split(" — ")[0]} Universum`;
    section.querySelector(".pp-percent").innerHTML = pending ? "—" : `${pct}<small>%</small>`;

    const rows = [];
    if (st.movies.total > 0) {
      rows.push(`<span class="pp-row">Filme: <strong>${st.movies.watched} / ${st.movies.total}</strong> gesehen</span>`);
    } else if (st.movies.upcoming > 0) {
      rows.push('<span class="pp-row">Filme: <strong>noch nicht erschienen</strong></span>');
    }
    if (st.series.total > 0) {
      rows.push(`<span class="pp-row">Serien: <strong>${st.series.watched} / ${st.series.total}</strong> gesehen</span>`);
    } else if (st.series.upcoming > 0) {
      rows.push('<span class="pp-row">Serien: <strong>noch nicht erschienen</strong></span>');
    }
    section.querySelector(".pp-rows").innerHTML = rows.join("");

    const upcoming = st.entries.filter((e) => !P.isReleased(e));
    const dates = upcoming
      .map((e) => Watch.releaseLabel(e))
      .filter((d, i, arr) => d && arr.indexOf(d) === i);
    const dateText = dates.length === 1 ? `am ${dates[0]}` : "demnächst";
    let note = "";
    if (pending) {
      note = upcoming.length
        ? `Der Fortschritt startet mit dem Kinostart ${dateText} — bis dahin kannst du ${upcoming.length === 1 ? "den Film" : "die Titel"} auf die Watchlist setzen.`
        : "Für dieses Universum sind noch keine Titel verfügbar.";
    } else if (upcoming.length) {
      note = `${upcoming.length} Titel ${upcoming.length === 1 ? "erscheint" : "erscheinen"} ${dateText} und ${upcoming.length === 1 ? "zählt" : "zählen"} erst ab dann mit.`;
    }
    const noteEl = section.querySelector(".pp-note");
    noteEl.textContent = note;
    noteEl.hidden = !note;
    section.querySelector(".pp-complete").hidden = !st.complete;

    const bar = section.querySelector(".pp-bar");
    bar.setAttribute("aria-valuenow", String(pending ? 0 : pct));
    bar.setAttribute(
      "aria-valuetext",
      pending ? "Noch keine Titel erschienen" : `${st.all.watched} von ${total} Titeln gesehen (${pct} %)`
    );
    const fill = section.querySelector(".pp-fill");
    // Zielbreite am Element merken: eine Änderung während der Einblendung
    // gewinnt gegen den verzögerten ersten Wert.
    fill.setAttribute("data-target", (pending ? 0 : pct) + "%");
    if (fresh && !reduceMotion) {
      // Beim Öffnen des Planeten von 0 auf den aktuellen Stand auffüllen
      fill.style.width = "0%";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => (fill.style.width = fill.getAttribute("data-target")))
      );
    } else {
      fill.style.width = fill.getAttribute("data-target");
    }
    section.hidden = false;
  }

  if (Watch.P) {
    Watch.P.subscribe((ev) => {
      if (panelWatchUniverse && Watch.isRelevant(ev)) renderPanelProgress(panelWatchUniverse, false);
    });
  }

  function fillPanel(u) {
    panelToken++;
    const meta = MarvelDerive.universeMeta(u);

    document.getElementById("panel-eyebrow").textContent = u.eyebrow.toUpperCase();
    document.getElementById("panel-title").textContent = u.name;
    document.getElementById("panel-desc").textContent = u.desc;
    document.getElementById("panel").style.setProperty("--accent-color", u.accent);

    applyPanelHero(u, meta);
    applyTrailerThumb(u);

    // Veröffentlichung / Status / Timeline-Position
    const releaseText = u.releaseDate
      ? new Date(u.releaseDate).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" })
      : meta.firstYear
      ? meta.firstYear === meta.lastYear
        ? String(meta.firstYear)
        : `${meta.firstYear} – ${meta.lastYear}`
      : "—";
    document.getElementById("panel-release").textContent = releaseText;
    document.getElementById("panel-status").textContent = meta.status;
    // Bei vielen Epochen nur die ersten beiden nennen, damit die Kachel kompakt bleibt.
    const timelineParts = meta.eras.length ? meta.eras : meta.phases;
    document.getElementById("panel-timeline").textContent = timelineParts.length
      ? timelineParts.slice(0, 2).join(" · ") + (timelineParts.length > 2 ? ` +${timelineParts.length - 2}` : "")
      : "Eigene Zeitlinie";
    document.getElementById("panel-timeline").title = timelineParts.join(" · ");

    // Verwandte Filme (gleiche MCU-Phase, anderes Universum)
    const relatedFilmsSection = document.getElementById("panel-related-films-section");
    if (meta.relatedFilms.length) {
      relatedFilmsSection.hidden = false;
      renderFilmGrid(
        document.getElementById("panel-related-films"),
        meta.relatedFilms.map((f) => ({ title: f.title, year: "", note: f.phase })),
        u.accent
      );
    } else {
      relatedFilmsSection.hidden = true;
    }

    // Verwandte Universen (teilen sich Figuren)
    const relatedUniSection = document.getElementById("panel-related-universes-section");
    const relatedUniList = document.getElementById("panel-related-universes");
    if (meta.related.length) {
      relatedUniSection.hidden = false;
      relatedUniList.innerHTML = meta.related
        .map(
          (r, i) => `
          <button class="relation-chip" type="button" data-idx="${i}" style="--chip-color:${r.universe.accent}">
            <span class="chip-dot"></span>
            <span class="chip-text">
              <span>${r.universe.name}</span>
              <span class="chip-sub">${r.shared} gemeinsame ${r.shared === 1 ? "Figur" : "Figuren"}</span>
            </span>
          </button>`
        )
        .join("");
      Array.prototype.forEach.call(relatedUniList.querySelectorAll(".relation-chip"), (chip) => {
        chip.addEventListener("click", () => {
          const entry = meta.related[Number(chip.dataset.idx)];
          if (entry) selectUniverse(entry.universe.id);
        });
      });
    } else {
      relatedUniSection.hidden = true;
    }

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
      loadPersonInto(li.querySelector(".avatar"), c);
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
      const watchId = Watch.P ? Watch.P.idFor(m.title, m.year, "movie") : null;
      const li = document.createElement("li");
      li.style.setProperty("--accent-color", u.accent);
      li.className = "clickable" + (watchId ? " watch-row" : "");
      if (watchId) li.setAttribute("data-watch-id", watchId);
      li.innerHTML = `
        <span class="mposter">${posterAbbrev(m.title)}</span>
        <span class="mtitle">${m.title}</span>
        ${watchId ? '<span class="watch-soon-tag">Demnächst</span>' : ""}
        <span class="myear">${m.year}</span>
        ${watchId ? Watch.iconButtonHTML() : ""}`;
      loadPosterInto(li.querySelector(".mposter"), m.title, m.year);
      li.addEventListener("click", () => openFilmModal(m.title, m.year));
      if (watchId) {
        Watch.bind(li.querySelector(".watch-btn-icon"));
        Watch.apply(li);
      }
      movieList.appendChild(li);
    });

    // Serien dieses Universums (Zuordnung SERIES[].universes in data.js)
    const seriesSection = document.getElementById("panel-series-section");
    const seriesListEl = document.getElementById("panel-series");
    const uniSeries = Watch.P ? Watch.P.catalog().filter((e) => e.type === "series" && e.universes.indexOf(u.id) !== -1) : [];
    seriesListEl.innerHTML = "";
    seriesSection.hidden = uniSeries.length === 0;
    uniSeries.forEach((entry) => {
      const sr = (typeof SERIES !== "undefined" ? SERIES : []).find((x) => x.title === entry.title && x.year === entry.year);
      const li = document.createElement("li");
      li.style.setProperty("--accent-color", u.accent);
      li.className = "clickable watch-row";
      li.setAttribute("data-watch-id", entry.id);
      li.innerHTML = `
        <span class="mposter">${posterAbbrev(entry.title)}</span>
        <span class="mtitle">${entry.title}</span>
        <span class="watch-soon-tag">Demnächst</span>
        <span class="myear">${entry.year}</span>
        ${Watch.iconButtonHTML()}`;
      if (window.TMDB && TMDB.enabled()) {
        const posterEl = li.querySelector(".mposter");
        TMDB.seriesPoster(entry.title, entry.year)
          .then((url) => (url ? preload(url) : null))
          .then((url) => {
            if (url && posterEl.isConnected) posterEl.innerHTML = `<img src="${escapeAttr(url)}" alt="${escapeAttr(entry.title)}" loading="lazy">`;
          })
          .catch(() => {});
      }
      // Eine Serien-Detailansicht gibt es nicht — wie in Entdecken kurz informieren.
      li.addEventListener("click", () => showToast(`📺 ${entry.title} (${entry.year})${sr && sr.desc ? " — " + sr.desc : ""}`, 5200));
      Watch.bind(li.querySelector(".watch-btn-icon"));
      Watch.apply(li);
      seriesListEl.appendChild(li);
    });

    renderPanelProgress(u, true);
  }

  // ---------- Resize ----------
  window.addEventListener("resize", () => {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.fov = fovForAspect(aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyLayout(false);
    measureLabels();
  });

  // ---------- Animate ----------
  const clock = new THREE.Clock();
  const motion = reduceMotion ? 0 : 1;

  // Labels: neben/über dem Planeten, im sichtbaren Bereich gehalten und
  // gegenseitig ohne Überlappung (von oben nach unten aufgefächert).
  const _lp = new THREE.Vector3();
  const _lv = new THREE.Vector3();
  const labelItems = [];
  const labelDisks = [];
  const LABEL_EDGE = 12; // Mindestabstand der Labels zum Bildschirmrand (px)

  // Wie stark ein Label an Position x andere Planetenscheiben verdeckt (px).
  function labelCover(it, x) {
    let cover = 0;
    const top = it.y - it.h / 2;
    for (let i = 0; i < labelDisks.length; i++) {
      const d = labelDisks[i];
      if (d.el === it.el) continue;
      const nx = Math.max(x, Math.min(d.x, x + it.w));
      const ny = Math.max(top, Math.min(d.y, top + it.h));
      const pen = d.r - Math.hypot(nx - d.x, ny - d.y);
      if (pen > 0) cover += pen;
    }
    return cover;
  }

  function updateLabels() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const narrow = W < 641;
    const topLimit = narrow ? 128 : 100;
    const bottomLimit = H - (narrow ? 158 : 116);
    labelItems.length = 0;
    labelDisks.length = 0;

    planetObjects.forEach((p) => {
      const el = labelEls[p.data.id];
      p.mesh.getWorldPosition(_lp);
      _lv.copy(_lp).applyMatrix4(camera.matrixWorldInverse);
      if (_lv.z > -0.5) {
        if (el.style.display !== "none") el.style.display = "none";
        return;
      }
      _lp.project(camera);
      const sx = (_lp.x * 0.5 + 0.5) * W;
      const sy = (-_lp.y * 0.5 + 0.5) * H;
      const projR = ((p.radius * p.group.scale.x) / (-_lv.z * tanV)) * (H / 2);
      // Planeten ganz außerhalb des Bildes (z.B. beim Fokus auf eine Welt)
      // bekommen kein am Rand festgeklemmtes Label.
      const margin = projR * 0.35;
      if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) {
        if (el.style.display !== "none") el.style.display = "none";
        return;
      }
      const size = labelSize[p.data.id] || { w: 160, h: 30 };
      labelDisks.push({ el, x: sx, y: sy, r: projR });
      labelItems.push({ el, sx, a: Math.min(projR * 0.5, 46), x: 0, y: sy, w: size.w, h: size.h, flip: false });
    });

    // Standard: Symbol leicht links der Planetenmitte, Name nach rechts. Würde
    // der Name einen anderen Planeten verdecken, wird das Label gespiegelt
    // (Name nach links). Kleine Hysterese verhindert Flackern durch die Drift.
    const clampX = (x, w) => Math.min(Math.max(x, LABEL_EDGE), W - w - LABEL_EDGE);
    labelItems.forEach((it) => {
      const right = clampX(it.sx - it.a - 15, it.w);
      const left = clampX(it.sx + it.a + 15 - it.w, it.w);
      const coverRight = labelCover(it, right);
      const coverLeft = labelCover(it, left);
      const wasFlipped = it.el.classList.contains("flip");
      it.flip = wasFlipped ? coverLeft <= coverRight + 8 : coverLeft + 8 < coverRight;
      it.x = it.flip ? left : right;
      if (it.flip !== wasFlipped) it.el.classList.toggle("flip", it.flip);
    });

    labelItems.sort((a, b) => a.y - b.y);
    for (let i = 0; i < labelItems.length; i++) {
      const it = labelItems[i];
      it.y = Math.min(Math.max(it.y, topLimit + it.h / 2), bottomLimit - it.h / 2);
      for (let j = 0; j < i; j++) {
        const o = labelItems[j];
        const overlapX = it.x < o.x + o.w + 6 && it.x + it.w + 6 > o.x;
        const overlapY = Math.abs(it.y - o.y) < (it.h + o.h) / 2 + 4;
        if (overlapX && overlapY) it.y = o.y + (it.h + o.h) / 2 + 4;
      }
    }

    labelItems.forEach((it) => {
      if (it.el.style.display === "none") it.el.style.display = "flex";
      it.el.style.transform = `translate3d(${it.x.toFixed(1)}px, ${(it.y - it.h / 2).toFixed(1)}px, 0)`;
    });
  }

  // Kamera-Parallaxe: wird vor jedem OrbitControls-Update wieder abgezogen,
  // damit sie sich nicht aufsummiert.
  const appliedParallax = new THREE.Vector3();
  const parallaxSmooth = new THREE.Vector2();
  const _camRight = new THREE.Vector3();
  const _camUp = new THREE.Vector3();
  const _hoverPos = new THREE.Vector3();
  const _ringPos = new THREE.Vector3();

  // Leistungs-Automatik: läuft die Szene dauerhaft zu langsam, wird zuerst die
  // Pixeldichte gesenkt, danach werden teure Zusatzeffekte ausgeblendet.
  const perf = { frames: 0, time: 0, warmup: 90, settled: qualityParam === "high", reduced: false };
  function updatePerformance(rawDelta) {
    if (perf.settled) return;
    if (perf.warmup > 0) {
      perf.warmup--;
      return;
    }
    perf.frames++;
    perf.time += rawDelta;
    if (perf.frames < 120) return;
    const avg = perf.time / perf.frames;
    perf.frames = 0;
    perf.time = 0;
    if (avg > 0.028 && pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.5);
      renderer.setPixelRatio(pixelRatio);
      pixelRatioUniform.value = pixelRatio;
    } else if (avg > 0.034 && !perf.reduced) {
      perf.reduced = true;
      if (sunSystem.flare) sunSystem.flare.visible = false;
      farDust.visible = false;
      nebula.visible = false;
    } else {
      perf.settled = true;
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const rawDelta = clock.getDelta();
    // dt begrenzen, damit nach einer Pause (Tab im Hintergrund, offenes Overlay)
    // kein Sprung entsteht.
    const dt = Math.min(rawDelta, 0.05);
    const t = clock.elapsedTime;

    // Liegt eine Vollbild-Ebene über der Szene oder ist der Tab inaktiv, wird
    // weder gerechnet noch gezeichnet.
    if (renderPaused) return;

    // Bei "Bewegung reduzieren" stehen Drift, Pulsieren und Partikelströme still.
    const tm = t * motion;

    // Energiekern: Pulsieren, Corona, Partikel; das Licht auf den Planeten pulsiert leicht mit.
    const pulse = 1 + Math.sin(tm * 1.3) * 0.035 + Math.sin(tm * 3.1) * 0.015;
    sunUniforms.uTime.value = tm;
    sunUniforms.uPulse.value = pulse;
    sunSystem.update(tm, pulse);
    sharedPlanetUniforms.uSunColor.value.copy(SUN_COLOR).multiplyScalar(0.98 + (pulse - 1) * 0.6);
    planetLightPos.copy(SUN_POS).lerp(camera.position, PLANET_LIGHT_BLEND);
    coreLight.intensity = 9 * (0.96 + (pulse - 1) * 1.2);

    planetObjects.forEach((p) => {
      // Nach einer Größenänderung weich in die neue Komposition gleiten.
      const k = Math.min(1, dt * 2.5);
      p.anchor.lerp(p.anchorTarget, k);
      p.radius += (p.radiusTarget - p.radius) * k;
      p.body.scale.setScalar(p.radius);

      // Der fokussierte Planet bleibt während der Ansicht an Ort und Stelle stehen,
      // damit man frei um ihn herum drehen kann, ohne dass er wegdriftet.
      if (p.data.id !== activeId) {
        const drift = Math.sin(tm * p.driftSpeed + p.driftPhase) * p.driftAmp;
        p.group.position.copy(p.anchor).addScaledVector(p.tangent, drift);
        p.group.position.y += Math.sin(tm * 0.35 + p.bobPhase) * p.radius * 0.1;
      }

      // Langsame Eigenrotation; die Wolkendecke zieht etwas schneller mit.
      const spin = p.spinSpeed * dt * (reduceMotion ? 0.3 : 1);
      p.mesh.rotation.y += spin;
      if (p.clouds) p.clouds.rotation.y += spin * 1.35;
      if (p.moonOrbit) p.moonOrbit.rotation.y += p.moonSpeed * dt * motion;

      // Hover: Atmosphäre, Halo und Leuchten werden kräftiger, der Planet wächst leicht.
      const hoverTarget = p.data.id === hoveredId ? 1 : 0;
      p.hover += (hoverTarget - p.hover) * Math.min(1, dt * 7);
      p.group.scale.setScalar(1 + p.hover * 0.06);
      p.uniforms.uHover.value = p.hover;
      if (p.halo) p.halo.material.opacity = p.halo.userData.baseOpacity * (1 + p.hover * 0.9);
      if (p.look.emitAlways) p.uniforms.uEmitPulse.value = 0.9 + 0.1 * Math.sin(tm * 1.7 + p.bobPhase);

      // Leichte Reaktion auf die Mausbewegung (Neigung zum Zeiger hin).
      const tiltX = mouseNorm.y * 0.1 * motion;
      const tiltZ = -mouseNorm.x * 0.1 * motion;
      p.tilt.x += (tiltX - p.tilt.x) * Math.min(1, dt * 2.2);
      p.tilt.y += (tiltZ - p.tilt.y) * Math.min(1, dt * 2.2);
      p.group.rotation.x = p.tilt.x;
      p.group.rotation.z = p.tilt.y;

      if (p.ring) {
        p.mesh.getWorldPosition(_ringPos);
        p.ring.material.uniforms.uPlanetPos.value.copy(_ringPos);
        p.ring.material.uniforms.uPlanetRadius.value = p.radius * p.group.scale.x;
      }
    });
    // Fortschritts-Effekte weich nachführen (nur Welten mit aktiver Stufe).
    progressFx.update(dt, tm);

    // Parallaxe des letzten Frames zurücknehmen, bevor die Kamera weiterrechnet.
    camera.position.sub(appliedParallax);
    appliedParallax.set(0, 0, 0);

    // Cineastische Kamerafahrt beim Auswählen/Verlassen eines Universums.
    // Danach übernimmt OrbitControls wieder die freie Steuerung.
    if (flight) {
      flight.elapsed += dt;
      const progress = Math.min(1, flight.elapsed / flight.duration);
      const eased = easeInOutCubic(progress);
      camera.position.lerpVectors(flight.fromPos, flight.toPos, eased);
      camTarget.lerpVectors(flight.fromLook, flight.toLook, eased);
      if (progress >= 1) flight = null;
    }
    controls.target.copy(camTarget);
    controls.update();

    // Sehr subtile Kamera-Parallaxe zur Maus; ein überfahrener Planet zieht den
    // Blick minimal zu sich.
    let px = 0;
    let py = 0;
    if (!reduceMotion && !flight) {
      px = mouseNorm.x;
      py = mouseNorm.y;
      const hp = hoveredId ? planetObjects.find((pl) => pl.data.id === hoveredId) : null;
      if (hp) {
        hp.mesh.getWorldPosition(_hoverPos).project(camera);
        px += _hoverPos.x * 0.35;
        py += _hoverPos.y * 0.35;
      }
    }
    parallaxSmooth.x += (px - parallaxSmooth.x) * Math.min(1, dt * 1.6);
    parallaxSmooth.y += (py - parallaxSmooth.y) * Math.min(1, dt * 1.6);
    const parallaxAmp = Math.min(1, camera.position.distanceTo(controls.target) / 52) * 0.9;
    _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    appliedParallax
      .copy(_camRight)
      .multiplyScalar(parallaxSmooth.x * parallaxAmp)
      .addScaledVector(_camUp, parallaxSmooth.y * parallaxAmp * 0.6);
    camera.position.add(appliedParallax);

    // Hintergrundschichten wandern leicht gegen die Mausbewegung (Tiefe).
    nebula.position.x += (mouseNorm.x * -14 * motion - nebula.position.x) * Math.min(1, dt * 1.4);
    nebula.position.y += (mouseNorm.y * -9 * motion - nebula.position.y) * Math.min(1, dt * 1.4);
    nebula.rotation.z += dt * 0.004 * motion;

    starfield.rotation.y += dt * 0.004 * motion;
    starfieldNear.rotation.y += dt * 0.009 * motion;
    starfieldNear.rotation.x += (mouseNorm.y * 0.05 * motion - starfieldNear.rotation.x) * Math.min(1, dt * 1.2);
    starfieldBright.rotation.y += dt * 0.003 * motion;

    dust.rotation.y += dt * 0.02 * motion;
    dust.position.y = Math.sin(tm * 0.15) * 2;
    farDust.rotation.y += dt * 0.008 * motion;

    doomFigure.group.rotation.y = 0.45 + Math.sin(tm * 0.15) * 0.3;
    doomFigure.group.position.copy(doomAnchor);
    doomFigure.group.position.y += Math.sin(tm * 0.4) * 0.5;
    doomFigure.update(tm);

    infinityStones.stoneMeshes.forEach((m) => {
      m.rotation.x += dt * 0.6;
      m.rotation.y += dt * 0.8;
      m.position.y = m.userData.basePos.y + Math.sin(tm * 0.8 + m.userData.phase) * 0.6;
    });

    camera.updateMatrixWorld();
    updateLabels();
    renderer.render(scene, camera);
    updatePerformance(rawDelta);
  }

  // ---------- Brücke für eigenständige Module (progress-ui.js, groot.js) ----------
  // Stellt die vorhandenen Helfer bereit, statt sie dort ein zweites Mal zu bauen
  // (Overlays inkl. Render-Pause, Toasts, Sound, Poster, Navigation).
  window.MarvelHUD = {
    openOverlay,
    closeOverlay,
    showToast,
    playClick: () => Sound.playClick(),
    playCollect: () => Sound.playCollect(),
    selectUniverse,
    openFilmModal,
    posterAbbrev,
    loadPosterInto,
    escapeAttr,
    reduceMotion,
    currentUser: () => currentUser,
    avatarFor: (id) => (typeof AVATARS !== "undefined" ? AVATARS[id] : null),
  };

  animate();
})();
