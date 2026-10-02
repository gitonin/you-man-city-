import { MUSIC } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * La bande-son, et tout ce qui sonne.
 *
 * **Le morceau sort en direct par l'élément `<audio>`, sans passer par Web
 * Audio.** C'est délibéré, et c'est ce qui corrige le « je n'entends rien »
 * sur téléphone :
 *
 *  - sur iPhone, le petit interrupteur latéral coupe la sortie d'un
 *    `AudioContext` mais pas celle d'un élément média. Router la musique dans
 *    le graphe — ce que faisait la version précédente pour la numériser — la
 *    faisait donc disparaître dès que l'appareil était en mode silencieux ;
 *  - `createMediaElementSource` est à sens unique : une fois l'élément happé
 *    par le graphe, on ne peut plus le rebrancher sur les haut-parleurs. Mieux
 *    vaut ne jamais l'y mettre ;
 *  - changer `playbackRate` sur un élément routé déclenche en prime des coupures
 *    sur plusieurs navigateurs mobiles.
 *
 * Web Audio ne sert donc qu'aux bruitages. Si l'appareil est en silencieux, on
 * perd les bruitages — pas la musique.
 *
 * La « numérisation » du morceau se fait autrement : la hauteur suit la vitesse
 * (`preservesPitch` désactivé, effet bande magnétique), et un choc fait bégayer
 * la lecture d'un court saut en arrière.
 */
export function createAudio() {
  const element = new Audio();
  element.src = MUSIC.src;
  element.loop = true;
  element.preload = 'auto';
  element.volume = MUSIC.volume; // ignoré sur iOS, sans conséquence
  element.playsInline = true;

  /** @type {AudioContext|null} contexte réservé aux bruitages */
  let ctx = null;
  let sfxBus = null;

  let playing = false;
  let muted = false;
  let failed = false;
  let rate = MUSIC.rateIdle;
  let lastDip = 0;
  /** Horloge de secours quand le navigateur refuse la lecture. */
  let fallbackTime = 0;

  function setPreservesPitch(value) {
    for (const key of ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch']) {
      if (key in element) element[key] = value;
    }
  }
  setPreservesPitch(false);

  element.addEventListener('playing', () => { playing = true; failed = false; });
  element.addEventListener('pause', () => { playing = false; });
  element.addEventListener('error', () => { failed = true; playing = false; });

  /** Le contexte des bruitages n'est créé qu'au premier geste. */
  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    sfxBus = ctx.createGain();
    sfxBus.gain.value = muted ? 0 : 0.9;
    sfxBus.connect(ctx.destination);
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
    get failed() { return failed; },
    get muted() { return muted; },
    get rate() { return rate; },

    /**
     * À appeler **en premier** dans le gestionnaire du geste utilisateur,
     * avant toute attente : une autorisation de capteurs demandée avant ferait
     * perdre le contexte de geste et le son serait refusé.
     */
    start() {
      ensureCtx();
      setPreservesPitch(false);
      element.playbackRate = clamp(rate, 0.25, 4);
      const p = element.play();
      if (p && p.then) p.then(() => { playing = true; }).catch(() => { playing = false; });
      else playing = true;
      return p || Promise.resolve();
    },

    /** Nouvelle tentative, depuis un autre geste, si la première a été refusée. */
    retry() {
      if (playing) return Promise.resolve(true);
      ensureCtx();
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
      if (sfxBus) sfxBus.gain.value = muted ? 0 : 0.9;
      return muted;
    },

    /**
     * Position de lecture, en secondes de média. C'est l'horloge du volet
     * rythmique : elle accélère avec la bande, donc la grille de temps suit la
     * vitesse du bolide sans rien calculer.
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
      if (playing) {
        // on n'écrit que si ça bouge vraiment : certains navigateurs mobiles
        // hoquettent si on repose la valeur à chaque image
        if (Math.abs(element.playbackRate - rate) > 0.004) element.playbackRate = rate;
      }
      fallbackTime += dt * rate;
    },

    /**
     * Plongeon de hauteur à l'impact : la bande ralentit d'un coup, puis
     * `setSpeed` la ramène toute seule par son lissage.
     *
     * On avait d'abord essayé un bégaiement par repositionnement de la
     * lecture. Mauvaise idée : un serveur qui ne gère pas les requêtes par
     * plage — `python -m http.server`, par exemple — ne sait pas repositionner
     * un média, et la lecture repartait du début. Jouer sur la vitesse ne
     * dépend, lui, de rien.
     */
    dip(strength = 1) {
      if (!playing || muted) return;
      const now = performance.now();
      if (now - lastDip < 450) return;
      lastDip = now;
      rate = clamp(rate * (1 - 0.4 * clamp(strength, 0, 1)), 0.25, 4);
      element.playbackRate = rate;
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
