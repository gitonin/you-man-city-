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
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** mm:ss.cc, découpé pour afficher les centièmes en petit. */
function splitTime(seconds) {
  const s = Math.max(0, seconds);
  return {
    main: `${Math.floor(s / 60)}:${pad2(s % 60)}`,
    frac: pad2((s * 100) % 100),
  };
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

  function panel(x, y, w, h, alpha = 0.55) {
    ctx.fillStyle = `rgba(8, 14, 20, ${alpha})`;
    ctx.fillRect(x, y, w, h);
  }

  /**
   * @param {object} v
   * @param {number} v.lap, v.laps, v.rank, v.field
   * @param {number} v.lapTime, v.bestLap, v.totalTime
   * @param {number} v.speed      affichée telle quelle
   * @param {number} v.shield     0..100
   * @param {number} v.throttle   0..1
   * @param {number} v.boost      0..1
   * @param {number} v.turbo      0..1
   * @param {number} v.pulse      battement de la musique, 0..1
   * @param {string} [v.center]   gros message centré
   * @param {string} [v.sub]      ligne sous le message
   * @param {boolean} [v.bare]    n'affiche que le message : écran de titre
   */
  function draw(v) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // L'unité du tableau de bord suit la *hauteur* de la cible de rendu, pas
    // sa largeur : c'est elle qui reste constante quand on passe le cadre en
    // paysage. Sur la largeur, le HUD quintuplerait de taille au basculement.
    const m = Math.max(1, Math.floor(H / 420));
    const big = m * 3;
    /** Cadre couché : la place manque en hauteur, pas en largeur. */
    const wideHud = W > H * 1.2;
    // Le bombement du tube repousse les coins, et d'autant plus que l'image
    // est large : un cadre couché rognait le bandeau haut et le bas.
    const pad = (wideHud ? 17 : 9) * m;
    const padBottom = (wideHud ? 38 : 20) * m;
    const rightEdge = W - pad;

    if (v.bare) {
      if (v.center) drawCenter(v, W, H, m);
      texture.needsUpdate = true;
      return;
    }

    // ---------------------------------------------------------- bandeau haut
    const lapText = `${Math.min(v.lap + 1, v.laps)}/${v.laps}`;
    const posText = `POS ${v.rank}/${v.field}`;
    panel(
      pad, pad,
      Math.max(measure(lapText, big), measure(posText, m)) + 6 * m,
      7 * big + 11 * m + 8 * m
    );
    write('LAP', pad + 3 * m, pad + 2 * m, m, DIM);
    write(lapText, pad + 3 * m, pad + 10 * m, big, INK);
    write(posText, pad + 3 * m, pad + 7 * big + 12 * m, m,
      v.rank === 1 ? CYAN : 'rgba(205, 224, 244, 0.85)');

    const tt = splitTime(v.totalTime);
    const mainW = measure(tt.main, big);
    const fracW = measure(tt.frac, m);
    panel(rightEdge - mainW - fracW - 7 * m, pad, mainW + fracW + 7 * m, 7 * big + 4 * m);
    writeRight(tt.frac, rightEdge - 2 * m, pad + 9 * m, m, CYAN);
    writeRight(tt.main, rightEdge - fracW - 4 * m, pad + 2 * m, big, INK);

    // --------------------------------------------- inclinomètre, en bas à droite
    //
    // Deux axes à montrer, donc un disque et une bille plutôt qu'une jauge :
    // la bille dit d'un coup d'œil où en est l'appareil dans les deux sens.
    // Horizontalement c'est la direction, verticalement les gaz, et le centre
    // du disque est le neutre — l'angle auquel on tient le téléphone.
    const r = Math.round(H * 0.055);
    const cx = W - pad - r;
    const cy = Math.round(H * 0.74);
    const ring = (radius, style, width = 1) => {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = style;
      ctx.lineWidth = width * m;
      ctx.stroke();
    };

    ctx.fillStyle = 'rgba(8, 14, 20, 0.34)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ring(r, 'rgba(165, 210, 240, 0.62)');

    // repères du neutre
    ctx.fillStyle = 'rgba(165, 210, 240, 0.3)';
    ctx.fillRect(cx - r + 2 * m, cy, 2 * r - 4 * m, 1);
    ctx.fillRect(cx, cy - r + 2 * m, 1, 2 * r - 4 * m);

    // la bille : plein gaz en haut, pied levé en bas
    const bx = cx + clamp(v.steer, -1, 1) * (r - 3 * m);
    const by = cy - (clamp(v.throttle, 0, 1) * 2 - 1) * (r - 3 * m);
    ctx.fillStyle = v.turbo > 0 ? AMBER
      : v.throttle > 0.95 ? '#b9f6ff'
        : v.throttle < 0.08 ? HOT : CYAN;
    ctx.beginPath();
    ctx.arc(bx, by, 2.6 * m, 0, Math.PI * 2);
    ctx.fill();
    // trace vers le neutre, pour lire l'écart et pas seulement la position
    ctx.strokeStyle = 'rgba(95, 240, 255, 0.45)';
    ctx.lineWidth = m;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(bx, by);
    ctx.stroke();

    if (!v.gyro) write('TACT', cx - 11 * m, cy + r + 2 * m, m, DIM);

    // ---------------------------------------------------------- bandeau bas
    const bottom = H - padBottom;
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

    if (v.boost > 0 || v.turbo > 0) {
      ctx.fillStyle = v.turbo > 0 ? '#fff0c0' : AMBER;
      ctx.fillRect(pad, barY - 2 * m, (W - pad * 2) * Math.max(v.boost, v.turbo), m);
    }

    // En portrait, vitesse et chrono ne tiennent pas sur la même ligne : on
    // empile, vitesse en bas puisque c'est elle qu'on surveille. Couché, la
    // largeur ne manque pas et la hauteur si : on les met côte à côte.
    const speedText = v.speed.toFixed(2);
    const lt = splitTime(v.lapTime);
    const speedY = barY - 4 * m - 7 * big;
    const lapY = wideHud ? speedY : speedY - 3 * m - 7 * big;

    writeRight(speedText, rightEdge, speedY, big, INK);
    writeRight('KM/H', rightEdge - measure(speedText, big) - 3 * m, speedY + 8 * m, m, DIM);
    write(lt.main, pad, lapY, big, INK);
    write(lt.frac, pad + measure(lt.main, big) + 3 * m, lapY + 8 * m, m, CYAN);

    const smallY = lapY - 9 * m;
    if (v.bestLap) {
      const bl = splitTime(v.bestLap);
      write(`BEST ${bl.main}.${bl.frac}`, pad, smallY, m, DIM);
    }
    writeRight(`${v.shield.toFixed(1)} SHIELD`, rightEdge, smallY, m, DIM);

    // battement : deux filets qui pulsent sur le tempo du morceau
    if (v.pulse > 0.01) {
      ctx.fillStyle = `rgba(95, 240, 255, ${0.1 + v.pulse * 0.45})`;
      ctx.fillRect(0, 0, W, m);
      ctx.fillRect(0, H - m, W, m);
    }

    if (v.center) drawCenter(v, W, H, m);
    texture.needsUpdate = true;
  }

  /**
   * Le gros message central, et le décompte en particulier.
   *
   * `v.pop` descend de 1 à 0 depuis l'apparition du chiffre. Il fait trois
   * choses à la fois : le chiffre naît grand et se resserre, les trois
   * composantes de couleur partent écartées et se recollent, et le bandeau
   * derrière lui s'ouvre. Un chiffre qui apparaît simplement, à taille fixe,
   * ne donne aucune impulsion — c'est le resserrement qui fait le compte.
   *
   * La fonte étant une matrice de pixels dessinée au carré, le « zoom » est
   * un changement d'échelle entière : on ne peut pas grossir de 1,37, donc on
   * choisit l'entier le plus proche. Le pas se voit, et c'est tant mieux.
   */
  function drawCenter(v, W, H, m) {
    const pop = Math.max(0, Math.min(1, v.pop || 0));
    const base = m * 7;
    const scale = Math.max(1, Math.round(base * (1 + pop * 0.7)));
    const w = measure(v.center, scale);
    const x = Math.round((W - w) / 2);
    const y = Math.round(H * 0.36 - (scale - base) * 3.5);

    // bandeau : il s'ouvre avec le chiffre
    const bandH = 7 * scale + 8 * m;
    ctx.fillStyle = `rgba(6, 10, 16, ${0.5 + pop * 0.28})`;
    ctx.fillRect(0, y - 4 * m, W, bandH);

    const tint = v.center === 'GO' ? CYAN : INK;
    if (pop > 0.02) {
      // séparation des composantes, d'autant plus large que le chiffre est
      // jeune : les deux calques de couleur se recollent sur le blanc
      const off = Math.round(pop * scale * 1.6);
      const jitter = Math.round((Math.random() - 0.5) * pop * scale * 1.2);
      ctx.globalCompositeOperation = 'lighter';
      write(v.center, x - off + jitter, y, scale, 'rgba(255, 46, 107, 0.85)');
      write(v.center, x + off - jitter, y, scale, 'rgba(95, 240, 255, 0.85)');
      ctx.globalCompositeOperation = 'source-over';
    }
    write(v.center, x, y, scale, tint);

    if (v.sub) {
      const sw = measure(v.sub, m);
      write(v.sub, Math.round((W - sw) / 2), y + 7 * scale + 2 * m, m, DIM);
    }
  }

  return { canvas, texture, draw, resize };
}
