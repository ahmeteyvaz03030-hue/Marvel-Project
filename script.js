(function () {
  "use strict";

  const canvas = document.getElementById("scene");
  const labelsLayer = document.getElementById("labels-layer");
  const panel = document.getElementById("panel");
  const hint = document.getElementById("hint");

  // ---------- User gate (Profilauswahl) ----------
  function initUserGate() {
    const gate = document.getElementById("user-gate");
    const cardsWrap = document.getElementById("gate-cards");

    Object.entries(AVATARS).forEach(([id, u]) => {
      const card = document.createElement("button");
      card.className = "gate-card";
      card.style.setProperty("--hero-color", u.color);
      card.innerHTML = `
        <div class="gate-avatar">${u.svg}</div>
        <div class="gate-name">${u.name}</div>
        <div class="gate-hero">${u.hero}</div>`;
      card.addEventListener("click", () => selectUser(id));
      cardsWrap.appendChild(card);
    });

    function applyUser(id) {
      const u = AVATARS[id];
      if (!u) return;
      document.getElementById("profile-avatar").innerHTML = u.svg;
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
    }

    let saved = null;
    try {
      saved = localStorage.getItem("marvelUser");
    } catch (e) {
      saved = null;
    }
    if (saved && AVATARS[saved]) {
      applyUser(saved);
      gate.classList.add("hidden");
    }

    document.getElementById("profile-switch").addEventListener("click", () => {
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

    MCU_TIMELINE.forEach((phase) => {
      const phaseEl = document.createElement("div");
      phaseEl.className = "travel-phase";
      const heading = document.createElement("h3");
      heading.textContent = phase.phase;
      phaseEl.appendChild(heading);

      const list = document.createElement("div");
      list.className = "travel-list";
      phase.films.forEach((f) => {
        const item = document.createElement("div");
        item.className = "travel-item" + (f.finale ? " finale" : "");
        item.innerHTML = `
          <span class="travel-year">${f.year}</span>
          <span class="travel-dot"></span>
          <span class="travel-title">${f.title}</span>`;
        list.appendChild(item);
      });
      phaseEl.appendChild(list);
      container.appendChild(phaseEl);
    });

    btn.addEventListener("click", () => overlay.classList.remove("hidden"));
    closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
  }
  initTravel();

  // ---------- Suche (Charaktere & Filme) ----------
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

  function initSearch() {
    const searchIndex = buildSearchIndex();
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
            setTimeout(() => openCharacterModal(m.character, m.universe.accent), 300);
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
    if (u.id === "fantasticfour" || u.id === "xmen" || u.id === "doomsday") {
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
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  canvas.addEventListener("pointerdown", (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
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

    Object.values(labelEls).forEach((el) => el.classList.remove("active"));
    labelEls[id].classList.add("active");

    fillPanel(p.data);
    panel.classList.add("open");
  }

  function deselect() {
    activeId = null;
    Object.values(labelEls).forEach((el) => el.classList.remove("active"));
    panel.classList.remove("open");
    camPosTarget.copy(DEFAULT_CAM_POS);
    lookTarget.set(0, 0, 0);
  }

  document.getElementById("panel-close").addEventListener("click", deselect);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      deselect();
      document.getElementById("travel-overlay").classList.add("hidden");
      document.getElementById("character-modal").classList.add("hidden");
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

  function openCharacterModal(c, accent) {
    const modal = document.getElementById("character-modal");
    document.getElementById("character-avatar").innerHTML = `<span style="--accent-color:${accent}">${getInitials(c.name)}</span>`;
    document.getElementById("character-name").textContent = c.name;
    document.getElementById("character-role").textContent = c.role;
    document.getElementById("character-bio").textContent =
      c.bio || "Zu diesem Charakter liegt noch kein ausführlicher Steckbrief vor.";

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

    const charList = document.getElementById("panel-characters");
    charList.innerHTML = "";
    u.characters.forEach((c) => {
      const li = document.createElement("li");
      const initials = getInitials(c.name);
      li.innerHTML = `
        <div class="avatar" style="--accent-color:${u.accent}">${initials}</div>
        <div class="info">
          <span class="cname">${c.name}</span>
          <span class="crole">${c.role}</span>
        </div>`;
      li.addEventListener("click", () => openCharacterModal(c, u.accent));
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
      const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
      el.style.display = "flex";
      el.style.left = x + "px";
      el.style.top = (y - 30) + "px";
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    planetObjects.forEach((p) => {
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
      p.mesh.rotation.y += p.spinSpeed * dt;
    });

    // camera follow when a planet is selected
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
    camera.lookAt(camTarget);

    starfield.rotation.y += dt * 0.004;

    doomFigure.group.rotation.y = 0.45 + Math.sin(t * 0.15) * 0.3;
    doomFigure.group.position.y = 12 + Math.sin(t * 0.4) * 0.5;
    doomFigure.eyeLight.intensity = 2.6 + Math.sin(t * 3) * 0.9;

    updateLabels();
    renderer.render(scene, camera);
  }

  animate();
})();
