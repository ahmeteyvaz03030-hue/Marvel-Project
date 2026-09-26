// ---------------------------------------------------------------------------
// GLSL-Shader der 3D-Planetenszene (nur Quelltexte, keine Logik).
//
// - Oberflächen werden einmalig auf der GPU in Texturen "gebacken" (Noise ist
//   teuer, das Backen kostet nur beim Start ein paar Millisekunden) und danach
//   nur noch ausgelesen. So bleiben die Planeten-Shader zur Laufzeit günstig.
// - Alle Shader sind GLSL ES 1.0 kompatibel (WebGL1 und WebGL2).
// ---------------------------------------------------------------------------
window.SCENE_SHADERS = (function () {
  "use strict";

  // 3D-Simplex-Noise (Ashima Arts / Stefan Gustavson, MIT) + Hilfsfunktionen.
  const NOISE = `
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
      const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ * ns.x + ns.yyyy;
      vec4 y = y_ * ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0) * 2.0 + 1.0;
      vec4 s1 = floor(b1) * 2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
    }

    float fbm4(vec3 p) {
      float s = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        s += a * snoise(p);
        p = p * 2.02 + vec3(3.1, 1.7, 4.3);
        a *= 0.5;
      }
      return s;
    }

    float fbm6(vec3 p) {
      float s = 0.0;
      float a = 0.5;
      for (int i = 0; i < 6; i++) {
        s += a * snoise(p);
        p = p * 2.03 + vec3(1.3, 7.1, 2.9);
        a *= 0.5;
      }
      return s;
    }

    // Grat-Noise: dünne, verzweigte Linien (Risse, Adern, Blitze).
    float ridged(vec3 p) {
      float s = 0.0;
      float a = 0.5;
      float w = 1.0;
      for (int i = 0; i < 5; i++) {
        float n = 1.0 - abs(snoise(p));
        n *= n;
        n *= w;
        w = clamp(n * 1.6, 0.0, 1.0);
        s += n * a;
        p = p * 2.1 + vec3(2.3, 5.9, 1.1);
        a *= 0.52;
      }
      return s;
    }

    vec3 hash33(vec3 p3) {
      p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yxz + 33.33);
      return fract((p3.xxy + p3.yxx) * p3.zyx);
    }

    float hash13(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }

    // Zellen-Noise: F1/F2-Abstände (Krater, Platten, Lavarisse).
    vec2 worley(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      float d1 = 8.0;
      float d2 = 8.0;
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          for (int z = -1; z <= 1; z++) {
            vec3 g = vec3(float(x), float(y), float(z));
            vec3 r = g + hash33(i + g) - f;
            float d = dot(r, r);
            if (d < d1) {
              d2 = d1;
              d1 = d;
            } else if (d < d2) {
              d2 = d;
            }
          }
        }
      }
      return vec2(sqrt(d1), sqrt(d2));
    }

    // Richtung auf der Einheitskugel zu einer equirektangulären UV-Koordinate —
    // exakt passend zur UV-Abwicklung von THREE.SphereGeometry.
    vec3 uvToDir(vec2 uv) {
      float phi = uv.x * 6.28318530718;
      float theta = (1.0 - uv.y) * 3.14159265359;
      return vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
    }
  `;

  // Vollbild-Quad für alle Back-Vorgänge.
  const bakeVertex = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  // Oberflächen je Universum. Pass 0: Albedo (rgb) + Glanzmaske (a).
  // Pass 1: Leuchten (r), Wolken (g), Höhen-Gradient u/v (b/a, 0.5 = flach).
  const surfaceBakeFragment = `
    uniform float uStyle;
    uniform float uPass;
    uniform vec3 uSeed;
    uniform vec3 uC0;
    uniform vec3 uC1;
    uniform vec3 uC2;
    uniform vec3 uC3;
    uniform vec3 uC4;
    uniform float uSea;
    varying vec2 vUv;
    ${NOISE}

    void main() {
      vec3 p = uvToDir(vUv);
      float lat = p.y;
      vec3 q = p + uSeed;
      vec3 w = vec3(
        fbm4(q * 1.2),
        fbm4(q * 1.2 + vec3(5.2, 1.3, 2.8)),
        fbm4(q * 1.2 + vec3(1.7, 9.2, 4.1))
      );

      vec3 albedo = uC0;
      float spec = 0.0;
      float emit = 0.0;
      float height = 0.5;
      float cloud = 0.0;

      if (uStyle < 0.5) {
        // Erdähnlich: Ozeane, Kontinente, Polkappen, Stadtlichter, Wolken
        float h = fbm6(q * 1.7 + w * 0.85) * 0.5 + 0.5;
        float detail = fbm4(q * 7.0) * 0.5 + 0.5;
        float land = smoothstep(uSea, uSea + 0.015, h);
        vec3 ocean = mix(uC0, uC1, smoothstep(uSea - 0.2, uSea, h));
        float t = clamp((h - uSea) / (1.0 - uSea), 0.0, 1.0);
        vec3 ground = mix(uC2, uC3, smoothstep(0.08, 0.55, t + (detail - 0.5) * 0.35));
        ground *= 0.82 + 0.3 * detail;
        float ice = smoothstep(0.74, 0.86, abs(lat) + 0.1 * fbm4(q * 3.5));
        albedo = mix(ocean, ground, land);
        albedo = mix(albedo, uC4, ice);
        spec = (1.0 - land) * (1.0 - ice);
        height = mix(uSea, h, land) + ice * 0.04;
        float cityN = fbm4(q * 11.0) * 0.5 + 0.5;
        float cityM = fbm4(q * 3.0 + 7.0) * 0.5 + 0.5;
        emit = land * (1.0 - ice) * smoothstep(0.56, 0.78, cityN) * smoothstep(0.42, 0.68, cityM);
        float c = fbm6(q * 2.1 + w * 1.5 + vec3(0.0, 0.0, 3.7));
        cloud = smoothstep(0.02, 0.5, c) * 0.9;
      } else if (uStyle < 1.5) {
        // Eiswelt (X-Men): gefrorene Ebenen, leuchtende cyanfarbene Spalten
        float h = fbm6(q * 2.0 + w * 0.6) * 0.5 + 0.5;
        float r = ridged(q * 3.2 + w * 0.3);
        float crack = smoothstep(0.66, 0.92, r);
        albedo = mix(uC0, uC1, smoothstep(0.3, 0.7, h));
        albedo = mix(albedo, uC2, smoothstep(0.62, 0.85, h));
        float cap = smoothstep(0.55, 0.78, abs(lat) + 0.12 * fbm4(q * 4.0));
        albedo = mix(albedo, uC2, cap);
        albedo = mix(albedo, uC3 * 0.55, crack * 0.8);
        spec = 0.55 * (1.0 - crack);
        height = h * 0.8 + cap * 0.1 - crack * 0.15;
        emit = crack;
        cloud = smoothstep(0.25, 0.75, fbm4(vec3(q.x * 1.4, q.y * 5.0, q.z * 1.4) + w)) * 0.45;
      } else if (uStyle < 2.5) {
        // Kosmischer Eisriese (Fantastic Four): Bänder, Sturm, Energiestreifen
        float turb = fbm4(q * 2.2 + w * 1.3);
        float b = sin((lat + turb * 0.1) * 16.0 + fbm4(q * 0.9) * 2.5);
        float t = b * 0.5 + 0.5;
        albedo = mix(uC0, uC1, t);
        albedo = mix(albedo, uC2, smoothstep(0.78, 1.0, t) * 0.7);
        vec3 sc = normalize(vec3(0.7, -0.35, 0.6));
        float sd = length((p - sc) * vec3(1.0, 2.4, 1.0));
        float storm = 1.0 - smoothstep(0.05, 0.28, sd + turb * 0.08);
        albedo = mix(albedo, uC3, storm * 0.85);
        float streak = smoothstep(0.84, 0.97, ridged(vec3(q.x * 2.0, q.y * 7.0, q.z * 2.0) + w));
        albedo = mix(albedo, uC4, streak * 0.6);
        emit = streak * 0.8 + storm * 0.25;
        spec = 0.12;
        height = t * 0.2 + 0.4;
      } else if (uStyle < 3.5) {
        // Dunkle Vulkanwelt (Sam Raimi): Basalt, Krater, rote Lavaadern
        float h = fbm6(q * 2.3 + w * 0.8) * 0.5 + 0.5;
        vec2 wo = worley(q * 3.4);
        float crater = 1.0 - smoothstep(0.0, 0.32, wo.x);
        float rim = smoothstep(0.2, 0.3, wo.x) * (1.0 - smoothstep(0.3, 0.42, wo.x));
        albedo = mix(uC0, uC1, smoothstep(0.3, 0.72, h));
        albedo = mix(albedo, uC2, smoothstep(0.66, 0.85, h) * 0.8);
        albedo *= 1.0 - crater * 0.35;
        albedo += rim * 0.06;
        float v = ridged(q * 4.2 + w * 0.4);
        float vein = smoothstep(0.78, 0.96, v) * smoothstep(0.35, 0.6, 1.0 - h);
        albedo = mix(albedo, uC3 * 0.5, vein * 0.6);
        emit = vein;
        spec = 0.06;
        height = h - crater * 0.12 + rim * 0.08;
        cloud = smoothstep(0.45, 0.8, fbm4(q * 2.8 + w)) * 0.35;
      } else if (uStyle < 4.5) {
        // Elektrische Welt (Amazing Spider-Man): Blitznetz aus Cyan
        float h = fbm6(q * 2.0 + w) * 0.5 + 0.5;
        albedo = mix(uC0, uC1, smoothstep(0.35, 0.75, h));
        albedo = mix(albedo, uC2, smoothstep(0.7, 0.9, h) * 0.6);
        float r = ridged(q * 2.8 + w * 0.6);
        float net = smoothstep(0.78, 0.95, r);
        albedo = mix(albedo, uC3, net * 0.45);
        emit = net;
        spec = 0.35 * (1.0 - smoothstep(0.4, 0.6, h));
        height = h * 0.7 - net * 0.05;
        cloud = smoothstep(0.15, 0.65, fbm6(q * 2.6 + w * 1.6)) * 0.6;
      } else if (uStyle < 5.5) {
        // Inferno (Avengers: Doomsday): verkohlte Kruste, glühende Risse, Lavaseen
        float h = fbm6(q * 1.8 + w * 0.9) * 0.5 + 0.5;
        vec2 wo = worley(q * 3.0 + w * 0.5);
        float cracks = 1.0 - smoothstep(0.0, 0.07, wo.y - wo.x);
        float lakes = smoothstep(0.6, 0.7, 1.0 - h);
        float flick = fbm4(q * 8.0) * 0.5 + 0.5;
        albedo = mix(uC0, uC1, smoothstep(0.3, 0.8, h));
        albedo = mix(albedo, uC2, smoothstep(0.72, 0.9, h) * 0.6);
        float lava = max(cracks * (0.55 + 0.45 * flick), lakes);
        albedo = mix(albedo, uC3, lava * 0.75);
        emit = lava;
        spec = 0.03;
        height = h * 0.9 - cracks * 0.08 - lakes * 0.1;
        cloud = smoothstep(0.5, 0.82, fbm4(q * 2.4 + w * 1.2)) * 0.4;
      } else if (uStyle < 6.5) {
        // Metallische Welt (Thunderbolts): Platten, Nähte, violetter Glanz
        float h = fbm6(q * 2.6 + w * 0.5) * 0.5 + 0.5;
        vec2 wo = worley(q * 4.2);
        float edge = 1.0 - smoothstep(0.0, 0.05, wo.y - wo.x);
        float b = sin(lat * 22.0 + fbm4(q * 1.5) * 3.0) * 0.5 + 0.5;
        albedo = mix(uC0, uC1, smoothstep(0.3, 0.75, h));
        albedo = mix(albedo, uC2, (1.0 - smoothstep(0.3, 0.5, h)) * 0.7);
        albedo *= 0.85 + 0.25 * b;
        albedo *= 1.0 - edge * 0.45;
        float seam = edge * smoothstep(0.55, 0.85, fbm4(q * 5.0) * 0.5 + 0.5);
        emit = seam;
        spec = 0.9 * (1.0 - edge);
        height = h * 0.6 - edge * 0.1;
      } else if (uStyle < 7.5) {
        // Zerstörte Welt (Titan): Einschlagkrater, Schluchten mit Magma
        float h = fbm6(q * 2.0 + w) * 0.5 + 0.5;
        vec2 wo = worley(q * 2.3);
        float crater = 1.0 - smoothstep(0.1, 0.42, wo.x);
        float rim = smoothstep(0.34, 0.44, wo.x) * (1.0 - smoothstep(0.44, 0.56, wo.x));
        float r = ridged(q * 2.6 + w * 0.5);
        float chasm = smoothstep(0.76, 0.94, r);
        albedo = mix(uC0, uC1, smoothstep(0.3, 0.75, h));
        albedo = mix(albedo, uC2, (1.0 - smoothstep(0.25, 0.5, h)) * 0.75);
        albedo *= 1.0 - crater * 0.4;
        albedo += rim * vec3(0.08, 0.06, 0.05);
        albedo = mix(albedo, uC3 * 0.6, chasm * 0.7);
        emit = chasm;
        spec = 0.03;
        height = h - crater * 0.18 + rim * 0.1 - chasm * 0.12;
      } else {
        // Gestein (Monde)
        float h = fbm6(q * 3.0) * 0.5 + 0.5;
        vec2 wo = worley(q * 5.0);
        float crater = 1.0 - smoothstep(0.0, 0.35, wo.x);
        float rim = smoothstep(0.25, 0.35, wo.x) * (1.0 - smoothstep(0.35, 0.45, wo.x));
        albedo = mix(uC0, uC1, h);
        albedo *= 1.0 - crater * 0.3;
        albedo += rim * 0.08;
        spec = 0.02;
        height = h - crater * 0.15 + rim * 0.1;
      }

      if (uPass < 0.5) {
        gl_FragColor = vec4(clamp(albedo, 0.0, 1.0), clamp(spec, 0.0, 1.0));
      } else {
        // Gradient in voller Genauigkeit berechnen, bevor er in 8 Bit landet —
        // sonst würde das Relief treppig.
        vec2 gr = vec2(dFdx(height), dFdy(height)) * 24.0;
        gl_FragColor = vec4(
          clamp(emit, 0.0, 1.0),
          clamp(cloud, 0.0, 1.0),
          clamp(0.5 + gr.x, 0.0, 1.0),
          clamp(0.5 + gr.y, 0.0, 1.0)
        );
      }
    }
  `;

  // Planetenoberfläche: Tag/Nacht mit weicher Terminator-Zone, Relief,
  // Ozean-Glanz, Nachtseiten-Leuchten, Atmosphären-Dunst und Rim Light.
  const planetVertex = `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying vec3 vTanU;
    varying vec3 vTanV;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      mat3 m = mat3(modelMatrix);
      vec3 n = normalize(normal);
      vWorldNormal = m * n;
      vTanU = m * vec3(n.z, 0.0, -n.x);
      vTanV = m * vec3(-n.x * n.y, 1.0 - n.y * n.y, -n.z * n.y);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const planetFragment = `
    uniform sampler2D uTexA;
    uniform sampler2D uTexB;
    uniform vec3 uSunPos;
    uniform vec3 uSunColor;
    uniform vec3 uAmbient;
    uniform vec3 uAtmo;
    uniform vec3 uAtmo2;
    uniform vec3 uEmit;
    uniform float uEmitAlways;
    uniform float uEmitPulse;
    uniform float uBump;
    uniform float uSpecPower;
    uniform float uSpecStrength;
    uniform float uRim;
    uniform float uHover;
    uniform float uExposure;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying vec3 vTanU;
    varying vec3 vTanV;

    void main() {
      vec4 ta = texture2D(uTexA, vUv);
      vec4 tb = texture2D(uTexB, vUv);
      vec3 Ng = normalize(vWorldNormal);
      vec3 tu = vTanU / max(length(vTanU), 1e-4);
      vec3 tv = vTanV / max(length(vTanV), 1e-4);
      vec2 g = tb.ba - 0.5;
      vec3 N = normalize(Ng - uBump * (g.x * tu + g.y * tv));

      vec3 L = normalize(uSunPos - vWorldPos);
      vec3 V = normalize(cameraPosition - vWorldPos);
      float ndlG = dot(Ng, L);
      float day = smoothstep(-0.12, 0.22, ndlG);
      float diff = max(dot(N, L), 0.0);

      vec3 albedo = ta.rgb;
      vec3 col = albedo * (uSunColor * diff + uAmbient);

      // warmes Streulicht entlang der Tag/Nacht-Grenze
      float band = smoothstep(-0.25, 0.02, ndlG) * (1.0 - smoothstep(0.02, 0.3, ndlG));
      col += albedo * vec3(0.9, 0.35, 0.12) * band * 0.35;

      vec3 H = normalize(L + V);
      float sp = pow(max(dot(N, H), 0.0), uSpecPower) * ta.a * uSpecStrength * day;
      col += uSunColor * sp;

      float emitVis = mix(1.0 - day, 1.0, uEmitAlways);
      col += uEmit * tb.r * emitVis * uEmitPulse * (1.0 + uHover * 0.8);

      float mu = max(dot(Ng, V), 0.0);
      float fres = pow(1.0 - mu, 2.2);
      float sunSide = smoothstep(-0.4, 0.55, ndlG);
      vec3 atmo = mix(uAtmo, uAtmo2, sunSide);
      float haze = fres * uRim * (0.35 + 0.65 * sunSide) * (1.0 + uHover * 0.6);
      col = mix(col, atmo * (0.35 + 0.9 * sunSide), clamp(haze, 0.0, 0.85));
      col += atmo * pow(fres, 3.5) * (0.25 + 0.75 * sunSide) * uRim * 0.8;

      col = 1.0 - exp(-col * uExposure);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // Wolkendecke: eigenständig rotierende Hülle, nachts dunkel (verdeckt Lichter).
  const cloudVertex = `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldNormal = mat3(modelMatrix) * normal;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const cloudFragment = `
    uniform sampler2D uTexB;
    uniform vec3 uSunPos;
    uniform vec3 uSunColor;
    uniform float uOpacity;
    uniform float uExposure;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      float c = texture2D(uTexB, vUv).g;
      vec3 Ng = normalize(vWorldNormal);
      vec3 L = normalize(uSunPos - vWorldPos);
      float lit = smoothstep(-0.18, 0.35, dot(Ng, L));
      vec3 col = mix(vec3(0.015, 0.018, 0.03), uSunColor * 1.05, lit);
      col = 1.0 - exp(-col * uExposure);
      gl_FragColor = vec4(col, c * uOpacity);
    }
  `;

  // Atmosphären-Hülle (Rückseite, additiv): hell am Planetenrand, nach außen
  // auslaufend, auf der Sonnenseite deutlich kräftiger.
  const atmosphereVertex = `
    varying vec3 vNormalV;
    varying vec3 vPosV;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vPosV = mv.xyz;
      vNormalV = normalize(normalMatrix * normal);
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vWorldNormal = mat3(modelMatrix) * normal;
      gl_Position = projectionMatrix * mv;
    }
  `;

  const atmosphereFragment = `
    uniform vec3 uColor;
    uniform vec3 uColor2;
    uniform vec3 uSunPos;
    uniform float uIntensity;
    uniform float uLimb;
    uniform float uHover;
    varying vec3 vNormalV;
    varying vec3 vPosV;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vec3 Vv = normalize(-vPosV);
      float d = -dot(normalize(vNormalV), Vv);
      float glow = pow(clamp(d / uLimb, 0.0, 1.0), 1.6);
      vec3 L = normalize(uSunPos - vWorldPos);
      float sunSide = smoothstep(-0.55, 0.6, dot(normalize(vWorldNormal), L));
      vec3 col = mix(uColor, uColor2, sunSide);
      float a = glow * (0.3 + 1.0 * sunSide) * uIntensity * (1.0 + uHover * 0.7);
      gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    }
  `;

  // Planetenring mit Bändern, Lücke und Schatten des Planeten.
  const planetRingVertex = `
    varying vec3 vLocal;
    varying vec3 vWorldPos;
    void main() {
      vLocal = position;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const planetRingFragment = `
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uSunPos;
    uniform vec3 uPlanetPos;
    uniform float uPlanetRadius;
    uniform float uInner;
    uniform float uOuter;
    uniform float uOpacity;
    uniform float uSeed;
    varying vec3 vLocal;
    varying vec3 vWorldPos;
    void main() {
      float r = length(vLocal.xy);
      float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
      float bands = 0.7 + 0.16 * sin(t * 38.0 + uSeed) + 0.1 * sin(t * 91.0 + uSeed * 2.3) + 0.06 * sin(t * 173.0);
      float gap = smoothstep(0.3, 0.33, t) * (1.0 - smoothstep(0.36, 0.39, t));
      float edge = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.88, 1.0, t));
      float alpha = uOpacity * edge * bands * (1.0 - gap * 0.85);
      vec3 L = normalize(uSunPos - vWorldPos);
      vec3 toP = uPlanetPos - vWorldPos;
      float along = dot(toP, L);
      float perp = length(toP - L * along);
      float shadow = (along > 0.0 && perp < uPlanetRadius) ? 0.22 : 1.0;
      vec3 col = mix(uColorA, uColorB, t) * shadow;
      gl_FragColor = vec4(col, alpha);
    }
  `;

  // Stern im Zentrum: brodelnde Oberfläche, weißglühende Mitte, orange Ränder.
  const sunVertex = `
    varying vec3 vObj;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vObj = position;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldNormal = mat3(modelMatrix) * normal;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const sunFragment = `
    uniform float uTime;
    uniform float uPulse;
    varying vec3 vObj;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    ${NOISE}
    void main() {
      vec3 V = normalize(cameraPosition - vWorldPos);
      float mu = max(dot(normalize(vWorldNormal), V), 0.0);
      vec3 p = normalize(vObj);
      float n = snoise(p * 3.0 + vec3(0.0, uTime * 0.12, uTime * 0.05)) * 0.5 + 0.5;
      float n2 = snoise(p * 9.0 - vec3(uTime * 0.2, 0.0, uTime * 0.1)) * 0.5 + 0.5;
      vec3 hot = vec3(1.0, 0.97, 0.88);
      vec3 warm = vec3(1.0, 0.74, 0.32);
      vec3 edge = vec3(1.0, 0.42, 0.1);
      vec3 col = mix(edge, warm, smoothstep(0.0, 0.55, mu));
      col = mix(col, hot, smoothstep(0.5, 1.0, mu) * (0.6 + 0.4 * n));
      col *= 0.8 + 0.28 * n + 0.14 * n2;
      col *= uPulse;
      gl_FragColor = vec4(col * 1.2, 1.0);
    }
  `;

  // Flammenzungen der Corona auf einer zur Kamera gedrehten Fläche.
  const flareVertex = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const flareFragment = `
    uniform float uTime;
    uniform float uCore;
    uniform float uStrength;
    varying vec2 vUv;
    ${NOISE}
    void main() {
      vec2 c = vUv * 2.0 - 1.0;
      float r = length(c);
      float a = atan(c.y, c.x);
      vec2 ca = vec2(cos(a), sin(a));
      float n = snoise(vec3(ca * 1.6, uTime * 0.12)) * 0.5 + 0.5;
      float n2 = snoise(vec3(ca * 4.5, uTime * 0.25 + 5.0)) * 0.5 + 0.5;
      float reach = uCore + 0.1 + 0.34 * n * n + 0.14 * n2;
      float f = 1.0 - smoothstep(uCore * 0.95, reach, r);
      float inner = smoothstep(uCore * 0.82, uCore * 1.02, r);
      vec3 col = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.82, 0.45), f * f);
      float alpha = f * inner * uStrength * (1.0 - smoothstep(0.85, 1.0, r));
      gl_FragColor = vec4(col, alpha);
    }
  `;

  // Energiepartikel, die vom Kern nach außen strömen und verglühen.
  const energyVertex = `
    attribute vec3 aDir;
    attribute float aOffset;
    attribute float aSpeed;
    uniform float uTime;
    uniform float uCore;
    uniform float uSpan;
    uniform float uSize;
    uniform float uPixelRatio;
    varying float vFade;
    void main() {
      float life = fract(aOffset + uTime * aSpeed);
      vec3 pos = aDir * (uCore * 1.05 + life * uSpan);
      vFade = (1.0 - life) * smoothstep(0.0, 0.12, life);
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = uSize * uPixelRatio * (30.0 / -mv.z) * (0.6 + 0.4 * (1.0 - life));
      gl_Position = projectionMatrix * mv;
    }
  `;

  const energyFragment = `
    uniform vec3 uColor;
    varying float vFade;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(uColor, a * vFade);
    }
  `;

  // Partikel auf Kreisbahnen um das Zentrum (Staubscheibe, Bahn-Glitzern).
  // Innere Bahnen laufen schneller (keplerähnlich), jedes Teilchen funkelt leicht.
  const orbitParticleVertex = `
    attribute float aRadius;
    attribute float aAngle;
    attribute float aHeight;
    attribute float aSize;
    attribute float aPhase;
    attribute vec3 aColor;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uPixelRatio;
    uniform float uTwinkle;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float omega = uSpeed / pow(max(aRadius, 0.5) / 4.0, 1.5);
      float ang = aAngle + uTime * omega;
      vec3 pos = vec3(cos(ang) * aRadius, aHeight, sin(ang) * aRadius);
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      float tw = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * 2.2 + aPhase));
      gl_PointSize = aSize * uPixelRatio * (40.0 / -mv.z) * (0.7 + 0.3 * tw);
      gl_Position = projectionMatrix * mv;
      vColor = aColor;
      vAlpha = tw;
    }
  `;

  const orbitParticleFragment = `
    uniform float uOpacity;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.05, d);
      gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
    }
  `;

  // Leuchtende Orbitalbahn: feiner Kern + weicher Glow, vorne heller als
  // hinten (Tiefe), optional ein wandernder Lichtfunke.
  const orbitRingVertex = `
    varying vec3 vLocal;
    varying vec3 vWorld;
    void main() {
      vLocal = position;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const orbitRingFragment = `
    uniform vec3 uColor;
    uniform float uRadius;
    uniform float uWidth;
    uniform float uOpacity;
    uniform float uTime;
    uniform float uSpark;
    uniform float uSparkSpeed;
    uniform float uPhase;
    varying vec3 vLocal;
    varying vec3 vWorld;
    void main() {
      float r = length(vLocal.xy);
      float x = (r - uRadius) / uWidth;
      float core = exp(-x * x * 6.0);
      float glow = exp(-x * x * 0.8) * 0.25;
      float ang = atan(vLocal.y, vLocal.x);
      vec2 cxz = normalize(cameraPosition.xz + vec2(1e-4));
      vec2 pxz = normalize(vWorld.xz + vec2(1e-4));
      float front = dot(cxz, pxz) * 0.5 + 0.5;
      float depthMod = mix(0.3, 1.0, front);
      float s = fract(ang / 6.28318530718 + uPhase - uTime * uSparkSpeed);
      float spark = uSpark * pow(s, 24.0) * 2.2;
      float a = (core + glow) * uOpacity * depthMod + spark * core * uOpacity;
      gl_FragColor = vec4(uColor, a);
    }
  `;

  // Weltraum-Hintergrund (einmalig gebacken): sehr dunkle blau/violette
  // Nebelwolken, einzelne rote Regionen, Staubband, Absorption, ferne Sterne.
  const nebulaBakeFragment = `
    uniform vec3 uSeed;
    varying vec2 vUv;
    ${NOISE}
    void main() {
      vec3 d = uvToDir(vUv);
      vec3 q = d * 1.4 + uSeed;
      vec3 w = vec3(fbm4(q), fbm4(q + vec3(3.1, 7.4, 1.9)), fbm4(q + vec3(8.3, 2.2, 5.6)));
      float n = fbm6(q * 1.3 + w * 1.6);
      float n2 = fbm6(q * 3.1 + w * 2.2 + 4.0);
      float dens = smoothstep(-0.25, 0.75, n);
      float fil = smoothstep(0.1, 0.7, n2 * 0.5 + 0.5) * dens;

      vec3 base = vec3(0.006, 0.008, 0.018);
      vec3 blue = vec3(0.05, 0.09, 0.24);
      vec3 violet = vec3(0.17, 0.07, 0.28);
      vec3 teal = vec3(0.03, 0.14, 0.2);
      vec3 red = vec3(0.36, 0.04, 0.09);

      float mBlue = smoothstep(-0.2, 0.9, dot(d, normalize(vec3(-0.75, 0.45, -0.5))));
      float mRed = smoothstep(0.05, 0.95, dot(d, normalize(vec3(0.85, 0.05, -0.5))));
      float mViolet = smoothstep(-0.3, 0.8, dot(d, normalize(vec3(0.1, 0.8, -0.6))));
      float sel = fbm4(q * 0.7 + 11.0) * 0.5 + 0.5;

      vec3 col = base;
      col += blue * dens * (0.3 + 0.9 * mBlue);
      col += violet * fil * (0.3 + 0.8 * mViolet) * sel;
      col += teal * fil * (1.0 - sel) * 0.6 * mBlue;
      col += red * pow(fil, 1.2) * mRed * 1.35;

      float band = exp(-pow(dot(d, normalize(vec3(0.25, 1.0, 0.35))) / 0.22, 2.0));
      col += vec3(0.06, 0.06, 0.09) * band * smoothstep(0.0, 0.8, n2 * 0.5 + 0.5);

      float dark = smoothstep(0.2, 0.7, fbm4(q * 2.4 + w * 3.0 + 9.0) * 0.5 + 0.5);
      col *= (1.0 - dark * 0.55) * 0.88;

      float st = hash13(floor(d * 310.0) + uSeed);
      float star = smoothstep(0.9965, 1.0, st) * (0.35 + 0.65 * hash13(floor(d * 310.0) + 7.0));
      col += vec3(0.75, 0.8, 1.0) * star * (0.35 + band * 0.6);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // Einzelne Nebelschwaden (mit Alpha) für die Parallax-Ebene vor dem Himmel.
  const nebulaCloudBakeFragment = `
    uniform vec3 uSeed;
    varying vec2 vUv;
    ${NOISE}
    void main() {
      vec2 c = vUv * 2.0 - 1.0;
      float r = length(c);
      vec3 q = vec3(c * 1.6, 0.0) + uSeed;
      vec3 w = vec3(fbm4(q), fbm4(q + vec3(4.1, 2.7, 1.3)), 0.0);
      float n = fbm6(q * 1.2 + w * 1.8) * 0.5 + 0.5;
      float wisp = smoothstep(0.35, 0.85, n);
      float a = (1.0 - smoothstep(0.25, 1.0, r)) * wisp;
      gl_FragColor = vec4(vec3(1.0), a);
    }
  `;

  return {
    bakeVertex,
    surfaceBakeFragment,
    planetVertex,
    planetFragment,
    cloudVertex,
    cloudFragment,
    atmosphereVertex,
    atmosphereFragment,
    planetRingVertex,
    planetRingFragment,
    sunVertex,
    sunFragment,
    flareVertex,
    flareFragment,
    energyVertex,
    energyFragment,
    orbitParticleVertex,
    orbitParticleFragment,
    orbitRingVertex,
    orbitRingFragment,
    nebulaBakeFragment,
    nebulaCloudBakeFragment,
  };
})();
