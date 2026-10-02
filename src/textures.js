import {
  CanvasTexture,
  LinearFilter,
  NearestFilter,
  NearestMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

/**
 * Toutes les textures sont peintes au canvas, en petit (64 à 128 px) et avec
 * peu de couleurs — comme celles que la console pouvait tenir en mémoire.
 * Filtrage au plus proche voisin : les texels doivent rester carrés.
 *
 * Chaque fabrique prend la palette du thème, si bien qu'un seul jeu de
 * fonctions habille les quatre circuits.
 */

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

let ANISOTROPY = 1;
export function setTextureAnisotropy(n) {
  ANISOTROPY = Math.max(1, n | 0);
}

function surface(w, h) {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { el, ctx };
}

function finish(el, { repeat = [1, 1], mipmaps = true, srgb = true, smooth = false } = {}) {
  const tex = new CanvasTexture(el);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.magFilter = smooth ? LinearFilter : NearestFilter;
  tex.minFilter = mipmaps ? NearestMipmapLinearFilter : LinearFilter;
  tex.generateMipmaps = mipmaps;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = ANISOTROPY;
  return tex;
}

/** Bruit granuleux, posé par petits carrés pour rester « texel ». */
function grain(ctx, w, h, amount, size = 2) {
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      const v = (Math.random() - 0.5) * amount;
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      ctx.fillRect(x, y, size, size);
    }
  }
}

/**
 * Revêtement de piste. L'axe X est la largeur (u), l'axe Y la longueur (v) :
 * la bande se répète le long du circuit, jamais en travers.
 */
export function makeRoadTexture(theme) {
  const W = 128;
  const H = 128;
  const { el, ctx } = surface(W, H);
  const p = theme.road;

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = pick(p.shades);
    ctx.fillRect(Math.floor(rand(0, W)), 0, Math.floor(rand(2, 9)), H);
  }
  grain(ctx, W, H, 0.09);

  const edge = 10;
  const inset = edge + 7;
  ctx.fillStyle = p.kerb[0];
  ctx.fillRect(0, 0, edge, H);
  ctx.fillRect(W - edge, 0, edge, H);
  for (let y = 0; y < H; y += 16) {
    ctx.fillStyle = (y / 16) % 2 ? p.kerb[0] : p.kerb[1];
    ctx.fillRect(0, y, edge, 16);
    ctx.fillRect(W - edge, y, edge, 16);
  }

  ctx.fillStyle = '#f0f6fc';
  ctx.fillRect(W / 2 - 4, 0, 8, 52);
  ctx.fillStyle = 'rgba(210, 228, 244, 0.42)';
  ctx.fillRect(inset, 0, 2, H);
  ctx.fillRect(W - inset - 2, 0, 2, H);

  // traces de passage
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#10141a';
  ctx.fillRect(W * 0.26, 0, 12, H);
  ctx.fillRect(W * 0.66, 0, 12, H);
  ctx.globalAlpha = 1;

  return finish(el);
}

/** Murs latéraux : panneaux, rivets, bandeau lumineux. */
export function makeWallTexture(theme) {
  const W = 128;
  const H = 64;
  const { el, ctx } = surface(W, H);
  const p = theme.wall;

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 32) {
    ctx.fillStyle = pick(p.panels);
    ctx.fillRect(x + 1, 2, 30, H - 4);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, 0, 1, H);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 1, 2, 30, 1);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = 6; x < W; x += 32) {
    for (let y = 8; y < H; y += 20) ctx.fillRect(x, y, 2, 2);
  }

  ctx.fillStyle = p.stripDark;
  ctx.fillRect(0, 0, W, 5);
  ctx.fillStyle = p.strip;
  ctx.fillRect(0, 1, W, 3);
  for (let x = 0; x < W; x += 24) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, 1, 3, 3);
  }

  grain(ctx, W, H, 0.07);
  return finish(el);
}

