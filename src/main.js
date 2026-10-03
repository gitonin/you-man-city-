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
import { createObstacles } from './obstacles.js';
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
  rotateText: $('rotate-text'),
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
    disposeTree(world.obstacles.group);
    disposeTree(world.rhythm.bars);
  }

  const theme = themeById(themeId);
  const track = buildTrack(scene, theme);
  const scenery = buildScenery(scene, track, theme);
  const opponents = createOpponents(scene, track, theme);
  const obstacles = createObstacles(scene, track, theme);
  const rhythm = createRhythm(scene, track, audio, theme);

  scene.fog.color.set(theme.fog.color);
  scene.fog.near = theme.fog.near;
  scene.fog.far = theme.fog.far;
  scene.background.set(theme.fog.color);
  post.setTheme(theme);

  ship.attach(track);
  world = { theme, track, scenery, opponents, obstacles, rhythm };
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

  // On ne réclame une rotation que si l'appareil contredit le format choisi,
  // et seulement sur un écran assez petit pour que ça gêne : sur un ordinateur
  // en fenêtre large, le cadre se contente d'être centré.
  const wide = window.innerWidth > window.innerHeight;
  const wantsWide = store.settings.orientation === 'paysage';
  const tooSmall = Math.min(window.innerWidth, window.innerHeight) < 480;
  rotateNeeded = wide !== wantsWide && tooSmall;
  dom.rotateText.innerHTML = wantsWide
    ? 'Tourner l’appareil<br />à l’horizontale'
    : 'Tenir l’appareil<br />à la verticale';
  syncRotate();
}

/**
 * Le rappel de rotation ne couvre l'écran que pendant la course.
 *
 * Il recouvre tout, menus compris : s'il s'affichait dès le titre, un appareil
 * tenu à contresens du format enregistré bloquerait l'accès à « Contrôles »,
 * c'est-à-dire au réglage qui aurait réparé la situation.
 */
