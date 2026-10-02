import { MUSIC } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * La bande-son et ses dérapages.
 *
 * Le morceau est lu par un `<audio>` plutôt que décodé en mémoire : 4 min 38
 * en Float32 coûteraient près de cent mégaoctets sur un téléphone, et on veut
 * que ça démarre tout de suite. On désactive `preservesPitch` : la hauteur
 * suit alors la vitesse de lecture, exactement comme une bande qu'on ralentit
 * ou qu'on emballe. C'est tout l'effet recherché quand le bolide accélère.
 *
 * L'élément passe ensuite dans le graphe Web Audio pour en tirer un niveau
 * (qui fait respirer l'image) et pour y mêler les bruitages.
 */
export function createAudio() {
  const element = new Audio();
  element.src = MUSIC.src;
  element.loop = true;
  element.preload = 'auto';
  element.crossOrigin = 'anonymous';
  element.volume = MUSIC.volume;

  /** @type {AudioContext|null} */
  let ctx = null;
  let analyser = null;
  let bins = null;
  let sfxBus = null;
  let ready = false;

  let targetRate = MUSIC.rateIdle;
  let rate = MUSIC.rateIdle;

  function setPreservesPitch(value) {
    for (const key of ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch']) {
      if (key in element) element[key] = value;
    }
  }
  setPreservesPitch(false);

  function buildGraph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });

    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    try {
      const source = ctx.createMediaElementSource(element);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.72;
      bins = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);
      analyser.connect(master);
    } catch {
      // Si la source ne peut pas être créée, le son sort quand même : on perd
      // seulement l'analyse. Pas de raison d'empêcher de jouer.
      analyser = null;
    }

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
  }

  function noise(seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function envelope(param, t, peak, attack, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  return {
    element,
    get ready() { return ready; },
    get rate() { return rate; },

    /** À appeler depuis un geste utilisateur : sans ça, rien ne sort. */
    async start() {
      if (!ctx) buildGraph();
      if (ctx && ctx.state === 'suspended') await ctx.resume();
      setPreservesPitch(false);
      element.playbackRate = rate;
      try {
        await element.play();
        ready = true;
      } catch {
        ready = false;
      }
      return ready;
    },

    pause() {
      element.pause();
    },

    /**
     * Cale la vitesse de lecture sur celle du bolide.
     *
     * @param {number} normalized 0 à l'arrêt, 1 à la vitesse maximale
     * @param {number} boost      1 pendant une survitesse
     * @param {number} dt
     */
    setSpeed(normalized, boost, dt) {
      const base = MUSIC.rateIdle + (MUSIC.rateMax - MUSIC.rateIdle) * clamp(normalized, 0, 1);
      targetRate = base + (MUSIC.rateBoost - MUSIC.rateMax) * clamp(boost, 0, 1);
      const k = 1 - Math.exp(-dt / Math.max(0.01, MUSIC.smoothing));
      rate += (targetRate - rate) * k;
      if (ready) element.playbackRate = clamp(rate, 0.25, 4);
    },

    /** Niveau moyen des graves, 0..1 — fait battre l'image. */
    level() {
      if (!analyser) return 0;
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      const n = Math.min(10, bins.length);
      for (let i = 0; i < n; i++) sum += bins[i];
      return sum / (n * 255);
    },

    /** Choc contre un mur. */
    hit() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise(0.3);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1400, t);
      bp.frequency.exponentialRampToValueAtTime(220, t + 0.25);
      bp.Q.value = 1.1;
      const g = ctx.createGain();
      envelope(g.gain, t, 0.55, 0.003, 0.26);
      src.connect(bp).connect(g).connect(sfxBus);
      src.start(t);
      src.stop(t + 0.35);

      const thud = ctx.createOscillator();
      const tg = ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(120, t);
      thud.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      envelope(tg.gain, t, 0.7, 0.004, 0.2);
      thud.connect(tg).connect(sfxBus);
      thud.start(t);
      thud.stop(t + 0.3);
    },

    /** Plaque de survitesse. */
    boost() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise(0.9);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.4;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(5200, t + 0.5);
      const g = ctx.createGain();
      envelope(g.gain, t, 0.35, 0.05, 0.6);
      src.connect(bp).connect(g).connect(sfxBus);
      src.start(t);
      src.stop(t + 0.95);
    },

    /** Bip du décompte ; `high` pour le départ. */
    beep(high = false) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = high ? 1320 : 660;
      envelope(g.gain, t, 0.22, 0.004, high ? 0.5 : 0.18);
      o.connect(g).connect(sfxBus);
      o.start(t);
      o.stop(t + 0.7);
    },
  };
}
