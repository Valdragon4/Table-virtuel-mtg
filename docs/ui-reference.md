# Interface de référence

Ce document décrit l'interface cible, relevée sur la capture de référence fournie. Il
fait autorité sur la disposition et le vocabulaire ; `docs/protocol.md` §14 fait le lien
avec les events.

## Disposition générale

Fond sombre uni (`#0d1117`-ish), **pas de chrome de navigateur simulé**. La table est un
plan pannable/zoomable occupant tout l'espace ; les panneaux d'interface flottent
par-dessus en position fixe.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [Back to Lobby] [lien] [mute] [réglages]  3 players    [Untap All][Draw]   │
│                                                         [Create v][Actions v]│
│ ┌──────────────┐                                        ┌─────────────────┐ │
│ │ d20  Roll… Flip│          ┌─ playmat joueur A ─┐      │ Life  [-] 37 [+]│ │
│ ├──────────────┤          │                      │      │ Commander Damage│ │
│ │ Action Log   │          └──────────────────────┘      │ Library      89 │ │
│ │ Seb's Pest…  │                                        │ Graveyard     3 │ │
│ │ Workris mov… │   ┌─ playmat joueur local ─┐  ┌ playmat│ Exile         0 │ │
│ └──────────────┘   │                         │  │ joueur └─────────────────┘ │
│                    └─────────────────────────┘  └ C ────                    │
│                         ┌── main, cartes agrandies ──┐                      │
└─────────────────────────┴────────────────────────────┴──────────────────────┘
```

## Panneaux

**Barre supérieure gauche** — `Quitter`, bouton copier-le-lien, bouton réglages
(playmat et dos de carte), puis le compte de joueurs.

**Étagère à jetons** — sous le panneau joueur, une palette d'impressions de jetons, et non
une zone de jeu : elle ne contient aucun objet de partie, et poser un jeton depuis
l'étagère revient à un `CREATE_TOKEN`. Elle suit le compte (`UserPrefs.extra`) ou le
navigateur (`localStorage`) pour un invité.

**Boutons d'aléa** — trois pastilles violettes : `d20`, `Roll…` (choix des faces et du
nombre), `Flip`. Résultats poussés dans le journal, jamais calculés côté client.

**Action Log** — colonne gauche, scrollable, fond translucide. Chaque ligne est une
phrase construite depuis un event : l'acteur en gras coloré à sa couleur de siège, les
noms de cartes en accent doré, le verbe au passé. `Press Enter to chat` en en-tête, avec
une icône de bulle. Survoler une ligne mentionnant une carte met la carte en évidence
sur la table.

Exemples de formulation à respecter :
- `Seb's Pest token was destroyed`
- `Seb created a Pest token`
- `Workris moved Forest from library to battlefield`
- `Workris is viewing their library`
- `Workris tapped Fabled Passage`

Ce sont les formulations de la capture de référence ; les phrases réellement produites
sont **françaises et fabriquées par le serveur**, noms de cartes anglais cuits dedans.
C'est un état documenté et non un oubli : voir `docs/i18n.md` §7.

**Lignes portant sur plusieurs cartes.** Elles les **nomment** au lieu d'annoncer un
compte, abrègent au-delà de `NAMED_LOG_LIMIT` (6, dans `@mtg/shared`) en « … et N autres
cartes », et gardent **toutes** les ancres, y compris celles des cartes repliées : le
survol surligne le lot entier. Une ligne abrégée se **déplie au clic** sur un bouton
« Voir les N cartes » — un vrai bouton et non un survol, la PWA se jouant au doigt et le
survol de la ligne étant déjà pris par la mise en évidence. Le client décide de la
dépliabilité à partir des seuls `cardIds`, jamais en découpant le texte.

La règle de visibilité qui gouverne tout cela — une ligne de journal est publique quelle
que soit l'audience de l'event qui la porte — est au §5.4 de `docs/protocol.md`, avec le
détail de `namedBatch`. Elle n'est pas redite ici.

