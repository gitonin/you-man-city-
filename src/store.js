const KEY = 'youman.reborn.v1';

const EMPTY = { scores: {}, settings: { invert: false, sensitivity: 1, sound: true } };

/**
 * Meilleurs temps et préférences, gardés dans le navigateur.
 *
 * Toute lecture ou écriture passe par un try/catch : en navigation privée,
 * avec les données de site bloquées, ou dans une prévisualisation, l'accès
 * au stockage lève. Le jeu doit continuer sans — on perd les records, pas la
 * partie.
 */
export function createStore() {
  let data = structuredClone(EMPTY);

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      data = {
        scores: parsed.scores && typeof parsed.scores === 'object' ? parsed.scores : {},
        settings: { ...EMPTY.settings, ...(parsed.settings || {}) },
      };
    }
  } catch {
    // on garde les valeurs par défaut
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // rien à faire : la partie en cours n'en dépend pas
    }
  }

  return {
    get settings() { return data.settings; },

    setSetting(key, value) {
      data.settings[key] = value;
      save();
    },

    /** @returns {{total:number, lap:number, rank:number}|null} */
    best(trackId) {
      return data.scores[trackId] || null;
    },

    /**
     * Enregistre une course si elle améliore quelque chose.
     * @returns {{total:boolean, lap:boolean}} ce qui a été battu
     */
    record(trackId, { total, lap, rank }) {
      const prev = data.scores[trackId];
      const beatTotal = !prev || total < prev.total;
      const beatLap = !prev || !prev.lap || (lap > 0 && lap < prev.lap);
      data.scores[trackId] = {
        total: beatTotal ? total : prev.total,
        lap: beatLap && lap > 0 ? lap : (prev ? prev.lap : lap),
        rank: beatTotal ? rank : prev.rank,
      };
      save();
      return { total: beatTotal, lap: beatLap };
    },

    wipe() {
      data.scores = {};
      save();
    },
  };
}
