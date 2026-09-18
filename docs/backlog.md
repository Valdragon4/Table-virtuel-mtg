# Reste à faire

Liste tenue à jour des demandes reçues et non encore livrées. Elle existe pour
qu'une interruption ne fasse rien perdre : ce qui est fait sort d'ici, ce qui
arrive y entre.

Dernière revue : 18 septembre 2026, après la session de corrections d'interface et
la pose du socle d'internationalisation.

## Demandé, pas encore livré

**Le choix de la langue des cartes** (français / anglais) est livré pour
l'**affichage** : les cartes s'affichent en français avec repli anglais dans
toutes les vues, et la langue est une préférence de compte modifiable en pleine
partie. La solution retenue n'est pas celle qui était envisagée ici — nous
n'ingérons pas un second bulk, nous **résolvons** l'impression traduite carte par
carte (`POST /api/cards/localized`), parce que chez Scryfall une carte française
est un objet distinct et non une variante d'URL. Voir `docs/i18n.md`.

**Ce qui reste de la demande d'origine, c'est la recherche.** L'ingestion ne garde
toujours que `lang = 'en'` (`CATALOG_LANGUAGE`), et rien n'indexe les noms
français : taper « Anneau » ne trouve rien. Le reste des manques est détaillé sous
« Décisions en attente et chantiers ouverts ».


## Interactions de table

Tout ce bloc (I1 à I8) est **livré et vérifié au navigateur** : chaque point est
exercé par une étape de `scripts/verify-ui.mjs`, contre la pile locale
(`docker compose up -d --build`, `http://localhost:3000`). Le détail est sous
« Fait récemment ».

| | Demande | État |
|---|---|---|
| I1 | Déplacer une étiquette déclenche « trop d'actions trop vite » | **fait** — déplacement local, ~6 intents/s au lieu de ~60 |
| I2 | Étiquettes et compteurs libres attachables à une carte | **fait** — menu de l'étiquette, accrochage au clic, décrochage |
| I3 | L'attachement de cartes ne fonctionne pas | **fait** — voir le diagnostic ci-dessous |
| I4 | Main débordant de l'écran | **fait** — resserrement puis défilement à la molette, sur le rail seul |
| I5 | Marque de sélection persistante après le lasso | **fait** — vérifié au navigateur, y compris pour les cartes de main |
| I6 | Indicateur de carte posée face cachée | **fait** — vérifié, et la bascule `M` ne ment plus |
| I7 | Dos de carte sur la pile de bibliothèque | **fait** — dos dessiné, remplacé par le dos configuré |
| I8 | Curseurs des autres joueurs au-dessus des cartes | **fait** — vérifié avec des cartes sur le terrain |

### Reste ouvert, hors de ce lot

| | Demande | État |
|---|---|---|
| U2 | Regrouper dégâts de commandant, marqueurs et compteurs de joueur sur le modèle de `lifeBatch.ts`, et offrir une saisie directe | à faire — `PlayerPanel.tsx` / `CountersPanel.tsx` / `lib/`, hors du périmètre de l'agent d'interaction |
| U3b | `MOVE_CARDS` n'a **aucune entrée d'annulation** dans le moteur, et la pile d'annulation ne garde qu'une entrée par siège : un dépôt groupé, désormais envoyé en un seul lot, ne s'annule donc pas | **serveur** |
| U4 | Reste 15 appels à `window.prompt` (marqueurs, Nième depuis le dessus, jetons rapides…) | à faire |
| U6 | `Détacher` sans effet et `M` à répétition : corrigés côté client ; il reste que `DETACH` n'écrit **aucune ligne de journal** côté serveur | **serveur** |
| U7 | `Ctrl+Z` annonce « plus rien à annuler » là où l'action n'était pas annulable, et aucun bouton « Annuler » n'existe | **serveur** + barre d'actions |
| A1 | Une erreur `t:'error'` non fatale est maintenant montrée ; le socket, lui, n'attend toujours aucun `pong` et ne détecte pas une coupure silencieuse | **`net/socket.ts`** |

## Décisions en attente et chantiers ouverts

Consignés le 18 septembre 2026. Rien n'est tranché ici : ce sont des choix qui
appartiennent au propriétaire du projet, ou des chantiers dont le volume mérite
d'être vu avant d'être lancé. Les points 1 à 6 relèvent de la décision, les 7 et 8
sont des défauts établis qui attendent leur correctif.

### 1. Traduire le journal de partie — le prix est une coupure

Le serveur fabrique des **phrases françaises** et les pousse telles quelles dans
`state.log`, noms de cartes cuits dedans. Traduire le journal impose qu'il publie
une **clé et des paramètres** à la place. C'est un changement de format de
message : il coûte une montée de `PROTOCOL_VERSION`, donc la **déconnexion de
toutes les tables ouvertes** au déploiement, plus une reprise de `engine.ts` et
`engine-2.ts` — y compris la réécriture rétroactive des lignes, qui s'exprime
aujourd'hui par une expression régulière sur du texte français.

Les trois options (laisser en l'état, traduire maintenant, en faire un lot déployé
à une heure creuse) sont posées au §7 de `docs/i18n.md`, qui ne tranche pas non
plus. L'option par défaut en vigueur est « laisser en français ».

**Ce que cela débloquerait du même coup**, et qui est moins évident : le
**dépliage localisé du journal**. Le dépliage d'une ligne abrégée est aujourd'hui
volontairement non traduit, et pour une raison précise — une ligne n'est dépliable
qu'au-delà de six cartes (`NAMED_LOG_LIMIT`), c'est-à-dire exactement quand le
serveur en a déjà nommé six en anglais dans sa phrase. Traduire le seul dépliage
ferait apparaître la même carte sous deux noms à deux lignes d'écart : « déplace
Sol Ring, … et 4 autres cartes » au-dessus d'une pastille « Anneau solaire ». Ce
n'est pas un repli invisible, c'est une contradiction visible. Tant que le serveur
cuit les noms dans sa phrase, mieux vaut tout en anglais que la moitié.

### 2. Les migrations Prisma n'existent pas

