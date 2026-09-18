# Protocole temps réel — table virtuelle MTG

Document de référence verrouillant l'architecture réseau. Source unique de vérité :
les types présentés ici sont maintenus dans `packages/shared/src/protocol/`.
Toute divergence entre ce document et `packages/shared` est un bug.

**Statut : validé (v5).** Les arbitrages de la §13 sont arrêtés ; l'implémentation du
jalon 5 s'y conforme. Les v3 et v4 ne touchent pas à `PROTOCOL_VERSION` : elles
écrivent noir sur blanc les règles d'étanchéité et de légalité structurelle que
le serveur applique, et la v4 ajoute un seul type d'event (`NOTED`, §7) — un
ajout, donc non cassant au sens de la §11. La v5, elle, **monte la version** :
la révélation permanente du dessus de bibliothèque (§6.5) ajoute un champ au
snapshot qu'un client ancien ignorerait en silence, et il afficherait alors une
carte périmée sur la pile — c'est exactement le cas que la §11 appelle cassant.

- Version de protocole décrite : `3` (`PROTOCOL_VERSION = 3`)
- Autre constante partagée par les deux côtés : `NAMED_LOG_LIMIT = 6` (§5.4)
- Transport : WebSocket natif, `wss://<host>/ws/rooms/:code`
- Encodage : JSON UTF-8, une frame texte = un message. Le passage à un encodage binaire
  est prévu comme optimisation transparente (§11).

---

## 1. Principes

1. **Le serveur est autoritatif.** Le client n'applique jamais un changement d'état de
   son propre chef, sauf en prédiction locale purement cosmétique (§10).
2. **Le client envoie des _intents_, le serveur diffuse des _events_.** Un intent n'est
   pas un event : il peut être rejeté, transformé, ou produire plusieurs events.
3. **Un seul compteur de séquence par room.** Chaque event porte un `seq` strictement
   croissant, sans trou, partagé par tous les sièges. C'est la base de la resynchro.
4. **La visibilité est appliquée à l'émission, pas à la réception.** Un event est
   sérialisé une fois par « classe de visibilité », jamais filtré côté client. Ce qu'un
   siège n'a pas le droit de voir ne traverse pas le socket (§5).
5. **Aucune règle de jeu.** Le serveur valide la légalité *structurelle* (l'objet
   existe, la zone cible est valide, l'auteur a le droit d'agir), jamais la légalité au
   sens des règles de Magic. Ce principe n'a pas bougé d'un mot ; il a désormais une
   **frontière écrite**, parce qu'une fonctionnalité l'a approchée d'assez près pour
   qu'on doive dire de quel côté elle tombe (§1.1).

---

### 1.1 La frontière : assister n'est pas arbitrer

**Ce paragraphe est un amendement, pas une exception.** Le principe 5 est le point
de départ du projet — la page d'accueil en fait un argument, « le logiciel ne dit
jamais non » —, et on ne le retire pas. Mais la cascade (§6.4) fait évaluer au
serveur deux questions qui sont, sans détour possible, des questions de règles de
Magic : *est-ce un terrain ?* et *la valeur de mana est-elle sous le seuil ?* Le
nier serait pire que l'écrire.

La ligne passe ici :

> **L'invariant interdit de refuser, pas d'assister.**
>
> - **Assister** — exécuter, à la demande, une séquence que le joueur ferait à la
>   main. Il déclenche, il peut faire autrement, rien ne se produit tout seul.
> - **Arbitrer** — décider si une action est permise, refuser un geste, imposer une
>   conséquence. **Toujours interdit.**

Elle tient parce que le principe 5 n'a jamais parlé de savoir : il parle de
**pouvoir dire non**. Un serveur qui compte des symboles de mana n'ôte rien au
joueur ; un serveur qui refuse un geste au motif qu'il serait illégal lui ôte la
table.

**Les trois propriétés qui rendent la cascade acceptable, et qui sont le critère de
toute demande future.** Une fonctionnalité qui en manque une n'est pas à discuter :
elle est du mauvais côté.

1. **Elle n'interdit rien.** Aucun code d'erreur nouveau (§11), aucun refus au motif
   d'illégalité. Les seules erreurs que `CASCADE` peut lever sont exactement celles
   que `MILL` et `EXILE_TOP` lèvent déjà — zone en consultation, bibliothèque vide —,
   et elles sont structurelles.
2. **Elle n'impose rien.** Le chemin manuel reste ouvert et entier : exiler du dessus
   une par une, lire, remettre dessous. Rien ne se déclenche parce qu'une carte est
   jouée ; l'intent part d'un clic, et de rien d'autre.
3. **Elle ne conclut pas.** La carte trouvée s'arrête à l'exil, face visible, et le
   joueur en dispose avec le menu ordinaire. Décider à sa place où elle atterrit —
   champ de bataille pour la cascade, main pour la découverte — serait précisément
   arbitrer.

**Ce que la frontière continue d'interdire**, pour que la liste ne se lise pas comme
une permission générale : refuser un `MOVE_CARDS` parce que le terrain a déjà été
posé ; refuser une pioche hors de son tour ; faire mourir une créature dont
l'endurance tombe à zéro ; faire payer une taxe de commandant ; vider une main de
huit cartes en fin de tour. Aucune de ces choses n'a de bouton, et aucune n'en aura :
elles arbitrent toutes.

#### Le prix à payer, dit sans l'adoucir

**Le saut automatique des terrains est le seul endroit du serveur où une erreur a une
conséquence de règles.** `isLandCard` (`apps/server/src/game/cascade.ts`) lit le mot
`land` en mot entier sur la ligne de type **du recto**. Si cette ligne se lit mal —
une ligne de type absente, une face que l'on n'a pas su choisir, une carte dont le
catalogue n'a pas la forme attendue —, le serveur passe **silencieusement** à côté
d'une carte qui aurait dû être la trouvaille, et il continue de creuser. Personne ne
reçoit d'erreur. Rien ne clignote.

Le garde-fou n'est pas dans le code de décision, il est dans le **journal** : la ligne
nomme **toutes** les cartes exilées, pas seulement celle sur laquelle la séquence
s'arrête (§5.4, `namedBatch`). La table voit donc exactement ce que le serveur a vu et
peut protester — c'est-à-dire refaire à la main ce que la séquence a mal fait. C'est
une réparation sociale, la même que pour tout le reste de cette table, et c'est
assumé comme telle.

#### Refuser de décider est une réponse, et on l'a écrite deux fois

- **Valeur de mana ambiguë.** Quand **plusieurs faces portent un coût** — une carte
  partagée, une aventure, une recto-verso modale —, les règles tranchent, mais elles
  tranchent différemment selon la carte et selon la zone. `manaValueOf` rend alors
  `ambiguous: true`, et la séquence **s'arrête** sur cette carte au lieu de la juger.
  L'aveu passe **avant** la comparaison : si la valeur n'est pas sûre, le résultat de
  la comparaison ne l'est pas davantage, de quelque côté du seuil qu'il tombe.
  S'arrêter tôt ne dévoile jamais plus de cartes que nécessaire. Le journal le dit
  publiquement, et la table tranche.
- **« Jouer sans payer son coût » n'existe pas.** Sur une table sans pile ni coûts, il
  n'y a pas de lancement, seulement des déplacements. La carte trouvée reste donc à
  l'exil : ce n'est pas un travail inachevé, c'est le refus de choisir à la place du
  joueur.

---

## 2. Identité des objets

```ts
type SeatId   = string;   // "seat_3", stable pour la durée de la partie
type ObjectId = string;   // identifiant opaque d'un objet de jeu (carte, token, label)
type Seq      = number;   // entier, croissant, unique par room
```

### 2.1 `ObjectId` et fuite d'information

Un `ObjectId` est **opaque et non devinable** (ULID). Il ne code ni l'identité de la
carte, ni sa position d'origine dans la bibliothèque.

Règle critique : **les objets d'une bibliothèque n'ont pas d'`ObjectId` publié.** Tant
qu'une carte est dans une bibliothèque, son `ObjectId` n'est connu que du serveur et —
seulement lorsqu'il regarde — de son propriétaire. Sinon, corréler les ids avant et
après un `SHUFFLE` révélerait l'ordre de la bibliothèque.

Conséquence : `SHUFFLE` **réattribue de nouveaux `ObjectId`** à toutes les cartes de la
zone mélangée. Les ids précédemment vus par le propriétaire (scry, recherche) sont
invalidés et ne peuvent plus servir de canal de corrélation.

Seconde conséquence, symétrique : **un identifiant n'entre pas non plus dans une
bibliothèque au vu des autres sièges.** Quand une carte quitte une zone publique
pour une zone non énumérable (bibliothèque), les sièges autres que le propriétaire
reçoivent `CARD_HIDDEN{cardId}` — « oublie cet objet » — et non `CARD_MOVED`.
Sans cela, apprendre « l'objet X est désormais la 3ᵉ carte de la bibliothèque »
rouvrirait exactement le canal de corrélation que la réattribution ferme. Le
compte de la zone, lui, reste public (`ZONE_COUNT`).

De la même façon, **aucun event portant sur un objet de bibliothèque ne sort vers
un autre siège que son propriétaire** : un `CARD_UPDATED` y est adressé en
audience `SEAT`, jamais `ALL`.

### 2.2 Zones

```ts
type ZoneKind =
  | 'LIBRARY' | 'HAND' | 'BATTLEFIELD' | 'GRAVEYARD' | 'EXILE'
  | 'COMMAND' | 'SIDEBOARD'
  | 'FACEDOWN_TEMP'   // pile face cachée temporaire (scry, mise de côté)
  | 'STACK_NOTE';     // pile informelle, purement décorative

interface ZoneRef { seat: SeatId; kind: ZoneKind; }
```

Chaque zone appartient à un siège. Le champ de bataille est *visuellement* partagé mais
reste découpé par siège : un permanent prêté à un adversaire change de `controller`
sans changer d'`owner`.

### 2.3 Classes de confidentialité des zones

| Zone | Ordre confidentiel | Contenu confidentiel | Cardinalité publique |
|---|---|---|---|
| `LIBRARY` | oui | oui | oui (nombre de cartes) |
| `HAND` | non pertinent | oui (sauf révélation) | oui |
| `BATTLEFIELD` | non | non, sauf face cachée | oui |
| `GRAVEYARD` | non | non, sauf mise au cimetière face cachée | oui |
| `EXILE` | non | non, sauf « exilé face cachée » | oui |
| `COMMAND` | non | non | oui |
| `SIDEBOARD` | non | oui | oui |
| `FACEDOWN_TEMP` | oui | oui | oui |

---

## 3. Vue d'un objet

Un objet est sérialisé différemment selon le droit du destinataire. Trois formes :

```ts
/** Objet dont l'identité est visible par le destinataire. */
interface PublicCardView {
  id: ObjectId;
  kind: 'CARD' | 'TOKEN';
  owner: SeatId;
  controller: SeatId;
  zone: ZoneRef;
  scryfallId: string;        // identité révélée
  faceDown: false;           // « ce destinataire voit l'identité », pas « posée face visible »
  facedownOnTable?: boolean; // posée face cachée alors même que vous la voyez
  tapped: boolean;
  flipped: boolean;          // face arrière d'une DFC / transform
  x: number; y: number;      // coordonnées table, pertinentes en BATTLEFIELD
  rotation: 0 | 90 | 180 | 270;
  counters: Counter[];
  attachedTo?: ObjectId;
  isFoil: boolean;
  sortIndex: number;         // ordre dans les zones listées (main, cimetière, exil)
  copyOf?: ObjectId;         // uniquement sur un token créé par copie d'un permanent
  revealedTo?: SeatId[];     // sièges à qui la carte a été *montrée* (voir ci-dessous)
}

/** Objet présent mais dont l'identité est cachée au destinataire. */
interface HiddenCardView {
  id: ObjectId;
  kind: 'CARD' | 'TOKEN';
  owner: SeatId;
  controller: SeatId;
  zone: ZoneRef;
  faceDown: true;
  // aucun scryfallId, aucune donnée oracle, aucune trace de l'identité
  tapped: boolean;
  x: number; y: number;
  rotation: 0 | 90 | 180 | 270;
  counters: Counter[];
  attachedTo?: ObjectId;
  sortIndex: number;
}

/** Zone cachée non énumérable : on n'expose qu'un compte. */
interface OpaqueZoneView { zone: ZoneRef; count: number; }

type CardView = PublicCardView | HiddenCardView;

interface Counter { kind: string; value?: number; }  // "+1/+1", "loyalty", "poison", libre
```

Règles d'application :

- `LIBRARY` d'autrui → `OpaqueZoneView` uniquement. Jamais de tableau d'objets.
- `LIBRARY` propre → `OpaqueZoneView` également, **sauf** les cartes dont le
  propriétaire a acquis la connaissance (scry, recherche en cours) : envoyées en
  `PublicCardView` dans un `LOOK_RESULT` adressé au seul siège concerné.
- `HAND` d'autrui → liste de `HiddenCardView` (pour animer nombre, position, défausse),
  jamais de `scryfallId`.
- `HAND` propre → `PublicCardView`.
- `SIDEBOARD` → visible du seul propriétaire, sauf mode « sideboard ouvert ».

**Une carte face cachée le reste quand elle change de zone publique.** Un
déplacement qui ne dit rien de `faceDown` ne dit pas « face visible » : il ne dit
rien. Une carte posée face cachée sur le champ et envoyée à l'exil, au cimetière
ou sur la pile y arrive donc **toujours face cachée**, et `knownTo` n'est pas
purgé pour autant (§5.2). La révéler d'office serait appliquer une règle de Magic, ce que
la §1.5 interdit ; on la retourne par `TURN_FACE_UP`.

La réciproque ne vaut pas : venant d'une zone **cachée** (main, bibliothèque,
réserve, pile face cachée), où `faceDown` découle de la zone elle-même, la carte
arrive face visible par défaut — sans quoi toute carte jouée de la main se
poserait face cachée. Un `faceDown` explicite l'emporte dans les deux sens.

