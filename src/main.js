import {
  Clock,
  Color,
  Fog,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

import { GLITCH, PALETTE, RACE, RENDER, SHIP } from './config.js';
import { setPsxGrid } from './psx.js';
import { buildTrack } from './track.js';
import { createShip } from './ship.js';
import { createControls } from './controls.js';
import { createHud } from './hud.js';
import { createPost } from './post.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

/** Facteur d'affichage de la vitesse, purement cosmétique. */
const SPEED_DISPLAY = 2.3;

const dom = {
  frame: $('frame'),
  canvas: $('view'),
  intro: $('intro'),
  btnStart: $('btn-start'),
  gyroNote: $('gyro-note'),
  outro: $('outro'),
  btnAgain: $('btn-again'),
  resTotal: $('res-total'),
  resBest: $('res-best'),
  resTop: $('res-top'),
  hudDom: $('hud-dom'),
  btnCenter: $('btn-center'),
  tilt: $('tilt'),
  rotate: $('rotate'),
  fail: $('fail'),
};

// ------------------------------------------------------------------- rendu

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
renderer.setClearColor(PALETTE.sky, 1);

const scene = new Scene();
scene.background = new Color(PALETTE.sky);
scene.fog = new Fog(PALETTE.fog, RENDER.fogNear, RENDER.fogFar);

const camera = new PerspectiveCamera(RENDER.fov, 0.52, RENDER.near, RENDER.far);
scene.add(camera);

const post = createPost(renderer);
const hud = createHud();
post.uniforms.tHud.value = hud.texture;

const track = buildTrack(scene);
const ship = createShip(track, camera);
const controls = createControls(dom.canvas);
const audio = createAudio();

// -------------------------------------------------------------- dimensions

const quality = { pixelRatio: Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio) };

function resize() {
  const w = Math.max(2, dom.frame.clientWidth);
  const h = Math.max(2, dom.frame.clientHeight);
  const aspect = w / h;

  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(w, h, false);

  const innerH = Math.min(RENDER.internalHeight, Math.round(h * quality.pixelRatio));
  const innerW = Math.max(64, Math.round(innerH * aspect));

  post.resize(w * quality.pixelRatio, h * quality.pixelRatio, innerW, innerH);
  hud.resize(innerW, innerH);
  setPsxGrid(innerW / RENDER.vertexJitter, innerH / RENDER.vertexJitter);

  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  ship.buildCockpit(aspect, RENDER.fov);

  dom.rotate.hidden = !(window.innerWidth > window.innerHeight && window.innerHeight < 480);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 220));

// ---------------------------------------------------------- machine d'états

/** 'intro' | 'countdown' | 'racing' | 'finish' */
let phase = 'intro';
let countdown = RACE.countdown;
let lastBeep = -1;
let topSpeed = 0;
let fade = 0;

/** Forcé depuis la console pour régler l'image. */
let glitchOverride = null;

/** Corruption de l'image : fond, chocs, et rafales aléatoires. */
const glitch = { hit: 0, burst: 0, burstTime: 0, nextRoll: 0 };

const clock = new Clock();
let hudTick = 0;

function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

async function startRace() {
  dom.btnStart.disabled = true;

  const gotGyro = await controls.enableGyro();
  dom.gyroNote.textContent = gotGyro
    ? 'gyroscope actif · inclinez pour tourner'
    : 'pas de gyroscope · glissez le doigt pour tourner';

  await audio.start();

  ship.reset();
  topSpeed = 0;
  countdown = RACE.countdown;
  lastBeep = -1;
  phase = 'countdown';

  dom.intro.hidden = true;
  dom.outro.hidden = true;
  dom.hudDom.hidden = !gotGyro;
  clock.getDelta();
}

dom.btnStart.addEventListener('click', startRace);
dom.btnAgain.addEventListener('click', () => {
  ship.reset();
  topSpeed = 0;
  countdown = RACE.countdown;
  lastBeep = -1;
  phase = 'countdown';
  dom.outro.hidden = true;
  dom.hudDom.hidden = !controls.state.gyroEnabled;
  controls.recalibrate();
});
dom.btnCenter.addEventListener('click', () => controls.recalibrate());

function finishRace() {
  phase = 'finish';
  dom.resTotal.textContent = formatTime(ship.state.totalTime);
  dom.resBest.textContent = ship.state.bestLap ? formatTime(ship.state.bestLap) : '—';
  dom.resTop.textContent = `${(topSpeed * SPEED_DISPLAY).toFixed(0)} km/h`;
  dom.outro.hidden = false;
  dom.hudDom.hidden = true;
}

// ------------------------------------------------------------------- boucle

