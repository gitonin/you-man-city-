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

const PHONEMES = {
  a: V(730, 1090, 2440),
  e: V(430, 2050, 2600),
  E: V(610, 1900, 2500),
  i: V(270, 2290, 3010),
  o: V(570, 840, 2410),
  O: V(500, 1000, 2400),
  u: V(300, 870, 2240),
  y: V(290, 1700, 2200),
  2: V(400, 1600, 2300),
  9: V(500, 1400, 2400),
  'A~': N(700, 1100, 2400),
  'O~': N(500, 900, 2300),
  'E~': N(530, 1480, 2500),
  '9~': N(500, 1500, 2400),

  m: N(300, 1100, 2200, 0.085),
  n: N(300, 1700, 2600, 0.085),
  l: V(360, 1300, 2600, 0.07),
  j: V(270, 2200, 3000, 0.05),
  w: V(300, 870, 2240, 0.05),

  f: F(5000, 1.2, 0.085, 0.3),
  v: F(3800, 1.2, 0.07, 0.26),
  s: F(6500, 2.0, 0.1, 0.4),
  z: F(5200, 2.0, 0.08, 0.3),
  S: F(3000, 1.4, 0.1, 0.4),
  R: F(1150, 1.8, 0.075, 0.32),

  p: S(900, 0.42),
  b: S(650, 0.38),
  t: S(3200, 0.5),
  d: S(2500, 0.42),
  k: S(1800, 0.46),
  g: S(1400, 0.38),
};

/** Le vocabulaire de la course, en phonèmes. */
export const WORDS = {
  trois: ['t', 'R', 'w', 'a'],
  deux: ['d', '2'],
  un: ['9~'],
  partez: ['p', 'a', 'R', 't', 'e'],
  tour: ['t', 'u', 'R'],
  dernier: ['d', 'E', 'R', 'n', 'j', 'e'],
  turbo: ['t', 'y', 'R', 'b', 'o'],
  bouclier: ['b', 'u', 'k', 'l', 'i', 'j', 'e'],
  arrivee: ['a', 'R', 'i', 'v', 'e'],
  vainqueur: ['v', 'E~', 'k', '9', 'R'],
  systeme: ['s', 'i', 's', 't', 'E', 'm'],
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
