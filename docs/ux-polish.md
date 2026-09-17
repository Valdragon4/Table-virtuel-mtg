# Le coût du geste

Relevé sur la pile locale (`docker compose up -d --build`, `http://localhost:3000`), en
jouant réellement : deux à trois contextes Chromium, listes collées, partie lancée, et des
**séquences entières** plutôt que des gestes isolés — poser un champ de bataille, engager
pour attaquer, encaisser une attaque avec ses dégâts de commandant, chercher une carte,
mulliganer deux fois, lancer son commandant, défausser en fin de tour, passer le tour à
trois joueurs. Six scripts Playwright sur le modèle de `scripts/verify-ui.mjs`, chacun
comptant ce qui part vraiment sur le socket (`WebSocket.prototype.send` instrumenté, hors
`CURSOR`), ce qui s'écrit au journal, et ce qu'il faut de clics et de pixels de trajet.

Ce document ne parle **pas** des retours manquants : c'est le sujet de
`docs/feedback-audit.md`, et les points qu'il a ouverts (cible de dépôt, taxe muette,
refus sous les modales, « à vous » sur le bandeau) ont été livrés sous cet audit-ci — je
les ai vus fonctionner et je ne les redis pas. Ici la question est une autre :

> *Ce geste-là, le joueur va le faire dix fois ce soir. Combien coûte-t-il, et
> qu'est-ce qui l'empêche de coûter un seul mouvement ?*

L'étalon est le regroupement des points de vie : douze clics, **un** intent, **une** ligne.
La bonne nouvelle est que ce patron est déjà écrit, isolé et testable
(`apps/web/src/lib/lifeBatch.ts`, 79 lignes) et qu'il ne demande qu'à être réemployé. La
mauvaise est qu'il ne l'a été nulle part ailleurs — et j'ai la mesure côte à côte pour le
prouver :

| Le même joueur, la même seconde | intents | lignes de journal |
|---|---|---|
| encaisse 7 points de dégâts (vie) | **1** | **1** — `Bob passe à 33 points de vie (-7)` |
| encaisse 7 dégâts de commandant | **7** | **7** — `Bob a subi 1…`, `…2`, `…3`, `…4`, `…5`, `…6`, `…7` |

C'est la même attaque, dans la même fenêtre de deux secondes, sur deux panneaux distants
de 40 pixels. Capture : `p04-cmd-damage.png`, où le journal d'Alice est intégralement
occupé par le décompte de Bob.

---

## Par où attaquer

Classement par gain réel : fréquence du geste × coût actuel × facilité de mise en œuvre.

| # | Friction | Ce que ça coûte aujourd'hui | Coût de mise en œuvre |
|---|---|---|---|
| 1 | **La main ne se sélectionne pas** | tout geste sur plusieurs cartes de main est unitaire : défausser 3 = 6 clics, 3 intents, 3 lignes | **faible** |
| 2 | **Dégâts de commandant à l'unité** | 8 clics sur des cibles de 20 px, 7 intents, 7 lignes — puis 792 px de trajet pour refaire la vie | **faible** |
| 3 | **Marqueurs et compteurs à l'unité** | 4 marqueurs = 4 intents, 4 lignes contradictoires (`a mis 1…`, `a mis 4 marqueur(s)`) | **faible** |
| 4 | **Fouiller sa bibliothèque à l'œil** | 59 cartes, 4 696 px de défilement dans une fenêtre de 600 px, aucun filtre | **moyen** |
| 5 | **Le dépôt groupé n'est pas un lot** | 4 cartes glissées = 4 intents, 4 lignes, et `Ctrl+Z` n'en ramène qu'**une** | **faible** (client) + **moyen** (serveur) |
| 6 | **Tout nombre passe par `window.prompt`** | 17 appels, 22 actions : 2 clics + une modale bloquante + une frappe, sans mémoire | **moyen** |
| 7 | Mulligan londonien sans remise dessous | à 2 mulligans : 4 clics de plus, 2 lignes qui ne disent pas « dessous » | **faible** |
| 8 | Jouer une carte la pose toujours en (60, 60) | un replacement à la main par carte jouée au clavier ou au double-clic | **faible** |
| 9 | La vie est à 1 035 px de la main | un aller-retour complet par ajustement | **faible** |
| 10 | Le panneau des compteurs n'est jamais monté | l'entrée de menu ne fait rien ; le repli est deux `prompt` enchaînés | **trivial** |
| 11 | Un scry ne se réordonne pas | l'action centrale du scry est indisponible | **moyen** |
| 12 | Détruire un jeton est sans filet | irréversible, sans confirmation, juste sous une entrée voisine | **faible** |

