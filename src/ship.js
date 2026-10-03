import { Quaternion, Vector3 } from 'three';

import { RACE, SHIP } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Le bolide, et la caméra qu'il porte.
 *
 * Tout l'état tient en deux scalaires : `s`, la distance parcourue sur le
 * ruban, et `x`, l'écart par rapport à l'axe. Le monde n'intervient que pour
 * convertir ce couple en position et en orientation.
 *
 * Il n'y a **pas** de carlingue dessinée. Une version précédente peignait une
 * verrière en bas de l'image, dans l'esprit des vues cockpit d'époque : elle
 * mangeait le tiers inférieur de l'écran, c'est-à-dire précisément la portion
 * où arrive la piste sur un téléphone debout. On voit mieux sans.
 */
const makeFrame = () => ({
  position: new Vector3(),
  tangent: new Vector3(),
  normal: new Vector3(),
  binormal: new Vector3(),
  bank: 0,
  covered: false,
});


export function createShip(camera) {
  /** Le circuit change d'une course à l'autre ; le bolide, non. */
  let track = null;
  const frame = makeFrame();
  const ahead = makeFrame();

  const state = {
    s: 0,
    x: 0,
    xVel: 0,
    speed: 0,
    shield: SHIP.shield,
    boost: 0,
    turbo: 0,
    lap: 0,
    finished: false,
    lapTime: 0,
    bestLap: 0,
    lastLap: 0,
    totalTime: 0,
    rank: 1,
    shake: 0,
    hitFlash: 0,
    hitThisFrame: false,
    boostedThisFrame: false,
    turboThisFrame: false,
    lapThisFrame: false,
  };


  // ------------------------------------------------------------------ physique
  const up = new Vector3();
  const target = new Vector3();
  const roll = new Quaternion();
  let hoverPhase = 0;

  function reset() {
    Object.assign(state, {
      s: 0, x: 0, xVel: 0, speed: 0, shield: SHIP.shield,
      boost: 0, turbo: 0, lap: 0, finished: false,
      lapTime: 0, bestLap: 0, lastLap: 0, totalTime: 0, rank: 1,
      shake: 0, hitFlash: 0,
    });
  }

  /** Choc latéral venu d'ailleurs : mur franchi, ou adversaire accroché. */
  function knock(direction, speedLoss, damage) {
    state.xVel = direction * Math.abs(state.xVel || 1) * 0.6 + direction * 10;
    state.speed *= speedLoss;
    state.shield = Math.max(0, state.shield - damage);
    state.shake = 1;
    state.hitFlash = 1;
    state.hitThisFrame = true;
  }

  /**
   * @param {number} dt
   * @param {{steer:number, throttle:number, turboRequested:boolean}} input
   * @param {boolean} racing faux pendant le décompte : on peut viser, pas avancer
   * @param {boolean} scored faux en vitrine : on roule, mais rien n'est compté
   */
  function update(dt, input, racing, scored = true) {
    if (!track) return;
    const limit = track.halfWidth - SHIP.halfWidth;

    state.hitThisFrame = false;
    state.boostedThisFrame = false;
    state.turboThisFrame = false;
    state.lapThisFrame = false;

    if (racing && !state.finished && input.turboRequested) {
      state.turbo = SHIP.turboDuration;
      state.turboThisFrame = true;
    }

    const ceiling = state.turbo > 0 ? SHIP.turboSpeed
      : state.boost > 0 ? SHIP.boostSpeed
        : SHIP.maxSpeed;

    if (racing && !state.finished) {
      // La manette est un levier : à fond devant, frein moteur au ralenti.
      const th = clamp(input.throttle, 0, 1);
      state.speed += (SHIP.thrust * th - SHIP.brake * (1 - th)) * dt;
      state.speed -= SHIP.drag * state.speed * state.speed * dt;
      if (state.boost > 0) state.speed += 240 * dt;
      if (state.turbo > 0) state.speed += 560 * dt;
      state.speed = clamp(state.speed, 0, ceiling);
    } else {
      state.speed = Math.max(0, state.speed - SHIP.brake * dt);
    }

    // L'autorité monte avec la vitesse sans jamais s'annuler à l'arrêt —
    // sinon on reste coincé contre un mur.
    const grip = 0.3 + 0.7 * (state.speed / SHIP.maxSpeed);
    state.xVel += input.steer * SHIP.steerForce * grip * dt;
    state.xVel -= state.xVel * SHIP.steerDamp * dt;

    // Dérive vers l'extérieur du virage : le dévers de la piste se paie.
    track.frameAt(state.s, frame);
    state.xVel += frame.bank * state.speed * SHIP.corneringDrift * dt;

    state.x += state.xVel * dt;

    if (Math.abs(state.x) > limit) {
      state.x = clamp(state.x, -limit, limit);
      state.xVel = -state.xVel * SHIP.wallBounce;
      state.speed *= SHIP.wallSpeedLoss;
      state.shield = Math.max(0, state.shield - SHIP.wallDamage);
      state.shake = 1;
      state.hitFlash = 1;
      state.hitThisFrame = true;
    }

    const prevS = state.s;
    state.s += state.speed * dt;

    if (racing && scored && !state.finished) {
      state.lapTime += dt;
      state.totalTime += dt;
      if (track.boostCrossed(prevS, state.s)) {
        state.boost = SHIP.boostDuration;
        state.boostedThisFrame = true;
      }
      if (Math.floor(state.s / track.length) > Math.floor(prevS / track.length)) {
        state.lap += 1;
        state.lastLap = state.lapTime;
        if (!state.bestLap || state.lapTime < state.bestLap) state.bestLap = state.lapTime;
        state.lapTime = 0;
        state.lapThisFrame = true;
        if (state.lap >= RACE.laps) state.finished = true;
      }
    }

    state.boost = Math.max(0, state.boost - dt);
    state.turbo = Math.max(0, state.turbo - dt);
    state.shake = Math.max(0, state.shake - dt * 2.6);
    state.hitFlash = Math.max(0, state.hitFlash - dt * 3.2);

    // ------------------------------------------------------------- caméra
    track.frameAt(state.s, frame);
    track.frameAt(state.s + 34 + state.speed * 0.09, ahead);

    hoverPhase += dt * SHIP.hoverFreq * (0.6 + state.speed / SHIP.maxSpeed);
    const hover = Math.sin(hoverPhase) * SHIP.hoverAmp
      + Math.sin(hoverPhase * 2.3) * SHIP.hoverAmp * 0.4;
    const jolt = state.shake * state.shake;

    camera.position.copy(frame.position)
      .addScaledVector(frame.binormal, state.x + (Math.random() - 0.5) * jolt * 1.6)
      .addScaledVector(frame.normal, 2.9 + hover + (Math.random() - 0.5) * jolt * 1.4);

    target.copy(ahead.position)
      .addScaledVector(ahead.binormal, state.x * 0.45)
      .addScaledVector(ahead.normal, 2.6);

    const lean = frame.bank * 0.85 + clamp(state.xVel * 0.013, -0.3, 0.3);
    roll.setFromAxisAngle(frame.tangent, -lean);
    up.copy(frame.normal).applyQuaternion(roll);
    camera.up.copy(up);
    camera.lookAt(target);
  }

  return {
    state,
    /** Branche le bolide sur un nouveau circuit. */
    attach(next) { track = next; reset(); },
    reset,
    update,
    knock,
    get normalizedSpeed() { return state.speed / SHIP.maxSpeed; },
    /** Distance totale parcourue : sert au classement. */
    get travelled() { return state.s; },
  };
}
