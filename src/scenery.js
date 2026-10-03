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
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
} from 'three';

import { bakeVertexLight, psxMaterial } from './psx.js';
import {
  makeBuildingTexture,
  makeGlowTexture,
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
  const { pos, tan, nrm, bin } = track.raw;
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
    /** Météorite : un icosaèdre bosselé au hasard, à vingt faces plates. */
    const rockGeometry = (lo = 0.72, hi = 1.3) => {
      const geo = new IcosahedronGeometry(1, 0);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const s = rand(lo, hi);
        p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
      }
      geo.computeVertexNormals();
      return bakeGeometry(geo, 0.24, 0.62);
    };

    // --------------------------------------------------- la muraille de rochers
    /**
     * Il n'y a pas de mur en orbite : la piste est une dalle nue dans le vide,
     * et ce sont les météorites plantées de part et d'autre qui disent où elle
     * s'arrête. Un rocher tous les deux échantillons de chaque côté, étirés
     * dans le sens de la marche pour se souder en chaîne continue.
     *
     * Le centre de chaque caillou est repoussé d'au moins son propre rayon
     * au-delà du bord : quelle que soit sa bosse, aucun ne mord sur la
     * trajectoire. La collision, elle, reste le simple écart latéral — les
     * rochers sont le mur qu'on voit, pas celui qu'on calcule.
     */
    const accent = `#${theme.accent.toString(16).padStart(6, '0')}`;
    const EDGE = track.halfWidth - 0.8;
    const STEP = 2;
    const slots = Math.floor(N / STEP);

    const chain = new InstancedMesh(
      rockGeometry(0.66, 1.3),
      psxMaterial({ map: makeRockTexture(accent) }),
      slots * 2
    );
    chain.frustumCulled = false;

    const basis = new Matrix4();
    /** Repère de piste à l'échantillon `i` : X = travers, Y = normale, Z = tangente. */
    const frameAt = (i, lat, up) => basis.set(
      bin[i * 3], nrm[i * 3], tan[i * 3],
      pos[i * 3] + bin[i * 3] * lat + nrm[i * 3] * up,
      bin[i * 3 + 1], nrm[i * 3 + 1], tan[i * 3 + 1],
      pos[i * 3 + 1] + bin[i * 3 + 1] * lat + nrm[i * 3 + 1] * up,
      bin[i * 3 + 2], nrm[i * 3 + 2], tan[i * 3 + 2],
      pos[i * 3 + 2] + bin[i * 3 + 2] * lat + nrm[i * 3 + 2] * up,
      0, 0, 0, 1
    );

    /** @type {{i:number, lat:number, up:number, side:number}[]} */
    const beaconSlots = [];
    let k = 0;
    for (let s = 0; s < slots; s++) {
      const i = s * STEP;
      for (const side of [-1, 1]) {
        const size = rand(9, 18);
        const lat = side * (EDGE + size * 1.35 + rand(0, size * 0.4));
        // plus qu'à moitié enfoncés : la crête reste basse, sinon le ciel
        // disparaît et on ne se croit plus dans l'espace
        const up = -size * rand(0.08, 0.5);
        dummy.position.set(0, 0, 0);
        dummy.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
        dummy.scale.set(size * rand(0.8, 1.0), size * rand(0.7, 1.1), size * rand(1.0, 1.7));
        dummy.updateMatrix();
        chain.setMatrixAt(k++, frameAt(i, lat, up).multiply(dummy.matrix));
        // la balise se pose dans l'intervalle libre entre le bord de la dalle
        // et la face intérieure des rochers, sinon elle disparaît dedans
        if (s % 9 === 4) beaconSlots.push({ i, lat: side * (track.halfWidth - 1.1), up: 7.5, side });
      }
    }
    chain.instanceMatrix.needsUpdate = true;
    root.add(chain);

    // Balises de bord plantées dans la roche : à 330 unités par seconde et
    // dans le noir, la bordure de la dalle seule ne suffit pas à se placer.
    const beacons = new InstancedMesh(
      new PlaneGeometry(5.2, 5.2),
      psxMaterial({
        map: makeGlowTexture(),
        color: theme.accent,
        vertexColors: false,
        affine: false,
        snap: false,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
      beaconSlots.length
    );
    beacons.frustumCulled = false;
    beacons.renderOrder = 2;
    for (let b = 0; b < beaconSlots.length; b++) {
      const { i, lat, up, side } = beaconSlots[b];
      // la balise regarde la piste : son axe local Z suit -side × travers
      const px = pos[i * 3] + bin[i * 3] * lat + nrm[i * 3] * up;
      const py = pos[i * 3 + 1] + bin[i * 3 + 1] * lat + nrm[i * 3 + 1] * up;
      const pz = pos[i * 3 + 2] + bin[i * 3 + 2] * lat + nrm[i * 3 + 2] * up;
      basis.set(
        tan[i * 3], nrm[i * 3], -side * bin[i * 3], px,
        tan[i * 3 + 1], nrm[i * 3 + 1], -side * bin[i * 3 + 1], py,
        tan[i * 3 + 2], nrm[i * 3 + 2], -side * bin[i * 3 + 2], pz,
        0, 0, 0, 1
      );
      beacons.setMatrixAt(b, basis);
    }
    beacons.instanceMatrix.needsUpdate = true;
    root.add(beacons);

    // ------------------------------------------------ le champ de météorites
    const COUNT = 240;
    const rocks = new InstancedMesh(rockGeometry(), psxMaterial({ map: makeRockTexture() }), COUNT);
    rocks.frustumCulled = false;
    for (let j = 0; j < COUNT; j++) {
      const i = Math.floor(Math.random() * N);
      const lat = (Math.random() < 0.5 ? -1 : 1) * rand(70, 860);
      const size = rand(10, 76);
      dummy.position.set(
        pos[i * 3] + bin[i * 3] * lat,
        pos[i * 3 + 1] + rand(-340, 360),
        pos[i * 3 + 2] + bin[i * 3 + 2] * lat
      );
      dummy.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      rocks.setMatrixAt(j, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    root.add(rocks);

    // anneaux de poussière, à la Saturne : trois disques inclinés
    const ringTex = makeRingTexture();
    const ringMat = psxMaterial({
      map: ringTex,
      // Additif : la teinte sert de gradateur, et il en faut un franc. À
      // pleine intensité la poussière ajoutait près d'un demi en linéaire
      // par-dessus un ciel noir — le bandeau mangeait tout le haut de l'image.
      color: 0x4e4a3c,
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
      ring.rotation.set(0.4 + k * 0.05, k * 1.1, 0.16);
      ring.position.y = -200 - k * 100;
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