**Barre d'actions haut-droite** — `Untap All`, `Draw`, menu `Create` (token par
recherche, copie d'un permanent, compteur, étiquette), menu `Actions` (mulligan, mélange,
scry, surveil, révéler la main, concéder…).

**Panneau joueur droite** — `Vie` avec `−` rouge et `+` vert encadrant la valeur,
`Dégâts de commandant` dépliable en **matrice complète joueur × joueur, par commandant**,
puis les compteurs de zones : bibliothèque, cimetière, exil, commandement, sideboard. Ces
lignes n'affichent qu'un nombre : le contenu de la bibliothèque n'est jamais transmis.

La matrice se **lit** pour tous les sièges, mais ne s'**écrit** que sur sa propre ligne :
chacun tient le compte des dégâts de commandant qu'il reçoit (§6.6 du protocole). Les
lignes des autres joueurs n'ont donc aucune commande — pas de bouton grisé. Le seuil de 21
est mis en évidence sur n'importe quelle case. Deux partenaires comptent séparément : les
additionner serait faux.

La **taxe de commandant** est affichée dès qu'un commandant existe, même à zéro, avec
`−`/`+` et le surcoût résultant (2 par lancement précédent).

## Zone de jeu d'un siège

Chaque siège est une **carte-panneau rectangulaire** avec son propre playmat en image de
fond (URL libre), bord arrondi, liseré à la couleur du siège.

**Métriques.** Le panneau fait **1260 × 660** unités de monde. Elles ne sont pas rondes
par hasard : une fois retirées les deux colonnes de piles (92 de chaque côté) et le
bandeau d'identité, il reste 1076 × 612 de terrain utile, soit douze permanents par
rangée (83 × 115 chacun) sur quatre rangées — **48 permanents sans chevauchement**. Une
rangée basse de douze terrains, trois rangées au-dessus pour les créatures, les artefacts
et les jetons. Le format précédent, 900 × 480, n'en tenait que 21 et saturait dès qu'un
deck partait en largeur.

- Bandeau d'identité en haut à droite du panneau : pastille de couleur, pseudo, points
  de vie en gros, et deux petits compteurs (cartes en main, autre compteur).
- Colonne de zones sur le bord droit du panneau, de haut en bas : **bibliothèque**
  (dos de carte + compte), **cimetière** (carte du dessus visible + compte),
  **exil** (sombre + compte). Chaque pile affiche son compte dans un badge d'angle.
- Colonne de **zone de commandement** sur le bord gauche, même largeur, commandant
  visible (son identité est publique) et badge de compte.
- Le reste du panneau est le **champ de bataille** du siège, en libre placement (x/y).
- Les tokens identiques posés côte à côte se chevauchent en éventail.
- Les terrains se rangent sur une rangée basse, par convention, sans contrainte serveur.

### Cartes attachées

Une carte attachée se range **sous** sa cible, décalée de `ATTACH_OFFSET` = **13 × 22**
unités de panneau (`SeatPanel.tsx`), et les frères d'une même cible s'écartent en plus
d'un pas de **5 × 8**. Les valeurs ont été resserrées deux fois — 26 × 54, puis 16 × 30 :
trop écartées, les deux cartes ne se lisent plus comme un attachement mais comme deux
permanents voisins. La carte du dessous en montre désormais **32 %** (contre 40 %) ; sous
30 %, il ne reste plus assez de bord pour la viser au pointeur.

Deux choses ne se devinent pas en lisant les chiffres :

- **Le pas entre frères a dû baisser avec le décalage, et pas par symétrie.** Une carte
  attachée à celle de rang 0 se range à un décalage d'attachement de plus, c'est-à-dire au
  milieu de ses frères. Si `2 × SIBLING_STEP` rattrape `ATTACH_OFFSET`, elle disparaît
  exactement sous le frère de rang 2 : la sonde l'a montrée à **zéro pixel atteignable**.
  Il faut donc tenir 13 > 2 × 5 et 22 > 2 × 8.
