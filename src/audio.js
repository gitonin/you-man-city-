import { MUSIC } from './config.js';
import { createVoice } from './voice.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * La bande-son, et tout ce qui sonne.
 *
 * **Le morceau est décodé en mémoire et joué par Web Audio**, et non plus lu
 * par un élément `<audio>`. Trois versions ont échoué à faire tenir la lecture
 * à l'accélération, pour trois raisons différentes et cumulées :
 *
 *  - un élément média se nourrit du réseau au débit de l'encodage. Comme la
 *    vitesse de lecture suit celle du bolide, accélérer consomme le fichier
 *    plus vite qu'il n'arrive ; précharger le fichier en `Blob` a réglé ça ;
 *  - les navigateurs coupent le son d'un élément média dont la vitesse sort
 *    de [0.5, 4] ; borner la vitesse a réglé ça ;
 *  - il reste, sur Safari mobile, que `playbackRate` sur un élément média
 *    avec `preservesPitch` désactivé produit des silences à chaque écriture.
 *    Celui-là ne se contourne pas, il se fuit.
 *
 * `AudioBufferSourceNode.playbackRate` n'a aucun de ces défauts : la hauteur
 * suit la vitesse par construction, le changement est échantillon par
 * échantillon, et il n'y a plus de réseau du tout une fois décodé.
 *
 * **Le prix.** Quatre minutes trente-huit en Float32 coûtent une centaine de
 * mégaoctets, d'où le contexte ouvert à 32 kHz quand c'est permis : on perd ce
 * qui est au-dessus de 16 kHz, c'est-à-dire rien d'audible sur un morceau
 * électronique, et on tombe à soixante-dix. Et sur iPhone, l'interrupteur
 * latéral coupe la sortie d'un `AudioContext` : on le neutralise en déclarant
 * une session de type « playback », possible depuis iOS 16.4. Avant ça, le
 * mode silencieux coupe le jeu — c'est le seul recul par rapport à l'élément
 * média, et il est documenté dans le README.
 *
 * @param {object} [o]
 * @param {BaseAudioContext} [o.context] contexte imposé. Sert à rendre la
 *   bande sonore hors ligne pour l'écouter sans lancer le jeu.
 */
