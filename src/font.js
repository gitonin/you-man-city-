/**
 * Fonte matricielle réduite aux lettres dont on a besoin.
 * Chaque '#' devient une tour ; chaque '.' reste une rue.
 *
 * Les chasses sont volontairement variables (5 ou 4 colonnes) : avec une
 * gouttière d'une colonne, « YOU » et « MAN » font tous deux exactement
 * 16 colonnes — soit une mesure de 16 pas pour le séquenceur.
 */

const GLYPHS = {
  Y: [
    '#...#',
    '#...#',
    '.#.#.',
    '..#..',
    '..#..',
    '..#..',
    '..#..',
  ],
  O: [
    '.###.',
    '#...#',
    '#...#',
    '#...#',
    '#...#',
    '#...#',
    '.###.',
  ],
  U: [
    '#..#',
    '#..#',
    '#..#',
    '#..#',
    '#..#',
    '#..#',
    '.##.',
  ],
  M: [
    '#...#',
    '##.##',
    '#.#.#',
    '#.#.#',
    '#...#',
    '#...#',
    '#...#',
  ],
  A: [
    '..#..',
    '.#.#.',
    '#...#',
    '#...#',
    '#####',
    '#...#',
    '#...#',
  ],
  N: [
    '#..#',
    '##.#',
    '##.#',
    '#.##',
    '#.##',
    '#..#',
    '#..#',
  ],
};

export const GLYPH_H = 7;
const LETTER_GAP = 1;

const glyphWidth = (char) => (GLYPHS[char] ? GLYPHS[char][0].length : 0);

function lineWidth(line) {
  return [...line].reduce((w, c) => w + glyphWidth(c), 0) + (line.length - 1) * LETTER_GAP;
}

/**
 * Compose plusieurs lignes de texte en une seule matrice de booléens.
 *
 * @param {string[]} lines  ex. ['YOU', 'MAN']
 * @param {number} lineGap  lignes vides entre deux rangées de texte
 * @returns {{cells: boolean[][], width: number, height: number, bands: {start: number, end: number}[]}}
 *          `bands` donne la plage de lignes occupée par chaque mot.
 */
export function layoutText(lines, lineGap) {
  const widths = lines.map(lineWidth);
  const width = Math.max(...widths);
  const height = lines.length * GLYPH_H + (lines.length - 1) * lineGap;

  const cells = Array.from({ length: height }, () => new Array(width).fill(false));
  const bands = [];

  lines.forEach((line, lineIndex) => {
    // chaque ligne est centrée sur la plus large
    const offsetX = Math.round((width - widths[lineIndex]) / 2);
    const offsetY = lineIndex * (GLYPH_H + lineGap);
    bands.push({ start: offsetY, end: offsetY + GLYPH_H - 1 });

    let cursor = offsetX;
    for (const char of line) {
      const glyph = GLYPHS[char.toUpperCase()];
      if (!glyph) continue;
      for (let row = 0; row < GLYPH_H; row++) {
        for (let col = 0; col < glyph[row].length; col++) {
          if (glyph[row][col] === '#') cells[offsetY + row][cursor + col] = true;
        }
      }
      cursor += glyph[0].length + LETTER_GAP;
    }
  });

  return { cells, width, height, bands };
}
