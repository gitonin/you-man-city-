import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';

import { RACE, SHIP } from './config.js';
import { psxMaterial } from './psx.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Le bolide, et la caméra qui est dans son cockpit.
 *
 * Tout l'état tient en deux scalaires : `s`, la distance parcourue sur le
 * ruban, et `x`, l'écart par rapport à l'axe. Le monde n'intervient que pour
 * convertir ce couple en position et en orientation.
 */
export function createShip(track, camera) {
  const frame = track.makeFrame();
  const ahead = track.makeFrame();

  const state = {
    s: 0,
    x: 0,
    xVel: 0,
    speed: 0,
    shield: SHIP.shield,
    boost: 0,
    lap: 0,
    finished: false,
    /** Temps du tour en cours et meilleur tour, en secondes. */
    lapTime: 0,
    bestLap: 0,
    lastLap: 0,
    totalTime: 0,
    /** Secousse caméra après un choc, 0..1. */
    shake: 0,
    hitFlash: 0,
    /** Vrai pendant l'image où l'on vient de toucher un mur. */
    hitThisFrame: false,
    boostedThisFrame: false,
    lapThisFrame: false,
  };

  const limit = track.halfWidth - SHIP.halfWidth;

  // ------------------------------------------------------------------ cockpit
  const cockpit = new Group();
  camera.add(cockpit);

  let cockpitMesh = null;
  const cockpitMat = psxMaterial({
    color: 0xffffff,
    vertexColors: true,
    affine: false,
    fog: false,
  });
  const rimMat = psxMaterial({
    color: 0x14525e,
    vertexColors: false,
    affine: false,
    fog: false,
    toneMapped: false,
  });
  let rimMesh = null;

  /**
   * Le cockpit est dessiné en proportion du champ de vision : quel que soit
   * l'écran, il mord toujours autant sur les bords.
   */
  function buildCockpit(aspect, fovDeg) {
    const d = 2.0;
    const hh = Math.tan((fovDeg * Math.PI) / 360) * d;
    const hw = hh * aspect;

    // silhouette en (u, v), normalisée sur la demi-largeur / demi-hauteur
    const L = [
      [-1.30, -1.30], // hors cadre, en bas à gauche
      [-1.30, -0.22], // montant qui file vers le bord gauche
      [-0.55, -0.62], // épaule intérieure
      [-0.11, -0.80], // pointe centrale
    ];
    const mirror = (pt) => [-pt[0], pt[1]];
    const R = L.map(mirror);

    const verts = [];
    const shades = [];
    const pushTri = (a, b, c) => {
      for (const pt of [a, b, c]) {
        verts.push(pt[0] * hw, pt[1] * hh, -d);
        // dégradé : le bas du cockpit reste dans l'ombre
        const k = 0.016 + Math.max(0, pt[1] + 1.1) * 0.075;
        shades.push(k * 0.78, k * 0.95, k * 1.3);
      }
    };

    pushTri(L[0], L[1], L[2]);
    pushTri(L[0], L[2], L[3]);
    pushTri(R[0], R[2], R[1]);
    pushTri(R[0], R[3], R[2]);
    // plancher entre les deux pointes
    pushTri(L[0], L[3], R[3]);
    pushTri(L[0], R[3], R[0]);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(shades), 3));

    if (cockpitMesh) {
      cockpit.remove(cockpitMesh);
      cockpitMesh.geometry.dispose();
    }
    cockpitMesh = new Mesh(geo, cockpitMat);
    cockpitMesh.frustumCulled = false;
    cockpit.add(cockpitMesh);

    // liseré lumineux sur l'arête intérieure
    const rim = [];
    const edge = [L[1], L[2], L[3], R[3], R[2], R[1]];
    const w = 0.018;
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i];
      const b = edge[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * w;
      const oy = (dx / len) * w;
      const quad = [
        [a[0], a[1]], [b[0], b[1]], [b[0] + ox, b[1] + oy],
        [a[0], a[1]], [b[0] + ox, b[1] + oy], [a[0] + ox, a[1] + oy],
      ];
      for (const pt of quad) rim.push(pt[0] * hw, pt[1] * hh, -d + 0.004);
    }
    const rimGeo = new BufferGeometry();
    rimGeo.setAttribute('position', new BufferAttribute(new Float32Array(rim), 3));
    if (rimMesh) {
      cockpit.remove(rimMesh);
      rimMesh.geometry.dispose();
    }
    rimMesh = new Mesh(rimGeo, rimMat);
    rimMesh.frustumCulled = false;
    cockpit.add(rimMesh);
  }

  // ------------------------------------------------------------------ physique
  const up = new Vector3();
  const target = new Vector3();
  const roll = new Quaternion();
  let hoverPhase = 0;

  function reset() {
    state.s = 0;
    state.x = 0;
    state.xVel = 0;
    state.speed = 0;
    state.shield = SHIP.shield;
    state.boost = 0;
    state.lap = 0;
    state.finished = false;
    state.lapTime = 0;
    state.bestLap = 0;
    state.lastLap = 0;
    state.totalTime = 0;
    state.shake = 0;
  }

  /**
   * @param {number} dt
   * @param {{steer:number, thrust:boolean}} input
   * @param {boolean} racing faux pendant le décompte : on peut viser, pas avancer
   */
  function update(dt, input, racing) {
    state.hitThisFrame = false;
    state.boostedThisFrame = false;
    state.lapThisFrame = false;

    const ceiling = state.boost > 0 ? SHIP.boostSpeed : SHIP.maxSpeed;

    if (racing && !state.finished) {
      state.speed += (input.thrust ? SHIP.thrust : -SHIP.coast) * dt;
      state.speed -= SHIP.drag * state.speed * state.speed * dt;
      if (state.boost > 0) state.speed += 260 * dt;
      state.speed = clamp(state.speed, 0, ceiling);
    } else {
      state.speed = Math.max(0, state.speed - SHIP.coast * 2 * dt);
    }

    // Direction : l'autorité monte avec la vitesse, sans jamais s'annuler à
    // l'arrêt — sinon on reste coincé contre un mur.
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

    if (racing && !state.finished) {
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

    // roulis : dévers de la piste, plus l'appui du vaisseau dans le virage
    const lean = frame.bank * 0.85 + clamp(state.xVel * 0.013, -0.3, 0.3);
    roll.setFromAxisAngle(frame.tangent, -lean);
    up.copy(frame.normal).applyQuaternion(roll);
    camera.up.copy(up);
    camera.lookAt(target);
  }

  return {
    state,
    cockpit,
    reset,
    update,
    buildCockpit,
    get normalizedSpeed() { return state.speed / SHIP.maxSpeed; },
    get progress() { return (state.s % track.length) / track.length; },
  };
}
