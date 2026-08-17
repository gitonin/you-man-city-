/**
 * Réglages partagés. Tout ce qui se "sent" au doigt est ici.
 */

export const PALETTE = {
  ink: 0x05030c,
  fog: 0x0a0718,
  skyTop: 0x0a0818,
  skyHorizon: 0x2b1436,
  smog: 0x3a1a2e,
  cyan: 0x25e6ff,
  magenta: 0xff2fd0,
  amber: 0xffb35c,
  violet: 0x8a5cff,
};

/** Trame de la ville : une cellule = une parcelle. */
export const GRID = {
  cell: 12,
  /** Écart vertical (en lignes) entre "YOU" et "MAN". */
  lineGap: 3,
  /** Hauteur des tours qui dessinent les lettres. */
  towerH: [58, 96],
  /** Emprise au sol d'une tour-lettre (le reste devient rue). */
  towerFoot: 9.1,
  /** Socles bas qui remplissent les vides du quartier. */
  podiumH: [5, 17],
  podiumFoot: 10.4,
  /** Anneau de remplissage autour du quartier. */
  fillerCount: 340,
  fillerRadius: [175, 470],
  fillerH: [12, 78],
  fillerFoot: [8, 20],
};

/**
 * Orientation du quartier. C'est *la* réponse de l'énigme : le joueur doit
 * trouver cet azimut, à la verticale. Valeur volontairement non ronde.
 */
export const TEXT_YAW = 0.6283; // ~36°

export const CAM = {
  /** Élévation : 0 = à hauteur de rue, PI/2 = plein zénith. */
  elevRange: [0.055, Math.PI / 2 - 0.012],
  /** Distance interpolée selon l'élévation (rase-mottes → satellite). */
  distRange: [200, 620],
  /** Hauteur du point visé, interpolée elle aussi : skyline → plancher. */
  pivotYRange: [54, 6],
  startAzimuth: TEXT_YAW + 2.35,
  startElev: 0.11,
  fov: 52,
  /** Sensibilité du glissement, en radians par pixel. */
  drag: { azimuth: 0.0075, elev: 0.0034 },
  inertia: 0.9,
  /** Dérive lente tant que le joueur n'a rien touché. */
  idleDrift: 0.035,
};

/** Fenêtre de tolérance de l'énigme. */
export const PUZZLE = {
  azTolerance: 0.55, // rad — au-delà, plus aucun signal
  elTolerance: 0.5,
  /** Courbe de lecture de la jauge : < 1 rend la progression plus lisible. */
  curve: 0.55,
  lockThreshold: 0.88,
  /** Durée de maintien dans la fenêtre avant validation. */
  holdSeconds: 1.0,
  hints: [
    [22, 'la réponse est au-dessus de la ville'],
    [46, 'glissez vers le haut pour prendre de l’altitude'],
    [78, 'au zénith, faites pivoter jusqu’à ce que ça résonne'],
  ],
};

/** Immeuble-séquenceur du niveau 2. */
export const HERO = {
  position: [0, 0, 318],
  width: 80,
  depth: 50,
  height: 182,
  /** Grille jouable. */
  cols: 8,
  rows: 8,
  cellSize: 6.2,
  gridCenterY: 130,
  camDistance: 86,
};

/** Les 8 pistes, de haut en bas de la façade. */
export const TRACKS = [
  { id: 'lead', name: 'C5', freq: 523.25, hue: 0.52, kind: 'lead' },
  { id: 'lead', name: 'A#4', freq: 466.16, hue: 0.56, kind: 'lead' },
  { id: 'lead', name: 'G4', freq: 392.0, hue: 0.6, kind: 'lead' },
  { id: 'lead', name: 'F4', freq: 349.23, hue: 0.66, kind: 'lead' },
  { id: 'lead', name: 'D#4', freq: 311.13, hue: 0.72, kind: 'lead' },
  { id: 'bass', name: 'C2', freq: 65.41, hue: 0.8, kind: 'bass' },
  { id: 'clap', name: 'CLP', freq: 0, hue: 0.88, kind: 'clap' },
  { id: 'kick', name: 'KCK', freq: 0, hue: 0.95, kind: 'kick' },
];

/** Motif d'amorce proposé par le bouton « motif ». */
export const DEMO_PATTERN = [
  [0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 0, 0],
  [1, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 1],
  [0, 1, 0, 0, 0, 0, 1, 0],
  [1, 0, 0, 1, 0, 0, 1, 0],
  [0, 0, 1, 0, 0, 0, 1, 0],
  [1, 0, 0, 0, 1, 0, 0, 1],
];

/** Amorce jouée dès l'entrée dans le niveau 2 : juste une pulsation. */
export const SEED_PATTERN = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 1, 0, 0, 0, 1, 0],
  [1, 0, 0, 0, 1, 0, 0, 0],
];

export const BPM = { min: 72, max: 148, start: 102, step: 2 };
