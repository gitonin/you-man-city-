import {
  Color,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';

/**
 * Passe finale : c'est elle qui fabrique le « mauvais signal ».
 *
 * La scène 3D est rendue dans une cible minuscule, puis cette passe l'étire
 * au plein écran en lui faisant subir, dans l'ordre : la courbure du tube, le
 * décrochage par lignes et par blocs, la corruption de blocs façon datamosh,
 * la séparation des composantes, le filé de vitesse, la pluie, le tableau de
 * bord, les lignes de balayage, la réduction à 15 bits avec tramage, et la
 * vignette. L'image 3D et le HUD subissent la même dégradation — c'est ce qui
 * fait croire à une seule et même machine fatiguée.
 */

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tScene;
uniform sampler2D tHud;
uniform vec2  uOutput;
uniform vec2  uInternal;
uniform float uTime;
uniform float uGlitch;
uniform float uSpeed;
uniform float uFlash;
uniform float uFade;
uniform float uCurve;
uniform float uRain;
uniform float uBolt;
uniform float uBeat;
uniform vec3  uTint;

varying vec2 vUv;

/**
 * Hachage sans sinus : au bout de quelques dizaines de secondes, l'argument
 * d'un sinus devient trop grand pour la précision d'un GPU mobile et le
 * hachage se corrèle — tous les blocs tiraient alors la même valeur et
 * l'image entière basculait d'un coup.
 */
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

/**
 * La scène est rendue dans une cible linéaire : c'est à nous d'appliquer la
 * courbe d'affichage avant de composer le HUD et les effets d'écran, qui eux
 * vivent déjà en valeurs perçues.
 */
vec3 toDisplay(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(0.4166667)) - 0.055, step(vec3(0.0031308), c));
}

/** Bombement du tube cathodique. */
vec2 curve(vec2 uv, float amount) {
  uv = uv * 2.0 - 1.0;
  vec2 offset = abs(uv.yx) / vec2(5.2, 4.0);
  uv += uv * offset * offset * amount;
  return uv * 0.5 + 0.5;
}

/**
 * Tramage ordonné 4x4, construit par récurrence à partir de la matrice 2x2
 * plutôt que par un tableau parcouru en boucle : même résultat, seize fois
 * moins d'instructions, et ça compte sur un plein écran.
 */
float m2(float a, float b) { return 2.0 * a + 3.0 * b - 4.0 * a * b; }
float bayer(vec2 p) {
  vec2 c = mod(floor(p), 4.0);
  float lo = m2(mod(c.x, 2.0), mod(c.y, 2.0));
  float hi = m2(floor(c.x * 0.5), floor(c.y * 0.5));
  return (4.0 * lo + hi) / 16.0;
}

/** Averse : des traits fins et obliques, en colonnes décalées. */
float rainfall(vec2 uv, float t, float density) {
  vec2 p = uv * vec2(96.0, 26.0) * density;
  p.x += p.y * 0.22;
  float col = floor(p.x);
  p.y += t * 11.0 + hash(vec2(col, 3.0)) * 23.0;
  float h = hash(vec2(col, floor(p.y)));
  return smoothstep(0.06 + h * 0.3, 0.0, fract(p.y)) * step(0.72, h);
}

