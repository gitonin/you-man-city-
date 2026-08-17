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

**Niveau 02 — Les fenêtres.** La caméra descend vers un immeuble de la cité
dont la façade est un séquenceur : **8 pistes × 8 pas**. Chaque fenêtre est un
pas ; on la touche pour l'allumer. Les cinq rangées hautes jouent une gamme
(Do mineur), puis la basse, le clap et la grosse caisse. Une tête de lecture
balaie la façade, les fenêtres jouées pulsent, la couronne de l'immeuble bat
sur la grosse caisse.

Le bouton **cité** rend la caméra libre au-dessus du quartier, le nom allumé ;
**← fenêtres** ramène au séquenceur.

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
  city.js           génération de la cité et pilotage des néons
  level1.js         caméra orbitale, mesure de l'angle, indices
  level2.js         immeuble-séquenceur et saisie tactile
  audio.js          synthèse Web Audio (drone + 8 voix + séquenceur)
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
| `TRACKS` | les 8 pistes : note, timbre, teinte |
| `DEMO_PATTERN` / `SEED_PATTERN` | motifs de départ du séquenceur |

Le mot affiché se change dans `city.js` : `layoutText(['YOU', 'MAN'], …)`.
La fonte ne couvre que les lettres nécessaires — en ajouter d'autres se fait
dans `src/font.js`.

`window.YOUMAN` expose la scène, les deux niveaux et l'audio pour régler
l'ensemble depuis la console sans recharger.

## Compatibilité

WebGL2 (repli WebGL1), navigateurs mobiles récents. Le son démarre au premier
appui, comme l'exigent iOS et Android. Sur mobile, un bouton **gyro** permet de
piloter la caméra à l'inclinaison de l'appareil : téléphone dressé = vue de
rue, téléphone à plat = zénith (iOS demande l'autorisation des capteurs).
