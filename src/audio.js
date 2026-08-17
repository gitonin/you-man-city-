import { PAD_STEPS, STEPS, TRACKS } from './config.js';

/**
 * Moteur audio maison (Web Audio, aucune ressource externe).
 *
 * Deux régimes bien séparés :
 *
 *  - **niveau 1** : un drone continu dont le désaccord se referme quand le
 *    joueur approche du bon angle. C'est le seul « chaud/froid » sonore.
 *  - **niveau 2** : le drone est coupé net et laisse place à un morceau —
 *    grosse caisse compressée, basse acide, stabs, charlestons — piloté par
 *    une horloge audio et non par requestAnimationFrame. Tout ce qui n'est
 *    pas la grosse caisse passe dans un bus « ducké » à chaque coup : c'est
 *    la respiration caractéristique du genre.
 */
export function createAudio() {
  /** @type {AudioContext|null} */
  let ctx = null;
  let master;
  let pump; // bus ducké par la grosse caisse
  let music; // tout sauf la grosse caisse
  let verbSend;
  let delaySend;

  let drone = null;
  let seq = null;

  const stepQueue = []; // { step, time } consommés par la boucle de rendu

  const now = () => (ctx ? ctx.currentTime : 0);

  // ---------------------------------------------------------------- routage

  function buildImpulse(seconds = 2.4, decay = 3.4) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  function noiseBuffer(seconds = 1) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = 0.0001;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    master.connect(comp).connect(ctx.destination);

    // bus ducké : la grosse caisse le pince, tout le reste le traverse
    pump = ctx.createGain();
    pump.gain.value = 1;
    pump.connect(master);

    music = ctx.createGain();
    music.gain.value = 1;
    music.connect(pump);

    const verb = ctx.createConvolver();
    verb.buffer = buildImpulse();
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.5;
    verb.connect(verbOut).connect(pump);
    verbSend = ctx.createGain();
    verbSend.connect(verb);

    // delay en croche pointée, très « cité pluvieuse »
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2000;
    delay.connect(damp).connect(fb).connect(delay);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.32;
    delay.connect(delayOut).connect(pump);
    delaySend = ctx.createGain();
    delaySend.connect(delay);

    master.gain.setTargetAtTime(0.85, now(), 1.2);
  }

  /** Compression latérale : le bus musical plonge à chaque grosse caisse. */
  function duck(t) {
    const g = pump.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(0.3, t + 0.014);
    g.linearRampToValueAtTime(1, t + 0.21);
  }

  // ------------------------------------------------------------------ drone

  function buildDrone() {
    const out = ctx.createGain();
    out.gain.value = 0.0001;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 190;
    filter.Q.value = 3.2;
    filter.connect(out);

    out.connect(master);
    const sendG = ctx.createGain();
    sendG.gain.value = 0.5;
    out.connect(sendG).connect(verbSend);

    const oscs = [];
    const mk = (type, freq, gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(filter);
      o.start();
      oscs.push(o);
      return o;
    };

    mk('sawtooth', 55, 0.22);
    const b = mk('sawtooth', 55, 0.22);
    mk('sine', 27.5, 0.5);
    mk('triangle', 82.4, 0.09);

    // souffle : la pluie et la ventilation
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(2);
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(nf).connect(ng).connect(out);
    noise.start();

    // scintillement qui n'apparaît qu'à l'approche du bon angle
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = 1318.5;
    const shimmerG = ctx.createGain();
    shimmerG.gain.value = 0.0001;
    shimmer.connect(shimmerG);
    shimmerG.connect(verbSend);
    shimmerG.connect(master);
    shimmer.start();

    out.gain.setTargetAtTime(0.7, now(), 2.5);

    return { out, filter, b, nf, shimmerG, oscs, noise, shimmer };
  }

  // ------------------------------------------------------------------ voix

  function env(param, t, peak, attack, decay) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Grosse caisse : courte, pincée, elle passe *à côté* du bus ducké. */
  function voiceKick(t, vel = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(185, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.055);
    env(g.gain, t, 1.0 * vel, 0.003, 0.28);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.36);

    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(0.04);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const ng = ctx.createGain();
    env(ng.gain, t, 0.14 * vel, 0.001, 0.02);
    n.connect(hp).connect(ng).connect(master);
    n.start(t);
    n.stop(t + 0.06);

    duck(t);
  }

  function voiceSub(t, freq = 49, vel = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    env(g.gain, t, 0.5 * vel, 0.008, 0.17);
    o.connect(g).connect(music);
    o.start(t);
    o.stop(t + 0.24);
  }

  function voiceClap(t, vel = 1) {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.01;
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(0.24);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1600 + i * 200;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      env(g.gain, at, (i === 2 ? 0.4 : 0.18) * vel, 0.002, i === 2 ? 0.17 : 0.04);
      n.connect(bp).connect(g);
      g.connect(music);
      g.connect(verbSend);
      n.start(at);
      n.stop(at + 0.28);
    }
  }

  function voiceHat(t, open = false, vel = 1) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(open ? 0.3 : 0.08);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 7200 : 8600;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = open ? 9000 : 11000;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    env(g.gain, t, (open ? 0.16 : 0.11) * vel, 0.001, open ? 0.16 : 0.028);
    n.connect(hp).connect(bp).connect(g);
    g.connect(music);
    if (open) g.connect(verbSend);
    n.start(t);
    n.stop(t + (open ? 0.35 : 0.1));
  }

  /** Basse acide : saw + passe-bas résonant enveloppé. */
  function voiceBass(t, freq, vel = 1) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 11;
    lp.frequency.setValueAtTime(210, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(240, t + 0.22);

    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = freq / 2;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.35;

    env(g.gain, t, 0.4 * vel, 0.005, 0.2);
    o1.connect(lp);
    o2.connect(o2g).connect(lp);
    lp.connect(g);
    g.connect(music);
    o1.start(t); o2.start(t);
    o1.stop(t + 0.32); o2.stop(t + 0.32);
  }

  /** Stab mineur : l'accord disco sombre, court et très réverbéré. */
  function voiceStab(t, freq, vel = 1) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(3600, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.18);

    env(g.gain, t, 0.13 * vel, 0.004, 0.15);
    lp.connect(g);
    g.connect(music);
    g.connect(verbSend);
    g.connect(delaySend);

    for (const ratio of [1, 1.1892, 1.4983]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq * ratio;
      o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.28);
    }
  }

  /** Note du joueur : pluck filtré, envoyé au delay pour l'espace. */
  function voicePad(t, freq, vel = 1) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.24);

    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = freq;
    o1.detune.value = -6;
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = freq;
    o2.detune.value = 6;

    env(g.gain, t, 0.18 * vel, 0.004, 0.26);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(music);
    g.connect(verbSend);
    g.connect(delaySend);
    o1.start(t); o2.start(t);
    o1.stop(t + 0.4); o2.stop(t + 0.4);
  }

  /** Joue la piste `index` du joueur. */
  function playPad(index, t = now() + 0.01, vel = 1) {
    if (!ctx) return;
    const track = TRACKS[index];
    if (track) voicePad(t, track.freq, vel);
  }

  /** Joue un pas de la rythmique déduite du mot. */
  function playGrooveStep(s, t) {
    if (!ctx || !s) return;
    if (s.kick) voiceKick(t);
    if (s.sub) voiceSub(t, 49);
    if (s.clap) voiceClap(t);
    if (s.openHat) voiceHat(t, true);
    if (s.closedHat) voiceHat(t, false, 0.85);
    if (s.bass) voiceBass(t, s.bass);
    if (s.stab) voiceStab(t, s.stab);
  }

  // ------------------------------------------------------------- séquenceur

  function createSequencer() {
    const state = {
      bpm: 122,
      step: 0,
      nextTime: 0,
      playing: false,
      timer: 0,
      pattern: null,
      groove: null,
      grooveOn: true,
    };

    const LOOKAHEAD = 0.12;
    const stepDuration = () => 60 / state.bpm / 4; // doubles-croches

    function tick() {
      if (!ctx || !state.playing) return;
      while (state.nextTime < now() + LOOKAHEAD) {
        const t = state.nextTime;
        const s = state.step;

        if (state.grooveOn && state.groove) playGrooveStep(state.groove[s], t);

        if (state.pattern) {
          const padStep = s % PAD_STEPS;
          for (let track = 0; track < state.pattern.length; track++) {
            if (state.pattern[track][padStep]) playPad(track, t, 1);
          }
        }

        stepQueue.push({ step: s, time: t });
        state.step = (s + 1) % STEPS;
        state.nextTime += stepDuration();
      }
    }

    return {
      state,
      start({ pattern, groove } = {}) {
        if (!ctx) return;
        if (pattern) state.pattern = pattern;
        if (groove) state.groove = groove;
        if (state.playing) return;
        state.playing = true;
        state.step = 0;
        state.nextTime = now() + 0.09;
        state.timer = setInterval(tick, 25);
        tick();
      },
      stop() {
        state.playing = false;
        clearInterval(state.timer);
        stepQueue.length = 0;
      },
      setPattern(p) { state.pattern = p; },
      setGroove(g) { state.groove = g; },
      setGrooveEnabled(v) { state.grooveOn = !!v; },
      setBpm(v) { state.bpm = v; },
    };
  }

  // ------------------------------------------------------------------- API

  return {
    get ready() { return !!ctx; },
    get context() { return ctx; },

    /** À appeler depuis un vrai geste utilisateur. */
    async unlock() {
      if (ctx) {
        if (ctx.state === 'suspended') await ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC({ latencyHint: 'interactive' });
      if (ctx.state === 'suspended') await ctx.resume();
      buildGraph();
      drone = buildDrone();
      seq = createSequencer();
    },

    /** Referme le désaccord du drone à mesure que l'angle devient juste. */
    setLock(lock) {
      if (!drone || drone.muted) return;
      const t = now();
      const l = Math.max(0, Math.min(1, lock));
      drone.b.detune.setTargetAtTime(38 * (1 - l) + 2, t, 0.16);
      drone.filter.frequency.setTargetAtTime(190 + l * l * 2600, t, 0.22);
      drone.nf.frequency.setTargetAtTime(700 + l * 3200, t, 0.3);
      drone.shimmerG.gain.setTargetAtTime(0.0001 + Math.pow(l, 4) * 0.06, t, 0.25);
    },

    /** Petit repère sonore quand on franchit un palier de résonance. */
    ping(level = 0) {
      if (!ctx) return;
      const t = now() + 0.01;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = [660, 880, 1320][Math.min(level, 2)];
      env(g.gain, t, 0.1, 0.004, 0.5);
      o.connect(g);
      g.connect(music);
      g.connect(verbSend);
      o.start(t);
      o.stop(t + 0.6);
    },

    /** Impact de la révélation. */
    impact() {
      if (!ctx) return;
      const t = now() + 0.01;

      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(2.4);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(240, t);
      bp.frequency.exponentialRampToValueAtTime(5200, t + 0.9);
      const g = ctx.createGain();
      env(g.gain, t, 0.3, 0.55, 1.6);
      n.connect(bp).connect(g);
      g.connect(music);
      g.connect(verbSend);
      n.start(t);
      n.stop(t + 2.4);

      voiceKick(t + 0.55);
      [130.81, 196.0, 261.63, 392.0].forEach((f, i) => {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        env(og.gain, t + 0.55 + i * 0.02, 0.13, 0.02, 2.6);
        o.connect(lp).connect(og);
        og.connect(music);
        og.connect(verbSend);
        o.start(t + 0.5);
        o.stop(t + 3.6);
      });
    },

    /** Le drone disparaît complètement dès qu'on entre dans le séquenceur. */
    silenceDrone(fade = 0.8) {
      if (!drone) return;
      drone.muted = true;
      const t = now();
      drone.out.gain.cancelScheduledValues(t);
      drone.out.gain.setTargetAtTime(0.0001, t, fade / 3);
      drone.shimmerG.gain.setTargetAtTime(0.0001, t, fade / 3);
    },
    restoreDrone(fade = 1.4) {
      if (!drone) return;
      drone.muted = false;
      drone.out.gain.setTargetAtTime(0.7, now(), fade / 3);
    },

    playPad,
    playGrooveStep,

    sequencer: {
      start(cfg) { seq && seq.start(cfg); },
      stop() { seq && seq.stop(); },
      setPattern(p) { seq && seq.setPattern(p); },
      setGroove(g) { seq && seq.setGroove(g); },
      setGrooveEnabled(v) { seq && seq.setGrooveEnabled(v); },
      setBpm(v) { seq && seq.setBpm(v); },
      get playing() { return !!seq && seq.state.playing; },
      get grooveOn() { return !!seq && seq.state.grooveOn; },
    },

    /** Vide la file des pas échus : à appeler dans la boucle de rendu. */
    drainSteps(handler) {
      if (!ctx) return;
      const t = now();
      while (stepQueue.length && stepQueue[0].time <= t + 0.012) {
        const item = stepQueue.shift();
        handler(item.step, item.time);
      }
    },
  };
}