**`faceDown` n'est pas l'état de la carte, c'est un droit du destinataire.** Il vaut
`false` dès que ce siège voit l'identité — y compris pour le propriétaire d'une carte
posée face cachée, qui la voit alors que les autres non. `facedownOnTable` porte l'autre
information : la carte est physiquement retournée sur la table. Sans lui, un joueur
ignore que sa propre carte est cachée aux autres et croit avoir révélé ce qu'il vient de
dissimuler. Il n'est posé que dans une zone publique : en main ou en bibliothèque, être
face cachée découle de la zone et n'apprend rien à son propriétaire.

**Un marqueur sans valeur est un mot-clé.** `Counter.value` est facultatif :
une valeur le compte (+1/+1, loyauté, poison), son absence en fait un mot posé
sur la carte — « vol », « ne se dégage pas », « monarque » — affiché seul. La
valeur était obligatoire et l'on écrivait donc « vol 1 », un nombre qui ne veut
rien dire.

**`revealedTo` n'est posé que sur une vue déjà publique** pour son destinataire,
jamais sur un `HiddenCardView` : il n'apprend donc rien. Il existe pour le
**montreur**, qui sans lui ne sait plus l'instant d'après qu'il a révélé une
carte de sa main — `REVEAL` ne prévient que les destinataires, alors que c'est
justement l'information qui change sa façon de jouer. Montrer une carte est de
toute façon un geste public à une vraie table.

**Interdiction absolue** : un `HiddenCardView` ne doit contenir aucun champ dérivé de
l'identité de la carte — ni `cmc`, ni `colorIdentity`, ni dimensions d'image, ni
`isFoil`, qui est corrélable. Le test d'acceptation §12.2 inspecte les frames brutes et
refuse tout champ hors de la liste blanche ci-dessus.

---

## 4. Enveloppes de messages

### 4.1 Client → serveur

```ts
interface ClientEnvelope<T extends Intent = Intent> {
  t: 'intent';
  cid: string;     // identifiant client de l'intent (ULID), renvoyé dans l'ack
  ackSeq: Seq;     // dernier seq appliqué par le client
  intent: T;
}

interface ClientHello  { t: 'hello'; protocol: number; sessionToken?: string; seatToken?: string; sinceSeq?: Seq; roomPassword?: string; }
interface ClientPing   { t: 'ping'; ts: number; }
interface ClientResync { t: 'resync'; sinceSeq: Seq; }
```

### 4.2 Serveur → client

```ts
interface ServerEvent  { t: 'event'; seq: Seq; at: number; actor: SeatId | null; event: Event;
                         log?: { text: string; cardIds: ObjectId[] }; }
interface ServerAck    { t: 'ack'; cid: string; seq: Seq | null; }   // seq null = intent sans effet
interface ServerReject { t: 'reject'; cid: string; code: ErrorCode; message: string; }
interface ServerHello  { t: 'hello'; protocol: number; seat: SeatId | null; roomCode: string;
                         seatToken?: string; snapshot?: Snapshot; delta?: ServerEvent[]; }
interface ServerPong   { t: 'pong'; ts: number; serverTs: number; }
interface ServerError  { t: 'error'; code: ErrorCode; message: string; fatal: boolean; }
```

Le champ `log` porte la ligne de journal produite par l'event, quand il en produit une.
Son texte est **public par construction** : le serveur n'y écrit jamais le nom d'une
carte que tous les sièges ne peuvent pas voir — c'est « une carte » dans le cas
contraire. Ses ancres `cardIds` obéissent à la même règle et ne citent jamais un
objet de bibliothèque. Le journal n'est donc jamais un canal de fuite parallèle
aux events.

Corollaire, et c'est une contrainte d'implémentation : **une ligne de journal est
diffusée à tous les sièges, quelle que soit l'audience de l'event qui la porte.**
Un siège hors audience reçoit le même `seq` avec un event `NOTED` (§7), sans
charge utile — et il le reçoit **que l'émission porte une ligne de journal ou
non** : la séquence est dense pour tout siège connecté (§5, §8.1). Sans cela,
« seat_2 regarde une carte face cachée » — dont l'event n'est adressé qu'à
seat_2 — ne serait jamais annoncé à la table, et la contrepartie sociale de
l'information cachée (§6.1) resterait une promesse.

Ce corollaire a une conséquence de conception que la lecture des types ne montre
pas, et qu'il faut avoir en tête **avant** d'écrire une ligne de journal :
`audience` restreint l'**event**, jamais le **texte** du journal. La règle
complète, ce qu'elle interdit et le seuil d'abrègement `NAMED_LOG_LIMIT` sont au
§5.4.

Ordre garanti : l'`ack` d'un intent est émis **après** l'event correspondant dans le
flux du siège émetteur. Le client peut donc lever sa prédiction optimiste à l'`ack`
sans risque d'inversion.

---

## 5. Règles de visibilité

Chaque event déclare une **audience** calculée par le serveur :

```ts
type Audience =
  | { kind: 'ALL' }                      // tous les sièges de la room
  | { kind: 'SEATS'; seats: SeatId[] }
  | { kind: 'SEAT'; seat: SeatId };
```

Il n'existe **pas de spectateurs** : toute connexion à une room est soit un siège
joueur, soit une connexion en attente d'un `SIT_DOWN` qui ne reçoit que la liste des
sièges et le statut de la room — jamais un état de partie.

**Avant d'écrire quoi que ce soit qui produise une ligne de journal, lire le
§5.4 :** l'audience restreint l'event, jamais le texte du journal, qui est lu par
toute la table et relu par qui rejoint plus tard.

Pour un même fait de jeu, le serveur produit jusqu'à **deux variantes** partageant le
même `seq` : une variante riche pour l'audience autorisée, une variante pauvre pour les
autres. Exemple, une pioche :

```jsonc
// vers le siège qui pioche
{"t":"event","seq":412,"actor":"seat_1","event":{
  "type":"CARD_MOVED",
  "card":{"id":"01J8…","scryfallId":"e9d5a…","faceDown":false,
          "zone":{"seat":"seat_1","kind":"HAND"}},
  "from":{"seat":"seat_1","kind":"LIBRARY"},"to":{"seat":"seat_1","kind":"HAND"}}}

// vers tous les autres — même seq, identité absente
{"t":"event","seq":412,"actor":"seat_1","event":{
  "type":"CARD_MOVED",
  "card":{"id":"01J8…","faceDown":true,
          "zone":{"seat":"seat_1","kind":"HAND"}},
  "from":{"seat":"seat_1","kind":"LIBRARY"},"to":{"seat":"seat_1","kind":"HAND"}}}
```

Les deux frames partagent `seq` : la resynchronisation reste cohérente pour tout le monde.

**Invariant de densité : un siège connecté reçoit exactement un message par
`seq`, sans trou.** L'audience décide *ce qu'il reçoit*, jamais *s'il reçoit
quelque chose*. `Room.commit` construit donc, pour chaque `seq`, une variante par
siège présent : l'event réel si le siège est dans l'audience, un `NOTED` (§7)
sinon — et ce remplissage n'est **pas** conditionné à la présence d'une ligne de
journal. Une émission restreinte et muette, typiquement le `LOOK_RESULT` adressé
au seul consultant, laisse malgré tout un `NOTED` aux autres sièges.

Ce n'est pas un raffinement : c'est ce sur quoi la détection de trou côté client
se fonde (§8.1). Sans ce remplissage, l'event suivant arrivait chez les autres
sièges en `seq !== lastSeq + 1`, chacun demandait un `resync`, et chaque réponse
`hello/delta` rejouait les mêmes lignes de journal — le même message s'affichait
trois fois. Le bug était réel.

`NOTED` ne fait rien fuiter : il dit « un `seq` s'est produit », ce que le trou
disait déjà, en pire — le trou l'annonçait *et* déclenchait une
resynchronisation complète. Il ne porte aucune charge utile ; la ligne de
journal qu'il transporte parfois est publique par construction (§5.4).

### 5.1 Matrice de référence (ce qui sort effectivement du serveur)

| Fait | Propriétaire | Autres sièges |
|---|---|---|
| Contenu de la bibliothèque | via `LOOK_RESULT` seulement | jamais |
| Ordre de la bibliothèque | via `LOOK_RESULT` / `REORDER_TOP` | jamais |
| Taille de la bibliothèque | oui | oui |
| Contenu de la main | oui | non |
| Taille de la main | oui | oui |
| Carte piochée | identité | id opaque |
| Carte défaussée | identité | identité |
| Permanent face cachée | identité | id opaque |
| Résultat d'un scry | oui | non |
| Décision de scry (agrégat) | oui | oui |
| Sideboard | oui | non |
| Carte révélée via `REVEAL` | oui | sièges listés uniquement |
| Ligne de journal (texte, ancres `cardIds`, lot déplié `names`) | oui | **oui, toujours** (§5.4) |
| Existence d'un `seq` | oui | oui — event réel ou `NOTED`, jamais rien |

« Décision de scry » est publique en agrégat (« seat_1 met 1 carte dessous ») : c'est
une information que la table observe sur une vraie table.

### 5.2 Monotonie de la connaissance

**Ce qu'un siège a vu, il le sait pour de bon.** Dès qu'un siège connaît
légitimement l'identité d'un objet — on la lui a montrée (`REVEAL`,
`REVEAL_HAND`, `REVEAL_TOP`), il l'a vue sur le champ de bataille, au cimetière,
à l'exil ou en zone de commandement, un scry ou une fouille la lui a fait voir,
ou il en est le propriétaire —, cette connaissance **survit à tous les
changements de zone ultérieurs**. `knownTo` ne fait que croître.

C'est ce qui se passe à une vraie table : on se souvient de ce qu'on a vu, et un
adversaire qui reprend en main une créature que vous avez regardée ne vous fait
pas oublier laquelle c'était. Le serveur n'a pas à organiser une amnésie que la
table réelle ne connaît pas.

**L'unique effacement est l'entrée en `LIBRARY`.** Une carte qui y entre redevient
inconnue de tout le monde, propriétaire compris — hors les exceptions prévues au
§2.1 et au §6.4. Cette exception-là n'en est pas vraiment une : un objet de
bibliothèque n'a pas d'identifiant publié, et `SHUFFLE` les réattribue tous. Le
lien entre l'avant et l'après est physiquement coupé ; il ne reste rien à quoi
rattacher un souvenir, et c'est la même propriété qui ferme le canal de
corrélation du §2.1.

Zone par zone, et c'est délibéré :

| Destination | Effet sur `knownTo` |
|---|---|
| `LIBRARY` | **purge complète** — seul cas |
| `HAND` | ajout du propriétaire (+ destinataires d'une main révélée) ; aucun retrait |
| `SIDEBOARD`, `FACEDOWN_TEMP` | ajout du propriétaire ; aucun retrait |
| `BATTLEFIELD`, `GRAVEYARD`, `EXILE`, `COMMAND`, `STACK_NOTE` face visible | ajout de tous les sièges |
| idem **face cachée** (y compris exil face cachée depuis la main) | ajout du propriétaire ; **aucun retrait** |
| `TURN_FACE_DOWN` | ajout du propriétaire et de l'auteur ; aucun retrait |

Poser une carte **face cachée** ne la reprend donc à personne. C'est exactement la
situation d'une vraie table où l'on a vu la carte *avant* qu'elle ne soit
retournée — et c'est le cœur de la règle, pas un effet de bord. Corollaire assumé :
`TURN_FACE_DOWN` sur un permanent que la table a déjà vu face visible ne cache
plus rien à personne. La monotonie n'ajoute jamais à ce qui fuit : une carte que
personne n'a vue, jouée face cachée, reste secrète.

Deux droits **continus** échappent à cette croissance sans la contredire :
`REVEAL_HAND` et `REVEAL_TOP` se reprennent (`UNREVEAL_HAND`, `REVEAL_TOP` à
liste vide). Leur retrait n'est pas un changement de zone, et il ne reprend que
son propre **dépôt** — ce que la révélation avait elle-même accordé, sur les seuls
objets encore dans la zone qu'elle couvrait. Une carte montrée à part par
`REVEAL`, ou déjà connue autrement, n'est pas touchée ; une carte **piochée**
après avoir été révélée sur le dessus reste connue de son destinataire, parce
qu'elle a quitté la bibliothèque.

#### Cas limite traité : nommer au journal une carte remontée sur le dessus

La branche `HAND` de `RESOLVE_LOOK` nomme les cartes qui partent en main quand la
consultation est de mode `REVEAL` **ou** quand tous les sièges connaissent déjà
l'identité (`allKnown`). Le cas paraît ouvrir une fuite, et il a été soulevé comme
tel : une carte révélée puis reposée **sur le dessus** garde un `knownTo`
complet — seul le passage par le fond le vide (§6.4) —, donc un `SCRY` ultérieur
qui la reprend en main la nommerait au journal public.

**Arbitrage rendu : le comportement est correct et reste en place.** Il découle
de l'invariant ci-dessus, il ne le contredit pas. La connaissance est monotone ;
le seul effacement est le passage par la bibliothèque, et cet effacement-là ne
tient que parce que `SHUFFLE` réattribue tous les identifiants (§2.1). Remettre
une carte sur le dessus **sans mélanger** ne coupe aucun lien et n'efface donc
rien — c'est vrai à une vraie table aussi : on n'oublie pas la carte qu'on vient
de voir parce que son propriétaire l'a reposée sur son deck. Nommer au journal ce
que toute la table a déjà vu n'est pas une fuite, c'est la monotonie appliquée.

La garde est d'ailleurs doublée : le mode `REVEAL` ajoute tous les sièges au
`knownTo` dès l'ouverture de la session, si bien que `allKnown` suffirait seul
dans le cas nominal. C'est écrit ici pour qu'un futur contributeur ne « corrige »
pas ce cas par excès de prudence : le resserrer reviendrait à faire mentir le
journal sur une information que la table détient.

Restent purgées, et ce sont des remises à zéro et non des oublis : `STAND_UP`
(toute trace du partant, §6.8), `START_GAME` et `RESTART_GAME`.

### 5.3 L'exception : rattraper une carte posée par erreur (`TAKE_BACK`)

La règle du §5.2 a **une** exception, et elle est écrite ici, contre la règle,
pour qu'on ne puisse pas modifier l'une en ignorant l'autre.

On relâche une carte de sa main sur le champ de bataille sans le vouloir. Toute
la table l'a vue. `TAKE_BACK` (§6.1) la remet hors de vue : `knownTo` est vidé.
C'est le seul effacement hors du passage par la bibliothèque.

**Ce n'est pas une exception technique, c'est une exception sociale.** À une
vraie table, un dévoilement maladroit s'efface parce que les joueurs
*conviennent* de l'oublier. Le serveur n'invente donc rien ; il outille un geste
qui existe. Trois propriétés le rendent honnête plutôt que tricheur, et aucune
n'est facultative.

1. **Le geste est public.** Il produit une ligne de journal nominative — « X a
   repris en main une carte posée par erreur » —, diffusée à toute la table
   comme n'importe quelle ligne (§4.2). Un effacement silencieux de la mémoire
   des autres serait une tricherie ; annoncé, c'est une convention de table, et
   chacun peut protester.
2. **L'identifiant de l'objet est réattribué.** C'est le point technique qui
   décide de tout. Les clients adverses ont déjà reçu la `PublicCardView` de cet
   objet, indexée par son `ObjectId` ; purger `knownTo` sans changer
   l'identifiant laisserait cette vue en place chez eux, et le masquage serait
   un mensonge poli. Le serveur coupe donc le lien comme `SHUFFLE` le fait
   depuis toujours (§2.1) : identifiant neuf, `CARD_HIDDEN` sur l'ancien, puis
   l'arrivée du nouvel objet. Les attachements sont défaits et les étiquettes
   accrochées retirées — une note qui suit la carte est elle-même un pointeur
   vers elle.
3. **Le propriétaire, et lui seul.** C'est sa maladresse, et surtout il est le
   seul à *perdre* au geste. Ouvert au contrôleur de passage — une carte prêtée —
   ou à la table entière, « oublier » cesserait d'être un rattrapage pour devenir
   une arme : n'importe qui effacerait de la mémoire commune une carte qu'on
   vient de révéler exprès. Le droit suit la perte, comme pour
   `SET_COMMANDER_DAMAGE` (§6.6). Ce n'est pas trop étroit : une carte n'arrive
   sur le champ que depuis une zone de son propriétaire (§6.1), la maladresse
   est forcément la sienne.

**Le journal suit.** Les lignes déjà écrites qui ancraient l'objet perdent leur
ancre — elle désignerait un objet mort — et le nom de la carte y devient « une
carte ». Ce n'est pas réécrire l'histoire, c'est réappliquer au passé la règle du
§4.2 : le journal n'écrit jamais le nom d'une carte que tous les sièges ne
peuvent pas voir, et la prémisse de ces lignes-là vient de changer. Sans cela le
geste serait décoratif — il suffirait de remonter de trois lignes. Résidu
assumé : un client déjà connecté garde dans son journal la ligne reçue en
direct, comme un joueur garde en tête ce qu'il a entendu ; on ne dédit pas une
parole, on corrige ce qui est écrit.

Trois refus structurels, qui ne sont pas des règles de Magic (§1.5) mais des cas
où l'oubli serait faux : un **jeton** n'est tombé d'aucune main (`DESTROY_TOKEN`
est le geste attendu) ; une carte d'une **zone cachée** n'a été dévoilée à
personne ; un **commandant** est de notoriété publique dès `DECK_LOADED`, et
prétendre que la table l'oublie serait un mensonge que le serveur sait détecter.

