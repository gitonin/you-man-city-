import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';

import { TRACK } from './config.js';
import { bakeVertexLight, psxMaterial } from './psx.js';
import {
  makeBillboardTexture,
  makeBoostTexture,
  makeBuildingTexture,
  makeGroundTexture,
  makeRoadTexture,
  makeSkyTexture,
  makeStartTexture,
  makeTunnelTexture,
  makeWallTexture,
} from './textures.js';

const UP = new Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Le circuit est une boucle fermée échantillonnée une fois pour toutes. Tout
 * le reste — ruban de piste, murs, voûtes, décor — est extrudé le long de ces
 * échantillons, et le vaisseau s'y repère par une simple abscisse curviligne.
 *
 * Travailler en « espace piste » (distance parcourue + écart latéral) rend la
 * conduite et les collisions triviales : deux scalaires, pas de physique à
 * intégrer dans le monde.
 */

/** Tracé : un anneau déformé, assez lisible pour être mémorisé en deux tours. */
function controlPoints() {
  const R = 1080;
  const points = [];
  const COUNT = 18;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    const radius = R * (1 + 0.3 * Math.sin(a * 2) - 0.15 * Math.cos(a * 3));
    const y = 34 * Math.sin(a) + 19 * Math.sin(a * 3 + 0.7) - 11 * Math.cos(a * 2);
    points.push(new Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return points;
}

/** Sections couvertes, en fraction de tour. */
const TUNNELS = [
  [0.145, 0.265],
  [0.595, 0.715],
];
/** Plaques de survitesse, en fraction de tour. */
const BOOSTS = [0.07, 0.345, 0.5, 0.79, 0.93];

const inRange = (t, ranges) => ranges.some(([a, b]) => t >= a && t <= b);

export function buildTrack(scene) {
  const curve = new CatmullRomCurve3(controlPoints(), true, 'catmullrom', 0.5);

  // ------------------------------------------------- échantillonnage du tracé
  const N = TRACK.samples;
  const pos = new Float32Array(N * 3);
  const tan = new Float32Array(N * 3);
  const nrm = new Float32Array(N * 3); // « haut » de la piste, dévers compris
  const bin = new Float32Array(N * 3); // travers de la piste
  const dist = new Float32Array(N + 1);
  const bank = new Float32Array(N);

  const p = new Vector3();
  const t = new Vector3();
  const b = new Vector3();
  const n = new Vector3();

  for (let i = 0; i < N; i++) {
    const u = i / N;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t).normalize();
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    tan[i * 3] = t.x; tan[i * 3 + 1] = t.y; tan[i * 3 + 2] = t.z;
  }

  let total = 0;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    dist[i] = total;
    total += Math.hypot(
      pos[j * 3] - pos[i * 3],
      pos[j * 3 + 1] - pos[i * 3 + 1],
      pos[j * 3 + 2] - pos[i * 3 + 2]
    );
  }
  dist[N] = total;

  // Pas de texture ajusté pour tomber juste sur la boucle : sans ça, une
  // couture sautait aux yeux à chaque passage sur la ligne.
  const roadTile = total / Math.max(1, Math.round(total / TRACK.tileLength));
  const wallTile = total / Math.max(1, Math.round(total / 20));

  // courbure horizontale → dévers, puis lissage pour éviter les à-coups
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const cross = tan[i * 3] * tan[j * 3 + 2] - tan[i * 3 + 2] * tan[j * 3];
    const seg = Math.max(1e-4, dist[i + 1] - dist[i]);
    raw[i] = (cross / seg) * TRACK.bankStrength;
  }
  for (let pass = 0; pass < 28; pass++) {
    for (let i = 0; i < N; i++) {
      bank[i] = (raw[(i - 1 + N) % N] + raw[i] * 2 + raw[(i + 1) % N]) * 0.25;
    }
    raw.set(bank);
  }
  for (let i = 0; i < N; i++) {
    bank[i] = Math.max(-TRACK.bankMax, Math.min(TRACK.bankMax, raw[i]));
  }

  // repères locaux, dévers appliqué
  for (let i = 0; i < N; i++) {
    t.set(tan[i * 3], tan[i * 3 + 1], tan[i * 3 + 2]);
    b.crossVectors(t, UP).normalize();
    n.crossVectors(b, t).normalize();
    const cs = Math.cos(bank[i]);
    const sn = Math.sin(bank[i]);
    bin[i * 3] = b.x * cs + n.x * sn;
    bin[i * 3 + 1] = b.y * cs + n.y * sn;
    bin[i * 3 + 2] = b.z * cs + n.z * sn;
    nrm[i * 3] = n.x * cs - b.x * sn;
    nrm[i * 3 + 1] = n.y * cs - b.y * sn;
    nrm[i * 3 + 2] = n.z * cs - b.z * sn;
  }

  // ---------------------------------------------------------------- extrusion

  /**
   * Étire un profil 2D le long d'une plage d'échantillons.
   *
   * @param {Array<{lat:number, up:number, u:number}>} profile
   * @param {object} opts `vAcross` échange les axes UV ; `normalSign` retourne
   *   l'ombrage cuit (utile pour une voûte, qu'on regarde par en dessous).
   */
  function extrude(profile, {
    from = 0, to = N, vScale = 1, vAcross = false, tint = 1, normalSign = 1,
  } = {}) {
    const cols = profile.length;
    const rows = to - from + 1;
    const vertices = cols * rows;

    const positions = new Float32Array(vertices * 3);
    const uvs = new Float32Array(vertices * 2);
    const colors = new Float32Array(vertices * 3);
    const indices = [];

    // normale de chaque point du profil, orientée vers le haut par convention
    const faceNormals = profile.map((pt, k) => {
      const prev = profile[Math.max(0, k - 1)];
      const next = profile[Math.min(cols - 1, k + 1)];
      const dLat = next.lat - prev.lat;
      const dUp = next.up - prev.up;
      const len = Math.hypot(dLat, dUp) || 1;
      let lat = -dUp / len;
      let up = dLat / len;
      if (up < 0) { lat = -lat; up = -up; }
      return { lat: lat * normalSign, up: up * normalSign };
    });

    for (let r = 0; r < rows; r++) {
      const i = (from + r) % N;
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      const bx = bin[i * 3], by = bin[i * 3 + 1], bz = bin[i * 3 + 2];
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      const along = dist[from + r];

      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        const pt = profile[c];
        positions[k * 3] = px + bx * pt.lat + nx * pt.up;
        positions[k * 3 + 1] = py + by * pt.lat + ny * pt.up;
        positions[k * 3 + 2] = pz + bz * pt.lat + nz * pt.up;

        if (vAcross) {
          uvs[k * 2] = along / vScale;
          uvs[k * 2 + 1] = pt.u;
        } else {
          uvs[k * 2] = pt.u;
          uvs[k * 2 + 1] = along / vScale;
        }

        const fn = faceNormals[c];
        const [cr, cg, cb] = bakeVertexLight(
          bx * fn.lat + nx * fn.up,
          by * fn.lat + ny * fn.up,
          bz * fn.lat + nz * fn.up
        );
        colors[k * 3] = cr * tint;
        colors[k * 3 + 1] = cg * tint;
        colors[k * 3 + 2] = cb * tint;
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        // sens trigonométrique vu du dessus : sans ça la piste est culée
        indices.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('uv', new BufferAttribute(uvs, 2));
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.setIndex(indices);
    return geo;
  }

  const root = new Group();
  scene.add(root);

  const HW = TRACK.halfWidth;
  const WH = TRACK.wallHeight;

  // piste : un seul quad en travers, pour que le placage affine se voie
  const road = new Mesh(
    extrude([{ lat: -HW, up: 0, u: 0 }, { lat: HW, up: 0, u: 1 }], { vScale: roadTile }),
    psxMaterial({ map: makeRoadTexture() })
  );
  root.add(road);

  // murs
  const wallMat = psxMaterial({ map: makeWallTexture(), side: DoubleSide });
  root.add(
    new Mesh(extrude(
      [{ lat: -HW, up: 0, u: 1 }, { lat: -HW - 0.6, up: WH, u: 0 }],
      { vScale: wallTile, vAcross: true, tint: 0.95 }
    ), wallMat),
    new Mesh(extrude(
      [{ lat: HW + 0.6, up: WH, u: 0 }, { lat: HW, up: 0, u: 1 }],
      { vScale: wallTile, vAcross: true, tint: 0.95 }
    ), wallMat)
  );

  // voûtes des tunnels
  const tunnelMat = psxMaterial({ map: makeTunnelTexture(), side: DoubleSide });
  const ceiling = [
    { lat: -HW - 0.6, up: WH, u: 0 },
    { lat: -HW * 0.62, up: WH + 4.4, u: 0.33 },
    { lat: HW * 0.62, up: WH + 4.4, u: 0.67 },
    { lat: HW + 0.6, up: WH, u: 1 },
  ];
  for (const [a, z] of TUNNELS) {
    root.add(new Mesh(
      extrude(ceiling, {
        from: Math.floor(a * N),
        to: Math.floor(z * N),
        vScale: 18,
        vAcross: true,
        tint: 0.72,
        normalSign: -1,
      }),
      tunnelMat
    ));
  }

  // ------------------------------------------------------------- décalcomanies
  const decals = new Group();
  decals.renderOrder = 1;
  root.add(decals);

  const decalMat = (map) => psxMaterial({
    map, vertexColors: false, transparent: true, depthWrite: false,
  });

  /** Pose un objet dans le repère de la piste à l'échantillon `i`. */
  function place(mesh, i, lat, up, extra) {
    const bx = bin[i * 3], by = bin[i * 3 + 1], bz = bin[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const tx = tan[i * 3], ty = tan[i * 3 + 1], tz = tan[i * 3 + 2];
    const x = pos[i * 3] + bx * lat + nx * up;
    const y = pos[i * 3 + 1] + by * lat + ny * up;
    const z = pos[i * 3 + 2] + bz * lat + nz * up;
    mesh.matrixAutoUpdate = false;
    // colonnes : X = travers, Y = normale, Z = tangente
    mesh.matrix.set(
      bx, nx, tx, x,
      by, ny, ty, y,
      bz, nz, tz, z,
      0, 0, 0, 1
    );
    if (extra) mesh.matrix.multiply(extra);
    mesh.updateMatrixWorld(true);
  }

  const boostMat = decalMat(makeBoostTexture());
  const boostPads = [];
  for (const frac of BOOSTS) {
    const i = Math.floor(frac * N) % N;
    const quad = new PlaneGeometry(HW * 1.1, 36);
    quad.rotateX(-Math.PI / 2);
    const mesh = new Mesh(quad, boostMat);
    place(mesh, i, 0, 0.12);
    decals.add(mesh);
    boostPads.push({ index: i, dist: dist[i] });
  }

  const startQuad = new PlaneGeometry(HW * 2, 10);
  startQuad.rotateX(-Math.PI / 2);
  const startLine = new Mesh(startQuad, decalMat(makeStartTexture()));
  place(startLine, 0, 0, 0.14);
  decals.add(startLine);

  // panneaux publicitaires au-dessus des murs
  const faceTrack = new Matrix4().makeRotationY(Math.PI / 2);
  const billboardMat = psxMaterial({
    map: makeBillboardTexture(), vertexColors: false, side: DoubleSide,
  });
  for (let k = 0; k < 56; k++) {
    const i = (Math.floor((k / 56) * N + rand(-16, 16)) + N) % N;
    if (inRange(i / N, TUNNELS)) continue;
    const mesh = new Mesh(new PlaneGeometry(28, 9.5), billboardMat);
    place(mesh, i, (Math.random() < 0.5 ? -1 : 1) * (HW + 1.6), WH + 5, faceTrack);
    decals.add(mesh);
  }

  // ------------------------------------------------------------------- décor
  const sky = new Mesh(
    new SphereGeometry(1900, 24, 16),
    psxMaterial({
      map: makeSkyTexture(),
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

  const groundTex = makeGroundTexture();
  groundTex.repeat.set(110, 110);
  const ground = new Mesh(
    new PlaneGeometry(7000, 7000),
    psxMaterial({ map: groundTex, vertexColors: false, snap: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -80;
  root.add(ground);

  // tours du fond
  const TOWERS = 190;
  const towerGeo = new BoxGeometry(1, 1, 1);
  {
    const normals = towerGeo.attributes.normal;
    const colors = new Float32Array(normals.count * 3);
    for (let i = 0; i < normals.count; i++) {
      const [r, g, bb] = bakeVertexLight(
        normals.getX(i), normals.getY(i), normals.getZ(i), 0.28, 0.5
      );
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = bb;
    }
    towerGeo.setAttribute('color', new BufferAttribute(colors, 3));
  }
  const towers = new InstancedMesh(towerGeo, psxMaterial({ map: makeBuildingTexture() }), TOWERS);
  towers.frustumCulled = false;
  const dummy = new Object3D();
  for (let k = 0; k < TOWERS; k++) {
    const i = Math.floor(Math.random() * N);
    const lat = (Math.random() < 0.5 ? -1 : 1) * rand(50, 560);
    const h = rand(26, 220);
    dummy.position.set(
      pos[i * 3] + bin[i * 3] * lat,
      pos[i * 3 + 1] - 26 + h / 2,
      pos[i * 3 + 2] + bin[i * 3 + 2] * lat
    );
    dummy.rotation.set(0, rand(0, Math.PI), 0);
    dummy.scale.set(rand(16, 48), h, rand(16, 48));
    dummy.updateMatrix();
    towers.setMatrixAt(k, dummy.matrix);
  }
  towers.instanceMatrix.needsUpdate = true;
  root.add(towers);

  // ------------------------------------------------------------- interrogation

  const wrap = (s) => {
    const d = s % total;
    return d < 0 ? d + total : d;
  };

  /**
   * Repère de la piste à l'abscisse `s`. Les champs sont réécrits dans l'objet
   * fourni : cette fonction tourne plusieurs fois par image.
   */
  function frameAt(s, out) {
    const d = wrap(s);
    const fi = (d / total) * N;
    const i = Math.floor(fi) % N;
    const j = (i + 1) % N;
    const f = fi - Math.floor(fi);
    const lerp3 = (arr, target) => target.set(
      arr[i * 3] + (arr[j * 3] - arr[i * 3]) * f,
      arr[i * 3 + 1] + (arr[j * 3 + 1] - arr[i * 3 + 1]) * f,
      arr[i * 3 + 2] + (arr[j * 3 + 2] - arr[i * 3 + 2]) * f
    );

    lerp3(pos, out.position);
    lerp3(tan, out.tangent).normalize();
    lerp3(nrm, out.normal).normalize();
    lerp3(bin, out.binormal).normalize();
    out.bank = bank[i] + (bank[j] - bank[i]) * f;
    out.covered = inRange(d / total, TUNNELS);
    return out;
  }

  const makeFrame = () => ({
    position: new Vector3(),
    tangent: new Vector3(),
    normal: new Vector3(),
    binormal: new Vector3(),
    bank: 0,
    covered: false,
  });

  /** Une plaque de survitesse a-t-elle été franchie entre `prev` et `next` ? */
  function boostCrossed(prev, next) {
    const a = wrap(prev);
    const z = wrap(next);
    for (const pad of boostPads) {
      if (z < a ? (pad.dist >= a || pad.dist <= z) : (pad.dist >= a && pad.dist <= z)) {
        return true;
      }
    }
    return false;
  }

  return {
    root,
    curve,
    length: total,
    samples: N,
    halfWidth: HW,
    frameAt,
    makeFrame,
    boostCrossed,
    isCovered: (s) => inRange(wrap(s) / total, TUNNELS),
  };
}
