import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

/**
 * Toutes les textures sont peintes au canvas : rien à télécharger, et on
 * garde la main sur la densité de fenêtres allumées.
 */

function canvas(w, h) {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  return { el, ctx: el.getContext('2d') };
}

function finish(el, { repeat = false, srgb = true } = {}) {
  const tex = new CanvasTexture(el);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = ANISOTROPY;
  if (repeat) {
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
  }
  return tex;
}

let ANISOTROPY = 1;

/** Le sol est vu en incidence rasante : sans anisotropie il moire. */
export function setTextureAnisotropy(n) {
  ANISOTROPY = Math.max(1, n | 0);
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/**
 * Façade de nuit : mur sombre + trame de fenêtres, une partie allumée.
 *
 * @param {object} o
 * @param {number} o.cols   colonnes de fenêtres
 * @param {number} o.rows   rangées de fenêtres
 * @param {number} o.lit    proportion de fenêtres allumées (0..1)
 * @param {string[]} o.tints teintes possibles des fenêtres allumées
 * @param {string} o.wall   couleur du béton
 */
export function makeFacadeTexture({ cols, rows, lit, tints, wall = '#080a14' }) {
  const cw = 16;
  const ch = 16;
  const { el, ctx } = canvas(cols * cw, rows * ch);

  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, el.width, el.height);

  // léger dégradé vertical : les étages hauts captent plus de smog.
  const grad = ctx.createLinearGradient(0, 0, 0, el.height);
  grad.addColorStop(0, 'rgba(60, 40, 90, 0.32)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, el.width, el.height);

  // rainures horizontales entre étages
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let r = 0; r < rows; r++) ctx.fillRect(0, r * ch + ch - 2, el.width, 2);

  for (let r = 0; r < rows; r++) {
    // certains étages sont entièrement éteints (locaux techniques, vacance)
    const floorDark = Math.random() < 0.13;
    for (let c = 0; c < cols; c++) {
      if (floorDark || Math.random() > lit) continue;
      const x = c * cw + 3;
      const y = r * ch + 3;
      const w = cw - 6;
      const h = ch - 7;
      const tint = pick(tints);

      ctx.globalAlpha = rand(0.45, 1);
      ctx.fillStyle = tint;
      ctx.fillRect(x, y, w, h);

      // halo autour de la vitre
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      ctx.globalAlpha = 1;
    }
  }

  return finish(el, { repeat: true });
}

/** Halo radial doux, utilisé en additif (toits, phares, lampadaires). */
export function makeGlowTexture(size = 128, softness = 2.2) {
  const { el, ctx } = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    g.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, softness)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(el, { srgb: false });
}

/** Bitume : quadrillage de rues, flaques et marquages. */
export function makeGroundTexture(size = 1024, cellPx = 32) {
  const { el, ctx } = canvas(size, size);

  ctx.fillStyle = '#04040a';
  ctx.fillRect(0, 0, size, size);

  // reflets mouillés par plaques
  for (let i = 0; i < 240; i++) {
    const r = rand(12, 90);
    ctx.globalAlpha = rand(0.015, 0.06);
    ctx.fillStyle = pick(['#1c3550', '#2a1840', '#123040']);
    ctx.beginPath();
    ctx.arc(rand(0, size), rand(0, size), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // trame des voies
  ctx.strokeStyle = 'rgba(70, 140, 190, 0.16)';
  ctx.lineWidth = 1.5;
  for (let p = 0; p <= size; p += cellPx) {
    ctx.beginPath();
    ctx.moveTo(p + 0.5, 0);
    ctx.lineTo(p + 0.5, size);
    ctx.moveTo(0, p + 0.5);
    ctx.lineTo(size, p + 0.5);
    ctx.stroke();
  }

  // quelques axes majeurs éclairés
  for (let i = 0; i < 10; i++) {
    const horizontal = Math.random() < 0.5;
    const p = Math.round(rand(0, size / cellPx)) * cellPx;
    ctx.strokeStyle = pick(['rgba(255, 140, 60, 0.2)', 'rgba(60, 200, 255, 0.17)']);
    ctx.lineWidth = rand(2.5, 5);
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(0, p); ctx.lineTo(size, p); }
    else { ctx.moveTo(p, 0); ctx.lineTo(p, size); }
    ctx.stroke();
  }

  const tex = finish(el, { repeat: true });
  tex.repeat.set(6, 6);
  return tex;
}

/** Dégradé de ciel enfumé, appliqué sur une sphère retournée. */
export function makeSkyTexture(w = 32, h = 256) {
  const { el, ctx } = canvas(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, '#05040e');
  g.addColorStop(0.42, '#0c0820');
  g.addColorStop(0.68, '#22112f');
  g.addColorStop(0.85, '#4a1c34');
  g.addColorStop(1.0, '#722a2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // nuées
  for (let i = 0; i < 60; i++) {
    ctx.globalAlpha = rand(0.02, 0.07);
    ctx.fillStyle = pick(['#ff7a3c', '#4bc9ff', '#b06bff']);
    ctx.beginPath();
    ctx.ellipse(rand(0, w), rand(h * 0.55, h), rand(6, 20), rand(2, 7), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  return finish(el, { repeat: true });
}

/** Carré de fenêtre du séquenceur : vitre + reflet, bords adoucis. */
export function makeWindowPaneTexture(size = 96) {
  const { el, ctx } = canvas(size, size);
  const m = size * 0.06;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(m, m, size - m * 2, size - m * 2);

  // meneau en croix
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.fillRect(size / 2 - size * 0.022, m, size * 0.044, size - m * 2);
  ctx.fillRect(m, size * 0.52, size - m * 2, size * 0.03);
  ctx.globalCompositeOperation = 'source-over';

  // reflet diagonal
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(m, size - m);
  ctx.lineTo(size - m, m);
  ctx.lineTo(size - m, size - m);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  return finish(el, { srgb: false });
}
