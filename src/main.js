import {
  Clock,
  Color,
  Fog,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

import { GLITCH, INPUT, MUSIC, RACE, RENDER, SHIP } from './config.js';
import { THEMES, themeById } from './themes.js';
import { setPsxGrid } from './psx.js';
import { setTextureAnisotropy } from './textures.js';
import { buildTrack } from './track.js';
import { buildScenery } from './scenery.js';
import { createShip } from './ship.js';
import { createOpponents } from './opponents.js';
import { createRhythm } from './rhythm.js';
import { createControls } from './controls.js';
import { createHud } from './hud.js';
import { createPost } from './post.js';
import { createAudio } from './audio.js';
import { createStore } from './store.js';
import { createUi, formatTime } from './ui.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

/** Facteur d'affichage de la vitesse, purement cosmétique. */
const SPEED_DISPLAY = 2.3;

const dom = {
  frame: $('frame'),
  canvas: $('view'),
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
  throw err;
}

renderer.outputColorSpace = SRGBColorSpace;
setTextureAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new Scene();
scene.fog = new Fog(0x16222e, 150, 820);
scene.background = new Color(0x16222e);

const camera = new PerspectiveCamera(RENDER.fov, 0.52, RENDER.near, RENDER.far);
scene.add(camera);

const post = createPost(renderer);
const hud = createHud();
post.uniforms.tHud.value = hud.texture;

const audio = createAudio();
const controls = createControls(dom.canvas);
const store = createStore();
const ship = createShip(camera);

// ------------------------------------------------- chargement d'un circuit

/** @type {{theme:object, track:object, scenery:object, opponents:object, rhythm:object}|null} */
let world = null;

function disposeTree(object) {
  object.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) {
      if (!m) continue;
      for (const key of Object.keys(m)) {
        const value = m[key];
        if (value && value.isTexture) value.dispose();
      }
      m.dispose();
    }
  });
  object.removeFromParent();
}

function loadTrack(themeId) {
  if (world) {
    disposeTree(world.track.root);
    disposeTree(world.scenery.root);
    disposeTree(world.opponents.group);
    disposeTree(world.rhythm.bars);
  }

  const theme = themeById(themeId);
  const track = buildTrack(scene, theme);
  const scenery = buildScenery(scene, track, theme);
  const opponents = createOpponents(scene, track, theme);
  const rhythm = createRhythm(scene, track, audio, theme);

  scene.fog.color.set(theme.fog.color);
  scene.fog.near = theme.fog.near;
  scene.fog.far = theme.fog.far;
  scene.background.set(theme.fog.color);
  post.setTheme(theme);

  ship.attach(track);
  world = { theme, track, scenery, opponents, rhythm };
  return world;
}

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

/** 'menu' | 'countdown' | 'racing' | 'paused' | 'finish' */
let phase = 'menu';
let countdown = RACE.countdown;
let lastBeep = -1;
let topSpeed = 0;
let fade = 0;
let glitchOverride = null;
const glitch = { hit: 0, burst: 0, burstTime: 0, nextRoll: 0 };

const clock = new Clock();
let hudTick = 0;

function applySettings() {
  controls.settings.tiltSign = store.settings.invert ? -INPUT.tiltSign : INPUT.tiltSign;
  controls.settings.tiltRange = ui.sensitivityRange;
  if (store.settings.sound === audio.muted) audio.toggleMute();
}

const ui = createUi(store, {
  onStart: (themeId) => startRace(themeId),
  onPause: () => pauseRace(),
  onResume: () => resumeRace(),
  onRestart: () => startRace(world.theme.id),
  onQuit: () => quitToMenu(),
  onRecenter: () => controls.recalibrate(),
  onSoundRetry: () => audio.retry().then((ok) => ui.setSoundBlocked(!ok)),
  onSettings: () => applySettings(),
});

/**
 * Le son ne peut démarrer que dans un geste. On prend le tout premier, puis
 * on retente à chaque tape tant que le navigateur refuse : sur mobile, la
 * première tentative tombe parfois au mauvais moment du cycle de vie.
 */
dom.frame.addEventListener('pointerdown', () => {
  if (audio.playing) return;
  audio.start();
  setTimeout(() => ui.setSoundBlocked(!audio.playing), 400);
});

async function startRace(themeId) {
  // Le son d'abord, sans attendre : une autorisation de capteurs demandée
  // avant ferait perdre le contexte de geste et le son serait refusé.
  if (!audio.playing) audio.start();

  if (!world || world.theme.id !== themeId) loadTrack(themeId);

  ship.reset();
  world.opponents.reset();
  world.rhythm.reset();
  controls.reset();
  topSpeed = 0;
  countdown = RACE.countdown;
  lastBeep = -1;
  phase = 'countdown';
  ui.hideAll();

  const gotGyro = await controls.enableGyro();
  ui.setGyro(gotGyro);
  applySettings();
  setTimeout(() => ui.setSoundBlocked(!audio.playing), 500);
  clock.getDelta();
}

function pauseRace() {
  if (phase !== 'racing' && phase !== 'countdown') return;
  phase = 'paused';
  audio.pause();
  ui.showPause(world.theme.name);
}

function resumeRace() {
  if (phase !== 'paused') return;
  phase = ship.state.lap > 0 || countdown <= 0 ? 'racing' : 'countdown';
  audio.resume();
  ui.hideAll();
  clock.getDelta();
}

function quitToMenu() {
  phase = 'menu';
  ship.reset();
  world.opponents.reset();
  ui.show('select');
}