- **Le plafond n'est plus une impression, c'est un invariant de la recette.**
  `scripts/verify-ui.mjs` refuse un masquage supérieur à **70 %** de l'attachée ; on est à
  **68,2 %**. Resserrer encore fait échouer la recette, ce qui est le but.

Le panneau publie ses constantes sur le DOM via `data-attach-offset`. La recette en gardait
une copie en dur, qui a survécu à deux resserrages : elle annonçait « l'attachée est en
495,311 au lieu de 498,319 » sur un rendu parfaitement sain, et l'on a cherché le défaut du
mauvais côté. Le script étant hors du graphe TypeScript, il ne peut pas importer la
constante : il la lit là, à la source.

## Disposition des sièges

La place d'un panneau est une **fonction pure de son `seatIndex`**, identique sur tous les
clients : deux joueurs voient le même monde aux mêmes coordonnées. C'est ce qui rend les
coordonnées de `CURSOR` (§6.7 du protocole) interprétables par tous.

| Sièges | Grille |
|---|---|
| 1 | 1 × 1 |
| 2 | 1 colonne, 2 rangées — les joueurs se font face |
| 3–4 | 2 colonnes, 2 rangées |

La table est plafonnée à **quatre sièges** (`LIMITS.maxSeats`).

Le confort du « je suis en bas » se rend par le **cadrage** — bouton `Recentrer sur moi`,
posé d'office à l'arrivée — et jamais en faisant tourner le monde selon le siège local.

## Cadrage

Deux boutons, deux cibles distinctes, et aucune marge proportionnelle nulle part
(`Table.tsx`, fonctions `recenter` et `focusOnMe`).

**« Voir toute la table » cadre la grille des sièges, et elle seule.** L'ancien cadrage
embrassait la grille **plus** `sceneryMargin` (`tableBoard.tsx`), qui vaut 0,725 × le plus
petit côté de la grille : la surface cadrée faisait environ deux fois et demie la grille,
et la table devenait un timbre-poste au milieu d'une cour. Le décor n'est pas un élément
de jeu — il borde, il ne se cadre pas. Il ne reste qu'un `FRAME_PADDING` de **8 pixels
d'écran**, dont le mérite est de coûter la même chose à un siège qu'à quatre, là où une
marge proportionnelle coûte d'autant plus que la table est grande.

Mesuré à 1600 × 1000, en unités d'échelle de caméra :

| | avant | après | remplissage |
|---|---|---|---|
| Un siège | 0,424 | **0,825** | 51 % → 98 % |
| Deux sièges | 0,215 | **0,490** | 43 % → 98 % |
| `Recentrer sur moi` | 0,650 | **0,838** | — |

**« Recentrer sur moi » cadre le panneau au pixel exact**, sans marge ajoutée — ce qui
demande une justification, puisque l'autre bouton en garde une. Un siège actif porte un
liseré peint en `outline`, c'est-à-dire **hors** de sa boîte : un cadrage au pixel près
pourrait le faire courir sous une colonne flottante. Mais l'espace libre est déjà
sur-réservé de quoi l'accueillir — le journal s'arrête à 300 px quand la zone libre
commence à 304, le panneau joueur laisse 12 px, et la gouttière étroite en vaut 12 de
chaque côté. Le liseré fait 4 unités de monde, ~3,3 px à l'écran à cette échelle : il
tombe dans ces gouttières. Ajouter `FRAME_PADDING` par-dessus, c'était réserver deux fois
la même place et payer un demi-cran de zoom pour rien.

**Où est désormais la limite — et pourquoi il n'y a plus de zoom à gagner.** Ce qui reste
autour de la table n'est plus une marge, c'est du **letterboxing** : la grille et l'espace
libre n'ont pas les mêmes proportions, l'un des deux axes cale forcément en premier, et
aucune constante ne récupère l'autre.

