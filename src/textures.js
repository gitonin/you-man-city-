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
 */

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function surface(w, h) {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { el, ctx };
}

function finish(el, { repeat = [1, 1], mipmaps = true, srgb = true } = {}) {
  const tex = new CanvasTexture(el);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = mipmaps ? NearestMipmapLinearFilter : NearestFilter;
  tex.generateMipmaps = mipmaps;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 1;
  return tex;
}

/** Bruit granuleux, posé par petits carrés pour rester « texel ». */
function grain(ctx, w, h, amount, size = 1) {
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
export function makeRoadTexture() {
  const W = 128;
  const H = 128;
  const { el, ctx } = surface(W, H);

  ctx.fillStyle = '#3e454d';
  ctx.fillRect(0, 0, W, H);

  // deux teintes de bitume, par bandes longitudinales
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = pick(['#464e58', '#343b43', '#4f5862']);
    ctx.fillRect(Math.floor(rand(0, W)), 0, Math.floor(rand(2, 9)), H);
  }
  grain(ctx, W, H, 0.09, 2);

  // bords : liseré clair puis bande rouge/blanche
  const edge = 10;
  const edgeInset = edge + 7;
  ctx.fillStyle = '#9aa6b2';
  ctx.fillRect(0, 0, edge, H);
  ctx.fillRect(W - edge, 0, edge, H);
  for (let y = 0; y < H; y += 16) {
    ctx.fillStyle = (y / 16) % 2 ? '#d8e2ec' : '#c0392f';
    ctx.fillRect(0, y, edge, 16);
    ctx.fillRect(W - edge, y, edge, 16);
  }

  // axe central en pointillés, plus deux lignes de rive
  ctx.fillStyle = '#f0f6fc';
  ctx.fillRect(W / 2 - 4, 0, 8, 52);
  ctx.fillStyle = 'rgba(210, 228, 244, 0.5)';
  ctx.fillRect(edgeInset, 0, 2, H);
  ctx.fillRect(W - edgeInset - 2, 0, 2, H);

  // marques d'usure dans les traces de passage
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#10141a';
  ctx.fillRect(W * 0.26, 0, 12, H);
  ctx.fillRect(W * 0.66, 0, 12, H);
  ctx.globalAlpha = 1;

  return finish(el);
}

/** Murs latéraux : panneaux, rivets, bandes publicitaires. */
export function makeWallTexture() {
  const W = 128;
  const H = 64;
  const { el, ctx } = surface(W, H);

  ctx.fillStyle = '#4a545f';
  ctx.fillRect(0, 0, W, H);

  // panneaux
  for (let x = 0; x < W; x += 32) {
    ctx.fillStyle = pick(['#4f5a66', '#434d58', '#5a6672']);
    ctx.fillRect(x + 1, 2, 30, H - 4);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, 0, 1, H);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 1, 2, 30, 1);
  }

  // rivets
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = 6; x < W; x += 32) {
    for (let y = 8; y < H; y += 20) ctx.fillRect(x, y, 2, 2);
  }

  // bandeau lumineux en haut : le liseré néon de la piste
  ctx.fillStyle = '#1b6f8c';
  ctx.fillRect(0, 0, W, 5);
  ctx.fillStyle = '#6fe6ff';
  ctx.fillRect(0, 1, W, 3);
  for (let x = 0; x < W; x += 24) {
    ctx.fillStyle = '#0e2630';
    ctx.fillRect(x, 1, 3, 3);
  }

  grain(ctx, W, H, 0.07, 2);
  return finish(el);
}

/** Voûte des tunnels : nervures de béton. */
export function makeTunnelTexture() {
  const W = 64;
  const H = 64;
  const { el, ctx } = surface(W, H);

  ctx.fillStyle = '#5c636b';
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 16) {
    ctx.fillStyle = '#3c4147';
    ctx.fillRect(0, y, W, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(0, y + 5, W, 1);
  }
  for (let x = 0; x < W; x += 21) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, 0, 2, H);
  }
  grain(ctx, W, H, 0.1, 2);
  return finish(el);
}