Le geste n'est **pas annulable** : `UNDO_LAST` republierait l'identité que la
table vient de convenir d'oublier. Se raviser se fait à la main, en remontrant
la carte.

### 5.4 La ligne de journal est publique, quelle que soit l'audience

**À lire avant d'écrire la moindre ligne de journal.** C'est la règle qu'on
enfreint sans s'en apercevoir, et l'enfreindre crée une fuite *permanente* — pas
une frame de trop, une entrée que tout le monde relira.

`audience: { kind: 'SEATS', seats: [...] }` restreint l'**event**. Il ne
restreint **jamais** le texte du journal ni ses ancres. Deux propriétés de
l'implémentation le garantissent, et il faut les connaître toutes les deux :

1. `Room.commit` construit la ligne de journal **une seule fois, hors de toute
   boucle d'audience**, puis l'attache à l'identique aux destinataires réels
   **et** au remplissage `NOTED` servi à tous les autres sièges (§5, §4.2). Il
   n'existe pas de version par destinataire : le texte n'est pas projeté.
2. La projection de snapshot recopie `logTail: state.log.slice(-200)` **tel quel
   dans le snapshot de chaque siège**, sans aucun filtrage. Un joueur qui rejoint
   tard, ou qui resynchronise, relit donc les lignes écrites avant son arrivée.

Conséquence opérationnelle : **toute ligne de journal doit être sûre pour la
table entière**, même quand l'event qui la porte ne l'est pas. Un « pour lui
seul » n'existe pas dans le journal. Le type `LogEntry` est déclaré au §8.1, avec
les autres types portés par le snapshot.

Deux illustrations, délibérées toutes les deux :

- `REVEAL_HAND` à des sièges nommés écrit « *X* a révélé sa main » — **sans
  noms, avec `cardIds: []`** —, alors même que son event `HAND_REVEALED` est
  restreint aux destinataires. Nommer les cartes dans la ligne les publierait à
  toute la table, y compris aux sièges à qui la main n'a pas été montrée.
- `PEEK_FACE_DOWN` écrit « *X* a regardé une carte face cachée » avec
  `cardIds: []`. L'ancre est omise volontairement : ancrer désignerait
  *laquelle* des cartes face cachée a été regardée, ce que le texte se garde
  justement de dire.

La règle vaut aussi pour les ancres au-delà de ces cas, et `commit` les filtre —
**une seule fois, pour le wire comme pour `state.log`** (`ancresPubliables`). Le
même tableau part sur le socket, dans le replay, et dans l'entrée que `logTail`
recopiera au snapshot de chaque siège : une ligne relue après un resync porte
donc exactement les ancres qu'elle portait en direct. C'est une propriété à
tenir, pas un détail d'implémentation — l'une des deux moitiés filtrée sans
l'autre rouvre le canal par le côté resté ouvert.

**Une ancre est un identifiant, pas une identité**, et c'est ce qui décide du
critère. La question n'est pas « la table peut-elle lire cette carte ? » — le
texte y répond, via `publicName` — mais « chaque siège détient-il déjà cet
identifiant ? ». Deux réponses, selon la zone :

| Zone de l'objet ancré | L'ancre sort-elle ? |
|---|---|
| énumérable (champ, cimetière, exil, main, commandement…) | **oui, toujours** — l'objet figure dans le snapshot de tous les sièges et dans les events qui l'y ont amené. Une carte posée **face cachée** est annoncée à tout le monde, vue masquée mais identifiant en clair : son ancre ne révèle rien, et la retirer ferait perdre le surlignage sans rien protéger |
| `LIBRARY` | **seulement si tous les sièges connaissent l'identité** — c'est-à-dire quand le serveur la leur a déjà remise (consultation en mode `REVEAL`, révélation permanente du dessus). Sinon l'identifiant n'est publié à personne (§2.1) et le corréler avant/après révélerait l'ordre |
| identifiant sans objet | oui : il ne désigne plus rien (carte détruite, identifiant réattribué), et rien ne s'y corrèle |

Un filtre qui ne poserait que la première question et s'y tiendrait pour les deux
zones serait faux **dans les deux sens à la fois** : il retirerait les ancres
d'une révélation que toute la table vient de recevoir, tout en laissant passer
celles d'une bibliothèque secrète par le chemin qu'il ne couvre pas. C'est la
condition que `REVEAL` appliquait déjà chez lui, hissée dans `commit` pour
qu'aucun intent n'ait à la réécrire — ni à l'oublier.

#### `namedBatch` et `NAMED_LOG_LIMIT`

Les lignes portant sur plusieurs cartes passent toutes par un assembleur unique,
`namedBatch`, pour que la règle ci-dessus n'ait pas à être réappliquée à la main
à chaque intent. Il :

- nomme via `publicName`, qui n'accepte un nom que si **tous** les sièges voient
  l'identité — jamais en lisant le nom sur l'objet. Une carte qu'un siège ne peut
  pas identifier devient « une carte » : elle sort de l'énumération tout en
  restant **comptée** dans le « et N autres cartes » ;
- exige en plus que la **zone d'arrivée** soit publique. La monotonie (§5.2) ne
  suffit pas : une carte vue au cimetière reste connue de tous une fois reprise
  en main, et `publicName` la nommerait — le journal dirait alors ce que le
  joueur tient ;
- abrège au-delà de `NAMED_LOG_LIMIT` en « … et N autres cartes » ;
- **rend toutes les ancres `cardIds`, y compris celles des cartes que le seuil a
  repliées.** Le texte s'abrège, la liaison aux cartes non : le survol surligne
  le lot entier, et `TAKE_BACK` (§5.3) efface le passé en parcourant `cardIds` —
  une carte publique laissée hors des ancres échapperait à l'oubli. `CASCADE`
  est le seul appelant qui déroge à ce contrat, et il a une raison : ses cartes
  ont changé d'identifiant en repartant sous la bibliothèque. C'est ce cas que
  `LogEntry.names` couvre, ci-dessous ;
- rend aussi, pour cet usage-là, la **forme non abrégée** de son énumération
  (`all`). Ce n'est pas une seconde règle de visibilité : c'est la même liste,
  issue du même `publicName`, avant la coupure du seuil.

`NAMED_LOG_LIMIT` (valeur **6**) est une **constante de protocole**, définie dans
`packages/shared/src/protocol/core.ts` à côté de `PROTOCOL_VERSION`, et non un
réglage de serveur. Les deux côtés doivent la lire pareil : le serveur s'en sert
pour couper l'énumération, le client pour décider si une ligne est dépliable et
offrir « voir les N cartes ». Le client le déduit du **lot**, jamais du texte —
l'abréviation est une phrase traduisible, la découper casserait à la première
langue ajoutée. Deux copies qui divergent ne fuient rien, mais donnent un bouton
en trop ou un bouton manquant.

#### `LogEntry.names` — déplier une ligne qui n'a pas d'ancres

Le dépliage d'une ligne abrégée se reconstruit d'ordinaire depuis `cardIds` : le
client résout chaque identifiant dans son store. Ce chemin suppose que le lot a
encore des ancres, ce qui est vrai partout **sauf après une cascade**.

`CASCADE` exile face visible, puis renvoie tout sauf la trouvaille sous la
bibliothèque **en réattribuant les identifiants** (§2.1, §6.4). Ses ancres sont
donc volontairement réduites à la seule carte restée à l'exil : une ancre vers un
objet mort promettrait un survol qui ne surligne rien. Conséquence, et c'était le
défaut : sur une cascade qui exile neuf cartes, le joueur lisait six noms, « et
3 autres cartes », et n'avait **aucun moyen** de voir les trois — alors que le
serveur venait de les calculer pour écrire la phrase.

La correction pose le principe : **le dépliage sert à lire des noms, pas à
survoler des cartes.** Les ancres restent le bonus qui permet de surligner sur la
table ; elles ne sont plus la condition pour savoir ce qui est passé. Une
`LogEntry` peut donc porter `names`, la **forme non abrégée** de son énumération :
même liste, même ordre, avant que le seuil ne la coupe. `names.slice(0, 6)` est
mot pour mot ce que le texte énumère, et `names.length - 6` le « et N autres
cartes ».

Trois règles la tiennent, et aucune n'est négociable :

1. **Elle ne publie rien que le texte ne publie déjà.** Chaque entrée sort de
   `namedBatch`, donc de `publicName`, appelé sur la même carte, au même instant,
   dans la même zone d'arrivée publique. Une carte qu'un siège ne peut pas
   identifier y figure comme « une carte », exactement comme elle sort de
   l'énumération tout en restant comptée. Il n'y a pas de seconde règle de
   visibilité à maintenir : il n'y en a qu'une, et c'est celle du texte.
2. **Elle ne lit jamais une bibliothèque.** Pour la cascade, les noms sont
   relevés en phase 2, **pendant que les cartes sont à l'exil, face visible** —
   `namedBatch` juge sur la zone d'arrivée et refuserait de nommer après le
   remélange, à juste titre. Ce qui rend la publication licite est que toute la
   table a vu ces cartes et que la connaissance est monotone (§5.2) : on ne
   révèle rien de neuf, on redit sans replier. Remplir `names` depuis une zone
   cachée serait une fuite, sans exception ni cas particulier.
3. **Elle est facultative et volontairement rare.** `logTail` recopie deux cents
   entrées dans **chaque** snapshot et `state.log` en garde mille : une liste de
   noms sur chaque ligne multi-cartes serait un coût permanent payé pour une
   information que le client sait déjà reconstituer. Le serveur ne la remplit que
   lorsque la ligne est abrégée (`> NAMED_LOG_LIMIT`) **et** que ses ancres ne
   couvrent pas le lot. Aujourd'hui, `CASCADE` est le seul intent dans ce cas.
   La décision est prise en un seul endroit, `namesForLog` dans `engine.ts`.

Côté client, `names` prime sur `cardIds` pour la taille du lot, pour le libellé
du bouton et pour le contenu du dépliage ; le survol de la ligne continue de
surligner les seules cartes qui ont encore un identifiant. L'invariant client
reste intact : la seule source d'identité autorisée est ce que le serveur a
envoyé — `names` en fait partie, le cache de métadonnées ne le complète pas.

`names` est un champ **ajouté et facultatif** : un client antérieur l'ignore et
retombe sur l'ancien comportement. `PROTOCOL_VERSION` **ne bouge pas** (§11) —
la monter déconnecterait toutes les tables en cours au déploiement pour un champ
que personne n'est obligé de lire.

Intents passant par `namedBatch` : `MOVE_CARDS`, `TAP` / `UNTAP`, `UNTAP_ALL`,
`DESTROY_TOKEN`, `RANDOM_DISCARD`, `MILL`, `EXILE_TOP`, `RESOLVE_LOOK`.