- **À deux sièges**, la grille fait 1260 × 1368 — du **portrait dans une fenêtre en
  paysage**. C'est la hauteur qui cale, et il reste ~439 px de part et d'autre. Ils sont
  incompressibles : les récupérer supposerait de déformer la grille ou de rogner un
  panneau.
- **À plusieurs joueurs**, c'est la **hauteur** qui borne, mangée par la barre du haut
  (60 px) et le rail de main. Élargir les colonnes latérales ou les escamoter ne rendrait
  donc rien — c'est le bon réflexe et ce n'est pas là que ça se joue.

## Mise en page étroite

En deçà de `NARROW_WIDTH` (**900 px** de largeur de fenêtre), le journal et le panneau
joueur cessent d'être deux colonnes permanentes : ils deviennent un **tiroir replié**,
posé par-dessus la table et ouvert par un bouton de la barre du haut (`pages/Room.tsx`).

Rendues à toute largeur, ces deux colonnes prennent 544 px quels que soient la fenêtre et
l'usage. Sur un écran de 430 px — et l'application est une PWA, donc ce cas est réel —
elles couvraient l'écran entier, le panneau du joueur finissait coupé à droite en
permanence, et la caméra leur réservait une place qui n'existait pas. Repliées, elles
rendent toute la largeur au cadrage (`freeArea`), qui ne garde qu'une gouttière de 12 px
pour le bouton.

**Les largeurs de bureau n'ont pas changé** : au-dessus du seuil, les colonnes sont
toujours là, et un bouton pour les cacher serait un réglage de plus à comprendre.

## Fond de table

Un **paysage d'aube, dessiné**, commun à toute la table et rendu **dans le repère du monde
partagé** : même paysage, même orientation pour tous, ciel en haut du monde et sol en bas.
Les playmats individuels — désormais translucides — se posent par-dessus, par siège, et le
paysage se lit donc *à travers* les zones de jeu. Aucun asset tiers ; un opérateur peut
substituer sa propre image par `VITE_TABLE_BACKGROUND_URL`.

Tout est synthétisé : `tableScenery.ts` produit la géométrie (bruit déterministe
`mulberry32` + fBm, en « ridged » pour les montagnes et doux pour les terrasses),
`TableBackground.tsx` la peint en SVG inline. Création originale de bout en bout : aucune
illustration, aucun lieu nommé, aucun symbole ni typographie de Wizards of the Coast.

### Composition

Du fond vers l'avant, en unités de monde relatives au centre de la grille des sièges :

| Plan | Altitude | Rôle |
|---|---|---|
| Ciel | jusqu'à `cy − 700` | dégradé d'aube, zénith `#0b1738` → horizon `#f7c893` |
| Nuages lenticulaires | `hz − 285` à `hz − 720` | quatre, très étirés, dessus éclairé |
| Îlots suspendus | `cy − 1460`, `cy − 1760` | trois, petits, hors de l'axe de l'astre |
| Astre | **dans un col**, `skyline(x) − 44` | abscisse choisie là où la ligne de crête est la plus basse |
| Chaînes 1 → 5 | `hz − 4` à `hz + 202` | silhouettes qui **s'assombrissent** vers l'avant (`#454f70` → `#28304f`) |
| Tour | crête de la chaîne 2, `cx − 2200` | donne l'échelle de la chaîne |
| Eau lointaine | `hz + 92`, haute de 130 | avec la colonne de reflet de l'astre |
| Pont | `cx − 3250`, chaîne 4 | une arche entre deux crêtes |
| Terrasses 1 → 6 | `cy − 440` à `cy + 1700` | l'escalier de plateaux sur lequel la table est posée |
| Cours d'eau | `hz + 165` → `cy + 2800` | descend **à gauche** de la grille, jamais dessous |
| Semis de conifères | terrasses 1 à 6 | rares, absents d'une bande centrale (`clearHalf`) |
| Monolithes | terrasse 4, `cx + 2850` | trois dalles inégales |
| Masse du premier plan | `cy + 2300` | `#080c15`, ferme la composition par le bas |

