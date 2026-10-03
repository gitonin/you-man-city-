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

Le son et les capteurs sont réclamés **au tout premier appui**, celui qui amène
sur le titre. L'ordre n'est pas libre : le son d'abord et sans attendre, les
capteurs ensuite. iOS ouvre une boîte de dialogue pour `requestPermission`, et
toute attente avant `play()` ferait sortir du contexte de geste, auquel cas le
son serait refusé. Refusés, les capteurs sont redemandés à la tape suivante.

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
| **METEOR RUN** | parcours bonus : ligne droite, aucun adversaire, esquiver des barrages |

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

**Il n'y a pas de carlingue dessinée.** Une version précédente peignait une
verrière en bas de l'image, dans l'esprit des vues cockpit d'époque, et la
changeait même en vaisseau sur ce circuit-ci. Elle mangeait le tiers inférieur
de l'écran, c'est-à-dire précisément la portion où arrive la piste sur un
téléphone debout. On voit mieux sans.

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
linéaire à l'écran. Plus le polygone est grand, plus la torsion se voit, d'où
une piste volontairement grossière : **trois quads en travers**. Elle n'en a eu
qu'un pendant longtemps, ce qui était encore mieux — jusqu'à ce que la chaussée
passe à trente-cinq unités de large et que la carlingue disparaisse du bas de
l'image. Le bord le plus proche était alors vu si rasant qu'un unique texel
s'étalait sur un tiers de l'écran. Pour la même raison, l'œil est monté de 2,9
à 4,4 unités au-dessus du revêtement.

**Éclairage cuit.** Aucune lampe dans la scène. La lumière est calculée à la
construction et rangée dans la couleur des sommets, comme à l'époque.

**Basse définition et 15 bits.** La scène est rendue dans une cible de 448
pixels de haut, puis étirée au plein écran au plus proche voisin. La passe
finale réduit à 15 bits avec un tramage ordonné 4×4, ajoute les lignes de
balayage, la pluie, le bombement du tube et la vignette.

## Le décompte

Trois, deux, un, go — et chaque chiffre claque. `pop` descend de 1 à 0 depuis
son apparition et fait trois choses à la fois : le chiffre naît grand et se
resserre, les trois composantes de couleur partent écartées et se recollent, et
le bandeau derrière lui s'ouvre. L'image prend un coup de corruption au même
instant. Un chiffre qui apparaîtrait simplement, à taille fixe, ne donnerait
aucune impulsion — c'est le resserrement qui fait le compte.

La fonte étant une matrice de pixels dessinée au carré, le « zoom » est un
changement d'échelle entière : on ne peut pas grossir de 1,37, donc on choisit
l'entier le plus proche. Le pas se voit, et c'est tant mieux.

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

**Le morceau est décodé en mémoire et joué par Web Audio.** Il a fallu trois
versions pour en arriver là, parce que la lecture lâchait à l'accélération pour
trois raisons différentes et cumulées :

1. un élément média se nourrit du réseau au débit de l'encodage. Comme la
   vitesse de lecture suit celle du bolide, accélérer consomme le fichier plus
   vite qu'il n'arrive. Mesuré, connexion bridée à 144 kb/s, course à plein
   régime : au fil de l'eau la position n'avance pas d'une seconde en neuf,
   `readyState` reste à 0. Précharger en `Blob` a réglé celle-là ;
2. les navigateurs coupent le son d'un élément média dont la vitesse sort
   grossièrement de [0.5, 4], et le plongeon à l'impact descendait à ×0.41
   depuis le ralenti. Borner la vitesse a réglé celle-là ;
3. il restait, sur Safari mobile, que `playbackRate` sur un élément média avec
   `preservesPitch` désactivé produit un silence à chaque écriture — et on en
   fait une par image. Celle-là ne se contourne pas, elle se fuit.

`AudioBufferSourceNode.playbackRate` n'a aucun de ces défauts : la hauteur suit
la vitesse par construction, le changement est échantillon par échantillon, et
il n'y a plus de réseau du tout une fois le morceau décodé.