void main() {
  float g = uGlitch;
  // graines de temps repliées : elles doivent rester petites
  float tLine = mod(floor(uTime * 17.0), 251.0);
  float tBlock = mod(floor(uTime * 12.0), 211.0);
  float tMosh = mod(floor(uTime * 6.0), 173.0);

  vec2 uv = curve(vUv, uCurve);
  vec2 hudUv = uv;

  // --- décrochage par lignes : la tête de lecture saute
  float lineId = floor(uv.y * 54.0);
  float lh = hash(vec2(lineId, tLine));
  float lineOn = step(1.0 - g * 0.42, lh);
  float shift = lineOn * (lh - 0.5) * 0.17 * g;
  uv.x += shift;
  hudUv.x += shift * 0.45;

  // --- blocs déplacés
  vec2 bid = floor(uv * vec2(9.0, 20.0));
  float bh = hash(bid + tBlock * 1.37);
  float bOn = step(1.0 - g * 0.3, bh);
  vec2 bOff = (vec2(hash(bid + 1.7), hash(bid + 4.3)) - 0.5) * 0.17 * g * bOn;
  uv += bOff;
  hudUv += bOff * 0.3;

  // --- séparation des composantes, qui s'ouvre avec la vitesse et le tempo
  float split = 0.0012 + g * 0.014 + uSpeed * 0.0035 + uBeat * 0.0025;
  vec2 dir = normalize(vUv - 0.5 + 1e-5);

  vec3 col;
  col.r = texture2D(tScene, uv + dir * split).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - dir * split).b;

  // --- filé radial : quatre prises vers le centre, pondérées par la vitesse
  float streak = smoothstep(0.25, 1.0, uSpeed) * 0.55;
  if (streak > 0.001) {
    vec3 blur = vec3(0.0);
    for (int i = 1; i <= 4; i++) {
      float k = float(i) / 4.0;
      blur += texture2D(tScene, uv - dir * k * 0.035 * streak).rgb;
    }
    col = mix(col, blur * 0.25, streak * 0.5);
  }

  // --- datamosh : on recolle un morceau d'ailleurs, dans une palette cassée
  float moshGate = step(1.0 - g * 0.22, hash(bid * 2.1 + tMosh));
  if (moshGate > 0.5) {
    vec3 mosh = texture2D(tScene, fract(uv + vec2(0.31, 0.17))).gbr;
    col = mix(col, mosh * vec3(1.55, 0.5, 1.75), 0.62 * g);
  }

  // --- coup contre un mur
  col += vec3(1.0, 0.25, 0.45) * uFlash * 0.4;

  // --- éclair. C'est une lumière : elle agit en linéaire, avant la conversion
  // d'affichage, et surtout elle *multiplie* la scène au lieu de s'y ajouter.
  // Ajoutée uniformément, elle relevait aussi le noir et délavait l'image en
  // une bouillie bleue ; multipliée, elle brûle ce qui est éclairé et laisse
  // les ombres sombres, ce qui est le propre d'un éclair.
  col += col * uBolt * 5.0 + vec3(0.60, 0.72, 1.0) * uBolt * 0.16;

  // --- teinte du circuit, très légère, pour que chaque tracé ait sa couleur
  col = mix(col, col * uTint, 0.22);

  // passage en valeurs d'affichage : tout ce qui suit imite un écran
  col = toDisplay(col);

  // --- averse, par-dessus l'image mais sous le tableau de bord
  if (uRain > 0.001) {
    float r = rainfall(uv, uTime, 1.0) + rainfall(uv + 0.37, uTime * 1.5, 1.6) * 0.55;
    col += vec3(0.46, 0.56, 0.66) * r * uRain * 0.22;
  }

  // --- tableau de bord, dans la même géométrie dégradée
  vec4 hud = texture2D(tHud, hudUv);
  col = mix(col, hud.rgb, hud.a);

  // --- battement de la musique
  col *= 1.0 + uBeat * 0.07;

  // --- lignes de balayage calées sur la définition interne
  col *= 0.88 + 0.12 * cos(uv.y * uInternal.y * 3.14159);
  col *= 0.94 + 0.06 * cos(uv.x * uOutput.x * 1.5708);

  // --- réduction à 15 bits avec tramage
  float levels = 31.0;
  col = floor((col + (bayer(gl_FragCoord.xy) - 0.5) / levels) * levels + 0.5) / levels;

  // --- vignette et bords du tube
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.42;
  vec2 edge = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  col *= edge.x * edge.y;

  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export function createPost(renderer) {
  const target = new WebGLRenderTarget(256, 448, {
    format: RGBAFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });

  const uniforms = {
    tScene: new Uniform(target.texture),
    tHud: new Uniform(null),
    uOutput: new Uniform(new Vector2(1, 1)),
    uInternal: new Uniform(new Vector2(256, 448)),
    uTime: new Uniform(0),
    uGlitch: new Uniform(0),
    uSpeed: new Uniform(0),
    uFlash: new Uniform(0),
    uFade: new Uniform(1),
    uCurve: new Uniform(0.62),
    uRain: new Uniform(0),
    uBolt: new Uniform(0),
    uBeat: new Uniform(0),
    uTint: new Uniform(new Vector3(1, 1, 1)),
  };

  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const quadScene = new Scene();
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const tint = new Color();

  function resize(outW, outH, innerW, innerH) {
    target.setSize(innerW, innerH);
    uniforms.uOutput.value.set(outW, outH);
    uniforms.uInternal.value.set(innerW, innerH);
  }

  /** Teinte du circuit : on garde la couleur d'accent, très diluée. */
  function setTheme(theme) {
    tint.set(theme.accent);
    uniforms.uTint.value.set(
      0.55 + tint.r * 0.75,
      0.55 + tint.g * 0.75,
      0.55 + tint.b * 0.75
    );
    uniforms.uRain.value = theme.rain || 0;
  }

  function render(scene, camera) {
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCamera);
  }

  return { target, uniforms, resize, setTheme, render };
}
