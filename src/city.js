import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
} from 'three';

import { GRID, PALETTE, TEXT_YAW } from './config.js';
import { layoutText } from './font.js';
import {
  makeFacadeTexture,
  makeGlowTexture,
  makeGroundTexture,
  makeSkyTexture,
} from './textures.js';

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Fait varier la densité de fenêtres selon la taille de l'instance : sans ça
 * une tour de 90 m et un socle de 6 m portent le même nombre d'étages.
 */
function enableUvScale(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aUvScale;')
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv *= aUvScale;\n#endif'
      );
  };
  material.customProgramCacheKey = () => 'ym-uvscale';
  return material;
}

function instanced(geometry, material, count) {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(35044); // StaticDrawUsage
  mesh.frustumCulled = false;
  const uvScale = new InstancedBufferAttribute(new Float32Array(count * 2), 2);
  mesh.geometry.setAttribute('aUvScale', uvScale);
  mesh.userData.uvScale = uvScale;
  return mesh;
}

/**
 * Construit la cité. La géométrie ne bouge plus ensuite ; seule l'intensité
 * des néons est pilotée (par `setLock`) au fil de la recherche du joueur.
 */
export function buildCity(scene) {
  const dummy = new Object3D();
  const color = new Color();

  const root = new Group();
  root.rotation.y = TEXT_YAW;
  scene.add(root);

  const props = new Group(); // ce qui reste aligné sur le monde
  scene.add(props);

  // ------------------------------------------------------------------ ciel
  const sky = new Mesh(
    new SphereGeometry(1600, 32, 20),
    new MeshBasicMaterial({ map: makeSkyTexture(), side: BackSide, fog: false, depthWrite: false })
  );
  sky.renderOrder = -10;
  props.add(sky);

  // ------------------------------------------------------------------- sol
  const ground = new Mesh(
    new PlaneGeometry(4200, 4200),
    new MeshBasicMaterial({ map: makeGroundTexture() })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.4;
  root.add(ground);

  // ------------------------------------------------- disposition des lettres
  const { cells, width: cols, height: rows } = layoutText(['YOU', 'MAN'], GRID.lineGap);
  const cell = GRID.cell;
  const fieldW = cols * cell;
  const fieldD = rows * cell;
  const originX = -fieldW / 2 + cell / 2;
  const originZ = -fieldD / 2 + cell / 2;

  const letterSlots = [];
  const podiumSlots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = originX + c * cell;
      const z = originZ + r * cell;
      if (cells[r][c]) letterSlots.push({ x, z, c, r });
      else if (Math.random() < 0.72) podiumSlots.push({ x, z });
    }
  }

  // ------------------------------------------------------- tours des lettres
  const towerTex = makeFacadeTexture({
    cols: 5,
    rows: 9,
    lit: 0.5,
    tints: ['#bfe9ff', '#7fd8ff', '#ffd9a8', '#ffffff', '#9ec2ff'],
    wall: '#070912',
  });

  const towers = instanced(
    new BoxGeometry(1, 1, 1),
    enableUvScale(new MeshBasicMaterial({ map: towerTex })),
    letterSlots.length
  );

  const capGeo = new BoxGeometry(1, 1, 1);
  const caps = new InstancedMesh(
    capGeo,
    new MeshBasicMaterial({ toneMapped: false, fog: false }),
    letterSlots.length
  );
  caps.frustumCulled = false;

  const glowTex = makeGlowTexture(160, 2.6);
  const halos = new InstancedMesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      opacity: 0.07,
    }),
    letterSlots.length
  );
  halos.frustumCulled = false;
  halos.renderOrder = 5;

  /** Couleur néon de chaque lettre : dégradé cyan → magenta sur la largeur. */
  const capColors = [];
  const towerTops = [];

  letterSlots.forEach((slot, i) => {
    const h = rand(GRID.towerH[0], GRID.towerH[1]);
    const foot = GRID.towerFoot * rand(0.94, 1.0);

    dummy.position.set(slot.x, h / 2, slot.z);
    dummy.scale.set(foot, h, foot);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    towers.setMatrixAt(i, dummy.matrix);
    towers.userData.uvScale.setXY(i, 1.5, Math.max(1, Math.round(h / 9)));

    color.setHSL(0.5, 0.35, 0.5).multiplyScalar(1);
    towers.setColorAt(i, color.setHSL(0.55 + (slot.c / cols) * 0.28, 0.3, rand(0.55, 0.9)));

    // couronne néon
    // Le cyan sature plus vite que le magenta une fois passé dans le bloom :
    // on le rattrape par un léger gain progressif sur la largeur.
    const t = slot.c / cols;
    const hue = 0.53 + t * 0.35; // cyan → magenta
    const capColor = new Color().setHSL(hue, 0.95, 0.5).multiplyScalar(0.8 + t * 0.2);
    capColors.push(capColor);

    dummy.position.set(slot.x, h + 0.9, slot.z);
    dummy.scale.set(foot + 1.4, 1.15, foot + 1.4);
    dummy.updateMatrix();
    caps.setMatrixAt(i, dummy.matrix);
    caps.setColorAt(i, capColor);

    dummy.position.set(slot.x, h + 3.2, slot.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(cell * 1.75, cell * 1.75, 1);
    dummy.updateMatrix();
    halos.setMatrixAt(i, dummy.matrix);
    halos.setColorAt(i, capColor);

    towerTops.push({ x: slot.x, y: h, z: slot.z });
  });

  root.add(towers, caps, halos);

  // ------------------------------------------------------------- socles bas
  const podiumTex = makeFacadeTexture({
    cols: 6,
    rows: 4,
    lit: 0.26,
    tints: ['#ffb265', '#8ab6ff', '#cfd8e6'],
    wall: '#06070e',
  });
  const podiums = instanced(
    new BoxGeometry(1, 1, 1),
    enableUvScale(new MeshBasicMaterial({ map: podiumTex })),
    podiumSlots.length
  );
  podiumSlots.forEach((slot, i) => {
    const h = rand(GRID.podiumH[0], GRID.podiumH[1]);
    const foot = GRID.podiumFoot * rand(0.8, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(slot.x + rand(-0.6, 0.6), h / 2, slot.z + rand(-0.6, 0.6));
    dummy.scale.set(foot, h, foot);
    dummy.updateMatrix();
    podiums.setMatrixAt(i, dummy.matrix);
    podiums.userData.uvScale.setXY(i, 2, Math.max(1, Math.round(h / 5)));
    podiums.setColorAt(i, color.setHSL(rand(0.05, 0.12), 0.35, rand(0.3, 0.55)));
  });
  root.add(podiums);

  // ------------------------------------------- anneau urbain autour du quartier
  const fillerTex = makeFacadeTexture({
    cols: 5,
    rows: 8,
    lit: 0.34,
    tints: ['#ffc07a', '#8fd6ff', '#e6ecf7', '#ff9ad4'],
    wall: '#06070f',
  });
  const fillers = instanced(
    new BoxGeometry(1, 1, 1),
    enableUvScale(new MeshBasicMaterial({ map: fillerTex })),
    GRID.fillerCount
  );

  const cosY = Math.cos(TEXT_YAW);
  const sinY = Math.sin(TEXT_YAW);
  let placed = 0;
  let guard = 0;
  while (placed < GRID.fillerCount && guard++ < GRID.fillerCount * 40) {
    const a = rand(0, Math.PI * 2);
    const rad = rand(GRID.fillerRadius[0], GRID.fillerRadius[1]);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;

    // on garde l'esplanade de l'immeuble-séquenceur dégagée
    const wx = x * cosY + z * sinY;
    const wz = -x * sinY + z * cosY;
    if (Math.hypot(wx - 0, wz - 318) < 105) continue;

    const h = rand(GRID.fillerH[0], GRID.fillerH[1]) * (rad > 320 ? 1.25 : 1);
    const fw = rand(GRID.fillerFoot[0], GRID.fillerFoot[1]);
    const fd = rand(GRID.fillerFoot[0], GRID.fillerFoot[1]);

    dummy.position.set(x, h / 2, z);
    dummy.rotation.set(0, Math.random() < 0.75 ? 0 : rand(-0.4, 0.4), 0);
    dummy.scale.set(fw, h, fd);
    dummy.updateMatrix();
    fillers.setMatrixAt(placed, dummy.matrix);
    fillers.userData.uvScale.setXY(placed, Math.max(1, Math.round(fw / 7)), Math.max(1, Math.round(h / 8)));
    fillers.setColorAt(placed, color.setHSL(rand(0.03, 0.14), rand(0.15, 0.45), rand(0.22, 0.5)));
    placed++;
  }
  fillers.count = placed;
  root.add(fillers);

  // ------------------------------------------------------ néons de rue (halo)
  const streetGlow = new InstancedMesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.5,
      side: DoubleSide,
    }),
    90
  );
  streetGlow.frustumCulled = false;
  for (let i = 0; i < 90; i++) {
    const a = rand(0, Math.PI * 2);
    const rad = rand(60, 430);
    dummy.position.set(Math.cos(a) * rad, rand(2, 26), Math.sin(a) * rad);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    const s = rand(28, 90);
    dummy.scale.set(s, s, 1);
    dummy.updateMatrix();
    streetGlow.setMatrixAt(i, dummy.matrix);
    streetGlow.setColorAt(i, color.setHSL(rand(0, 1) < 0.5 ? rand(0.03, 0.1) : rand(0.5, 0.92), 0.9, rand(0.2, 0.4)));
  }
  root.add(streetGlow);

  // -------------------------------------------------------- circulation aérienne
  const TRAFFIC = 130;
  const lanes = [];
  const tPos = new Float32Array(TRAFFIC * 3);
  const tCol = new Float32Array(TRAFFIC * 3);
  for (let i = 0; i < TRAFFIC; i++) {
    const dir = Math.random() < 0.5 ? 0 : 1;
    const alt = [34, 58, 88, 120][(Math.random() * 4) | 0] + rand(-6, 6);
    const off = rand(-520, 520);
    const speed = rand(26, 70) * (Math.random() < 0.5 ? -1 : 1);
    lanes.push({ dir, alt, off, speed, t: rand(-540, 540) });
    const c = Math.random() < 0.55 ? new Color(0xffb35c) : new Color(0xbfe9ff);
    tCol[i * 3] = c.r; tCol[i * 3 + 1] = c.g; tCol[i * 3 + 2] = c.b;
  }
  const trafficGeo = new BufferGeometry();
  trafficGeo.setAttribute('position', new BufferAttribute(tPos, 3));
  trafficGeo.setAttribute('color', new BufferAttribute(tCol, 3));
  const traffic = new Points(
    trafficGeo,
    new PointsMaterial({
      map: glowTex,
      size: 7,
      sizeAttenuation: true,
      transparent: true,
      vertexColors: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  );
  traffic.frustumCulled = false;
  root.add(traffic);

  // ---------------------------------------------------------- projecteur qui balaie
  const beamHost = towerTops.length
    ? towerTops[(Math.random() * towerTops.length) | 0]
    : { x: 0, y: 90, z: 0 };
  const beam = new Mesh(
    new ConeGeometry(58, 300, 24, 1, true),
    new MeshBasicMaterial({
      color: 0x9fd8ff,
      transparent: true,
      opacity: 0.035,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      fog: false,
    })
  );
  beam.position.set(beamHost.x, beamHost.y + 120, beamHost.z);
  root.add(beam);

  // ------------------------------------------------------------------- état
  const capBase = capColors;
  let currentLock = -1;
  let altitude = 0; // 0 = niveau de la rue, 1 = zénith

  /**
   * Pilote l'intensité des néons du nom en fonction de la proximité de la
   * bonne caméra. C'est le seul retour visuel "chaud/froid" du niveau 1.
   *
   * @param {number} lock 0 = perdu, 1 = angle exact
   * @param {number} [flare] surbrillance ponctuelle lors de la révélation
   */
  function setLock(lock, flare = 0) {
    const key = Math.round(lock * 400) + Math.round(flare * 400) * 1000;
    if (key === currentLock) return;
    currentLock = key;

    const eased = Math.pow(Math.max(0, Math.min(1, lock)), 1.7);
    // Vues de la rue, les couronnes ne sont qu'un indice ; c'est en montant
    // qu'elles prennent toute leur intensité.
    const reach = 0.4 + 0.6 * altitude;
    const gain = (0.18 + eased * 1.1) * reach + flare * 2.3;

    for (let i = 0; i < capBase.length; i++) {
      const c = capBase[i];
      caps.setColorAt(i, color.setRGB(c.r * gain, c.g * gain, c.b * gain));
    }
    caps.instanceColor.needsUpdate = true;

    halos.material.opacity = 0.07 + eased * 0.34 + flare * 0.5;
    beam.material.opacity = (0.035 + eased * 0.02) * (1 - altitude);
  }

  /**
   * Le projecteur n'a de sens que vu de la rue : à la verticale, sa nappe
   * volumétrique masquerait le nom.
   */
  function setAltitude(u) {
    altitude = Math.max(0, Math.min(1, u));
    beam.visible = altitude < 0.97;
    currentLock = -1; // force la reprise de l'opacité au prochain setLock
  }

  function update(dt, elapsed) {
    // circulation
    const pos = traffic.geometry.attributes.position;
    for (let i = 0; i < TRAFFIC; i++) {
      const lane = lanes[i];
      lane.t += lane.speed * dt;
      if (lane.t > 560) lane.t = -560;
      if (lane.t < -560) lane.t = 560;
      if (lane.dir === 0) pos.setXYZ(i, lane.t, lane.alt, lane.off);
      else pos.setXYZ(i, lane.off, lane.alt, lane.t);
    }
    pos.needsUpdate = true;

    beam.rotation.z = Math.sin(elapsed * 0.19) * 0.5;
    beam.rotation.x = Math.PI + Math.cos(elapsed * 0.13) * 0.32;
  }

  setLock(0);

  for (const mesh of [towers, caps, halos, podiums, fillers, streetGlow]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (mesh.userData.uvScale) mesh.userData.uvScale.needsUpdate = true;
  }

  return {
    root,
    props,
    sky,
    towers,
    caps,
    halos,
    fieldRadius: Math.hypot(fieldW, fieldD) / 2,
    fieldSize: { w: fieldW, d: fieldD },
    letterCount: letterSlots.length,
    setLock,
    setAltitude,
    update,
  };
}
