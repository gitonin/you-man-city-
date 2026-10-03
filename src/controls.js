import { INPUT } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Les commandes : **l'appareil tout entier est la manette.**
 *
 * Deux axes, pris sur le même capteur. Le roulis dirige — on penche à gauche,
 * on va à gauche. Le tangage fait les gaz : penché vers l'avant, on accélère ;
 * ramené vers soi, on lève le pied.
 *
 * L'angle auquel on tient l'appareil au moment du calage devient le neutre, et
 * le neutre vaut **mi-régime** : un neutre à zéro obligerait à tenir le
 * téléphone penché en permanence rien que pour avancer. Le bouton
 * « Recentrer » reprend ce calage sur les deux axes à la fois.
 *
 * Doigt et clavier ne subsistent que pour pouvoir essayer sans gyroscope ; ce
 * n'est pas le mode nominal. Le double appui, lui, reste le turbo partout : ce
 * n'est pas une commande de gaz mais une détente.
 */
export function createControls(surface) {
  const settings = {
    /** Multiplie le sens de l'inclinaison : l'utilisateur peut l'inverser. */
    tiltSign: INPUT.tiltSign,
    tiltRange: INPUT.tiltRange,
    pitchSign: INPUT.pitchSign,
    pitchRange: INPUT.pitchRange,
  };

  const state = {
    steer: 0,
    throttle: 0,
    turboRequested: false,
    source: 'keys',
    gyroAvailable: false,
    gyroEnabled: false,
    calibration: null,
    pitchCalibration: null,
    rawTilt: 0,
    rawPitch: 0,
  };

  let lastTilt = null;
  let lastPitch = null;

  /**
   * Le gyroscope n'est « vivant » que s'il a réellement envoyé quelque chose.
   *
   * Sur ordinateur, `DeviceOrientationEvent` existe et l'autorisation est
   * accordée sans rien demander — mais aucun événement n'arrive jamais. Se
   * fier au seul drapeau d'activation couperait alors le repli au doigt et au
   * clavier, et il ne resterait plus aucune commande.
   */
  const gyroLive = () => state.gyroAvailable && state.gyroEnabled;

  /**
   * Le roulis tel que le ressent la main, quelle que soit la façon de tenir.
   *
   * `gamma` est la rotation autour de l'axe long de l'appareil : debout, c'est
   * bien le geste de volant. Couché, cet axe est passé à l'horizontale et
   * c'est `beta` qui porte le roulis. On projette donc les deux sur l'axe
   * horizontal de l'écran, d'après l'angle que le système déclare.
   *
   * Un éventuel inversement global reste rattrapable par le réglage « Sens de
   * l'inclinaison », qui multiplie le résultat.
   */
  function screenAngle() {
    const deg = (screen.orientation && screen.orientation.angle)
      ?? window.orientation ?? 0;
    return (deg * Math.PI) / 180;
  }

  function rollOf(e) {
    const a = screenAngle();
    return e.gamma * Math.cos(a) + (e.beta || 0) * Math.sin(a);
  }

  /**
   * Le tangage ressenti : l'axe orthogonal au roulis, projeté de la même
   * façon sur le repère de l'écran. Debout c'est `beta`, couché c'est `gamma`
   * au signe près — exactement la rotation de 90° de l'autre formule.
   */
  function pitchOf(e) {
    const a = screenAngle();
    return (e.beta || 0) * Math.cos(a) - e.gamma * Math.sin(a);
  }

  /** Écarte la zone morte sans créer de saut à sa sortie. */
  function deaden(v, dead) {
    if (Math.abs(v) < dead) return 0;
    return Math.sign(v) * (Math.abs(v) - dead);
  }

  // ------------------------------------------------------------- gyroscope
  function onOrientation(e) {
    if (e.gamma == null) return;
    state.gyroAvailable = true;
    const roll = rollOf(e);
    const pitch = pitchOf(e);
    lastTilt = roll;
    lastPitch = pitch;
    if (!state.gyroEnabled) return;

    if (state.calibration === null) state.calibration = roll;
    if (state.pitchCalibration === null) state.pitchCalibration = pitch;

    // l'appareil peut sauter d'un repère à l'autre en passant la verticale
    const wrap = (d) => (d > 180 ? d - 360 : d < -180 ? d + 360 : d);
    const tilt = wrap(roll - state.calibration);
    const lean = wrap(pitch - state.pitchCalibration);

    state.rawTilt = tilt;
    state.rawPitch = lean;

    const dead = INPUT.tiltDeadzone;
    state.steer = clamp(deaden(tilt, dead) / (settings.tiltRange - dead), -1, 1)
      * settings.tiltSign;

    // Penché vers l'avant, le tangage *diminue* : l'appareil se couche. D'où
    // le signe négatif, qui met les gaz quand on pousse le téléphone devant
    // soi comme on pousse une manette.
    const pDead = INPUT.pitchDeadzone;
    const lever = clamp(
      deaden(-lean, pDead) / (settings.pitchRange - pDead), -1, 1
    ) * settings.pitchSign;
    state.throttle = clamp(INPUT.pitchNeutral + lever * Math.max(INPUT.pitchNeutral, 1 - INPUT.pitchNeutral), 0, 1);
    state.source = 'gyro';
  }

  window.addEventListener('deviceorientation', onOrientation);

  /** iOS exige une demande explicite, depuis un geste utilisateur. */
  async function enableGyro() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    state.gyroEnabled = true;
    state.calibration = lastTilt;
    state.pitchCalibration = lastPitch;
    return true;
  }

  const recalibrate = () => {
    state.calibration = lastTilt;
    state.pitchCalibration = lastPitch;
  };

  // ------------------------------------------------------------------ doigt
  /** @type {Map<number, {x:number, y:number, throttle:number, steering:boolean}>} */
  const touches = new Map();
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  const isSteeringZone = (clientX) => {
    if (gyroLive()) return false;
    const rect = surface.getBoundingClientRect();
    return clientX - rect.left < rect.width * 0.5;
  };

  function onDown(e) {
    surface.setPointerCapture?.(e.pointerId);
    const steering = isSteeringZone(e.clientX);
    touches.set(e.pointerId, {
      x: e.clientX, y: e.clientY, throttle: state.throttle, steering,
    });

    const now = performance.now();
    if (
      now - lastTapTime < INPUT.doubleTapMs
      && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < INPUT.doubleTapPx
    ) {
      state.turboRequested = true;
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    }
  }

  function onMove(e) {
    const t = touches.get(e.pointerId);
    if (!t) return;
    const rect = surface.getBoundingClientRect();

    // Les courses se mesurent sur les côtés de l'appareil, pas sur ceux du
    // cadre : un téléphone couché a la même diagonale que debout, et le pouce
    // la même amplitude. Sans ça, basculer en paysage doublait la sensibilité
    // de la manette et divisait par deux celle de la direction au doigt.
    const long = Math.max(rect.width, rect.height);
    const short = Math.min(rect.width, rect.height);

    if (t.steering) {
      state.steer = clamp((e.clientX - t.x) / (short * 0.28), -1, 1);
      state.source = 'touch';
      return;
    }
    // Repli sans gyroscope : la manette au doigt, vers le haut on accélère.
    // Avec le gyroscope, le tangage tient les gaz et le doigt n'a rien à y
    // faire — il les reprendrait pour une image avant d'être écrasé.
    if (gyroLive()) return;
    const travel = long * INPUT.throttleTravel;
    state.throttle = clamp(t.throttle + (t.y - e.clientY) / travel, 0, 1);
  }

  function onUp(e) {
    const t = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    // la manette garde sa position ; la direction au doigt, elle, se recentre
    if (t && t.steering && ![...touches.values()].some((o) => o.steering)) state.steer = 0;
  }

  surface.addEventListener('pointerdown', onDown, { passive: true });
  surface.addEventListener('pointermove', onMove, { passive: true });
  surface.addEventListener('pointerup', onUp, { passive: true });
  surface.addEventListener('pointercancel', onUp, { passive: true });

  // ---------------------------------------------------------------- clavier
  const keys = new Set();
  const WATCHED = [
    'arrowleft', 'arrowright', 'arrowup', 'arrowdown',
    'a', 'd', 'q', 'w', 's', 'z', ' ', 'shift',
  ];

  function applyKeys() {
    const left = keys.has('arrowleft') || keys.has('a') || keys.has('q');
    const right = keys.has('arrowright') || keys.has('d');
    if (!gyroLive() && (left || right || state.source === 'keys')) {
      state.steer = (right ? 1 : 0) - (left ? 1 : 0);
      if (left || right) state.source = 'keys';
    }
  }

  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (!WATCHED.includes(k)) return;
    e.preventDefault();
    keys.add(k);
    if (k === 'shift') state.turboRequested = true;
    applyKeys();
  }
  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (!WATCHED.includes(k)) return;
    e.preventDefault();
    keys.delete(k);
    applyKeys();
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  /** Appelé une fois par image : entretient les commandes continues. */
  function tick(dt) {
    if (gyroLive()) return;
    const up = keys.has('arrowup') || keys.has('w') || keys.has('z') || keys.has(' ');
    const down = keys.has('arrowdown') || keys.has('s');
    if (up) state.throttle = clamp(state.throttle + dt * 1.8, 0, 1);
    if (down) state.throttle = clamp(state.throttle - dt * 2.2, 0, 1);
  }

  /** Le turbo ne vaut que pour une image. */
  function consumeTurbo() {
    const v = state.turboRequested;
    state.turboRequested = false;
    return v;
  }

  function reset() {
    state.throttle = 0;
    state.steer = 0;
    state.turboRequested = false;
    touches.clear();
  }

  return {
    state,
    settings,
    /** Le capteur envoie-t-il vraiment quelque chose ? */
    get gyroLive() { return gyroLive(); },
    enableGyro,
    recalibrate,
    tick,
    consumeTurbo,
    reset,
    get steer() { return state.steer; },
    get throttle() { return state.throttle; },
  };
}