---

## 1. La main ne se sélectionne pas — la friction la plus chère du produit

### Observé

```
clic simple sur une carte de main      -> selection.size = 0
Ctrl + clic sur une carte de main      -> selection.size = 0
en-tête du menu contextuel             -> « Swamp »   (jamais « · 3 sélectionnées »)
```

Conséquences mesurées, toutes vécues à chaque partie :

| Séquence | Clics | Intents | Lignes |
|---|---|---|---|
| Défausser 3 cartes en fin de tour | **6** (3 clics droits + 3 entrées de menu) | 3 `MOVE_CARD` | 3 |
| Remettre 2 cartes dessous après deux mulligans | **4** | 2 `MOVE_CARD` | 2 |
| Poser 5 cartes sur le champ | 5 glissements de ~400 px | 5 `MOVE_CARD` | 5 |

À comparer au champ de bataille, où le même travail est déjà **parfait** : lasso sur
6 permanents puis `T` → **1 intent, 1 ligne**, `Alice a engagé Swamp, Swamp, Plains,
Llanowar Elves, Llanowar Elves, Swamp`. Tout est en place — la sélection partagée, le
groupement `MOVE_CARDS` du menu contextuel, l'en-tête « · N sélectionnées » — sauf que la
main n'y participe pas. `Hand.tsx` lit `selection.has(card.id)` pour l'anneau bleu mais
n'appelle jamais `setSelection` : une carte de main ne peut entrer dans la sélection que
par un lasso qui la balaie au passage, c'est-à-dire par accident.

### Proposition

Faire participer la main à la sélection, avec **exactement** le code qui existe déjà :
`ZonePanel.pick()` (clic / `Ctrl`+clic / `Maj`+clic pour une plage, ancre en `useRef`) est
écrit, testé à l'usage, et se transpose tel quel dans `Hand.tsx` sur le `onPointerDown`
qui démarre déjà le glissement. Rien d'autre à faire :

- le menu contextuel groupe déjà (`targets = selection.has(card.id) ? [...selection] : [card.id]`) ;
- `move()` envoie déjà un `MOVE_CARDS` unique hors champ de bataille ;
- le serveur applique déjà les mêmes gardes carte par carte (§6.1 du protocole).

Défausser trois cartes redevient : `Ctrl`+clic, `Ctrl`+clic, `Ctrl`+clic, clic droit,
`Défausser` → **5 gestes, 1 intent, 1 ligne** (`Alice a déplacé 3 carte(s) vers cimetière`).
Avec le raccourci `G` au survol, c'est même 4 gestes et zéro menu.

**Coût : faible.** Une trentaine de lignes dans `Hand.tsx`, aucun changement de protocole,
aucun changement serveur. C'est la meilleure ligne du document.

---

## 2. Encaisser une attaque de commandant

### Observé

Séquence réelle : Alice attaque Bob avec son commandant pour 7.

1. Bob déplie `Dégâts de commandant` — **1 clic** (le panneau est replié par défaut, même
   quand une valeur y est non nulle).
2. Bob clique **7 fois** sur un bouton de **20 × 20 px** (`h-5 w-5`, `PlayerPanel.tsx`).
3. **7 intents** `SET_COMMANDER_DAMAGE`, **7 lignes** de journal chez tout le monde.
4. Puis il doit **aussi** retirer 7 points de vie : 7 clics de plus, sur un bouton situé
   **792 px** au-dessus de son champ de bataille et **1 035 px** de sa main.

Total : 15 clics et deux panneaux pour une seule attaque, dont 7 clics produisent le
huitième au dixième de la surface utile de l'écran de journal.

Trois défauts distincts, tous réparables :

- **Aucun regroupement**, alors que la vie, elle, en a un.
- **Aucun couplage à la vie**, alors que les deux chiffres bougent toujours ensemble.
- **Une cible de 20 px** pour un bouton cliqué sept fois d'affilée.

### Proposition

**(a) Regrouper**, en réemployant `lifeBatch.ts` généralisé (voir §3) : la clé devient
`(from, commanderId)`, l'affichage montre le cumul en attente comme la vie le fait déjà,
et l'envoi part 1,5 s après le dernier clic. Attention : `SET_COMMANDER_DAMAGE` porte une
**valeur absolue**, pas un delta — le cumul local s'ajoute donc à la dernière valeur
serveur connue, et le rendu affiche `valeur + cumul`, strictement comme `shownLife`.

