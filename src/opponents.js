import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Vector3,
} from 'three';

import { RACE, SHIP } from './config.js';
import { bakeVertexLight, psxMaterial } from './psx.js';
import { makeGlowTexture } from './textures.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

/** Un dard à facettes, dans l'esprit des vaisseaux de l'époque. */
function shipGeometry() {
  const N = [0.0, 0.0, 3.6];
  const TL = [-1.1, 0.55, -0.6];
  const TR = [1.1, 0.55, -0.6];
  const BL = [-1.9, -0.35, -2.0];
  const BR = [1.9, -0.35, -2.0];
  const FL = [-2.9, 0.05, -2.9];
  const FR = [2.9, 0.05, -2.9];
  const TA = [0.0, 0.15, -2.6];

  const tris = [
    [N, TL, TR], [TL, TA, TR],
    [N, BL, TL], [TL, BL, TA],
    [N, TR, BR], [TR, TA, BR],
    [N, BR, BL], [BL, BR, TA],
    [BL, FL, TA], [BR, TA, FR],
  ];

  const positions = new Float32Array(tris.length * 9);
  let k = 0;
  for (const tri of tris) {
    for (const v of tri) {
      positions[k++] = v[0]; positions[k++] = v[1]; positions[k++] = v[2];
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.computeVertexNormals(); // non indexée : normales plates, comme il se doit

  const normals = geo.attributes.normal;
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const [r, g, b] = bakeVertexLight(
      normals.getX(i), normals.getY(i), normals.getZ(i), 0.36, 0.64
    );
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

/**
 * Les adversaires.
 *
 * Ils vivent dans le même espace piste que le joueur — une abscisse, un écart
 * latéral — et ne font donc jamais rien d'impossible : pas de sortie de route,
 * pas de traversée de mur. Leur « intelligence » tient en trois règles :
 * viser une vitesse propre à chacun, lever le pied dans les virages, et
 * tracer une trajectoire sinueuse qui évite le joueur quand il est à côté.
 */
export function createOpponents(scene, track, theme) {
  const count = RACE.opponents;
  const group = new Group();
  scene.add(group);

  const bodies = new InstancedMesh(
    shipGeometry(),
    psxMaterial({ vertexColors: true, affine: false, side: DoubleSide }),
    count
  );
  bodies.frustumCulled = false;
  group.add(bodies);

  const glows = new InstancedMesh(
    new PlaneGeometry(2.6, 1.1),
    psxMaterial({
      map: makeGlowTexture(),
      vertexColors: false,
      affine: false,
      snap: false,
      fog: false,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
    count
  );
  glows.frustumCulled = false;
  glows.renderOrder = 2;
  group.add(glows);

  const limit = track.halfWidth - SHIP.halfWidth;
  const color = new Color();
  const frame = track.makeFrame();
  const matrix = new Matrix4();
  const glowOffset = new Matrix4().makeTranslation(0, 0.1, -2.95);
  const position = new Vector3();

  /** @type {{s:number,x:number,speed:number,lap:number,targetLane:number}[]} */
  const racers = [];

  function reset() {
    racers.length = 0;
    for (let i = 0; i < count; i++) {
      racers.push({
        // grille de départ : ils partent devant, le joueur doit remonter
        s: (i + 1) * 17,
        x: (i % 2 ? 1 : -1) * limit * (0.26 + (i % 3) * 0.22),
        speed: 0,
        lane: 0,
        laneSeed: rand(0, Math.PI * 2),
        // chacun son tempérament : de poussif à redoutable
        pace: 0.92 + (i / Math.max(1, count - 1)) * 0.22 + rand(-0.03, 0.03),
        weave: rand(0.0018, 0.0034),
        hue: (i / count) * 0.8 + 0.05,
      });
      bodies.setColorAt(i, color.setHSL(racers[i].hue, 0.55, 0.62));
      glows.setColorAt(i, color.setHSL(racers[i].hue, 1, 0.6));
    }
    bodies.instanceColor.needsUpdate = true;
    glows.instanceColor.needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @param {object} player état du joueur, pour l'évitement et les accrochages
   * @param {boolean} racing
   * @returns {boolean} vrai si le joueur vient d'en accrocher un
   */
  function update(dt, player, racing) {
    let rubbed = false;

    for (let i = 0; i < count; i++) {
      const r = racers[i];

      if (racing) {
        const bank = Math.abs(track.bankAt(r.s));
        // on lève le pied à proportion du dévers : c'est ce qui crée les
        // occasions de dépassement en sortie de virage
        const target = SHIP.maxSpeed * r.pace * (1 - Math.min(0.28, bank * 0.7));
        r.speed += clamp(target - r.speed, -SHIP.brake * dt, SHIP.thrust * dt);

        // trajectoire : une sinusoïde lente, déviée si le joueur est à côté
        let lane = Math.sin(r.laneSeed + r.s * r.weave) * limit * 0.55;
        const gap = r.s - player.s;
        if (Math.abs(gap) < 14) {
          // l'écart d'évitement suit la largeur de la chaussée, sinon sur une
          // piste large ils s'écartent d'un rien et restent dans les pieds
          const away = Math.sign(r.x - player.x) || 1;
          lane = clamp(r.x + away * limit * 0.42, -limit, limit);
        }
        r.lane = lane;
        r.x += clamp(lane - r.x, -18 * dt, 18 * dt);
        r.x = clamp(r.x, -limit, limit);
        r.s += r.speed * dt;

        // accrochage avec le joueur
        if (Math.abs(gap) < 6.5 && Math.abs(r.x - player.x) < 4.4) {
          rubbed = true;
          const away = Math.sign(player.x - r.x) || 1;
          r.x = clamp(r.x - away * 1.5, -limit, limit);
          r.speed *= 0.96;
        }
      }

      track.frameAt(r.s, frame);
      position.copy(frame.position)
        .addScaledVector(frame.binormal, r.x)
        .addScaledVector(frame.normal, 1.5);

      // base locale : X = travers, Y = normale, Z = tangente
      matrix.set(
        frame.binormal.x, frame.normal.x, frame.tangent.x, position.x,
        frame.binormal.y, frame.normal.y, frame.tangent.y, position.y,
        frame.binormal.z, frame.normal.z, frame.tangent.z, position.z,
        0, 0, 0, 1
      );
      bodies.setMatrixAt(i, matrix);
      glows.setMatrixAt(i, matrix.clone().multiply(glowOffset));
    }

    bodies.instanceMatrix.needsUpdate = true;
    glows.instanceMatrix.needsUpdate = true;
    return rubbed;
  }

  /** Rang du joueur : combien d'adversaires sont devant. */
  function rankOf(playerS) {
    let ahead = 0;
    for (const r of racers) if (r.s > playerS) ahead++;
    return ahead + 1;
  }

  reset();
  void theme;

  return { group, racers, reset, update, rankOf, total: count + 1 };
}
