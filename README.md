# YOU MAN — REBORN

Un antigravité en 3D pour téléphone, debout, dans l'esthétique des circuits
PlayStation première génération : polygones qui tremblent, textures qui se
tordent, image en basse définition, corruption de signal permanente.

La bande-son est **« Reborn » de You Man**, et c'est elle qui tient le volant :
sa vitesse de lecture — hauteur comprise — suit celle du bolide, et le jeu bat
sur son tempo.

## Jouer

| | |
| --- | --- |
| **Incliner l'appareil** | tourner à gauche / à droite |
| **Glisser vers le haut** | mettre les gaz |
| **Glisser vers le bas** | lever le pied |
| **Double appui** | turbo |

La manette est un levier : elle reste où on la laisse, on ne garde pas le doigt
appuyé. Trois tours, cinq adversaires, les chevrons orange donnent une
survitesse, les murs et les accrochages coûtent du bouclier.

Sans gyroscope (ordinateur, ou capteurs refusés) : la moitié gauche de l'écran
dirige, la moitié droite fait manette ; au clavier, flèches gauche/droite pour
diriger, haut/bas ou espace pour les gaz, majuscule pour le turbo. Le sens de
l'inclinaison, la sensibilité, le **format de l'écran** et le son se règlent
dans **Contrôles**.

**Debout ou couché.** Le cadre de jeu se met en portrait (9/16) ou en paysage
(16/9) ; c'est la seule chose que le réglage change, tout le reste suit. Le
tableau de bord prend son unité sur la *hauteur* de la cible de rendu et non
sur sa largeur, sans quoi il quintuplerait au basculement, et il met vitesse et
chrono côte à côte dès que le cadre est plus large que haut. Les courses du
doigt se mesurent sur les côtés de l'appareil et non sur ceux du cadre — un
téléphone couché a la même diagonale que debout —, donc la manette garde la
même amplitude et la direction au doigt la même sensibilité. Si l'appareil est
tenu dans le mauvais sens, un écran le dit.

## Les quatre circuits

| | |
| --- | --- |
| **NEON KOWLOON** | nuit, néons, tours à fenêtres allumées, deux tunnels |
| **GREY DISTRICT** | averse, brume épaisse, blocs de béton serrés contre la piste |
| **CHROMA TUBE** | boyau presque entièrement couvert, voûte en écrans arc-en-ciel |
| **RING OF DUST** | le vide, aucun sol, aucun mur : les météorites font les bas-côtés |

Les meilleurs temps sont gardés par circuit dans le navigateur.

## L'orbite, qui n'a pas de mur

Les trois premiers circuits sont bordés de murs extrudés le long du ruban. Le
quatrième n'en a aucun : la piste est une dalle de métal boulonné qui flotte
dans le noir, et ce sont des météorites plantées de part et d'autre qui disent
où elle s'arrête — un rocher tous les deux échantillons de chaque côté, étirés
dans le sens de la marche pour se souder en chaîne continue, et dont le centre
est repoussé d'au moins leur propre rayon au-delà du bord. Quelle que soit leur
bosse, aucun ne mord sur la trajectoire : la collision reste le simple écart
latéral, les rochers sont le mur qu'on voit, pas celui qu'on calcule.

La dalle a une épaisseur et un dessous, sinon le ruban se réduit à une feuille
de papier dès qu'on le voit de biais — et le tracé monte et descend de cent
unités, donc on le voit souvent. Des balises se posent dans l'intervalle libre
entre le bord et la roche : à trois cent trente unités par seconde et dans le
noir, la bordure seule ne suffit pas à se placer.

Le cockpit change avec le décor : on n'y pilote plus une voiture qui plane mais
un vaisseau, verrière plus enveloppante et deux éperons avant qui montent dans
le champ de vision. Les deux carlingues tiennent chacune en une polyligne — le
bord intérieur de la verrière — triangulée en éventail depuis un point hors
cadre, si bien qu'un maximum local du tracé devient un éperon.

## Lancer en local

Entièrement statique, aucun build, aucune dépendance à installer. Il faut juste
un serveur HTTP, les modules ES ne se chargeant pas en `file://` :

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

## Le rendu PlayStation

Tout le travail est dans `src/psx.js` et `src/post.js`.

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
finale réduit à 15 bits avec un tramage ordonné 4×4, ajoute les lignes de
balayage, la pluie, le bombement du tube et la vignette.

## Le glitch

La corruption vit dans la passe finale, et elle est pilotée : un fond
permanent, une part proportionnelle à la vitesse, un coup sur chaque temps fort
de la musique, un pic à chaque choc, et des rafales aléatoires courtes. Dans
l'ordre : décrochage par lignes, blocs déplacés, recollage de morceaux d'image
dans une palette cassée (le datamosh magenta/vert), séparation des composantes,
filé radial à grande vitesse.

