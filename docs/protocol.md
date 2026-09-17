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
   sens des règles de Magic.

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

interface Counter { kind: string; value: number; }  // "+1/+1", "loyalty", "poison", libre
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
charge utile. Sans cela, « seat_2 regarde une carte face cachée » — dont l'event
n'est adressé qu'à seat_2 — ne serait jamais annoncé à la table, et la
contrepartie sociale de l'information cachée (§6.1) resterait une promesse.

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
interface SetCounter    { type: 'SET_COUNTER'; targetId: ObjectId; kind: string; value: number; }   // [libre]
interface AddCounter    { type: 'ADD_COUNTER'; targetId: ObjectId; kind: string; delta: number; }   // [libre]
interface RemoveCounter { type: 'REMOVE_COUNTER'; targetId: ObjectId; kind: string; }               // [libre]

interface Attach { type: 'ATTACH'; sourceId: ObjectId; targetId: ObjectId; }  // [libre]
interface Detach { type: 'DETACH'; sourceId: ObjectId; }                      // [libre]

interface AddLabel    { type: 'ADD_LABEL'; text: string; x: number; y: number; color?: string; value?: number; }  // [libre]
interface MoveLabel   { type: 'MOVE_LABEL'; labelId: ObjectId; x: number; y: number; }                              // [libre]
interface SetLabel    { type: 'SET_LABEL'; labelId: ObjectId; text?: string; value?: number | null; color?: string; } // [libre]
interface RemoveLabel { type: 'REMOVE_LABEL'; labelId: ObjectId; }                                                   // [libre]
```

`text` est borné à 200 caractères, échappé, jamais interprété comme du HTML.

Une étiquette portant un `value` est un **compteur libre** : un marqueur numérique
posable n'importe où sur la table, pour ce que les cartes ne portent pas — un « 2/2 »
qui pompe, un compteur d'orages, un décompte de tours. `SET_LABEL` avec `value: null`
lui retire sa valeur et le ramène à une simple note. Les étiquettes sont [libre] :
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
type LookMode = 'SCRY' | 'SURVEIL' | 'SEARCH' | 'PEEK';

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
  shuffleAfter?: boolean;
}

interface ReorderTop { type: 'REORDER_TOP'; zone: ZoneRef; order: ObjectId[]; }
interface Draw       { type: 'DRAW'; count: number; }                 // son siège uniquement
interface Mulligan   { type: 'MULLIGAN'; keep?: number; }             // Londres : pioche 7, remet `keep` cartes dessous
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
renvoyées au fond.

`SEARCH` sur sa propre bibliothèque envoie la liste **complète, mélangée côté serveur**,
pour ne pas révéler l'ordre réel au propriétaire lui-même — sinon chercher reviendrait à
connaître sa bibliothèque. Une recherche impose `shuffleAfter: true`.

Le brassage s'applique aussi au **contenu** des vues envoyées : dans un
`LOOK_RESULT` — et dans le `pendingLook` d'un snapshot —, `sortIndex` porte le
rang *montré*, jamais le rang réel dans la zone. Publier le rang réel rendrait le
brassage décoratif : il suffirait de trier par `sortIndex` pour retrouver l'ordre
de sa propre bibliothèque.

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
`SEAT_COSMETICS`. Un champ absent est laissé tel quel, `null` efface.

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
  | { type: 'LOOK_STARTED'; lookId: string; seat: SeatId; zone: ZoneRef; count: number; mode: LookMode }
  | { type: 'LOOK_RESULT'; lookId: string; cards: PublicCardView[] }              // audience SEAT
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
  | { type: 'SEAT_COSMETICS'; seatId: SeatId; playmatUrl: string | null; cardBackUrl: string | null }
  // planechase
  | { type: 'PLANE_CHANGED'; card: PublicCardView; previous?: ObjectId };
```

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
servie aux sièges hors audience d'un event qui porte une ligne de journal (§4.2).
Un client qui ne sait qu'en faire enregistre son `seq` et affiche son `log` :
c'est exactement ce qu'il y a à en faire.

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

```ts
interface Snapshot {
  seq: Seq;
  room: { code: string; mode: GameMode; status: RoomStatus; hostSeat: SeatId };
  seats: SeatSummary[];
  turn: { activeSeat: SeatId; turnNumber: number; phase: PhaseName };
  cards: CardView[];           // déjà projetées pour le destinataire
  zoneCounts: OpaqueZoneView[];
  labels: Label[];
  pendingLook?: { lookId: string; cards: PublicCardView[] };
  topReveals?: Array<{ seat: SeatId; toSeats: SeatId[]; cardId: ObjectId | null }>;
  logTail: LogEntry[];         // 200 dernières entrées, filtrées
}
```

`topReveals` est absent quand aucune bibliothèque n'a son dessus révélé — le cas
courant. Il n'est pas décoratif : sans lui, un rechargement de page, ou toute
resynchronisation qui bascule sur le snapshot, ferait disparaître une carte que
la table voit pourtant retournée, et `snapshot(T)` cesserait d'être
indistinguable de `snapshot(T₀) + delta`. `cardId` n'est renseigné que pour un
destinataire ; la carte elle-même est jointe à `cards`, projetée par la même
fonction que le reste.

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
  | 'ERR_ROOM_PASSWORD' | 'ERR_NOT_SEATED' | 'ERR_SEAT_TAKEN'
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
| 3 | 2026-09-15 | Durcissement : `CARD_HIDDEN` à l'entrée en bibliothèque (§2.1), gardes de `MOVE_CARDS` et d'`ATTACH` (§6.1), `copyOf` restreint au champ de bataille (§6.3), verrou de zone et `sortIndex` brassé des `LOOK` (§6.4), `REVEAL_HAND` comme droit de zone (§6.5), `START_GAME` et `SIT_DOWN` durcis (§6.8), cas de bascule du delta et snapshot sans siège (§8.1), fermeture de l'annulation (§9), critères §12.6 et §12.7 |