**(b) Coupler la vie, sur demande explicite.** Une case à cocher persistante dans le
panneau, `Retirer aussi les points de vie`, cochée par défaut. Quand le cumul part, deux
intents partent ensemble : un `SET_COMMANDER_DAMAGE` et un `ADJUST_LIFE` du même delta —
exactement les deux gestes que le joueur fait déjà à la main. **Ce n'est pas un moteur de
règles** : le client ne décide de rien, ne lit aucune carte, ne connaît aucun combat ; il
exécute deux fois ce que le joueur vient de saisir une fois. Le joueur garde la main pour
décocher (prévention de dégâts, remplacement) et pour corriger l'un sans l'autre.

**(c) Ouvrir le panneau d'office** dès qu'une case de sa propre ligne est non nulle, et
agrandir les boutons à 24 px comme ceux de la vie.

Résultat : 1 clic + 7 clics sur une cible confortable, **2 intents, 2 lignes**
(`Bob a subi 7 dégâts de commandant de Alice` et `Bob passe à 33 points de vie (-7)`), et
zéro traversée d'écran.

**Coût : faible.** Le regroupement est une généralisation de 40 lignes existantes ; le
couplage est une case à cocher et un second `send`.

---

## 3. Un seul regroupement, pour toute la famille des compteurs

### Observé

Quatre marqueurs `+1/+1` posés au clavier sur une créature : **4 intents, 4 lignes**.

```
Alice a mis 1 marqueur(s) +1/+1 sur Plains
Alice a mis 2 marqueur(s) +1/+1 sur Plains
Alice a mis 3 marqueur(s) +1/+1 sur Plains
Alice a mis 4 marqueur(s) +1/+1 sur Plains
```

Le journal est non seulement bavard, il est **trompeur** : les quatre lignes se lisent
comme quatre ajouts successifs de 1, 2, 3 puis 4 marqueurs, soit dix marqueurs.

Le même défaut, à l'identique, sur : la taxe de commandant (`SET_PLAYER_COUNTER` par clic),
les compteurs de joueur, les compteurs libres portés par une étiquette.

### Proposition

Promouvoir `lib/lifeBatch.ts` en `lib/deltaBatch.ts`, générique sur une clé de chaîne et
un constructeur d'intent. Trois abonnés immédiats, dans l'ordre de fréquence :

| Clé | Intent envoyé au repos | Affichage du cumul |
|---|---|---|
| `counter:<cardId>:<kind>` | `ADD_COUNTER { delta }` | badge `+3` sur le coin de la carte |
| `cmddmg:<from>:<commanderId>` | `SET_COMMANDER_DAMAGE { value }` | pastille sur la case, comme la vie |
| `tax:<objectId>` | `SET_PLAYER_COUNTER { value }` | pastille sur `+N` |

Trois précautions, toutes déjà résolues dans `lifeBatch` :

- **vider à la sortie** — `flushLife` est appelé au démontage de `PlayerPanel` ; un
  marqueur doit de même partir si la carte quitte le champ de bataille, ou si le joueur
  agit ailleurs sur la même carte ;
- **cumul nul = rien** — autant de `+` que de `−` n'écrit pas de ligne ;
- **la prédiction reste locale** (§10 du protocole) : l'adversaire ne voit rien tant que
  le joueur compte, et c'est précisément le but.

**Coût : faible.** Un fichier généralisé, trois appelants (`Shortcuts.tsx`,
`CardMenu.tsx`, `PlayerPanel.tsx`), et un test unitaire sur le même modèle que celui de la
vie.

### Le corollaire : savoir taper le nombre

Un joueur qui encaisse 12 dégâts sait **qu'il en encaisse 12**. Le regroupement lui évite
de polluer la table ; il ne lui évite pas douze clics. Rendre la valeur affichée éditable
au clic — un champ qui accepte `28`, `-12` ou `+7`, `Entrée` valide, `Échap` annule —
supprime les douze clics d'un coup, et coûte un petit composant réutilisé quatre fois :
vie, dégâts de commandant, taxe, marqueur de carte. C'est le complément naturel du
regroupement, pas son remplaçant : les deux servent deux mains différentes.

---

## 4. Chercher une carte dans sa bibliothèque

### Observé

`Actions ▾` → `Fouiller la bibliothèque` ouvre la modale de consultation. Mesuré sur une
bibliothèque de 59 cartes (capture `t02-fouille.png`) :

```
cartes montrées        : 59
champs de saisie       : 0        <- aucun filtre
listes déroulantes     : 59       <- une par carte
hauteur visible        : 600 px
hauteur totale         : 4 696 px  -> 7,8 écrans à faire défiler
rang de « Sol Ring »   : 7e sur 61
```