**Le prix, et comment on le paie.** Quatre minutes trente-huit en Float32
coûtent une centaine de mégaoctets, d'où le contexte ouvert à **32 kHz** quand
l'appareil l'accepte : on perd ce qui est au-dessus de 16 kHz, c'est-à-dire
rien d'audible sur un morceau électronique, et on tombe à soixante-dix. Et sur
iPhone, l'interrupteur latéral coupe la sortie d'un `AudioContext` : on le
neutralise en déclarant `navigator.audioSession.type = 'playback'`, possible
depuis iOS 16.4. Avant ça, le mode silencieux coupe le jeu — c'est le seul
recul par rapport à l'élément média, et il est assumé.

**L'écran de démarrage.** On ne donne la main qu'une fois le morceau
téléchargé *et* décodé, barre de progression à l'appui. Ni le `fetch` ni le
décodage ne demandent de geste — le contexte audio naît suspendu et se réveille
au premier appui —, donc tout se fait pendant que l'écran est affiché. Le
décodage occupe une à trois secondes sans rendre la main : il a son étape
nommée, sans quoi la barre semblerait figée à 80 %. Si la bande-son est
introuvable, on entre quand même, en le disant : le jeu reste jouable, le volet
rythmique se tait.

**La courbe de vitesse a trois points, pas deux.** Une rampe droite de l'arrêt
au plein régime faisait monter le morceau d'un ton et demi sur la seconde
moitié de la plage, là où l'on passe le plus de temps : c'était du dessin
animé. On garde donc le ralenti au départ, on cale la vitesse normale à
mi-régime — c'est l'allure de croisière du jeu, le morceau doit y sonner comme
il a été écrit — et la montée au-delà n'est plus qu'une inflexion.

| Vitesse | Lecture |
| --- | --- |
| à l'arrêt | ×0.68 |
| **mi-régime** | **×1.00** |
| plein régime | ×1.10 |
| survitesse | ×1.15 |
| turbo | ×1.20 |

**Le tempo.** Le fichier a été mesuré : **119 BPM pile**, premier temps à
46 ms, grille vérifiée du début à la fin du morceau. La position de lecture
n'est plus donnée par le navigateur : le lissage de vitesse est confié à
`setTargetAtTime`, et la position est intégrée analytiquement sur la même
exponentielle — `∫ target + (r₀−target)e^{−s/τ} ds`. Avancer d'un simple
`dt × rate` dériverait de plusieurs dixièmes sur la durée du morceau, et la
grille rythmique avec. Vérifié en course : dix-huit temps en huit secondes à
vitesse de lecture moyenne 1,14, soit exactement 119 BPM × 1,14.

De cette horloge découlent : vingt-huit portiques lumineux qui battent la
mesure le long du circuit, une lumière qui en fait le tour à la noire, un coup
de corruption sur chaque temps fort, deux filets qui pulsent dans le HUD, et
une note de la gamme quand on passe sous un portique.

**L'annonceur, en anglais.** Les voix sont synthétisées, sans aucun fichier son
(`src/voice.js`). Le principe est celui des synthétiseurs vocaux d'époque : une
dent de scie à hauteur fixe — d'où le timbre de robot — traverse trois filtres
passe-bande réglés sur les **formants**, ces résonances du conduit vocal qui
font qu'on entend un « a » plutôt qu'un « i ». On fait glisser les trois
fréquences d'un phonème au suivant, on remplace la source par du bruit pour les
sifflantes, on coupe net pour les occlusives, et la parole apparaît. Une
modulation en anneau ajoute le grain numérique sans rendre le mot
incompréhensible.

