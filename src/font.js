/**
 * Fonte matricielle 5×7 réduite aux lettres dont on a besoin.
 * Chaque '#' devient une tour ; chaque '.' reste une rue.
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
    '#...#',
    '#...#',
    '#...#',
    '#...#',
    '#...#',
    '#...#',
    '.###.',
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
    '#...#',
    '##..#',
    '#.#.#',
    '#.#.#',
    '#..##',
    '#...#',
    '#...#',
  ],
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;
const LETTER_GAP = 1;

/**
 * Compose plusieurs lignes de texte en une seule matrice de booléens.
 *
 * @param {string[]} lines  ex. ['YOU', 'MAN']
 * @param {number} lineGap  lignes vides entre deux rangées de texte
 * @returns {{cells: boolean[][], width: number, height: number}}
 */
export function layoutText(lines, lineGap) {
  const widths = lines.map((l) => l.length * GLYPH_W + (l.length - 1) * LETTER_GAP);
  const width = Math.max(...widths);
  const height = lines.length * GLYPH_H + (lines.length - 1) * lineGap;

  const cells = Array.from({ length: height }, () => new Array(width).fill(false));

  lines.forEach((line, lineIndex) => {
    // chaque ligne est centrée sur la plus large
    const offsetX = Math.round((width - widths[lineIndex]) / 2);
    const offsetY = lineIndex * (GLYPH_H + lineGap);

    [...line].forEach((char, charIndex) => {
      const glyph = GLYPHS[char.toUpperCase()];
      if (!glyph) return;
      const baseX = offsetX + charIndex * (GLYPH_W + LETTER_GAP);
      for (let row = 0; row < GLYPH_H; row++) {
        for (let col = 0; col < GLYPH_W; col++) {
          if (glyph[row][col] === '#') cells[offsetY + row][baseX + col] = true;
        }
      }
    });
  });

  return { cells, width, height };
}
