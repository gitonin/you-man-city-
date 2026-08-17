import { Vector3 } from 'three';
import { CAM, PUZZLE, TEXT_YAW } from './config.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;

function wrapAngle(a) {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

/**
 * Niveau 1 — « L'angle ».
 *
 * Le joueur n'a qu'un seul verbe : orienter la caméra. La solution est la
 * verticale exacte au-dessus du quartier, à l'azimut du quartier lui-même,
 * seul point de vue depuis lequel les toits dessinent « YOU MAN ».
 *
 * Le retour est entièrement analogique (jauge, néons, drone) : rien n'indique
 * la direction, seulement la distance au but.
 */
export function createLevel1({ camera, city, canvas, audio, hud }) {
  const [minEl, maxEl] = CAM.elevRange;
  const TARGET_AZ = TEXT_YAW;
  const TARGET_EL = maxEl;

  const state = {
    azimuth: CAM.startAzimuth,
    elev: CAM.startElev,
    velAz: 0,
    velEl: 0,
    proximity: 0,
    hold: 0,
    solved: false,
    /** 'puzzle' pendant l'énigme, 'free' pour le survol libre d'après-jeu. */
    mode: 'puzzle',
    inputEnabled: true,
    touched: false,
    elapsed: 0,
    hintIndex: 0,
    pingLevel: 0,
    gyro: false,
    gyroBaseAz: null,
    gyroOffsetAz: 0,
    gyroOffsetEl: 0,
  };

  let snap = null; // animation vers la solution
  let onSolved = null;
  const pivot = new Vector3();

  // ------------------------------------------------------------- pointeurs

  const pointers = new Map();
  let last = null;

  function onDown(e) {
    if (!state.inputEnabled) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = { x: e.clientX, y: e.clientY };
    state.touched = true;
    state.velAz = 0;
    state.velEl = 0;
  }

  function onMove(e) {
    if (!state.inputEnabled || !pointers.has(e.pointerId) || !last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };

    const dAz = -dx * CAM.drag.azimuth;
    const dEl = dy * CAM.drag.elev; // glisser vers le haut = prendre de l'altitude

    if (state.gyro) {
      state.gyroOffsetAz += dAz;
      state.gyroOffsetEl = clamp(state.gyroOffsetEl + dEl, -1.6, 1.6);
    } else {
      state.azimuth = wrapAngle(state.azimuth + dAz);
      state.elev = clamp(state.elev + dEl, minEl, maxEl);
    }
    state.velAz = dAz;
    state.velEl = dEl;
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (!pointers.size) last = null;
  }

  canvas.addEventListener('pointerdown', onDown, { passive: true });
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerup', onUp, { passive: true });
  canvas.addEventListener('pointercancel', onUp, { passive: true });
  canvas.addEventListener('pointerleave', onUp, { passive: true });

  // Molette / trackpad, pour tester au bureau.
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!state.inputEnabled) return;
      state.touched = true;
      state.elev = clamp(state.elev - e.deltaY * 0.0016, minEl, maxEl);
      e.preventDefault();
    },
    { passive: false }
  );

  // ------------------------------------------------------------ gyroscope

  function onOrientation(e) {
    if (!state.gyro || !state.inputEnabled) return;
    const beta = e.beta;   // inclinaison avant/arrière
    const alpha = e.alpha; // cap
    if (beta == null || alpha == null) return;

    // Téléphone dressé (beta ≈ 90) → vue de rue. À plat (beta ≈ 0) → zénith.
    const t = clamp01((90 - clamp(beta, 0, 90)) / 85);
    const baseEl = lerp(minEl, maxEl, t);

    const az = -(alpha * Math.PI) / 180;
    if (state.gyroBaseAz === null) state.gyroBaseAz = az - state.azimuth;

    state.azimuth = wrapAngle(az - state.gyroBaseAz + state.gyroOffsetAz);
    state.elev = clamp(baseEl + state.gyroOffsetEl, minEl, maxEl);
  }

  window.addEventListener('deviceorientation', onOrientation);

  async function toggleGyro() {
    if (state.gyro) {
      state.gyro = false;
      state.gyroBaseAz = null;
      return false;
    }
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      } catch {
        return false;
      }
    }
    state.gyro = true;
    state.gyroBaseAz = null;
    state.gyroOffsetAz = 0;
    state.gyroOffsetEl = 0;
    state.touched = true;
    return true;
  }

  // ---------------------------------------------------------------- caméra

  function applyCamera() {
    const u = (state.elev - minEl) / (maxEl - minEl);
    const dist = lerp(CAM.distRange[0], CAM.distRange[1], Math.pow(u, 0.85));
    const pivotY = lerp(CAM.pivotYRange[0], CAM.pivotYRange[1], Math.pow(u, 0.7));

    pivot.set(0, pivotY, 0);
    const ce = Math.cos(state.elev);
    const se = Math.sin(state.elev);
    camera.position.set(
      pivot.x + dist * ce * Math.sin(state.azimuth),
      pivot.y + dist * se,
      pivot.z + dist * ce * Math.cos(state.azimuth)
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(pivot);
  }

  /** 0 = froid, 1 = angle exact. Sert de jauge *et* de mixage audio/visuel. */
  function measure() {
    const dAz = Math.abs(wrapAngle(state.azimuth - TARGET_AZ));
    const dEl = Math.abs(TARGET_EL - state.elev);
    const raw = clamp01(1 - dAz / PUZZLE.azTolerance) * clamp01(1 - dEl / PUZZLE.elTolerance);
    return Math.pow(raw, PUZZLE.curve);
  }

  // ------------------------------------------------------------------- HUD

  function updateHud() {
    const pct = Math.round(state.proximity * 100);
    hud.meterFill.style.width = `${pct}%`;
    hud.meterVal.textContent = `${String(pct).padStart(2, '0')}%`;
    hud.meter.setAttribute('aria-valuenow', String(pct));
    hud.meter.classList.toggle('hot', state.proximity > 0.72);

    // La pluie se dissipe à mesure qu'on prend de l'altitude.
    const u = (state.elev - minEl) / (maxEl - minEl);
    hud.rain.style.opacity = String(0.18 * (1 - u * 0.92));
  }

  function updateHints(dt) {
    if (state.solved) return;
    if (!state.touched) return;
    state.elapsed += dt;
    const next = PUZZLE.hints[state.hintIndex];
    if (next && state.elapsed > next[0] && state.proximity < 0.6) {
      hud.hint.textContent = next[1];
      hud.hint.classList.add('show');
      state.hintIndex++;
      clearTimeout(updateHints._t);
      updateHints._t = setTimeout(() => hud.hint.classList.remove('show'), 5200);
    }
  }

  // ---------------------------------------------------------------- boucle

  function update(dt) {
    if (snap) {
      snap.t = Math.min(1, snap.t + dt / snap.dur);
      const e = 1 - Math.pow(1 - snap.t, 3);
      state.azimuth = snap.fromAz + wrapAngle(snap.toAz - snap.fromAz) * e;
      state.elev = lerp(snap.fromEl, snap.toEl, e);
      if (snap.t >= 1) snap = null;
      applyCamera();
      state.proximity = measure();
      updateHud();
      return;
    }

    // une fois l'énigme résolue, la caméra reste posée jusqu'au survol libre
    if (state.solved && state.mode === 'puzzle') {
      applyCamera();
      return;
    }

    // dérive d'appel tant que personne n'a touché l'écran
    if (!state.touched) {
      state.azimuth = wrapAngle(state.azimuth + CAM.idleDrift * dt);
    } else if (!pointers.size) {
      // inertie après le relâchement
      state.azimuth = wrapAngle(state.azimuth + state.velAz);
      state.elev = clamp(state.elev + state.velEl, minEl, maxEl);
      state.velAz *= CAM.inertia;
      state.velEl *= CAM.inertia;
      if (Math.abs(state.velAz) < 1e-5) state.velAz = 0;
      if (Math.abs(state.velEl) < 1e-5) state.velEl = 0;
    }

    applyCamera();

    if (state.mode === 'free') {
      // survol libre : le nom reste allumé, plus rien à trouver
      state.proximity += (1 - state.proximity) * Math.min(1, dt * 3);
      city.setLock(state.proximity);
      audio.setLock(state.proximity);
      updateHud();
      return;
    }

    const p = measure();
    state.proximity += (p - state.proximity) * Math.min(1, dt * 9);

    city.setLock(state.proximity);
    audio.setLock(state.proximity);

    // paliers sonores : 3 repères, une seule fois chacun
    const level = state.proximity > 0.86 ? 3 : state.proximity > 0.66 ? 2 : state.proximity > 0.42 ? 1 : 0;
    if (level > state.pingLevel) audio.ping(level - 1);
    state.pingLevel = level;

    updateHud();
    updateHints(dt);

    // validation : il faut *tenir* l'angle, pas le traverser
    if (state.proximity >= PUZZLE.lockThreshold) {
      state.hold += dt;
      if (state.hold >= PUZZLE.holdSeconds) {
        state.solved = true;
        hud.hint.classList.remove('show');
        snapToSolution(0.85);
        onSolved && onSolved();
      }
    } else {
      state.hold = Math.max(0, state.hold - dt * 1.6);
    }
  }

  function snapToSolution(dur = 0.85) {
    snap = {
      t: 0,
      dur,
      fromAz: state.azimuth,
      fromEl: state.elev,
      toAz: TARGET_AZ,
      toEl: TARGET_EL,
    };
  }

  function dispose() {
    window.removeEventListener('deviceorientation', onOrientation);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('pointerleave', onUp);
  }

  applyCamera();

  return {
    state,
    update,
    applyCamera,
    snapToSolution,
    toggleGyro,
    dispose,
    /** Survol libre après résolution : la caméra redevient jouable. */
    enterFreeMode(azimuth = TARGET_AZ + 0.9, elev = 1.02) {
      state.mode = 'free';
      state.inputEnabled = true;
      state.touched = true;
      state.hold = 0;
      state.azimuth = azimuth;
      state.elev = elev;
      state.velAz = 0;
      state.velEl = 0;
      snap = null;
      applyCamera();
    },
    setInputEnabled(v) { state.inputEnabled = v; },
    set onSolved(fn) { onSolved = fn; },
    get proximity() { return state.proximity; },
    get solved() { return state.solved; },
    get holdProgress() { return clamp01(state.hold / PUZZLE.holdSeconds); },
  };
}
