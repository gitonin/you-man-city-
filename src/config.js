/**
 * REBORN — réglages généraux.
 *
 * Les circuits et leurs ambiances vivent dans `themes.js` ; ici ne restent que
 * les constantes communes à toutes les courses.
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
  /** Plafond du devicePixelRatio pour le passage final plein écran. */
  maxPixelRatio: 2,
};

/** Pilotage du vaisseau. Vitesses en unités par seconde. */
export const SHIP = {
  maxSpeed: 330,
  boostSpeed: 430,
  /** Atteinte uniquement au double-appui. */
  turboSpeed: 520,
  /** Poussée à plein régime, et frein moteur manette au ralenti. */
  thrust: 128,
  brake: 150,
  /** Traînée quadratique : fixe la vitesse de croisière. */
  drag: 0.00052,
  /**
   * Autorité de la direction sur la dérive latérale. Réglée pour que traverser
   * la chaussée prenne une seconde environ : si on élargit `TRACK.halfWidth`,
   * il faut la suivre, sinon le vaisseau devient pataud.
   */
  steerForce: 118,
  /** Poussée vers l'extérieur du virage : le dévers se paie. */
  corneringDrift: 0.26,
  steerDamp: 3.1,
  halfWidth: 2.4,
  /** Perte de vitesse et de bouclier contre un mur. */
  wallBounce: 0.45,
  wallSpeedLoss: 0.82,
  wallDamage: 7,
  /** Accrochage avec un adversaire. */
  rubDamage: 4,
  rubSpeedLoss: 0.9,
  /** Durée du coup de boost des plaques, et du turbo au double-appui. */
  boostDuration: 1.9,
  turboDuration: 1.3,
  shield: 100,
  /** Flottement du cockpit. */
  hoverAmp: 0.22,
  hoverFreq: 2.7,
};

/** Commandes. */
export const INPUT = {
  /** Inclinaison max de l'appareil prise en compte, en degrés. */
  tiltRange: 26,
  tiltDeadzone: 1.8,
  /**
   * Sens du gyroscope. Le réglage « Contrôles » le multiplie par -1, donc
   * cette valeur n'est que le défaut : l'utilisateur garde le dernier mot.
   */
  tiltSign: 1,
  /** Course du pavé d'accélération, en fraction de la hauteur d'écran. */
  throttleTravel: 0.3,
  /** Fenêtre du double-appui, en millisecondes, et tolérance en pixels. */
  doubleTapMs: 300,
  doubleTapPx: 34,
};

/**
 * Musique. Le morceau est à 119 BPM pile — mesuré sur le fichier, grille
 * vérifiée du début à la fin —, ce qui permet de caler le jeu dessus sans
 * analyse temps réel.
 */
export const MUSIC = {
  src: './assets/reborn.mp3',
  /**
   * Taux d'échantillonnage du contexte audio. Le morceau y est décodé, donc
   * c'est lui qui fixe la mémoire occupée : 32 kHz coûte environ soixante-dix
   * mégaoctets là où le 48 kHz natif en coûterait cent cinq, et ne retire que
   * ce qui est au-dessus de 16 kHz. Un appareil qui refuse ce taux retombe sur
   * le sien.
   */
  sampleRate: 32000,
  bpm: 119,
  /** Position du premier temps, en secondes. */
  beatOffset: 0.0464,
  /**
   * Vitesse de lecture, en trois points plutôt qu'en deux.
   *
   * Une rampe droite de l'arrêt au plein régime faisait monter le morceau d'un
   * ton et demi sur la seconde moitié de la plage, là où l'on passe le plus de
   * temps : c'était du dessin animé. On garde donc le ralenti au départ, on
   * cale la **vitesse normale à mi-régime** — c'est l'allure de croisière du
   * jeu, le morceau doit y sonner comme il a été écrit —, et la montée au-delà
   * n'est plus qu'une inflexion. La survitesse et le turbo ajoutent par-dessus.
   */
  rateIdle: 0.68,
  rateMid: 1.0,
  rateMax: 1.1,
  rateBoost: 1.15,
  rateTurbo: 1.2,
  /**
   * Bornes de la vitesse de lecture. Depuis que le morceau passe par Web
   * Audio, la fenêtre de coupure des éléments média ne s'applique plus ; ces
   * bornes ne sont donc là que pour la musique elle-même, pour qu'un plongeon
   * à l'impact ne descende pas jusqu'à la bouillie.
   */
  rateFloor: 0.5,
  rateCeiling: 1.9,
  /** Lissage du changement de vitesse, en secondes. */
  smoothing: 0.35,
  volume: 0.82,
};

/** Corruption de l'image. Le glitch est un personnage, pas un accident. */
export const GLITCH = {
  idle: 0.05,
  speedGain: 0.09,
  /** Pic sur le temps fort de chaque mesure. */
  beatKick: 0.1,
  hitBurst: 0.42,
  hitDecay: 1.8,
  burstChance: 0.4,
  burstTime: [0.06, 0.3],
  burstPower: [0.16, 0.5],
  /** Plafond : au-delà, l'image se dissout et on ne pilote plus rien. */
  ceiling: 0.6,
};

/** Course. */
export const RACE = {
  laps: 3,
  countdown: 3,
  opponents: 5,
};

/** Portiques rythmiques : ils battent la mesure et sonnent au passage. */
export const RHYTHM = {
  /** Nombre de portiques répartis sur le tour. */
  gates: 28,
  /** Gamme des notes déclenchées, en demi-tons depuis do. */
  scale: [0, 3, 5, 7, 10, 12, 15],
  baseFreq: 261.63,
};