Pour prendre une carte précise il faut la **trouver à l'œil** dans 7,8 écrans d'images
(cinq par rangée, la sixième rognée par le bord de la modale), puis ouvrir sa liste
déroulante, choisir `Main`, puis `Valider et mélanger`. Un tuteur, c'est dix à vingt
secondes de défilement, plusieurs fois par partie — et pendant ce temps la table attend,
puisque la consultation verrouille la zone côté serveur.

Le comble : le **panneau des zones**, lui, a le filtre qu'il faut (`Filtrer par nom…`,
`ZonePanel.tsx`), et chercher dans un cimetière de trente cartes y prend deux secondes.
L'outil existe, il n'est simplement pas là où il sert le plus.

### Proposition

**(a) Un champ de filtre dans `LookModal`, en mode `SEARCH` uniquement.** C'est le même
`input` que celui du panneau des zones, avec le focus posé à l'ouverture : on tape
`sol`, il reste une carte.

**(b) Un tri par nom, en mode `SEARCH` uniquement.** Il est **sûr au regard du protocole**,
et c'est important de le dire : le serveur brasse déjà volontairement ce qu'il envoie
(§6.4 — `sortIndex` porte le rang montré, pas le rang réel), et une fouille impose
`shuffleAfter: true`. Trier une liste déjà brassée ne révèle rien de l'ordre réel. Le même
tri sur un `SCRY` serait en revanche une faute : là, l'ordre montré **est** l'information.

**(c) Des pastilles de destination au lieu d'une liste déroulante.** Sous chaque carte,
`Main · Champ · Cimetière · Exil · Dessous` en une rangée : un clic au lieu de deux, et la
destination se lit sans ouvrir.

Un tuteur devient : `Actions` → `Fouiller` → taper trois lettres → un clic sur `Main` →
`Valider et mélanger`. Cinq gestes, aucune recherche visuelle.

**Coût : moyen.** Une soixantaine de lignes dans `LookModal.tsx`, aucun changement de
protocole ni de serveur — `RESOLVE_LOOK` accepte déjà les résolutions partielles.

---

## 5. Un dépôt groupé n'est pas un lot

### Observé

Quatre permanents pris au lasso (`selection.size = 4`), glissés ensemble vers le cimetière :

```
-> 4 intents [MOVE_CARD, MOVE_CARD, MOVE_CARD, MOVE_CARD]
-> 4 lignes  « Alice a déplacé Swamp de champ de bataille vers cimetière » ×4
```

Et surtout, en cas d'erreur :

```
cimetière : 0 -> 4 -> 3   après Ctrl+Z
Ctrl+Z n°2 : « Plus rien à annuler dans les dix dernières secondes. »
```

**Une seule des quatre cartes revient.** Les trois autres se récupèrent à la main, soit
trois glissements de plus et trois lignes de journal de plus : une erreur de 0,3 seconde
coûte sept lignes et six gestes.