let rotateNeeded = false;
let rotateShown = null;
function syncRotate() {
  const show = rotateNeeded && (phase === 'racing' || phase === 'countdown');
  if (show === rotateShown) return;
  rotateShown = show;
  dom.rotate.hidden = !show;
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
/** L'annonceur ne prévient qu'une fois par course du bouclier bas. */
let shieldWarned = false;
/** Retombée du gros message central : pilote le zoom et l'écartement RVB. */
let centerPop = 0;
let goUntil = 0;
const glitch = { hit: 0, burst: 0, burstTime: 0, nextRoll: 0 };

const clock = new Clock();
let hudTick = 0;

/**
 * L'orage, sur les circuits sous l'averse.
 *
 * Un éclair n'est pas un flash : c'est une salve de deux à quatre décharges
 * très brèves, séparées de quelques dizaines de millisecondes, dont les
 * dernières sont plus faibles. Et le tonnerre arrive après, d'autant plus tard
 * et plus sourd que l'éclair est loin — c'est ce décalage qui place l'orage
 * dans l'espace plutôt que dans le haut-parleur.
 */
const storm = { next: 4, bolt: 0, strikes: [], distance: 0.5, hold: null };

function updateStorm(dt, t) {
  const active = phase !== 'menu' && world && world.theme.rain > 0;
  if (!active) {
    storm.bolt = Math.max(0, storm.bolt - dt * 9);
    return;
  }

  storm.next -= dt;
  if (storm.next <= 0) {
    storm.next = 5 + Math.random() * 11;
    storm.distance = Math.random();
    // proche = fort et blanc ; lointain = une lueur à l'horizon
    const power = 0.07 + (1 - storm.distance) * 0.42;
    const count = 2 + ((Math.random() * 3) | 0);
    storm.strikes.length = 0;
    let at = t;
    for (let i = 0; i < count; i++) {
      storm.strikes.push({ at, power: power * (i === 0 ? 1 : 0.35 + Math.random() * 0.5) });
      at += 0.04 + Math.random() * 0.11;
    }
    // trois cents mètres par seconde, à l'échelle du jeu
    audio.thunder(storm.distance, 0.25 + storm.distance * 2.4);
  }

  storm.bolt = Math.max(0, storm.bolt - dt * 11);
  while (storm.strikes.length && storm.strikes[0].at <= t) {
    storm.bolt = Math.max(storm.bolt, storm.strikes.shift().power);
  }
  // maintien de réglage : fige la décharge le temps de juger l'image
  if (storm.hold !== null) storm.bolt = storm.hold;
}

function applySettings() {
  controls.settings.tiltSign = store.settings.invert ? -INPUT.tiltSign : INPUT.tiltSign;
  controls.settings.tiltRange = ui.sensitivityRange;
  if (store.settings.sound === audio.muted) audio.toggleMute();
  // changer de format redimensionne le cadre : cible de rendu, HUD, cockpit
  // et grille d'accrochage se recalculent tous là-dedans
  resize();
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
 * Son et capteurs se réclament tous deux dans un geste de l'utilisateur, et
 * on prend donc le tout premier — celui qui amène sur le titre.
 *
 * L'ordre n'est pas libre : le son d'abord et **sans attendre**, les capteurs
 * ensuite. iOS ouvre une boîte de dialogue pour `requestPermission`, et toute
 * attente avant `play()` ferait sortir du contexte de geste, auquel cas le son
 * serait refusé.
 *
 * On retente à chaque tape tant que l'un des deux manque : sur mobile, la
 * première tentative tombe parfois au mauvais moment du cycle de vie.
 */
let gyroAsked = false;
dom.frame.addEventListener('pointerdown', () => {
  const needSound = !audio.playing;
  if (needSound) audio.start();

  if (!gyroAsked) {
    gyroAsked = true;
    controls.enableGyro().then((ok) => {
      // refusé : on laisse la porte ouverte pour une prochaine tape
      gyroAsked = ok;
      ui.setGyro(ok);
      applySettings();
    });
  }

  if (needSound) setTimeout(() => ui.setSoundBlocked(!audio.playing, audio.failed), 400);
});

async function startRace(themeId) {
  // Le son d'abord, sans attendre : une autorisation de capteurs demandée
  // avant ferait perdre le contexte de geste et le son serait refusé.
  if (!audio.playing) audio.start();

  if (!world || world.theme.id !== themeId) loadTrack(themeId);

  ship.reset();
  world.opponents.reset();
  world.obstacles.reset();
  world.rhythm.reset();
  controls.reset();
  topSpeed = 0;
  countdown = RACE.countdown;
  lastBeep = -1;
  shieldWarned = false;
  phase = 'countdown';
  ui.hideAll();

  // Les capteurs ont normalement été demandés au tout premier geste, sur le
  // titre. On retente ici pour le cas où ils auraient été refusés alors.
  if (!controls.state.gyroEnabled) {
    const gotGyro = await controls.enableGyro();
    gyroAsked = gotGyro;
    ui.setGyro(gotGyro);
    applySettings();
  }
  setTimeout(() => ui.setSoundBlocked(!audio.playing, audio.failed), 500);
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
  audio.say(rank === 1 ? 'winner' : 'finish', { level: 1.05, when: 0.2 });
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
    laps: ship.laps,
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
    pop: centerPop,
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
  // il dépend de la phase, pas seulement des dimensions : on le suit d'ici
  syncRotate();

  let center = '';
  let sub = '';
  // retombée de l'apparition du gros message : 1 au moment du changement
  centerPop = Math.max(0, centerPop - dt * 3.4);

  if (phase === 'paused') {
    audio.idleEngine();
    post.render(scene, camera);
    return;
  }

  controls.tick(dt);

  if (phase === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown);
    if (n !== lastBeep && n > 0) {
      audio.tick(false);
      audio.say(['', 'one', 'two', 'three'][Math.min(n, 3)]);
      lastBeep = n;
      // chaque chiffre claque : le HUD le fait naître grand et décollé, et
      // l'image prend un coup de corruption en même temps
      centerPop = 1;
      glitch.hit = Math.max(glitch.hit, GLITCH.hitBurst * 0.75);
    }
    if (countdown <= 0) {
      phase = 'racing';
      audio.tick(true);
      audio.say('go', { level: 1.1 });
      centerPop = 1;
      goUntil = t + 0.75;
      glitch.hit = Math.max(glitch.hit, GLITCH.hitBurst);
    } else {
      center = String(Math.max(1, n));
      sub = world.theme.hint || 'GLISSER VERS LE HAUT POUR ACCELERER';
    }
  }
  // le « GO » survit au changement de phase, le temps de se recoller
  if (t < goUntil) center = 'GO';

  const demo = phase === 'menu' || phase === 'finish';
  const racing = phase === 'racing' || demo;
  const input = demo
    ? demoInput()
    : {
      steer: controls.state.steer,
      // Sur le parcours bonus, les gaz se mettent seuls : la seule décision
      // qui reste au joueur est de passer à gauche ou à droite.
      throttle: world && world.theme.autoThrottle ? 1 : controls.state.throttle,
      turboRequested: world && world.theme.autoThrottle ? false : controls.consumeTurbo(),
    };

  const prevS = ship.state.s;
  ship.update(dt, input, racing, phase === 'racing');

  if (world) {
    const rubbed = world.opponents.update(dt, ship.state, racing);
    if (rubbed && phase === 'racing') {
      const away = Math.sign(ship.state.x) || 1;
      ship.knock(away, SHIP.rubSpeedLoss, SHIP.rubDamage);
      audio.hit(0.6);
      audio.dip(0.45);
    }
    ship.state.rank = world.opponents.rankOf(ship.state.s);
    if (phase === 'racing' && world.obstacles.update(prevS, ship.state.s, ship.state.x)) {
      // on recule du côté le plus dégagé, et ça coûte cher : c'est l'épreuve
      ship.knock(-Math.sign(ship.state.x) || 1, 0.62, 18);
      audio.hit(1.1);
      audio.dip(1);
    }
    world.rhythm.update(dt, ship.state.s, prevS, phase === 'racing');
    world.scenery.update(dt);
  }

  if (ship.state.hitThisFrame) {
    glitch.hit = GLITCH.hitBurst;
    audio.hit();
    // la bande plonge avec l'image : seule « numérisation » qu'on s'autorise
    // sur le morceau, parce qu'elle ne traverse aucun traitement
    audio.dip(1);
  }
  if (ship.state.boostedThisFrame) audio.boost();
  if (ship.state.turboThisFrame) {
    audio.turbo();
    audio.say('turbo', { level: 0.9, rate: 1.1 });
  }
  if (ship.state.lapThisFrame && !ship.state.finished) {
    audio.tick(true);
    if (ship.state.lap === ship.laps - 1) {
      audio.say('final', { when: 0.12 });
      audio.say('lap', { when: 0.56 });
    } else {
      audio.say('lap', { when: 0.12 });
    }
  }
  if (phase === 'racing' && !shieldWarned && ship.state.shield < 32) {
    shieldWarned = true;
    audio.say('warning', { level: 0.95, ring: 0.5 });
    audio.say('shield', { level: 0.95, ring: 0.5, when: 0.5 });
  }
  if (ship.state.finished && phase === 'racing') finishRace();

  topSpeed = Math.max(topSpeed, ship.state.speed);

  const speedNorm = clamp(ship.state.speed / SHIP.maxSpeed, 0, 1.6);
  audio.setSpeed(
    speedNorm,
    ship.state.boost > 0 ? 1 : 0,
    ship.state.turbo > 0 ? 1 : 0,
    dt
  );
  // derrière les menus, le bolide roule mais personne ne pilote : pas de réacteur
  if (demo) audio.idleEngine();

  const beatPulse = world ? world.rhythm.state.pulse : 0;
  const glitchLevel = updateGlitch(dt, speedNorm, beatPulse);

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

  updateStorm(dt, t);
  u.uBolt.value = storm.bolt;
  if (world && world.scenery.setStorm) world.scenery.setStorm(storm.bolt);

  // le champ de vision s'ouvre avec la vitesse : c'est ce qui donne la sensation
  const targetFov = RENDER.fov + speedNorm * 11
    + (ship.state.boost > 0 ? 4 : 0) + (ship.state.turbo > 0 ? 9 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }

  // le diagnostic ne sert que là où on le lit
  if (ui.current === 'controls' && hudTick % 20 === 0) {
    const c = audio.context;
    ui.setDiagnostic([
      `lecture   ${audio.playing ? 'oui' : 'non'}${audio.muted ? ' (coupé)' : ''}`,
      `décodé    ${audio.buffered ? 'oui' : 'non'} · ${audio.duration.toFixed(0)} s en mémoire`,
      `vitesse   x${audio.rate.toFixed(2)} · position ${audio.mediaTime().toFixed(0)} s`,
      `contexte  ${c ? `${c.state} · ${(c.sampleRate / 1000).toFixed(1)} kHz` : 'absent'}`,
    ].join('\n'));
  }

  watchPerformance(dt);
  post.render(scene, camera);
}

// ------------------------------------------------------------------- départ

loadTrack(THEMES[0].id);
resize();
applySettings();
ui.show('boot');
hud.draw(hudState('', ''));
frame();

/**
 * On ne donne la main qu'une fois le morceau téléchargé **et décodé**.
 *
 * Aucun geste n'est requis pour un `fetch` ni pour un décodage — le contexte
 * audio naît suspendu et se réveille au premier appui —, donc tout peut se
 * faire pendant que l'écran de démarrage est affiché. Et comme la vitesse de
 * lecture suit celle du bolide, c'est la seule façon qu'accélérer ne demande
 * jamais rien au réseau.
 */
audio.load((ratio, stage) => ui.setLoad(ratio, stage)).then((ok) => {
  // Sans bande-son le jeu reste jouable : le volet rythmique se tait, le reste
  // tourne. On laisse donc entrer, en l'ayant dit.
  setTimeout(() => ui.show('title'), ok ? 220 : 1600);
});

// Fenêtre de réglage : pratique pour ajuster sans recharger.
window.REBORN = {
  scene, camera, ship, controls, audio, post, hud, store, ui,
  /** Permet de rendre la bande sonore hors ligne, pour l'écouter. */
  createAudio,
  get world() { return world; },
  get phase() { return phase; },
  setGlitch(v) { glitchOverride = v; },
  /** Déclenche un éclair tout de suite : pour régler l'orage. */
  strike() { storm.next = 0; },
  stormState() { return { bolt: storm.bolt, next: storm.next, distance: storm.distance }; },
  holdBolt(v) { storm.hold = v; },
  startRace,
};
