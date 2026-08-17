import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  FogExp2,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { AERIAL, BPM, CAM, PADS, PALETTE } from './config.js';
import { buildCity } from './city.js';
import { setTextureAnisotropy } from './textures.js';
import { createAudio } from './audio.js';
import { createLevel1 } from './level1.js';
import { createLevel2 } from './level2.js';

const $ = (id) => document.getElementById(id);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const dom = {
  frame: $('frame'),
  canvas: $('scene'),
  rain: $('rain'),
  flash: $('flash'),
  intro: $('intro'),
  loadbar: $('loadbar').firstElementChild,
  btnStart: $('btn-start'),
  hud1: $('hud1'),
  hint: $('hint'),
  meter: $('meter'),
  meterFill: $('meter-fill'),
  meterVal: $('meter-val'),
  btnGyro: $('btn-gyro'),
  reveal: $('reveal'),
  btnLevel2: $('btn-level2'),
  hud2: $('hud2'),
  hint2: $('hint2'),
  btnBack: $('btn-back'),
  btnPlay: $('btn-play'),
  playGlyph: $('play-glyph'),
  playLabel: $('play-label'),
  btnWord: $('btn-word'),
  btnDemo: $('btn-demo'),
  btnClear: $('btn-clear'),
  bpmVal: $('bpm-val'),
  bpmUp: $('bpm-up'),
  bpmDown: $('bpm-down'),
  freebar: $('freebar'),
  btnResume: $('btn-resume'),
  rotate: $('rotate'),
  fail: $('fail'),
};

// ---------------------------------------------------------------- rendu