`docker/entrypoint.sh` applique le schéma par
`prisma db push --accept-data-loss`, et c'est ce que subit la **base de
production** à chaque démarrage. Les changements récents ont été rendus sûrs pour
ce régime — `UserPrefs.language` est une colonne à valeur par défaut,
`CardLocalization` une table neuve : rien à perdre dans les deux cas. Mais la
garantie vient du contenu du changement, pas du dispositif, et un futur changement
moins anodin (renommage, resserrement de type, contrainte ajoutée) passera par la
même commande.

Mettre en place des migrations versionnées est un chantier à part entière,
**baseline de la production comprise** : il ne suffit pas de créer un dossier
`migrations/`, il faut déclarer l'état existant comme point de départ sans rejouer
la création des tables.

### 3. Extraire les chaînes des 46 fichiers d'interface

40 composants et 6 écrans, dont `LanguagePicker.tsx` déjà traduit. Les catalogues
ne couvrent aujourd'hui que 47 clés d'amorce, choisies pour couvrir les cas durs.

Le travail est **mécanique mais volumineux**, et il est sécurisé par le typage :
une clé absente, un paramètre manquant, une accolade perdue en traduction ou une
clé oubliée dans le catalogue anglais **refusent de compiler** (`docs/i18n.md`
§4.2). Les deux seules règles de conduite : recopier les chaînes mot pour mot, et
nommer les clés par domaine et non par fichier.

### 4. Les lignes de type (`typeLine`) restent anglaises

Partout : menu de carte, fiche d'inspection, éditeur de deck, filtres par famille.
`LocalizedPrinting` ne porte pas ce champ — le serveur ne résout que l'image et le
nom imprimé. L'ajouter, c'est un champ de plus à résoudre et à persister côté
serveur, et le faire pour la seule ligne de type alors que le texte de règles reste
hors de portée (nous ne stockons aucun texte de règles, par choix de droits) donne
une carte à moitié traduite.

### 5. Le tri et le filtre des listes portent sur les noms anglais

Le filtre de recherche d'un panneau de zone (`ZonePanel.tsx`) et celui d'une
fouille de bibliothèque (`LookModal.tsx`, qui trie aussi par nom) interrogent le
nom du **catalogue**. Même chose pour l'ajout d'une carte à un deck, qui tape
`/api/cards/search`. Seule l'étiquette affichée passe au nom imprimé.

**Conséquence assumée : taper « Anneau » ne trouve rien dans son propre deck.** Le
choix inverse coûterait plus qu'il ne rend — trier sur le nom imprimé ferait
**sauter les lignes** à mesure que les traductions arrivent, une carte changeant de
place sous le curseur au moment où sa résolution rentre. Et le nom du catalogue
reste la clé de deck : c'est lui qui part au serveur à l'enregistrement.

### 6. Le faux journal de `TablePreview` est écrit en anglais à la main

C'est le décor de la page d'accueil, sous un en-tête « Journal » en français :
trois lignes anglaises codées en dur (`tapped`, `moved … from library to
battlefield`, `created a … token`), reprises des formulations de la capture de
référence. Rien ne le relie au vrai journal. À reprendre en même temps que le
point 3, ou au moment où le journal se localisera.

### 7. `lib/cards.ts` n'a pas de repos après échec réseau

`lib/cardLocalization.ts` en a un (`RETRY_AFTER_ERROR`, dix secondes) et il a été
ajouté pour **fermer une boucle infinie contre notre propre API** : l'appel échoue,
on prévient les abonnés, ils re-rendent, ils redemandent la carte qui n'est
toujours pas en cache, et l'on repart trente millisecondes plus tard,
indéfiniment. Une panne de quelques minutes devenait un martèlement.

`lib/cards.ts` a exactement la même structure — `.catch(() => undefined)`, puis
retrait de `inFlight` et notification des abonnés — et donc **la même faiblesse**.
Le cas n'a pas été observé en production, mais il ne demande qu'une indisponibilité
de `/api/cards/batch` pour se produire.

### 8. `RESOLVE_LOOK` : une garde manque côté moteur

Le schéma partagé refuse désormais qu'une carte soit citée dans **deux
destinations** à la fois, `toSideboard` compris — le `superRefine` de
`intentSchema`, dans `packages/shared/src/protocol/schemas.ts`. Mais le moteur, lui, **fait
confiance au schéma** : `engine-2.ts` vérifie seulement que chaque carte citée
appartient bien à la consultation, jamais qu'elle n'est citée qu'une fois.

Constaté en contournant la validation : un doublon `toSideboard` + `top` avec
remélange **perd la carte**. L'objet est déplacé en réserve puis réinséré dans la
liste de la bibliothèque, le mélange qui suit lui donne un identifiant neuf, et la
réserve garde un identifiant qui ne désigne plus rien.

Le chemin normal est fermé — aucun client ne peut émettre cet intent — et rien ne
fuit. Mais l'invariant « un objet est dans une zone et une seule » ne doit pas
dépendre d'une validation de frontière : c'est le genre de garde qui manque le jour
où l'on ajoute une huitième destination, comme `toSideboard` l'a déjà montré.

## Fait récemment

- **Session de corrections d'interface** (18 septembre 2026). Cadrage de la table
  (« Voir toute la table » ne cadre plus le décor, « Recentrer sur moi » cadre le
  panneau au pixel exact), mise en page étroite sous 900 px, attachements
  resserrés à 13 × 22 avec le pas entre frères abaissé en conséquence, aperçu de
  carte fixe en bas à gauche sans mémoire d'état, lignes de journal multi-cartes
  nommées et dépliables, éventail de main adverse sans plafond, marqueurs calculés
  (un seul marqueur posé, « Périmètre » réservé au mode figé). Le détail et les
  mesures sont dans `docs/ui-reference.md` ; les manques d'internationalisation
  qui subsistent sont sous « Décisions en attente et chantiers ouverts » ci-dessus.

