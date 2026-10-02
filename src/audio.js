import { MUSIC } from './config.js';
import { createVoice } from './voice.js';

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
 *    le graphe la faisait donc disparaître en mode silencieux ;
 *  - `createMediaElementSource` est à sens unique : une fois l'élément happé
 *    par le graphe, on ne peut plus le rebrancher sur les haut-parleurs ;
 *  - changer `playbackRate` sur un élément routé déclenche en prime des
 *    coupures sur plusieurs navigateurs mobiles.
 *
 * Web Audio ne sert donc qu'aux bruitages, au grondement du réacteur et à
 * l'annonceur. Appareil en silencieux : on perd ça, pas la musique.
 */
/**
 * @param {object} [o]
 * @param {BaseAudioContext} [o.context] contexte imposé. Sert à rendre la
 *   bande sonore hors ligne pour l'écouter sans lancer le jeu : passer un
 *   `OfflineAudioContext` suffit, tous les nœuds utilisés y fonctionnent.
 */
export function createAudio({ context = null } = {}) {
  const element = new Audio();
  // La source n'est posée qu'une fois le morceau en mémoire (ou le
  // préchargement échoué). La poser ici ferait télécharger le fichier deux
  // fois : une pour le flux, une pour le `fetch`.
  element.loop = true;
  element.preload = 'auto';
  element.volume = MUSIC.volume; // ignoré sur iOS, sans conséquence
  element.playsInline = true;

  /** @type {AudioContext|null} contexte réservé à tout sauf la musique */
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let spaceSend = null;
  let subBus = null;
  let voice = null;
  let engine = null;

  let playing = false;
  let muted = false;
  let failed = false;
  /** Le morceau tient-il entièrement en mémoire ? */
  let buffered = false;
  let objectUrl = null;
  /** Vrai quand la lecture s'est arrêtée faute de données. */
  let starving = false;
  /** Le joueur a demandé le son avant que la source soit prête. */
  let wantsPlay = false;
  let sourceReady = false;
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

  element.addEventListener('playing', () => { playing = true; failed = false; starving = false; });
  element.addEventListener('pause', () => { playing = false; });
  element.addEventListener('error', () => { failed = true; playing = false; });
  // `waiting` est l'aveu du navigateur : il n'a plus de quoi jouer.
  element.addEventListener('waiting', () => { starving = true; });
  element.addEventListener('canplaythrough', () => { starving = false; });

  /**
   * Charge tout le morceau en mémoire, puis bascule l'élément dessus.
   *
   * Sans ça, la lecture se nourrit du réseau au fil de l'eau — et comme la
   * vitesse de lecture suit celle du bolide, accélérer fait consommer le
   * fichier plus vite qu'il n'arrive. Mesuré sur une connexion à 144 kb/s avec
   * un morceau encodé à 160 : à ×0,68 la lecture avance normalement, à ×1,5
   * elle n'avance plus que de 5,4 s en 8 s, c'est-à-dire qu'elle s'interrompt
   * en permanence. Cinq mégaoctets en mémoire valent mieux que ça.
   *
   * @param {(ratio:number) => void} [onProgress]
   * @returns {Promise<boolean>} faux si on reste sur la lecture au fil de l'eau
   */
  async function load(onProgress) {
    if (buffered) return true;
    try {
      const res = await fetch(MUSIC.src, { cache: 'force-cache' });
      if (!res.ok) throw new Error(String(res.status));

      const total = Number(res.headers.get('content-length')) || 0;
      let blob;
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (reader) {
        const chunks = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (onProgress) onProgress(total ? received / total : 0);
        }
        blob = new Blob(chunks, { type: 'audio/mpeg' });
      } else {
        blob = await res.blob();
      }

      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
      buffered = true;
      if (onProgress) onProgress(1);
      return true;
    } catch {
      // réseau capricieux ou `fetch` interdit : on retombe sur le flux direct,
      // qui marche tant qu'on n'accélère pas trop
      buffered = false;
      setSource(MUSIC.src);
      return false;
    }
  }

  /** Pose la source et rattrape une demande de lecture arrivée trop tôt. */
  function setSource(url) {
    element.src = url;
    element.load();
    sourceReady = true;
    if (wantsPlay) {
      wantsPlay = false;
      element.play().then(() => { playing = true; }).catch(() => { playing = false; });
    }
  }

  /**
   * Écrêtage doux. Les graves très bas ne sortent pas d'un haut-parleur de
   * téléphone : on les sature légèrement pour fabriquer leurs harmoniques, et
   * l'oreille reconstitue la fondamentale qu'elle n'entend pas. C'est ce qui
   * fait qu'un impact à 30 Hz s'entend quand même dans la main.
   */
  function saturationCurve(drive = 2.2) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
  }

  function noiseBuffer(seconds) {
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

  /** Grondement de réacteur : la fondation grave, pilotée par la vitesse. */
  function buildEngine() {
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(master);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 0.8;
    lp.connect(out);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 34;
    const subG = ctx.createGain();
    subG.gain.value = 0.1;
    sub.connect(subG).connect(subBus);

    const body = ctx.createOscillator();
    body.type = 'sawtooth';
    body.frequency.value = 68;
    const bodyG = ctx.createGain();
    bodyG.gain.value = 0.14;
    body.connect(bodyG).connect(lp);

    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(2);
    air.loop = true;
    const airBp = ctx.createBiquadFilter();
    airBp.type = 'bandpass';
    airBp.frequency.value = 130;
    airBp.Q.value = 1.1;
    const airG = ctx.createGain();
    airG.gain.value = 0.07;
    air.connect(airBp).connect(airG).connect(lp);

    sub.start();
    body.start();
    air.start();

    return { out, lp, sub, body, subG, airBp };
  }

  /** Le contexte n'est créé qu'au premier geste. */
  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!context && !AC) return;
    ctx = context || new AC({ latencyHint: 'interactive' });

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;

    // Limiteur de sortie. Sans lui, un impact grave saturé plus le réacteur
    // suffisaient à écrêter la moitié des échantillons — mesuré sur un rendu
    // hors ligne : plus rien d'autre ne passait.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.14;
    master.connect(limiter).connect(ctx.destination);

    // Bus des graves. Le gain d'entrée est délibérément bas : la saturation
    // doit mordre sur les transitoires, pas sur le ronflement continu.
    const saturator = ctx.createWaveShaper();
    saturator.curve = saturationCurve();
    saturator.oversample = '2x';
    const subLp = ctx.createBiquadFilter();
    subLp.type = 'lowpass';
    subLp.frequency.value = 240;
    const subOut = ctx.createGain();
    subOut.gain.value = 0.55;
    subBus = ctx.createGain();
    subBus.gain.value = 0.42;
    subBus.connect(saturator).connect(subLp).connect(subOut).connect(master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.95;
    sfxBus.connect(master);

    // un delay court donne de l'espace sans réverbération coûteuse
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.21;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    delay.connect(damp).connect(fb).connect(delay);
    const spaceOut = ctx.createGain();
    spaceOut.gain.value = 0.3;
    delay.connect(spaceOut).connect(master);
    spaceSend = ctx.createGain();
    spaceSend.connect(delay);

    const voiceBus = ctx.createGain();
    voiceBus.gain.value = 1.5;
    voiceBus.connect(master);
    const voiceSpace = ctx.createGain();
    voiceSpace.gain.value = 0.16;
    voiceBus.connect(voiceSpace).connect(spaceSend);

    voice = createVoice(ctx, voiceBus);
    engine = buildEngine();
  }

  return {
    element,
    load,
    /** Construit le graphe sans attendre un geste : pour le rendu hors ligne. */
    prime() { ensureCtx(); },
    /** Le morceau est-il entièrement en mémoire ? */
    get buffered() { return buffered; },
    /** La lecture manque-t-elle de données en ce moment ? */
    get starving() { return starving; },
    get context() { return ctx; },
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
      if (!sourceReady) {
        // le morceau n'est pas encore là : on note l'intention, `setSource`
        // la rattrapera
        wantsPlay = true;
        return Promise.resolve();
      }
      element.playbackRate = clamp(rate, MUSIC.rateFloor, MUSIC.rateCeiling);
      const p = element.play();
      if (p && p.then) p.then(() => { playing = true; }).catch(() => { playing = false; });
      else playing = true;
      return p || Promise.resolve();
    },

    retry() {
      if (playing) return Promise.resolve(true);
      ensureCtx();
      if (!sourceReady) { wantsPlay = true; return Promise.resolve(false); }
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
     * rythmique : elle accélère avec la bande, donc la grille de temps suit la
     * vitesse du bolide sans rien calculer.
     */
    mediaTime() {
      if (playing && element.currentTime > 0) return element.currentTime;
      return fallbackTime;
    },

    /**
     * Cale la vitesse de lecture et le réacteur sur celle du bolide.
     *
     * @param {number} normalized 0 à l'arrêt, 1 à la vitesse maximale
     * @param {number} boost 1 pendant une survitesse
     * @param {number} turbo 1 pendant un turbo
     * @param {number} dt
     */
    setSpeed(normalized, boost, turbo, dt) {
      const n = clamp(normalized, 0, 1.3);
      let target = MUSIC.rateIdle + (MUSIC.rateMax - MUSIC.rateIdle) * clamp(n, 0, 1);
      if (boost > 0) target += (MUSIC.rateBoost - MUSIC.rateMax) * clamp(boost, 0, 1);
      if (turbo > 0) target += (MUSIC.rateTurbo - MUSIC.rateBoost) * clamp(turbo, 0, 1);

      const k = 1 - Math.exp(-dt / Math.max(0.01, MUSIC.smoothing));
      rate += (target - rate) * k;
      rate = clamp(rate, MUSIC.rateFloor, MUSIC.rateCeiling);
      if (playing) {
        // on n'écrit que si ça bouge vraiment : certains navigateurs mobiles
        // hoquettent si on repose la valeur à chaque image
        if (Math.abs(element.playbackRate - rate) > 0.004) element.playbackRate = rate;
      }
      fallbackTime += dt * rate;

      if (engine) {
        const t = ctx.currentTime;
        const f = 30 + n * 58;
        engine.sub.frequency.setTargetAtTime(f, t, 0.12);
        engine.body.frequency.setTargetAtTime(f * 2.02, t, 0.12);
        engine.lp.frequency.setTargetAtTime(150 + n * 420, t, 0.15);
        engine.airBp.frequency.setTargetAtTime(110 + n * 220, t, 0.15);
        engine.out.gain.setTargetAtTime(0.035 + n * 0.075, t, 0.2);
        engine.subG.gain.setTargetAtTime(0.06 + n * 0.13, t, 0.2);
      }
    },

    /** Coupe le réacteur quand on n'est plus aux commandes. */
    idleEngine() {
      if (!engine) return;
      engine.out.gain.setTargetAtTime(0.012, ctx.currentTime, 0.4);
      engine.subG.gain.setTargetAtTime(0.03, ctx.currentTime, 0.4);
    },

    /**
     * Plongeon de hauteur à l'impact : la bande ralentit d'un coup, puis
     * `setSpeed` la ramène toute seule par son lissage.
     */
    dip(strength = 1) {
      if (!playing || muted) return;
      const now = performance.now();
      if (now - lastDip < 450) return;
      lastDip = now;
      rate = clamp(rate * (1 - 0.4 * clamp(strength, 0, 1)), MUSIC.rateFloor, MUSIC.rateCeiling);
      element.playbackRate = rate;
    },

    /** L'annonceur. @see voice.js */
    say(word, options) {
      if (!voice) return 0;
      return voice.say(word, options);
    },

    /**
     * Note des portiques rythmiques : un pincement filtré plutôt qu'un bip
     * carré, avec son octave grave sous la ligne.
     */
    note(freq, when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + 0.005 + when;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 7;
      lp.frequency.setValueAtTime(freq * 7, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(180, freq * 1.3), t + 0.2);

      const g = ctx.createGain();
      envelope(g.gain, t, 0.13, 0.005, 0.22);
      lp.connect(g);
      g.connect(sfxBus);
      g.connect(spaceSend);

      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(lp);
        o.start(t);
        o.stop(t + 0.32);
      }

      // octave grave, envoyée au bus des graves
      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.value = freq / 2;
      envelope(subG.gain, t, 0.16, 0.006, 0.18);
      sub.connect(subG).connect(subBus);
      sub.start(t);
      sub.stop(t + 0.3);
    },

    /** Choc contre un mur ou un adversaire : un vrai coup dans le ventre. */
    hit(force = 1, when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + when;

      // le grave : descente profonde, longue traîne, saturée pour s'entendre
      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(120, t);
      sub.frequency.exponentialRampToValueAtTime(27, t + 0.22);
      envelope(subG.gain, t, 0.8 * force, 0.004, 0.75);
      sub.connect(subG).connect(subBus);
      sub.start(t);
      sub.stop(t + 1.0);

      // la tôle : du bruit sombre, pas un crissement aigu
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.4);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(140, t + 0.3);
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      envelope(g.gain, t, 0.42 * force, 0.003, 0.3);
      src.connect(bp).connect(g);
      g.connect(sfxBus);
      g.connect(spaceSend);
      src.start(t);
      src.stop(t + 0.45);
    },

    /** Plaque de survitesse : montée, avec un gonflement grave dessous. */
    boost(when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + when;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.9);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.2;
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(4200, t + 0.5);
      const g = ctx.createGain();
      envelope(g.gain, t, 0.26, 0.05, 0.6);
      src.connect(bp).connect(g);
      g.connect(sfxBus);
      g.connect(spaceSend);
      src.start(t);
      src.stop(t + 0.95);

      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(44, t);
      sub.frequency.exponentialRampToValueAtTime(78, t + 0.45);
      envelope(subG.gain, t, 0.5, 0.08, 0.45);
      sub.connect(subG).connect(subBus);
      sub.start(t);
      sub.stop(t + 0.7);
    },

    /** Turbo : un décrochage de grave, puis la montée. */
    turbo(when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + when;

      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(90, t);
      sub.frequency.exponentialRampToValueAtTime(24, t + 0.16);
      sub.frequency.exponentialRampToValueAtTime(62, t + 0.55);
      envelope(subG.gain, t, 0.9, 0.006, 0.75);
      sub.connect(subG).connect(subBus);
      sub.start(t);
      sub.stop(t + 1.0);

      const sweep = ctx.createOscillator();
      const sweepG = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      sweep.type = 'sawtooth';
      sweep.frequency.setValueAtTime(58, t);
      sweep.frequency.exponentialRampToValueAtTime(430, t + 0.45);
      lp.type = 'lowpass';
      lp.Q.value = 9;
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(3200, t + 0.4);
      envelope(sweepG.gain, t, 0.2, 0.02, 0.5);
      sweep.connect(lp).connect(sweepG);
      sweepG.connect(sfxBus);
      sweepG.connect(spaceSend);
      sweep.start(t);
      sweep.stop(t + 0.75);
    },

    /**
     * Repère du décompte : un coup sourd, pas un bip. `high` marque le départ
     * et monte d'une quinte.
     */
    tick(high = false, when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + when;

      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(high ? 110 : 76, t);
      sub.frequency.exponentialRampToValueAtTime(high ? 48 : 36, t + 0.18);
      envelope(subG.gain, t, high ? 0.75 : 0.5, 0.004, high ? 0.6 : 0.34);
      sub.connect(subG).connect(subBus);
      sub.start(t);
      sub.stop(t + 0.8);

      const click = ctx.createBufferSource();
      click.buffer = noiseBuffer(0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      const cg = ctx.createGain();
      envelope(cg.gain, t, 0.1, 0.001, 0.04);
      click.connect(hp).connect(cg).connect(sfxBus);
      click.start(t);
      click.stop(t + 0.08);
    },
  };
}
