(function () {
  "use strict";

  const canvas = document.getElementById("scene");
  const labelsLayer = document.getElementById("labels-layer");
  const panel = document.getElementById("panel");
  const hint = document.getElementById("hint");

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
    const meshes = planetObjects.map((p) => p.mesh);
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
    if (e.key === "Escape") deselect();
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
      const initials = c.name
        .split(" / ")[0]
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      li.innerHTML = `
        <div class="avatar" style="--accent-color:${u.accent}">${initials}</div>
        <div class="info">
          <span class="cname">${c.name}</span>
          <span class="crole">${c.role}</span>
        </div>`;
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

    updateLabels();
    renderer.render(scene, camera);
  }

  animate();
})();