- **Révélation permanente du dessus de bibliothèque** (16 septembre 2026).
  *Experimental Frenzy*, *Realmbreaker*, *Vizier of the Menagerie* : la carte du
  dessus reste visible et change à chaque pioche. Le choix porte sur les
  **destinataires** — soi seul, un adversaire, toute la table — et n'en cocher
  aucun arrête la révélation ; c'est le même geste dans les deux sens, une
  entrée « Arrêter » n'aurait été proposée qu'à moitié du temps.
  Ce qui rend la chose tenable est qu'elle n'est accrochée à **aucun intent** :
  la carte du dessus bouge sur `DRAW`, `MILL`, `EXILE_TOP`, `SHUFFLE`,
  `RESOLVE_LOOK`, `MULLIGAN`, `UNDO_LAST`, le départ d'un joueur… Tenir cette
  liste, c'est finir par l'oublier quelque part. Le serveur réconcilie donc en
  **un seul point**, `game/topReveal.ts`, appelé en fin de `Room.commit`, et
  n'émet que la différence — le cas courant ne coûte rien.
  L'invariant « les objets de bibliothèque n'ont pas d'identifiant publié »
  n'est pas affaibli : un seul identifiant sort à la fois, `SHUFFLE` les
  réattribue tous, et `CARD_HIDDEN` le reprend dès qu'il cesse d'être le dessus.
  L'exception est écrite et justifiée dans `docs/protocol.md` §6.5.
  À l'écran, la carte remplace le dos sur la pile du révélateur — compte de zone
  lisible par-dessus, aperçu agrandi au survol comme partout — et le
  propriétaire porte sur sa propre pile l'œil qui sert déjà de convention pour
  « cette carte est montrée », dont le titre nomme qui la voit : on ne joue pas
  de la même façon quand un adversaire lit son dessus. `PROTOCOL_VERSION` est
  monté à **3**, sans quoi un onglet resté ouvert afficherait en permanence une
  carte périmée. Dix tests serveur (`apps/server/test/top-reveal.test.ts`) et
  une étape à deux sièges dans `scripts/verify-ui.mjs` — la carte apparaît chez
  l'adversaire, change après une pioche, disparaît à l'arrêt.

- **Le joueur local est toujours en bas — sans casser le repère commun**
  (16 septembre 2026). La disposition des sièges reste une fonction pure du
  `seatIndex` : c'est elle qui rend les coordonnées de `CURSOR` interprétables,
  et nous l'avions déjà payé une fois. On tient donc **deux** dispositions —
  la partagée, dont parlent tous les messages, et l'affichée, qui n'est qu'une
  **réattribution des mêmes cases** — plus une traduction entre elles
  (`lib/seatView.ts`). Ce n'est pas une rotation de pixels : les cartes restent
  droites et aucun panneau adverse n'est à l'envers. Seuls les curseurs et les
  étiquettes flottantes traversent le réseau en coordonnées de monde ; tout le
  reste est déjà relatif au panneau.
  **La recette a attrapé deux erreurs de ma main** : d'abord son propre critère,
  devenu faux (elle comparait le repère de A au partagé, égaux jusque-là) — elle
  mesure désormais la vraie propriété, « le curseur tombe au même endroit du
  même panneau », à 0,3 % près dans les deux sens ; ensuite un `{...toView(...)}`
  diffusé dans un style qui attend `left`/`top`, qui collait tous les curseurs à
  l'origine du plan.
- **Le lasso ne prend que des permanents** (16 septembre 2026). Il balayait tout
  le DOM, et `[data-card]` ne distingue rien : l'aperçu posé sur une pile —
  cimetière, exil, commandement — et les cartes du rail de main entraient dans
  la prise. Le filtre porte désormais sur le **modèle**, pas sur le DOM.
- **Fond de table : l'arène illustrée** (16 septembre 2026). Fournie par le
  propriétaire du projet, elle remplace le dallage composé, qui reste en repli
  libre de droits (`localStorage 'mtg.fond' = 'dalle'`). Deux réglages tirés de
  l'usage : son rapport est respecté (un `100% 100%` l'aplatissait de moitié à
  un seul joueur), et sa taille est **fixe** — calée sur la grille à quatre
  sièges. Calquée sur la grille courante, la cour changeait d'échelle à chaque
  joueur qui s'asseyait.
- **La main d'un adversaire se voit** (16 septembre 2026) : un éventail de dos
  de carte en bord de son terrain, avec le nombre. Le compteur du bandeau se
  lit, mais il ne se **voit** pas — on ne sent pas la différence entre trois et
  sept cartes sans aller la chercher.

- **Marqueurs : valeur libre, côtés indépendants, mots-clés** (16 septembre
  2026). La valeur d'un marqueur était un **entier**, ce qui était trop étroit
  dans les trois sens : impossible d'écrire « X/X », impossible de régler la
  force sans l'endurance, impossible de poser « vol » sans un « 1 » à côté.
  `Label.value` devient du **texte libre**, et l'interface en découle : rien
  → un mot-clé ; `3` → un compteur ; `1/1` → une force et une endurance,
  **chacune avec ses propres − et +**. Le nom devient facultatif dès qu'il y a
  une valeur — un marqueur « 1/1 » se suffit — et le moteur refuse seulement le
  marqueur vide des deux côtés. Tous restent accrochables à une carte.
- **Une carte donnée passe sous le contrôle de qui la reçoit** (16 septembre
  2026). `controller` n'était jamais mis à jour : le dépôt avec Alt sur le
  terrain d'un adversaire — le geste « je te la donne » — la posait bien chez
  lui, mais `assertMayTouch` la lui refusait. Il la voyait sans pouvoir la
  bouger. Le contrôleur est désormais le siège dont la zone porte l'objet ;
  l'`owner`, lui, ne bouge pas, et la carte revient à son propriétaire dès
  qu'elle quitte le champ.
- **Lancer la partie repart d'une table nette** (16 septembre 2026). Tout ce
  qu'on a posé, mis au cimetière ou créé pendant la composition rentre dans la
  bibliothèque ; les jetons cessent d'exister ; les commandants regagnent leur
  zone. Et le compte de mulligans disparaît après le premier tour : il ne
  décrivait plus rien et restait affiché pour le reste de la partie.
- **Attachements : plus serrés, et enfin dans le bon ordre** (16 septembre
  2026). Toutes les cartes attachées à une même cible partageaient la même
  `depth`, donc le même `z-index` : leur empilement retombait sur l'ordre du
  DOM, sans rapport avec leur décalage. Le rang entre désormais dans le calcul.
  **Attention au plafond** : les curseurs des autres joueurs vivent à
  `z-index: 40` ; une première version partait de 100 et les faisait passer
  sous les cartes — la recette d'interface l'a vu immédiatement.