La table de formants est celle de l'anglais américain, d'après les mesures de
Peterson et Barney. Les diphtongues ne sont pas listées : on les écrit comme
deux voyelles d'affilée et le glissement entre phonèmes les produit tout seul,
ce qui *est* une diphtongue. Le r américain tient en un troisième formant qui
s'effondre à 1690 Hz. Vocabulaire : *three, two, one, go, lap, final, turbo,
shield, boost, finish, winner, warning, systems*. Vérifié sur un rendu hors
ligne : le /iː/ de « three » sort à 300 et 2080 Hz pour 270 et 2290 attendus, et
le /oʊ/ de « go » est bien saisi en plein glissement, à 520 et 940 Hz, entre ses
deux cibles.

**Les bruitages.** Chaque son est bâti en couches plutôt qu'en une seule forme
d'onde, parce qu'un oscillateur seul, quelle que soit sa forme, sonne comme un
oscillateur seul :

| | |
| --- | --- |
| **réacteur** | fondamentale sous 50 Hz, deux dents de scie désaccordées de quelques cents dont le battement évite le bourdon figé, turbine en bruit filtré, et un partiel métallique en modulation de fréquence qui ne se réveille qu'au-delà de la mi-régime — c'est lui qui fait entendre l'effort plutôt qu'un ronflement qui monte |
| **portiques** | trois dents de scie désaccordées dans un passe-bas résonant qui se referme, plus une cloche en modulation de fréquence de rapport 1,41 : un rapport non entier donne des partiels inharmoniques, qu'aucune forme d'onde ne produit |
| **choc** | descente grave jusqu'à 27 Hz, fracas de tôle en bruit filtré, et trois partiels de rapports 1 / 2,37 / 3,91 aux décroissances inégales qui sonnent la coque |
| **survitesse** | montée de bruit, gonflement grave, et un chirp en modulation de fréquence qui monte de 300 à 1300 Hz |
| **turbo** | une aspiration — du bruit qui enfle à l'envers — avant le décrochage de grave et la montée |
| **tonnerre** | voir plus bas |

**Les graves.** Le réacteur gronde en continu, sa hauteur suivant la vitesse,
et chaque impact envoie une descente jusqu'à 27 Hz. Comme un haut-parleur de
téléphone ne restitue pas ces fréquences, le bus des graves passe par une
saturation douce : elle fabrique les harmoniques, et l'oreille reconstitue la
fondamentale qu'elle n'entend pas. Un limiteur ferme la marche — sans lui, un
impact saturé plus le réacteur écrêtaient la moitié des échantillons, mesuré
sur un rendu hors ligne, et plus rien d'autre ne passait. Palette entière
rendue hors ligne : crête 0,803, aucun échantillon écrêté.

**Le plongeon.** À l'impact, la vitesse de lecture tombe d'un coup puis
remonte avec le lissage : la bande fait un « wow » de magnétophone qu'on
encaisse en même temps que le mur. On avait d'abord essayé un bégaiement par
repositionnement de la lecture — mauvaise idée du temps de l'élément média, un
serveur qui ne gère pas les requêtes par plage ne sachant pas repositionner un
média. Jouer sur la vitesse ne dépend, lui, de rien.

Pour changer de morceau : remplacer `assets/reborn.mp3`, puis ajuster `MUSIC`
dans `src/config.js` — en particulier `bpm` et `beatOffset`, sans quoi le volet
rythmique bat à côté.

## Le parcours bonus

METEOR RUN ne se court pas comme les autres, et c'est pour ça qu'un écran
l'explique avant de lancer : une seule traversée, aucun adversaire, **les gaz
se mettent seuls**, et la seule décision qui reste est de passer à gauche ou à
droite d'un barrage.

Un barrage est un rideau de roche en travers de la piste, percé d'une ouverture
dont la position est tirée au sort. C'est **l'ouverture qui est placée en
premier** et les blocs qui en découlent, jamais l'inverse : poser des blocs au
hasard produirait tôt ou tard un mur sans passage, et un parcours où l'on ne
peut que mourir n'est pas un parcours. Les trente barrages se resserrent vers
la fin, en puissance 0,88 de l'abscisse.

