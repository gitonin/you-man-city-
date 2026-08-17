# YOU MAN — Cité

Expérience 3D pour mobile (format **9:16**) : une cité néon de nuit, ambiance
*Blade Runner*, dans laquelle le nom du groupe électronique **You Man** est
écrit par les bâtiments eux-mêmes.

## Le parcours

**Niveau 01 — L'angle.** Le seul verbe du joueur est d'orienter la caméra.
Au ras des rues on ne voit qu'un quartier dense sous la pluie. En prenant de
l'altitude, les couronnes néon des tours dessinent des formes ; il reste à
trouver l'azimut exact — un seul, volontairement non rond — depuis lequel le
mot se lit. Aucune flèche, aucune boussole : le retour est analogique. Une
jauge de *résonance*, l'intensité des néons, le désaccord d'un drone qui se
referme. Il faut tenir l'angle une seconde pour verrouiller.

**Niveau 02 — Les toits.** La caméra reste en l'air et bascule en survol
oblique : le nom au fond, une dalle de 8 × 8 immeubles bas au premier plan.
Le drone du niveau 1 se coupe net, un morceau démarre.

*Le mot est la rythmique.* Les 16 colonnes de la trame « YOU MAN » sont les
16 doubles-croches de la mesure. À chaque pas, la colonne correspondante
s'allume et c'est très exactement ce qu'on entend : la ligne du bas (« MAN »)
tient la batterie — les montants pleins des lettres deviennent des coups de
grosse caisse, les parties fines des charlestons —, la ligne du haut (« YOU »)
tient la basse et les stabs, la hauteur suivant la première case allumée de la
colonne. Tout ce qui n'est pas la grosse caisse passe dans un bus compressé à
chaque coup : c'est la respiration du genre. Le bouton **le mot** coupe cette
couche pour n'entendre que la sienne.

*Les toits sont l'instrument du joueur.* Chaque toit de la dalle est un pad :
**8 pistes × 8 pas**, une gamme de Do mineur de la rangée la plus lointaine
(aigu) à la plus proche (grave). On touche un toit pour poser une note ; une
tête de lecture balaie la dalle, les toits joués pulsent. Les pads bouclent sur
8 pas quand le mot en tient 16 : la phrase fait deux mesures.

Le bouton **cité** rend la caméra libre au-dessus du quartier, le nom allumé ;
**← séquenceur** y ramène.

## Lancer en local

Le site est entièrement statique — aucun build, aucune dépendance à installer.
Il faut juste un serveur HTTP (les modules ES ne se chargent pas en `file://`) :

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

Pour un déploiement, publiez le dossier tel quel (GitHub Pages, Netlify, un
simple `nginx`…).

## Ce qu'il y a dedans

```
index.html          cadre 9:16, écrans et HUD
styles.css          habillage néon, pluie, grain, vignette
src/
  main.js           rendu, post-traitement, machine d'états, transitions
  config.js         tous les réglages sensibles (angle solution, tempo, pistes)
  font.js           fonte matricielle 5×7 réduite à Y O U M A N
  groove.js         lecture de la rythmique dans la trame du mot
  city.js           génération de la cité et pilotage des néons
  level1.js         caméra orbitale, mesure de l'angle, indices
  level2.js         dalle de toits, survol oblique et saisie tactile
  audio.js          synthèse Web Audio (drone, batterie, basse, stabs, pads)
  textures.js       toutes les textures, peintes au canvas
vendor/three/       Three.js r169 + passes de post-traitement (MIT)
```

Trois principes de fabrication :

- **Aucune ressource externe.** Pas de CDN, pas d'image, pas de son : les
  façades, le ciel, le bitume et les halos sont peints au `<canvas>` au
  démarrage ; la musique est synthétisée. Le site fonctionne hors ligne.
- **Instanciation.** Tours, socles, remplissage urbain et fenêtres passent par
  des `InstancedMesh` — quelques appels de rendu pour ~700 bâtiments.
- **Repli automatique.** Si la moyenne descend sous 42 fps sur 2,5 s, le
  `devicePixelRatio` retombe à 1 ; sous 28 fps le bloom est coupé.

## Réglages utiles

Tout est dans `src/config.js`.

| Réglage | Effet |
| --- | --- |
| `TEXT_YAW` | l'azimut solution de l'énigme |
| `PUZZLE.azTolerance` / `elTolerance` | largeur de la fenêtre de résonance |
| `PUZZLE.lockThreshold` / `holdSeconds` | difficulté du verrouillage |
| `PUZZLE.hints` | textes d'aide et leur délai d'apparition |
| `CAM.drag` | sensibilité du glissement |
| `TRACKS` | les 8 pistes du joueur : note et teinte |
| `PADS` / `AERIAL` | dalle des toits et cadrage du survol |
| `DEMO_PATTERN` / `SEED_PATTERN` | motifs de départ du séquenceur |
| `BPM` | tempo (122 par défaut, doubles-croches) |

Les règles qui transforment le mot en batterie tiennent en une vingtaine de
lignes dans `src/groove.js` — c'est là qu'on change le style du morceau.

Le mot affiché se change dans `city.js` : `layoutText(['YOU', 'MAN'], …)`.
La fonte ne couvre que les lettres nécessaires — en ajouter d'autres se fait
dans `src/font.js`. Attention : les chasses y sont calibrées pour que chaque
ligne fasse exactement 16 colonnes, soit une mesure. Un mot d'une autre largeur
change la longueur de la boucle.

`window.YOUMAN` expose la scène, les deux niveaux et l'audio pour régler
l'ensemble depuis la console sans recharger.

## Compatibilité

WebGL2 (repli WebGL1), navigateurs mobiles récents. Le son démarre au premier
appui, comme l'exigent iOS et Android. Sur mobile, un bouton **gyro** permet de
piloter la caméra à l'inclinaison de l'appareil : téléphone dressé = vue de
rue, téléphone à plat = zénith (iOS demande l'autorisation des capteurs).
