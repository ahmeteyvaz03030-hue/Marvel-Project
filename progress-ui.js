// ---------------------------------------------------------------------------
// Fortschritts-Oberfläche (HUD)
//
// - Multiverse-Progress-Widget oben rechts (#progress-widget). Die Infinity-
//   Steine (#stones-tracker, gefüllt von script.js) bleiben eine eigene kleine
//   HUD-Anzeige, deren Position hier am Widget ausgerichtet wird.
// - Ausführliche Statistik (#stats-overlay) und persönliches Profil-Dashboard
//   (#profile-dashboard) als Vollbild-Overlays.
// - J.A.R.V.I.S.-Benachrichtigungen im vorhandenen #toast-layer.
//
// Alle Zahlen kommen ausschließlich aus window.MarvelProgress; Overlays,
// Poster, Navigation und Sound laufen über die vorhandenen Helfer aus
// window.MarvelHUD (u.a. damit die 3D-Szene hinter Overlays pausiert).
// Mehrere Ereignisse einer Aktion (Änderung → Universum → Erfolg) kommen
// synchron hintereinander. Sie werden per Microtask gebündelt: pro Aktion
// wird nur einmal gerendert und nur die wichtigste Meldung gezeigt.
// ---------------------------------------------------------------------------
window.MarvelProgressUI = (function () {
  "use strict";

  const P = window.MarvelProgress;
  if (!P) {
    const noop = function () {};
    return { jarvisToast: noop, openStats: noop, closeStats: noop, openDashboard: noop, closeDashboard: noop, refresh: noop };
  }

  // MarvelHUD erst bei Bedarf lesen (script.js stellt es am Ende bereit).
  function hud() {
    return window.MarvelHUD || {};
  }

  const motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduceMotion() {
    return Boolean(motionQuery && motionQuery.matches);
  }

  // Höchstens eine "Fortschritt aktualisiert"-Meldung in diesem Abstand,
  // sonst würde jedes Abhaken in Entdecken eine Meldung auslösen.
  const PROGRESS_TOAST_INTERVAL = 8000;
  const TOAST_DURATION = { info: 4000, success: 4600, gold: 5200 };
  const MAX_TOASTS = 4;

  // ---------- Kleine Helfer ----------
  const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }

  // Deutsche Schreibweise mit geschütztem Leerzeichen vor dem Prozentzeichen
  function pct(n) {
    return n + " %";
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function formatDate(ts) {
    // Datensätze ohne gültigen Zeitstempel (z.B. übernommene Altdaten) tragen 1
    if (!ts || ts < 1e11) return "";
    const d = new Date(ts);
    return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + "." + d.getFullYear();
  }

  // "2026-12-18" → "18.12.2026" (ohne Zeitzonen-Umrechnung)
  function formatRelease(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? m[3] + "." + m[2] + "." + m[1] : "";
  }

  // 4,333… → "4,3" (deutsches Komma, eine Nachkommastelle)
  function formatAverage(avg) {
    if (avg == null || !isFinite(avg)) return null;
    return (Math.round(avg * 10 + 1e-9) / 10).toFixed(1).replace(".", ",");
  }

  function avatarFor(profile) {
    const a = profile && hud().avatarFor ? hud().avatarFor(profile) : null;
    return a || null;
  }

  function agentName(profile) {
    const a = avatarFor(profile);
    if (a && a.name) return a.name;
    return profile ? profile.charAt(0).toUpperCase() + profile.slice(1) : "Agent";
  }

  function upper(text) {
    return String(text || "").toLocaleUpperCase("de-DE");
  }

  function abbrev(title) {
    if (hud().posterAbbrev) return hud().posterAbbrev(title);
    return String(title || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase())
      .join("");
  }

  function playClick() {
    if (hud().playClick) hud().playClick();
  }

  function openLayer(el) {
    if (hud().openOverlay) hud().openOverlay(el);
    else el.classList.remove("hidden");
  }

  function closeLayer(el) {
    if (hud().closeOverlay) hud().closeOverlay(el);
    else el.classList.add("hidden");
  }

  function isOpen(el) {
    return Boolean(el && !el.classList.contains("hidden"));
  }

  function universeAccent(entry) {
    const list = typeof UNIVERSES !== "undefined" ? UNIVERSES : [];
    for (let i = 0; i < entry.universes.length; i++) {
      const u = list.find((x) => x.id === entry.universes[i]);
      if (u && u.accent) return u.accent;
    }
    return entry.type === "series" ? "#5abeff" : "#ff4d4d";
  }

  // Frühester Kinostart unter den noch nicht erschienenen Einträgen
  function nextRelease(entries) {
    let best = "";
    entries.forEach((e) => {
      if (P.isReleased(e) || !e.releaseDate) return;
      if (!best || e.releaseDate < best) best = e.releaseDate;
    });
    return best ? formatRelease(best) : "";
  }

  function upcomingEntries() {
    return P.catalog().filter((e) => !P.isReleased(e));
  }

  // Fortschritt je MCU-Phase: nur MCU-Filme, nur erschienene zählen
  function phaseStats() {
    const map = new Map();
    P.catalog().forEach((e) => {
      if (e.type !== "movie" || !e.mcu || !/^Phase \d+$/.test(e.phase)) return;
      let row = map.get(e.phase);
      if (!row) {
        row = { phase: e.phase, total: 0, watched: 0, upcoming: 0 };
        map.set(e.phase, row);
      }
      if (!P.isReleased(e)) {
        row.upcoming++;
        return;
      }
      row.total++;
      if (P.isWatched(e.id)) row.watched++;
    });
    return Array.from(map.values())
      .map((r) => Object.assign(r, { percent: P.percent(r.watched, r.total) }))
      .sort((a, b) => Number(a.phase.replace(/\D/g, "")) - Number(b.phase.replace(/\D/g, "")));
  }

  // Segmentierter Balken; --p wird beim Öffnen von 0 aus weich aufgefüllt
  function barHTML(percent, complete, extraClass) {
    return (
      '<span class="mp-bar' +
      (complete ? " is-complete" : "") +
      (extraClass ? " " + extraClass : "") +
      '" data-p="' +
      percent +
      '" style="--p:' +
      percent +
      '" aria-hidden="true"><i></i></span>'
    );
  }

  function ringHTML(prefix, percent, complete, centerHTML) {
    return (
      '<div class="mp-ring-wrap">' +
      '<svg class="mp-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' +
      "<defs>" +
      '<linearGradient id="' + prefix + '-ring-grad" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#a6ecff"/><stop offset="55%" stop-color="#5abeff"/><stop offset="100%" stop-color="#5a6bff"/>' +
      "</linearGradient>" +
      '<linearGradient id="' + prefix + '-ring-gold" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#fff0b8"/><stop offset="100%" stop-color="#f5b93a"/>' +
      "</linearGradient>" +
      "</defs>" +
      '<circle class="mp-ring-ticks" cx="60" cy="60" r="56" pathLength="120"/>' +
      '<circle class="mp-ring-track" cx="60" cy="60" r="47"/>' +
      '<circle class="mp-ring-fill" cx="60" cy="60" r="47" pathLength="100" transform="rotate(-90 60 60)" data-prefix="' + prefix + '"/>' +
      "</svg>" +
      '<div class="mp-ring-center">' + centerHTML + "</div>" +
      "</div>"
    );
  }

  function setRing(root, percent, complete) {
    const fill = root && root.querySelector(".mp-ring-fill");
    if (!fill) return;
    const prefix = fill.getAttribute("data-prefix");
    fill.setAttribute("stroke", "url(#" + prefix + "-ring-" + (complete ? "gold" : "grad") + ")");
    fill.dataset.p = String(percent);
    fill.style.strokeDashoffset = String(100 - percent);
    fill.classList.toggle("is-zero", percent <= 0);
    const svg = root.querySelector(".mp-ring");
    if (svg) svg.classList.toggle("is-complete", complete);
  }

  // Balken und Ringe beim Öffnen von 0 aus füllen (nur mit Bewegung)
  function animateFill(root) {
    if (reduceMotion() || !root) return;
    const bars = root.querySelectorAll(".mp-bar[data-p]");
    const rings = root.querySelectorAll(".mp-ring-fill[data-p]");
    bars.forEach((b) => b.style.setProperty("--p", "0"));
    rings.forEach((r) => (r.style.strokeDashoffset = "100"));
    void root.offsetWidth;
    requestAnimationFrame(() => {
      bars.forEach((b) => b.style.setProperty("--p", b.dataset.p));
      rings.forEach((r) => (r.style.strokeDashoffset = String(100 - Number(r.dataset.p))));
    });
  }

  // Fokus nach dem Schließen dorthin zurück, von wo aus geöffnet wurde.
  // (offsetParent taugt hier nicht: beim fixed positionierten Widget ist er
  // immer null.)
  function canFocus(el) {
    if (!el || !el.isConnected || typeof el.focus !== "function") return false;
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }

  function restoreFocus(el) {
    if (canFocus(el)) {
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        el.focus();
      }
    }
  }

  // =========================================================================
  // J.A.R.V.I.S.-Benachrichtigungen
  // =========================================================================
  let toastStack = null;

  // Eigene Live-Region im vorhandenen Toast-Layer: existiert schon vor der
  // ersten Meldung, damit Screenreader neue Meldungen zuverlässig vorlesen.
  function ensureToastStack() {
    if (toastStack && toastStack.isConnected) return toastStack;
    const layer = document.getElementById("toast-layer");
    if (!layer) return null;
    toastStack = document.createElement("div");
    toastStack.className = "jv-stack";
    toastStack.setAttribute("aria-live", "polite");
    toastStack.setAttribute("aria-relevant", "additions");
    layer.insertBefore(toastStack, layer.firstChild);
    return toastStack;
  }

  function dismissToast(el) {
    if (!el || el.classList.contains("leaving")) return;
    clearTimeout(el._jvTimer);
    el.classList.add("leaving");
    el.classList.remove("show");
    setTimeout(() => el.remove(), 450);
  }

  /**
   * Zeigt eine J.A.R.V.I.S.-Meldung (nicht blockierend, stapelbar).
   * opts: { tone: "info"|"success"|"gold", sub, tag, icon, duration }
   */
  function jarvisToast(message, opts) {
    const o = opts || {};
    const host = ensureToastStack();
    if (!host || !message) return null;
    const tone = o.tone === "gold" || o.tone === "success" ? o.tone : "info";
    const el = document.createElement("div");
    el.className = "jv-toast jv-" + tone;
    el.innerHTML =
      '<div class="jv-head">' +
      '<span class="jv-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
      '<span class="jv-name">J.A.R.V.I.S.</span>' +
      (o.tag ? '<span class="jv-tag">' + esc(o.tag) + "</span>" : "") +
      "</div>" +
      '<div class="jv-body">' +
      (o.icon ? '<span class="jv-icon" aria-hidden="true">' + esc(o.icon) + "</span>" : "") +
      '<div class="jv-text"><div class="jv-msg">' + esc(message) + "</div>" +
      (o.sub ? '<div class="jv-sub">' + esc(o.sub) + "</div>" : "") +
      "</div></div>";
    host.appendChild(el);

    const live = host.querySelectorAll(".jv-toast:not(.leaving)");
    if (live.length > MAX_TOASTS) dismissToast(live[0]);

    void el.offsetWidth; // Startzustand festschreiben, damit die Einblendung läuft
    el.classList.add("show");
    el._jvTimer = setTimeout(() => dismissToast(el), o.duration || TOAST_DURATION[tone]);
    return el;
  }

  // =========================================================================
  // Widget oben rechts
  // =========================================================================
  const widget = document.getElementById("progress-widget");
  const W = {};
  let widgetProfile = null;
  let widgetPercent = -1;
  let widgetWatched = -1;
  let countFrame = 0;
  let bumpTimer = 0;

  // ---------- Infinity-Steine: eigene kleine HUD-Anzeige am Widget ----------
  // Standard (und Smartphone quer): rechtsbündig direkt unter dem Widget.
  // Smartphone hochkant: darunter beginnen die Planeten-Beschriftungen (ab
  // 128 px) — dort links neben dem Widget, bündig mit dessen Oberkante.
  const stonesEl = document.getElementById("stones-tracker");
  const stonesLandscapeMQ = window.matchMedia("(max-height: 480px) and (orientation: landscape)");
  const stonesSideMQ = window.matchMedia("(max-width: 640px)");
  const STONES_GAP = 8;

  function placeStones() {
    if (!stonesEl || !widget) return;
    // offset*-Werte ignorieren die Einblend-Transformation des Widgets
    const w = widget.offsetWidth;
    if (!w) return;
    const viewW = document.documentElement.clientWidth || window.innerWidth;
    if (stonesSideMQ.matches && !stonesLandscapeMQ.matches) {
      stonesEl.style.top = Math.round(widget.offsetTop + 2) + "px";
      stonesEl.style.right = Math.round(viewW - widget.offsetLeft + STONES_GAP) + "px";
    } else {
      const gap = stonesLandscapeMQ.matches ? 3 : STONES_GAP;
      stonesEl.style.top = Math.round(widget.offsetTop + widget.offsetHeight + gap) + "px";
      stonesEl.style.right = Math.round(viewW - widget.offsetLeft - w) + "px";
    }
  }

  function initStones() {
    if (!stonesEl || !widget) return;
    placeStones();
    window.addEventListener("resize", placeStones);
    [stonesSideMQ, stonesLandscapeMQ].forEach((mq) => {
      if (mq.addEventListener) mq.addEventListener("change", placeStones);
      else if (mq.addListener) mq.addListener(placeStones);
    });
    // Größe des Widgets (Zahlen, Schrift) oder der Steine-Zeile ändert sich
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(placeStones);
      ro.observe(widget);
      ro.observe(stonesEl);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeStones);
  }

  function buildWidget() {
    if (!widget) return;
    widget.setAttribute("role", "button");
    widget.setAttribute("tabindex", "0");
    widget.setAttribute("aria-haspopup", "dialog");
    widget.setAttribute("aria-controls", "stats-overlay");
    widget.removeAttribute("title");

    const flash = document.createElement("span");
    flash.className = "pw-flash";
    flash.setAttribute("aria-hidden", "true");

    const main = document.createElement("div");
    main.className = "pw-main";
    main.setAttribute("aria-hidden", "true");
    // Prozentzahl steht neben dem Balken statt neben der Kopfzeile: so behält
    // der Titel auch mit der breiten Orbitron-Schrift die volle Zeilenbreite.
    main.innerHTML =
      '<span class="pw-wave"><i></i><i></i><i></i><i></i></span>' +
      '<span class="pw-title"><span class="pw-title-long">MULTIVERSE PROGRESS</span><span class="pw-title-short">MULTIVERSE</span></span>' +
      '<span class="pw-more">›</span>' +
      '<span class="pw-bar-wrap"><span class="pw-glow"></span><span class="pw-bar"><i class="pw-fill"></i></span></span>' +
      '<span class="pw-pct"><b class="pw-pct-num">0</b><small>%</small></span>' +
      '<span class="pw-counts">' +
      '<span class="pw-count"><span class="pw-ico">🎬</span><b class="pw-movies">0 / 0</b><span class="pw-unit">&nbsp;Filme</span></span>' +
      '<span class="pw-count"><span class="pw-ico">📺</span><b class="pw-series">0 / 0</b><span class="pw-unit">&nbsp;Serien</span></span>' +
      "</span>";

    widget.insertBefore(main, widget.firstChild);
    widget.insertBefore(flash, main);

    W.pct = main.querySelector(".pw-pct-num");
    W.movies = main.querySelector(".pw-movies");
    W.series = main.querySelector(".pw-series");

    widget.addEventListener("click", () => {
      playClick();
      openStats(widget);
    });
    widget.addEventListener("keydown", (e) => {
      if (e.target !== widget) return;
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        openStats(widget);
      }
    });
  }

  function countTo(from, to) {
    cancelAnimationFrame(countFrame);
    if (!W.pct) return;
    if (from === to || reduceMotion()) {
      W.pct.textContent = String(to);
      return;
    }
    const start = performance.now();
    const duration = 750;
    const step = (now) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      W.pct.textContent = String(Math.round(from + (to - from) * eased));
      if (k < 1) countFrame = requestAnimationFrame(step);
    };
    countFrame = requestAnimationFrame(step);
  }

  function bumpWidget() {
    if (reduceMotion() || !widget) return;
    widget.classList.remove("is-bump");
    void widget.offsetWidth;
    widget.classList.add("is-bump");
    clearTimeout(bumpTimer);
    bumpTimer = setTimeout(() => widget.classList.remove("is-bump"), 1400);
  }

  function renderWidget(s) {
    if (!widget || !W.pct) return;
    const profile = P.profile();
    if (stonesEl) stonesEl.classList.toggle("stones-off", !profile || !s);
    if (!profile || !s) {
      widget.classList.add("hidden");
      widgetProfile = null;
      widgetPercent = -1;
      widgetWatched = -1;
      return;
    }
    const all = s.all;
    const switched = profile !== widgetProfile;
    widget.classList.remove("hidden");
    widget.style.setProperty("--p", String(all.percent));
    widget.classList.toggle("is-complete", all.total > 0 && all.watched >= all.total);
    widget.classList.toggle("is-empty", all.watched === 0);
    W.movies.textContent = s.movies.watched + " / " + s.movies.total;
    W.series.textContent = s.series.watched + " / " + s.series.total;
    widget.dataset.percent = String(all.percent);
    widget.setAttribute(
      "aria-label",
      "Multiverse Progress: " +
        all.percent +
        " Prozent. " +
        s.movies.watched +
        " von " +
        s.movies.total +
        " Filmen und " +
        s.series.watched +
        " von " +
        s.series.total +
        " Serien gesehen. Ausführliche Statistik öffnen"
    );

    countTo(switched || widgetPercent < 0 ? all.percent : widgetPercent, all.percent);
    if (!switched && widgetWatched >= 0 && all.watched > widgetWatched) bumpWidget();

    widgetProfile = profile;
    widgetPercent = all.percent;
    widgetWatched = all.watched;
  }

  // =========================================================================
  // Ausführliche Statistik
  // =========================================================================
  const statsEl = document.getElementById("stats-overlay");
  let statsOpener = null;

  function buildStats() {
    if (!statsEl) return;
    statsEl.setAttribute("role", "dialog");
    statsEl.setAttribute("aria-modal", "true");
    statsEl.setAttribute("aria-labelledby", "ps-title");
    statsEl.innerHTML =
      '<div class="ps-panel mp-panel">' +
      '<button type="button" class="mp-close" data-action="close" aria-label="Statistik schließen">✕</button>' +
      '<div class="panel-eyebrow mp-eyebrow">J.A.R.V.I.S. · MULTIVERSE-ANALYSE</div>' +
      '<h2 id="ps-title" class="mp-title">Multiverse Progress</h2>' +
      '<p class="travel-sub mp-sub" data-slot="sub"></p>' +
      '<div data-slot="body"></div>' +
      "</div>";

    statsEl.addEventListener("click", (e) => {
      if (e.target === statsEl) {
        closeStats();
        return;
      }
      const t = e.target.closest ? e.target.closest("[data-action], [data-universe]") : null;
      if (!t || !statsEl.contains(t)) return;
      if (t.dataset.universe) {
        const id = t.dataset.universe;
        // Fokus nicht zurück auf das Widget: es ist bei offenem Panel ausgeblendet
        closeStats(false);
        if (hud().selectUniverse) hud().selectUniverse(id);
        return;
      }
      if (t.dataset.action === "close") {
        playClick();
        closeStats();
      } else if (t.dataset.action === "dashboard") {
        const opener = statsOpener;
        closeStats(false);
        openDashboard(opener);
      }
    });
  }

  function typeRowHTML(icon, label, c) {
    const complete = c.total > 0 && c.watched >= c.total;
    return (
      '<div class="ps-type">' +
      '<span class="ps-type-label"><span aria-hidden="true">' + icon + "</span> " + esc(label) + "</span>" +
      '<span class="ps-type-nums"><b>' + c.watched + " / " + c.total + "</b><small>" + pct(c.percent) + "</small></span>" +
      barHTML(c.percent, complete) +
      "</div>"
    );
  }

  function universeCardHTML(u) {
    const soon = u.all.total === 0;
    const release = soon ? nextRelease(u.entries) : "";
    const label = soon
      ? u.name + ": erscheint bald" + (release ? ", Kinostart " + release : "") + ". Zum Planeten fliegen"
      : u.name + ": " + u.all.watched + " von " + u.all.total + " Titeln gesehen, " + u.all.percent + " Prozent. Zum Planeten fliegen";
    let inner =
      '<span class="ps-u-top"><span class="ps-u-dot" aria-hidden="true"></span><span class="ps-u-name">' +
      esc(u.name) +
      "</span>" +
      (u.complete ? '<span class="ps-u-badge">✓ 100&nbsp;%</span>' : '<span class="ps-u-go" aria-hidden="true">›</span>') +
      "</span>";
    if (soon) {
      inner +=
        '<span class="ps-u-soon">Erscheint bald' +
        (release ? ' · <span class="ps-u-date">Kinostart ' + esc(release) + "</span>" : "") +
        "</span>" +
        '<span class="mp-bar is-soon" aria-hidden="true"><i></i></span>';
    } else {
      inner +=
        '<span class="ps-u-nums"><b>' +
        u.all.watched +
        " / " +
        u.all.total +
        "</b><span>" +
        (u.all.upcoming ? '<small class="ps-u-note">+' + u.all.upcoming + " demnächst</small> " : "") +
        pct(u.all.percent) +
        "</span></span>" +
        barHTML(u.all.percent, u.complete);
    }
    return (
      '<button type="button" class="ps-universe' +
      (u.complete ? " is-complete" : "") +
      (soon ? " is-soon" : "") +
      '" data-universe="' +
      esc(u.id) +
      '" style="--u-accent:' +
      esc(u.accent) +
      '" aria-label="' +
      esc(label) +
      '">' +
      inner +
      "</button>"
    );
  }

  function phaseRowHTML(r) {
    const complete = r.total > 0 && r.watched >= r.total;
    return (
      '<div class="ps-phase' + (complete ? " is-complete" : "") + '">' +
      '<span class="ps-phase-name">' + esc(r.phase) +
      (r.upcoming ? '<small>+' + r.upcoming + " demnächst</small>" : "") +
      "</span>" +
      barHTML(r.percent, complete) +
      '<span class="ps-phase-nums">' + r.watched + " / " + r.total + "</span>" +
      '<span class="ps-phase-pct">' + pct(r.percent) + "</span>" +
      "</div>"
    );
  }

  function renderStats(s, animate) {
    if (!statsEl || !s) return;
    const profile = P.profile();
    const all = s.all;
    const complete = all.total > 0 && all.watched >= all.total;
    const upcoming = upcomingEntries();

    statsEl.querySelector('[data-slot="sub"]').textContent =
      "Persönlicher Fortschritt von Agent " +
      agentName(profile) +
      " — gezählt werden alle bereits erschienenen Filme und Serien (aktuell " +
      all.total +
      " Titel).";

    let soonHTML = "";
    if (upcoming.length) {
      soonHTML =
        '<div class="ps-soon"><span class="ps-soon-label">DEMNÄCHST</span><ul>' +
        upcoming
          .map((e) => {
            const date = formatRelease(e.releaseDate);
            return (
              "<li><strong>" + esc(e.title) + "</strong>" +
              (date ? " · Kinostart " + esc(date) : " · " + e.year) +
              (P.inWatchlist(e.id) ? ' <span class="ps-soon-watch">auf deiner Watchlist</span>' : "") +
              "</li>"
            );
          })
          .join("") +
        "</ul><p>Noch nicht erschienen — zählt erst ab Erscheinen zur Gesamtzahl.</p></div>";
    }

    const phases = phaseStats();
    const body =
      '<section class="ps-hero">' +
      ringHTML(
        "ps",
        all.percent,
        complete,
        '<b><span data-ring-num>' + all.percent + "</span><small>%</small></b><span>" + all.watched + " / " + all.total + " Titel</span>"
      ) +
      '<div class="ps-hero-side">' +
      typeRowHTML("🎬", "Filme", s.movies) +
      typeRowHTML("📺", "Serien", s.series) +
      soonHTML +
      "</div>" +
      "</section>" +
      '<section class="mp-section">' +
      '<div class="mp-section-head"><h3>Universen</h3><span>' + s.universesCompleted + " / " + s.universesTotal + " abgeschlossen" +
      (s.universesUpcoming ? " · +" + s.universesUpcoming + " demnächst" : "") + "</span></div>" +
      '<div class="ps-universes">' + s.universes.map(universeCardHTML).join("") + "</div>" +
      "</section>" +
      '<section class="mp-section">' +
      '<div class="mp-section-head"><h3>MCU-Phasen</h3><span>nur erschienene Filme</span></div>' +
      '<div class="ps-phases">' + phases.map(phaseRowHTML).join("") + "</div>" +
      "</section>" +
      '<section class="mp-section">' +
      '<div class="mp-section-head"><h3>Erfolge</h3><span>' + s.achievementsUnlocked + " / " + s.achievements.length + " freigeschaltet</span></div>" +
      '<div class="ps-ach-row">' +
      s.achievements
        .map(
          (a) =>
            '<span class="ps-ach' + (a.unlocked ? " is-unlocked" : "") + '" title="' + esc(a.title + " — " + a.desc) + '">' +
            '<span class="ps-ach-icon" aria-hidden="true">' + a.icon + "</span>" +
            '<span class="ps-ach-name">' + esc(a.title) + "</span>" +
            '<span class="mp-sr-only">' + (a.unlocked ? " (freigeschaltet)" : " (gesperrt)") + "</span>" +
            "</span>"
        )
        .join("") +
      "</div>" +
      '<button type="button" class="mp-link" data-action="dashboard">Zum Agentenprofil ›</button>' +
      "</section>";

    const slot = statsEl.querySelector('[data-slot="body"]');
    slot.innerHTML = body;
    setRing(slot.querySelector(".ps-hero"), all.percent, complete);
    if (animate) animateFill(slot);
  }

  function openStats(opener) {
    if (!statsEl || !P.profile()) return;
    if (isOpen(dashEl)) closeDashboard(false);
    statsOpener = opener || document.activeElement;
    renderStats(P.stats(), false);
    openLayer(statsEl);
    animateFill(statsEl.querySelector('[data-slot="body"]'));
    const panel = statsEl.querySelector(".mp-panel");
    if (panel) panel.scrollTop = 0;
    const close = statsEl.querySelector(".mp-close");
    if (close) close.focus({ preventScroll: true });
  }

  function closeStats(restore) {
    if (!isOpen(statsEl)) return;
    closeLayer(statsEl);
    if (restore !== false) restoreFocus(statsOpener);
    statsOpener = null;
  }

  // =========================================================================
  // Persönliches Profil-Dashboard
  // =========================================================================
  const dashEl = document.getElementById("profile-dashboard");
  let dashOpener = null;
  let dashProfile = null;
  const listSignature = { recent: "", watchlist: "" };

  function buildDashboard() {
    if (!dashEl) return;
    dashEl.setAttribute("role", "dialog");
    dashEl.setAttribute("aria-modal", "true");
    dashEl.setAttribute("aria-labelledby", "pd-title");
    dashEl.innerHTML =
      '<div class="pd-panel mp-panel">' +
      '<button type="button" class="mp-close" data-action="close" aria-label="Profil schließen">✕</button>' +
      '<header class="pd-header" data-slot="header"></header>' +
      '<section class="mp-section">' +
      '<div class="mp-section-head"><h3>MULTIVERSE STATISTICS</h3><button type="button" class="mp-link mp-link-inline" data-action="stats">Ausführliche Statistik ›</button></div>' +
      '<div class="pd-tiles" data-slot="tiles"></div>' +
      "</section>" +
      '<div class="pd-columns">' +
      '<section class="mp-section"><div class="mp-section-head"><h3>ZULETZT ANGESEHEN</h3><span data-slot="recent-count"></span></div><div data-slot="recent"></div></section>' +
      '<section class="mp-section"><div class="mp-section-head"><h3>MEINE WATCHLIST</h3><span data-slot="watch-count"></span></div><div data-slot="watchlist"></div></section>' +
      "</div>" +
      '<section class="mp-section"><div class="mp-section-head"><h3>MEINE ERFOLGE</h3><span data-slot="ach-count"></span></div><ul class="pd-achievements" data-slot="achievements"></ul></section>' +
      '<p class="pd-note"><span aria-hidden="true">🔒</span> Gespeichert lokal in diesem Browser. Keine Synchronisierung zwischen Geräten.</p>' +
      "</div>";

    dashEl.addEventListener("click", (e) => {
      if (e.target === dashEl) {
        closeDashboard();
        return;
      }
      const t = e.target.closest ? e.target.closest("[data-action]") : null;
      if (!t || !dashEl.contains(t)) return;
      const action = t.dataset.action;
      if (action === "close") {
        playClick();
        closeDashboard();
      } else if (action === "stats") {
        const opener = dashOpener;
        closeDashboard(false);
        openStats(opener);
      } else if (action === "discover") {
        closeDashboard(false);
        const btn = document.getElementById("discover-btn");
        if (btn) btn.click();
      } else if (action === "open-title") {
        openTitle(t.dataset.id);
      }
    });
  }

  function openTitle(id) {
    const entry = P.get(id);
    if (!entry) return;
    if (entry.type === "movie") {
      closeDashboard(false);
      if (hud().openFilmModal) hud().openFilmModal(entry.title, entry.year);
      return;
    }
    // Serien haben keine eigene Detailansicht — wie im Serien-Tab von
    // Entdecken gibt es die Kurzbeschreibung als Hinweis.
    const sr = typeof SERIES !== "undefined" ? SERIES.find((x) => x.title === entry.title && x.year === entry.year) : null;
    if (hud().showToast) hud().showToast("📺 " + entry.title + " (" + entry.year + ")" + (sr && sr.desc ? " — " + sr.desc : ""), 5200);
  }

  function preload(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = reject;
      img.src = url;
    });
  }

  function posterFor(entry) {
    const el = document.createElement("span");
    el.className = "film-poster pd-poster";
    el.setAttribute("aria-hidden", "true");
    el.style.setProperty("--accent-color", universeAccent(entry));
    el.innerHTML = '<span class="film-abbrev">' + esc(abbrev(entry.title)) + "</span>";
    if (entry.type === "movie") {
      if (hud().loadPosterInto) hud().loadPosterInto(el, entry.title, entry.year);
    } else {
      const T = window.TMDB;
      if (T && T.enabled && T.enabled() && T.seriesPoster) {
        T.seriesPoster(entry.title, entry.year)
          .then((url) => (url ? preload(url) : null))
          .then((url) => {
            if (url && el.isConnected) el.innerHTML = '<img src="' + esc(url) + '" alt="" loading="lazy">';
          })
          .catch(() => {
            /* Kürzel bleibt sichtbar */
          });
      }
    }
    return el;
  }

  function starsHTML(n) {
    if (!n) return "";
    return (
      '<span class="pd-stars" role="img" aria-label="Deine Bewertung: ' + n + ' von 5 Sternen">' +
      "★".repeat(n) +
      '<span class="pd-stars-off">' + "★".repeat(5 - n) + "</span></span>"
    );
  }

  function listItem(entry, kind) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pd-item";
    btn.dataset.action = "open-title";
    btn.dataset.id = entry.id;
    const released = P.isReleased(entry);
    const meta = [entry.type === "series" ? "Serie" : "Film", String(entry.year)];
    if (entry.phase) meta.push(entry.phase);
    if (!released && entry.releaseDate) meta.push("Kinostart " + formatRelease(entry.releaseDate));
    btn.setAttribute(
      "aria-label",
      entry.title + " (" + entry.year + ")" + (entry.type === "movie" ? " — Filmdetails öffnen" : " — Serie")
    );
    btn.innerHTML =
      '<span class="pd-item-text"><span class="pd-item-title">' + esc(entry.title) + "</span>" +
      '<span class="pd-item-meta">' + esc(meta.join(" · ")) + "</span></span>" +
      (kind === "recent" ? starsHTML(P.rating(entry.id)) : "") +
      (!released ? '<span class="pd-tag">DEMNÄCHST</span>' : "");
    btn.insertBefore(posterFor(entry), btn.firstChild);
    li.appendChild(btn);
    return li;
  }

  // Listen nur neu aufbauen, wenn sich ihr Inhalt geändert hat — so werden
  // Poster nicht bei jeder Änderung erneut geladen.
  function renderList(slot, key, entries, kind, emptyHTML) {
    const sig = entries.map((e) => e.id + (kind === "recent" ? ":" + P.rating(e.id) : "")).join("|") || "empty:" + emptyHTML;
    if (listSignature[key] === sig) return;
    listSignature[key] = sig;
    slot.innerHTML = "";
    if (!entries.length) {
      slot.innerHTML = emptyHTML;
      return;
    }
    const ol = document.createElement("ol");
    ol.className = "pd-list";
    entries.forEach((e) => ol.appendChild(listItem(e, kind)));
    slot.appendChild(ol);
  }

  function tileHTML(icon, label, valueHTML, foot) {
    return (
      '<div class="pd-tile">' +
      '<span class="pd-tile-ico" aria-hidden="true">' + icon + "</span>" +
      '<span class="pd-tile-value">' + valueHTML + "</span>" +
      '<span class="pd-tile-label">' + esc(label) + "</span>" +
      (foot || "") +
      "</div>"
    );
  }

  function renderDashboardHeader(profile) {
    const header = dashEl.querySelector('[data-slot="header"]');
    const av = avatarFor(profile) || { name: agentName(profile), hero: "", color: "#5abeff", svg: "" };
    header.style.setProperty("--hero-color", av.color || "#5abeff");
    header.innerHTML =
      '<div class="pd-avatar-wrap"><span class="pd-avatar-ring" aria-hidden="true"></span>' +
      '<div class="pd-avatar">' + (av.svg || '<span class="pd-avatar-initial">' + esc(abbrev(av.name)) + "</span>") + "</div></div>" +
      '<div class="pd-ident">' +
      '<div class="panel-eyebrow mp-eyebrow">PERSÖNLICHES PROFIL</div>' +
      '<h2 id="pd-title" class="mp-title">S.H.I.E.L.D. AGENT PROFILE</h2>' +
      '<dl class="pd-fields">' +
      "<div><dt>AGENT</dt><dd>" + esc(upper(av.name)) + "</dd></div>" +
      (av.hero ? "<div><dt>IDENTITÄT</dt><dd>" + esc(upper(av.hero)) + "</dd></div>" : "") +
      '<div><dt>STATUS</dt><dd class="pd-status"><span class="pd-status-dot" aria-hidden="true"></span>ACTIVE</dd></div>' +
      "</dl></div>" +
      '<div class="pd-overall">' +
      ringHTML("pd", 0, false, '<b><span data-ring-num>0</span><small>%</small></b><span>MULTIVERSE</span>') +
      "</div>";
  }

  function renderDashboard(s, animate) {
    if (!dashEl || !s) return;
    const profile = P.profile();
    if (profile !== dashProfile) {
      dashProfile = profile;
      listSignature.recent = "";
      listSignature.watchlist = "";
      renderDashboardHeader(profile);
    }

    const all = s.all;
    const header = dashEl.querySelector('[data-slot="header"]');
    const complete = all.total > 0 && all.watched >= all.total;
    setRing(header, all.percent, complete);
    const num = header.querySelector("[data-ring-num]");
    if (num) num.textContent = String(all.percent);

    const avg = formatAverage(s.averageRating);
    const m = s.movies;
    const sr = s.series;
    dashEl.querySelector('[data-slot="tiles"]').innerHTML =
      tileHTML("🎬", "Filme gesehen", m.watched + "<small> / " + m.total + "</small>", barHTML(m.percent, m.total > 0 && m.watched >= m.total)) +
      tileHTML("📺", "Serien gesehen", sr.watched + "<small> / " + sr.total + "</small>", barHTML(sr.percent, sr.total > 0 && sr.watched >= sr.total)) +
      tileHTML(
        "🌌",
        "Universen abgeschlossen",
        s.universesCompleted + "<small> / " + s.universesTotal + "</small>",
        (s.universesUpcoming ? '<span class="pd-tile-foot">+' + s.universesUpcoming + " demnächst</span>" : "") +
          barHTML(P.percent(s.universesCompleted, s.universesTotal), s.universesTotal > 0 && s.universesCompleted >= s.universesTotal)
      ) +
      tileHTML(
        "🏆",
        "Erfolge freigeschaltet",
        s.achievementsUnlocked + "<small> / " + s.achievements.length + "</small>",
        barHTML(P.percent(s.achievementsUnlocked, s.achievements.length), s.achievementsUnlocked >= s.achievements.length)
      ) +
      tileHTML(
        "⭐",
        "Durchschnittliche Bewertung",
        avg ? avg + "<small> / 5</small>" : "—",
        '<span class="pd-tile-foot">' +
          (s.ratingCount ? "aus " + s.ratingCount + (s.ratingCount === 1 ? " Bewertung" : " Bewertungen") : "Noch keine Bewertungen") +
          "</span>"
      );

    const recent = s.recent.slice(0, 5);
    dashEl.querySelector('[data-slot="recent-count"]').textContent = s.recent.length ? s.recent.length + " gesehen" : "";
    renderList(
      dashEl.querySelector('[data-slot="recent"]'),
      "recent",
      recent,
      "recent",
      '<div class="pd-empty"><p>Noch keine Titel als gesehen markiert — öffne Entdecken und hake deinen ersten Film ab.</p>' +
        '<button type="button" class="mp-link" data-action="discover">🧭 Entdecken öffnen</button></div>'
    );

    const next = s.watchlistNext.slice(0, 5);
    dashEl.querySelector('[data-slot="watch-count"]').textContent = s.watchlistNext.length ? s.watchlistNext.length + " offen" : "";
    const watchEmpty = s.watchlist.length
      ? '<div class="pd-empty"><p>Alles auf deiner Watchlist ist gesehen. Stark, Agent!</p></div>'
      : '<div class="pd-empty"><p>Deine Watchlist ist noch leer — merke dir in Entdecken Filme und Serien für später vor.</p></div>';
    renderList(dashEl.querySelector('[data-slot="watchlist"]'), "watchlist", next, "watchlist", watchEmpty);

    dashEl.querySelector('[data-slot="ach-count"]').textContent = s.achievementsUnlocked + " / " + s.achievements.length + " freigeschaltet";
    dashEl.querySelector('[data-slot="achievements"]').innerHTML = s.achievements
      .map((a) => {
        const date = formatDate(a.unlockedAt);
        return (
          '<li class="pd-ach ' + (a.unlocked ? "is-unlocked" : "is-locked") + '">' +
          '<span class="pd-ach-icon" aria-hidden="true">' + a.icon + "</span>" +
          '<span class="pd-ach-title">' + esc(a.title) + "</span>" +
          '<span class="pd-ach-desc">' + (a.unlocked ? "" : "Bedingung: ") + esc(a.desc) + "</span>" +
          '<span class="pd-ach-state">' +
          (a.unlocked ? "✓ Freigeschaltet" + (date ? " am " + date : "") : "🔒 Gesperrt") +
          "</span></li>"
        );
      })
      .join("");

    if (animate) animateFill(dashEl.querySelector(".mp-panel"));
  }

  function openDashboard(opener) {
    if (!dashEl || !P.profile()) return;
    if (isOpen(statsEl)) closeStats(false);
    dashOpener = opener || document.activeElement;
    renderDashboard(P.stats(), false);
    openLayer(dashEl);
    animateFill(dashEl.querySelector(".mp-panel"));
    const panel = dashEl.querySelector(".mp-panel");
    if (panel) panel.scrollTop = 0;
    const close = dashEl.querySelector(".mp-close");
    if (close) close.focus({ preventScroll: true });
  }

  function closeDashboard(restore) {
    if (!isOpen(dashEl)) return;
    closeLayer(dashEl);
    if (restore !== false) restoreFocus(dashOpener);
    dashOpener = null;
  }

  // Avatar und Name im Profil-Badge öffnen das Dashboard; die drei Buttons
  // daneben (Sound, Profil wechseln, Abmelden) bleiben unberührt.
  const triggers = [];
  function initProfileTriggers() {
    const avatar = document.getElementById("profile-avatar");
    const meta = document.querySelector("#profile-badge .profile-meta");
    [avatar, meta].forEach((el) => {
      if (!el) return;
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-haspopup", "dialog");
      el.setAttribute("aria-controls", "profile-dashboard");
      el.classList.add("pd-trigger");
      el.addEventListener("click", () => {
        playClick();
        openDashboard(el);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          openDashboard(el);
        }
      });
      triggers.push(el);
    });
    updateTriggers(P.profile());
  }

  function updateTriggers(profile) {
    const label = profile ? "S.H.I.E.L.D.-Profil von " + agentName(profile) + " öffnen" : "Persönliches Profil öffnen";
    triggers.forEach((el) => {
      el.setAttribute("aria-label", label);
      el.title = "Persönliches Profil öffnen";
    });
  }

  // =========================================================================
  // Ereignisse bündeln, rendern und melden
  // =========================================================================
  let batch = null;
  let lastProgressToast = 0;

  function refresh() {
    const profile = P.profile();
    const s = profile ? P.stats() : null;
    renderWidget(s);
    updateTriggers(profile);
    if (!profile) {
      closeStats(false);
      closeDashboard(false);
      dashProfile = null;
      return;
    }
    if (isOpen(statsEl)) renderStats(s, false);
    if (isOpen(dashEl)) renderDashboard(s, false);
  }

  function notify(b) {
    const profile = P.profile();
    if (!profile || b.profile !== profile) return;
    const name = agentName(profile);

    if (b.universes.length) {
      jarvisToast("Universe exploration completed.", {
        tone: "success",
        tag: "UNIVERSE",
        sub: b.universes.map((u) => u.name).join(" · "),
      });
    }
    b.achievements.forEach((a) => {
      const verb = a.id === "infinity-saga" ? "completed" : "unlocked";
      jarvisToast("Congratulations, Agent " + name + ". " + a.title + " " + verb + ".", {
        tone: "gold",
        tag: "ACHIEVEMENT",
        icon: a.icon,
        sub: "New achievement unlocked.",
      });
    });
    if (b.achievements.length && hud().playCollect) hud().playCollect();

    // Die allgemeine Fortschrittsmeldung nur, wenn nichts Wichtigeres kam
    if (!b.universes.length && !b.achievements.length && b.watched > 0) {
      const now = Date.now();
      if (now - lastProgressToast >= PROGRESS_TOAST_INTERVAL) {
        lastProgressToast = now;
        jarvisToast("Multiverse exploration progress updated.", {
          tone: "info",
          tag: "UPDATE",
          sub: "Multiverse progress: " + pct(P.stats().all.percent),
        });
      }
    }
  }

  function flush() {
    const b = batch;
    batch = null;
    if (!b) return;
    refresh();
    notify(b);
  }

  function onProgressEvent(ev) {
    if (!batch) {
      batch = { profile: ev.profile, watched: 0, universes: [], achievements: [] };
      if (typeof queueMicrotask === "function") queueMicrotask(flush);
      else Promise.resolve().then(flush);
    }
    // Ein Profilwechsel verwirft Meldungen davor; "profile"/"sync" selbst
    // lösen nie eine Meldung aus.
    if (ev.type === "profile" || ev.type === "sync" || ev.profile !== batch.profile) {
      batch.profile = ev.profile;
      batch.watched = 0;
      batch.universes = [];
      batch.achievements = [];
      if (ev.type === "profile") {
        // Meldungen des vorherigen Profils nicht ins neue Profil (oder über
        // das Login-Gate) mitnehmen; die Drosselung gilt pro Sitzung.
        if (toastStack) toastStack.querySelectorAll(".jv-toast").forEach(dismissToast);
        lastProgressToast = 0;
      }
      if (ev.type === "profile" && !ev.profile) {
        // Beim Abmelden sofort schließen, nicht erst nach dem Microtask
        closeStats(false);
        closeDashboard(false);
      }
      return;
    }
    if (ev.type === "watched" && ev.value) batch.watched++;
    else if (ev.type === "universe-complete") batch.universes = batch.universes.concat(ev.universes || []);
    else if (ev.type === "achievement") batch.achievements = batch.achievements.concat(ev.achievements || []);
  }

  // Escape schließt die Overlays bereits über script.js (alle blockierenden
  // Overlays). Hier nur den Fokus anschließend an den Auslöser zurückgeben.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const opener = isOpen(statsEl) ? statsOpener : isOpen(dashEl) ? dashOpener : null;
      if (!opener) return;
      setTimeout(() => {
        if (!isOpen(statsEl) && !isOpen(dashEl)) {
          statsOpener = null;
          dashOpener = null;
          restoreFocus(opener);
        }
      }, 0);
    },
    true
  );

  // ---------- Start ----------
  buildWidget();
  initStones();
  buildStats();
  buildDashboard();
  initProfileTriggers();
  ensureToastStack();
  P.subscribe(onProgressEvent);
  refresh();

  return {
    jarvisToast,
    openStats: () => openStats(null),
    closeStats: () => closeStats(),
    openDashboard: () => openDashboard(null),
    closeDashboard: () => closeDashboard(),
    refresh,
  };
})();