export function createAudio({ context = null } = {}) {
  /** @type {AudioContext|null} */
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let spaceSend = null;
  let subBus = null;
  let musicBus = null;
  let voice = null;
  let engine = null;

  /** @type {AudioBuffer|null} le morceau décodé */
  let song = null;
  /** @type {AudioBufferSourceNode|null} */
  let source = null;

  let playing = false;
  let muted = false;
  let failed = false;
  let buffered = false;
  let decoding = false;
  /** Le joueur a demandé le son avant que le morceau soit prêt. */
  let wantsPlay = false;

  let rate = MUSIC.rateIdle;
  let target = MUSIC.rateIdle;
  /** Position de lecture, en secondes de média. C'est l'horloge rythmique. */
  let mediaPos = 0;
  let lastClock = 0;
  let lastDip = 0;

  // ---------------------------------------------------------------- contexte

  /**
   * Déclare au système qu'on joue de la musique, et non un bruitage.
   *
   * Sans ça, Safari range le contexte dans la catégorie « ambient », que
   * l'interrupteur latéral de l'iPhone coupe. C'est exactement ce qui faisait
   * disparaître le son en mode silencieux.
   */
  function claimPlaybackSession() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // propriété absente ou en lecture seule : rien à faire
    }
  }

  /**
   * Ouvre le contexte. Il naît suspendu tant qu'aucun geste n'a eu lieu, ce
   * qui est sans importance : on peut décoder dedans avant même de le
   * réveiller.
   */
  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!context && !AC) return null;

    if (context) {
      ctx = context;
    } else {
      claimPlaybackSession();
      // 32 kHz divise la mémoire du morceau par rapport au 48 kHz natif. Si
      // l'appareil refuse ce taux, on prend ce qu'il propose.
      try {
        ctx = new AC({ sampleRate: MUSIC.sampleRate, latencyHint: 'interactive' });
      } catch {
        ctx = new AC({ latencyHint: 'interactive' });
      }
    }

    buildGraph();
    return ctx;
  }

  function buildGraph() {
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

    // La musique a son propre bus, en amont du limiteur comme le reste : c'est
    // ce qui fait que les bruitages la font « respirer » au lieu de s'y
    // superposer platement.
    musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC.volume;
    musicBus.connect(master);

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
    fb.gain.value = 0.34;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2800;
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
    voiceSpace.gain.value = 0.2;
    voiceBus.connect(voiceSpace).connect(spaceSend);

    voice = createVoice(ctx, voiceBus);
    engine = buildEngine();
  }

  // --------------------------------------------------------------- chargement

  /**
   * Télécharge puis décode le morceau.
   *
   * `onProgress` reçoit un couple (fraction, étape) : le téléchargement
   * compte pour les quatre cinquièmes, le décodage pour le reste. Le décodage
   * d'un MP3 de cinq mégaoctets prend une à trois secondes sur téléphone et ne
   * rend pas la main, d'où l'étape nommée : sans elle la barre reste bloquée à
   * 80 % sans explication.
   *
   * @param {(ratio:number, stage:string) => void} [onProgress]
   * @returns {Promise<boolean>}
   */
  async function load(onProgress) {
    if (buffered) return true;
    if (!ensureCtx()) return false;
    const report = (r, stage) => { if (onProgress) onProgress(clamp(r, 0, 1), stage); };

    try {
      report(0, 'download');
      const res = await fetch(MUSIC.src, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;

      let bytes;
      if (reader) {
        const chunks = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          report(total ? (received / total) * 0.8 : 0.4, 'download');
        }
        bytes = new Uint8Array(received);
        let at = 0;
        for (const c of chunks) { bytes.set(c, at); at += c.length; }
        bytes = bytes.buffer;
      } else {
        bytes = await res.arrayBuffer();
      }

      report(0.8, 'decode');
      decoding = true;
      song = await decode(bytes);
      decoding = false;
      buffered = true;
      report(1, 'ready');

      if (wantsPlay) {
        wantsPlay = false;
        startSource();
      }
      return true;
    } catch (e) {
      decoding = false;
      failed = true;
      report(1, 'failed');
      return false;
    }
  }

  /** `decodeAudioData` est resté longtemps à rappel : on accepte les deux. */
  function decode(bytes) {
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  // ----------------------------------------------------------------- lecture

  /**
   * Lance la source. Elle boucle d'elle-même ; on ne la recrée qu'après un
   * arrêt, un nœud source n'étant jouable qu'une fois.
   */
  function startSource() {
    if (!song || source) return;
    source = ctx.createBufferSource();
    source.buffer = song;
    source.loop = true;
    source.playbackRate.value = rate;
    source.connect(musicBus);
    source.start(0, mediaPos % song.duration);
    lastClock = ctx.currentTime;
    playing = true;
  }

  function stopSource() {
    if (!source) return;
    try { source.stop(); } catch { /* déjà arrêtée */ }
    source.disconnect();
    source = null;
    playing = false;
  }

  // ------------------------------------------------------------------ outils

  /**
   * Écrêtage doux. Les graves très bas ne sortent pas d'un haut-parleur de
   * téléphone : on les sature légèrement pour fabriquer leurs harmoniques, et
   * l'oreille reconstitue la fondamentale qu'elle n'entend pas.
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

  /**
   * Un oscillateur dont la fréquence est elle-même modulée par un autre : la
   * modulation de fréquence fabrique des partiels inharmoniques, ce qu'aucune
   * forme d'onde seule ne donne. C'est elle qui distingue un son de cloche ou
   * de métal d'un simple bip.
   *
   * @returns {OscillatorNode} la porteuse, à démarrer et arrêter par l'appelant
   */
  function fmVoice(t, carrier, ratio, index, stop) {
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = carrier * ratio;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(carrier * index, t);
    depth.gain.exponentialRampToValueAtTime(carrier * index * 0.04, stop);
    mod.connect(depth);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = carrier;
    depth.connect(osc.frequency);

    mod.start(t);
    mod.stop(stop);
    return osc;
  }

  // ----------------------------------------------------------------- réacteur

  /**
   * Le réacteur. Quatre couches plutôt qu'une : la fondamentale sous les
   * cinquante hertz, un corps en dents de scie désaccordées qui donne le
   * battement, une turbine en bruit filtré, et un partiel métallique en
   * modulation de fréquence qui ne sort qu'à haut régime. C'est ce dernier qui
   * fait entendre l'effort plutôt qu'un simple ronflement qui monte.
   */
  function buildEngine() {
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(master);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 2.4;
    lp.connect(out);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 34;
    const subG = ctx.createGain();
    subG.gain.value = 0.1;
    sub.connect(subG).connect(subBus);

    // corps : deux dents de scie désaccordées d'une poignée de cents, dont le
    // battement lent évite le bourdon figé
    const bodyA = ctx.createOscillator();
    const bodyB = ctx.createOscillator();
    bodyA.type = 'sawtooth';
    bodyB.type = 'sawtooth';
    bodyA.detune.value = -9;
    bodyB.detune.value = 11;
    const bodyG = ctx.createGain();
    bodyG.gain.value = 0.08;
    bodyA.connect(bodyG);
    bodyB.connect(bodyG);
    bodyG.connect(lp);

    // turbine
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(2);
    air.loop = true;
    const airBp = ctx.createBiquadFilter();
    airBp.type = 'bandpass';
    airBp.frequency.value = 130;
    airBp.Q.value = 2.6;
    const airG = ctx.createGain();
    airG.gain.value = 0.07;
    air.connect(airBp).connect(airG).connect(lp);

    // partiel métallique : une porteuse modulée dont la profondeur monte avec
    // le régime, routée hors du passe-bas pour qu'elle garde son mordant
    const metalMod = ctx.createOscillator();
    metalMod.type = 'sine';
    metalMod.frequency.value = 212;
    const metalDepth = ctx.createGain();
    metalDepth.gain.value = 0;
    metalMod.connect(metalDepth);
    const metal = ctx.createOscillator();
    metal.type = 'sine';
    metal.frequency.value = 148;
    metalDepth.connect(metal.frequency);
    const metalBp = ctx.createBiquadFilter();
    metalBp.type = 'bandpass';
    metalBp.frequency.value = 1500;
    metalBp.Q.value = 1.4;
    const metalG = ctx.createGain();
    metalG.gain.value = 0.0001;
    metal.connect(metalBp).connect(metalG).connect(out);

    // respiration lente du filtre, pour que le ralenti ne soit pas une tenue
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.23;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 26;
    lfo.connect(lfoDepth).connect(lp.frequency);

    for (const n of [sub, bodyA, bodyB, air, metal, metalMod, lfo]) n.start();

    return { out, lp, sub, bodyA, bodyB, subG, airBp, airG, metal, metalMod, metalDepth, metalG };
  }

  // -------------------------------------------------------------------- API

  return {
    load,
    /** Construit le graphe sans attendre un geste : pour le rendu hors ligne. */
    prime() { ensureCtx(); },

    /**
     * Réveille le contexte sans rien jouer.
     *
     * Un `AudioContext` ne peut reprendre que dans un geste de l'utilisateur,
     * mais une fois vivant il joue quand on le lui demande. On profite donc du
     * tout premier appui pour le réveiller, et la musique ne part qu'au départ
     * d'une course — les menus restent silencieux sans que le son ait à être
     * « débloqué » au moment où on en a besoin.
     */
    unlock() {
      ensureCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    /** Le morceau est-il décodé et prêt ? */
    get buffered() { return buffered; },
    get decoding() { return decoding; },
    /** Conservé pour le panneau de diagnostic : plus de réseau une fois prêt. */
    get starving() { return false; },
    get context() { return ctx; },
    get playing() { return playing; },
    get failed() { return failed; },
    get muted() { return muted; },
    get rate() { return rate; },
    get duration() { return song ? song.duration : 0; },

    /**
     * À appeler **en premier** dans le gestionnaire du geste utilisateur,
     * avant toute attente : une autorisation de capteurs demandée avant ferait
     * perdre le contexte de geste et le son serait refusé.
     */
    start() {
      ensureCtx();
      if (!ctx) return Promise.resolve();
      const resumed = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
      if (!song) {
        wantsPlay = true;
        return resumed;
      }
      return Promise.resolve(resumed).then(() => { startSource(); });
    },

    retry() {
      if (playing) return Promise.resolve(true);
      ensureCtx();
      if (!ctx) return Promise.resolve(false);
      const resumed = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
      return Promise.resolve(resumed).then(() => {
        if (!song) { wantsPlay = true; return false; }
        startSource();
        return playing;
      }).catch(() => false);
    },

    pause() {
      stopSource();
      if (ctx && ctx.suspend) ctx.suspend();
    },

    resume() {
      if (muted) return;
      if (ctx && ctx.state === 'suspended') ctx.resume();
      startSource();
    },

    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 1;
      return muted;
    },

    /**
     * Position de lecture, en secondes de média. C'est l'horloge du volet
     * rythmique : elle avance au rythme de la bande, donc la grille de temps
     * suit la vitesse du bolide sans rien analyser.
     */
    mediaTime() {
      return song ? mediaPos % song.duration : mediaPos;
    },

    /**
     * Cale la vitesse de lecture et le réacteur sur celle du bolide.
     *
     * Le lissage est confié à `setTargetAtTime`, donc à Web Audio, et la
     * position de lecture est intégrée analytiquement sur la même exponentielle
     * — `∫ target + (r₀−target)e^{−s/τ} ds`. Avancer `mediaPos` d'un simple
     * `dt × rate` dériverait de plusieurs dixièmes sur la durée du morceau, et
     * la grille rythmique avec.
     *
     * @param {number} normalized 0 à l'arrêt, 1 à la vitesse maximale
     * @param {number} boost 1 pendant une survitesse
     * @param {number} turbo 1 pendant un turbo
     * @param {number} dt
     */
    setSpeed(normalized, boost, turbo, dt) {
      const n = clamp(normalized, 0, 1.3);
      // Deux segments autour du mi-régime : fort en bas pour que le départ
      // traîne, presque plat en haut pour qu'on ne parte pas dans les aigus.
      const h = clamp(n, 0, 1);
      let want = h < 0.5
        ? MUSIC.rateIdle + (MUSIC.rateMid - MUSIC.rateIdle) * (h / 0.5)
        : MUSIC.rateMid + (MUSIC.rateMax - MUSIC.rateMid) * ((h - 0.5) / 0.5);
      if (boost > 0) want += (MUSIC.rateBoost - MUSIC.rateMax) * clamp(boost, 0, 1);
      if (turbo > 0) want += (MUSIC.rateTurbo - MUSIC.rateBoost) * clamp(turbo, 0, 1);
      target = clamp(want, MUSIC.rateFloor, MUSIC.rateCeiling);

      const tau = Math.max(0.01, MUSIC.smoothing);
      const now = ctx ? ctx.currentTime : 0;
      const step = ctx && playing ? clamp(now - lastClock, 0, 0.25) : dt;
      lastClock = now;

      const decayed = Math.exp(-step / tau);
      mediaPos += target * step + (rate - target) * tau * (1 - decayed);
      rate = target + (rate - target) * decayed;

      if (source) source.playbackRate.setTargetAtTime(target, now, tau);

      if (engine) {
        const f = 30 + n * 58;
        engine.sub.frequency.setTargetAtTime(f, now, 0.12);
        engine.bodyA.frequency.setTargetAtTime(f * 2.02, now, 0.12);
        engine.bodyB.frequency.setTargetAtTime(f * 3.01, now, 0.12);
        engine.lp.frequency.setTargetAtTime(150 + n * 460, now, 0.15);
        engine.airBp.frequency.setTargetAtTime(110 + n * 260, now, 0.15);
        engine.airG.gain.setTargetAtTime(0.05 + n * 0.09, now, 0.2);
        engine.out.gain.setTargetAtTime(0.035 + n * 0.075, now, 0.2);
        engine.subG.gain.setTargetAtTime(0.06 + n * 0.13, now, 0.2);
        // le métal ne se réveille qu'au-delà de la mi-régime
        const bite = Math.max(0, n - 0.45) / 0.55;
        engine.metal.frequency.setTargetAtTime(120 + n * 150, now, 0.15);
        engine.metalMod.frequency.setTargetAtTime(176 + n * 240, now, 0.15);
        engine.metalDepth.gain.setTargetAtTime(bite * 190, now, 0.2);
        engine.metalG.gain.setTargetAtTime(0.0001 + bite * bite * 0.028, now, 0.25);
      }
    },

    /** Coupe le réacteur quand on n'est plus aux commandes. */
    idleEngine() {
      if (!engine) return;
      const t = ctx.currentTime;
      engine.out.gain.setTargetAtTime(0.012, t, 0.4);
      engine.subG.gain.setTargetAtTime(0.03, t, 0.4);
      engine.metalG.gain.setTargetAtTime(0.0001, t, 0.3);
    },

    /**
     * Plongeon de hauteur à l'impact : la bande ralentit d'un coup, puis
     * `setSpeed` la ramène toute seule par son lissage.
     */
    dip(strength = 1) {
      if (!playing || muted || !source) return;
      const now = performance.now();
      if (now - lastDip < 450) return;
      lastDip = now;
      rate = clamp(rate * (1 - 0.4 * clamp(strength, 0, 1)), MUSIC.rateFloor, MUSIC.rateCeiling);
      const t = ctx.currentTime;
      source.playbackRate.cancelScheduledValues(t);
      source.playbackRate.setValueAtTime(rate, t);
    },

    /** L'annonceur. @see voice.js */
    say(word, options) {
      if (!voice) return 0;
      return voice.say(word, options);
    },

    /**
     * Note des portiques rythmiques.
     *
     * Trois dents de scie désaccordées dans un passe-bas résonant qui se
     * referme, une cloche en modulation de fréquence par-dessus pour le grain
     * métallique, et l'octave grave sous la ligne.
     */
    note(freq, when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + 0.005 + when;
      const stop = t + 0.5;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 11;
      lp.frequency.setValueAtTime(freq * 9, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(180, freq * 1.2), t + 0.26);

      const g = ctx.createGain();
      envelope(g.gain, t, 0.12, 0.004, 0.26);
      lp.connect(g);
      g.connect(sfxBus);
      g.connect(spaceSend);

      for (const detune of [-9, 0, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(lp);
        o.start(t);
        o.stop(stop);
      }

      // cloche : rapport non entier, donc partiels inharmoniques
      const bell = fmVoice(t, freq * 2, 1.41, 2.2, stop);
      const bellG = ctx.createGain();
      envelope(bellG.gain, t, 0.05, 0.002, 0.3);
      bell.connect(bellG);
      bellG.connect(sfxBus);
      bellG.connect(spaceSend);
      bell.start(t);
      bell.stop(stop);

      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.value = freq / 2;
      envelope(subG.gain, t, 0.16, 0.006, 0.18);
      sub.connect(subG).connect(subBus);
      sub.start(t);
      sub.stop(t + 0.3);
    },

    /**
     * Choc contre un mur ou un adversaire.
     *
     * Trois composantes : la descente grave qui se sent dans la main, le
     * fracas de tôle en bruit filtré, et trois partiels inharmoniques qui
     * sonnent la coque. Sans ces derniers, un choc n'était qu'un coup sourd.
     */
    hit(force = 1, when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + when;

      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(120, t);
      sub.frequency.exponentialRampToValueAtTime(27, t + 0.22);
      envelope(subG.gain, t, 0.8 * force, 0.004, 0.75);
      sub.connect(subG).connect(subBus);
      sub.start(t);
      sub.stop(t + 1.0);

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.4);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(140, t + 0.3);
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      envelope(g.gain, t, 0.4 * force, 0.003, 0.3);
      src.connect(bp).connect(g);
      g.connect(sfxBus);
      g.connect(spaceSend);
      src.start(t);
      src.stop(t + 0.45);

      // résonance de coque : rapports irrationnels, décroissances inégales
      const ring = ctx.createGain();
      ring.gain.value = 0.085 * force;
      ring.connect(sfxBus);
      ring.connect(spaceSend);
      for (const [mult, decay] of [[1, 0.5], [2.37, 0.36], [3.91, 0.24]]) {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 196 * mult;
        envelope(og.gain, t, 1 / mult, 0.002, decay);
        o.connect(og).connect(ring);
        o.start(t);
        o.stop(t + decay + 0.1);
      }
    },

    /** Plaque de survitesse : montée de bruit, gonflement grave, chirp. */
    boost(when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + when;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.9);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.6;
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(5200, t + 0.5);
      const g = ctx.createGain();
      envelope(g.gain, t, 0.24, 0.05, 0.6);
      src.connect(bp).connect(g);
      g.connect(sfxBus);
      g.connect(spaceSend);
      src.start(t);
      src.stop(t + 0.95);

      const chirp = fmVoice(t, 300, 2.0, 1.1, t + 0.6);
      chirp.frequency.setValueAtTime(300, t);
      chirp.frequency.exponentialRampToValueAtTime(1300, t + 0.42);
      const chirpG = ctx.createGain();
      envelope(chirpG.gain, t, 0.09, 0.03, 0.4);
      chirp.connect(chirpG);
      chirpG.connect(sfxBus);
      chirpG.connect(spaceSend);
      chirp.start(t);
      chirp.stop(t + 0.6);

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

    /** Turbo : aspiration, décrochage de grave, puis la montée. */
    turbo(when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + when;

      // aspiration : du bruit qui enfle à l'envers avant le coup
      const suck = ctx.createBufferSource();
      suck.buffer = noiseBuffer(0.4);
      const suckBp = ctx.createBiquadFilter();
      suckBp.type = 'bandpass';
      suckBp.Q.value = 3.4;
      suckBp.frequency.setValueAtTime(2600, t);
      suckBp.frequency.exponentialRampToValueAtTime(420, t + 0.3);
      const suckG = ctx.createGain();
      suckG.gain.setValueAtTime(0.0001, t);
      suckG.gain.exponentialRampToValueAtTime(0.2, t + 0.28);
      suckG.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
      suck.connect(suckBp).connect(suckG).connect(sfxBus);
      suck.start(t);
      suck.stop(t + 0.42);

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
      lp.Q.value = 12;
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(3600, t + 0.4);
      envelope(sweepG.gain, t, 0.2, 0.02, 0.5);
      sweep.connect(lp).connect(sweepG);
      sweepG.connect(sfxBus);
      sweepG.connect(spaceSend);
      sweep.start(t);
      sweep.stop(t + 0.75);
    },

    /**
     * Le tonnerre, pour les circuits sous l'averse.
     *
     * Un éclair lointain n'est pas un claquement mais une traîne : du bruit
     * très filtré dont l'enveloppe s'étale sur plusieurs secondes, une masse
     * grave qui roule dessous, et — seulement quand l'éclair est proche — le
     * craquement sec en tête.
     *
     * @param {number} distance 0 = sur la piste, 1 = à l'horizon
     */
    thunder(distance = 0.5, when = 0) {
      if (!ctx) return;
      const t = ctx.currentTime + when;
      const near = 1 - clamp(distance, 0, 1);
      const length = 1.6 + distance * 2.8;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(length + 0.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(200 + near * 2600, t);
      lp.frequency.exponentialRampToValueAtTime(90 + near * 200, t + length);
      lp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1 + near * 0.3, t + 0.05 + distance * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + length);
      src.connect(lp).connect(g);
      g.connect(sfxBus);
      g.connect(spaceSend);
      src.start(t);
      src.stop(t + length + 0.3);

      // le roulement, dans le bus des graves
      const roll = ctx.createOscillator();
      const rollG = ctx.createGain();
      roll.type = 'sine';
      roll.frequency.setValueAtTime(58 - distance * 20, t);
      roll.frequency.exponentialRampToValueAtTime(24, t + length * 0.8);
      envelope(rollG.gain, t, 0.3 + near * 0.5, 0.08 + distance * 0.3, length * 0.9);
      roll.connect(rollG).connect(subBus);
      roll.start(t);
      roll.stop(t + length + 0.2);

      if (near > 0.5) {
        const crack = ctx.createBufferSource();
        crack.buffer = noiseBuffer(0.12);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2200;
        const cg = ctx.createGain();
        envelope(cg.gain, t, (near - 0.5) * 0.6, 0.001, 0.1);
        crack.connect(hp).connect(cg).connect(sfxBus);
        crack.start(t);
        crack.stop(t + 0.16);
      }
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