/** Voûte des tunnels. Pour le tube chromatique, des écrans plutôt que du béton. */
export function makeTunnelTexture(theme) {
  const W = 64;
  const H = 64;
  const { el, ctx } = surface(W, H);

  if (theme.scenery === 'tube') {
    ctx.fillStyle = '#0b0518';
    ctx.fillRect(0, 0, W, H);
    // dalles d'écrans : des bandes de couleurs pures, comme une mire
    for (let y = 0; y < H; y += 16) {
      for (let x = 0; x < W; x += 16) {
        ctx.fillStyle = '#140a26';
        ctx.fillRect(x + 1, y + 1, 14, 14);
        const hue = (x / W + y / H) * 360;
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = `hsl(${(hue + k * 34) % 360}, 95%, ${48 + k * 4}%)`;
          ctx.fillRect(x + 2, y + 2 + k * 2, 12, 2);
        }
      }
    }
    return finish(el);
  }

  ctx.fillStyle = theme.wall.base;
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 16) {
    ctx.fillStyle = pick(theme.wall.panels);
    ctx.fillRect(0, y, W, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(0, y + 5, W, 1);
  }
  for (let x = 0; x < W; x += 21) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, 0, 2, H);
  }
  grain(ctx, W, H, 0.1);
  return finish(el);
}

/** Panneaux-réclames des bas-côtés. */
export function makeBillboardTexture(theme) {
  const W = 128;
  const H = 64;
  const { el, ctx } = surface(W, H);

  ctx.fillStyle = pick(['#101820', '#1b1020', '#07141a']);
  ctx.fillRect(0, 0, W, H);

  const ink = pick(theme.billboards);
  ctx.fillStyle = ink;
  ctx.fillRect(4, 4, W - 8, 3);
  ctx.fillRect(4, H - 7, W - 8, 3);

  let x = 10;
  while (x < W - 16) {
    const w = Math.floor(rand(5, 14));
    ctx.fillStyle = Math.random() < 0.72 ? '#e9f2fa' : ink;
    ctx.fillRect(x, 18, w, Math.floor(rand(16, 28)));
    x += w + Math.floor(rand(3, 7));
  }
  grain(ctx, W, H, 0.12);
  return finish(el);
}

/** Plaque de survitesse : chevrons orange. */
export function makeBoostTexture() {
  const W = 64;
  const H = 64;
  const { el, ctx } = surface(W, H);
  ctx.fillStyle = '#120b00';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) {
    const y = 6 + i * 20;
    ctx.fillStyle = ['#ffd27a', '#ffa023', '#ff6a00'][i];
    ctx.beginPath();
    ctx.moveTo(6, y + 14);
    ctx.lineTo(W / 2, y);
    ctx.lineTo(W - 6, y + 14);
    ctx.lineTo(W - 6, y + 20);
    ctx.lineTo(W / 2, y + 6);
    ctx.lineTo(6, y + 20);
    ctx.closePath();
    ctx.fill();
  }
  return finish(el);
}

/** Ligne de départ : damier. */
export function makeStartTexture() {
  const W = 64;
  const H = 32;
  const { el, ctx } = surface(W, H);
  const c = 8;
  for (let y = 0; y < H; y += c) {
    for (let x = 0; x < W; x += c) {
      ctx.fillStyle = ((x / c + y / c) % 2) ? '#f2f6fa' : '#15191f';
      ctx.fillRect(x, y, c, c);
    }
  }
  return finish(el);
}

/** Façades du décor : fenêtres allumées sur béton sombre. */
export function makeBuildingTexture(theme) {
  const W = 64;
  const H = 128;
  const { el, ctx } = surface(W, H);
  const lit = theme.scenery === 'blocks' ? 0.1 : 0.42;

  ctx.fillStyle = theme.scenery === 'blocks' ? '#3b434a' : '#10161d';
  ctx.fillRect(0, 0, W, H);
  for (let y = 4; y < H - 4; y += 8) {
    for (let x = 4; x < W - 4; x += 8) {
      if (Math.random() < lit) {
        ctx.fillStyle = pick(theme.windows);
        ctx.globalAlpha = rand(0.4, 1);
        ctx.fillRect(x, y, 4, 4);
        ctx.globalAlpha = 1;
      }
    }
  }
  if (theme.scenery === 'blocks') {
    // béton nu : des joints de banche plutôt que des fenêtres
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 0; y < H; y += 16) ctx.fillRect(0, y, W, 1);
    for (let x = 0; x < W; x += 21) ctx.fillRect(x, 0, 1, H);
  }
  grain(ctx, W, H, 0.09);
  return finish(el);
}

