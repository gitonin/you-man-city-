import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
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
const makeFrame = () => ({
  position: new Vector3(),
  tangent: new Vector3(),
  normal: new Vector3(),
  binormal: new Vector3(),
  bank: 0,
  covered: false,
});

/**
 * Les deux carlingues.
 *
 * Une silhouette tient en une seule polyligne : le bord intérieur de la
 * verrière, de gauche à droite, en fractions de la demi-largeur et de la
 * demi-hauteur de l'image. Tout ce qui est en dessous est de la coque, et se
 * triangule en éventail depuis un point situé hors cadre par le bas — ce qui
 * marche tant que les abscisses ne reculent pas. Un maximum local dans la
 * polyligne devient donc un éperon qui monte dans le champ de vision.
 *
 * `edgeY` est la hauteur à laquelle le montant touche le bord de l'écran :
 * bas pour l'antigravité, qui est une voiture ouverte sur la route ; haut
 * pour le vaisseau, dont la verrière enveloppe.
 *
 * L'ombrage est cuit de la même façon : noir franc au ras de l'écran, et
 * remontée en puissance vers l'arête. Le dégradé doit être marqué, sinon la
 * carlingue sort exactement à la luminosité de la chaussée et disparaît —
 * c'est ce qui arrivait avec une rampe linéaire trop plate.
 */
const HULLS = {
  antigrav: {
    edgeY: -0.22,
    inner: [[-0.55, -0.62], [-0.11, -0.80], [0.11, -0.80], [0.55, -0.62]],
    shade: { base: 0.004, gain: 0.072, rgb: [0.78, 0.95, 1.3] },
    rim: 0x14525e,
  },
  /** Deux éperons avant encadrent une arête dorsale : on pilote un dard. */
  starship: {
    edgeY: -0.10,
    inner: [
      [-0.86, -0.34], [-0.62, -0.56], [-0.54, -0.30], [-0.44, -0.60],
      [-0.15, -0.76], [0.0, -0.64], [0.15, -0.76],
      [0.44, -0.60], [0.54, -0.30], [0.62, -0.56], [0.86, -0.34],
    ],
    shade: { base: 0.005, gain: 0.088, rgb: [0.84, 0.93, 1.24] },
    rim: 0x2a5ca4,
  },
};

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


  // ------------------------------------------------------------------ cockpit
  const cockpit = new Group();
  camera.add(cockpit);

  let cockpitMesh = null;
  let rimMesh = null;
  let hull = HULLS.antigrav;
  /** Dernières dimensions reçues : changer de carlingue reconstruit à l'identique. */
  let lastAspect = 1;
  let lastFov = 68;
  // Double face : la carlingue est triangulée en éventail depuis un point
  // hors cadre, ce qui donne un enroulement horaire. Sans ça elle est culée et
  // il ne reste que le liseré, à flotter sur la route.
  const cockpitMat = psxMaterial({
    color: 0xffffff, vertexColors: true, affine: false, fog: false, side: DoubleSide,
  });
  const rimMat = psxMaterial({
    color: hull.rim,
    vertexColors: false,
    affine: false,
    fog: false,
    toneMapped: false,
    side: DoubleSide,
  });

  /**
   * Le cockpit est dessiné en proportion du champ de vision : quel que soit
   * l'écran, il mord toujours autant sur les bords.
   */
  function buildCockpit(aspect = lastAspect, fovDeg = lastFov) {
    lastAspect = aspect;
    lastFov = fovDeg;
    const d = 2.0;
    const hh = Math.tan((fovDeg * Math.PI) / 360) * d;
    const hw = hh * aspect;

    // le bord intérieur, bouclé par deux points hors cadre pour que
    // l'éventail couvre aussi les coins bas
    const outline = [
      [-1.5, -1.5], [-1.5, hull.edgeY],
      ...hull.inner,
      [1.5, hull.edgeY], [1.5, -1.5],
    ];
    const apex = [0, -1.5];
    const { base, gain, rgb } = hull.shade;

    const verts = [];
    const shades = [];
    const pushTri = (a, b, c) => {
      for (const pt of [a, b, c]) {
        verts.push(pt[0] * hw, pt[1] * hh, -d);
        const t = Math.max(0, (pt[1] + 1.15) / 1.15);
        const k = base + gain * Math.pow(Math.min(1, t), 1.6);
        shades.push(k * rgb[0], k * rgb[1], k * rgb[2]);
      }
    };

    for (let i = 0; i < outline.length - 1; i++) {
      pushTri(apex, outline[i], outline[i + 1]);
    }

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

    // liseré lumineux sur l'arête intérieure, hors points de bouclage
    const rim = [];
    const edge = outline.slice(1, -1);
    const w = 0.018;
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i];
      const b = edge[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * w;
      const oy = (dx / len) * w;
      for (const pt of [
        [a[0], a[1]], [b[0], b[1]], [b[0] + ox, b[1] + oy],
        [a[0], a[1]], [b[0] + ox, b[1] + oy], [a[0] + ox, a[1] + oy],
      ]) rim.push(pt[0] * hw, pt[1] * hh, -d + 0.004);
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
    cockpit,
    /**
     * Branche le bolide sur un nouveau circuit. En orbite, on ne pilote plus
     * une voiture qui plane mais un vaisseau : la carlingue change avec le
     * décor.
     */
    attach(next) {
      track = next;
      const wanted = next.theme.scenery === 'space' ? HULLS.starship : HULLS.antigrav;
      if (wanted !== hull) {
        hull = wanted;
        rimMat.color.setHex(hull.rim);
        buildCockpit();
      }
      reset();
    },
    reset,
    update,
    knock,
    buildCockpit,
    get normalizedSpeed() { return state.speed / SHIP.maxSpeed; },
    /** Distance totale parcourue : sert au classement. */
    get travelled() { return state.s; },
  };
}
