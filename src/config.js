/**
 * REBORN — réglages.
 *
 * Tout ce qui se règle à l'oreille ou au pouce est ici. Le reste du code
 * n'invente aucune constante de gameplay.
 */

/** Rendu : on travaille en basse définition, comme la machine d'origine. */
export const RENDER = {
  /** Hauteur de la cible de rendu interne. La largeur suit le ratio écran. */
  internalHeight: 448,
  /** Divise la grille d'accrochage des sommets : > 1 = tremblement plus gros. */
  vertexJitter: 2.0,
  fov: 68,
  near: 0.6,
  far: 2600,
  fogNear: 150,
  fogFar: 820,
  /** Plafond du devicePixelRatio pour le passage final plein écran. */
  maxPixelRatio: 2,
};

/** Palette : bleus sales, néons, et les couleurs de corruption du datamosh. */
export const PALETTE = {
  sky: 0x16222e,
  fog: 0x16222e,
  horizon: 0x2a3f4e,
  road: 0x6b737a,
  wall: 0x39434d,
  accent: 0x3cf0ff,
  hot: 0xff2e6b,
  boost: 0xffa023,
};

/** Le circuit : généré à partir d'une poignée de points de contrôle. */
export const TRACK = {
  /** Demi-largeur de la piste. Le vaisseau en fait 1.6 de large. */
  halfWidth: 13,
  wallHeight: 7.5,
  /** Nombre d'échantillons sur toute la boucle : la finesse du ruban. */
  samples: 1500,
  /** Longueur d'un carreau de texture le long de la piste. */
  tileLength: 26,
  /** Roulis dans les virages, en radians par unité de courbure. */
  bankStrength: 46,
  bankMax: 0.52,
};

/** Pilotage du vaisseau. Vitesses en unités par seconde. */
export const SHIP = {
  maxSpeed: 330,
  boostSpeed: 430,
  /** Poussée doigt appuyé, et frein moteur doigt levé. */
  thrust: 118,
  coast: 46,
  /** Traînée quadratique : fixe la vitesse de croisière. */
  drag: 0.00052,
  /** Autorité du gyro sur la dérive latérale. */
  steerForce: 92,
  /** Poussée vers l'extérieur du virage : le dévers se paie. */
  corneringDrift: 0.26,
  steerDamp: 3.1,
  /** Inclinaison max de l'appareil prise en compte, en degrés. */
  tiltRange: 26,
  /** Zone morte du gyro, en degrés. */
  tiltDeadzone: 1.8,
  halfWidth: 2.4,
  /** Perte de vitesse et de bouclier contre un mur. */
  wallBounce: 0.45,
  wallSpeedLoss: 0.82,
  wallDamage: 7,
  /** Durée et puissance du coup de boost des plaques orange. */
  boostDuration: 1.9,
  shield: 100,
  /** Flottement du cockpit. */
  hoverAmp: 0.22,
  hoverFreq: 2.7,
};

/**
 * Musique : la bande dérape avec le bolide. On coupe `preservesPitch` pour
 * que la hauteur suive la vitesse — c'est l'effet bande magnétique.
 */
export const MUSIC = {
  src: './assets/reborn.mp3',
  /** Vitesse de lecture à l'arrêt et à pleine vitesse. */
  rateIdle: 0.62,
  rateMax: 1.26,
  /** Au-delà de la vitesse max (boost), la bande part plus haut. */
  rateBoost: 1.45,
  /** Lissage du changement de vitesse, en secondes. */
  smoothing: 0.35,
  volume: 0.85,
};

/** Corruption de l'image. Le glitch est un personnage, pas un accident. */
export const GLITCH = {
  /** Niveau de fond, toujours présent. */
  idle: 0.05,
  /** Part proportionnelle à la vitesse. */
  speedGain: 0.09,
  /** Pic lors d'un choc, et sa décroissance par seconde. */
  hitBurst: 0.42,
  hitDecay: 1.8,
  /** Rafales aléatoires : probabilité par seconde, durée, intensité. */
  burstChance: 0.4,
  burstTime: [0.06, 0.3],
  burstPower: [0.16, 0.5],
  /** Plafond : au-delà, l'image se dissout et on ne pilote plus rien. */
  ceiling: 0.6,
};

/** Course. */
export const RACE = {
  laps: 3,
  /** Décompte avant le départ, en secondes. */
  countdown: 3,
};
