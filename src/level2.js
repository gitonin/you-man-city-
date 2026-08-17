import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  Vector2,
} from 'three';

import { DEMO_PATTERN, HERO, SEED_PATTERN, TRACKS } from './config.js';
import { makeFacadeTexture, makeGlowTexture, makeWindowPaneTexture } from './textures.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Bandeau des noms de pistes, peint au canvas. */
function makeLabelTexture(rows) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128 * rows;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '600 40px "Helvetica Neue", Helvetica, Arial, sans-serif';
  for (let r = 0; r < rows; r++) {
    const track = TRACKS[r];
    ctx.fillStyle = `hsl(${Math.round(track.hue * 360)}, 100%, 74%)`;
    ctx.fillText(track.name, c.width - 16, r * 128 + 64);
  }
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}

/**
 * Niveau 2 — « Les fenêtres ».
 *
 * Un immeuble de la cité sert de séquenceur : 8 pistes (les étages), 8 pas
 * (les travées). Allumer une fenêtre, c'est poser une note.
 */
export function createLevel2({ scene, camera, canvas, audio, hud }) {
  const { cols, rows, cellSize } = HERO;
  const dummy = new Object3D();
  const color = new Color();

  // ------------------------------------------------------------- immeuble
  const group = new Group();
  group.position.set(...HERO.position);
  scene.add(group);

  const facadeTex = makeFacadeTexture({
    cols: 7,
    rows: 14,
    lit: 0.3,
    tints: ['#bcdcff', '#ffcf95', '#ffffff'],
    wall: '#0d1120',
  });
  facadeTex.repeat.set(3, 5);

  const body = new Mesh(
    new BoxGeometry(HERO.width, HERO.height, HERO.depth),
    new MeshBasicMaterial({ map: facadeTex, color: 0xdfe9ff })
  );
  body.position.y = HERO.height / 2;
  group.add(body);

  const crown = new Mesh(
    new BoxGeometry(HERO.width + 2.6, 2.2, HERO.depth + 2.6),
    new MeshBasicMaterial({ color: 0x25e6ff, toneMapped: false, fog: false })
  );
  crown.position.y = HERO.height + 1.1;
  group.add(crown);

  const glowTex = makeGlowTexture(160, 2.4);
  const crownHalo = new Mesh(
    new PlaneGeometry(HERO.width * 3, HERO.width * 3),
    new MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      opacity: 0.3,
    })
  );
  crownHalo.rotation.x = -Math.PI / 2;
  crownHalo.position.y = HERO.height + 4;
  group.add(crownHalo);

  // --------------------------------------------------------------- grille
  const frontZ = HERO.depth / 2;
  const count = cols * rows;

  const cellX = (col) => (col - (cols - 1) / 2) * cellSize;
  const cellY = (row) => HERO.gridCenterY + ((rows - 1) / 2 - row) * cellSize;

  // renfoncement sombre derrière chaque fenêtre
  const wells = new InstancedMesh(
    new PlaneGeometry(cellSize * 0.9, cellSize * 0.9),
    new MeshBasicMaterial({ color: 0x0a1020, fog: false }),
    count
  );
  wells.frustumCulled = false;

  const paneTex = makeWindowPaneTexture();
  const panes = new InstancedMesh(
    new PlaneGeometry(cellSize * 0.82, cellSize * 0.82),
    new MeshBasicMaterial({
      map: paneTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
    count
  );
  panes.frustumCulled = false;

  const bloomHalos = new InstancedMesh(
    new PlaneGeometry(cellSize * 2.5, cellSize * 2.5),
    new MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      opacity: 0.85,
    }),
    count
  );
  bloomHalos.frustumCulled = false;

  const hues = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = cellX(c);
      const y = cellY(r);

      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);

      dummy.position.set(x, y, frontZ + 0.35);
      dummy.updateMatrix();
      wells.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, y, frontZ + 0.55);
      dummy.updateMatrix();
      panes.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, y, frontZ + 0.25);
      dummy.updateMatrix();
      bloomHalos.setMatrixAt(i, dummy.matrix);

      hues.push(TRACKS[r].hue);
      panes.setColorAt(i, color.setRGB(0.02, 0.03, 0.05));
      bloomHalos.setColorAt(i, color.setRGB(0, 0, 0));
    }
  }
  group.add(wells, bloomHalos, panes);

  // tête de lecture
  const playhead = new Mesh(
    new PlaneGeometry(cellSize * 1.1, rows * cellSize * 1.08),
    new MeshBasicMaterial({
      color: 0x8fe8ff,
      transparent: true,
      opacity: 0.17,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
  );
  playhead.position.set(cellX(0), HERO.gridCenterY, frontZ + 0.15);
  group.add(playhead);

  // étiquettes des pistes
  const labels = new Mesh(
    new PlaneGeometry(cellSize * 1.6, rows * cellSize),
    new MeshBasicMaterial({
      map: makeLabelTexture(rows),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      opacity: 0.75,
    })
  );
  labels.position.set(cellX(0) - cellSize * 1.3, HERO.gridCenterY, frontZ + 0.4);
  group.add(labels);
  const labelLeftEdge = labels.position.x - cellSize * 0.8;

  // ------------------------------------------------------------------ état
  const pattern = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const flash = new Float32Array(count); // surbrillance transitoire
  let currentStep = -1;
  let active = false;
  let kickPulse = 0;

  function paint() {
    for (let i = 0; i < count; i++) {
      const r = (i / cols) | 0;
      const c = i % cols;
      const on = pattern[r][c];
      const f = flash[i];
      const base = on ? 1.15 : 0.06;
      const gain = base + f * 3.2;

      color.setHSL(hues[i], on || f > 0.02 ? 0.95 : 0.5, 0.55).multiplyScalar(gain);
      panes.setColorAt(i, color);

      const halo = on ? 0.28 + f * 1.6 : f * 1.1;
      color.setHSL(hues[i], 1, 0.55).multiplyScalar(halo);
      bloomHalos.setColorAt(i, color);
    }
    panes.instanceColor.needsUpdate = true;
    bloomHalos.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------ saisie (tap only)
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  let press = null;
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

  function pickCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(wells, false);
    if (!hits.length) return -1;
    return hits[0].instanceId ?? -1;
  }

  function onDown(e) {
    if (!active) return;
    press = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  }

  function onMove(e) {
    if (!active) return;
    const rect = canvas.getBoundingClientRect();
    // léger parallaxe : la façade respire sans gêner la visée
    parallax.tx = clamp(((e.clientX - rect.left) / rect.width - 0.5) * 7, -4, 4);
    parallax.ty = clamp(((e.clientY - rect.top) / rect.height - 0.5) * -5, -3, 3);
    if (press && press.id === e.pointerId) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) press = null;
    }
  }

  function onUp(e) {
    if (!active || !press || press.id !== e.pointerId) { press = null; return; }
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    const held = performance.now() - press.t;
    press = null;
    if (moved > 12 || held > 600) return;

    const i = pickCell(e.clientX, e.clientY);
    if (i < 0) return;
    const r = (i / cols) | 0;
    const c = i % cols;
    pattern[r][c] = pattern[r][c] ? 0 : 1;
    if (pattern[r][c]) {
      flash[i] = 1;
      audio.playTrack(r, undefined, 0.9);
    }
    paint();
    hud.hint.classList.remove('show');
  }

  canvas.addEventListener('pointerdown', onDown, { passive: true });
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerup', onUp, { passive: true });
  canvas.addEventListener('pointercancel', () => { press = null; }, { passive: true });

  // ---------------------------------------------------------------- caméra

  /**
   * Pose exacte de la caméra face à la grille, calculée pour l'aspect réel.
   * Le bandeau des noms de pistes déborde à gauche : on recentre dessus pour
   * qu'il ne soit pas rogné en 9:16.
   */
  function framing(aspect) {
    const right = (cols * cellSize) / 2;
    const left = labelLeftEdge;
    const centerX = (left + right) / 2;
    const halfW = (right - left) / 2;
    const halfH = (rows * cellSize) / 2;

    const vFov = (camera.fov * Math.PI) / 180;
    const needByWidth = (halfW * 1.14) / (Math.tan(vFov / 2) * Math.max(aspect, 0.2));
    const needByHeight = (halfH * 1.5) / Math.tan(vFov / 2);
    const dist = Math.max(needByWidth, needByHeight, 60);

    const x = HERO.position[0] + centerX;
    return {
      position: [x, HERO.gridCenterY, HERO.position[2] + frontZ + dist],
      target: [x, HERO.gridCenterY, HERO.position[2]],
    };
  }

  function applyCamera(aspect) {
    const f = framing(aspect);
    camera.up.set(0, 1, 0);
    camera.position.set(f.position[0] + parallax.x, f.position[1] + parallax.y, f.position[2]);
    camera.lookAt(f.target[0], f.target[1], f.target[2]);
  }

  // ---------------------------------------------------------------- boucle

  function update(dt, aspect) {
    parallax.x += (parallax.tx - parallax.x) * Math.min(1, dt * 3.2);
    parallax.y += (parallax.ty - parallax.y) * Math.min(1, dt * 3.2);

    let dirty = false;
    for (let i = 0; i < count; i++) {
      if (flash[i] > 0.001) {
        flash[i] = Math.max(0, flash[i] - dt * 3.4);
        dirty = true;
      }
    }
    if (dirty) paint();

    kickPulse = Math.max(0, kickPulse - dt * 2.6);
    crown.material.color.setRGB(0.14 + kickPulse * 2, 0.9 + kickPulse, 1 + kickPulse * 1.4);
    crownHalo.material.opacity = 0.28 + kickPulse * 0.7;

    if (active) applyCamera(aspect);
  }

  /** Appelé par le séquenceur quand un pas tombe. */
  function onStep(step) {
    currentStep = step;
    playhead.position.x = cellX(step);
    for (let r = 0; r < rows; r++) {
      if (pattern[r][step]) {
        flash[r * cols + step] = 1;
        if (TRACKS[r].kind === 'kick') kickPulse = 1;
      }
    }
    paint();
  }

  paint();

  return {
    group,
    pattern,
    framing,
    applyCamera,
    update,
    onStep,
    get currentStep() { return currentStep; },
    setActive(v) { active = v; },
    clear() {
      for (let r = 0; r < rows; r++) pattern[r].fill(0);
      paint();
    },
    load(source) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) pattern[r][c] = source[r]?.[c] ? 1 : 0;
      }
      paint();
    },
    loadDemo() { this.load(DEMO_PATTERN); },
    loadSeed() { this.load(SEED_PATTERN); },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    },
  };
}