Le tableau de bord passe par la même dégradation : il est peint sur un canvas à
la définition interne puis injecté dans le shader, donc il se tord et décroche
avec le reste. C'est ce qui fait croire à une seule machine fatiguée plutôt
qu'à une interface posée par-dessus.

## La musique, et le jeu qui bat dessus

Le morceau est lu par un `<audio>` plutôt que décodé en mémoire : quatre
minutes trente-huit en Float32 coûteraient près de cent mégaoctets sur un
téléphone. `preservesPitch` est désactivé, donc la hauteur suit la vitesse de
lecture — l'effet bande magnétique qu'on cherche quand le bolide accélère.

**Le morceau ne traverse pas Web Audio, et c'est voulu.** Sur iPhone,
l'interrupteur latéral coupe la sortie d'un `AudioContext` mais pas celle d'un
élément média : router la musique dans le graphe — ce que faisait une version
précédente pour la numériser — la faisait disparaître dès que l'appareil était
en mode silencieux. S'ajoutent deux pièges : `createMediaElementSource` est à
sens unique, on ne peut plus rebrancher l'élément sur les haut-parleurs ; et
changer `playbackRate` sur un élément routé provoque des coupures sur plusieurs
navigateurs mobiles. Web Audio ne sert donc qu'aux bruitages. Appareil en
silencieux, on perd les bruitages, pas la musique.

| Vitesse | Lecture |
| --- | --- |
| à l'arrêt | ×0.68 |
| plein régime | ×1.22 |
| survitesse | ×1.38 |
| turbo | ×1.50 |

**Le morceau est mis en mémoire avant d'être joué**, et ce n'est pas un luxe.
Lu au fil de l'eau, il se nourrit du réseau au débit de l'encodage ; comme la
vitesse de lecture suit celle du bolide, accélérer fait consommer le fichier
plus vite qu'il n'arrive et la lecture s'arrête. Mesuré, connexion bridée à
144 kb/s, course à plein régime : au fil de l'eau la position n'avance pas
d'une seconde en neuf, `readyState` reste à 0 ; préchargé, elle avance de 11,6 s
en 9 s — la lecture devient complètement indépendante du réseau. Le fichier est
donc récupéré par `fetch`, assemblé en `Blob`, et l'élément ne reçoit sa source
qu'à ce moment-là — la poser plus tôt le ferait télécharger deux fois. Une barre
de progression le montre au lancement, et si le `fetch` échoue on retombe sur le
flux direct en le disant.

La vitesse de lecture est bornée à **[0.55, 2.0]** : les navigateurs coupent le
son d'un élément média dont la vitesse sort grossièrement de [0.5, 4], et le
plongeon à l'impact pouvait descendre à ×0.41 depuis le ralenti.

**Le tempo.** Le fichier a été mesuré : **119 BPM pile**, premier temps à
46 ms, grille vérifiée du début à la fin du morceau. Comme la position de
lecture d'un `<audio>` est exprimée en temps de média, elle avance plus vite
quand la bande accélère — la grille de temps suit donc la vitesse du bolide
sans la moindre analyse temps réel, juste une division (`src/rhythm.js`).

De cette horloge découlent : vingt-huit portiques lumineux qui battent la
mesure le long du circuit, une lumière qui en fait le tour à la noire, un coup
de corruption sur chaque temps fort, deux filets qui pulsent dans le HUD, et
une note de la gamme quand on passe sous un portique.

**L'annonceur.** Les voix sont synthétisées, sans aucun fichier son
(`src/voice.js`). Le principe est celui des synthétiseurs vocaux d'époque : une
dent de scie à hauteur fixe — d'où le timbre de robot — traverse trois filtres
passe-bande réglés sur les **formants**, ces résonances du conduit vocal qui
font qu'on entend un « a » plutôt qu'un « i ». On fait glisser les trois
fréquences d'un phonème au suivant, on remplace la source par du bruit pour les
sifflantes, on coupe net pour les occlusives, et la parole apparaît. Une
modulation en anneau ajoute le grain numérique sans rendre le mot
incompréhensible.

Le vocabulaire tient en onze mots — décompte, tour, dernier tour, turbo,
bouclier, arrivée, vainqueur — écrits en phonèmes dans `WORDS`. Vérifié sur un
rendu hors ligne : le /a/ de « partez » culmine à 725 Hz pour 730 attendus, le
/ø/ de « deux » à 400 et 1575 Hz pour 400 et 1600, et le « un » ressort
nasalisé, sans aigus.

