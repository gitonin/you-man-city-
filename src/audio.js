import { TRACKS } from './config.js';

/**
 * Moteur audio maison (Web Audio, aucune ressource externe).
 *
 * Deux étages :
 *  - un drone continu dont le désaccord se referme quand le joueur approche
 *    du bon angle (le "chaud/froid" sonore du niveau 1) ;
 *  - un séquenceur à 8 pistes pour le niveau 2, calé sur l'horloge audio et
 *    non sur requestAnimationFrame.
 */
export function createAudio() {
  /** @type {AudioContext|null} */
  let ctx = null;
  let master;
  let dry;
  let verbSend;
  let delaySend;

  let drone = null;
  let seq = null;

  const stepQueue = []; // { step, time } consommés par la boucle de rendu
  let onStep = null;

  const now = () => (ctx ? ctx.currentTime : 0);

  // ---------------------------------------------------------------- routage

  function buildImpulse(seconds = 2.6, decay = 3.2) {
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
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = 0.0001;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    master.connect(comp).connect(ctx.destination);

    dry = ctx.createGain();
    dry.gain.value = 1;
    dry.connect(master);

    // réverbération
    const verb = ctx.createConvolver();
    verb.buffer = buildImpulse();
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.55;
    verb.connect(verbOut).connect(master);
    verbSend = ctx.createGain();
    verbSend.gain.value = 1;
    verbSend.connect(verb);

    // delay pointé, très "cité pluvieuse"
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    delay.connect(damp).connect(fb).connect(delay);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.34;
    delay.connect(delayOut).connect(master);
    delaySend = ctx.createGain();
    delaySend.gain.value = 1;
    delaySend.connect(delay);

    master.gain.setTargetAtTime(0.85, now(), 1.4);
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

    out.connect(dry);
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

    const a = mk('sawtooth', 55, 0.22);
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
    shimmer.connect(shimmerG).connect(verbSend);
    shimmerG.connect(dry);
    shimmer.start();

    out.gain.setTargetAtTime(0.7, now(), 2.5);

    return { out, filter, a, b, ng, nf, shimmerG, oscs, noise, shimmer };
  }

  // ------------------------------------------------------------------ voix

  function env(param, t, peak, attack, decay) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function voiceKick(t, vel = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    env(g.gain, t, 0.95 * vel, 0.004, 0.34);
    o.connect(g).connect(dry);
    o.start(t);
    o.stop(t + 0.42);

    // claquement d'attaque
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(0.05);
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 1600;
    const ng = ctx.createGain();
    env(ng.gain, t, 0.16 * vel, 0.001, 0.03);
    n.connect(nf).connect(ng).connect(dry);
    n.start(t);
    n.stop(t + 0.08);
  }

  function voiceClap(t, vel = 1) {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.011;
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(0.25);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500 + i * 180;
      bp.Q.value = 1.1;
      const g = ctx.createGain();
      env(g.gain, at, (i === 2 ? 0.42 : 0.2) * vel, 0.002, i === 2 ? 0.19 : 0.05);
      n.connect(bp).connect(g);
      g.connect(dry);
      g.connect(verbSend);
      n.start(at);
      n.stop(at + 0.3);
    }
  }

  function voiceBass(t, freq, vel = 1) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(950, t + 0.04);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.3);

    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq / 2;

    env(g.gain, t, 0.42 * vel, 0.006, 0.3);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(dry);
    o1.start(t); o2.start(t);
    o1.stop(t + 0.45); o2.stop(t + 0.45);
  }

  function voiceLead(t, freq, vel = 1) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.26);

    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = freq;
    o1.detune.value = -7;
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = freq;
    o2.detune.value = 7;

    env(g.gain, t, 0.2 * vel, 0.006, 0.28);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(dry);
    g.connect(verbSend);
    g.connect(delaySend);
    o1.start(t); o2.start(t);
    o1.stop(t + 0.45); o2.stop(t + 0.45);
  }

  /** Joue la piste `index` à l'instant `t` (horloge audio). */
  function playTrack(index, t = now() + 0.01, vel = 1) {
    if (!ctx) return;
    const track = TRACKS[index];
    if (!track) return;
    if (track.kind === 'kick') voiceKick(t, vel);
    else if (track.kind === 'clap') voiceClap(t, vel);
    else if (track.kind === 'bass') voiceBass(t, track.freq, vel);
    else voiceLead(t, track.freq, vel);
  }

  // ------------------------------------------------------------- séquenceur

  function createSequencer() {
    const state = {
      bpm: 102,
      steps: 8,
      step: 0,
      nextTime: 0,
      playing: false,
      timer: 0,
      pattern: null,
    };

    const LOOKAHEAD = 0.12;

    function stepDuration() {
      return 60 / state.bpm / 2; // croches
    }

    function tick() {
      if (!ctx || !state.playing) return;
      while (state.nextTime < now() + LOOKAHEAD) {
        const t = state.nextTime;
        const s = state.step;
        if (state.pattern) {
          for (let track = 0; track < state.pattern.length; track++) {
            if (state.pattern[track][s]) playTrack(track, t, 1);
          }
        }
        stepQueue.push({ step: s, time: t });
        state.step = (s + 1) % state.steps;
        state.nextTime += stepDuration();
      }
    }

    return {
      state,
      start(pattern) {
        if (!ctx) return;
        state.pattern = pattern;
        if (state.playing) return;
        state.playing = true;
        state.nextTime = now() + 0.08;
        state.timer = setInterval(tick, 25);
        tick();
      },
      stop() {
        state.playing = false;
        clearInterval(state.timer);
        stepQueue.length = 0;
      },
      setPattern(p) { state.pattern = p; },
      setBpm(v) { state.bpm = v; },
      get playing() { return state.playing; },
      get step() { return state.step; },
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
      if (!drone) return;
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
      g.connect(dry);
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
      g.connect(dry);
      g.connect(verbSend);
      n.start(t);
      n.stop(t + 2.4);

      voiceKick(t + 0.55, 1);
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
        og.connect(dry);
        og.connect(verbSend);
        o.start(t + 0.5);
        o.stop(t + 3.6);
      });
    },

    /** Le drone se met en retrait pendant le séquenceur. */
    duckDrone(amount = 0.22) {
      if (!drone) return;
      drone.out.gain.setTargetAtTime(amount, now(), 1.2);
    },
    restoreDrone() {
      if (!drone) return;
      drone.out.gain.setTargetAtTime(0.7, now(), 1.2);
    },

    playTrack,

    sequencer: {
      start(pattern) { seq && seq.start(pattern); },
      stop() { seq && seq.stop(); },
      setPattern(p) { seq && seq.setPattern(p); },
      setBpm(v) { seq && seq.setBpm(v); },
      get playing() { return !!seq && seq.state.playing; },
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

    set stepHandler(fn) { onStep = fn; },
    get stepHandler() { return onStep; },
  };
}
