import {
  AdditiveBlending,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
} from 'three';

import { MUSIC, RHYTHM } from './config.js';
import { psxMaterial } from './psx.js';
import { makeGateTexture } from './textures.js';

/**
 * Le volet rythmique.
 *
 * Le morceau est à 119 BPM pile et la position de lecture d'un `<audio>` est
 * exprimée en temps de média : quand la bande accélère, `currentTime` avance
 * plus vite, donc la grille de temps suit toute seule la vitesse du bolide.
 * Aucune analyse temps réel n'est nécessaire — juste une division.
 *
 * De cette horloge découlent : le battement des portiques le long du circuit,
 * une lumière qui en fait le tour à la noire, un coup de corruption sur chaque
 * temps fort, et une note quand on passe sous un portique.
 */
export function createRhythm(scene, track, audio, theme) {
  const period = 60 / MUSIC.bpm;
  const count = RHYTHM.gates;

  const spacing = track.length / count;
  const gates = [];
  for (let i = 0; i < count; i++) {
    gates.push({
      dist: i * spacing,
      index: Math.floor((i * spacing / track.length) * track.samples) % track.samples,
      note: RHYTHM.scale[i % RHYTHM.scale.length] + (i % 2 ? 12 : 0),
      flash: 0,
    });
  }

  // une barre lumineuse en travers, qu'on passe par-dessous
  const bars = new InstancedMesh(
    new PlaneGeometry(track.halfWidth * 2.1, 3.4),
    psxMaterial({
      map: makeGateTexture(),
      vertexColors: false,
      affine: false,
      snap: false,
      fog: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
    count
  );
  bars.frustumCulled = false;
  bars.renderOrder = 3;
  scene.add(bars);

  const color = new Color();
  const base = new Color(theme.accent);

  // Les barres ne bougent jamais : on les pose une fois pour toutes dans le
  // repère de la piste (X = travers, Y = normale, Z = tangente).
  {
    const { pos, tan, nrm, bin } = track.raw;
    const matrix = new Matrix4();
    const height = track.wallHeight + 1.8;
    for (let k = 0; k < count; k++) {
      const i = gates[k].index;
      matrix.set(
        bin[i * 3], nrm[i * 3], tan[i * 3], pos[i * 3] + nrm[i * 3] * height,
        bin[i * 3 + 1], nrm[i * 3 + 1], tan[i * 3 + 1], pos[i * 3 + 1] + nrm[i * 3 + 1] * height,
        bin[i * 3 + 2], nrm[i * 3 + 2], tan[i * 3 + 2], pos[i * 3 + 2] + nrm[i * 3 + 2] * height,
        0, 0, 0, 1
      );
      bars.setMatrixAt(k, matrix);
      bars.setColorAt(k, color.copy(base).multiplyScalar(0.2));
    }
    bars.instanceMatrix.needsUpdate = true;
    bars.instanceColor.needsUpdate = true;
  }

  const state = {
    beat: 0,
    index: -1,
    bar: 0,
    /** Retombe de 1 à 0 entre deux temps. */
    pulse: 0,
    /** Idem, mais seulement sur le premier temps de la mesure. */
    downbeat: 0,
    runner: 0,
    noteThisFrame: false,
  };

  let lastCrossed = -1;

  function reset() {
    state.index = -1;
    state.pulse = 0;
    state.downbeat = 0;
    lastCrossed = -1;
    for (const g of gates) g.flash = 0;
  }

  /**
   * @param {number} dt
   * @param {number} playerS abscisse du joueur, pour savoir ce qu'il franchit
   * @param {number} prevS
   * @param {boolean} racing
   */
  function update(dt, playerS, prevS, racing) {
    state.noteThisFrame = false;

    const time = audio.mediaTime();
    if (time > 0) {
      state.beat = (time - MUSIC.beatOffset) / period;
      const idx = Math.floor(state.beat);
      if (idx !== state.index) {
        if (state.index >= 0) {
          state.pulse = 1;
          if (idx % 4 === 0) state.downbeat = 1;
        }
        state.index = idx;
        state.bar = Math.floor(idx / 4);
        state.runner = ((idx % count) + count) % count;
        gates[state.runner].flash = Math.max(gates[state.runner].flash, 1);
      }
    }

    // la lecture ralentit avec le bolide : les retombées aussi
    const decay = Math.min(1, dt / Math.max(0.05, period * 0.55));
    state.pulse = Math.max(0, state.pulse - decay);
    state.downbeat = Math.max(0, state.downbeat - decay * 0.6);

    if (racing) {
      const len = track.length;
      const a = ((prevS % len) + len) % len;
      const z = ((playerS % len) + len) % len;
      for (let i = 0; i < count; i++) {
        const d = gates[i].dist;
        const crossed = z < a ? (d >= a || d <= z) : (d >= a && d <= z);
        if (crossed && i !== lastCrossed) {
          lastCrossed = i;
          gates[i].flash = 1.6;
          audio.note(RHYTHM.baseFreq * Math.pow(2, gates[i].note / 12));
          state.noteThisFrame = true;
        }
      }
    }

    for (let i = 0; i < count; i++) {
      const g = gates[i];
      g.flash = Math.max(0, g.flash - dt * 2.4);
      const lit = 0.16 + state.pulse * 0.4 + g.flash * 1.5 + state.downbeat * 0.25;
      color.copy(base).multiplyScalar(lit);
      bars.setColorAt(i, color);
    }
    bars.instanceColor.needsUpdate = true;
  }

  return { bars, gates, state, reset, update, period };
}