let renderer;
try {
  renderer = new WebGLRenderer({
    canvas: dom.canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
} catch (err) {
  dom.fail.hidden = false;
  dom.intro.hidden = true;
  throw err;
}

renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.setClearColor(PALETTE.ink, 1);

const quality = {
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  bloom: true,
  degraded: false,
};

const scene = new Scene();
scene.background = new Color(PALETTE.ink);
scene.fog = new FogExp2(PALETTE.fog, 0.0016);

const camera = new PerspectiveCamera(CAM.fov, 9 / 16, 1, 3000);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloom = new UnrealBloomPass(new Vector2(540, 960), 0.6, 0.62, 0.85);
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(outputPass);

function resize() {
  const w = dom.frame.clientWidth || 1;
  const h = dom.frame.clientHeight || 1;
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(quality.pixelRatio);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const landscape = window.innerWidth > window.innerHeight && window.innerHeight < 480;
  dom.rotate.hidden = !landscape;
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

// ---------------------------------------------------------------- contenu

dom.loadbar.style.width = '18%';

setTextureAnisotropy(renderer.capabilities.getMaxAnisotropy());
const city = buildCity(scene);
dom.loadbar.style.width = '62%';

const audio = createAudio();

const level1 = createLevel1({
  camera,
  city,
  canvas: dom.canvas,
  audio,
  hud: {
    hint: dom.hint,
    meter: dom.meter,
    meterFill: dom.meterFill,
    meterVal: dom.meterVal,
    rain: dom.rain,
  },
});

const level2 = createLevel2({
  city,
  camera,
  canvas: dom.canvas,
  audio,
  hud: { hint: dom.hint2 },
});

resize();
dom.loadbar.style.width = '100%';

// ------------------------------------------------------------ machine d'état

/** 'intro' | 'puzzle' | 'reveal' | 'flight' | 'sequencer' | 'free' */
let phase = 'intro';
let wordFocus = 0;
let flare = 0;
let bloomBoost = 0;
let flight = null;
let goingToSequencer = false;

const clock = new Clock();
const tmpVec = new Vector3();
const dummyCam = new Object3D();
dummyCam.up.set(0, 1, 0);

function flashScreen(peak = 0.9, ms = 900) {
  dom.flash.style.transition = 'none';
  dom.flash.style.opacity = String(peak);
  requestAnimationFrame(() => {
    dom.flash.style.transition = `opacity ${ms}ms cubic-bezier(.2,.7,.3,1)`;
    dom.flash.style.opacity = '0';
  });
}

/** Trajectoire de caméra en arc entre deux poses. */
function startFlight(toPosition, toQuaternion, duration, onDone) {
  const from = camera.position.clone();
  const fromQ = camera.quaternion.clone();
  const mid = from.clone().add(toPosition).multiplyScalar(0.5);
  mid.y = Math.max(from.y, toPosition.y) * 0.86;
  mid.x += (toPosition.x - from.x) * 0.12;
  flight = {
    t: 0,
    dur: duration,
    from,
    fromQ,
    to: toPosition.clone(),
    toQ: toQuaternion.clone(),
    ctrl: mid,
    onDone,
  };
}

function stepFlight(dt) {
  flight.t = Math.min(1, flight.t + dt / flight.dur);
  const t = flight.t;
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
  const inv = 1 - e;

  tmpVec
    .copy(flight.from).multiplyScalar(inv * inv)
    .addScaledVector(flight.ctrl, 2 * inv * e)
    .addScaledVector(flight.to, e * e);
  camera.position.copy(tmpVec);
  camera.quaternion.copy(flight.fromQ).slerp(flight.toQ, e);

  if (t >= 1) {
    const done = flight.onDone;
    flight = null;
    done && done();
  }
}

// ------------------------------------------------------------------ niveau 1

level1.onSolved = () => {
  phase = 'reveal';
  level1.state.inputEnabled = false;
  flare = 1;
  bloomBoost = 1;
  audio.impact();
  flashScreen(0.85, 1100);

  setTimeout(() => {
    dom.hud1.hidden = true;
    dom.reveal.hidden = false;
  }, 1500);
};

dom.btnGyro.addEventListener('click', async () => {
  const on = await level1.toggleGyro();
  dom.btnGyro.setAttribute('aria-pressed', String(on));
});

// Le bouton gyro n'apparaît que si l'appareil a des capteurs.
if (window.DeviceOrientationEvent && matchMedia('(pointer: coarse)').matches) {
  dom.btnGyro.hidden = false;
  dom.btnGyro.setAttribute('aria-pressed', 'false');
}

// ------------------------------------------------------------------ niveau 2

let bpm = BPM.start;

function syncBpm() {
  dom.bpmVal.textContent = String(bpm);
  audio.sequencer.setBpm(bpm);
}

function setPlaying(on) {
  if (on) audio.sequencer.start({ pattern: level2.pattern, groove: level2.groove });
  else audio.sequencer.stop();
  dom.btnPlay.setAttribute('aria-pressed', String(on));
  dom.playGlyph.textContent = on ? '\u275a\u275a' : '\u25b6';
  dom.playLabel.textContent = on ? 'lecture' : 'pause';
}

function setGroove(on) {
  audio.sequencer.setGrooveEnabled(on);
  dom.btnWord.setAttribute('aria-pressed', String(on));
  if (!on) city.stopSweep();
}

/** Pose visée par le survol du niveau 2, en quaternion monde. */
function aerialPose() {
  const f = level2.framing(camera.aspect, level2.sway);
  dummyCam.position.copy(f.position);
  dummyCam.lookAt(f.target);
  return { position: f.position.clone(), quaternion: dummyCam.quaternion.clone() };
}

function enterSequencer(firstTime) {
  phase = 'flight';
  goingToSequencer = true;
  dom.reveal.hidden = true;
  dom.freebar.hidden = true;
  level1.state.inputEnabled = false;
  level2.setActive(false);

  const pose = aerialPose();
  startFlight(pose.position, pose.quaternion, firstTime ? 3.4 : 2.2, () => {
    phase = 'sequencer';
    level2.setActive(true);
    dom.hud2.hidden = false;
    if (firstTime) {
      level2.loadSeed();
      syncBpm();
      setGroove(true);
      setPlaying(true);
      dom.hint2.textContent = 'le mot tient le rythme — touchez les toits pour la mélodie';
      dom.hint2.classList.add('show');
      setTimeout(() => dom.hint2.classList.remove('show'), 6000);
    }
  });

  // Le drone du niveau 1 disparaît : place au morceau.
  audio.silenceDrone();
  dom.rain.style.opacity = '0.08';
}

function enterFreeFlight() {
  phase = 'flight';
  goingToSequencer = false;
  dom.hud2.hidden = true;
  level2.setActive(false);
  level1.enterFreeMode();
  level1.state.inputEnabled = false;

  // pose visée : celle que produit le survol libre
  level1.applyCamera();
  const toPos = camera.position.clone();
  const toQ = camera.quaternion.clone();

  // on repart de la pose de survol du séquenceur
  const pose = aerialPose();
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);

  startFlight(toPos, toQ, 2.4, () => {
    phase = 'free';
    level1.state.inputEnabled = true;
    dom.freebar.hidden = false;
  });

  audio.restoreDrone();
}

dom.btnLevel2.addEventListener('click', () => enterSequencer(true));
dom.btnBack.addEventListener('click', enterFreeFlight);
dom.btnResume.addEventListener('click', () => enterSequencer(false));

dom.btnPlay.addEventListener('click', () => setPlaying(!audio.sequencer.playing));
dom.btnClear.addEventListener('click', () => {
  level2.clear();
  audio.sequencer.setPattern(level2.pattern);
});
dom.btnWord.addEventListener('click', () => setGroove(!audio.sequencer.grooveOn));
dom.btnDemo.addEventListener('click', () => {
  level2.loadDemo();
  audio.sequencer.setPattern(level2.pattern);
  if (!audio.sequencer.playing) setPlaying(true);
});
dom.bpmUp.addEventListener('click', () => { bpm = clamp(bpm + BPM.step, BPM.min, BPM.max); syncBpm(); });
dom.bpmDown.addEventListener('click', () => { bpm = clamp(bpm - BPM.step, BPM.min, BPM.max); syncBpm(); });

// ------------------------------------------------------------------- départ

async function start() {
  dom.btnStart.disabled = true;
  await audio.unlock();
  dom.intro.hidden = true;
  dom.hud1.hidden = false;
  phase = 'puzzle';
  clock.getDelta(); // évite un premier dt géant
}

dom.btnStart.addEventListener('click', start);
dom.intro.addEventListener('click', (e) => {
  if (e.target === dom.btnStart) return;
  start();
});

// --------------------------------------------------------- boucle de rendu

let fpsAcc = 0;
let fpsFrames = 0;

function watchPerformance(dt) {
  if (quality.degraded) return;
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc < 2.5) return;
  const fps = fpsFrames / fpsAcc;
  fpsAcc = 0;
  fpsFrames = 0;
  if (fps > 42) return;

  quality.degraded = true;
  if (quality.pixelRatio > 1) {
    quality.pixelRatio = 1;
    resize();
  }
  if (fps < 28) {
    quality.bloom = false;
    bloom.enabled = false;
  } else {
    bloom.strength = 0.55;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  city.update(dt, elapsed);

  if (flight) {
    stepFlight(dt);
  } else if (phase === 'puzzle' || phase === 'reveal' || phase === 'free') {
    level1.update(dt);
  }

  // Le brouillard se lève avec l'altitude : lisibilité au zénith.
  if (phase !== 'sequencer' && phase !== 'flight') {
    const u = (level1.state.elev - CAM.elevRange[0]) / (CAM.elevRange[1] - CAM.elevRange[0]);
    scene.fog.density = lerp(0.0021, 0.00042, u);
    city.setAltitude(u);
  } else {
    scene.fog.density += (0.0009 - scene.fog.density) * Math.min(1, dt * 2);
  }

  if (phase === 'sequencer' || phase === 'flight') {
    audio.drainSteps((step) => level2.onStep(step));
    city.setAltitude(1);
  }
  level2.update(dt, camera.aspect);

  // En survol, on efface le bâti pour que le nom reste lisible.
  const focusTarget = phase === 'sequencer' || (phase === 'flight' && goingToSequencer) ? 1 : 0;
  wordFocus += (focusTarget - wordFocus) * Math.min(1, dt * 1.6);
  city.setWordFocus(wordFocus);

  if (flare > 0) {
    flare = Math.max(0, flare - dt * 0.6);
    city.setLock(1, flare);
  }
  if (bloomBoost > 0) bloomBoost = Math.max(0, bloomBoost - dt * 0.7);

  if (bloom.enabled) {
    const base = phase === 'sequencer' ? 0.7 : 0.42 + level1.proximity * 0.28;
    bloom.strength = (quality.degraded ? 0.65 : 1) * (base + bloomBoost * 0.8);
  }

  watchPerformance(dt);
  composer.render();
}

// Petite fenêtre de debug : utile pour régler l'énigme sans recharger.
window.YOUMAN = {
  get phase() { return phase; },
  config: { AERIAL, PADS },
  level1,
  level2,
  city,
  audio,
  camera,
  quality,
};

animate();