La cause est un écart entre deux chemins qui font la même chose : `CardMenu.move()` envoie
un `MOVE_CARDS` unique hors champ de bataille (c'est écrit, commenté, et ça marche),
tandis que `DragLayer` boucle sur `group` et envoie un `MOVE_CARD` par carte. Côté
serveur, `undoStack` est une **Map d'une seule entrée par siège** (`room.ts:84`) : le
dernier intent écrase le précédent, donc N intents ne sont annulables qu'une fois.

### Proposition

**(a) Côté client** — dans `DragLayer`, aligner le dépôt sur le menu : si la destination
n'est pas un champ de bataille et que le groupe fait plus d'une carte, un seul
`MOVE_CARDS`. Le champ de bataille garde ses `MOVE_CARD` individuels, puisque chaque carte
y porte ses propres coordonnées — c'est déjà la raison invoquée dans `CardMenu`, elle vaut
ici aussi. Une dizaine de lignes.

**(b) Côté serveur** — donner une entrée d'annulation à `MOVE_CARDS` (`engine.ts:435`, qui
n'en renvoie aucune aujourd'hui, et efface donc même celle d'avant). Le patron existe :
`undoRestore(state, obj.id, before, rng)` est déjà utilisé par `MOVE_CARD` ; il s'agit de
le construire pour une liste. Sans (b), (a) rend le dépôt propre au journal mais
**toujours pas annulable** — il faut les deux.

**(c) À considérer** — porter `undoStack` à une pile de quelques entrées par siège (trois
à cinq), toujours dans la fenêtre de dix secondes et toujours invalidée dès qu'un autre
siège a joué. La garde sociale — « quelqu'un a joué depuis » — est ce qui rend
l'annulation acceptable à une table ; elle ne dépend pas de la profondeur.

Après : un dépôt groupé de quatre cartes = **1 intent, 1 ligne, 1 `Ctrl+Z`**.

---

## 6. Tous les nombres passent par `window.prompt`

### Observé

**17 appels à `window.prompt`** dans `apps/web/src`, qui couvrent 22 actions :
`Piocher X`, `Scry N`, `Surveil N`, `Regarder N`, `Mill N`, `Exiler le dessus N`,
`Défausse au hasard N`, `Nième depuis le dessus`, `Marqueur personnalisé` (deux prompts
enchaînés), `Compteur de joueur` (deux prompts enchaînés), `Nombre de faces` du dé, texte
d'étiquette, nom de compteur libre.

Le coût d'un `Scry 2` mesuré bout en bout : ouvrir `Actions ▾`, cliquer
`Regarder N cartes du dessus…`, **une modale native bloquante** par-dessus la table, taper
`2`, `Entrée`, puis la modale de consultation, puis `Valider`. Sept gestes pour ce qui est,
à une vraie table, un coup d'œil.

Le prompt natif ne coûte pas seulement des gestes :

- il **bloque le fil** — pendant qu'il est ouvert, la table ne se rafraîchit plus ;
- il ne **retient rien** : celui qui fait `Surveil 1` vingt fois retape `1` vingt fois ;
- il n'est **pas habillable**, donc il rompt l'habillage partout où il apparaît ;
- il est ce que la recette doit neutraliser par `addInitScript` pour pouvoir jouer, ce qui
  est le signe clinique d'un contrôle hors du produit.

### Proposition

Remplacer chaque prompt numérique par une **rangée de valeurs fréquentes, en ligne dans le
menu**, sans modale :

```
Scry        [1] [2] [3] [X…]
Surveil     [1] [2] [3] [X…]
Mill        [1] [3] [5] [X…]
Piocher     [1] [2] [3] [7] [X…]
```

`Scry 2` devient deux clics au lieu de sept gestes, et `X…` ouvre un petit champ posé dans
le menu — pas une modale du navigateur. Le patron existe déjà dans le produit :
`TokenSearch` a son `<input type="number">` posé dans son en-tête, et il se manie bien.

Trois prompts textuels méritent le même traitement pour une autre raison : l'étiquette et
le compteur libre sont posés **à l'endroit cliqué**, et une modale native qui recouvre la
table fait perdre de vue cet endroit. Un champ posé au point du clic, qui valide sur
`Entrée`, rend le geste continu.

Les deux `window.confirm` restants — `Scoop` et `Concéder` — sont **à garder** : ce sont
des actions destructrices, sans annulation, et leur confirmation est le seul filet. Voir
la section des fausses bonnes idées.

**Coût : moyen.** Un composant de choix numérique, puis un remplacement mécanique site par
site. Peut se faire par étapes, en commençant par `ZoneMenu` et `Toolbar`, qui concentrent
15 des 17 appels.

---

## Deuxième rang — vrai gain, moindre fréquence

### 7. Le mulligan londonien s'arrête au milieu

Deux mulligans : `Alice a pris un mulligan (2) — 2 carte(s) à remettre dessous`. Puis
**rien**. Aucun écran ne demande lesquelles, aucun rappel ne subsiste, aucun compte à
rebours. Le joueur doit se souvenir de sa dette, puis remettre les cartes une par une :
**4 clics, 2 intents, 2 lignes**, et les lignes disent `a déplacé une carte de main vers
bibliothèque` — sans même préciser *dessous*.

**Proposition.** Le serveur connaît déjà le nombre dû (il l'écrit dans la phrase du
journal ; il est aussi dans l'event). À la réception, la main entre dans un mode
« choisissez 2 cartes à remettre dessous » : un liseré sur le rail, un compteur `0/2`, la
sélection de la §1, puis un bouton `Remettre dessous` qui envoie **un** `MOVE_CARDS`
`index: 'BOTTOM'`. Une ligne : `Alice a remis 2 carte(s) sous sa bibliothèque`. Aucun
arbitrage de règles là-dedans — on rend visible un nombre que le serveur a déjà calculé et
déjà dit.

**Coût : faible**, une fois la §1 livrée.

### 8. Jouer une carte la pose toujours au même endroit

Le double-clic sur une carte de main, `P`, et `Jouer` du menu envoient tous
`x: 60, y: 60`. Jouer trois terrains d'affilée les empile **au même pixel** ; il faut
ensuite les replacer à la main, un glissement chacun. Le menu contextuel décale bien de
24 px par carte, mais seulement au sein d'un même lot.

**Proposition.** Une fonction purement géométrique, côté client : le prochain
emplacement libre de la grille du panneau (83 × 115, douze par rangée — les métriques sont
déjà dans `ui-reference.md`), calculé à partir des `x/y` des permanents que le client
connaît déjà. Le serveur reste maître de la position qu'on lui envoie ; aucune règle de
Magic n'entre en jeu, c'est un placement de rangement. Un geste de moins par carte jouée
au clavier, soit facilement dix par partie.

Deuxième défaut du même endroit : le double-clic sur une carte de main **joue la carte**,
et cela n'est écrit nulle part — l'aide des raccourcis n'annonce le double-clic que comme
`Engager / dégager`. Deux comportements pour un même geste, un seul documenté.

### 9. La vie est à l'autre bout de l'écran

Distances mesurées sur un écran de 1 600 × 1 000, table à deux joueurs :

| Trajet | Pixels |
|---|---|
| Main → bouton `−` de la vie | **1 035** |
| Mon champ de bataille → bouton `−` | **792** |
| Main → menu `Actions ▾` | **1 116** |
| Mon champ → menu `Créer ▾` | **799** |

Le bandeau de mon propre siège affiche déjà mes points de vie, en gros, **au milieu de
l'écran** (`SeatPanel.tsx:260`) — mais en lecture seule.

**Proposition.** Poser `−` / `+` et la pastille de cumul en attente sur ce bandeau, pour
le **siège local uniquement**. Le regroupement existant fait le reste : le joueur compte
là où sont ses yeux et sa souris, et un seul intent part. Le panneau de droite reste ce
qu'il est, pour qui préfère y aller. Une vingtaine de lignes, aucune invention : c'est le
même `queueLifeChange` appelé depuis un second endroit.

### 10. Le panneau des compteurs n'est jamais monté

`Room.tsx` déclare `const [countersOpen, setCountersOpen] = useState(false)`, le passe à
`TableMenu`… et **ne lit jamais `countersOpen`** : `grep -c countersOpen` donne 1 (la
déclaration, `setCountersOpen` mis à part). Vérifié au navigateur : cliquer
`Compteurs de joueur…` dans le menu du fond n'ouvre rien, silencieusement.

Il reste donc un seul chemin pour poser un compteur de joueur : `Créer ▾` →
`Compteur de joueur…` → prompt `Type de compteur` → prompt `Valeur`. Et comme
`SET_PLAYER_COUNTER` porte une **valeur absolue**, passer le poison de 1 à 2 impose de
refaire les quatre étapes en retapant `poison` puis `2` — en connaissant de tête la valeur
courante. Mesuré : `Alice : poison = 1`, puis `Alice : poison = 2`, deux allers-retours
complets.

`CountersPanel.tsx` (145 lignes) fait exactement ce qu'il faut — les six compteurs
courants d'une table en un clic, `−`/`+`, `Retirer` — et il est écrit, importé, inerte.

**Proposition.** `{countersOpen && <CountersPanel onClose={() => setCountersOpen(false)} />}`.
Une ligne. À vérifier au navigateur, et à couvrir par une assertion de recette pour qu'un
panneau ne redevienne pas orphelin sans que rien ne le dise.

### 11. Un scry ne se réordonne pas

Inspection de la modale ouverte sur un `Scry 3` :

```
boutons : ["Valider et mélanger", "Valider"]
éléments déplaçables : 0
```

Aucun moyen de changer l'ordre du dessus. Le pied de la modale annonce pourtant
« L'ordre du "dessus" est celui d'affichage, de gauche à droite » — un ordre sur lequel le
joueur n'a aucune prise. Le seul geste disponible est d'envoyer une carte dessous. Or
réordonner les cartes gardées **est** le scry ; `RESOLVE_LOOK.top` est déclaré comme
« ordre final, du dessus vers le bas » et `REORDER_TOP` existe dans le protocole : c'est
l'interface qui n'expose rien.

**Proposition.** Deux petites flèches `←` `→` sur chaque carte du seau `Dessus`, qui la
déplacent dans la liste, et un numéro d'ordre lisible sur son coin. Le glisser-déposer
serait plus élégant, les flèches sont plus sûres et se testent. `RESOLVE_LOOK` transporte
déjà l'ordre : rien à changer côté serveur.

### 12. Détruire un jeton est sans filet

`Détruire le jeton` est la dernière entrée du menu d'une carte, en rouge, juste sous
`Ranger ce jeton sur l'étagère`. Elle part sans confirmation, et `DESTROY_TOKEN` ne
renvoie **aucune entrée d'annulation** (`engine-2.ts:155`) : `Ctrl+Z` ne peut rien. Sur une
sélection, elle emporte tout le groupe. Le jeton se recrée depuis l'étagère si son
impression y était, sinon il faut repasser par la recherche.

Asymétrie à noter : le produit confirme `Scoop` et `Concéder` — réversibles par une partie
qui recommence — et ne confirme pas la seule action de table franchement irréversible.

**Proposition.** Donner à `DESTROY_TOKEN` une entrée d'annulation (le serveur connaît
l'objet qu'il vient de supprimer ; le recréer avec un **nouvel `ObjectId`**, comme le veut
la §2.1, est acceptable — le jeton n'a pas d'historique caché). À défaut, une confirmation
au-delà de deux jetons. Pas de confirmation à l'unité : elle coûterait plus souvent qu'elle
ne sauverait.

---

## Ce qui est déjà bien, et qu'il ne faut pas casser

- **Le regroupement des points de vie.** `lifeBatch.ts` est le meilleur morceau du
  produit : isolé, court, commenté par sa raison d'être, hors de React pour qu'un clic ne
  re-rende pas la table, vidé au démontage, silencieux sur un cumul nul. Ne pas le diluer
  dans un état global au moment de le généraliser.
- **Le lasso et l'action groupée sur le champ de bataille.** Six permanents engagés en un
  intent et une ligne nommant les six : c'est le modèle que le reste doit rejoindre. Le
  marquage ambré en direct pendant le tracé, écrit hors de React, est à conserver tel quel.
- **La cible de dépôt en direct.** Le liseré à la couleur du siège, la pastille de nom de
  zone, `déjà là` en gris, et `Alt pour donner la carte` sur le terrain du voisin : c'est
  exactement le bon niveau de friction — le geste dangereux demande une touche, les autres
  non.
- **Le panneau des zones.** Filtre par nom, onglets avec leurs comptes, aucune rangée de
  boutons sous les cartes, glissement direct vers la table. C'est le bon patron ; §4
  consiste à l'étendre là où il manque.
- **L'étagère à jetons.** Reposer un jeton déjà posé coûte **un clic** ; le glisser choisit
  l'endroit. C'est le seul endroit du produit où la répétition a déjà été traitée pour
  elle-même.
- **`Tout dégager`, `Piocher`, et l'arbitrage des raccourcis** (survol > sélection >
  table). `U` et `D` coûtent une frappe et un intent chacun ; l'aide de `?` explique la
  règle avant la liste, ce qui est le bon ordre.