Restent volontairement en **simple compte**, et ce n'est pas un oubli :

| Intent | Pourquoi le compte, et rien de plus |
|---|---|
| `DRAW`, `MULLIGAN` | la carte arrive en **main** : la nommer publierait ce que le joueur tient |
| `SCOOP`, `SWAP_SIDEBOARD` | nommer publierait le contenu du **deck** et de la réserve |
| `SHUFFLE`, `REORDER_TOP` | le contenu et l'ordre d'une bibliothèque sont secrets (§2.3) |

---

## 6. Intents

Forme discriminée par `type`. Sauf mention, l'auteur doit **contrôler** l'objet ciblé ;
le serveur rejette sinon (`ERR_NOT_YOURS`). Les intents marqués **[libre]** sont
ouverts à tout siège joueur : la table s'auto-arbitre, comme en physique.

### 6.1 Déplacement et état des cartes

```ts
interface MoveCard {
  type: 'MOVE_CARD';
  cardId: ObjectId;
  to: ZoneRef;
  index?: number | 'TOP' | 'BOTTOM' | 'RANDOM';   // zones ordonnées
  x?: number; y?: number;                          // battlefield
  faceDown?: boolean;
  tapped?: boolean;
}                                                  // [libre] depuis/vers une zone publique

interface MoveCards  { type: 'MOVE_CARDS'; cardIds: ObjectId[]; to: ZoneRef; index?: number | 'TOP' | 'BOTTOM'; faceDown?: boolean; }
interface Tap        { type: 'TAP'; cardIds: ObjectId[]; }            // [libre]
interface Untap      { type: 'UNTAP'; cardIds: ObjectId[]; }          // [libre]
interface UntapAll   { type: 'UNTAP_ALL'; seat?: SeatId; }            // défaut : son siège
interface SetRotation{ type: 'SET_ROTATION'; cardId: ObjectId; rotation: 0|90|180|270; }
interface FlipFace   { type: 'FLIP_FACE'; cardId: ObjectId; }         // DFC / transform
interface TurnFaceDown { type: 'TURN_FACE_DOWN'; cardId: ObjectId; }
interface TurnFaceUp   { type: 'TURN_FACE_UP'; cardId: ObjectId; }
interface PeekFaceDown { type: 'PEEK_FACE_DOWN'; cardId: ObjectId; }  // propriétaire ; journalisé
/** Change l'impression d'une carte sans changer son identité de jeu. */
interface SetPrinting { type: 'SET_PRINTING'; cardId: ObjectId; scryfallId: string; isFoil?: boolean; }

/** Rattrapage d'une maladresse : la table convient d'oublier la carte (§5.3). */
interface TakeBack { type: 'TAKE_BACK'; cardId: ObjectId; to: 'HAND' | 'FACE_DOWN'; }  // propriétaire seul
```

`TAKE_BACK` porte sur une carte posée dans une **zone publique** et vide son
`knownTo` — l'unique exception à la monotonie, dont le raisonnement complet est
au §5.3. Il n'introduit **aucun event** : le geste s'exprime avec
`CARD_HIDDEN{ancien id}`, puis le `CARD_MOVED` du même objet sous son
identifiant neuf, projeté par siège comme tout le reste. Les deux destinations
sont deux maladresses différentes, et l'interface offre les deux plutôt que de
choisir :

- `to: 'HAND'` — la carte n'aurait **jamais dû quitter la main**. C'est la
  formulation même de la demande (« quelqu'un pose une carte sans faire
  exprès »), et le rattrapage complet : laisser sur le champ un permanent face
  cachée que personne n'a joué, que l'adversaire compte et qui occupe le
  tapis, ne répare qu'à moitié.
- `to: 'FACE_DOWN'` — la carte devait être posée **face cachée** (un morph
  relâché sans la bonne touche) : elle reste où elle est, retournée, oubliée.
  `TURN_FACE_DOWN` ne suffit pas ici, et c'est délibéré : il ne reprend rien à
  personne (§5.2), il ne cacherait donc rien.

`MOVE_CARD` depuis une zone cachée est réservé au propriétaire de la zone, et une
carte ne rejoint une zone cachée (`HAND`, `LIBRARY`, `SIDEBOARD`) **que chez son
propriétaire** — sinon on rangerait la carte d'un adversaire dans sa propre main,
ou la sienne dans celle d'un autre (`ERR_BAD_ZONE`).

`MOVE_CARDS` applique **exactement les mêmes gardes** que `MOVE_CARD`, une par
carte du lot : droit d'agir, destination légale, verrou de consultation,
disparition des jetons qui quittent le champ de bataille. Un lot n'est jamais une
porte dérobée.

Une carte qui quitte le champ de bataille **détache tout ce qui pointait vers
elle** : le serveur émet les `DETACHED` correspondants. Un `attachedTo` ne
survit jamais à la disparition de sa cible, ni hors du champ de bataille — c'est
d'ailleurs pourquoi `ATTACH` exige que la source *et* la cible soient des
permanents du champ de bataille.
`PEEK_FACE_DOWN` est journalisé publiquement (« seat_2 regarde une carte face cachée »)
sans révéler la carte : contrepartie sociale de l'information cachée.

Repositionner une carte **dans la zone où elle se trouve déjà** produit bien un
`CARD_MOVED`, mais **aucune ligne de journal** : c'est du rangement, pas un déplacement,
et le journaliser noierait les vraies actions.

### 6.2 Compteurs, attachements, marqueurs

```ts
/** `value` : un nombre compte, `null` retire, **absent** en fait un mot-clé (§3). */
interface SetCounter    { type: 'SET_COUNTER'; targetId: ObjectId; kind: string; value?: number | null; } // [libre]
interface AddCounter    { type: 'ADD_COUNTER'; targetId: ObjectId; kind: string; delta: number; }   // [libre]
interface RemoveCounter { type: 'REMOVE_COUNTER'; targetId: ObjectId; kind: string; }               // [libre]
interface Proliferate   { type: 'PROLIFERATE'; targetIds: ObjectId[]; }                             // [libre]

interface Attach { type: 'ATTACH'; sourceId: ObjectId; targetId: ObjectId; }  // [libre]
interface Detach { type: 'DETACH'; sourceId: ObjectId; }                      // [libre]

interface AddLabel    { type: 'ADD_LABEL'; text: string; x: number; y: number; color?: string;
                        value?: string; attachedTo?: ObjectId; }                                    // [libre]
interface MoveLabel   { type: 'MOVE_LABEL'; labelId: ObjectId; x: number; y: number; }              // [libre]
interface SetLabel    { type: 'SET_LABEL'; labelId: ObjectId; text?: string; value?: string | null;
                        color?: string; attachedTo?: ObjectId | null; }                             // [libre]
interface RemoveLabel { type: 'REMOVE_LABEL'; labelId: ObjectId; }                                  // [libre]
```

**`PROLIFERATE` ajoute un marqueur de chaque sorte déjà présente**, sur les seuls objets que le
client désigne — le serveur ne cherche jamais « qui porte déjà un marqueur ». C'est une
**assistance** au sens du §1.1 : le geste tient en vingt-quatre clics à la main sur huit
permanents, et rien ne se déclenche tout seul. Il émet des `CARD_UPDATED`, comme `ADD_COUNTER`
dont il n'est qu'une répétition, et n'invente aucun event.

Il est **`[libre]`** comme `ADD_COUNTER`, et c'est délibéré : le réserver au contrôleur aurait
refusé par l'assistance ce que le menu accepte déjà à la main — un refus déguisé. Le poison d'un
adversaire est une cible de prolifération ordinaire.

**Les marqueurs sans valeur ne bougent pas.** Un marqueur peut n'être qu'un mot — « vol »,
« monarque » (§3). « Un de plus » n'y a pas de sens, et lui inventer la valeur 1 écrirait
« vol 2 », ce que la v2 a précisément cessé de faire. On incrémente des nombres, on ne juge pas
des mots.

`text` est borné à 200 caractères, échappé, jamais interprété comme du HTML.

Une étiquette portant un `value` est un **compteur libre** : un marqueur posable
n'importe où sur la table, pour ce que les cartes ne portent pas — un « 2/2 »
qui pompe, un compteur d'orages, un décompte de tours. **La valeur est du texte
libre** (24 caractères au plus), et non un entier : on veut poser « X/X »,
« +2/+0 » ou « monarque » aussi bien que « 3 ». L'interface reste celle d'un
compteur — boutons − et + — quand la valeur se lit comme un nombre, et devient un
simple champ de texte sinon. `SET_LABEL` avec `value: null` la retire et ramène
l'étiquette à une simple note. Les étiquettes sont [libre] :
elles appartiennent à la table plus qu'à leur auteur, et chacun les ajuste.

`SCOOP` renvoie chaque carte à sa bibliothèque, détruit les jetons et mélange — mais
**un commandant retourne en zone de commandement**, jamais dans la bibliothèque. Le
serveur le reconnaît à son `origin`, figé au chargement du deck, donc même s'il traînait
sur le champ de bataille au moment du rangement. C'est le geste d'une vraie table :
on range son deck, on garde son commandant devant soi.

Une étiquette peut aussi être **accrochée à une carte** (`attachedTo`) : elle la suit
au lieu de rester à des coordonnées fixes, et ses `x`/`y` deviennent un décalage relatif.
`SET_LABEL` avec `attachedTo: null` la décroche et la laisse flottante.

**Compteurs de joueur.** `SET_PLAYER_COUNTER` à `value: 0` **supprime** le compteur,
exactement comme un marqueur de carte remis à zéro. C'est ce qui permet de retirer un
compteur posé par erreur au lieu de laisser une ligne morte dans le panneau.

### 6.3 Tokens

```ts
interface CreateToken {
  type: 'CREATE_TOKEN';
  scryfallId?: string;      // exclusif avec copyOf
  copyOf?: ObjectId;        // copie un permanent visible du champ de bataille
  count?: number;           // 1..64
  x?: number; y?: number;
  tapped?: boolean;
  counters?: Counter[];
}
interface DestroyToken { type: 'DESTROY_TOKEN'; cardIds: ObjectId[]; }
```

`copyOf` refuse une source qui est un `HiddenCardView` du point de vue de l'auteur
(`ERR_NOT_VISIBLE`) : on ne copie pas ce qu'on n'a pas le droit de voir. Il refuse
aussi (`ERR_BAD_ZONE`) une source qui n'est pas **sur le champ de bataille** :
copier une carte connue par révélation privée — une main montrée à soi seul — en
ferait un jeton public, et publierait à toute la table une information confiée à
un seul siège.

### 6.4 Bibliothèque, mélange, regard

```ts
type LookMode = 'SCRY' | 'SURVEIL' | 'SEARCH' | 'PEEK' | 'REVEAL';

interface Shuffle { type: 'SHUFFLE'; zone: ZoneRef; }   // propriétaire uniquement
interface Look    { type: 'LOOK'; zone: ZoneRef; count: number | 'ALL'; mode: LookMode; }

interface ResolveLook {
  type: 'RESOLVE_LOOK';
  lookId: string;
  top: ObjectId[];        // ordre final, du dessus vers le bas
  bottom: ObjectId[];
  toHand?: ObjectId[];
  toGraveyard?: ObjectId[];
  toExile?: ObjectId[];
  toBattlefield?: ObjectId[];
  toSideboard?: ObjectId[];   // geste de sideboard : fouiller son deck et mettre de côté
  exileFaceDown?: boolean;    // porte sur `toExile` seul ; ailleurs, la zone décide
  shuffleAfter?: boolean;
}

interface ReorderTop { type: 'REORDER_TOP'; zone: ZoneRef; order: ObjectId[]; }
interface Draw       { type: 'DRAW'; count: number; }                 // son siège uniquement
interface Mulligan   { type: 'MULLIGAN'; keep?: number; }             // Londres : pioche 7, remet `keep` cartes dessous

interface Mill          { type: 'MILL'; count: number; }                            // dessus → son cimetière
interface ExileTop      { type: 'EXILE_TOP'; count: number; faceDown?: boolean; }   // dessus → son exil
interface RandomDiscard { type: 'RANDOM_DISCARD'; count: number; }                  // tirage serveur
interface Scoop         { type: 'SCOOP'; }                                          // tout ranger et mélanger

interface Cascade {
  type: 'CASCADE';
  sourceId?: ObjectId;          // carte déclenchante, pour le journal seulement : elle n'est pas touchée
  manaValue: number;            // le seuil, **saisi par le joueur** (0 à 99)
  compare: 'BELOW' | 'AT_MOST'; // cascade (« strictement inférieure ») / découvrir N (« N ou moins »)
}
```

Le cycle « regard » est **stateful** : `LOOK` ouvre une session (`lookId`), verrouille
les N cartes concernées côté serveur, envoie `LOOK_RESULT` au seul demandeur et émet
`LOOK_STARTED` publiquement (« seat_1 regarde 2 cartes »). `RESOLVE_LOOK` clôt la
session ; toute autre manipulation de ces cartes entre-temps est rejetée
(`ERR_LOOK_PENDING`). Le verrou porte sur **la zone entière**, pas seulement sur
les cartes tirées : `DRAW`, `MILL`, `EXILE_TOP`, `SHUFFLE`, `REORDER_TOP`,
`MULLIGAN` et `SCOOP` sur une zone en consultation sont refusés, faute de quoi la
session porterait sur des cartes qui ne sont plus là. Une session non résolue est
auto-annulée après 120 s de déconnexion — le délai court depuis la **coupure du
socket**, pas depuis l'ouverture de la consultation : un joueur qui réfléchit
longtemps ne doit pas perdre son scry à la seconde où sa connexion tombe. Les
cartes retrouvent leur ordre d'origine et la connaissance acquise est purgée. Un
siège qui se lève (`STAND_UP`) libère immédiatement sa session.

`LOOK` sur une zone vide est refusé (`ERR_BAD_ZONE`) : une session à zéro carte
n'apprend rien et bloquerait toute consultation ultérieure du siège.

