/**
 * L'annonceur : une voix entièrement synthétisée, sans fichier son.
 *
 * Le principe est celui des synthétiseurs vocaux d'époque. Une source
 * périodique — ici une dent de scie à hauteur fixe, d'où le timbre de robot —
 * traverse trois filtres passe-bande en parallèle réglés sur les **formants**,
 * ces résonances du conduit vocal qui font qu'on entend un « a » plutôt qu'un
 * « i ». On fait glisser les trois fréquences d'un phonème au suivant, on
 * remplace la source par du bruit pour les sifflantes, on coupe net pour les
 * occlusives, et la parole apparaît.
 *
 * Aucune dépendance à la synthèse vocale du navigateur : elle n'est pas
 * routable dans Web Audio, varie d'un appareil à l'autre, et ne sonnerait pas
 * du tout comme la machine qu'on imite.
 */

/** Voyelle : trois formants, en hertz. */
const V = (f1, f2, f3, d = 0.125) => ({ kind: 'voiced', f: [f1, f2, f3], d, nasal: 0 });
/** Nasale : mêmes formants, mais les aigus sont étouffés. */
const N = (f1, f2, f3, d = 0.1) => ({ kind: 'voiced', f: [f1, f2, f3], d, nasal: 1 });
/** Constrictive : du bruit filtré. */
const F = (freq, q, d, amp) => ({ kind: 'fric', freq, q, d, amp });
/** Occlusive : un silence, puis une détente brève. */
const S = (freq, amp, gap = 0.035) => ({ kind: 'stop', freq, amp, gap, d: 0.03 });

/**
 * Les formants de l'anglais américain, d'après les mesures classiques de
 * Peterson et Barney. Les diphtongues ne sont pas listées : on les écrit comme
 * deux voyelles d'affilée, et le glissement entre phonèmes les produit tout
 * seul — c'est précisément ce qu'est une diphtongue.
 */
const PHONEMES = {
  // voyelles
  i: V(270, 2290, 3010), // fleece
  I: V(390, 1990, 2550), // kit
  E: V(530, 1840, 2480), // dress
  a: V(660, 1720, 2410), // trap
  A: V(730, 1090, 2440), // lot
  O: V(570, 840, 2410), // thought
  U: V(440, 1020, 2240), // foot
  u: V(300, 870, 2240), // goose
  V: V(640, 1190, 2390), // strut
  // schwa, et sa version colorée par le r : c'est le troisième formant qui
  // s'effondre qui fait entendre le r américain
  '@': V(500, 1500, 2500, 0.07),
  R: V(490, 1350, 1690, 0.11),

  // sonantes
  m: N(300, 1100, 2200, 0.085),
  n: N(300, 1700, 2600, 0.085),
  N: N(300, 1900, 2400, 0.09), // -ng
  l: V(360, 1300, 2600, 0.075),
  j: V(270, 2200, 3000, 0.05), // y-
  w: V(300, 870, 2240, 0.05),
  r: V(420, 1150, 1600, 0.06),

  // constrictives
  f: F(5000, 1.2, 0.085, 0.3),
  v: F(3800, 1.2, 0.07, 0.24),
  T: F(5600, 0.9, 0.08, 0.2), // th sourd
  D: F(3400, 0.9, 0.065, 0.2), // th sonore
  s: F(6500, 2.0, 0.1, 0.4),
  z: F(5200, 2.0, 0.08, 0.3),
  S: F(2800, 1.4, 0.105, 0.42), // sh
  h: F(1400, 0.7, 0.06, 0.18),

  // occlusives
  p: S(900, 0.42),
  b: S(650, 0.36),
  t: S(3200, 0.5),
  d: S(2500, 0.42),
  k: S(1800, 0.46),
  g: S(1400, 0.36),
};

/**
 * Le vocabulaire de la course, en phonèmes.
 *
 * En anglais : c'est la langue des annonceurs de ce genre de jeu, et les
 * formants anglais se tiennent mieux à ce débit que les voyelles nasales du
 * français, qui demandaient d'étouffer deux formants sur trois.
 */
export const WORDS = {
  three: ['T', 'r', 'i'],
  two: ['t', 'u'],
  one: ['w', 'V', 'n'],
  go: ['g', 'O', 'U'],
  lap: ['l', 'a', 'p'],
  final: ['f', 'a', 'I', 'n', '@', 'l'],
  turbo: ['t', 'R', 'b', 'O', 'U'],
  shield: ['S', 'i', 'l', 'd'],
  boost: ['b', 'u', 's', 't'],
  finish: ['f', 'I', 'n', 'I', 'S'],
  winner: ['w', 'I', 'n', 'R'],
  warning: ['w', 'O', 'r', 'n', 'I', 'N'],
  systems: ['s', 'I', 's', 't', '@', 'm', 'z'],
};

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} destination
 */
