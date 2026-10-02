import { INPUT } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Les commandes.
 *
 * Direction : l'inclinaison de l'appareil. Accélération : une manette au
 * doigt — on glisse vers le haut pour mettre les gaz, vers le bas pour lever
 * le pied, et la valeur reste où on l'a laissée. Double appui : turbo.
 *
 * Clavier et glissement horizontal n'existent que pour pouvoir essayer sans
 * gyroscope ; ils ne sont pas le mode nominal.
 */
export function createControls(surface) {
  const settings = {
    /** Multiplie le sens de l'inclinaison : l'utilisateur peut l'inverser. */
    tiltSign: INPUT.tiltSign,
    tiltRange: INPUT.tiltRange,
  };

  const state = {
    steer: 0,
    throttle: 0,
    turboRequested: false,
    source: 'keys',
    gyroAvailable: false,
    gyroEnabled: false,
    calibration: null,
    rawTilt: 0,
  };

  let lastGamma = null;

  // ------------------------------------------------------------- gyroscope
  function onOrientation(e) {
    if (e.gamma == null) return;
    state.gyroAvailable = true;
    lastGamma = e.gamma;
    if (!state.gyroEnabled) return;

    if (state.calibration === null) state.calibration = e.gamma;
    let tilt = e.gamma - state.calibration;
    // l'appareil peut sauter d'un repère à l'autre en passant la verticale
    if (tilt > 180) tilt -= 360;
    if (tilt < -180) tilt += 360;

    state.rawTilt = tilt;
    const dead = INPUT.tiltDeadzone;
    const live = Math.abs(tilt) < dead ? 0 : Math.sign(tilt) * (Math.abs(tilt) - dead);
    state.steer = clamp(live / (settings.tiltRange - dead), -1, 1) * settings.tiltSign;
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
    state.calibration = lastGamma;
    return true;
  }

  const recalibrate = () => { state.calibration = lastGamma; };

  // ------------------------------------------------------------------ doigt
  /** @type {Map<number, {x:number, y:number, throttle:number, steering:boolean}>} */
  const touches = new Map();
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  const isSteeringZone = (clientX) => {
    if (state.gyroEnabled) return false;
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

    if (t.steering) {
      state.steer = clamp((e.clientX - t.x) / (rect.width * 0.28), -1, 1);
      state.source = 'touch';
      return;
    }
    // manette : vers le haut on accélère
    const travel = rect.height * INPUT.throttleTravel;
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
    if (!state.gyroEnabled && (left || right || state.source === 'keys')) {
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
    enableGyro,
    recalibrate,
    tick,
    consumeTurbo,
    reset,
    get steer() { return state.steer; },
    get throttle() { return state.throttle; },
  };
}
