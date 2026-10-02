import { CanvasTexture, LinearFilter, NearestFilter, SRGBColorSpace } from 'three';

/**
 * Le tableau de bord, peint sur un canvas à la définition interne du jeu puis
 * injecté dans la passe finale : il subit donc la courbure de l'écran, les
 * lignes de balayage et les décrochages, exactement comme l'image 3D.
 *
 * La fonte est une matrice 5 × 7 dessinée à la main — c'est le seul moyen
 * d'avoir des chiffres parfaitement carrés à cette taille.
 */

const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const GW = 5;
const GH = 7;

const INK = '#e9f3ff';
const CYAN = '#5ff0ff';
const HOT = '#ff2e6b';
const AMBER = '#ffa023';
const DIM = 'rgba(160, 190, 215, 0.55)';

const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');

/** mm:ss.cc, découpé pour pouvoir afficher les centièmes en petit. */
function splitTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return { main: `${m}:${pad2(sec)}`, frac: pad2(cs) };
}

export function createHud() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 448;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;

  function resize(w, h) {
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false;
  }

  /** Largeur qu'occupera `text` à l'échelle `scale`. */
  const measure = (text, scale) => text.length * (GW + 1) * scale - scale;

  function write(text, x, y, scale, color) {
    ctx.fillStyle = color;
    let cx = x;
    for (const ch of text.toUpperCase()) {
      const glyph = GLYPHS[ch];
      if (glyph) {
        for (let r = 0; r < GH; r++) {
          const row = glyph[r];
          for (let c = 0; c < GW; c++) {
            if (row[c] === '1') ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
          }
        }
      }
      cx += (GW + 1) * scale;
    }
    return cx - x;
  }

  const writeRight = (text, right, y, scale, color) =>
    write(text, right - measure(text, scale), y, scale, color);

  /** Panneau sombre derrière un bloc de texte, comme sur les HUD d'époque. */
  function panel(x, y, w, h, alpha = 0.55) {
    ctx.fillStyle = `rgba(8, 14, 20, ${alpha})`;
    ctx.fillRect(x, y, w, h);
  }

  /**
   * @param {object} v
   * @param {number} v.lap
   * @param {number} v.laps
   * @param {number} v.lapTime
   * @param {number} v.bestLap
   * @param {number} v.totalTime
   * @param {number} v.speed      affichée telle quelle
   * @param {number} v.shield     0..100
   * @param {number} v.boost      0..1
   * @param {string} [v.center]   gros message centré
   * @param {string} [v.sub]      ligne sous le message
   * @param {boolean} [v.bare]    n'affiche que le message : écran de titre
   */
  function draw(v) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (v.bare && !v.center) {
      texture.needsUpdate = true;
      return;
    }

    // Un « pixel » de fonte vaut `m` pixels internes ; les gros chiffres en
    // valent trois fois plus. Calé sur la largeur pour tenir sur tout écran.
    const m = Math.max(1, Math.floor(W / 150));
    const big = m * 3;
    const pad = 9 * m;
    // le bombement du tube repousse les coins : le bas a besoin de plus d'air
    const padBottom = 20 * m;

    // ---------------------------------------------------------- bandeau haut
    const lapText = `${Math.min(v.lap + 1, v.laps)}/${v.laps}`;
    panel(pad, pad, measure(lapText, big) + 6 * m, 7 * big + 6 * m);
    write('LAP', pad + 3 * m, pad + 2 * m, m, DIM);
    write(lapText, pad + 3 * m, pad + 2 * m + 8 * m, big, INK);

    const tt = splitTime(v.totalTime);
    const rightEdge = W - pad;
    const mainW = measure(tt.main, big);
    panel(rightEdge - mainW - measure(tt.frac, m) - 7 * m, pad, mainW + measure(tt.frac, m) + 7 * m, 7 * big + 4 * m);
    writeRight(tt.frac, rightEdge - 2 * m, pad + 9 * m, m, CYAN);
    writeRight(tt.main, rightEdge - measure(tt.frac, m) - 4 * m, pad + 2 * m, big, INK);

    // ---------------------------------------------------------- bandeau bas
    const bottom = H - padBottom;

    // jauge de bouclier
    const barH = 4 * m;
    const barY = bottom - barH;
    ctx.fillStyle = 'rgba(8, 14, 20, 0.7)';
    ctx.fillRect(pad, barY, W - pad * 2, barH);
    const fill = Math.max(0, Math.min(1, v.shield / 100)) * (W - pad * 2 - 2);
    const grad = ctx.createLinearGradient(pad, 0, W - pad, 0);
    grad.addColorStop(0, v.shield > 35 ? CYAN : HOT);
    grad.addColorStop(1, v.shield > 35 ? '#b9f6ff' : '#ffb0c6');
    ctx.fillStyle = grad;
    ctx.fillRect(pad + 1, barY + 1, fill, barH - 2);

    // jauge de survitesse, collée au-dessus
    if (v.boost > 0) {
      ctx.fillStyle = AMBER;
      ctx.fillRect(pad, barY - 2 * m, (W - pad * 2) * v.boost, m);
    }

    // En portrait, vitesse et chrono ne tiennent pas sur la même ligne : on
    // empile, vitesse en bas puisque c'est elle qu'on surveille.
    const speedY = barY - 4 * m - 7 * big;
    writeRight(v.speed.toFixed(2), rightEdge, speedY, big, INK);
    writeRight('KM/H', rightEdge - measure(v.speed.toFixed(2), big) - 3 * m, speedY + 8 * m, m, DIM);

    const lt = splitTime(v.lapTime);
    const lapY = speedY - 3 * m - 7 * big;
    write(lt.main, pad, lapY, big, INK);
    write(lt.frac, pad + measure(lt.main, big) + 3 * m, lapY + 8 * m, m, CYAN);

    // rangée des petites légendes, au-dessus
    const smallY = lapY - 9 * m;
    if (v.bestLap) {
      const bl = splitTime(v.bestLap);
      write(`BEST ${bl.main}.${bl.frac}`, pad, smallY, m, DIM);
    }
    writeRight(`${v.shield.toFixed(1)} SHIELD`, rightEdge, smallY, m, DIM);

    // ---------------------------------------------------------- message central
    if (v.center) {
      const scale = m * 4;
      const w = measure(v.center, scale);
      const y = Math.round(H * 0.4);
      ctx.fillStyle = 'rgba(6, 10, 16, 0.5)';
      ctx.fillRect(0, y - 4 * m, W, 7 * scale + 8 * m);
      write(v.center, Math.round((W - w) / 2), y, scale, v.center === 'GO' ? CYAN : INK);
      if (v.sub) {
        const sw = measure(v.sub, m);
        write(v.sub, Math.round((W - sw) / 2), y + 7 * scale + 2 * m, m, DIM);
      }
    }

    texture.needsUpdate = true;
  }

  return { canvas, texture, draw, resize };
}