- **Divers, signalés en jouant** (16 septembre 2026) : la taxe de commandant ne
  garde plus l'ancienne carte après un changement de deck (elle est indexée par
  identifiant d'objet, et les objets venaient d'être supprimés) ; l'étagère à
  jetons se réordonne (deux flèches au survol, et non un glisser — le
  glissement sert déjà à poser le jeton sur la table) ; « Surveil 1 » et
  « Meuler 1 » au clic droit de la bibliothèque ; « Passer le tour » sort des
  menus et s'allume quand c'est à nous ; le clic droit d'une sélection propose
  de l'**aligner** ; un jeton porte une marque, sans quoi une copie était
  indistinguable de son original.

- **La resynchronisation relit vraiment la liste** (16 septembre 2026). La
  résolution des impressions, elle, était bien refaite à chaque import : chaque
  ligne est reprise, son `setCode`/`collectorNumber` rejoué, et les
  `DeckCard` entièrement reconstruits. Le défaut était en amont — le **payload
  Archidekt était servi depuis un cache de quinze minutes**. Changer l'édition
  d'une carte chez Archidekt puis resynchroniser dans la foulée rendait donc la
  liste d'avant, impressions comprises, et le bouton répondait « c'est fait »
  sans avoir rien relu. `resyncDeck` passe désormais `fresh: true`, qui
  court-circuite le cache. La politesse envers Archidekt reste assurée par la
  file plafonnée, qui limite le **débit** — elle n'a jamais exigé qu'on refuse
  de relire. La décision est extraite dans `shouldServeCache`, testée : elle ne
  se vérifie pas en regardant du code qui appelle le réseau.
  **Moxfield n'a pas ce traitement, et c'est délibéré** : l'accès y est accordé
  à titre de faveur, et servir le cache y est une règle posée
  (`docs/moxfield.md` §4), pas une optimisation qu'on peut lever.

- **Les emails sont habillés, et leurs liens cliquables** (16 septembre 2026).
  Ils partaient en texte brut : une URL nue que le client mail transformait en
  lien ou pas, selon son humeur. Ils portent désormais la marque, la plaque de
  carton et l'encre violette du site — et un vrai bouton.
  `mailTemplate.ts` est écrit **contre** les contraintes du courrier, pas en
  les ignorant : tout est en ligne (Gmail tronque, Outlook ignore et la plupart
  des clients retirent un `<style>`), la mise en page est un tableau (Outlook
  rend avec le moteur de Word), et le logo est un **PNG** — Gmail et Outlook
  suppriment les `<svg>` sans rien mettre à la place. Comme la plupart des
  clients bloquent les images distantes, **aucune information ne vit dans une
  image** : la marque est écrite à côté, et le rendu a été vérifié images
  bloquées. Le lien est à la fois un bouton et une URL recopiable, la version
  texte subsiste (les filtres anti-spam se méfient d'un message qui n'en a pas).
  Le troisième email — adresse déjà inscrite — était bâti à la main dans
  `routes.ts` ; il rejoint les deux autres. 19 tests verrouillent ces
  propriétés, qu'un rendu dans un navigateur ne montre pas.

- **Main et aperçu suivent la fenêtre** (16 septembre 2026). Les deux étaient
  figés : rail de 244 px avec des cartes à l'échelle 1, aperçu de 440 px de
  haut. Sur un portable de 768 px, la main mangeait un tiers de la hauteur et
  l'aperçu la moitié — au détriment du terrain, qui est pourtant ce qu'on
  regarde. Et à 440 px de haut, l'aperçu fait 317 px de large, **plus large que
  la colonne de gauche** (304 px) : il mordait sur la table.
  **La taille ne dépend que de la fenêtre, jamais du nombre de cartes** : la
  faire varier avec la main ferait changer de taille toutes les cartes à chaque
  pioche, et l'on viserait une carte qui bouge. La densité est déjà absorbée par
  le resserrement du recouvrement puis par le défilement du rail.
  `lib/handMetrics.ts` est partagé entre `Hand` et `Table` — deux calculs
  séparés auraient divergé, et la caméra aurait cadré sur une place que la main
  n'occupe pas. Mesuré : le rail tient entre 22 % et 26 % de la hauteur de
  1180×700 à 1920×1080.

- **Trois défauts signalés en jouant** (16 septembre 2026).
  1. *Charger un deck n'effaçait pas le précédent à l'écran.* L'état serveur
     était bien remis à neuf, mais **aucun event ne l'annonçait** : les clients
     gardaient les objets d'avant, et deux decks se superposaient. `loadDeck`
     émet désormais un `CARD_HIDDEN` par carte retirée et un `TOKENS_DESTROYED`
     pour les jetons — le même traitement que `standUp`.
  2. *Réimporter un deck Archidekt déjà importé* remontait la contrainte Prisma
     brute (`Unique constraint failed on (userId, source, sourceDeckId)`) pour
     un geste légitime. Réimporter une source connue vaut désormais
     **resynchronisation** : c'est ce que l'utilisateur voulait, il n'a pas
     demandé un second exemplaire du même deck. L'apparence du deck (tapis, dos)
     n'est pas touchée, comme pour `resyncDeck`.
  3. *Revenir à la table affichait le salon plusieurs secondes.* La cause du
     délai n'a **pas** été reproduite : trois mesures instrumentées en
     production donnent 162, 195 et 7 315 ms pour la même manipulation, et une
     poignée de handshakes WebSocket bruts y répondent en 120 ms — c'est donc
     intermittent et hors du client. Le symptôme, lui, est supprimé à la
     source : tant qu'on détient un `seatToken` pour cette table et que la
     reprise n'a pas abouti, la page annonce « Reprise de votre place » au lieu
     du salon. Montrer « choisissez un nom et un deck » à quelqu'un qui a déjà
     une main et un terrain était faux quelle qu'en soit la durée — et l'on
     pouvait s'y asseoir une seconde fois par-dessus soi-même.