function updateGlitch(dt, speedNorm, musicLevel) {
  glitch.hit = Math.max(0, glitch.hit - dt * GLITCH.hitDecay);
  glitch.burstTime = Math.max(0, glitch.burstTime - dt);
  if (glitch.burstTime <= 0) glitch.burst = 0;

  glitch.nextRoll -= dt;
  if (glitch.nextRoll <= 0) {
    glitch.nextRoll = 0.25;
    if (Math.random() < GLITCH.burstChance * 0.25) {
      glitch.burst = rand(GLITCH.burstPower[0], GLITCH.burstPower[1]);
      glitch.burstTime = rand(GLITCH.burstTime[0], GLITCH.burstTime[1]);
    }
  }

  return clamp(
    GLITCH.idle
      + speedNorm * GLITCH.speedGain
      + glitch.hit
      + glitch.burst
      + musicLevel * 0.06,
    0,
    GLITCH.ceiling
  );
}

function hudState(center, sub) {
  const s = ship.state;
  return {
    lap: s.lap,
    laps: RACE.laps,
    lapTime: s.lapTime,
    bestLap: s.bestLap,
    totalTime: s.totalTime,
    // la vitesse affichée est cosmétique : le facteur place le plein régime
    // autour de 990, comme les tableaux de bord de l'époque
    speed: s.speed * SPEED_DISPLAY,
    shield: s.shield,
    boost: s.boost / SHIP.boostDuration,
    center,
    sub,
    bare: phase === 'intro',
  };
}

/**
 * Si l'appareil peine, on retombe en définition native avant de sacrifier
 * quoi que ce soit à l'image : c'est le dernier passage plein écran qui coûte.
 */
let fpsAcc = 0;
let fpsFrames = 0;
function watchPerformance(dt) {
  if (quality.pixelRatio <= 1) return;
  fpsAcc += dt;
  fpsFrames += 1;
  if (fpsAcc < 3) return;
  const fps = fpsFrames / fpsAcc;
  fpsAcc = 0;
  fpsFrames = 0;
  if (fps < 40) {
    quality.pixelRatio = 1;
    resize();
  }
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  let center = '';
  let sub = '';
  const racing = phase === 'racing';

  if (phase === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown);
    if (n !== lastBeep && n > 0) {
      audio.beep(false);
      lastBeep = n;
    }
    if (countdown <= 0) {
      phase = 'racing';
      audio.beep(true);
    } else {
      center = String(Math.max(1, n));
      sub = 'DOIGT POSE POUR ACCELERER';
    }
  }

  ship.update(dt, controls.state, racing);

  if (ship.state.hitThisFrame) {
    glitch.hit = GLITCH.hitBurst;
    audio.hit();
  }
  if (ship.state.boostedThisFrame) audio.boost();
  if (ship.state.lapThisFrame && !ship.state.finished) audio.beep(true);
  if (ship.state.finished && phase === 'racing') finishRace();

  topSpeed = Math.max(topSpeed, ship.state.speed);

  const speedNorm = clamp(ship.state.speed / SHIP.maxSpeed, 0, 1.4);
  const boostNorm = ship.state.boost > 0 ? 1 : 0;
  audio.setSpeed(speedNorm, boostNorm, dt);

  const music = audio.level();
  const glitchLevel = updateGlitch(dt, speedNorm, music);

  if (phase === 'finish') {
    center = 'FINISH';
    sub = formatTime(ship.state.totalTime);
  }

  // Le tableau de bord n'a pas besoin de soixante images par seconde ; on le
  // repeint une fois sur trois pour épargner les téléversements de texture.
  hudTick += 1;
  if (hudTick % 3 === 0 || center) hud.draw(hudState(center, sub));

  fade += ((phase === 'intro' ? 0.55 : 1) - fade) * Math.min(1, dt * 2.4);

  const u = post.uniforms;
  u.uTime.value = t;
  u.uGlitch.value = glitchOverride === null ? glitchLevel : glitchOverride;
  u.uSpeed.value = speedNorm;
  u.uFlash.value = ship.state.hitFlash;
  u.uFade.value = fade;
  u.uCurve.value = 0.62 + music * 0.2;

  // le champ de vision s'ouvre avec la vitesse : c'est ce qui donne la sensation
  const targetFov = RENDER.fov + speedNorm * 11 + (ship.state.boost > 0 ? 5 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }

  if (!dom.hudDom.hidden) dom.tilt.textContent = `${controls.state.rawTilt.toFixed(0)}°`;

  watchPerformance(dt);

  post.render(scene, camera);
}

resize();
hud.draw(hudState('', ''));
frame();

// Fenêtre de réglage : pratique pour ajuster sans recharger.
window.REBORN = {
  scene, camera, track, ship, controls, audio, post, hud,
  get phase() { return phase; },
  /** `null` rend la main à la simulation. */
  setGlitch(v) { glitchOverride = v; },
};
