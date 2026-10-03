import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Object3D,
  PlaneGeometry,
} from 'three';

import { SHIP } from './config.js';
import { bakeVertexLight, psxMaterial } from './psx.js';
import { makeGateTexture, makeGlowTexture, makeRockTexture, makeWallTexture } from './textures.js';

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Les barrages du parcours bonus.
 *
 * Un barrage est un rideau de roche en travers de la piste, **percé d'une
 * ouverture dont la position est tirée au sort**. C'est l'ouverture qui est
 * placée en premier et les blocs qui en découlent, jamais l'inverse : poser
 * des blocs au hasard produirait tôt ou tard un mur sans passage, et un
 * parcours où l'on ne peut que mourir n'est pas un parcours.
 *
 * Les blocs ne sont pas des objets physiques. Comme tout le reste du jeu, ils
 * vivent en espace piste — une abscisse curviligne, un intervalle latéral — et
 * la collision est un test de franchissement sur deux scalaires.
 */
export function createObstacles(scene, track, theme) {
  const spec = theme.obstacles;
  const group = new Group();
  if (!spec) return { group, reset() {}, update: () => false, passed: 0, total: 0 };
  scene.add(group);

  const limit = track.halfWidth - SHIP.halfWidth;
  /** Demi-largeur du couloir laissé libre. Au-delà, ce n'est plus un passage. */
  const GAP = spec.gap;

  /** @type {{dist:number, from:number, to:number, hit:boolean}[]} */
  const blocks = [];
  /** @type {number[]} abscisses des ouvertures, pour le balisage */
  const gates = [];

  // --- choix des ouvertures, puis des blocs qui les encadrent
  const span = track.length - spec.lead - spec.tail;
  for (let i = 0; i < spec.count; i++) {
    // léger resserrement vers la fin : le parcours doit monter en tension
    const u = i / Math.max(1, spec.count - 1);
    const dist = spec.lead + span * Math.pow(u, 0.88);
    const gap = rand(-limit + GAP, limit - GAP);
    gates.push({ dist, gap });

    if (gap - GAP > -limit + 3) blocks.push({ dist, from: -limit - 6, to: gap - GAP, hit: false });
    if (gap + GAP < limit - 3) blocks.push({ dist, from: gap + GAP, to: limit + 6, hit: false });
  }

  // ------------------------------------------------------------- géométrie
  //
  // Un éboulis en orbite, un bloc de chantier ailleurs : la même règle de jeu
  // habillée par le décor. L'ombrage est cuit volontairement clair — une masse
  // sombre sur un fond sombre ne se voit pas à trois cents unités.
  const asRock = spec.shape !== 'block';
  const body = asRock ? new IcosahedronGeometry(1, 0) : new BoxGeometry(1, 1, 1);
  {
    if (asRock) {
      const p = body.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = rand(0.68, 1.32);
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      body.computeVertexNormals();
    }
    const normals = body.attributes.normal;
    const colors = new Float32Array(normals.count * 3);
    for (let i = 0; i < normals.count; i++) {
      const [r, g, b] = bakeVertexLight(
        normals.getX(i), normals.getY(i), normals.getZ(i), 0.52, 0.5
      );
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    }
    body.setAttribute('color', new BufferAttribute(colors, 3));
  }

  const accentCss = `#${theme.accent.toString(16).padStart(6, '0')}`;
  /** Trois corps par bloc : un seul, étiré, se verrait trop pour ce qu'il est. */
  const PER_BLOCK = 3;
  const rocks = new InstancedMesh(
    body,
    psxMaterial({ map: asRock ? makeRockTexture(accentCss) : makeWallTexture(theme) }),
    blocks.length * PER_BLOCK
  );
  rocks.frustumCulled = false;
  group.add(rocks);

  const dummy = new Object3D();
  const basis = new Matrix4();
  const { pos, tan, nrm, bin } = track.raw;
  const N = track.samples;

  /** Repère de piste à l'échantillon `i`, colonnes X = travers, Y = normale. */
  const frameAt = (i, lat, up) => basis.set(
    bin[i * 3], nrm[i * 3], tan[i * 3],
    pos[i * 3] + bin[i * 3] * lat + nrm[i * 3] * up,
    bin[i * 3 + 1], nrm[i * 3 + 1], tan[i * 3 + 1],
    pos[i * 3 + 1] + bin[i * 3 + 1] * lat + nrm[i * 3 + 1] * up,
    bin[i * 3 + 2], nrm[i * 3 + 2], tan[i * 3 + 2],
    pos[i * 3 + 2] + bin[i * 3 + 2] * lat + nrm[i * 3 + 2] * up,
    0, 0, 0, 1
  );

  const sampleOf = (d) => Math.floor((d / track.length) * N) % N;

  let k = 0;
  for (const b of blocks) {
    const i = sampleOf(b.dist);
    const width = b.to - b.from;
    for (let j = 0; j < PER_BLOCK; j++) {
      const lat = b.from + (width * (j + 0.5)) / PER_BLOCK;
      // assez haut pour faire écran : un caillou à ras de bitume ne se lit pas
      const size = Math.max(7, (width / PER_BLOCK) * rand(0.72, 0.98));
      dummy.position.set(0, 0, 0);
      if (asRock) {
        dummy.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
        dummy.scale.set(size, size * rand(1.1, 1.6), size * rand(0.7, 1.1));
      } else {
        // un bloc de chantier est posé droit, et seulement pivoté d'un rien
        dummy.rotation.set(0, rand(-0.18, 0.18), 0);
        dummy.scale.set(size * 1.05, size * rand(1.2, 1.7), size * rand(0.5, 0.8));
      }
      dummy.updateMatrix();
      rocks.setMatrixAt(k++, frameAt(i, lat, size * 0.45).multiply(dummy.matrix));
    }
  }
  rocks.instanceMatrix.needsUpdate = true;

  // ------------------------------------------------------------- balisage
  //
  // La roche, même éclaircie, reste une masse sombre sur un fond noir : à
  // cette vitesse elle se voit trop tard. On souligne donc chaque barrage
  // d'un bandeau lumineux de sa propre largeur, et on plante deux montants
  // aux lèvres de l'ouverture. Le dessin qui en résulte se lit d'un coup :
  // deux barres, un trou entre elles, et le trou est là où il faut passer.
  const glowMat = (map) => psxMaterial({
    map,
    color: theme.accent,
    vertexColors: false,
    affine: false,
    snap: false,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });

  // Le bandeau prend la texture des portiques — un dégradé vertical — plutôt
  // qu'un halo radial : étiré sur vingt unités de large, un halo devient une
  // tache molle, tandis qu'un dégradé vertical reste une barre franche.
  const bars = new InstancedMesh(
    new PlaneGeometry(1, 4.2), glowMat(makeGateTexture()), blocks.length
  );
  bars.frustumCulled = false;
  bars.renderOrder = 3;
  {
    const stretch = new Matrix4();
    for (let b = 0; b < blocks.length; b++) {
      const blk = blocks[b];
      const i = sampleOf(blk.dist);
      stretch.makeScale(blk.to - blk.from, 1, 1);
      bars.setMatrixAt(b, frameAt(i, (blk.from + blk.to) / 2, 15).multiply(stretch));
    }
    bars.instanceMatrix.needsUpdate = true;
  }
  group.add(bars);

  const marks = new InstancedMesh(
    new PlaneGeometry(2.8, 24), glowMat(makeGlowTexture()), gates.length * 2
  );
  marks.frustumCulled = false;
  marks.renderOrder = 3;
  {
    let m = 0;
    for (const g of gates) {
      const i = sampleOf(g.dist);
      // le montant fait face à celui qui arrive : son axe Z suit la tangente
      for (const side of [-1, 1]) marks.setMatrixAt(m++, frameAt(i, g.gap + side * GAP, 10));
    }
    marks.instanceMatrix.needsUpdate = true;
  }
  group.add(marks);

  const color = new Color();
  let passed = 0;

  function reset() {
    passed = 0;
    for (const b of blocks) b.hit = false;
    for (let m = 0; m < gates.length * 2; m++) marks.setColorAt(m, color.set(theme.accent));
    if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
  }

  /**
   * @param {number} prevS abscisse à l'image précédente
   * @param {number} s abscisse courante
   * @param {number} x écart latéral
   * @returns {boolean} vrai si un barrage vient d'être touché
   */
  function update(prevS, s, x) {
    if (s <= prevS) return false;
    let struck = false;
    for (const b of blocks) {
      if (b.hit || b.dist <= prevS || b.dist > s) continue;
      b.hit = true;
      if (x + SHIP.halfWidth > b.from && x - SHIP.halfWidth < b.to) struck = true;
    }
    for (const g of gates) {
      if (g.dist > prevS && g.dist <= s) passed += 1;
    }
    return struck;
  }

  /**
   * Centre de l'ouverture la plus proche devant `s`, ou `null` s'il n'y a rien
   * dans la fenêtre. Les adversaires s'en servent pour viser le trou plutôt
   * que de traverser la roche.
   */
  function gapNear(s, ahead) {
    const len = track.length;
    const from = ((s % len) + len) % len;
    let best = null;
    let bestGap = Infinity;
    for (const g of gates) {
      let d = g.dist - from;
      if (d < 0) d += len;
      if (d < ahead && d < bestGap) { bestGap = d; best = g.gap; }
    }
    return best;
  }

  reset();
  return {
    group,
    reset,
    update,
    gapNear,
    gates,
    get passed() { return passed; },
    get total() { return gates.length; },
  };
}
