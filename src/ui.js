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

const ORIENTATIONS = ['portrait', 'paysage'];

/**
 * Les écrans : titre, circuits, scores, contrôles, pause, arrivée.
 *
 * Cette couche ne connaît rien du jeu. Elle affiche, elle écoute, et elle
 * rappelle `handlers` quand l'utilisateur décide quelque chose.
 */
export function createUi(store, handlers) {
  const screens = {
    boot: $('screen-boot'),
    title: $('screen-title'),
    select: $('screen-select'),
    brief: $('screen-brief'),
    scores: $('screen-scores'),
    controls: $('screen-controls'),
    pause: $('screen-pause'),
    results: $('screen-results'),
  };
  const chrome = $('race-chrome');
  const soundAlert = $('sound-alert');
  const diag = $('audio-diag');
  const bootLoad = $('boot-load');
  const bootBar = bootLoad.querySelector('i');
  const bootLabel = bootLoad.querySelector('span');
  const bootNote = $('boot-note');

  /** Ce que raconte chaque étape du chargement. */
  const STAGES = {
    download: 'téléchargement de la bande-son',
    decode: 'décodage du morceau',
    ready: 'prêt',
    failed: 'bande-son indisponible',
  };

  // Depuis que le morceau est décodé en mémoire avant le départ, il ne reste
  // qu'une cause possible : le navigateur refuse encore de jouer.
  const sound = { blocked: false, failed: false };
  function refreshSound() {
    soundAlert.hidden = !sound.blocked;
    if (!sound.blocked) return;
    soundAlert.textContent = sound.failed
      ? 'bande-son illisible — vérifier assets/reborn.mp3'
      : 'son coupé — toucher pour activer';
  }
  const centerChip = $('btn-center');

  let current = 'boot';
  /** Le circuit décrit par l'écran de briefing, le temps qu'on le lise. */
  let briefed = null;

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
        ? (theme.bonus
          ? `record ${formatTime(best.total)}`
          : `record ${formatTime(best.total)} · tour ${formatTime(best.lap)}`)
        : 'jamais couru';
      if (theme.bonus) card.classList.add('bonus');
      // Le parcours bonus ne se joue pas comme les autres : on l'explique
      // avant, sinon on découvre la règle en percutant le premier barrage.
      card.addEventListener('click', () => {
        if (theme.bonus) {
          briefed = theme;
          $('brief-name').textContent = theme.name;
          show('brief');
        } else {
          handlers.onStart(theme.id);
        }
      });
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
    $('opt-orient-val').textContent = s.orientation;
    $('opt-sound').setAttribute('aria-pressed', String(s.sound));
    $('opt-sound-val').textContent = s.sound ? 'activé' : 'coupé';
    // Le format du cadre est une affaire de feuille de style : un attribut sur
    // le corps du document, et le CSS fait le reste.
    document.body.dataset.orient = s.orientation;
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
  $('opt-orient').addEventListener('click', () => {
    const next = (ORIENTATIONS.indexOf(store.settings.orientation) + 1) % ORIENTATIONS.length;
    store.setSetting('orientation', ORIENTATIONS[next]);
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
  $('brief-go').addEventListener('click', () => { if (briefed) handlers.onStart(briefed.id); });

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

    /**
     * État du son, écrit en clair dans l'écran Contrôles. Quand quelque chose
     * cloche sur un appareil qu'on n'a pas sous la main, c'est cette ligne qui
     * le dit.
     */
    setDiagnostic(text) { diag.textContent = text; },

    /**
     * Avancement du chargement, sur l'écran de démarrage.
     *
     * Le décodage d'un MP3 de cinq mégaoctets ne rend pas la main pendant une
     * à trois secondes : sans étape nommée, la barre semblerait figée à 80 %
     * et on croirait à un blocage.
     */
    setLoad(ratio, stage) {
      const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
      bootBar.style.width = `${pct}%`;
      bootLabel.textContent = stage === 'download'
        ? `${STAGES.download} ${pct} %`
        : (STAGES[stage] || stage);
      if (stage === 'failed') {
        screens.boot.classList.add('failed');
        bootNote.textContent = 'le jeu est jouable, mais sans musique ni rythme';
      }
    },
  };
}