**Horizon bas, à `cy − 700`.** C'est le nombre le plus délicat du décor et il a été trouvé
par mesure : un joueur ne voit guère plus de 1 000 unités au-dessus de ses cartes (±1 135
à la vue d'ensemble d'une table à quatre, ±2 000 au dézoom maximal, dont 240 mangées par
le bandeau du haut). Un horizon posé plus haut est un horizon que **personne ne voit
jamais**, et le paysage retombe alors à l'aplat sombre que deux versions successives ont
produit. L'astre suit la même logique : il est placé dans un col de la ligne de crête, et
non à une altitude fixe, sans quoi il est soit avalé par les montagnes, soit poussé sous
le bandeau.

### Lisibilité des cartes

La lumière est laissée libre **partout sauf sous la grille des sièges** :

| Couche | Valeur |
|---|---|
| Halo d'étouffement | ellipse `0,78 × 0,95` de la grille, `#040a18` à 0,40 au centre |
| Aplat sous la grille | rect arrondi aux dimensions de la grille + 40, `#040a18` à 0,24 |
| Playmat de siège (hors décor) | translucide, ~50 % d'assombrissement supplémentaire |

Le plan de terrasse qui passe sous les cartes vaut `#1d2438`–`#181e2f` ; après halo et
playmat il tombe à ~6 % de luminance, contre 80 % pour une carte. Les arêtes éclairées des
terrasses, elles, sont franches au loin (0,30) et presque muettes sous les cartes (0,05).

### Étendue et coût

| Élément | Valeur |
|---|---|
| Débord au-delà de la grille (`BLEED`) | 14 000 unités par côté |
| Étendue à 4 sièges | grille 2568 × 1368, décor 30 568 × 29 368 |
| Grain anti-moirage | une tuile de 160 px en `data:` URI, opacité 0,07 |

Trois propriétés tiennent ce décor, et une régression sur l'une d'elles est un défaut :

- **Aucun bord atteignable.** Les reliefs traversent toute la largeur du décor ; au-delà du
  paysage il n'y a que le ciel zénithal en haut et la masse noire du premier plan en bas,
  deux aplats qui se prolongent sans couture. Il n'y a donc rien à voir au bord, même si on
  l'atteignait.
- **Repère du monde partagé.** La composition est ancrée sur le centre de la grille des
  sièges, jamais sur le siège local : deux joueurs voient la même crête au même endroit, et
  les coordonnées de curseur restent interprétables.
- **Aucun recalcul au pan ni au zoom.** La géométrie est figée par `useMemo` et ne dépend
  que du nombre de sièges ; la peinture n'est faite que de chemins pleins et de dégradés.
  **Aucun filtre SVG n'est appliqué à la surface du décor.** Mesuré à 60 images/s pendant
  un glissement de table, au cadrage de jeu comme au dézoom maximal, table à quatre.

> Piège rencontré deux fois : un `radialGradient` en `gradientUnits="userSpaceOnUse"` avec
> `r="1"` ne suit pas l'ellipse qui le porte — tout ce qui dépasse le rayon reçoit la
> dernière borne, c'est-à-dire un voile uniforme sur tout le décor. Les dégradés radiaux
> sont donc en coordonnées de boîte (`cx/cy/r = 0.5`), les linéaires en coordonnées
> utilisateur (leurs bornes sont des altitudes du monde).

## Main

