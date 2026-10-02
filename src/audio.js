import { MUSIC } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * La bande-son, et tout ce qui sonne.
 *
 * Le morceau est lu par un `<audio>` plutôt que décodé en mémoire : 4 min 38
 * en Float32 coûteraient près de cent mégaoctets sur un téléphone. On coupe
 * `preservesPitch`, donc la hauteur suit la vitesse de lecture — l'effet bande
 * magnétique qu'on cherche quand le bolide accélère.
 *
 * Deux précautions pèsent lourd sur mobile :
 *
 *  - `play()` doit partir **dans** le geste de l'utilisateur. Toute attente
 *    avant (une demande d'autorisation de capteurs, par exemple) fait perdre
 *    le contexte de geste et le navigateur refuse le son.
 *  - pas d'attribut `crossOrigin` : il est inutile en même origine et, servi
 *    par un hébergeur qui n'envoie pas les en-têtes CORS, il suffit à rendre
 *    le fichier illisible.
 */
export function createAudio() {
  const element = new Audio();
  element.src = MUSIC.src;
  element.loop = true;
  element.preload = 'auto';
  element.volume = MUSIC.volume;
  element.playsInline = true;

  /** @type {AudioContext|null} */
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let dryGain = null;
  let wetGain = null;
  let shaper = null;
  let routed = false;
  let playing = false;
  let muted = false;

  let rate = MUSIC.rateIdle;
  let crushBits = MUSIC.crushBitsClean;

  /** Secours quand le navigateur refuse le son : l'horloge tourne quand même. */
  let fallbackTime = 0;

  function setPreservesPitch(value) {
    for (const key of ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch']) {
      if (key in element) element[key] = value;
    }
  }
  setPreservesPitch(false);

  /** Courbe de quantification : c'est elle qui « numérise » le morceau. */
  function crushCurve(bits) {
    const levels = Math.pow(2, clamp(bits, 2, 16)) / 2;
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    return curve;
  }

  function buildGraph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });

    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);

    // Le morceau ne traverse le graphe que si la source peut être créée. En
    // cas d'échec, l'élément sonne tout seul : mieux vaut perdre l'effet que
    // le son.
    try {
      const source = ctx.createMediaElementSource(element);

      dryGain = ctx.createGain();
      dryGain.gain.value = 1;

      shaper = ctx.createWaveShaper();
      shaper.curve = crushCurve(crushBits);
      shaper.oversample = 'none';

      const grit = ctx.createBiquadFilter();
      grit.type = 'lowpass';
      grit.frequency.value = 3600;
      grit.Q.value = 0.8;

      wetGain = ctx.createGain();
      wetGain.gain.value = 0;

      source.connect(dryGain).connect(master);
      source.connect(shaper).connect(grit).connect(wetGain).connect(master);
      routed = true;
    } catch {
      routed = false;
    }
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
    get playing() { return playing; },
    get routed() { return routed; },
    get muted() { return muted; },
    get rate() { return rate; },

    /**
     * À appeler **en premier** dans le gestionnaire du geste utilisateur,
     * avant toute attente.
     */
    start() {
      if (!ctx) buildGraph();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      setPreservesPitch(false);
      element.playbackRate = clamp(rate, 0.25, 4);
      const p = element.play();
      if (p && p.then) {
        p.then(() => { playing = true; }).catch(() => { playing = false; });
      } else {
        playing = true;
      }
      return p || Promise.resolve();
    },

    /** Nouvelle tentative, depuis un autre geste, si le premier a été refusé. */
    retry() {
      if (playing) return Promise.resolve(true);
      if (ctx && ctx.state === 'suspended') ctx.resume();
      const p = element.play();
      return (p && p.then ? p : Promise.resolve())
        .then(() => { playing = true; return true; })
        .catch(() => false);
    },

    pause() { element.pause(); playing = false; },
    resume() { if (!muted) this.retry(); },

    toggleMute() {
      muted = !muted;
      element.muted = muted;
      if (master) master.gain.value = muted ? 0 : 1;
      return muted;
    },

    /**
     * Position de lecture, en secondes de média. C'est l'horloge du volet
     * rythmique : elle accélère avec la bande, donc la grille de temps suit
     * la vitesse du bolide sans rien calculer.
     */
    mediaTime() {
      if (playing && element.currentTime > 0) return element.currentTime;
      return fallbackTime;
    },

    /**
     * Cale la vitesse de lecture sur celle du bolide.
     *
     * @param {number} normalized 0 à l'arrêt, 1 à la vitesse maximale
     * @param {number} boost 1 pendant une survitesse
     * @param {number} turbo 1 pendant un turbo
     * @param {number} dt
     */
    setSpeed(normalized, boost, turbo, dt) {
      let target = MUSIC.rateIdle
        + (MUSIC.rateMax - MUSIC.rateIdle) * clamp(normalized, 0, 1);
      if (boost > 0) target += (MUSIC.rateBoost - MUSIC.rateMax) * clamp(boost, 0, 1);
      if (turbo > 0) target += (MUSIC.rateTurbo - MUSIC.rateBoost) * clamp(turbo, 0, 1);

      const k = 1 - Math.exp(-dt / Math.max(0.01, MUSIC.smoothing));
      rate += (target - rate) * k;
      rate = clamp(rate, 0.25, 4);
      if (playing) element.playbackRate = rate;
      fallbackTime += dt * rate;
    },

    /**
     * Numérisation du morceau : plus l'image se corrompt, plus la bande perd
     * de bits. Le changement de courbe n'a lieu qu'au franchissement d'un
     * entier, pour ne pas reconstruire un tableau à chaque image.
     *
     * @param {number} amount 0 = propre, 1 = complètement écrasé
     */
    setCrush(amount) {
      if (!routed) return;
      const a = clamp(amount, 0, 1);
      const bits = Math.round(
        MUSIC.crushBitsClean + (MUSIC.crushBitsDirty - MUSIC.crushBitsClean) * a
      );
      if (bits !== crushBits) {
        crushBits = bits;
        shaper.curve = crushCurve(bits);
      }
      const now = ctx.currentTime;
      wetGain.gain.setTargetAtTime(a * 0.85, now, 0.08);
      dryGain.gain.setTargetAtTime(1 - a * 0.6, now, 0.08);
    },

    /** Note courte des portiques rythmiques. */
    note(freq) {
      if (!ctx) return;
      const t = ctx.currentTime + 0.005;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      o.type = 'square';
      o.frequency.value = freq;
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(5200, t);
      lp.frequency.exponentialRampToValueAtTime(900, t + 0.2);
      envelope(g.gain, t, 0.12, 0.004, 0.17);
      o.connect(lp).connect(g).connect(sfxBus);
      o.start(t);
      o.stop(t + 0.28);
    },

    /** Choc contre un mur ou un adversaire. */
    hit(force = 1) {
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
      envelope(g.gain, t, 0.5 * force, 0.003, 0.26);
      src.connect(bp).connect(g).connect(sfxBus);
      src.start(t);
      src.stop(t + 0.35);

      const thud = ctx.createOscillator();
      const tg = ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(120, t);
      thud.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      envelope(tg.gain, t, 0.65 * force, 0.004, 0.2);
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
      envelope(g.gain, t, 0.32, 0.05, 0.6);
      src.connect(bp).connect(g).connect(sfxBus);
      src.start(t);
      src.stop(t + 0.95);
    },

    /** Turbo au double-appui : plus bas, plus brutal. */
    turbo() {
      if (!ctx) return;
      const t = ctx.currentTime;
      for (const [type, f0, f1, peak] of [
        ['sawtooth', 70, 540, 0.3],
        ['square', 140, 1080, 0.14],
      ]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + 0.42);
        envelope(g.gain, t, peak, 0.02, 0.5);
        o.connect(g).connect(sfxBus);
        o.start(t);
        o.stop(t + 0.7);
      }
    },

    /** Bip du décompte ; `high` pour le départ. */
    beep(high = false) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = high ? 1320 : 660;
      envelope(g.gain, t, 0.2, 0.004, high ? 0.5 : 0.18);
      o.connect(g).connect(sfxBus);
      o.start(t);
      o.stop(t + 0.7);
    },
  };
}
