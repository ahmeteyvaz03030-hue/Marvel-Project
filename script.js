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
    "favorites-overlay",
    "compare-overlay",
    "theories-overlay",
    "character-modal",
    "film-modal",
    "map-overlay",
    "snap-overlay",
    "secret-overlay",
  ];

  let renderPaused = false;

  function updateRenderPause() {
    const covered = BLOCKING_OVERLAY_IDS.some((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains("hidden");
    });
    renderPaused = covered || document.hidden;
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
      .replace(/[:*]/g, "")
      .split(" ")
      .filter((w) => w && POSTER_SKIP_WORDS.indexOf(w.toLowerCase()) === -1);
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

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

          const item = document.createElement("div");
          item.className =
            "mcu-item reveal " + (side === 0 ? "left" : "right") + (f.finale ? " finale" : "");
          item.style.setProperty("--item-color", color);
          item.innerHTML = `
            <span class="mcu-dot"></span>
            <div class="mcu-poster">${posterAbbrev(f.title)}</div>
            <div class="mcu-card">
              <span class="mcu-year">${f.year}${phase && mode !== "release" ? ` · ${phase}` : ""}</span>
              <span class="mcu-title">${f.title}</span>
              ${desc ? `<span class="mcu-desc">${desc}</span>` : ""}
              ${f.note ? `<span class="mcu-note">${f.note}</span>` : ""}
            </div>`;
          container.appendChild(item);

          // Echtes Poster nachladen, Kürzel bleibt als Fallback stehen.
          loadPosterInto(item.querySelector(".mcu-poster"), f.title, f.year);

          // Beim Überfahren erscheint das Szenenbild des Films dezent im Hintergrund.
          let backdropLoaded = false;
          item.addEventListener("pointerenter", () => {
            if (backdropLoaded || !window.TMDB || !TMDB.enabled()) return;
            backdropLoaded = true;
            TMDB.movieBackdrop(f.title, f.year)
              .then((url) => (url ? preload(url) : null))
              .then((url) => {
                if (url) item.style.setProperty("--item-backdrop", `url("${url}")`);
              })
              .catch(() => {});
          });

          item.addEventListener("click", () => openFilmModal(f.title, f.year));
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
      openOverlay(overlay);
      requestAnimationFrame(updateLineProgress);
      Sound.playClick();
    });
    closeBtn.addEventListener("click", () => closeOverlay(overlay));
  }
  initTravel();

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
        sub: `${sr.year} · ${sr.phase}`,
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  // Auf schmalen (mobilen) Geräten wird die Pixeldichte begrenzt: die Szene mit
  // Atmosphären und Partikeln ist füllratenintensiv, 1.5× bleibt scharf genug.
  const maxPixelRatio = window.innerWidth < 900 ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060c, 0.0035);

  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 2000);
  const DEFAULT_CAM_POS = new THREE.Vector3(0, 16, 58);
  camera.position.copy(DEFAULT_CAM_POS);

  let camTarget = new THREE.Vector3(0, 0, 0);
  let camPosTarget = DEFAULT_CAM_POS.clone();
  let lookTarget = new THREE.Vector3(0, 0, 0);

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
  // Bewusst dunkleres Umgebungslicht: dadurch entsteht eine deutlich sichtbare
  // Tag/Nacht-Grenze auf den Planeten (Schattenseite) statt flacher Ausleuchtung.
  scene.add(new THREE.AmbientLight(0x2a3050, 0.55));
  const coreLight = new THREE.PointLight(0xffb37a, 9, 400, 1.6);
  coreLight.position.set(0, 0, 0);
  scene.add(coreLight);
  const fillLight = new THREE.DirectionalLight(0x6a7bff, 0.35);
  fillLight.position.set(-40, 30, 20);
  scene.add(fillLight);

  // ---------- Starfield (zwei Ebenen + Farbvariation für Tiefe) ----------
  function createStarLayer(count, minR, maxR, size, opacity) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [
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
      const c = palette[Math.floor(Math.random() * palette.length)];
      const shade = 0.55 + Math.random() * 0.45;
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
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
      })
    );
    scene.add(points);
    return points;
  }

  const starfield = createStarLayer(4200, 220, 700, 1.1, 0.85);
  const starfieldNear = createStarLayer(600, 110, 220, 1.9, 0.6);

  // ---------- Nebel (weiche Farbschleier im Hintergrund) ----------
  function createNebula() {
    const group = new THREE.Group();
    const specs = [
      { color: "rgb(120,60,220)", size: 420, pos: [-170, 60, -230], opacity: 0.5 },
      { color: "rgb(220,60,90)", size: 340, pos: [210, -50, -210], opacity: 0.42 },
      { color: "rgb(50,120,230)", size: 400, pos: [40, 130, -290], opacity: 0.45 },
    ];
    // Große, additiv gemischte Schleier sind füllratenintensiv — auf schmalen
    // Geräten genügt eine Schicht weniger.
    const used = window.innerWidth < 900 ? specs.slice(0, 2) : specs;
    used.forEach((s) => {
      const mat = new THREE.SpriteMaterial({
        map: makeNebulaTexture(s.color),
        transparent: true,
        opacity: s.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(s.size, s.size, 1);
      sprite.position.set(s.pos[0], s.pos[1], s.pos[2]);
      group.add(sprite);
    });
    scene.add(group);
    return group;
  }
  const nebula = createNebula();

  // ---------- Staubpartikel (feiner Schwebstaub für Tiefe) ----------
  function createDust() {
    const count = 420;
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
        size: 0.42,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    scene.add(points);
    return points;
  }
  const dust = createDust();

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

  // ---------- Prozedurale Planetentexturen ----------
  // Deterministischer Zufall je Planet, damit die Oberfläche bei jedem Laden gleich aussieht.
  function seededRandom(seedOffset) {
    let seed = seedOffset * 999.7 + 13;
    return function rand() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  function makePlanetTexture(colorA, colorB, seedOffset) {
    const w = 1024;
    const h = 512;
    const cvs = document.createElement("canvas");
    cvs.width = w;
    cvs.height = h;
    const ctx = cvs.getContext("2d");
    const rand = seededRandom(seedOffset);

    // Grundverlauf (Äquator wärmer, Pole kühler)
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, colorA);
    grad.addColorStop(0.35, colorB);
    grad.addColorStop(0.65, colorB);
    grad.addColorStop(1, colorA);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Kontinent-/Wolkenflecken in mehreren Oktaven (fBm-artig) für Tiefe
    for (let octave = 0; octave < 4; octave++) {
      const count = 26 * (octave + 1);
      const maxR = 150 / (octave + 1);
      ctx.globalAlpha = 0.09 + octave * 0.015;
      for (let i = 0; i < count; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = 18 + rand() * maxR;
        const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
        const bright = rand() > 0.5;
        blob.addColorStop(0, bright ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)");
        blob.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = blob;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Breitengrad-Banding mit leichter Wellenbewegung (Gasriesen-Anmutung)
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 16; i++) {
      const y = rand() * h;
      const thickness = 3 + rand() * 16;
      ctx.fillStyle = rand() > 0.5 ? "#ffffff" : "#000000";
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) {
        ctx.lineTo(x, y + Math.sin(x * 0.012 + i) * 6);
      }
      for (let x = w; x >= 0; x -= 16) {
        ctx.lineTo(x, y + thickness + Math.sin(x * 0.012 + i) * 6);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Krater / Einschläge mit hellem Rand
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < 70; i++) {
      const x = rand() * w;
      const y = h * 0.12 + rand() * h * 0.76;
      const r = 3 + rand() * 13;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.82, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Polkappen
    ctx.globalAlpha = 1;
    ["top", "bottom"].forEach((pole) => {
      const capGrad = ctx.createLinearGradient(0, pole === "top" ? 0 : h, 0, pole === "top" ? h * 0.16 : h * 0.84);
      capGrad.addColorStop(0, "rgba(232,240,255,0.78)");
      capGrad.addColorStop(1, "rgba(232,240,255,0)");
      ctx.fillStyle = capGrad;
      ctx.fillRect(0, pole === "top" ? 0 : h * 0.84, w, h * 0.16);
    });

    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    return tex;
  }

  // Separate, halbtransparente Wolkenschicht, die sich eigenständig dreht.
  function makeCloudTexture(seedOffset) {
    const w = 1024;
    const h = 512;
    const cvs = document.createElement("canvas");
    cvs.width = w;
    cvs.height = h;
    const ctx = cvs.getContext("2d");
    const rand = seededRandom(seedOffset + 77);

    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 110; i++) {
      const x = rand() * w;
      const y = h * 0.1 + rand() * h * 0.8;
      const r = 20 + rand() * 90;
      const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
      blob.addColorStop(0, `rgba(255,255,255,${0.16 + rand() * 0.24})`);
      blob.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.35 + rand() * 0.3), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  // Weicher Farbnebel als Hintergrundtiefe.
  function makeNebulaTexture(color) {
    const size = 512;
    const cvs = document.createElement("canvas");
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext("2d");
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, color.replace("rgb", "rgba").replace(")", ",0.55)"));
    grad.addColorStop(0.45, color.replace("rgb", "rgba").replace(")", ",0.18)"));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cvs);
    tex.needsUpdate = true;
    return tex;
  }

  // Atmosphäre: Fresnel-Rand-Leuchten statt flacher Transparenz.
  function makeAtmosphereMaterial(accent, intensity) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(accent) },
        uIntensity: { value: intensity === undefined ? 1.0 : intensity },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float rim = pow(1.0 - abs(dot(vNormal, vViewDir)), 2.8);
          gl_FragColor = vec4(uColor, rim * uIntensity);
        }`,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
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
      // Dieselbe Textur als Bump-Map: erzeugt Relief und damit echte
      // Licht/Schatten-Kanten auf der Oberfläche.
      bumpMap: texture,
      bumpScale: u.radius * 0.06,
      roughness: 0.82,
      metalness: 0.12,
      emissive: new THREE.Color(u.accent),
      emissiveIntensity: 0.07,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.id = u.id;
    group.add(mesh);

    // Eigenständig rotierende Wolkenschicht (Lambert statt Standard: deutlich
    // günstiger und optisch für eine Wolkendecke ausreichend). Nur größere
    // Planeten bekommen sie — bei den kleinen wäre sie kaum sichtbar, würde
    // aber dieselbe Füllrate kosten.
    let clouds = null;
    if (u.radius >= 2.2) {
      clouds = new THREE.Mesh(
        new THREE.SphereGeometry(u.radius * 1.022, 32, 32),
        new THREE.MeshLambertMaterial({
          map: makeCloudTexture(idx + 1),
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        })
      );
      group.add(clouds);
    }

    // Atmosphäre: eine einzelne Fresnel-Hülle erzeugt den Randglanz —
    // günstiger als mehrere große, additiv gemischte Schalen.
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(u.radius * 1.14, 32, 32),
      makeAtmosphereMaterial(u.accent, 1.6)
    );
    group.add(atmosphere);

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
      clouds,
      angle: u.startAngle,
      orbitRadius: u.orbitRadius,
      orbitSpeed: u.orbitSpeed,
      yOffset: u.yOffset,
      spinSpeed: 0.15 + Math.random() * 0.1,
      hover: 0, // 0..1, steuert Vergrößerung beim Überfahren
      tilt: new THREE.Vector2(0, 0),
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

    // Zielposition der Kamera: leicht über und vor dem Planeten, dann sanft
    // dorthin fliegen (der aktive Planet bleibt währenddessen stehen).
    const wp = new THREE.Vector3();
    p.mesh.getWorldPosition(wp);
    const dir = wp.clone().normalize();
    const toPos = wp.clone().addScaledVector(dir, p.data.radius * 3.2 + 6);
    toPos.y += p.data.radius * 1.4 + 2;
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
    lookTarget.set(0, 0, 0);
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

    openOverlay(modal);
  }

  document.getElementById("character-close").addEventListener("click", () => {
    closeOverlay(document.getElementById("character-modal"));
  });

  // ---------- Film-Detailansicht ----------
  let filmToken = 0;

  function openFilmModal(title, year) {
    Sound.playClick();
    filmToken++;
    const token = filmToken;

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
    loadPosterInto(posterEl, title, year);

    const bg = document.getElementById("film-hero-bg");
    bg.classList.remove("loaded");
    bg.classList.add("fallback");
    bg.style.backgroundImage = "";
    if (window.TMDB && TMDB.enabled()) {
      TMDB.movieBackdrop(title, year)
        .then((url) => (url ? preload(url) : null))
        .then((url) => {
          if (!url || token !== filmToken) return;
          bg.style.backgroundImage = `url("${url}")`;
          bg.classList.remove("fallback");
          bg.classList.add("loaded");
        })
        .catch(() => {});

      // Ausführlichere Beschreibung, falls die API eine liefert
      TMDB.movieDetails(title, year)
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
      const li = document.createElement("li");
      li.style.setProperty("--accent-color", u.accent);
      li.className = "clickable";
      li.innerHTML = `
        <span class="mposter">${posterAbbrev(m.title)}</span>
        <span class="mtitle">${m.title}</span>
        <span class="myear">${m.year}</span>`;
      loadPosterInto(li.querySelector(".mposter"), m.title, m.year);
      li.addEventListener("click", () => openFilmModal(m.title, m.year));
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
    // dt begrenzen, damit nach einer Pause (Tab im Hintergrund, offenes Overlay)
    // kein Sprung entsteht.
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // Liegt eine Vollbild-Ebene über der Szene oder ist der Tab inaktiv, wird
    // weder gerechnet noch gezeichnet.
    if (renderPaused) return;

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

      // Langsame Eigenrotation; die Wolkendecke zieht etwas schneller mit.
      p.mesh.rotation.y += p.spinSpeed * dt;
      if (p.clouds) p.clouds.rotation.y += p.spinSpeed * dt * 1.35;

      // Hover: Planet wächst weich an und sein Leuchten nimmt zu.
      const hoverTarget = p.data.id === hoveredId ? 1 : 0;
      p.hover += (hoverTarget - p.hover) * Math.min(1, dt * 7);
      const scale = 1 + p.hover * 0.13;
      p.group.scale.setScalar(scale);
      p.mesh.material.emissiveIntensity = 0.07 + p.hover * 0.22;

      // Leichte Reaktion auf die Mausbewegung (Neigung zum Zeiger hin).
      const tiltX = mouseNorm.y * 0.13;
      const tiltZ = -mouseNorm.x * 0.13;
      p.tilt.x += (tiltX - p.tilt.x) * Math.min(1, dt * 2.2);
      p.tilt.y += (tiltZ - p.tilt.y) * Math.min(1, dt * 2.2);
      p.group.rotation.x = p.tilt.x;
      p.group.rotation.z = p.tilt.y;
    });

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

    // Parallaxe: Hintergrundschichten wandern leicht gegen die Mausbewegung.
    nebula.position.x += (mouseNorm.x * -14 - nebula.position.x) * Math.min(1, dt * 1.4);
    nebula.position.y += (mouseNorm.y * -9 - nebula.position.y) * Math.min(1, dt * 1.4);
    nebula.rotation.z += dt * 0.006;

    starfield.rotation.y += dt * 0.004;
    starfieldNear.rotation.y += dt * 0.009;
    starfieldNear.rotation.x += (mouseNorm.y * 0.05 - starfieldNear.rotation.x) * Math.min(1, dt * 1.2);

    dust.rotation.y += dt * 0.02;
    dust.position.y = Math.sin(t * 0.15) * 2;

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