Rail en bas de l'écran, centré sur le siège local. Les cartes y sont rendues **en grand
et lisibles** (texte d'oracle déchiffrable), légèrement superposées, remontant au survol.

### Main d'un adversaire

Un éventail de dos de carte en bord de son terrain, plus une pastille de compte — le
nombre du bandeau se *lit*, mais il ne se *voit* pas (`OpponentHand.tsx`).

L'éventail rend **toutes** les cartes, une place par carte annoncée. Il en plafonnait dix,
et dix dos immuables ne distinguaient pas une main de onze d'une main de trente. Ce qui
s'adapte, ce n'est pas le nombre de places mais le **pas** : nominal à **18 px** tant que
la main tient dans la largeur disponible, c'est-à-dire jusqu'à **64 cartes**, resserré
juste ce qu'il faut au-delà, et planté à un plancher de **6 px** — en dessous, les
tranches se fondent en un aplat uni et l'œil n'y compte plus rien.

C'est le panneau qui borne l'éventail et non l'inverse, sans quoi une main épaisse irait
recouvrir le siège voisin. Une carte montrée remplace son dos à sa place dans l'éventail.

## Curseurs

Le curseur des autres joueurs est une flèche à la couleur du siège, suivie d'une
étiquette au pseudo sur fond plein. Il porte visuellement la carte en cours de
déplacement. 20 Hz, interpolé côté client entre deux frames.

## Langue

Le détail est dans `docs/i18n.md` ; ce qui se voit à l'écran tient en quatre points.

- **Les cartes s'affichent en français, avec repli anglais**, partout où une carte est
  rendue : table, main, aperçu, fouille, panneaux de zone, révélation publique, étagère et
  recherche de jetons, sélecteur d'impression, éditeur de deck. Le repli est le cas
  **courant** et ne doit jamais ressembler à un incident.
- **Un sélecteur de langue** est monté à deux endroits : variante `segmented` dans la
  barre du haut en partie, variante `select` sur l'accueil. Les deux écrivent la
  préférence du **compte** ; il n'existe pas de « langue de session ».
- **Les libellés de l'interface ne sont pas traduits.** Le catalogue compte 47 clés, pour
  40 composants et 6 écrans : c'est un échantillon d'amorce, pas une couverture. L'écran
  reste donc français quelle que soit la langue choisie.
- **Le journal de partie reste en français**, ses phrases étant fabriquées côté serveur
  avec les noms de cartes cuits dedans, en anglais. C'est l'état documenté ; le coût de
  l'en sortir est consigné dans `docs/backlog.md`.

## Métriques relevées

Mesurées au pixel sur la table de référence, en 1600×1000, partie en cours.
Ce sont ces valeurs qui font foi, pas une approximation à l'œil.

| Élément | Valeur |
|---|---|
| Fond de page | `rgb(17, 24, 39)` — `#111827` |
| Panneaux | `rgb(31, 41, 55)` — `#1f2937`, souvent à 90 % d'opacité |
| Bordures / boutons secondaires | `rgb(55, 65, 81)` — `#374151` |
| Carte en main | **166 × 230 px**, coins ~4,75 % / 3,4 % |
| Permanent sur le champ de bataille | ~83 × 115 px (moitié d'une carte en main) |
| Boutons `Untap All` / `Draw` | 57 × 32, fond `#e5e7eb`, texte `#111827`, rayon 4, padding 6/12, 14 px |
| Pastilles de dés | 93 × 28, fond `#9333ea`, texte blanc, rayon 4, padding 6/8, 12 px |
| Vie `−` / `+` | `#dc2626` / `#16a34a` |
| Colonne du journal | 264 px de large, ancrée à x = 28, y = 124 |
| Panneau joueur droit | ~140 px de large, ancré à droite, y = 76 |
| Barre supérieure | boutons à y = 16 |
| Police | pile système (`-apple-system`), 14 px courant, 12 px pour les dés |

Le champ de bataille de la table de référence est rendu en canvas ; seule la main
est en DOM. Nous rendons tout en DOM avec des transformations CSS — voir la
décision 1 du README. Les dimensions ci-dessus restent la cible.

## Règles visuelles

- Les images de cartes sont chargées **directement depuis Scryfall par le navigateur**,
  jamais via le serveur.
- Aucun symbole officiel de mana n'est embarqué : police libre ou SVG originaux.
- Les cartes tapées sont pivotées de 90°, avec transition courte (120 ms).
- Le foil est un overlay animé CSS/shader appliqué par-dessus l'image Scryfall.
- **Glisser le fond au bouton gauche trace un lasso** : il prend tout permanent que
  le tracé traverse ou qu'il enferme, et ne ramasse que les permanents du joueur —
  `Alt` inclut ceux des adversaires. **La caméra se déplace au bouton droit glissé**
  (ou au clic du milieu) ; un clic droit sans déplacement ouvre le menu du fond,
  c'est le mouvement qui distingue les deux.
  Les cartes tenues par le tracé se marquent **en direct**, d'un liseré ambré discontinu,
  distinct de l'anneau bleu de la sélection acquise.
- Action groupée sur la sélection ; un déplacement de groupe part en un seul `MOVE_CARDS`.
- **Aperçu agrandi** de la carte survolée, **en bas à gauche, toujours**, et sans jamais
  capter le pointeur. Il ne déménage que pour un seul motif : si la carte survolée
  elle-même se trouverait dessous (`lib/previewPlacement.ts`). Un menu, une modale, les
  autres cartes de la table ne comptent pas — un panneau qui se déplace pour des raisons
  que le joueur ne voit pas est un panneau qu'il doit chercher des yeux à chaque fois.
  **Aucune hystérésis, aucune mémoire d'état** : le coin se recalcule de zéro à chaque
  carte survolée, depuis le bas-gauche. Ce n'est pas un raccourci de mise en œuvre mais le
  correctif d'un défaut réel — la version précédente gardait le coin choisi, ne se
  réarmait jamais, et l'aperçu restait collé en haut à droite pour toutes les cartes
  suivantes après une fouille. Le critère ne dépendant plus que de la carte survolée, rien
  ne peut osciller sous un curseur immobile.
- **Marqueurs calculés** : le champ « Périmètre » (compter toutes les cartes, ou toutes
  sauf la porteuse) n'est proposé **qu'en mode figé**. Un marqueur dynamique n'est qu'un
  `kind` relu à chaque rendu, et rien dans cette grammaire ne dit « sauf moi » : le
  proposer dans les deux autres modes promettait un filtre que la pastille n'appliquait
  pas, tandis que l'aperçu, lui, l'appliquait — deux nombres différents pour un seul et
  même marqueur. Un décompte figé pose par ailleurs **un** marqueur et un seul : un `send`
  prématuré en émettait deux, le décompte brut avant exclusion puis la valeur correcte,
  et la carte portait « +3/+3 » sous « +2/+2 » sans qu'on comprenne d'où venait le premier.
- **Panneau latéral des zones**, ancré à droite, à onglets (cimetière, exil, commandement,
  bibliothèque, réserve) et barre de recherche. Aucun bouton d'action sous les cartes :
  clic droit pour le menu, glissement vers la table pour déplacer. L'onglet Bibliothèque
  n'affiche rien — son contenu n'est pas dans le client — et annonce qu'ouvrir une
  consultation est visible des autres joueurs.
- **Clic droit sur le fond** : menu des gestes sans cible (jeton, étiquette, compteur,
  pioche, mélange, dégagement, fin de tour), qui utilise le point cliqué.
- Tout ce qui est fréquent a un raccourci clavier, `?` ouvre la modale d'aide. Un
  raccourci agit d'abord sur la carte **survolée**, sinon sur la sélection, sinon sur la
  table.
- **Aide des raccourcis** : panneau modal de 1024 px au plus, en-tête (titre, règle
  d'arbitrage, bouton de fermeture), corps en colonnes, pied rappelant Échap. Deux
  familles annoncées — « Au survol d'une carte » sur trois colonnes, « Table et souris »
  sur deux. Les touches sont dessinées par la classe `.kbd` (`#374151` dégradé, liseré
  `#4b5563`, 11 px, ombre basse d'un pixel) ; le liant entre deux touches est un `+` ou un
  `/` en `#6b7280`. Accent doré sur les titres de famille, `#111827`/`#1f2937`/`#374151`
  pour le reste.