/** Ciel : dégradé du thème, sur une sphère parcourue du nadir au zénith. */
export function makeSkyTexture(theme) {
  const W = 32;
  const H = 128;
  const { el, ctx } = surface(W, H);

  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [stop, color] of theme.sky) g.addColorStop(stop, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (theme.scenery !== 'space') {
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 44; i++) {
      ctx.fillStyle = pick(theme.billboards);
      ctx.fillRect(rand(0, W), rand(H * 0.42, H * 0.52), rand(2, 10), rand(1, 3));
    }
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = '#cfe0ff';
  for (let i = 0; i < theme.stars; i++) {
    const s = Math.random() < 0.15 ? 2 : 1;
    ctx.fillRect(rand(0, W), rand(0, H * (theme.scenery === 'space' ? 0.95 : 0.34)), s, s);
  }

  return finish(el, { mipmaps: false, smooth: true });
}

/** Sol hors piste. */
export function makeGroundTexture(theme) {
  const W = 64;
  const H = 64;
  const { el, ctx } = surface(W, H);
  ctx.fillStyle = theme.scenery === 'blocks' ? '#272d33' : '#121a22';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = theme.scenery === 'blocks'
    ? 'rgba(150, 165, 178, 0.18)'
    : 'rgba(80, 140, 170, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0.5); ctx.lineTo(W, 0.5);
  ctx.moveTo(0.5, 0); ctx.lineTo(0.5, H);
  ctx.stroke();
  grain(ctx, W, H, 0.05);
  return finish(el);
}

/** Roche des météorites. */
export function makeRockTexture() {
  const W = 64;
  const H = 64;
  const { el, ctx } = surface(W, H);
  ctx.fillStyle = '#3a3a42';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = pick(['#2d2d35', '#45454f', '#52525e', '#262630']);
    ctx.fillRect(rand(0, W), rand(0, H), rand(3, 12), rand(3, 12));
  }
  grain(ctx, W, H, 0.14);
  return finish(el);
}

/** Anneau de poussière, vu à plat : des sillons concentriques. */
export function makeRingTexture() {
  const W = 256;
  const H = 8;
  const { el, ctx } = surface(W, H);
  for (let x = 0; x < W; x++) {
    const t = x / W;
    const band = Math.sin(t * 54) * 0.5 + 0.5;
    const gap = Math.sin(t * 13 + 1.2) > 0.82 ? 0.12 : 1;
    const a = (0.1 + band * 0.5) * gap * (1 - Math.abs(t - 0.5) * 1.3);
    ctx.fillStyle = `rgba(${210 - band * 50 | 0}, ${190 - band * 40 | 0}, ${170 + band * 30 | 0}, ${Math.max(0, a)})`;
    ctx.fillRect(x, 0, 1, H);
  }
  return finish(el, { mipmaps: false, smooth: true });
}

/** Portique rythmique : une barre lumineuse. */
export function makeGateTexture() {
  const W = 32;
  const H = 32;
  const { el, ctx } = surface(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.42, 'rgba(255,255,255,1)');
  g.addColorStop(0.58, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return finish(el, { mipmaps: false, srgb: false, smooth: true });
}

/** Halo radial, pour les réacteurs et les lueurs. */
export function makeGlowTexture(size = 64) {
  const { el, ctx } = surface(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    g.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, 2.4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(el, { mipmaps: false, srgb: false, smooth: true });
}