- **Le nombre de cartes en main devient une pastille** (16 septembre 2026). Il
  s'écrivait « · 7 en main » en gris sur gris ; c'est pourtant l'information
  qu'on consulte le plus souvent chez l'adversaire — elle dit s'il a de quoi
  répondre.

- **Composer son deck depuis la table, avant le lancement** (16 septembre 2026).
  On s'asseyait avec une liste et plus rien n'était modifiable : il fallait
  quitter la table, éditer le deck, revenir. Le panneau « Mon deck » permet de
  changer de deck et de faire passer des cartes entre bibliothèque et réserve.
  **Le point dur était protocolaire** : le client ne connaît aucun identifiant
  de sa bibliothèque (§2.1), il ne pouvait donc désigner aucune carte à sortir.
  Le serveur publie désormais la bibliothèque **à son seul propriétaire et
  seulement en LOBBY** — rien n'est encore mélangé, la liste est celle qu'il
  vient de charger. Le corollaire est indispensable et implémenté :
  `START_GAME` **mélange** chaque bibliothèque en réattribuant tous les
  identifiants et en vidant `knownTo`, sans quoi le joueur entrerait en partie
  en connaissant ses dix prochaines pioches. `RESOLVE_LOOK` accepte en plus
  `toSideboard`, et le menu d'une carte de réserve existe enfin — elle s'y
  voyait sans qu'on puisse rien en faire.
- **Recherche de jetons : les variantes d'un même nom** (16 septembre 2026). Le
  Spirit 3/2 rouge-blanc « n'existait pas ». Il était en base, avec quatre
  impressions : la recherche ne gardait **qu'une impression par nom**, ce qui
  est juste pour une carte — un nom désigne une carte — et faux pour un jeton,
  où seize « Spirit » différents partagent le même nom. Un jeton est désormais
  identifié par nom + type + force/endurance + couleurs, la taille entre dans le
  texte interrogé (« spirit 3/2 » rend le bon en tête) et le sélecteur affiche
  taille et couleur.

- **Le dallage est une vraie texture, sous CC0** (16 septembre 2026). Le
  plateau dessiné rendait la géométrie mais pas la **matière** : ni grain, ni
  usure, ni éclat de bord. Il est remplacé par une photographie de dallage —
  « Large Floor Tiles 02 », Rob Tuytel, Poly Haven, **CC0** (domaine public,
  attribution non exigée ; provenance consignée dans
  `apps/web/public/table/PROVENANCE.md`). Elle est **sans couture** et répétée :
  le fond n'a donc plus de bord du tout, plus seulement un bord hors d'atteinte.
  Version 1K retenue contre la 2K — à la taille projetée la différence ne se
  voit pas, et 558 Ko est déjà le plus gros fichier du site. Restent dessinés :
  l'emblème gravé du centre et le cadre de l'aire de jeu, que seule
  l'application peut caler sur la disposition des sièges. **Le voile des
  playmats a été divisé par deux dans la foulée** : à 42 %/55 %, quatre
  panneaux couvraient la dalle entière et l'on ne voyait plus que quatre vitres
  sombres posées sur rien. Les cartes sont opaques, elles n'ont jamais eu
  besoin de ce voile.
- **Fond de table : un plateau, plus un paysage** (16 septembre 2026). Le
  paysage d'aube avait un haut et un bas — donc un joueur bien placé et trois
  qui regardaient le ciel de côté. Le plateau est **radial**, il se lit pareil
  des quatre côtés. Tout est de la géométrie calculée (`tableBoard.tsx`) :
  aucun asset de Wizards of the Coast ni de Riot, être non commercial n'y
  changeant rien. Deux erreurs corrigées en route, l'une et l'autre visibles
  seulement en jouant : une rosace centrale se retrouvait **sous** le champ de
  bataille dès qu'on jouait à un ou deux (tout l'ornement est désormais bâti
  hors du rectangle de jeu, par construction et non par opacité) ; et un cadre
  placé à une fois et demie la demi-diagonale était **hors de l'écran** à la
  distance où l'on joue. Les dégradés sont exprimés en unités de monde : en
  pourcentage, sur 30 000 px, toute la transition tombe hors de vue et il ne
  reste qu'un aplat uni.
- **Ranger sa main** (16 septembre 2026). On glisse une carte de la main dans
  la main : une fente montre où elle va s'insérer, et elle s'y insère. « Trier
  la main » (menu Actions) range d'un coup — terrains, puis le reste par coût
  croissant. Un rangement n'écrit rien au journal : ce n'est pas une action de
  jeu. **Défaut de fond corrigé au passage** : repositionner une carte dans sa
  zone renumérote toutes les autres côté serveur (`reindexZone`), mais un seul
  `CARD_MOVED` ne parlait que d'elle — les clients gardaient le rang d'avant
  pour le reste de la zone, deux cartes se retrouvaient au même rang, et la
  main s'affichait dans un ordre que le serveur n'avait jamais décidé. Le
  serveur republie désormais l'ordre complet de la zone, et seulement pour les
  zones dont l'ordre est déjà public (`REORDERABLE_ZONES` : main, cimetière,
  exil, commandement, pile) — republier le sideboard ou une pile face cachée
  apprendrait des identifiants aux autres sièges.

- **Une table n'hérite plus de la précédente** (16 septembre 2026). « Créer une
  table » ne demandait plus ni nom ni deck : on atterrissait directement sur la
  table, déjà « assis », avec le panneau, le journal et les cartes de la table
  d'avant. **Pourquoi** : le store (`store/game.ts`) est global et survit à la
  navigation d'une page à l'autre, mais `connect(code)` ne remettait rien à zéro
  — il n'écrivait que `socket`, `roomCode` et `seq` — et `disconnect()` se
  contentait de fermer le socket. `RoomPage` n'affiche le salon que si `mySeat`
  est nul : un siège resté en mémoire lui faisait servir la table. Le troisième
  verrou manquait aussi : `applySnapshot` n'écrivait `mySeat` que si le serveur
  donnait un siège (`...(seat ? { mySeat: seat } : {})`), si bien qu'un snapshot
  de connexion **sans siège** — celui qu'on reçoit justement à une table où l'on
  n'a pas pris place (§13.4 du protocole) — laissait l'ancien siège intact.
  Livré : `blankRoomState()` appliqué à chaque `connect` et à chaque
  `disconnect`, `mySeat: seat` sans condition (le snapshot fait autorité), et
  `RoomPage` qui exige en plus `roomCode === code` pour la frame qui précède
  l'effet. Ce n'était **pas** l'état `closed` du salon ni son ternaire : établi
  au navigateur, `GET /api/rooms/:code` rend bien `closed:false` pour une table
  neuve, `closed` vaut `null` — donc faux — pendant le chargement, et le
  ternaire englobe le bon bloc. Le défaut ne se voyait qu'en **navigation SPA**
  (table → accueil → nouvelle table) : toute étape de recette qui créait sa
  table sur une page fraîchement chargée partait d'un store vierge, et c'est
  exactement pourquoi rien ne l'attrapait. Une étape de `verify-ui.mjs` couvre
  désormais ce chemin.