Les blocs ne sont pas des objets physiques : comme tout le reste du jeu, ils
vivent en espace piste — une abscisse, un intervalle latéral — et la collision
est un test de franchissement sur deux scalaires. Chacun est habillé de trois
rochers et souligné d'un bandeau lumineux de sa propre largeur ; deux montants
orange plantés aux lèvres de l'ouverture complètent le dessin. Le tout se lit
d'un coup : deux barres, un trou entre elles, et le trou est là où il faut
passer. Sans ce balisage, la roche sombre sur fond d'espace noir se voyait trop
tard.

Le tracé est un arc de rayon 3400 sur dix-huit points de contrôle, sans lobe ni
ondulation : sur les six cents unités qu'on voit devant soi, la piste dévie de
moins de trois largeurs, et elle se lit comme une ligne droite. Un vrai segment
ouvert n'aurait pas de bout — tout le repérage du jeu est en boucle fermée.

## L'orage

Sur les circuits sous l'averse, un éclair tombe toutes les cinq à seize
secondes. Ce n'est pas un flash : c'est une salve de deux à quatre décharges
très brèves, séparées de quelques dizaines de millisecondes, dont les dernières
sont plus faibles — c'est ce hachage qui distingue un éclair d'une lampe qu'on
allume.

La décharge **multiplie** la scène au lieu de s'y ajouter, en linéaire et avant
la conversion d'affichage. Ajoutée uniformément, elle relevait aussi le noir et
délavait l'image en une bouillie bleue ; multipliée, elle brûle ce qui est
éclairé et laisse les ombres sombres, ce qui est le propre d'un éclair. Elle se
reflète en même temps sur la chaussée mouillée.

Le tonnerre arrive après, retardé de 0,25 à 2,65 seconde selon la distance
tirée au sort, et il en dépend : loin, c'est une traîne de bruit très filtré sur
plus de quatre secondes avec un roulement grave dessous ; près, le passe-bas
s'ouvre, la traîne se raccourcit et un craquement sec se pose en tête. C'est ce
décalage qui place l'orage dans l'espace plutôt que dans le haut-parleur.

La pluie au sol est un calque additif plaqué sept centièmes d'unité au-dessus
du revêtement, dans la même extrusion que la piste : il suit donc le dévers et
les bosses sans aucun calcul. Sa texture est noire presque partout — seules
ressortent les traînées de reflet, étirées dans le sens de la marche puisque
c'est ainsi qu'on voit une route mouillée à cette vitesse, et les impacts de
gouttes. Son opacité scintille en permanence et blanchit d'un coup sous un
éclair.

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
  ship.js           physique du bolide et caméra
  opponents.js      les cinq adversaires
  rhythm.js         horloge musicale et portiques
  controls.js       gyroscope, manette au doigt, clavier
  hud.js            tableau de bord et sa fonte matricielle 5×7
  post.js           passe finale : tube cathodique, glitch, pluie, tramage
  audio.js          décodage, vitesse variable, graves, réacteur, bruitages, orage
  voice.js          annonceur anglais : synthèse par formants, sans fichier son
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
| `MUSIC.sampleRate` | config | taux du contexte — c'est lui qui fixe la mémoire du morceau |
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
appui — et se retente à chaque tape tant que le navigateur refuse. iOS 16.4 ou
plus récent pour que le mode silencieux ne coupe pas le jeu. L'écran
**Contrôles** affiche en clair l'état de la lecture — décodé ou non, secondes
en mémoire, position, vitesse, état et taux du contexte audio —, de quoi
diagnostiquer un appareil qu'on n'a pas sous la main. Les capteurs
sont demandés au lancement d'une course, après le son : l'inverse ferait perdre
le contexte de geste et le son serait bloqué. Si la moyenne descend sous 40
images par seconde, le `devicePixelRatio` retombe à 1 ; la définition interne,
elle, ne bouge pas, puisque c'est elle qui fait le style.
