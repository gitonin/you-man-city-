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

/**
 * Quartier-séquenceur du niveau 2 : une dalle de 8 × 8 immeubles bas, au sud
 * du mot. Leurs toits sont les pads.
 */
export const PADS = {
  cols: 8,
  rows: 8,
  /** Pas de la trame (une parcelle de pad est plus large qu'une parcelle de ville). */
  cell: 21,
  /** Espace laissé entre le bas du mot et la première rangée de pads. */
  gapFromWord: 40,
  height: [9, 26],
  foot: 17.5,
};

/** Caméra du niveau 2 : survol oblique, le mot au fond, les pads devant. */
export const AERIAL = {
  elevation: 0.95, // rad — ~54°
  distance: 538,
  /** Point visé, en Z local (0 = centre du mot). */
  pivotZ: 156,
  pivotY: 16,
  /** Amplitude du léger balancement continu : assez pour respirer, pas assez
   *  pour gêner la lecture du nom ni la visée des toits. */
  swayAzimuth: 0.018,
  swayElevation: 0.011,
  swayPeriod: 30,
};

/**
 * Les 8 pistes du joueur, de la rangée la plus lointaine à la plus proche.
 * Toutes mélodiques : la batterie, elle, vient du mot.
 */
export const TRACKS = [
  { name: 'C5', freq: 523.25, hue: 0.5 },
  { name: 'A#4', freq: 466.16, hue: 0.55 },
  { name: 'G4', freq: 392.0, hue: 0.6 },
  { name: 'F4', freq: 349.23, hue: 0.65 },
  { name: 'D#4', freq: 311.13, hue: 0.72 },
  { name: 'C4', freq: 261.63, hue: 0.79 },
  { name: 'G3', freq: 196.0, hue: 0.86 },
  { name: 'C3', freq: 130.81, hue: 0.92 },
];

/** Une mesure de 16 doubles-croches ; les pads bouclent sur 8. */
export const STEPS = 16;
export const PAD_STEPS = 8;

/** Motif proposé par le bouton « motif » — 8 pistes × 8 pas. */
export const DEMO_PATTERN = [
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 1, 0],
  [0, 1, 0, 0, 0, 1, 0, 0],
  [1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0],
];

/** Amorce jouée dès l'entrée dans le niveau 2 : une simple ligne de basse. */
export const SEED_PATTERN = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0],
];

export const BPM = { min: 96, max: 138, start: 122, step: 2 };
