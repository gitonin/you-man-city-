/**
 * La rythmique du niveau 2 n'est pas écrite à la main : elle est *lue* dans
 * le mot. Chaque colonne de la trame « YOU MAN » est un pas de la mesure ;
 * la matière de la colonne décide de ce qui sonne.
 *
 *   - la ligne du bas (« MAN ») tient la batterie : les montants pleins des
 *     lettres deviennent des coups de grosse caisse, les parties fines des
 *     charlestons ;
 *   - la ligne du haut (« YOU ») tient l'harmonie : la hauteur suit la
 *     première case allumée de la colonne.
 *
 * Résultat : quand une colonne s'allume à l'écran, c'est très exactement ce
 * qu'on entend. Le nom du groupe *est* la boucle.
 */

/** Do mineur, du grave à l'aigu par index de ligne (0 = ligne du haut). */
const SCALE = [130.81, 116.54, 98.0, 87.31, 77.78, 73.42, 65.41]; // C3 Bb2 G2 F2 Eb2 D2 C2

/**
 * @param {boolean[][]} cells  matrice renvoyée par layoutText
 * @param {{start:number,end:number}[]} bands  plages de lignes des deux mots
 * @returns {object[]} un descripteur par pas
 */
export function deriveGroove(cells, bands) {
  const steps = cells[0].length;
  const [top, bottom] = bands;

  const scan = (band, col) => {
    let count = 0;
    let first = -1;
    for (let r = band.start; r <= band.end; r++) {
      if (!cells[r][col]) continue;
      count++;
      if (first < 0) first = r - band.start;
    }
    return { count, first };
  };

  const pattern = [];
  for (let c = 0; c < steps; c++) {
    const hi = scan(top, c);
    const lo = scan(bottom, c);

    // Les montants pleins des lettres portent la pulsation ; on garantit la
    // noire pour que ça reste dansant, le mot ajoute ses contretemps.
    const kick = c % 4 === 0 || (lo.count >= 5 && c % 2 === 0);
    const sub = lo.count >= 5;
    const clap = c === 4 || c === 12;
    const openHat = c % 4 === 2;
    const closedHat = lo.count >= 1 && !kick && !openHat;

    const bass = hi.count >= 4 ? SCALE[hi.first] : 0;
    const stab = !bass && hi.count > 0 && c % 2 === 0 ? SCALE[hi.first] * 4 : 0;

    pattern.push({ kick, sub, clap, openHat, closedHat, bass, stab });
  }

  return pattern;
}