**Les graves.** Un réacteur gronde en continu, sa hauteur suivant la vitesse,
et chaque impact envoie une descente jusqu'à 27 Hz. Comme un haut-parleur de
téléphone ne restitue pas ces fréquences, le bus des graves passe par une
saturation douce : elle fabrique les harmoniques, et l'oreille reconstitue la
fondamentale qu'elle n'entend pas. Un limiteur ferme la marche — sans lui, un
impact saturé plus le réacteur écrêtaient la moitié des échantillons, mesuré
sur un rendu hors ligne, et plus rien d'autre ne passait.

**Le plongeon.** À l'impact, la vitesse de lecture tombe d'un coup puis
remonte avec le lissage : la bande fait un « wow » de magnétophone qu'on
encaisse en même temps que le mur. On avait d'abord essayé un bégaiement par
repositionnement de la lecture — mauvaise idée : un serveur qui ne gère pas les
requêtes par plage, `python -m http.server` par exemple, ne sait pas
repositionner un média et la lecture repart du début. Jouer sur la vitesse ne
dépend, lui, de rien.

Pour changer de morceau : remplacer `assets/reborn.mp3`, puis ajuster `MUSIC`
dans `src/config.js` — en particulier `bpm` et `beatOffset`, sans quoi le volet
rythmique bat à côté.

## Ce qu'il y a dedans

```
index.html          écrans, logotype « YOU MAN » en SVG
styles.css          habillage, décrochage du logotype
assets/reborn.mp3   You Man — Reborn (160 kb/s)
src/
  main.js           boucle, machine d'états, dosage du glitch
  config.js         réglages communs : pilotage, rendu, musique, corruption
  themes.js         les quatre circuits : tracé, palette, décor, météo
  psx.js            matériaux : accrochage des sommets, placage affine, lumière cuite
  track.js          ruban, murs, voûtes, repérage en espace piste
  scenery.js        décors : ville, béton, tube, orbite
  ship.js           physique du bolide et cockpit
  opponents.js      les cinq adversaires
  rhythm.js         horloge musicale et portiques
  controls.js       gyroscope, manette au doigt, clavier
  hud.js            tableau de bord et sa fonte matricielle 5×7
  post.js           passe finale : tube cathodique, glitch, pluie, tramage
  audio.js          lecture, vitesse variable, graves, réacteur, bruitages
  voice.js          annonceur : synthèse par formants, sans fichier son
  store.js          meilleurs temps et préférences
  ui.js             menus, scores, pause, arrivée
vendor/three/       Three.js r169 (MIT)
```

Le circuit est une boucle fermée échantillonnée une fois pour toutes ; bolides
et adversaires ne s'y repèrent que par deux scalaires — la distance parcourue
et l'écart à l'axe. Pas de physique à intégrer dans le monde, donc pas de
vaisseau qui traverse un mur un jour de ralenti, et une intelligence adverse
qui tient en trois règles : viser une vitesse propre à chacun, lever le pied
dans les virages, éviter le joueur quand il arrive à côté.

## Réglages utiles

| Réglage | Fichier | Effet |
| --- | --- | --- |
| `TRACK.halfWidth` | track | largeur de la chaussée — tout le reste s'y accroche |
| `INPUT.throttleTravel` | config | course du doigt pour aller de 0 à plein gaz |
| `SHIP.corneringDrift` | config | combien le dévers pousse vers l'extérieur |
| `RACE.opponents` | config | nombre d'adversaires |
| `MUSIC.rate*` | config | plage de dérapage de la bande |
| `INPUT.tiltSign` | config | sens par défaut, que le menu peut inverser |
| `MUSIC.bpm` / `beatOffset` | config | calage du volet rythmique |
| `GLITCH.*` | config | fond, rafales, pic de choc, plafond |
| `RENDER.internalHeight` | config | définition interne — le plus gros levier de performance |
| `THEMES` | themes | tracé, palette, brouillard et décor de chaque circuit |

`window.REBORN` expose la scène, le bolide, la piste, l'audio et les menus pour
régler depuis la console. `REBORN.setGlitch(0)` fige la corruption le temps de
juger l'image ; `REBORN.setGlitch(null)` rend la main.

## Compatibilité

WebGL2 (repli WebGL1), navigateurs mobiles récents. Le son démarre au premier
appui — et se retente à chaque tape tant que le navigateur refuse. L'écran
**Contrôles** affiche en clair l'état de la lecture — source, `readyState`,
position, secondes en mémoire, vitesse de lecture, interruptions —, de quoi
diagnostiquer un appareil qu'on n'a pas sous la main. Les capteurs
sont demandés au lancement d'une course, après le son : l'inverse ferait perdre
le contexte de geste et le son serait bloqué. Si la moyenne descend sous 40
images par seconde, le `devicePixelRatio` retombe à 1 ; la définition interne,
elle, ne bouge pas, puisque c'est elle qui fait le style.