function finishRace() {
  phase = 'finish';
  const s = ship.state;
  const rank = world.opponents.rankOf(s.s);
  const result = {
    rank,
    field: world.opponents.total,
    total: s.totalTime,
    best: s.bestLap,
    top: topSpeed * SPEED_DISPLAY,
  };
  const records = store.record(world.theme.id, {
    total: s.totalTime, lap: s.bestLap, rank,
  });
  ui.showResults(result, records);
}

// ------------------------------------------------------------------- boucle

function updateGlitch(dt, speedNorm, beatPulse) {
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
    GLITCH.idle + speedNorm * GLITCH.speedGain + glitch.hit + glitch.burst
      + beatPulse * GLITCH.beatKick,
    0,
    GLITCH.ceiling
  );
}

function hudState(center, sub) {
  const s = ship.state;
  return {
    lap: s.lap,
    laps: RACE.laps,
    rank: s.rank,
    field: world ? world.opponents.total : RACE.opponents + 1,
    lapTime: s.lapTime,
    bestLap: s.bestLap,
    totalTime: s.totalTime,
    speed: s.speed * SPEED_DISPLAY,
    shield: s.shield,
    throttle: controls.state.throttle,
    boost: s.boost / SHIP.boostDuration,
    turbo: s.turbo / SHIP.turboDuration,
    pulse: world ? world.rhythm.state.pulse : 0,
    center,
    sub,
    bare: phase === 'menu' || phase === 'paused' || phase === 'finish',
  };
}

/** Pilote automatique du mode vitrine, derrière les menus. */
function demoInput() {
  const s = ship.state;
  return {
    steer: clamp(-(s.x * 0.16 + s.xVel * 0.26), -1, 1),
    throttle: 0.52,
    turboRequested: false,
  };
}

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

  if (phase === 'paused') {
    post.render(scene, camera);
    return;
  }

  controls.tick(dt);

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
      sub = 'GLISSER VERS LE HAUT POUR ACCELERER';
    }
  }

  const demo = phase === 'menu' || phase === 'finish';
  const racing = phase === 'racing' || demo;
  const input = demo
    ? demoInput()
    : {
      steer: controls.state.steer,
      throttle: controls.state.throttle,
      turboRequested: controls.consumeTurbo(),
    };

  const prevS = ship.state.s;
  ship.update(dt, input, racing, phase === 'racing');

  if (world) {
    const rubbed = world.opponents.update(dt, ship.state, racing);
    if (rubbed && phase === 'racing') {
      const away = Math.sign(ship.state.x) || 1;
      ship.knock(away, SHIP.rubSpeedLoss, SHIP.rubDamage);
      audio.hit(0.6);
    }
    ship.state.rank = world.opponents.rankOf(ship.state.s);
    world.rhythm.update(dt, ship.state.s, prevS, phase === 'racing');
    world.scenery.update(dt);
  }

  if (ship.state.hitThisFrame) {
    glitch.hit = GLITCH.hitBurst;
    audio.hit();
  }
  if (ship.state.boostedThisFrame) audio.boost();
  if (ship.state.turboThisFrame) audio.turbo();
  if (ship.state.lapThisFrame && !ship.state.finished) audio.beep(true);
  if (ship.state.finished && phase === 'racing') finishRace();

  topSpeed = Math.max(topSpeed, ship.state.speed);

  const speedNorm = clamp(ship.state.speed / SHIP.maxSpeed, 0, 1.6);
  audio.setSpeed(
    speedNorm,
    ship.state.boost > 0 ? 1 : 0,
    ship.state.turbo > 0 ? 1 : 0,
    dt
  );

  const beatPulse = world ? world.rhythm.state.pulse : 0;
  const glitchLevel = updateGlitch(dt, speedNorm, beatPulse);
  // la bande se numérise à mesure que l'image se corrompt
  audio.setCrush(clamp((glitchLevel - GLITCH.idle) / 0.45, 0, 1) * 0.9);

  if (phase === 'finish') {
    center = ship.state.rank === 1 ? 'P1' : `P${ship.state.rank}`;
    sub = formatTime(ship.state.totalTime);
  }

  hudTick += 1;
  if (hudTick % 3 === 0 || center) hud.draw(hudState(center, sub));

  fade += ((phase === 'menu' ? 0.6 : 1) - fade) * Math.min(1, dt * 2.4);

  const u = post.uniforms;
  u.uTime.value = t;
  u.uGlitch.value = glitchOverride === null ? glitchLevel : glitchOverride;
  u.uSpeed.value = speedNorm;
  u.uFlash.value = ship.state.hitFlash;
  u.uFade.value = fade;
  u.uBeat.value = beatPulse;
  u.uCurve.value = 0.62 + beatPulse * 0.12;

  // le champ de vision s'ouvre avec la vitesse : c'est ce qui donne la sensation
  const targetFov = RENDER.fov + speedNorm * 11
    + (ship.state.boost > 0 ? 4 : 0) + (ship.state.turbo > 0 ? 9 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }

  watchPerformance(dt);
  post.render(scene, camera);
}

// ------------------------------------------------------------------- départ

loadTrack(THEMES[0].id);
resize();
applySettings();
ui.show('title');
hud.draw(hudState('', ''));
frame();

// Fenêtre de réglage : pratique pour ajuster sans recharger.
window.REBORN = {
  scene, camera, ship, controls, audio, post, hud, store, ui,
  get world() { return world; },
  get phase() { return phase; },
  setGlitch(v) { glitchOverride = v; },
  startRace,
};
