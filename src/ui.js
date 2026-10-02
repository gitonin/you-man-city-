import { THEMES } from './themes.js';

const $ = (id) => document.getElementById(id);

export const formatTime = (seconds) => {
  if (!seconds) return '—';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const SENSITIVITY = [
  { label: 'douce', range: 34 },
  { label: 'moyenne', range: 26 },
  { label: 'vive', range: 19 },
];

/**
 * Les écrans : titre, circuits, scores, contrôles, pause, arrivée.
 *
 * Cette couche ne connaît rien du jeu. Elle affiche, elle écoute, et elle
 * rappelle `handlers` quand l'utilisateur décide quelque chose.
 */
export function createUi(store, handlers) {
  const screens = {
    title: $('screen-title'),
    select: $('screen-select'),
    scores: $('screen-scores'),
    controls: $('screen-controls'),
    pause: $('screen-pause'),
    results: $('screen-results'),
  };
  const chrome = $('race-chrome');
  const soundAlert = $('sound-alert');
  const musicLoad = $('music-load');
  const diag = $('audio-diag');
  const musicBar = musicLoad.querySelector('i');
  const musicLabel = musicLoad.querySelector('span');

  // L'alerte sonore a trois causes possibles ; une seule pastille les porte.
  const sound = { blocked: false, failed: false, starving: false };
  function refreshSound() {
    if (sound.blocked) {
      soundAlert.hidden = false;
      soundAlert.textContent = sound.failed
        ? 'bande-son illisible — vérifier assets/reborn.mp3'
        : 'son coupé — toucher pour activer';
    } else if (sound.starving) {
      soundAlert.hidden = false;
      soundAlert.textContent = 'bande-son en cours de chargement…';
    } else {
      soundAlert.hidden = true;
    }
  }
  const centerChip = $('btn-center');

  let current = 'title';

  function show(name) {
    current = name;
    for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
    chrome.hidden = name !== null;
    if (name === 'scores') renderScores();
    if (name === 'select') renderTracks();
  }

  /** Masque tous les écrans : on est en course. */
  function hideAll() {
    current = null;
    for (const el of Object.values(screens)) el.hidden = true;
    chrome.hidden = false;
  }

  // ------------------------------------------------------------- circuits
  function renderTracks() {
    const list = $('track-list');
    list.textContent = '';
    for (const theme of THEMES) {
      const best = store.best(theme.id);
      const card = document.createElement('button');
      card.className = 'card';
      card.style.setProperty('--accent', `#${theme.accent.toString(16).padStart(6, '0')}`);
      card.innerHTML = `
        <h3></h3>
        <p class="tag"></p>
        <p class="desc"></p>
        <p class="best"></p>`;
      card.querySelector('h3').textContent = theme.name;
      card.querySelector('.tag').textContent = theme.tag;
      card.querySelector('.desc').textContent = theme.blurb;
      card.querySelector('.best').textContent = best
        ? `record ${formatTime(best.total)} · tour ${formatTime(best.lap)}`
        : 'jamais couru';
      card.addEventListener('click', () => handlers.onStart(theme.id));
      list.appendChild(card);
    }
  }

  // --------------------------------------------------------------- scores
  function renderScores() {
    const list = $('score-list');
    list.textContent = '';
    for (const theme of THEMES) {
      const best = store.best(theme.id);
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `
        <div><div class="name"></div><div class="sub"></div></div>
        <div class="val"><span></span><small></small></div>`;
      row.querySelector('.name').textContent = theme.name;
      row.querySelector('.sub').textContent = best ? `place ${best.rank}` : 'aucun temps';
      row.querySelector('.val span').textContent = best ? formatTime(best.total) : '—';
      row.querySelector('.val small').textContent = best ? `tour ${formatTime(best.lap)}` : '';
      list.appendChild(row);
    }
  }

  // ------------------------------------------------------------ contrôles
  function syncOptions() {
    const s = store.settings;
    const invert = $('opt-invert');
    invert.setAttribute('aria-pressed', String(s.invert));
    $('opt-invert-val').textContent = s.invert ? 'inversé' : 'normal';
    $('opt-sens-val').textContent = SENSITIVITY[s.sensitivity].label;
    $('opt-sound').setAttribute('aria-pressed', String(s.sound));
    $('opt-sound-val').textContent = s.sound ? 'activé' : 'coupé';
  }

  $('opt-invert').addEventListener('click', () => {
    store.setSetting('invert', !store.settings.invert);
    syncOptions();
    handlers.onSettings();
  });
  $('opt-sens').addEventListener('click', () => {
    store.setSetting('sensitivity', (store.settings.sensitivity + 1) % SENSITIVITY.length);
    syncOptions();
    handlers.onSettings();
  });
  $('opt-sound').addEventListener('click', () => {
    store.setSetting('sound', !store.settings.sound);
    syncOptions();
    handlers.onSettings();
  });

  // --------------------------------------------------------------- liaisons
  $('go-select').addEventListener('click', () => show('select'));
  $('go-scores').addEventListener('click', () => show('scores'));
  $('go-controls').addEventListener('click', () => show('controls'));
  for (const el of document.querySelectorAll('[data-back]')) {
    el.addEventListener('click', () => show(el.dataset.back));
  }
  $('wipe-scores').addEventListener('click', () => { store.wipe(); renderScores(); });

  $('btn-pause').addEventListener('click', () => handlers.onPause());
  $('pause-resume').addEventListener('click', () => handlers.onResume());
  $('pause-restart').addEventListener('click', () => handlers.onRestart());
  $('pause-quit').addEventListener('click', () => handlers.onQuit());
  $('res-again').addEventListener('click', () => handlers.onRestart());
  $('res-quit').addEventListener('click', () => handlers.onQuit());
  centerChip.addEventListener('click', () => handlers.onRecenter());
  soundAlert.addEventListener('click', () => handlers.onSoundRetry());

  syncOptions();

  return {
    show,
    hideAll,
    get current() { return current; },
    get sensitivityRange() { return SENSITIVITY[store.settings.sensitivity].range; },

    showPause(themeName) {
      $('pause-track').textContent = themeName;
      show('pause');
    },

    /** @param {{rank:number, field:number, total:number, best:number, top:number}} r */
    showResults(r, records) {
      $('res-rank').textContent = `${r.rank} / ${r.field}`;
      $('res-total').textContent = formatTime(r.total);
      $('res-best').textContent = formatTime(r.best);
      $('res-top').textContent = `${r.top.toFixed(0)} km/h`;
      $('res-headline').textContent = r.rank === 1 ? 'VAINQUEUR' : 'ARRIVÉE';
      $('res-eyebrow').textContent = r.rank === 1 ? 'première place' : 'course terminée';
      $('res-record').hidden = !(records.total || records.lap);
      show('results');
    },

    /** Le gyroscope répond : on propose de recentrer. */
    setGyro(on) { centerChip.hidden = !on; },

    /** Le navigateur a refusé le son : on laisse un moyen de le relancer. */
    setSoundBlocked(blocked, failed = false) {
      sound.blocked = blocked;
      sound.failed = failed;
      refreshSound();
    },

    /** La lecture manque de données : on le dit, ce n'est pas une panne. */
    setSoundStarving(starving) {
      if (sound.starving === starving) return;
      sound.starving = starving;
      refreshSound();
    },

    /**
     * État du son, écrit en clair dans l'écran Contrôles. Quand quelque chose
     * cloche sur un appareil qu'on n'a pas sous la main, c'est cette ligne qui
     * le dit.
     */
    setDiagnostic(text) { diag.textContent = text; },

    /**
     * Avancement du préchargement du morceau. `-1` signale qu'on n'a pas pu
     * le mettre en mémoire et qu'on lira au fil de l'eau.
     */
    setMusicProgress(ratio) {
      if (ratio < 0) {
        musicLoad.hidden = false;
        musicBar.style.width = '100%';
        musicLabel.textContent = 'lecture au fil de l’eau';
        setTimeout(() => { musicLoad.hidden = true; }, 2500);
        return;
      }
      if (ratio >= 1) {
        musicBar.style.width = '100%';
        setTimeout(() => { musicLoad.hidden = true; }, 500);
        return;
      }
      musicLoad.hidden = false;
      musicBar.style.width = `${Math.round(ratio * 100)}%`;
      musicLabel.textContent = `chargement de la bande-son ${Math.round(ratio * 100)} %`;
    },
  };
}
