import { SHIP } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;

/**
 * Entrées du pilote.
 *
 * Deux gestes, pas un de plus : **incliner** l'appareil pour la direction,
 * **garder le doigt posé** pour accélérer. Le clavier et le glissement au
 * doigt existent uniquement pour pouvoir essayer le jeu sans gyroscope.
 */
export function createControls(surface) {
  const state = {
    steer: 0,        // -1 .. 1
    thrust: false,
    /** Source réellement utilisée : 'gyro' | 'touch' | 'keys'. */
    source: 'keys',
    gyroAvailable: false,
    gyroEnabled: false,
    /** Inclinaison neutre, capturée au moment où le gyro est activé. */
    calibration: null,
    rawTilt: 0,
  };

  // ------------------------------------------------------------- gyroscope
  let lastGamma = null;

  function onOrientation(e) {
    if (e.gamma == null) return;
    state.gyroAvailable = true;
    lastGamma = e.gamma;
    if (!state.gyroEnabled) return;

    if (state.calibration === null) state.calibration = e.gamma;
    let tilt = e.gamma - state.calibration;
    // L'appareil peut basculer d'un repère à l'autre en passant la verticale.
    if (tilt > 180) tilt -= 360;
    if (tilt < -180) tilt += 360;

    state.rawTilt = tilt;
    const dead = SHIP.tiltDeadzone;
    const live = Math.abs(tilt) < dead ? 0 : Math.sign(tilt) * (Math.abs(tilt) - dead);
    state.steer = clamp(live / (SHIP.tiltRange - dead), -1, 1);
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

  /** Remet l'inclinaison courante comme position neutre. */
  function recalibrate() {
    state.calibration = lastGamma;
  }

  // ------------------------------------------------------------- doigt
  const pointers = new Map();
  let dragOrigin = null;

  function onDown(e) {
    pointers.set(e.pointerId, e.clientX);
    state.thrust = true;
    if (!state.gyroEnabled) dragOrigin = e.clientX;
    surface.setPointerCapture?.(e.pointerId);
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e.clientX);
    if (state.gyroEnabled || dragOrigin === null) return;
    const rect = surface.getBoundingClientRect();
    state.steer = clamp((e.clientX - dragOrigin) / (rect.width * 0.28), -1, 1);
    state.source = 'touch';
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size) return;
    state.thrust = false;
    dragOrigin = null;
    if (!state.gyroEnabled) state.steer = 0;
  }

  surface.addEventListener('pointerdown', onDown, { passive: true });
  surface.addEventListener('pointermove', onMove, { passive: true });
  surface.addEventListener('pointerup', onUp, { passive: true });
  surface.addEventListener('pointercancel', onUp, { passive: true });

  // ------------------------------------------------------------- clavier
  const keys = new Set();
  const onKey = (down) => (e) => {
    const k = e.key.toLowerCase();
    if (!['arrowleft', 'arrowright', 'a', 'd', 'q', ' ', 'arrowup', 'w', 'z'].includes(k)) return;
    e.preventDefault();
    if (down) keys.add(k); else keys.delete(k);

    const left = keys.has('arrowleft') || keys.has('a') || keys.has('q');
    const right = keys.has('arrowright') || keys.has('d');
    if (!state.gyroEnabled) {
      state.steer = (right ? 1 : 0) - (left ? 1 : 0);
      if (left || right) state.source = 'keys';
    }
    const go = keys.has(' ') || keys.has('arrowup') || keys.has('w') || keys.has('z');
    if (go || !pointers.size) state.thrust = go || pointers.size > 0;
  };
  window.addEventListener('keydown', onKey(true));
  window.addEventListener('keyup', onKey(false));

  return {
    state,
    enableGyro,
    recalibrate,
    get steer() { return state.steer; },
    get thrust() { return state.thrust; },
    /** Inclinaison brute en degrés — sert au réglage à l'écran. */
    get tilt() { return state.rawTilt * DEG; },
  };
}