/** Panneaux-réclames des bas-côtés, dans l'esprit des circuits d'époque. */
export function makeBillboardTexture() {
  const W = 128;
  const H = 64;
  const { el, ctx } = surface(W, H);

  const bg = pick(['#101820', '#1b1020', '#07141a']);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const ink = pick(['#ff2e6b', '#3cf0ff', '#ffa023', '#b57bff']);
  ctx.fillStyle = ink;
  ctx.fillRect(4, 4, W - 8, 3);
  ctx.fillRect(4, H - 7, W - 8, 3);

  // faux lettrage : des blocs, lisibles de loin, illisibles de près
  let x = 10;
  while (x < W - 16) {
    const w = Math.floor(rand(5, 14));
    ctx.fillStyle = Math.random() < 0.72 ? '#e9f2fa' : ink;
    ctx.fillRect(x, 18, w, Math.floor(rand(16, 28)));
    x += w + Math.floor(rand(3, 7));
  }
  grain(ctx, W, H, 0.12, 2);
  return finish(el, { mipmaps: true });
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
  return finish(el, { mipmaps: true });
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
  return finish(el, { mipmaps: true });
}

/** Façades du décor lointain : fenêtres allumées sur béton sombre. */
export function makeBuildingTexture() {
  const W = 64;
  const H = 128;
  const { el, ctx } = surface(W, H);

  ctx.fillStyle = '#10161d';
  ctx.fillRect(0, 0, W, H);
  for (let y = 4; y < H - 4; y += 8) {
    for (let x = 4; x < W - 4; x += 8) {
      if (Math.random() < 0.42) {
        ctx.fillStyle = pick(['#6fe6ff', '#ffb45c', '#e8f2ff', '#ff5e8a']);
        ctx.globalAlpha = rand(0.4, 1);
        ctx.fillRect(x, y, 4, 4);
        ctx.globalAlpha = 1;
      }
    }
  }
  grain(ctx, W, H, 0.08, 2);
  return finish(el);
}

/** Ciel : dégradé crasseux et une poignée de nuées. */
export function makeSkyTexture() {
  const W = 32;
  const H = 128;
  const { el, ctx } = surface(W, H);

  // La sphère est parcourue du pôle sud (bas de la texture) au pôle nord
  // (haut) : la lueur d'horizon doit donc tomber au milieu du canvas.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, '#04060b');  // zénith
  g.addColorStop(0.30, '#0a1220');
  g.addColorStop(0.44, '#1c2a44');
  g.addColorStop(0.49, '#4a5468');
  g.addColorStop(0.515, '#8a6a55'); // bande d'horizon, étroite
  g.addColorStop(0.55, '#17161e');
  g.addColorStop(1.0, '#04060a');  // nadir, masqué par le sol
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // nuées rasantes, juste au-dessus de l'horizon
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 44; i++) {
    ctx.fillStyle = pick(['#ff7a3c', '#4bc9ff', '#ffd9b0']);
    ctx.fillRect(rand(0, W), rand(H * 0.42, H * 0.52), rand(2, 10), rand(1, 3));
  }
  ctx.globalAlpha = 1;

  // étoiles clairsemées, vers le zénith
  ctx.fillStyle = '#cfe0ff';
  for (let i = 0; i < 34; i++) ctx.fillRect(rand(0, W), rand(0, H * 0.34), 1, 1);

  const tex = finish(el, { mipmaps: false });
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}

/** Sol hors piste : une trame sombre qui donne l'échelle en défilant. */
export function makeGroundTexture() {
  const W = 64;
  const H = 64;
  const { el, ctx } = surface(W, H);
  ctx.fillStyle = '#121a22';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(80, 140, 170, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0.5); ctx.lineTo(W, 0.5);
  ctx.moveTo(0.5, 0); ctx.lineTo(0.5, H);
  ctx.stroke();
  grain(ctx, W, H, 0.05, 2);
  return finish(el, { repeat: [1, 1] });
}