export function createVoice(ctx, destination) {
  const noiseBuffer = (() => {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  })();

  /**
   * Dit un mot.
   *
   * @param {string} word clé de `WORDS`
   * @param {object} [o]
   * @param {number} [o.pitch] hauteur de la source, en hertz
   * @param {number} [o.rate]  débit ; > 1 accélère
   * @param {number} [o.level] volume
   * @param {number} [o.ring]  modulation en anneau, 0 à 1 : le grain numérique
   * @param {number} [o.when]  retard, en secondes
   */
  function say(word, { pitch = 104, rate = 1, level = 1, ring = 0.34, when = 0 } = {}) {
    const seq = WORDS[word];
    if (!seq) return 0;
    const t0 = ctx.currentTime + 0.02 + when;

    const out = ctx.createGain();
    out.gain.value = level * 0.9;

    // Modulation en anneau : une part du signal est multipliée par une sinusoïde
    // grave. C'est elle qui donne le timbre « machine » sans rendre le mot
    // inintelligible, tant qu'on en garde moins de la moitié.
    const dry = ctx.createGain();
    dry.gain.value = 1 - ring;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    const modOsc = ctx.createOscillator();
    modOsc.type = 'sine';
    modOsc.frequency.value = 74;
    const modDepth = ctx.createGain();
    modDepth.gain.value = ring;
    modOsc.connect(modDepth).connect(wet.gain);

    const mix = ctx.createGain();
    mix.connect(dry).connect(out);
    mix.connect(wet).connect(out);
    out.connect(destination);

    // source périodique → trois formants en parallèle
    const glottis = ctx.createOscillator();
    glottis.type = 'sawtooth';
    glottis.frequency.value = pitch;
    const voiced = ctx.createGain();
    voiced.gain.value = 0.0001;
    glottis.connect(voiced);

    const bands = [];
    const bandGains = [];
    for (let k = 0; k < 3; k++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = [9, 11, 13][k];
      bp.frequency.value = [700, 1100, 2400][k];
      const g = ctx.createGain();
      g.gain.value = [1, 0.62, 0.32][k];
      voiced.connect(bp).connect(g).connect(mix);
      bands.push(bp);
      bandGains.push(g);
    }

    // bruit, pour les constrictives et les détentes
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseBp = ctx.createBiquadFilter();
    noiseBp.type = 'bandpass';
    noiseBp.frequency.value = 3000;
    noiseBp.Q.value = 1.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.0001;
    noise.connect(noiseBp).connect(noiseGain).connect(mix);

    let t = t0;
    const glide = 0.028;

    for (const key of seq) {
      const ph = PHONEMES[key];
      if (!ph) continue;
      const d = ph.d / rate;

      if (ph.kind === 'voiced') {
        for (let k = 0; k < 3; k++) {
          bands[k].frequency.setTargetAtTime(ph.f[k], t, glide);
          // une nasale perd ses aigus : c'est ce qui la distingue d'une voyelle
          bandGains[k].gain.setTargetAtTime(
            [1, 0.62, 0.32][k] * (ph.nasal ? [1, 0.4, 0.14][k] : 1), t, glide
          );
        }
        voiced.gain.setTargetAtTime(0.5, t, 0.012);
        noiseGain.gain.setTargetAtTime(0.0001, t, 0.012);
      } else if (ph.kind === 'fric') {
        noiseBp.frequency.setTargetAtTime(ph.freq, t, 0.01);
        noiseBp.Q.setTargetAtTime(ph.q, t, 0.01);
        noiseGain.gain.setTargetAtTime(ph.amp, t, 0.012);
        voiced.gain.setTargetAtTime(0.06, t, 0.012);
      } else {
        // occlusive : on ferme, puis on relâche d'un coup
        voiced.gain.setTargetAtTime(0.0001, t, 0.006);
        noiseGain.gain.setTargetAtTime(0.0001, t, 0.006);
        const burst = t + ph.gap / rate;
        noiseBp.frequency.setValueAtTime(ph.freq, burst);
        noiseBp.Q.setValueAtTime(1.1, burst);
        noiseGain.gain.setValueAtTime(ph.amp, burst);
        noiseGain.gain.setTargetAtTime(0.0001, burst + 0.012, 0.016);
        t += ph.gap / rate;
      }
      t += d;
    }

    // chute finale
    const end = t + 0.06;
    voiced.gain.setTargetAtTime(0.0001, t, 0.03);
    noiseGain.gain.setTargetAtTime(0.0001, t, 0.03);
    out.gain.setTargetAtTime(0.0001, t + 0.02, 0.04);

    glottis.start(t0);
    noise.start(t0);
    modOsc.start(t0);
    glottis.stop(end + 0.2);
    noise.stop(end + 0.2);
    modOsc.stop(end + 0.2);

    return end - ctx.currentTime;
  }

  return { say, words: Object.keys(WORDS) };
}
