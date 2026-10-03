/**
 * Les quatre circuits.
 *
 * Un thème décrit tout ce qui change d'une course à l'autre : la forme du
 * tracé, la palette, le ciel, le brouillard, le type de décor, la météo et les
 * sections couvertes. Le reste du moteur ne connaît rien d'autre.
 *
 * Le tracé est paramétrique — un anneau déformé par deux harmoniques — ce qui
 * donne quatre dessins nettement différents sans risque d'auto-intersection :
 * le rayon reste toujours positif, donc la boucle reste étoilée.
 */

export const THEMES = [
  {
    id: 'neon',
    name: 'NEON KOWLOON',
    tag: 'nuit · néon · cyber',
    blurb: 'Les enseignes dégoulinent sur la chaussée. Trois tours dans la ville haute.',
    shape: {
      radius: 1080,
      lobe: [0.3, 2],
      wobble: [-0.15, 3],
      hills: [34, 19, -11],
    },
    scenery: 'city',
    walls: 'solid',
    ground: true,
    rain: 0,
    tunnels: [[0.145, 0.265], [0.595, 0.715]],
    boosts: [0.07, 0.345, 0.5, 0.79, 0.93],
    fog: { color: 0x16222e, near: 150, far: 820 },
    sky: [
      [0.0, '#04060b'], [0.3, '#0a1220'], [0.44, '#1c2a44'],
      [0.49, '#4a5468'], [0.515, '#8a6a55'], [0.55, '#17161e'], [1.0, '#04060a'],
    ],
    stars: 34,
    road: { base: '#3e454d', shades: ['#464e58', '#343b43', '#4f5862'], kerb: ['#d8e2ec', '#c0392f'] },
    wall: { base: '#3f4a57', panels: ['#46525f', '#3a4552', '#4e5b69'], strip: '#7df4ff', stripDark: '#0f5c78' },
    windows: ['#6fe6ff', '#ffb45c', '#e8f2ff', '#ff5e8a'],
    billboards: ['#ff2e6b', '#3cf0ff', '#ffa023', '#b57bff'],
    accent: 0x5ff0ff,
  },

  {
    id: 'rain',
    name: 'GREY DISTRICT',
    tag: 'pluie · brume · béton',
    blurb: 'Des blocs sans fenêtres, de l’eau partout, et la visibilité d’un lundi matin.',
    shape: {
      radius: 980,
      lobe: [-0.26, 3],
      wobble: [0.17, 5],
      hills: [18, 9, 22],
    },
    scenery: 'blocks',
    walls: 'solid',
    ground: true,
    rain: 1,
    tunnels: [[0.33, 0.40]],
    boosts: [0.11, 0.3, 0.57, 0.74, 0.88],
    fog: { color: 0x474f57, near: 80, far: 580 },
    sky: [
      [0.0, '#2e353c'], [0.35, '#454e56'], [0.48, '#5e676f'],
      [0.52, '#6b747c'], [0.58, '#3b4248'], [1.0, '#20262b'],
    ],
    stars: 0,
    road: { base: '#2f353b', shades: ['#363d44', '#282e34', '#3d444b'], kerb: ['#c9d2d9', '#8e9aa3'] },
    wall: { base: '#535c64', panels: ['#59636c', '#4b545c', '#626c75'], strip: '#c6d2da', stripDark: '#6d7880' },
    windows: ['#9fb0bd', '#c2ccd4', '#7e8d99'],
    billboards: ['#9aa6b0', '#6f7b85', '#c3ccd3'],
    accent: 0xb9c7d2,
  },

  {
    id: 'chroma',
    name: 'CHROMA TUBE',
    tag: 'tunnel · écrans · arc-en-ciel',
    blurb: 'Un boyau tapissé d’écrans. On y voit surtout ce que la machine veut bien afficher.',
    shape: {
      radius: 900,
      lobe: [0.34, 4],
      wobble: [0.12, 2],
      hills: [26, 31, 14],
    },
    scenery: 'tube',
    walls: 'solid',
    ground: false,
    rain: 0,
    tunnels: [[0.0, 0.34], [0.46, 0.82]],
    boosts: [0.05, 0.22, 0.42, 0.63, 0.86],
    fog: { color: 0x1a0f2a, near: 110, far: 560 },
    sky: [
      [0.0, '#06020e'], [0.38, '#190a33'], [0.48, '#4a1270'],
      [0.52, '#b5309a'], [0.58, '#210c35'], [1.0, '#06020e'],
    ],
    stars: 0,
    road: { base: '#3d2d57', shades: ['#473567', '#332549', '#523d73'], kerb: ['#f5e9ff', '#7b2bd4'] },
    wall: { base: '#2b1a45', panels: ['#33204f', '#261741', '#3b2659'], strip: '#ff46e0', stripDark: '#5c1b63' },
    windows: ['#ff46e0', '#46ffd2', '#ffe24a', '#6a7bff'],
    billboards: ['#ff46e0', '#46ffd2', '#ffe24a', '#ff7a3c'],
    accent: 0xff46e0,
  },

  {
    id: 'space',
    name: 'RING OF DUST',
    tag: 'vide · météorites · anneaux',
    blurb: 'Une dalle qui flotte dans le noir, bordée de rochers. Au-delà, rien.',
    shape: {
      radius: 1160,
      lobe: [0.22, 2],
      wobble: [-0.1, 5],
      hills: [58, 37, 24],
    },
    scenery: 'space',
    /** Pas de mur bâti : ce sont les météorites qui tiennent les bas-côtés. */
    walls: 'rocks',
    /** Dalle métallique rivetée, et non du bitume : il n'y a pas de sol ici. */
    roadStyle: 'plate',
    ground: false,
    rain: 0,
    tunnels: [],
    boosts: [0.09, 0.27, 0.46, 0.68, 0.85],
    fog: { color: 0x04050c, near: 300, far: 1750 },
    sky: [
      [0.0, '#02030a'], [0.4, '#05071a'], [0.5, '#0b1030'],
      [0.56, '#070a1e'], [1.0, '#02030a'],
    ],
    stars: 180,
    road: { base: '#262d38', shades: ['#2e3643', '#1f252e', '#374050'], kerb: ['#e9f2ff', '#3c6cff'] },
    wall: { base: '#2b3340', panels: ['#333c4a', '#262e3a', '#3b4554'], strip: '#8fb4ff', stripDark: '#2b4a8c' },
    windows: ['#cfe0ff', '#8fb4ff', '#ffffff'],
    billboards: ['#8fb4ff', '#ffffff', '#ff8f5e'],
    accent: 0x8fb4ff,
  },
];

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
