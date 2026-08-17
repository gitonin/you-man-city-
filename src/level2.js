import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';

import { AERIAL, DEMO_PATTERN, PADS, PAD_STEPS, SEED_PATTERN, TRACKS } from './config.js';
import { deriveGroove } from './groove.js';
import { makeFacadeTexture, makeGlowTexture } from './textures.js';

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Niveau 2 — « Les toits ».
 *
 * Survol oblique du quartier. Au fond, le mot « YOU MAN » : ses colonnes
 * s'allument l'une après l'autre et *sont* la boucle rythmique (voir
 * `groove.js`). Devant, une dalle de 8 × 8 immeubles bas dont les toits sont
 * les pads du joueur : 8 pistes mélodiques, 8 pas, une note par toit.
 *
 * Tout vit dans le repère tourné de la ville, si bien que le mot reste lisible
 * et que la caméra n'a qu'à regarder droit devant elle.
 */
export function createLevel2({ city, camera, canvas, audio, hud }) {
  const { cols, rows, cell } = PADS;
  const dummy = new Object3D();
  const color = new Color();

  const group = new Group();
  group.position.set(0, 0, city.padZone.centerZ);
  city.root.add(group);

  const padX = (col) => (col - (cols - 1) / 2) * cell;
  const padZ = (row) => ((rows - 1) / 2 - row) * cell; // rangée 0 au fond

  // ------------------------------------------------------- immeubles-pads
  const bodyTex = makeFacadeTexture({
    cols: 4,
    rows: 4,
    lit: 0.3,
    tints: ['#9fc4ff', '#ffcf95', '#e8f1ff'],
    wall: '#080a14',
  });

  const count = cols * rows;
  const bodies = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({ map: bodyTex }),
    count
  );
  bodies.frustumCulled = false;

  // Le toit : c'est lui qu'on touche et lui qui s'allume.
  const roofs = new InstancedMesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ toneMapped: false, fog: false }),
    count
  );
  roofs.frustumCulled = false;

  const glowTex = makeGlowTexture(160, 2.4);
  const roofGlow = new InstancedMesh(
    new PlaneGeometry(cell * 2.3, cell * 2.3),
    new MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      opacity: 0.9,
    }),
    count
  );
  roofGlow.frustumCulled = false;
  roofGlow.renderOrder = 4;

  const hues = new Float32Array(count);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      // les rangées proches sont un peu plus hautes : la dalle « monte » vers
      // le spectateur et se lit mieux en oblique
      const h = rand(PADS.height[0], PADS.height[1]) * (0.7 + (r / (rows - 1)) * 0.6);
      const foot = PADS.foot * rand(0.94, 1);
      hues[i] = TRACKS[r].hue;

      dummy.rotation.set(0, 0, 0);
      dummy.position.set(padX(c), h / 2, padZ(r));
      dummy.scale.set(foot, h, foot);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, color.setHSL(0.6, 0.18, 0.5));

      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.position.set(padX(c), h + 0.35, padZ(r));
      dummy.scale.set(foot * 0.94, foot * 0.94, 1);
      dummy.updateMatrix();
      roofs.setMatrixAt(i, dummy.matrix);
      roofs.setColorAt(i, color.setRGB(0.02, 0.03, 0.05));

      dummy.position.set(padX(c), h + 1.4, padZ(r));
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      roofGlow.setMatrixAt(i, dummy.matrix);
      roofGlow.setColorAt(i, color.setRGB(0, 0, 0));
    }
  }
  group.add(bodies, roofGlow, roofs);

  // ------------------------------------------------------- tête de lecture
  const playhead = new Mesh(
    new PlaneGeometry(cell * 1.02, rows * cell + cell),
    new MeshBasicMaterial({
      color: 0x9ff0ff,
      transparent: true,
      opacity: 0.14,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
  );
  playhead.rotation.x = -Math.PI / 2;
  playhead.position.set(padX(0), 0.9, 0);
  group.add(playhead);

  // Réglette de couleurs des 8 pistes, posée au sol le long de la dalle.
  const rail = new InstancedMesh(
    new PlaneGeometry(cell * 0.34, cell * 0.7),
    new MeshBasicMaterial({
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      opacity: 0.85,
    }),
    rows
  );
  rail.frustumCulled = false;
  for (let r = 0; r < rows; r++) {
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.position.set(padX(0) - cell * 0.85, 0.8, padZ(r));
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    rail.setMatrixAt(r, dummy.matrix);
    rail.setColorAt(r, color.setHSL(TRACKS[r].hue, 0.9, 0.55));
  }
  group.add(rail);

  for (const mesh of [bodies, roofs, roofGlow, rail]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ état
  const pattern = Array.from({ length: rows }, () => new Array(PAD_STEPS).fill(0));
  const groove = deriveGroove(city.text.cells, city.text.bands);
  const flash = new Float32Array(count);
  let active = false;
  let dirty = true;

  function paint() {
    for (let i = 0; i < count; i++) {
      const r = (i / cols) | 0;
      const c = i % cols;
      const on = pattern[r][c];
      const f = flash[i];
      const gain = (on ? 0.95 : 0.05) + f * 2.8;

      color.setHSL(hues[i], on || f > 0.02 ? 0.95 : 0.4, 0.55).multiplyScalar(gain);
      roofs.setColorAt(i, color);

      const halo = (on ? 0.22 : 0) + f * 1.3;
      color.setHSL(hues[i], 1, 0.55).multiplyScalar(halo);
      roofGlow.setColorAt(i, color);
    }
    roofs.instanceColor.needsUpdate = true;
    roofGlow.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------ saisie (tap only)
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  let press = null;

  function pickPad(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    // on vise les toits, mais on tolère un doigt qui accroche la façade
    const hits = raycaster.intersectObjects([roofs, bodies], false);
    if (!hits.length) return -1;
    return hits[0].instanceId ?? -1;
  }

  function onDown(e) {
    if (!active) return;
    press = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  }

  function onMove(e) {
    if (!active || !press || press.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 14) press = null;
  }

  function onUp(e) {
    if (!active || !press || press.id !== e.pointerId) { press = null; return; }
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    const held = performance.now() - press.t;
    press = null;
    if (moved > 14 || held > 600) return;

    const i = pickPad(e.clientX, e.clientY);
    if (i < 0) return;
    const r = (i / cols) | 0;
    const c = i % cols;
    pattern[r][c] = pattern[r][c] ? 0 : 1;
    if (pattern[r][c]) {
      flash[i] = 1;
      audio.playPad(r, undefined, 0.9);
    }
    dirty = true;
    paint();
    hud.hint.classList.remove('show');
  }

  canvas.addEventListener('pointerdown', onDown, { passive: true });
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerup', onUp, { passive: true });
  canvas.addEventListener('pointercancel', () => { press = null; }, { passive: true });

  // ---------------------------------------------------------------- caméra

  const localPos = new Vector3();
  const localTarget = new Vector3();

  /**
   * Pose de survol, exprimée dans le repère tourné de la ville puis ramenée
   * en coordonnées monde. `sway` fait respirer le cadrage sans fausser la
   * visée : le lancer de rayon utilise la caméra réelle.
   */
  function framing(aspect, sway = 0) {
    const az = Math.sin(sway) * AERIAL.swayAzimuth;
    const el = AERIAL.elevation + Math.cos(sway * 0.7) * AERIAL.swayElevation;

    // recul minimal pour que le mot tienne dans la largeur
    const vFov = (camera.fov * Math.PI) / 180;
    const halfW = city.fieldSize.w / 2;
    const need = (halfW * 1.1) / (Math.tan(vFov / 2) * Math.max(aspect, 0.2));
    const dist = Math.max(AERIAL.distance, need);

    localTarget.set(0, AERIAL.pivotY, AERIAL.pivotZ);
    localPos.set(
      localTarget.x + dist * Math.cos(el) * Math.sin(az),
      localTarget.y + dist * Math.sin(el),
      localTarget.z + dist * Math.cos(el) * Math.cos(az)
    );

    return {
      position: city.root.localToWorld(localPos.clone()),
      target: city.root.localToWorld(localTarget.clone()),
    };
  }

  function applyCamera(aspect, sway) {
    const f = framing(aspect, sway);
    camera.up.set(0, 1, 0);
    camera.position.copy(f.position);
    camera.lookAt(f.target);
  }

  // ---------------------------------------------------------------- boucle
  let sway = 0;

  function update(dt, aspect) {
    sway += dt * ((Math.PI * 2) / AERIAL.swayPeriod);

    for (let i = 0; i < count; i++) {
      if (flash[i] > 0.001) {
        flash[i] = Math.max(0, flash[i] - dt * 3.6);
        dirty = true;
      }
    }
    if (dirty) {
      paint();
      dirty = false;
    }

    playhead.material.opacity = Math.max(0.06, playhead.material.opacity - dt * 0.5);

    if (active) applyCamera(aspect, sway);
  }

  /**
   * Un pas de la mesure : le mot avance d'une colonne, les pads d'un huitième.
   * @param {number} step 0..15
   */
  function onStep(step) {
    const g = groove[step];
    city.pulseColumn(step, g && (g.kick || g.bass) ? 1 : 0.55);

    const padStep = step % PAD_STEPS;
    playhead.position.x = padX(padStep);
    playhead.material.opacity = 0.32;
    for (let r = 0; r < rows; r++) {
      if (pattern[r][padStep]) flash[r * cols + padStep] = 1;
    }
    dirty = true;
  }

  paint();

  return {
    group,
    pattern,
    groove,
    framing,
    applyCamera,
    update,
    onStep,
    get sway() { return sway; },
    setActive(v) {
      active = v;
      if (!v) city.stopSweep();
    },
    clear() {
      for (let r = 0; r < rows; r++) pattern[r].fill(0);
      dirty = true;
      paint();
    },
    load(source) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < PAD_STEPS; c++) pattern[r][c] = source[r]?.[c] ? 1 : 0;
      }
      dirty = true;
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