- **Quitter coûte un clic** (16 septembre 2026). Le premier clic n'était avalé
  par rien — le voile `z-40` passe bien sous le menu `z-50`, et il n'écoute que
  `click`, vérifié au navigateur : le menu s'ouvrait au premier clic et l'entrée
  agissait au second. C'était donc le geste qui était trop cher. « Quitter »
  est maintenant un bouton fendu : le mot s'absente tout de suite (siège tenu),
  le chevron d'à côté n'ouvre que ce qui est rare et irréversible — quitter pour
  de bon, clore la table. À trois entrées dont deux dangereuses, ouvrir le menu
  était surtout l'occasion de se tromper de ligne.
- **« Lancer la partie » ne promet plus ce que le serveur refuse**
  (16 septembre 2026). Le bouton était offert dès le salon, alors que
  `START_GAME` est rejeté tant qu'un siège n'a pas de deck chargé, et le
  chargement d'une liste est asynchrone. Il est désormais désactivé et nomme les
  sièges qu'on attend. C'est la même cause qui faisait échouer
  `scripts/probe-leave.mjs` **en production et pas en local** : la sonde
  attendait « Journal » — qui n'annonce qu'un siège obtenu — puis lançait la
  partie ; en production la résolution du deck prend une seconde de plus, le
  serveur répondait « Deck manquant : Invité·e. », la table restait en `LOBBY`
  et l'attente de `PLAYING` expirait sans dire pourquoi. Prouvé au navigateur en
  lisant `lastReject` après le clic — ce n'était ni la latence Cloudflare, ni le
  socket, ni l'ordre d'arrivée du snapshot. La sonde attend maintenant la
  bibliothèque de chaque siège, et les deux `deckName`, avant de lancer.

- **Application installable (PWA)** (16 septembre 2026). Manifeste complet
  (icônes 192/512 et masquables, raccourcis vers « mes tables » et « mes
  decks »), service worker, invite d'installation retenue et proposée depuis
  l'accueil. **Le worker ne met en cache que notre coquille** : tout ce qui vient
  d'une autre origine — les images de cartes de Scryfall au premier chef — et
  tout `/api` passent au réseau sans jamais être gardés. Un cache est une copie,
  et la règle permanente vaut aussi pour lui. `scripts/probe-pwa.mjs` le
  vérifie en inspectant le contenu réel des caches après deux visites.
- **Souris : le lasso au bouton gauche, la caméra au bouton droit**
  (16 septembre 2026). Le glisser du fond sélectionne, le bouton droit glissé
  déplace la table, et un clic droit sans déplacement ouvre le menu comme avant
  — c'est le mouvement qui distingue les deux. Le geste de caméra est capté en
  phase de **capture**, pour partir même d'une carte ; le menu contextuel qui
  suivrait est avalé une fois, à la racine.
- **La clôture d'une table est effective** (16 septembre 2026). Elle ne faisait
  qu'annoncer la fin : les joueurs continuaient de jouer et pouvaient revenir.
  `GameState.closed` — distinct de `status: 'ENDED'`, qui autorise encore une
  relance — fait refuser tout intent (`ERR_ROOM_CLOSED`), interdit de se
  rasseoir, survit au rechargement depuis la base, et le salon annonce « table
  close » au lieu d'offrir une chaise.

- **Mes tables, quitter pour de vrai, clore une table** (15 septembre 2026).
  « Quitter » ne faisait que ramener à l'accueil : le siège restait tenu, le
  deck posé, et rien ne permettait de retrouver une table depuis un autre
  appareil. Désormais : `GET /api/games` liste les tables où le compte a une
  place (et celles qu'il a ouvertes sans s'y asseoir, sinon un hôte perd la
  sienne en fermant son onglet) ; `POST /api/rooms/:code/leave` et
  `/close` font la même chose hors de la table. En table, `STAND_UP` accepte
  `force` — partir en pleine partie vaut concession, et s'il ne reste qu'un
  joueur la partie se termine — et `CLOSE_ROOM` clôt pour tout le monde,
  réservé au siège hôte. Le client oublie son `seatToken` quand c'est son
  propre siège qui part, faute de quoi il tentait de reprendre une place
  effacée au rechargement suivant.

- **I3 — pourquoi l'attachement ne fonctionnait pas.** Établi au navigateur,
  frames à l'appui : l'intent `ATTACH` **ne partait jamais**. L'unique chemin
  était l'entrée « Attacher à… » du menu contextuel, qui cherchait sa cible
  dans la sélection courante (`[...selection].find(id => id !== card.id)`) et
  refermait le menu sans rien envoyer quand il n'y en avait pas — c'est-à-dire
  presque toujours. Forcé à la main, le reste de la chaîne était sain : le
  serveur acceptait, `ATTACHED` revenait, le store écrivait `attachedTo`. Mais
  le rendu n'en montrait rien : la carte restait à sa place, au-dessus
  (`zIndex: 5`), reliée par une flèche pointillée traversant le panneau. Rien
  dans le geste ni dans l'image ne disait qu'un attachement avait eu lieu.
  Livré : un geste en deux temps (le menu arme, le clic gauche sur une autre
  carte exécute), un bandeau d'attente et un contour pointillé sur la source,
  `Échap` pour annuler, la carte attachée rangée **sous** sa cible avec un
  décalage de 26 × 54 px — elle reste visible aux deux tiers —, un badge
  « 🔗 N » sur la cible, la paire éclairée au survol, et le suivi automatique
  quand la cible se déplace. Les flèches ont été retirées : entre deux cartes
  désormais superposées, elles ne reliaient plus que deux points confondus.
  Tirer une carte attachée la détache, faute de quoi son déplacement n'aurait
  aucun effet visible.
