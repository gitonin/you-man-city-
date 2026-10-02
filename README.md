# REBORN — You Man

Un antigravité en 3D pour téléphone, debout, dans l'esthétique des circuits
PlayStation première génération : polygones qui tremblent, textures qui se
tordent, image en basse définition, et une corruption de signal permanente.

La bande-son est **« Reborn » de You Man**, et c'est elle qui tient le volant :
sa vitesse de lecture — hauteur comprise — suit celle du bolide.

## Jouer

Deux gestes, pas un de plus.

| | |
| --- | --- |
| **Incliner l'appareil** | tourner à gauche / à droite |
| **Garder le doigt posé** | accélérer ; doigt levé, le frein moteur fait le reste |

Trois tours. Les chevrons orange sur la piste donnent une survitesse. Les murs
coûtent du bouclier, de la vitesse, et font décrocher l'image.

Sans gyroscope (ordinateur, ou capteurs refusés) : glisser le doigt
horizontalement pour diriger, flèches ou `A`/`D` au clavier, `espace` pour
accélérer. Le bouton **recentrer** remet l'inclinaison courante comme neutre —
utile si on joue allongé.

## Lancer en local

Entièrement statique, aucun build, aucune dépendance à installer. Il faut juste
un serveur HTTP, les modules ES ne se chargeant pas en `file://` :

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

Pour déployer, publier le dossier tel quel (GitHub Pages, Netlify, un `nginx`).

## Le rendu PlayStation

Tout le travail est là, et il tient en quatre gestes dans `src/psx.js` et
`src/post.js`.

**Accrochage des sommets.** La console n'avait pas de précision sous-pixel :
les sommets étaient arrondis à la grille de l'écran. Le shader de sommet
quantifie `gl_Position` sur une grille dérivée de la définition interne, d'où
le tremblement de la géométrie en mouvement.

**Placage affine.** Pas de correction de perspective non plus : les textures se
tordent sur les grands polygones. Le GPU, lui, interpole *avec* correction. On
la défait en transportant `uv * w` et `w` dans deux varyings, puis en divisant
l'un par l'autre dans le fragment — ce qui redonne exactement une interpolation
linéaire à l'écran. C'est pour ça que la piste n'a qu'un seul quad en travers :
plus le polygone est grand, plus la torsion se voit.

**Éclairage cuit.** Aucune lampe dans la scène. La lumière est calculée à la
construction et rangée dans la couleur des sommets, comme à l'époque.

**Basse définition et 15 bits.** La scène est rendue dans une cible de 448
pixels de haut, puis étirée au plein écran au plus proche voisin. La passe
finale réduit ensuite à 15 bits avec un tramage ordonné 4×4, ajoute les lignes
de balayage, le bombement du tube et la vignette.

## Le glitch

La corruption vit dans la même passe finale, et elle est pilotée : un fond
permanent, une part proportionnelle à la vitesse, un pic à chaque mur, et des
rafales aléatoires courtes. Dans l'ordre : décrochage par lignes, blocs
déplacés, recollage de morceaux d'image dans une palette cassée (le datamosh
magenta/vert), séparation des composantes, filé radial à grande vitesse.

Le tableau de bord passe par la même dégradation : il est peint sur un canvas à
la définition interne puis injecté dans le shader, donc il se tord et décroche
avec le reste. C'est ce qui fait croire à une seule machine fatiguée plutôt qu'à
une interface posée par-dessus.

## La musique

Le morceau est lu par un `<audio>` plutôt que décodé en mémoire : quatre
minutes trente-huit en Float32 coûteraient près de cent mégaoctets sur un
téléphone. `preservesPitch` est désactivé, donc la hauteur suit la vitesse de
lecture — l'effet bande magnétique qu'on cherche quand le bolide accélère.

| Vitesse | Lecture |
| --- | --- |
| à l'arrêt | ×0.62 |
| plein régime | ×1.26 |
| survitesse | ×1.45 |

L'élément passe ensuite dans Web Audio pour en tirer un niveau — qui fait
respirer la courbure de l'écran — et pour y mêler les bruitages (choc,
survitesse, décompte), eux synthétisés.

Pour changer de morceau : remplacer `assets/reborn.mp3` et ajuster `MUSIC` dans
`src/config.js`.

## Ce qu'il y a dedans

```
index.html          cadre portrait, écrans de titre et d'arrivée
styles.css          habillage, titre à décrochages
assets/reborn.mp3   You Man — Reborn (160 kb/s)
src/
  main.js           boucle, machine d'états, dosage du glitch
  config.js         tous les réglages : pilotage, circuit, musique, corruption
  psx.js            matériaux : accrochage des sommets, placage affine, lumière cuite
  track.js          circuit, extrusion du ruban, décor, repérage en espace piste
  ship.js           physique du bolide et cockpit
  controls.js       gyroscope, doigt, clavier
  hud.js            tableau de bord et sa fonte matricielle 5×7
  post.js           passe finale : tube cathodique, glitch, tramage
  audio.js          lecture du morceau, vitesse variable, bruitages
vendor/three/       Three.js r169 (MIT)
```

Le circuit est une boucle fermée échantillonnée une fois pour toutes ; le
bolide ne s'y repère que par deux scalaires — la distance parcourue et l'écart
à l'axe. Pas de physique à intégrer dans le monde, donc pas de vaisseau qui
traverse un mur un jour de ralenti.

## Réglages utiles

Tout est dans `src/config.js`.

| Réglage | Effet |
| --- | --- |
| `SHIP.steerForce` / `tiltRange` | nervosité de la direction, amplitude d'inclinaison |
| `SHIP.corneringDrift` | combien le dévers pousse vers l'extérieur |
| `SHIP.maxSpeed` / `thrust` / `drag` | vitesse de croisière et reprise |
| `MUSIC.rateIdle` / `rateMax` / `rateBoost` | plage de dérapage de la bande |
| `GLITCH.*` | fond, rafales, pic de choc, plafond |
| `RENDER.internalHeight` | définition interne — le plus gros levier de performance |
| `RENDER.vertexJitter` | ampleur du tremblement des polygones |
| `TRACK.*` | largeur, dévers, finesse du ruban |

`window.REBORN` expose la scène, le bolide, la piste et l'audio pour régler
depuis la console. `REBORN.setGlitch(0)` fige la corruption le temps de juger
l'image ; `REBORN.setGlitch(null)` rend la main.

## Compatibilité

WebGL2 (repli WebGL1), navigateurs mobiles récents. Le son et les capteurs
démarrent au premier appui, comme l'exigent iOS et Android. Si la moyenne
descend sous 40 images par seconde, le `devicePixelRatio` retombe à 1 — la
définition interne, elle, ne bouge pas, puisque c'est elle qui fait le style.
