import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
} from 'three';

import { bakeVertexLight, psxMaterial } from './psx.js';
import {
  makeBuildingTexture,
  makeGroundTexture,
  makeRingTexture,
  makeRockTexture,
  makeSkyTexture,
} from './textures.js';

const rand = (a, b) => a + Math.random() * (b - a);

/** Couleurs de sommet cuites sur une géométrie, d'après ses normales. */
function bakeGeometry(geo, ambient, gain) {
  const normals = geo.attributes.normal;
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const [r, g, b] = bakeVertexLight(
      normals.getX(i), normals.getY(i), normals.getZ(i), ambient, gain
    );
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

/** Anneau plat, texturé radialement — ce que RingGeometry ne sait pas faire. */
function annulus(inner, outer, segments) {
  const positions = new Float32Array(segments * 2 * 3);
  const uvs = new Float32Array(segments * 2 * 2);
  const indices = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / (segments - 1)) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions[i * 6] = c * inner; positions[i * 6 + 1] = 0; positions[i * 6 + 2] = s * inner;
    positions[i * 6 + 3] = c * outer; positions[i * 6 + 4] = 0; positions[i * 6 + 5] = s * outer;
    uvs[i * 4] = 0; uvs[i * 4 + 1] = i / segments;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = i / segments;
    if (i < segments - 1) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Le décor d'un circuit : ce qu'on voit au-delà des murs.
 *
 * Quatre familles, une par thème. Elles partagent le ciel et se distinguent
 * par ce qu'elles posent autour : des tours, des blocs de béton, rien du tout,
 * ou des rochers en orbite.
 */
export function buildScenery(scene, track, theme) {
  const root = new Group();
  scene.add(root);
  const { pos, bin } = track.raw;
  const N = track.samples;
  const dummy = new Object3D();

  // ------------------------------------------------------------------- ciel
  const sky = new Mesh(
    new SphereGeometry(1900, 24, 16),
    psxMaterial({
      map: makeSkyTexture(theme),
      vertexColors: false,
      snap: false,
      affine: false,
      fog: false,
      side: BackSide,
      depthWrite: false,
    })
  );
  sky.renderOrder = -10;
  root.add(sky);

  // -------------------------------------------------------------------- sol
  if (theme.ground) {
    const groundTex = makeGroundTexture(theme);
    groundTex.repeat.set(110, 110);
    const ground = new Mesh(
      new PlaneGeometry(7000, 7000),
      psxMaterial({ map: groundTex, vertexColors: false, snap: false })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -80;
    root.add(ground);
  }

  const spin = [];

  // --------------------------------------------------------- tours et blocs
  if (theme.scenery === 'city' || theme.scenery === 'blocks') {
    const dense = theme.scenery === 'blocks';
    const COUNT = dense ? 230 : 190;
    const geo = bakeGeometry(new BoxGeometry(1, 1, 1), dense ? 0.42 : 0.28, dense ? 0.4 : 0.5);
    const towers = new InstancedMesh(geo, psxMaterial({ map: makeBuildingTexture(theme) }), COUNT);
    towers.frustumCulled = false;
    for (let k = 0; k < COUNT; k++) {
      const i = Math.floor(Math.random() * N);
      // en quartier de béton, les immeubles serrent la piste de près
      const lat = (Math.random() < 0.5 ? -1 : 1) * (dense ? rand(34, 300) : rand(50, 560));
      const h = dense ? rand(60, 260) : rand(26, 220);
      dummy.position.set(
        pos[i * 3] + bin[i * 3] * lat,
        pos[i * 3 + 1] - 26 + h / 2,
        pos[i * 3 + 2] + bin[i * 3 + 2] * lat
      );
      dummy.rotation.set(0, rand(0, Math.PI), 0);
      dummy.scale.set(dense ? rand(26, 64) : rand(16, 48), h, dense ? rand(26, 64) : rand(16, 48));
      dummy.updateMatrix();
      towers.setMatrixAt(k, dummy.matrix);
    }
    towers.instanceMatrix.needsUpdate = true;
    root.add(towers);
  }

  // ------------------------------------------------------------ orbite
  if (theme.scenery === 'space') {
    // météorites : des icosaèdres bosselés, figés mais tournant lentement
    const rock = new IcosahedronGeometry(1, 0);
    const p = rock.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = rand(0.72, 1.3);
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
    }
    rock.computeVertexNormals();
    bakeGeometry(rock, 0.24, 0.62);

    const COUNT = 220;
    const rocks = new InstancedMesh(rock, psxMaterial({ map: makeRockTexture() }), COUNT);
    rocks.frustumCulled = false;
    for (let k = 0; k < COUNT; k++) {
      const i = Math.floor(Math.random() * N);
      const lat = (Math.random() < 0.5 ? -1 : 1) * rand(95, 860);
      const size = rand(10, 76);
      dummy.position.set(
        pos[i * 3] + bin[i * 3] * lat,
        pos[i * 3 + 1] + rand(-340, 360),
        pos[i * 3 + 2] + bin[i * 3 + 2] * lat
      );
      dummy.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      rocks.setMatrixAt(k, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    root.add(rocks);

    // anneaux de poussière, à la Saturne : trois disques inclinés
    const ringTex = makeRingTexture();
    const ringMat = psxMaterial({
      map: ringTex,
      vertexColors: false,
      snap: false,
      affine: false,
      fog: false,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    for (let k = 0; k < 3; k++) {
      const ring = new Mesh(annulus(1500 + k * 420, 2600 + k * 520, 128), ringMat);
      ring.rotation.set(0.42 + k * 0.05, k * 1.1, 0.16);
      ring.position.y = -120 - k * 90;
      ring.renderOrder = -8;
      root.add(ring);
      spin.push({ object: ring, speed: 0.004 + k * 0.002 });
    }

    // la planète dont on longe les anneaux
    const planet = new Mesh(
      new SphereGeometry(520, 24, 16),
      psxMaterial({
        color: 0x9a6b4e, vertexColors: false, snap: false, affine: false, fog: false,
      })
    );
    planet.position.set(-2300, 420, -1600);
    planet.renderOrder = -9;
    root.add(planet);
  }

  // Le tube chromatique est presque entièrement couvert : rien à poser
  // dehors, l'intérieur fait tout le travail.

  function update(dt) {
    for (const s of spin) s.object.rotation.y += s.speed * dt;
  }

  return { root, update };
}