- **I1** — `MOVE_LABEL` n'est plus émis à chaque `pointermove` : le déplacement
  est local pendant le geste (écrit dans le `transform`, hors de React), avec
  quelques positions intermédiaires étranglées à une toutes les 160 ms et une
  position finale au relâchement. Mesuré à la recette : **7 intents en 0,95 s**
  là où il en partait une soixantaine par seconde.
- **I2** — une étiquette s'accroche à une carte par son menu (clic droit), suit
  la carte sans qu'aucun intent ne parte, et se décroche en restant où elle
  est. Ses `x`/`y` deviennent un décalage relatif, converti à l'accrochage pour
  qu'elle ne saute pas. Le clic droit sur une étiquette ne la supprime plus
  sèchement : il ouvre un menu.
- **I4** — la main se resserre à mesure qu'elle grossit (26 → 116 px de
  recouvrement), puis défile à la molette. Défilement plutôt que deux rangées :
  une seconde rangée mange une carte de haut, oblige à choisir laquelle est
  « devant » au moment de glisser, et casse l'éventail où l'on repère ses
  cartes par leur rang. La molette n'est captée que sur le rail, et le zoom de
  la table est intact — les deux sont vérifiés dans la même étape.
- **I5, I6, I7** — vérifiés au navigateur. La sélection acquise garde son anneau
  bleu après le lasso, y compris sur les cartes de main, que le lasso balayait
  sans jamais les marquer. Le repère « face cachée » est visible sur une carte
  dont le propriétaire voit encore l'identité. La bibliothèque montre le dos
  dessiné, remplacé par le dos configuré dans les réglages de siège.
- **I8** — les curseurs passaient sous les cartes parce que les permanents
  portent un `z-index` et qu'un élément positionné sans `z-index` se peint
  dessous, quel que soit l'ordre du document. Les panneaux de siège ne créant
  aucun contexte d'empilement, un `z-index: 40` sur la couche de curseurs porte
  réellement : vérifié avec des cartes sur le terrain, pas sur un plateau vide.
- **Audit des retours (`docs/feedback-audit.md`), part client :** les six events
  ignorés par le store sont traités (`COMMANDER_TAX_CHANGED` — la taxe bougeait
  côté serveur pendant que le joueur lisait « +0 » —, `UNDONE`, `LOOK_STARTED`,
  `HAND_UNREVEALED`, `DICE_ROLLED`, `COIN_FLIPPED`), et le `default:` du
  commutateur avertit désormais en développement. Dé et pièce s'affichent au
  centre comme une bulle de chat. Le bandeau d'identité d'un siège porte « Tour
  N · à vous », « 👁 consulte sa bibliothèque » et « main révélée » — et la main
  révélée est **rendue** sur le panneau de son propriétaire, ce qui manquait
  entièrement. Un intent émis hors ligne n'est plus perdu en silence : `send()`
  rend `null` et le dit.
- **Cible de dépôt en direct.** `findDropTarget` est interrogé à chaque frame du
  glissement : la zone visée s'allume à la couleur de son siège, une pastille la
  nomme sous le fantôme, et un dépôt sans effet grise le fantôme. Un dépôt hors
  de toute zone le dit. Surtout, **poser une carte sur le terrain d'un voisin
  demande Alt** — la même touche que le lasso élargi : le serveur l'accepte, et
  on donnait sa carte sans le savoir. Tout cela est peint hors de React : le
  plan de table n'est pas re-rendu (0 rendu mesuré sur 40 déplacements).
- **Playmat par défaut translucide** : le fond de table se lit à travers, la zone
  reste délimitée par le liseré du siège. Un playmat configuré par un joueur
  reste, lui, opaque.
- **Coût du geste (`docs/ux-polish.md`), part client :** la main se sélectionne
  enfin (clic, Ctrl + clic, Maj + clic pour une plage) — défausser trois cartes
  coûte un intent et une ligne au lieu de trois ; un dépôt groupé hors champ de
  bataille part en un seul `MOVE_CARDS` ; « Jouer » cherche une place libre au
  lieu de reposer chaque carte en (60, 60) ; le menu du fond pose étiquettes et
  compteurs par un champ en place, qui garde la dernière saisie, au lieu de deux
  `window.prompt` ; détruire un jeton demande une confirmation.
- **Quatre joueurs.** `layout()` ne traite plus que 1 à 4 sièges : deux joueurs
  se font face en colonne, trois et quatre forment un carré. La recette remplit
  la table jusqu'au plafond et vérifie qu'aucun panneau n'en chevauche un autre.