- **La taxe de commandant dérivée.** Lancer son commandant depuis la zone de commandement
  fait passer la taxe à `+2` sans un clic. Vérifié.
- **Le refus de dépôt, et le bandeau au-dessus des modales.** Le message explique le geste
  à faire, pas l'erreur commise.

---

## Fausses bonnes idées, et pourquoi je les ai écartées

**Ranger automatiquement le champ de bataille (aligner les terrains, trier les créatures).**
L'option `Ranger les terrains` a été retirée le 15 septembre, et c'était juste : un
rangement automatique déplace les cartes des autres sous leurs yeux, efface les
regroupements que le joueur a construits (ce qui bloque quoi, ce qui est déjà déclaré
attaquant) et impose une notion de « terrain » que le serveur n'a pas. Le placement au
prochain emplacement libre de la §8 est autre chose : il n'agit **qu'au moment de poser
une carte**, et ne touche jamais à ce qui est déjà en place.

**Engager automatiquement les terrains quand on lance un sort.** Moteur de règles, sans
appel : il faudrait savoir ce qu'est un terrain, un coût, une couleur. Le lasso plus `T`
fait déjà le travail en un intent.

**Déduire les points de vie d'un combat.** Même raison. Le couplage proposé en §2 n'est
pas cela : il ne lit aucune carte et ne calcule rien, il répète un nombre que le joueur
vient de saisir lui-même, et se décoche.

