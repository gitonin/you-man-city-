import { Color, MeshBasicMaterial, Vector2 } from 'three';

/**
 * Le rendu PlayStation, en trois gestes.
 *
 * 1. **Accrochage des sommets.** La console n'avait pas de précision
 *    sous-pixel : les sommets étaient arrondis à la grille de l'écran. D'où
 *    le tremblement caractéristique de la géométrie en mouvement.
 *
 * 2. **Placage affine.** Pas de correction de perspective non plus : les
 *    textures se tordent sur les grands polygones. Le GPU interpole les
 *    varyings *avec* correction ; on la défait en transportant `uv * w` et
 *    `w`, puis en divisant dans le fragment — ce qui redonne exactement une
 *    interpolation linéaire à l'écran.
 *
 * 3. **Éclairage précalculé.** La lumière était cuite dans la couleur des
 *    sommets. Aucune lampe dans la scène : les géométries portent leur
 *    propre ombrage.
 */

/** Grille d'accrochage partagée par tous les matériaux PSX. */
const uPsxGrid = { value: new Vector2(256, 448) };

export function setPsxGrid(width, height) {
  uPsxGrid.value.set(Math.max(2, width), Math.max(2, height));
}

const VERT_HEAD = /* glsl */ `
  uniform vec2 uPsxGrid;
`;

const VERT_SNAP = /* glsl */ `
  {
    vec2 grid = uPsxGrid * 0.5;
    vec4 snapped = gl_Position;
    snapped.xy = floor(snapped.xy / snapped.w * grid + 0.5) / grid * snapped.w;
    gl_Position = snapped;
  }
`;

const VERT_AFFINE = /* glsl */ `
  vAffUv = vMapUv * gl_Position.w;
  vAffW = gl_Position.w;
`;

const FRAG_AFFINE_MAP = /* glsl */ `
  #ifdef USE_MAP
    vec4 sampledDiffuseColor = texture2D( map, vAffUv / vAffW );
    diffuseColor *= sampledDiffuseColor;
  #endif
`;

/**
 * Matériau de base de tout le décor.
 *
 * @param {object} options
 * @param {import('three').Texture} [options.map]
 * @param {number|Color} [options.color]
 * @param {boolean} [options.vertexColors] ombrage cuit dans la géométrie
 * @param {boolean} [options.affine] placage affine (vrai si une texture)
 * @param {boolean} [options.snap] accrochage des sommets
 */
export function psxMaterial({
  map = null,
  color = 0xffffff,
  vertexColors = true,
  affine = true,
  snap = true,
  transparent = false,
  alphaTest = 0,
  side,
  depthWrite,
  fog = true,
  toneMapped = true,
} = {}) {
  const material = new MeshBasicMaterial({
    map,
    color: new Color(color),
    vertexColors,
    transparent,
    alphaTest,
    fog,
    toneMapped,
  });
  if (side !== undefined) material.side = side;
  if (depthWrite !== undefined) material.depthWrite = depthWrite;

  const useAffine = affine && !!map;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPsxGrid = uPsxGrid;

    let head = VERT_HEAD;
    let tail = snap ? VERT_SNAP : '';
    if (useAffine) {
      head += '\nvarying vec2 vAffUv;\nvarying float vAffW;\n';
      tail += VERT_AFFINE;
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${head}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${tail}`);

    if (useAffine) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vAffUv;\nvarying float vAffW;')
        .replace('#include <map_fragment>', FRAG_AFFINE_MAP);
    }
  };

  // Deux matériaux qui ne partagent pas ces options ne doivent pas partager
  // leur programme compilé.
  material.customProgramCacheKey = () => `psx|${snap ? 1 : 0}|${useAffine ? 1 : 0}`;

  return material;
}

/**
 * Ombrage cuit : on éclaire une normale par une lampe directionnelle et un
 * ciel, et on range le résultat dans la couleur du sommet.
 *
 * @param {number[]} normal  normale unitaire
 * @param {number} [tint]    teinte de base multipliée au résultat
 * @returns {[number, number, number]}
 */
const KEY_DIR = [0.42, 0.78, 0.46];
const KEY_LEN = Math.hypot(...KEY_DIR);
const KEY = KEY_DIR.map((v) => v / KEY_LEN);

export function bakeVertexLight(nx, ny, nz, ambient = 0.54, gain = 0.56) {
  const lambert = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
  // rebond froid venant du sol, pour que les faces inférieures ne soient
  // pas des trous noirs
  const bounce = Math.max(0, -ny) * 0.14;
  const level = ambient + lambert * gain + bounce;
  return [level * 0.98, level, level * 1.06];
}