- **Recette.** `scripts/verify-ui.mjs` couvre désormais **86 étapes**, toutes
  vertes contre la pile locale. Une étape qui échoue referme les modales avant
  de rendre la main : une assertion périmée faisait auparavant tomber vingt
  étapes saines. Trois assertions ont été mises à jour parce que le produit a
  changé, pas parce qu'elles gênaient : l'aperçu au survol est désormais
  **fixe** à gauche (on vérifie qu'il ne bouge plus), la bascule face cachée est
  une entrée unique, et l'assertion sur le fond accepte aussi bien un décor peint
  en couches CSS qu'en SVG inline — elle vérifie qu'il est **dessiné**, pas
  comment. C'est ce qui lui a permis de rester valable quand le décor est repassé
  au SVG inline pour le paysage.

- **Fond de table : un paysage d'aube, dessiné.** Remplace la pierre et la brume, qui
  étaient techniquement correctes mais ne racontaient rien — « on veut vraiment quelque
  chose de joli comme un immense paysage ». Ciel en dégradé, astre bas posé dans un col de
  la ligne de crête, cinq chaînes qui s'assombrissent vers l'avant, une eau lointaine, six
  terrasses qui descendent jusqu'à la table, un cours d'eau à gauche de la grille, et trois
  accents qui racontent sans rien citer : une tour, un pont, trois monolithes. Géométrie
  procédurale déterministe dans `tableScenery.ts`, peinture SVG dans `TableBackground.tsx`,
  aucun asset tiers. La substitution par `VITE_TABLE_BACKGROUND_URL` est conservée.
  Lisibilité : rien n'assombrit le paysage **hors** de la grille des sièges ; sous la
  grille, un halo et un aplat, auxquels s'ajoute le playmat translucide. Coût : 60 images/s
  pendant un glissement de table, au cadrage de jeu comme au dézoom maximal, table à
  quatre — aucun filtre SVG sur la surface du décor. Deux versions ont été rejetées avant
  celle-ci : la première posait l'horizon à 1 700 unités du centre, là où personne ne le
  voit jamais ; la seconde, corrigée sur la géométrie, restait trop sombre pour se lire.
  Détail complet dans `docs/ui-reference.md`, section « Fond de table ».
- **Recette : le libellé du bouton d'accueil.** `scripts/verify-ui.mjs` visait la chaîne
  exacte « Créer et obtenir le lien » ; le bouton s'appelle désormais « Créer la table et
  obtenir le lien » et **toute** la recette tombait à la première étape. Elle vise
  maintenant `/obtenir le lien/i`. Ce n'est pas une assertion assouplie : c'est un
  sélecteur qui ne dépend plus d'un libellé éditorial.
- Aide des raccourcis refaite : touches dessinées, deux familles en colonnes, en-tête et
  pied, fermeture évidente.
- **D1 — édition d'un deck carte par carte.** Un deck enregistré s'ouvre dans un
  éditeur (`Modifier`, page « Mes decks ») : quantité, zone
  (`Commander`/`Deck`/`Sideboard`), édition, marqueur foil, retrait, et ajout par
  recherche sur la base locale. Sous l'interface, rien de parallèle : l'éditeur
  renvoie ses entrées, le serveur les rend en liste texte et les repasse par le
  parseur, la résolution Scryfall et le rapport d'import — suggestions par
  distance comprises. L'aller-retour texte est couvert par un test dédié
  (`apps/server/test/deck-text.test.ts`).
  - Décision sur les decks synchronisés : **enregistrer une édition détache le
    deck de sa source**, et seulement sur demande explicite. Sans le drapeau,
    le serveur répond `409 SOURCE_SYNCED` et l'interface pose la question.
    Refuser sèchement obligerait à recréer le deck pour corriger une carte ;
    détacher en silence ferait disparaître le bouton « Resynchroniser » sans
    prévenir ; laisser la source en place condamnerait le travail à être écrasé
    à la prochaine synchronisation. Détacher sur confirmation est le seul des
    trois qui ne perd rien en silence, et il se défait à la main en réimportant
    l'URL.
- Déploiement complet : `https://magic.valentin-marot.fr`, conteneurs sur Serveur2,
  vhost et TLS sur Serveur, DNS Cloudflare, SMTP authentifié sur `noreply@valentin-marot.fr`.
- Dégâts de commandant : matrice complète en lecture, écriture réservée au receveur.
- `SCOOP` ne range plus le commandant, qui retourne en zone de commandement.
- Compteurs de joueur supprimables (valeur zéro), panneau dédié.
- Compteurs libres posables partout (étiquette portant une valeur).
- Changement de pseudo et de deck tant que la partie n'a pas commencé.
- Arrivée d'un joueur après le lancement de la partie.
- Option « Ranger les terrains » supprimée.
- Aperçu de carte au survol, ancré en bas à gauche.
- Lasso : le sélecteur DOM ne correspondait à rien, le lasso ne sélectionnait
  rien du tout. Corrigé.
- Journal : le repositionnement d'une carte dans sa propre zone n'est plus
  journalisé (« a déplacé X de champ de bataille vers champ de bataille »).

## Déploiement

La production est `https://magic.valentin-marot.fr`. **Autorisation permanente de
déployer une fois les fonctionnalités validées** (donnée le 15 septembre 2026) :
typage silencieux, tests verts, recette navigateur passée, puis
`bash scripts/deploy.sh`, qui vérifie lui-même la santé du service, le passage par
le reverse proxy et la montée en WebSocket.

Ne jamais déployer pendant qu'un chantier est en cours dans l'arbre de travail :
l'archive transférée emporterait des fichiers à moitié modifiés.

## Décisions de périmètre

- **Quatre joueurs au maximum.** Le mode à huit est retiré (15 septembre 2026).
  `LIMITS.maxSeats = 4`. Le **mode Treachery** est envisagé pour plus tard, sans
  priorité ; il faudra alors revoir le plafond **et** la disposition des panneaux
  ensemble, pas l'un sans l'autre.

## Règles permanentes, à ne jamais enfreindre

- **Rien d'hébergé, rien de proxifié, rien de mis en cache** de Wizards of the
  Coast. Les faces de cartes et le dos officiel s'affichent — la politique de
  contenu de fan l'autorise pour un projet non commercial — mais toujours
  chargés depuis le CDN de Scryfall par le navigateur du joueur. Le dépôt n'en
  contient aucune copie. Tout ce qui n'est pas servi par un CDN public (habillage,
  fond de table, symboles de mana) reste une création originale.
- Les images de cartes sont chargées par le navigateur depuis Scryfall,
  jamais servies ni mises en cache par notre serveur.
- Les mots-clés de Magic restent en anglais (scry, surveil, mill, mulligan,
  sideboard) ; les termes officiels français existants sont utilisés ailleurs
  (engager, dégager, cimetière, exil, bibliothèque, commandant).
- Le client n'invente aucun état : il applique ce que le serveur diffuse. Seule
  exception autorisée, la prédiction locale de la §10 du protocole.
- Un deck appartient à un compte : la propriété se vérifie en base à partir de
  la session, jamais sur un identifiant fourni par le client.
- Éditer le contenu d'un deck le détache de sa source externe. Aucune édition
  manuelle ne survit sous un `sourceUrl` : ce serait du travail promis à
  l'écrasement.
- La disposition des sièges est une fonction pure du `seatIndex`, identique sur
  tous les clients : c'est ce qui rend les curseurs interprétables.