**Une pile d'annulation profonde, avec « annuler jusqu'à ».** Attirant, et faux à une
table : dix secondes après, l'adversaire a joué, et défaire trois actions réécrit une
situation que tout le monde a déjà vue et commentée. La garde actuelle — dernière action,
dix secondes, invalidée si quelqu'un a joué — est le bon compromis social. Je propose
seulement de rendre **atomique** ce qui est un seul geste (§5), et éventuellement trois à
cinq entrées dans la même fenêtre.

**Raccourcir le délai de regroupement de la vie à 600 ms.** Ce serait couper en deux le
décompte d'un joueur qui hésite, donc deux lignes au lieu d'une : exactement le défaut
qu'on corrigeait. 1,5 s est bien choisi. En revanche, vider le cumul quand le joueur agit
ailleurs — ouvre un menu, glisse une carte — est gratuit et ne coûte aucune attente.

**Rendre le contenu de la bibliothèque consultable dans le panneau des zones, pour
chercher vite.** Interdit, et à raison : la zone est privée même pour son propriétaire, et
le serveur brasse ce qu'il envoie pour ne pas révéler l'ordre. La §4 fait porter le gain
sur la **présentation** d'une consultation déjà annoncée, jamais sur l'accès.

**Trier ou filtrer la modale d'un `SCRY`.** Là, l'ordre montré *est* l'information : le
trier détruirait le sens du geste. Le filtre de la §4 se limite strictement au mode
`SEARCH`, dont le contenu est déjà brassé et dont la résolution impose un mélange.