`RESOLVE_LOOK` accepte une résolution **partielle** — les cartes non citées
restent où elles sont —, refuse tout identifiant hors de la session
(`ERR_UNKNOWN_OBJECT`, sans rien déplacer), et purge `knownTo` des cartes
renvoyées au fond. `toSideboard` existe parce que le sideboard se fait en
fouillant son deck : sans lui, sortir une carte demandait de la prendre en main
puis de la ranger, deux gestes pour un. `exileFaceDown` ne porte que sur
`toExile` — ailleurs (main, cimetière, bibliothèque), être face cachée découle de
la zone (§3).

`MILL` et `EXILE_TOP` prennent des cartes du **dessus** de sa propre
bibliothèque ; `RANDOM_DISCARD` tire dans sa main, et **le tirage est fait par le
serveur** : le client ne choisit pas sa défausse et ne connaît pas la carte avant
les autres (§6.7, l'aléa est serveur uniquement).

`SEARCH` sur sa propre bibliothèque envoie la liste **complète, mélangée côté serveur**,
pour ne pas révéler l'ordre réel au propriétaire lui-même — sinon chercher reviendrait à
connaître sa bibliothèque. Une recherche impose `shuffleAfter: true`.

Le brassage s'applique aussi au **contenu** des vues envoyées : dans un
`LOOK_RESULT` — et dans le `pendingLook` d'un snapshot —, `sortIndex` porte le
rang *montré*, jamais le rang réel dans la zone. Publier le rang réel rendrait le
brassage décoratif : il suffirait de trier par `sortIndex` pour retrouver l'ordre
de sa propre bibliothèque.

#### `CASCADE` — la seule séquence où le serveur lit une carte

**C'est l'intent qui a demandé l'amendement du §1.1 : lisez-le d'abord.** Tout ce qui
suit décrit une **séquence assistée**, jamais un arbitrage, et le §1.1 dit pourquoi la
distinction tient.

La séquence, telle que `resolveCascade` (`apps/server/src/game/cascade.ts`) l'exécute
sur la bibliothèque de l'auteur :

1. **Exiler du dessus, carte par carte, face visible.** Chacune passe par le chemin
   d'émission ordinaire (`relocate` puis `moveEmission`) : la révélation est publique
   parce que la carte arrive dans une zone publique face visible, et non parce qu'un
   raccourci l'aurait décidé. La monotonie de la connaissance (§5.2) s'applique donc
   d'elle-même.
2. **S'arrêter à la première carte qui n'est pas « continuer ».** Un terrain, ou une
   valeur de mana du mauvais côté du seuil : on creuse. Une valeur du bon côté : c'est
   la trouvaille. Une valeur ambiguë : on s'arrête et on le dit (§1.1).
3. **Renvoyer le reste sous la bibliothèque, au hasard et sous un identifiant neuf.**
   Les deux vont ensemble, et c'est le point de confidentialité : ces cartes ont été
   publiées, chaque client en tient la vue indexée par son `ObjectId`. Purger `knownTo`
   sans changer l'identifiant laisserait cette vue en place, et le secret du fond de
   bibliothèque serait un mensonge poli — il suffirait de lire la position des
   identifiants connus. `reassignId` coupe le lien comme `SHUFFLE` le fait depuis
   toujours (§2.1), un `CARD_HIDDEN` fait tomber l'ancienne vue chez **tout le monde,
   propriétaire compris**, et le nouvel identifiant ne sort jamais du serveur.

**Le seuil est saisi, jamais deviné.** `manaValue` et `compare` arrivent du client
parce que c'est le joueur qui lit sa carte. Le catalogue ne stocke aucun texte de
règles : le serveur ne peut pas savoir qu'une carte porte « Discover 4 », et il n'a
donc rien à interpréter. La borne haute du schéma (99) empêche une saisie absurde, pas
un choix de jeu.

**Le journal nomme toutes les cartes exilées**, pas seulement celle sur laquelle on
s'arrête : c'est le garde-fou du §1.1, et il ne doit pas être raccourci. Les noms sont
relevés **tant que les cartes sont à l'exil** — `namedBatch` juge sur la zone
d'arrivée, et refuserait de nommer après la remise en bibliothèque. L'**ancre**, en
revanche, ne désigne que la carte restée à l'exil : les autres viennent de perdre leur
identifiant, et une ancre vers un objet mort ne surligne rien tout en promettant le
contraire.

Au-delà de six cartes, la phrase abrège — et comme il n'y a plus d'ancres à
résoudre, la ligne porte alors `LogEntry.names`, la liste dépliée que le client
affiche telle quelle (§5.4). C'est le seul intent qui en ait besoin. Elle ne dit
rien de plus que la phrase : les mêmes noms, relevés au même moment, pendant que
les cartes étaient à l'exil face visible.

**Volontairement non annulable**, pour la raison de `TAKE_BACK` (§5.3) : rejouer l'état
d'avant republierait, sous leurs anciens identifiants, des cartes que la bibliothèque
vient de reprendre. Se raviser se fait à la main, avec le menu.

**Ajout d'intent, donc non cassant : `PROTOCOL_VERSION` reste à 3** (§11). Aucun event
nouveau, aucun format existant modifié, et un client ancien n'émet simplement jamais
`CASCADE`.

### 6.5 Révélations

```ts
interface Reveal       { type: 'REVEAL'; cardIds: ObjectId[]; toSeats: SeatId[] | 'ALL'; durationMs?: number; }
interface RevealHand   { type: 'REVEAL_HAND'; toSeats: SeatId[] | 'ALL'; }
interface UnrevealHand { type: 'UNREVEAL_HAND'; }
interface RevealTop    { type: 'REVEAL_TOP'; toSeats: SeatId[] | 'ALL'; }   // sa propre bibliothèque
```

Une révélation accorde un droit **définitif** : il survit à tous les changements
de zone, et seul un retour en bibliothèque le purge (§5.2). Le serveur maintient
par objet un ensemble `knownTo: Set<SeatId>`, qui ne rétrécit qu'à cette
occasion.

`REVEAL_HAND` est un droit sur la **zone**, pas sur les cartes présentes à
l'instant t : une carte qui entre dans une main révélée l'est aussi.
`UNREVEAL_HAND` reprend ce droit continu — sinon « masquer sa main » serait un
bouton qui ne fait rien — mais **seulement sur son propre dépôt** : les cartes
encore en main dont cette révélation-là avait accordé la connaissance. Une carte
montrée séparément par `REVEAL`, déjà vue au cimetière, ou partie ailleurs entre
temps, reste connue. Le journal d'une révélation à des sièges nommés n'ancre que
les objets que *tous* les sièges ont le droit de connaître ; il ne nomme jamais
la carte.

Un siège nommé qui n'est pas à la table fait **échouer** la révélation
(`ERR_NOT_SEATED`). Ce n'est pas du pédantisme : un droit accordé à un `SeatId`
absent survit dans `knownTo` et dans `handRevealedTo`, et le prochain joueur qui
s'assoit à cet index en hériterait sans que personne le lui ait accordé. Même
règle pour la source d'un `SET_COMMANDER_DAMAGE`.

#### Révélation permanente du dessus de bibliothèque

`REVEAL_TOP` porte sur **sa propre** bibliothèque et sur elle seule : c'est
*Experimental Frenzy*, *Realmbreaker of the Invasion Tree*, *Vizier of the
Menagerie* — « jouez avec la carte du dessus de votre bibliothèque révélée ».
`toSeats: []` **arrête** la révélation ; il n'existe pas d'intent d'arrêt
séparé, parce que le geste est le même dans les deux sens et qu'une entrée
« Arrêter » ne serait proposée qu'à moitié du temps.

Ce n'est pas un droit sur des objets, c'est un droit sur une **position** : le
dessus, quel qu'il soit. La carte change à chaque pioche, chaque meule, chaque
mélange, chaque scry, et le serveur ne s'en remet à aucun intent pour le savoir.
La réconciliation est faite en **un seul point**, `reconcileTopReveals`, appelée
en fin de `Room.commit` — par où passe toute mutation diffusée. Elle compare le
dessus réel de chaque bibliothèque révélée à ce qui a été publié et n'émet que
la différence ; un intent nouveau n'a donc rien à savoir de cette
fonctionnalité pour ne pas la casser.

**Pourquoi cela ne rouvre pas la brèche de la §2.1.** L'`ObjectId` d'une carte
de bibliothèque sort ici vers les destinataires, ce que la §2.1 interdit en
général. Trois raisons ferment le canal de corrélation :

1. `SHUFFLE` réattribue tous les identifiants et vide `knownTo` : l'identifiant
   connu meurt avec le mélange et ne relie aucun « avant » à aucun « après ».
2. Un seul identifiant est publié à la fois, et il est révoqué dès qu'il cesse
   d'être le dessus : un destinataire ne peut jamais en tenir deux de la même
   bibliothèque, ni *a fortiori* les ordonner.
3. Aucun identifiant **de bibliothèque** ne reste connu d'un siège qui n'y a
   plus droit (§12.7). Si la carte redescend dans la bibliothèque — scry,
   `REORDER_TOP` — ou disparaît dans un mélange, un `CARD_HIDDEN` la fait
   oublier et la connaissance accordée est reprise. Si elle est **piochée**, le
   destinataire la garde : elle a quitté la bibliothèque, et la monotonie de
   `knownTo` veut qu'on n'oublie pas ce qu'on a vu de ses yeux.

Reste une information résiduelle, assumée : un destinataire voit qu'une carte a
quitté le dessus et qu'une autre l'a remplacée. C'est exactement ce que voit
quelqu'un assis en face d'une carte retournée sur un deck, et les comptes de
zone comme les mélanges sont déjà publics.

Côté interface, la carte remplace le dos sur la pile du révélateur, le compte de
zone restant lisible par-dessus ; le propriétaire porte sur sa propre pile un
œil — la convention du projet pour « cette carte est montrée » — dont le titre
nomme les destinataires.

### 6.6 Vie et score

```ts
interface SetLife            { type: 'SET_LIFE'; seat: SeatId; value: number; }                 // [libre]
interface AdjustLife         { type: 'ADJUST_LIFE'; seat: SeatId; delta: number; }              // [libre]
interface SetCommanderDamage { type: 'SET_COMMANDER_DAMAGE'; from: SeatId; to: SeatId; commanderId: ObjectId; value: number; } // receveur seul
interface SetPlayerCounter   { type: 'SET_PLAYER_COUNTER'; seat: SeatId; kind: string; value: number; }  // poison, énergie, expérience
```

**Dégâts de commandant : consultation libre, écriture réservée au receveur.**
C'est la seule entorse assumée au modèle « vraie table » de la §13.1. La matrice
complète est projetée dans chaque `SeatSummary`, donc **tout le monde peut lire les
dégâts de tout le monde** — c'est une information publique à une table. En revanche
`SET_COMMANDER_DAMAGE` exige `to === <siège de l'auteur>` : chacun ne tient que le
compte de ce qu'il **reçoit**, et le serveur rejette le reste avec `ERR_NOT_YOURS`.

La raison est asymétrique avec celle des points de vie : ajuster la vie d'un
adversaire se voit, se discute et se corrige d'un mot. Déclarer soi-même avoir
infligé 21 dégâts de commandant à un adversaire, c'est prononcer son élimination à sa
place. Le receveur est le seul à savoir ce qu'il a réellement encaissé, et c'est lui
qui tient le compte, exactement comme il tient ses propres points de vie sur une
feuille.

La taxe de commandant est **dérivée**, pas pilotée : elle s'incrémente automatiquement
quand un objet de la zone de commandement part vers la pile (`STACK_NOTE`) ou le
champ de bataille, et émet alors `COMMANDER_TAX_CHANGED`. Un déplacement à
l'intérieur du champ de bataille ne compte pas : seul un départ de la zone de
commandement est un lancement. Elle est corrigible à la main via
`SET_PLAYER_COUNTER` de kind `commander_tax:<objectId>`, qui n'écrit pas un
compteur de joueur mais bien la taxe, et émet `COMMANDER_TAX_CHANGED`.

### 6.7 Aléa, tour, social

```ts
interface RollDie    { type: 'ROLL_DIE'; sides: number; count?: number; }  // sides 2..1000, count 1..20
interface FlipCoin   { type: 'FLIP_COIN'; count?: number; }
interface EndTurn    { type: 'END_TURN'; }
interface SetPhase   { type: 'SET_PHASE'; phase: PhaseName; }              // purement déclaratif
interface Concede    { type: 'CONCEDE'; }
interface ChatBubble { type: 'CHAT_BUBBLE'; text: string; }                // ≤ 240 caractères
interface Cursor     { type: 'CURSOR'; x: number; y: number; holding?: ObjectId; }  // non journalisé
interface UndoLast   { type: 'UNDO_LAST'; }
```

L'aléa est **serveur uniquement** : `Math.random` côté client n'est jamais utilisé pour
un dé, une pièce, un mélange ou un `index: 'RANDOM'`. Source : `crypto.randomInt`,
mélange de Fisher-Yates.

#### Repère des coordonnées — invariant de table partagée

`CURSOR.x/y`, comme `MOVE_CARD.x/y` et `ADD_LABEL.x/y`, sont exprimés dans **le repère
du monde partagé**, pas dans celui de l'écran de l'émetteur.

Il en découle une contrainte que le client doit tenir : **la disposition des sièges est
une fonction pure du `seatIndex`, identique sur tous les clients.** Un client n'a pas le
droit de réarranger le monde pour placer son propre siège à un endroit qui l'arrange —
sinon une même coordonnée désigne deux endroits différents selon qui regarde, et le
curseur d'un adversaire pointe une carte qui n'est pas celle qu'il vise.

Ce que chaque client peut faire librement, en revanche, c'est **cadrer** : la
translation et le zoom de la caméra lui sont propres. Placer son siège « en bas » se
fait en centrant la vue dessus au moment de s'asseoir, jamais en déplaçant les panneaux.
Une coordonnée de monde se rend alors correctement sous n'importe quel cadrage.

Les coordonnées de dépôt sont calculées relativement au panneau survolé, ce qui les
rend indépendantes du cadrage par construction.

### 6.8 Gestion de partie

```ts
interface SitDown       { type: 'SIT_DOWN'; seatIndex: number; displayName?: string; deckId?: string; deckText?: string; }
interface StandUp       { type: 'STAND_UP'; force?: boolean; }
interface CloseRoom     { type: 'CLOSE_ROOM'; }                                      // hôte
interface LoadDeck      { type: 'LOAD_DECK'; deckId?: string; deckText?: string; }   // avant START_GAME
interface StartGame     { type: 'START_GAME'; }                                      // hôte
interface RestartGame   { type: 'RESTART_GAME'; keepDecks: boolean; }                // hôte
interface SwapSideboard { type: 'SWAP_SIDEBOARD'; in: ObjectId[]; out: ObjectId[]; } // entre parties
interface SetSeatCosmetics { type: 'SET_SEAT_COSMETICS'; playmatUrl?: string | null;
                             cardBackUrl?: string | null; displayName?: string; }   // son siège
```

`START_GAME` fige un `DeckSnapshot` par siège : une modification ultérieure du `Deck` en
base n'affecte jamais une partie en cours. Il est refusé
(`ERR_GAME_NOT_STARTED`) tant qu'un siège n'a pas de deck chargé : mieux vaut ne
pas commencer que commencer à moitié.

`SIT_DOWN` ne rend **jamais** un siège déjà occupé, y compris quand son joueur est
déconnecté : sa main et sa bibliothèque sont encore là, et les lui prendre
reviendrait à les lire. Un siège déconnecté se reprend par `seatToken` (§8), ou
par `sessionToken` si le siège appartient au même compte. Sinon : `ERR_SEAT_TAKEN`.

**`STAND_UP` en cours de partie exige `force: true`** (`ERR_GAME_ALREADY_STARTED`
sinon). Un joueur peut partir à tout moment — c'est ce qu'il fait sur une vraie
table — mais il ne s'évapore pas par accident en laissant ses permanents sur le
tapis : le drapeau est le consentement, que l'interface ne pose qu'après
confirmation explicite. Ce départ **vaut concession** : s'il ne laisse qu'un seul
joueur en lice, le serveur émet `GAME_ENDED` comme après un `CONCEDE`. Hors
partie, `STAND_UP` nu suffit.

**`CLOSE_ROOM` clôt la table pour tout le monde**, et n'est accepté que du siège
hôte (`ERR_NOT_HOST` sinon). La partie passe en `ENDED` et tous les clients
reçoivent `GAME_ENDED` avec `reason: 'HOST'` ; personne n'est expulsé de sa page,
il n'y a simplement plus rien à y jouer. La même clôture est offerte au créateur
du salon hors de la table, par `POST /api/rooms/:code/close` — l'autorité y est
le `hostUserId` du salon, non le siège.

Se lever emporte **tout** le matériel du siège : objets, zones, étiquettes, et
jusqu'aux traces que les autres en gardaient — `knownTo`, `handRevealedTo`,
`commanderDamage`, attachements. Le siège redevient vraiment libre : celui qui le
reprend n'hérite ni des cartes, ni des droits de regard du précédent. Les autres
clients reçoivent `SEAT_LEFT`, un `CARD_HIDDEN` par carte retirée, les
`TOKENS_DESTROYED` et les `ZONE_COUNT` remis à zéro.

`RESTART_GAME` est réservé à l'hôte et ramène la table au lobby : statut `LOBBY`,
tour remis à zéro, vies, marqueurs, dégâts et taxes de commandant effacés.

- `keepDecks: true` rejoue le même matériel. Chaque carte retourne à la zone où le
  `DeckSnapshot` l'avait placée, les jetons cessent d'exister, et les
  bibliothèques sont remélangées — donc avec de nouveaux `ObjectId` (§2.1). Les
  échanges de réserve déjà faits sont conservés : c'est le comportement attendu
  entre deux manches d'un même match.
- `keepDecks: false` vide la table ; chaque siège rechargera son deck.

`SWAP_SIDEBOARD` n'est accepté qu'**entre deux parties** (`ERR_GAME_ALREADY_STARTED`
en cours de partie). Les cartes de `in` viennent de la réserve, celles de `out` de
la bibliothèque, et toutes appartiennent à l'auteur. L'échange se termine par un
mélange de la bibliothèque : d'abord parce qu'une vraie table présente un deck
mélangé, ensuite parce qu'une carte sortie de la bibliothèque emporterait son
`ObjectId` dans la réserve, où il est publié.

`SET_SEAT_COSMETICS` ne touche que le siège de son auteur et émet
`SEAT_COSMETICS`. Un champ absent est laissé tel quel, `null` efface. Il porte
aussi le **pseudo affiché**, modifiable tant que la partie n'a pas commencé
seulement (`ERR_GAME_ALREADY_STARTED` sinon) : en cours de partie, changer de nom
brouillerait un journal d'actions déjà écrit, qui nomme l'auteur de chaque ligne.

---

## 7. Events

```ts
type Event =
  // cartes
  | { type: 'CARD_MOVED'; card: CardView; from: ZoneRef; to: ZoneRef; index?: number }
  | { type: 'CARDS_MOVED'; cards: CardView[]; from: ZoneRef; to: ZoneRef }
  | { type: 'CARD_UPDATED'; card: CardView }                 // tap, compteurs, rotation, position
  | { type: 'CARD_REVEALED'; card: PublicCardView; toSeats: SeatId[] }
  | { type: 'CARD_HIDDEN'; cardId: ObjectId }
  | { type: 'TOKENS_CREATED'; cards: PublicCardView[] }
  | { type: 'TOKENS_DESTROYED'; cardIds: ObjectId[] }
  | { type: 'ATTACHED'; sourceId: ObjectId; targetId: ObjectId }
  | { type: 'DETACHED'; sourceId: ObjectId }
  // zones
  | { type: 'ZONE_SHUFFLED'; zone: ZoneRef; count: number }   // + ré-attribution d'ids (§2.1)
  | { type: 'ZONE_COUNT'; zone: ZoneRef; count: number }
  | { type: 'LOOK_STARTED'; lookId: string; seat: SeatId; zone: ZoneRef; count: number; mode: LookMode;
      cards?: PublicCardView[] }                                                 // `cards` : mode REVEAL seulement
  | { type: 'LOOK_RESULT'; lookId: string; mode: LookMode; cards: PublicCardView[] }   // audience SEAT
  | { type: 'LOOK_RESOLVED'; lookId: string; seat: SeatId; summary: LookSummary } // agrégat public
  | { type: 'HAND_REVEALED'; seat: SeatId; toSeats: SeatId[]; cards: PublicCardView[] }
  | { type: 'HAND_UNREVEALED'; seat: SeatId }
  | { type: 'TOP_REVEALED'; seat: SeatId; toSeats: SeatId[]; card: PublicCardView | null }
  // joueurs
  | { type: 'LIFE_CHANGED'; seat: SeatId; value: number; delta: number }
  | { type: 'COMMANDER_DAMAGE_CHANGED'; from: SeatId; to: SeatId; commanderId: ObjectId; value: number }
  | { type: 'COMMANDER_TAX_CHANGED'; seat: SeatId; commanderId: ObjectId; casts: number }
  | { type: 'PLAYER_COUNTER_CHANGED'; seat: SeatId; kind: string; value: number }
  | { type: 'SEAT_JOINED'; seat: SeatSummary }
  | { type: 'SEAT_LEFT'; seatId: SeatId }
  | { type: 'SEAT_CONNECTION'; seatId: SeatId; connected: boolean }
  | { type: 'SEAT_CONCEDED'; seatId: SeatId }
  | { type: 'DECK_LOADED'; seatId: SeatId; deckName: string; cardCount: number; commanders: PublicCardView[] }
  // table
  | { type: 'LABEL_ADDED'; label: Label }
  | { type: 'LABEL_MOVED'; labelId: ObjectId; x: number; y: number }
  | { type: 'LABEL_UPDATED'; label: Label }
  | { type: 'LABEL_REMOVED'; labelId: ObjectId }
  | { type: 'DICE_ROLLED'; seat: SeatId; sides: number; results: number[] }
  | { type: 'COIN_FLIPPED'; seat: SeatId; results: ('HEADS' | 'TAILS')[] }
  | { type: 'TURN_ENDED'; seat: SeatId; nextSeat: SeatId; turnNumber: number }
  | { type: 'PHASE_CHANGED'; phase: PhaseName }
  | { type: 'GAME_STARTED'; startingSeat: SeatId; snapshotIds: Record<SeatId, string> }
  | { type: 'GAME_ENDED'; reason: 'CONCEDE' | 'HOST' | 'TIMEOUT'; winners: SeatId[] }
  | { type: 'CHAT'; seat: SeatId; text: string }
  | { type: 'UNDONE'; undoneSeq: Seq }
  | { type: 'NOTED' }                                        // porte une ligne de journal, rien d'autre
  | { type: 'SEAT_COSMETICS'; seatId: SeatId; playmatUrl: string | null; cardBackUrl: string | null;
      displayName: string };
```

`LOOK_STARTED` est public (audience `ALL`) et ne porte normalement que l'agrégat :
qui regarde, quelle zone, combien de cartes, sous quel `mode`. Son champ
**`cards` est optionnel et n'est servi que pour le mode `REVEAL`** (§6.4), où le
contenu est justement montré à toute la table ; il est absent pour `SCRY`,
`SURVEIL`, `SEARCH` et `PEEK`, dont le contenu ne part qu'au consultant par
`LOOK_RESULT`. Un client ne doit donc jamais supposer sa présence.

`LOOK_RESULT` porte le `mode` de la session en plus de son `lookId` et de ses
cartes : le destinataire doit savoir quelle interface ouvrir — réordonner un
scry, piocher d'une recherche — sans avoir à retenir le `LOOK_STARTED`
correspondant, qu'une resynchronisation a pu lui faire manquer. Même raison pour
`Snapshot.pendingLook`, qui porte le même champ (§8.1).

`TOP_REVEALED` est d'audience **`ALL`**, en deux variantes : seul un destinataire
reçoit `card`, les autres reçoivent le fait — `card: null` — et la liste des
destinataires. Les mettre hors audience leur ferait sauter un `seq`, donc
déclencher une resynchronisation complète à chaque pioche de l'adversaire, ce qui
serait absurde pour une information qu'ils ont de toute façon le droit de
connaître. `toSeats: []` signifie « révélation terminée » et le client retire
l'entrée. C'est le seul event qui publie une carte de bibliothèque en cours de
partie (§6.5).

`NOTED` est l'event vide. Il sert deux fois : pour un fait qui n'existe que dans le
journal (un `UNTAP_ALL`, une révélation à des sièges nommés), et comme variante
servie aux sièges hors audience de **n'importe quel** event — que l'émission
porte une ligne de journal ou non (§4.2, §5). C'est ce second emploi qui rend la
séquence dense : un `LOOK_RESULT`, restreint au seul consultant et muet au
journal, laisse tout de même un `NOTED` aux autres sièges pour son `seq`.
Un client qui ne sait qu'en faire enregistre son `seq` et affiche son `log` s'il
y en a un : c'est exactement ce qu'il y a à en faire. `NOTED` ne fuite rien — il
n'énonce que « un `seq` s'est produit », ce que le trou qu'il comble annonçait
déjà.

Il n'y a **pas** d'event de planechase. Le mode a été retiré le 15 septembre
2026, faute d'implémentation : il promettait ce que la table ne tenait pas. La
valeur subsiste dans l'enum Prisma pour ne pas casser les parties déjà
enregistrées, et le serveur les ramène à `COMMANDER` au chargement.

Hors séquence (non journalisé, non persisté, sans `seq`) :

```ts
interface CursorFrame {
  t: 'cursors';
  seats: Array<{ seat: SeatId; x: number; y: number; holding?: ObjectId }>;
}
```

Les curseurs sont agrégés côté serveur et diffusés à 20 Hz maximum, en une frame unique
pour toute la room. Un `CURSOR` reçu à moins de 50 ms du précédent est ignoré
silencieusement (pas de `reject`, pas de quota consommé).

---

## 8. Handshake et cycle de vie

```
client                                        serveur
  |  hello {protocol, sessionToken?, seatToken?, sinceSeq?}
  |------------------------------------------------>|  vérifie protocole, auth, room, mot de passe
  |  hello {seat, seatToken, snapshot | delta}       |
  |<------------------------------------------------|
  |  intent …                       event …          |
```

- `protocol` ≠ `PROTOCOL_VERSION` → `error{code:'ERR_PROTOCOL', fatal:true}` puis
  fermeture 4400. Le client affiche « recharge la page ».
- Pas de `sessionToken` → joueur invité ; il fournit son pseudo via `SIT_DOWN`.
- `seatToken` est un jeton opaque signé, émis au premier `SIT_DOWN`, stocké en
  `localStorage`. C'est lui qui permet à un invité de retrouver **son** siège après un
  rechargement. Sans lui, la connexion reste en attente d'un `SIT_DOWN` et ne reçoit
  aucun état de partie.
- Un siège dont le socket tombe est marqué `connected: false` et **conservé**. Il est
  libéré sur `STAND_UP`, ou après 30 min d'inactivité de la room.

### 8.1 Resynchronisation

Le serveur conserve en mémoire les `EVENT_BUFFER = 2000` derniers events par room,
**dans leur variante par siège**.

```
reconnexion : hello {sinceSeq: 411}
  411 >= seq_min_buffer  →  hello {delta: ServerEvent[]}   le client rejoue
  sinon                  →  hello {snapshot: Snapshot}     le client remplace son état
```

Quatre cas basculent sur le snapshot complet, jamais sur un delta :
`sinceSeq` antérieur au tampon (`LIMITS.eventBuffer` events conservés),
`sinceSeq` **supérieur** au `seq` du serveur — le client vient d'un état que
cette room n'a pas produit —, toute connexion sans siège, qui n'a aucun état de
partie à rattraper, et enfin `sinceSeq` **antérieur à l'arrivée du siège** : le
tampon ne contient aucune variante pour un siège qui n'existait pas encore, et le
rejouer donnerait un état amputé sans que rien ne le signale.

Contrainte d'implémentation : `snapshot(T) + delta(T→T')` doit être
**indistinguable** de `snapshot(T')`. Tout intent qui modifie l'état sans émettre
l'event correspondant fait diverger les deux chemins ; c'est un bug de serveur,
pas une tolérance de client. `START_GAME` et `LOAD_DECK`, qui créent ou déplacent
des cartes, émettent donc leurs `CARD_MOVED` / `CARDS_MOVED` comme les autres.

Le client détecte aussi un trou en réception (`seq !== lastSeq + 1`) et envoie
`resync{sinceSeq}` sans attendre la coupure du socket.

**Cette détection ne vaut que parce que la séquence est dense** (§5) : un siège
connecté reçoit exactement un message par `seq`, event réel ou `NOTED`. Un `seq`
qu'aucune variante ne couvrait n'était pas « rien » pour le client, c'était un
trou — donc un `resync` par event suivant, et le même journal rejoué à chaque
réponse `hello/delta`.

Le tampon obéit à la même règle, et `deltaFor` la vérifie : si une variante
manque pour le siège demandé sur un `seq` de l'intervalle, la fonction rend
`null` — donc **snapshot complet** — au lieu de servir un delta troué. Un delta
amputé recréerait chez le client le trou même qu'on cherche à supprimer ; un
snapshot est la seule réponse honnête.

Deux garde-fous existent en plus **côté client** (`apps/web/src/store/game.ts`),
en défense en profondeur :

- un drapeau interdit d'empiler un second `resync` tant que le `hello` du
  premier n'est pas revenu — sinon un commit produisant plusieurs events en
  déclenche un par event ;
- les entrées de journal sont dédupliquées **par `seq`** dans le chemin
  `hello/delta`, un resync en vol pouvant chevaucher des events reçus en direct.

Ils restent utiles alors même que la séquence est dense : ils rendent le client
robuste à un serveur plus ancien et à deux resyncs qui se croisent.

```ts
interface Snapshot {
  seq: Seq;
  room: { code: string; mode: GameMode; status: RoomStatus; closed: boolean;
          hostSeat: SeatId | null };
  seats: SeatSummary[];
  turn: { activeSeat: SeatId | null; turnNumber: number; phase: PhaseName };
  cards: CardView[];           // déjà projetées pour le destinataire
  zoneCounts: OpaqueZoneView[];
  labels: Label[];
  pendingLook?: { lookId: string; mode: LookMode; cards: PublicCardView[] };
  topReveals?: Array<{ seat: SeatId; toSeats: SeatId[]; cardId: ObjectId | null }>;
  logTail: LogEntry[];         // 200 dernières entrées, à l'identique pour tous (§5.4)
}
```

**Trois champs sont nullables, et c'est le lobby qui l'exige** : `room.hostSeat`
vaut `null` tant que personne n'est assis, `turn.activeSeat` tant que la partie
n'a pas démarré, et `room.closed` dit qu'une `CLOSE_ROOM` est passée (§6.8) —
distinct de `status: 'ENDED'`, qui peut aussi venir d'une concession. Un client
qui suppose ces deux `SeatId` non nuls casse au **premier écran** qu'il
rencontre, pas dans un cas limite.

`pendingLook` porte le `mode` de la session en cours, comme `LOOK_RESULT` (§7) :
un client qui reprend sur snapshot n'a jamais vu le `LOOK_STARTED` et ne saurait
sinon pas quelle interface de consultation rouvrir. Ses `cards` sont brassées et
leur `sortIndex` est le rang *montré*, jamais le rang réel (§6.4).

`topReveals` est absent quand aucune bibliothèque n'a son dessus révélé — le cas
courant. Il n'est pas décoratif : sans lui, un rechargement de page, ou toute
resynchronisation qui bascule sur le snapshot, ferait disparaître une carte que
la table voit pourtant retournée, et `snapshot(T)` cesserait d'être
indistinguable de `snapshot(T₀) + delta`. `cardId` n'est renseigné que pour un
destinataire ; la carte elle-même est jointe à `cards`, projetée par la même
fonction que le reste.

#### Les trois types portés par le snapshot

`SeatSummary`, `Label` et `LogEntry` sont cités par le snapshot et par plusieurs
events (`SEAT_JOINED`, `LABEL_ADDED` / `LABEL_UPDATED`, §7). Les voici en entier,
puisque c'est ici qu'on les rencontre :

```ts
interface SeatSummary {
  id: SeatId;
  seatIndex: number;
  displayName: string;
  userId: string | null;          // null : joueur invité
  connected: boolean;
  conceded: boolean;
  life: number;
  handCount: number;              // le compte, jamais le contenu (§2.3)
  playerCounters: Counter[];      // poison, énergie, expérience, mulligans…
  commanderDamage: Record<SeatId, Record<ObjectId, number>>;  // reçus, par source puis commandant
  commanderTax: Record<ObjectId, number>;
  playmatUrl: string | null;
  cardBackUrl: string | null;
  color: string;
  deckName: string | null;
}

interface Label {
  id: ObjectId;
  text: string;
  x: number; y: number;           // décalage relatif à la carte si `attachedTo`
  color?: string;
  owner: SeatId;
  value?: string;                 // texte libre : compteur libre (§6.2) ; absent = simple note
  attachedTo?: ObjectId;
}

interface LogEntry {
  seq: Seq;
  at: number;
  actor: SeatId | null;           // null : commit système (déconnexion, balayage)
  text: string;
  cardIds: ObjectId[];
  names?: string[];               // lot déplié, quand les ancres ne le couvrent pas (§5.4)
}
```

`SeatSummary` est **entièrement public** : c'est de là que vient la lecture libre
des dégâts de commandant (§6.6), et c'est pourquoi la main n'y figure que par son
`handCount`. `commanderDamage` est indexé par siège source puis par commandant —
un joueur peut en avoir deux.

**Tous les champs de `LogEntry` sont publics pour toute la table**, quelle que
soit l'audience de l'event qui les a portés : c'est la règle du §5.4, et ce type
en est la forme. Le texte est construit une fois côté serveur, jamais projeté par
destinataire, et `logTail` le recopie à l'identique dans le snapshot de chaque
siège. Le `seq` est ce par quoi un client déduplique les entrées quand un resync
chevauche le flux direct (§8.1) ; `cardIds` est ce par quoi le client surligne
sur la table, et ce que `TAKE_BACK` parcourt pour effacer le passé (§5.3) ;
`names`, quand il est là, est le **lot déplié** — voir §5.4.

Le snapshot est **toujours** construit par la même fonction de projection
`projectFor(seat, state)` que les events : il n'existe qu'un seul endroit où la
confidentialité est décidée. C'est une contrainte d'implémentation, pas un détail.

Le snapshot d'une connexion **sans siège** ne contient ni carte, ni compte de
zone, ni étiquette, ni journal : seulement la room, ses sièges et le tour. C'est
l'application littérale de la §13.4.

### 8.2 Keepalive

`ping`/`pong` applicatifs toutes les 15 s, en plus du ping WebSocket. Trois pongs
manqués → fermeture 1001 et siège marqué déconnecté.

---

## 9. `UNDO_LAST`

Annule **le dernier event dont l'auteur est l'appelant**, si et seulement si :

- il date de moins de 10 s ;
- aucun event postérieur d'un autre siège ne touche les objets concernés ;
- son type est réversible — tout sauf `SHUFFLE`, `DRAW` de plus d'une carte, un `LOOK`
  résolu, `DICE_ROLLED`, `COIN_FLIPPED`, `GAME_STARTED`.

Une action irréversible du même siège **ferme** l'annulation : après un `SHUFFLE`,
`UNDO_LAST` ne remonte pas à l'action d'avant. `UNDO_LAST` annule *la dernière*
action de son auteur, ou rien.

Les commits sans auteur (déconnexion d'un autre joueur, balayage d'une
consultation abandonnée) ne comptent pas comme « un event postérieur d'un autre
siège » : ils ne bloquent pas l'annulation.

L'annulation n'efface pas l'historique : elle émet `UNDONE{undoneSeq}` suivi des events
de restauration, avec de nouveaux `seq`. Le journal garde trace des deux. Sinon :
`ERR_UNDO_UNAVAILABLE`, avec la raison en clair.

---

## 10. Prédiction client

Le client peut anticiper localement, avant l'`ack` :

- le déplacement visuel d'une carte qu'il contrôle sur le champ de bataille,
- le tap / untap,
- l'ouverture d'une modale.

Il ne prédit jamais : pioche, mélange, dé, création de token, tout changement impliquant
une zone cachée. Toute prédiction est réconciliée à l'`ack` ; sur `reject`, le client
restaure l'état issu du dernier event et affiche un toast discret.

---

## 11. Limites, erreurs, quotas, évolution

```ts
type ErrorCode =
  | 'ERR_PROTOCOL' | 'ERR_AUTH' | 'ERR_ROOM_NOT_FOUND' | 'ERR_ROOM_FULL'
  | 'ERR_ROOM_PASSWORD' | 'ERR_NOT_SEATED' | 'ERR_NOT_HOST' | 'ERR_ROOM_CLOSED' | 'ERR_SEAT_TAKEN'
  | 'ERR_UNKNOWN_OBJECT' | 'ERR_NOT_YOURS' | 'ERR_NOT_VISIBLE' | 'ERR_BAD_ZONE'
  | 'ERR_LOOK_PENDING' | 'ERR_UNDO_UNAVAILABLE' | 'ERR_GAME_NOT_STARTED'
  | 'ERR_GAME_ALREADY_STARTED' | 'ERR_RATE_LIMIT' | 'ERR_PAYLOAD' | 'ERR_INTERNAL';
```

**Quatre sièges au plus par table.** Le produit vise la partie de Commander à
quatre, pas la table géante. Un `SIT_DOWN` au-delà est refusé par `ERR_ROOM_FULL`, et
`seatIndex` est borné par le schéma. Le mode Treachery, envisagé plus tard, demandera de
revoir ce plafond **et** la disposition des panneaux en même temps.

Quotas par socket : 60 intents/s en rafale, 20/s soutenu (token bucket) ; les curseurs
sont exclus et traités par leur propre throttle. Frame entrante > 64 KiB → fermeture
1009. Cinq `ERR_RATE_LIMIT` en 10 s → fermeture 4429.

Validation : tout payload entrant passe par un schéma Zod dérivé de ces types, en mode
`strict` — un champ inconnu est rejeté, pas ignoré.

Évolution : `PROTOCOL_VERSION` est incrémenté à tout changement non rétro-compatible.
Ajouter un champ optionnel ou un nouveau type d'event n'est pas cassant : le client
ignore un `event.type` inconnu après avoir enregistré le `seq`, et reste synchrone. Le
passage ultérieur à un encodage binaire ne change ni la sémantique, ni les audiences,
ni les `seq` ; il se négocie par `Sec-WebSocket-Protocol` et ne remonte pas la version.

Application du critère à `TAKE_BACK` (§5.3), qui **ne monte pas** la version :
il ajoute un intent qu'un onglet ancien n'enverra jamais, faute d'entrée de
menu, et n'invente aucun event — le geste s'écrit avec `CARD_HIDDEN` puis
`CARD_MOVED`, connus depuis la version 1 et traités par tout client comme
« oublie cet objet », puis « voici un objet ». Un onglet resté ouvert pendant le
déploiement voit donc la carte disparaître et la nouvelle arriver, sans rien
afficher de périmé : c'est exactement ce que la règle ci-dessus appelle non
cassant. Fermer toutes les tables en cours pour une entrée de menu qu'elles
n'auraient pas serait une punition sans motif.

Même application à la **densité de séquence** (§5), qui **ne monte pas** non plus
la version : aucun format de message ne change, `NOTED` existe depuis la version
1 et tout client sait déjà l'ignorer après avoir enregistré son `seq`. Le
changement ne fait qu'en émettre davantage — là où le client voyait un trou, il
voit maintenant un event qu'il ignore. Monter la version aurait fermé toutes les
tables en cours sans rien apporter à personne.

`NAMED_LOG_LIMIT` est, avec `PROTOCOL_VERSION`, une **constante de protocole** :
elle vit dans `packages/shared/src/protocol/core.ts` et les deux côtés doivent la
lire pareil (§5.4). La modifier ne casse rien au sens ci-dessus — un client et un
serveur qui divergent sur sa valeur restent synchrones, seul le bouton
« déplier » du journal devient inexact.

---

## 12. Critères d'acceptation attachés à ce document

1. **Convergence** — 4 contextes Playwright, une room, 4 decks importés, une dizaine
   d'actions : les 4 clients exposent le même `seq` final et le même état projeté.
2. **Étanchéité** — un harnais capture toutes les frames reçues par le siège B et
   vérifie qu'aucune ne contient un `scryfallId` appartenant à la bibliothèque ou à la
   main de A, ni un `ObjectId` de bibliothèque de A. Le test échoue si une frame
   contient un champ hors de la liste blanche de `HiddenCardView`.
3. **Resynchro** — socket coupé 30 s pendant que les autres jouent, puis reconnexion :
   l'état du client reconnecté est identique à celui d'un client resté connecté.
4. **Mélange non corrélable** — après `SHUFFLE`, aucun `ObjectId` précédemment observé
   par un autre siège ne réapparaît.
5. **Ordre ack/event** — pour 200 intents envoyés en rafale, chaque `ack` arrive après
   son event, et les `seq` reçus sont strictement croissants sans trou.
6. **Équivalence delta/snapshot** — pour une séquence d'intents couvrant toutes
   les zones, un client qui applique `snapshot(T)` puis le delta `T→T'` obtient
   un état identique à `snapshot(T')`.
7. **Invariants d'état** — après *chaque* intent d'une longue séquence aléatoire,
   départs et arrivées de sièges compris : tout objet est listé une fois et une
   seule dans sa zone, aucune zone ne contient d'identifiant fantôme, `sortIndex`
   est le rang exact dans la zone, aucun `attachedTo` ne pointe hors du champ de
   bataille, aucune carte de bibliothèque n'est connue d'un autre siège que son
   propriétaire, et aucun `SeatId` absent de la table ne subsiste dans un
   `knownTo`, un `handRevealedTo` ou un `commanderDamage`.
8. **Journal public** — toute ligne de journal produite par un event atteint tous
   les sièges, y compris ceux que l'event lui-même ne concerne pas.
9. **Monotonie de la connaissance** — une carte montrée à un siège, puis promenée
   du champ de bataille au cimetière et de là à la main, reste connue de ce siège
   à chaque étape, y compris posée face cachée. Elle ne cesse de l'être qu'en
   entrant en bibliothèque, et le mélange qui suit lui donne un nouvel
   identifiant (§5.2).
10. **Rattrapage d'une maladresse** — après un `TAKE_BACK`, les frames brutes
    reçues par le siège adverse ne contiennent plus l'identité de la carte,
    l'ancien `ObjectId` n'existe plus — ni dans l'état, ni dans un snapshot, ni
    dans une ancre de journal —, le journal ne nomme plus la carte, et le geste
    a produit une ligne nominative lue par toute la table. Le refus par un siège
    qui n'en est pas le propriétaire est vérifié au même endroit (§5.3).

---

## 13. Décisions arrêtées

1. **Modèle « vraie table »** — les intents marqués [libre] restent ouverts à tout
   siège : on peut taper, déplacer, compter sur le permanent d'un autre. Le journal
   d'actions nomme systématiquement l'auteur, ce qui suffit à l'arbitrage social.
2. **`SEARCH` mélangé** — confirmé. Une recherche dans sa propre bibliothèque renvoie
   la liste dans un ordre mélangé côté serveur, et impose `shuffleAfter: true`.
3. **Pas de pile formelle** — `STACK_NOTE` est une zone décorative, sans résolution
   ni priorité. Conforme au hors-périmètre.
4. **Pas de spectateurs** — une connexion est soit un siège joueur, soit une connexion
   en attente de `SIT_DOWN`. Aucun état de partie n'est envoyé hors d'un siège.
5. **Assister est permis, arbitrer ne l'est pas** (§1.1) — arrêté le 18 septembre 2026,
   à l'occasion de la cascade. Le principe 5 de la §1 n'est ni retiré ni assoupli : il
   reçoit une frontière. Une séquence que le joueur déclenche, peut refaire à la main
   et dont il garde la conclusion est permise, même si le serveur y lit une carte ;
   refuser un geste, en imposer la conséquence ou conclure à la place du joueur reste
   interdit. Les trois propriétés du §1.1 sont le **critère** de toute demande à venir,
   et le saut automatique des terrains en est le prix, consigné.

---

## 14. Ancrage sur l'interface de référence

L'interface cible est celle de la capture de référence (`docs/ui-reference.md`). Les
éléments suivants y sont visibles et ont chacun leur pendant dans ce protocole :

| Élément d'interface | Source protocolaire |
|---|---|
| Journal d'actions, phrases nommant l'auteur | `GameLog` dérivé de chaque event + `actor` |
| « Workris is viewing their library » | `LOOK_STARTED` (agrégat public, contenu privé) |
| Curseur nommé d'un autre joueur | `CursorFrame`, 20 Hz, hors séquence, en coordonnées de monde (§6.7) |
| Compteurs de bibliothèque / cimetière / exil | `ZONE_COUNT` / `OpaqueZoneView` |
| Badge numérique au coin d'une zone | `count` de la zone, jamais son contenu |
| Panneau Life + Commander Damage | `LIFE_CHANGED`, `COMMANDER_DAMAGE_CHANGED` |
| Boutons `Untap All`, `Draw` | `UNTAP_ALL`, `DRAW` |
| Menu `Create` | `CREATE_TOKEN` (recherche ou `copyOf`) |
| Boutons `d20`, `Roll…`, `Flip` | `ROLL_DIE`, `FLIP_COIN` |
| Playmat propre à chaque siège | `SeatSummary.playmatUrl`, cosmétique, hors séquence |
| Main en bas, agrandie au survol | zone `HAND`, `PublicCardView` pour son seul siège |
| Piles de tokens groupées | plusieurs `TOKENS_CREATED` d'un même `scryfallId` |

---

## Journal du document

| Version | Date | Changement |
|---|---|---|
| 1 | 2026-09-15 | Rédaction initiale |
| 2 | 2026-09-15 | Spectateurs supprimés, §13 arbitrée, §14 ancrage UI |
| 4 | 2026-09-15 | Second passage : `NOTED` et journal diffusé à tous (§4.2, §7), `RESTART_GAME` / `SWAP_SIDEBOARD` / `SET_SEAT_COSMETICS` implémentés (§6.8), `STAND_UP` après concession et nettoyage complet du siège (§6.8), taxe de commandant dérivée (§6.6), sièges nommés inexistants refusés (§6.5), abandon de consultation compté depuis la coupure (§6.4), delta refusé avant l'arrivée du siège (§8.1), critères §12.7 étendu et §12.8 |
| 5 | 2026-09-16 | Révélation permanente du dessus de bibliothèque : intent `REVEAL_TOP` et réconciliation en un point unique (§6.5), event `TOP_REVEALED` d'audience `ALL` en deux variantes (§7), champ `Snapshot.topReveals` (§8.1). **`PROTOCOL_VERSION` monte à 3** (§11) : un client ancien ignorerait l'event et afficherait une carte périmée sur la pile. |
| 6 | 2026-09-16 | Monotonie de `knownTo` (§5.2) : une connaissance acquise survit à tous les changements de zone, seule l'entrée en bibliothèque l'efface. `relocate` ne recalcule plus `knownTo` à l'arrivée, `UNREVEAL_HAND` ne reprend que son propre dépôt (§6.5), une carte piochée après révélation du dessus reste connue. Critère §12.9. **Aucun format de message ne change : `PROTOCOL_VERSION` reste à 3.** |
| 7 | 2026-09-16 | `TAKE_BACK` (§5.3, §6.1) : l'unique exception à la monotonie, écrite contre la règle qu'elle excepte. Rattrapage d'une carte posée par erreur, réservé au propriétaire, journalisé nommément, avec **réattribution de l'`ObjectId`** — sans elle, la vue déjà reçue par l'adversaire resterait en place et le masquage serait un mensonge. Le journal perd l'ancre et le nom de la carte (§4.2 réappliquée au passé). Critère §12.10. **Aucun event nouveau, aucun format existant modifié : `PROTOCOL_VERSION` reste à 3** (§11). |
| 8 | 2026-09-18 | **Densité de séquence** (§4.2, §5, §7, §8.1) : chaque `seq` produit une variante pour **chaque** siège connecté — l'event réel dans l'audience, un `NOTED` sinon, que l'émission porte un journal ou non. Corrige le trou laissé par une émission restreinte et muette (`LOOK_RESULT`), qui déclenchait un `resync` par event suivant et faisait apparaître un message trois fois ; `deltaFor` rend désormais `null` plutôt qu'un delta troué, et deux garde-fous client sont documentés (§8.1). Nouvelle **§5.4 : la ligne de journal est publique quelle que soit l'audience** — `commit` la construit hors de toute boucle d'audience et `logTail` la recopie sans filtrage dans chaque snapshot —, avec `namedBatch`, `publicName` et `NAMED_LOG_LIMIT` hissée en constante de protocole (§11). Cas limite de `RESOLVE_LOOK`/`HAND` tranché en §5.2 : nommer une carte que toute la table a vue n'est pas une fuite. Lignes ajoutées à la matrice §5.1. **Aucun format de message ne change : `PROTOCOL_VERSION` reste à 3**, délibérément (§11). Au passage, **balayage complet des déclarations de types contre `packages/shared/src/protocol/`**, sans rapport avec le travail du jour : `LookMode` gagne `'REVEAL'` (§6.4) ; `ErrorCode` gagne `ERR_NOT_HOST` et `ERR_ROOM_CLOSED` (§11) ; `LOOK_STARTED` son `cards?` servi au seul mode `REVEAL`, `LOOK_RESULT` son `mode`, `SEAT_COSMETICS` son `displayName`, et `PLANE_CHANGED` disparaît — le mode planechase a été retiré (§7) ; `Snapshot` gagne `room.closed`, `pendingLook.mode`, et `room.hostSeat` / `turn.activeSeat` deviennent nullables comme au lobby, le commentaire de `logTail` cesse de promettre un filtrage que la projection ne fait pas (§8.1) ; `PublicCardView` gagne `copyOf` et `revealedTo`, `Counter.value` devient facultatif — un marqueur sans valeur est un mot-clé (§3) ; `SET_COUNTER.value` devient `number | null` facultatif, la valeur d'une étiquette est du **texte** et non un entier, et `ADD_LABEL` / `SET_LABEL` retrouvent `attachedTo` (§6.2) ; `RESOLVE_LOOK` retrouve `toSideboard` et `exileFaceDown`, et les intents `MILL`, `EXILE_TOP`, `RANDOM_DISCARD`, `SCOOP` sont déclarés (§6.4), comme `SET_PRINTING` (§6.1) et `SET_SEAT_COSMETICS`, dont le pseudo se fige au lancement (§6.8). Enfin `SeatSummary`, `Label` et `LogEntry`, jusqu'ici cités sans jamais être déclarés, sont écrits au §8.1 — `LogEntry` avec la règle du §5.4, puisque c'est là qu'on le rencontre. |
| 9 | 2026-09-18 | **Amendement de l'invariant fondateur.** Le principe 5 de la §1 est conservé mot pour mot et reçoit une frontière écrite, la nouvelle **§1.1 : assister n'est pas arbitrer**. Motif : la cascade fait évaluer au serveur deux règles de Magic (« est-ce un terrain ? », « la valeur de mana est-elle sous le seuil ? »), et le taire aurait été pire que l'écrire. La §1.1 pose les **trois propriétés** qui rendent une assistance acceptable — elle n'interdit rien, elle n'impose rien, elle ne conclut pas — et les érige en critère de toute demande future ; elle consigne sans l'adoucir le **prix** : le saut automatique des terrains (`isLandCard`) est le seul endroit où une erreur du serveur a une conséquence de règles, et le garde-fou est que le journal nomme **toutes** les cartes exilées. Elle consigne aussi les deux endroits où l'on a **refusé de décider** : valeur de mana ambiguë (plusieurs faces portant un coût → la séquence s'arrête au lieu de juger) et « jouer sans payer son coût », qui n'existe pas sur une table sans pile. L'intent `CASCADE` est déclaré et décrit au §6.4, décision arrêtée en §13.5. **Ajout d'intent, donc non cassant : `PROTOCOL_VERSION` reste à 3** (§11). |
| 10 | 2026-09-18 | **Déplier une ligne de journal qui n'a pas d'ancres** (§5.4, §6.4, §8.1). Défaut corrigé : une cascade qui exile plus de six cartes abrégeait sa phrase en « … et N autres cartes » sans que le joueur puisse lire les N — le dépliage du client se reconstruit depuis `cardIds`, et la cascade réattribue l'identifiant de tout ce qui repart sous la bibliothèque (§2.1), donc elle n'ancre que la carte restée à l'exil. Principe posé : **le dépliage sert à lire des noms, pas à survoler des cartes** ; les ancres restent le bonus qui permet de surligner, elles ne sont plus la condition pour savoir ce qui est passé. `LogEntry` gagne `names?: string[]`, la forme non abrégée de l'énumération, remplie par `namedBatch`/`namesForLog` **seulement** quand la ligne est abrégée et que ses ancres ne couvrent pas le lot — `CASCADE` est aujourd'hui le seul cas. Aucune règle de visibilité nouvelle : les noms sortent du même `publicName`, au même instant, dans la même zone d'arrivée publique, et une carte non identifiable y reste « une carte ». Ils sont relevés **pendant que les cartes sont à l'exil face visible** : on ne lit jamais une bibliothèque, on redit sans replier ce que la table a vu (§5.2). Le client fait primer `names` sur `cardIds` pour la taille du lot, le libellé du bouton et le contenu du dépliage ; le survol continue de ne surligner que ce qui a encore un identifiant. **Champ facultatif et ajouté : `PROTOCOL_VERSION` reste à 3** (§11) — un client ancien l'ignore, et monter la version déconnecterait les tables en cours. |
| 11 | 2026-09-18 | **Le filtre d'ancres de `commit`, refait sur le bon critère** (§5.4). Deux défauts opposés, et ils se tenaient : le filtre du wire retirait les ancres d'une consultation en mode `REVEAL` — des identifiants que toute la table venait de recevoir par `LOOK_STARTED` — parce qu'il jugeait sur la seule zone ; et `state.log` n'était pas filtré du tout, si bien qu'une ancre retenue en direct ressortait par `logTail`, donc par le snapshot de chaque siège. Propager le premier sur le second aurait transporté le mauvais critère. Le critère retenu : **une ancre est un identifiant, pas une identité** — la question est « chaque siège détient-il déjà cet identifiant ? », pas « peut-il lire la carte ? ». Zone énumérable : oui toujours, y compris face cachée, dont l'identifiant est public même quand l'identité ne l'est pas. `LIBRARY` : seulement si **tous** les sièges connaissent l'identité, condition que `REVEAL` appliquait déjà chez lui et qui est hissée dans `commit` (`ancresPubliables`). Le tri se fait **une seule fois** et sert le wire, le replay et `state.log` : le direct et le rattrapage disent désormais la même chose, ce qui est la propriété à tenir. **Aucun format de message ne change : `PROTOCOL_VERSION` reste à 3.** |
| 3 | 2026-09-15 | Durcissement : `CARD_HIDDEN` à l'entrée en bibliothèque (§2.1), gardes de `MOVE_CARDS` et d'`ATTACH` (§6.1), `copyOf` restreint au champ de bataille (§6.3), verrou de zone et `sortIndex` brassé des `LOOK` (§6.4), `REVEAL_HAND` comme droit de zone (§6.5), `START_GAME` et `SIT_DOWN` durcis (§6.8), cas de bascule du delta et snapshot sans siège (§8.1), fermeture de l'annulation (§9), critères §12.6 et §12.7 |