**Supprimer les confirmations de `Scoop` et de `Concéder`.** Ce sont les deux seules
actions vraiment coûteuses à réparer, et elles vivent dans un menu où le pointeur passe
souvent. Leur confirmation est le seul filet du produit — la vraie anomalie est ailleurs
(§12), et c'est un manque de filet, pas un excès.

**Un raccourci pour chaque chose, ou une palette de commandes.** Il ne reste que douze
touches libres (`a i j k n o q r v w x z`), l'arbitrage survol/sélection/table est déjà
subtil à expliquer, et une palette ferait un second vocabulaire à apprendre à côté des
menus. Le gain est dans les gestes qu'on répète — regrouper, sélectionner, taper un
nombre — pas dans l'ajout de touches.

**Un pavé numérique flottant façon calculatrice pour la vie.** Trois fois plus de surface
qu'un champ éditable, pour le même service. Le champ inline de la §3 est plus petit, plus
rapide au clavier, et se réemploie tel quel sur quatre panneaux.

---

## Ce que je n'ai pas pu observer

- **La production.** Tout a été joué sur `http://localhost:3000` ; je n'ai pas exercé de
  séquences sur `magic.valentin-marot.fr`.
- **La latence.** Sur `localhost`, l'aller-retour est de quelques millisecondes. Une bonne
  part de l'intérêt du regroupement est justement de masquer une latence que je n'ai pas
  pu simuler — et certains verdicts (« ce geste est instantané ») seraient à revoir sur un
  lien lent.
- **Le tactile et les écrans étroits.** Tout en 1 600 × 1 000 à la souris. Les cibles de
  20 px de la §2 sont sans doute pires au doigt, mais je ne l'ai pas mesuré ; le clic
  droit, socle de presque tous les menus, n'a pas d'équivalent tactile étudié.
- **Quatre joueurs.** J'ai joué à trois et fait le tour de table complet ; la disposition
  2 × 2 du plafond à quatre sièges n'a pas été exercée, ni l'encombrement des panneaux
  flottants à cette densité.
- **La fin de partie.** `CONCEDE`, `RESTART_GAME`, `SWAP_SIDEBOARD` et le passage d'une
  manche à l'autre n'ont pas été joués — leur coût en gestes reste à mesurer, et c'est un
  moment de partie où l'on est pressé.
- **Le compte connecté.** Tout a été joué en invité : l'étagère à jetons vivait dans
  `localStorage`, pas dans `UserPrefs.extra`. L'éditeur de deck et la page « Mes decks »
  ont été lus, pas exercés au navigateur.
- **Un point à surveiller.** `apps/web/` était en cours de modification par un autre agent
  pendant tout le relevé ; les numéros de ligne cités valent pour l'état du dépôt au moment
  de la rédaction, et le point 10 (panneau des compteurs non monté) pourrait être un
  chantier en cours plutôt qu'une régression installée — à vérifier avant de le corriger.

---

**Méthode et traces.** Six scripts et leurs captures sont dans le répertoire de travail
temporaire de la session : `…\316f8c8d-…\scratchpad\` (`play1.mjs` … `play6.mjs`, dossier
`shots/`). Chaque chiffre de ce document vient d'une exécution, pas d'une lecture du code :
les intents sont comptés sur le socket, les lignes lues dans `window.__mtg.getState().log`,
les distances mesurées par `getBoundingClientRect` sur la table réelle.
