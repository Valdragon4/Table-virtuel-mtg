# Replay — rejouer une partie terminée

Un replay rejoue une partie **action par action**, en reproduisant à l'écran ce
qui s'est passé. Il est accessible aux joueurs de la partie, et à qui détient un
lien de partage.

Deux choix ont été arrêtés avant l'écriture d'une ligne de code, et tout le
reste en découle.

1. **Tout est révélé une fois la partie terminée** — mains, bibliothèques,
   pioches. C'est ce qu'on fait à une vraie table en étalant son jeu après coup.
   Le lecteur peut de surcroît **basculer de point de vue** en cours de lecture
   et voir ce qu'un siège donné voyait **à ce pas précis**.
2. **Un replay n'existe pas tant que la partie n'est pas terminée.** C'est le
   verrou, et il prime sur toute la fonctionnalité.

---

## 1. Le verrou

> Un replay ne doit exister, être servi, ni même être devinable tant que la
> partie n'est pas terminée.

Ce n'est pas une précaution : **c'est ce qui rend la fonctionnalité
acceptable**. Sans lui, un joueur ouvre le replay de sa propre partie en cours,
bascule sur le point de vue de son adversaire et lit sa main en direct. Le
replay deviendrait l'outil de triche parfait, et il contournerait d'un coup tout
l'édifice de visibilité du projet — serveur autoritatif, visibilité décidée à
l'émission, ce qu'un siège n'a pas le droit de voir ne traverse pas le socket
(`docs/protocol.md` §5).

La liberté de point de vue **aggrave** cette exigence, elle ne l'assouplit pas.

### Où il est tenu

| Niveau | Mécanisme |
|---|---|
| Donnée | `GameReplay.closedAt` est nul tant que la partie court. |
| Chargement | `readableById` / `readableByToken` filtrent sur `closedAt: { not: null }`. **Ce sont les seules portes d'entrée** : une route nouvelle qui oublierait la garde ne trouverait rien à servir. |
| Lecture | Le filtre est appliqué **à chaque appel**, jamais mis en cache. Un enregistrement rouvert cesse d'être lisible sur-le-champ, jeton en main ou non. |
| Room vivante | `liveGameCollides` refuse si la table est en mémoire et rejoue la partie de cet enregistrement, quoi que dise la base. |
| Partage | Le même filtre s'applique à `POST …/share` : on ne rend pas partageable ce qui n'est pas fini. |

Un refus est toujours un **404**, jamais un 403 : l'existence d'un replay est
elle-même une information. Un joueur qui teste l'adresse du replay de sa partie
en cours lit la même chose qu'une adresse inventée. Le client ne distingue pas
davantage les trois cas — partie en cours, jeton révoqué, adresse inexistante —
puisque le serveur ne les distingue pas.

### Ce qui referme un enregistrement

`GameReplay.closedAt` est posé par :

- le premier `GAME_ENDED` qui passe par `Room.commit` — concession, hôte qui
  clôt, dernier adversaire parti, relance de partie ;
- `Room.abandonReplay`, appelé par `sweepRooms` quand une table vide et inactive
  est libérée ;
- `closeAbandonedReplays`, pour les tables qu'aucun processus ne tient plus en
  mémoire — typiquement celles qu'un redémarrage a emportées en pleine partie.

### Ce que fait réellement le ménage, et ce qu'on en conclut

`sweepRooms` ne ferme une table que si **`room.isEmpty`** (plus aucun socket) et
qu'elle est inactive depuis six heures. Deux conséquences :

- **Il ne peut pas ouvrir un replay pendant qu'un joueur est assis.** « Vide »
  veut dire « aucune connexion » ; il n'y a personne à qui le replay livrerait
  la partie en cours.
- **Il ne voit que les rooms de son propre processus.** Une table abandonnée
  dont la room a disparu de la mémoire — redémarrage du serveur — n'est jamais
  balayée, et son enregistrement resterait ouvert, donc illisible, pour
  toujours. C'est ce trou que `closeAbandonedReplays` bouche.

Cette seconde passe ne se fie **pas** à `GameRoom.lastActivityAt` : cette
colonne n'est jamais écrite après la création de la table (vérifié — l'activité
vit en mémoire, dans `GameState.lastActivityAt`). S'y fier aurait refermé
l'enregistrement d'une partie **en cours** dès qu'elle dépasse six heures
depuis l'ouverture de la table, c'est-à-dire ouvert le replay d'une partie qui
se joue encore. Le repère est donc l'âge de l'**enregistrement**, doublé de la
garde « la room n'est vivante dans aucun processus ».

---

## 2. Ce qui est persisté

### Le point zéro : un état, pas des vues

L'enregistrement s'ouvre **après** le commit de `START_GAME` : decks mélangés,
mains d'ouverture distribuées. Partir de l'event zéro aurait voulu dire rejouer
aussi le salon — chargements de deck, allées et venues de sièges — pour arriver
au même endroit, avec en prime la difficulté que `START_GAME` mélange et
**réattribue tous les identifiants**.

Ce point zéro est un **dump d'état** (`ReplayOrigin`), pas un snapshot projeté.
C'est ce qui permet de rappeler `projectSnapshot` — la vraie, celle du serveur —
sur chaque point de vue demandé, au lieu d'en écrire une seconde.

Il ne contient ni nom de carte, ni texte de règles, ni image : seulement des
`scryfallId`. Il ne contient pas non plus les `seatToken`, qui sont des preuves
d'identité.

### Le flux : la variante omnisciente, plus de quoi re-dériver le reste

`Room.commit` construit une variante **par destinataire**. Le replay a besoin de
l'event complet, celui dont ces variantes dérivent : on le demande donc à
`emission.build(OMNISCIENT_SEAT)`, un siège fictif pour lequel `canSeeIdentity`
répond toujours oui. Il n'existe dans aucune partie, sa valeur (`@omniscient`)
ne peut pas entrer en collision avec un `seat_<n>` réel, et il n'est jamais
inscrit dans un `knownTo`.

Chaque pas (`ReplayFrame`) porte en plus :

- **`audience`** — sans elle, le replay montrerait à seat_2 un `LOOK_RESULT`
  qui n'a jamais été adressé qu'à seat_1. La vue d'un siège doit rendre ce qu'il
  a reçu, y compris ses silences.
- **`known`** — le `knownTo` complet des objets cités, **au moment de
  l'émission**. C'est lui qui permet de rejouer la monotonie de la connaissance
  au pas par pas plutôt qu'à la fin.
- **`down`** — les objets réellement face cachée (`PublicCardView.faceDown` vaut
  toujours `false`, il dit « ce destinataire voit l'identité »).

Avec ces trois-là, **la vue d'un siège se calcule** ; il n'y a pas à stocker une
variante par siège, ce qui coûterait quatre fois le volume pour la même
information.

### La borne, et ce qu'elle coûte

| | |
|---|---|
| `REPLAY_LIMITS.maxEvents` | 20 000 pas |
| `REPLAY_LIMITS.maxBytes` | 8 Mio |
| `REPLAY_LIMITS.chunkFrames` | 500 pas par ligne de `ReplayChunk` |

**Coût mesuré** (`apps/server/test/replay-enregistrement.test.ts`, qui échoue si
l'ordre de grandeur change) : une table à quatre sièges qui vide ses
bibliothèques produit **157 pas pour 47 754 octets, soit ~304 octets par pas**.
Une partie de Commander à quatre observée sur cette table tourne autour de 2 000
à 4 000 `seq` : **0,6 à 1,2 Mio par partie**, largement sous les deux bornes.

Atteindre une borne **arrête** l'enregistrement et le marque `truncated`. Le
lecteur l'annonce alors en clair : « la partie continue au-delà de ce que ce
replay montre ». Tronquer en silence produirait un replay menteur, ce qui est
pire que pas de replay du tout.

### L'enregistrement ne peut pas faire tomber une partie

Rien dans `Room.commit` ne touche la base. Les pas s'accumulent en mémoire et
partent par tranches vers un puits (`ReplaySink`) qui écrit en différé et avale
ses échecs — c'est le parti déjà pris par `persistLog`. L'appel qui construit la
variante omnisciente est lui-même enveloppé : une exception venue du moteur ne
doit pas faire échouer un intent parfaitement valide. Le replay est un témoin de
la partie, jamais une condition de son déroulement.

---

## 3. Rejouer

### Un seul réducteur, appelé à deux moments

Le client sait déjà reconstruire un état à partir d'un snapshot puis d'events :
c'est `handleMessage`, dans `apps/web/src/store/game.ts`. Le lecteur
(`store/replay.ts`) **lui sert les messages enregistrés**, dans l'ordre, par le
même chemin qu'un socket. Il n'y a pas de second réducteur.

C'est le point de conception le plus important : deux implémentations
divergeraient, et le jour où elles divergent, le replay montre autre chose que
ce qui s'est passé — sans que rien ne le signale. Conséquence heureuse : la page
de replay rend la **vraie** table, avec ses vrais composants, puisque l'état
qu'ils lisent est le même `useGame`.

Le même raisonnement vaut côté serveur pour la visibilité :
`apps/server/src/replay/projection.ts` reconstruit un `GameObjectState` à partir
de ce que le flux a conservé, puis appelle `projectCard` — la fonction du
serveur, celle qui décide déjà ce qu'un siège reçoit en direct.

Les deux seules décisions prises dans ce fichier ne sont pas des règles de
visibilité, ce sont des reproductions du découpage de `Room.commit` : le `NOTED`
servi hors audience (§5), et le `CARD_HIDDEN` d'une entrée en zone non
énumérable (§2.1), exprimé avec le même prédicat `isEnumerableZone`.

### Avancer, reculer

Avancer, c'est appliquer un pas. Reculer n'existe pas : un event ne s'inverse
pas. Le lecteur repart donc d'un état connu et réavance.

Des **points de reprise** sont posés tous les 200 pas, en avançant. Reculer coûte
au plus 200 applications, au lieu des quelques milliers qu'un retour au point
zéro demanderait sur une longue partie. Ils ne coûtent presque rien en mémoire :
`applyEvent` **remplace** ses structures au lieu de les muter (chaque écriture
fait un `new Map(...)`), si bien qu'un point de reprise n'est qu'un jeu de
références vers des objets qui existent déjà.

### Changer de point de vue

Changer de point de vue **recharge le flux** depuis le serveur. La visibilité
reste décidée à l'émission, jamais filtrée côté client : un flux omniscient
qu'on masquerait localement aurait mis dans le navigateur du lecteur des
identités qu'il a demandé à ne pas voir.

---

## 4. Partager

Le partage est un **acte délibéré** : un replay n'est pas partagé tant que
personne ne l'a demandé.

- Le lien porte un jeton de **32 octets d'aléa** en base64url, pas le code de
  table — celui-ci est court et sert déjà à rejoindre.
- Il est **révocable** : `DELETE /api/rooms/:code/replay/share` remet le jeton à
  null et le lien meurt sur-le-champ.
- L'interface dit sans détour ce que le lien expose : la partie de **tous** les
  joueurs, pas seulement celle de qui partage.

### Qui a le droit de partager, et le sort des invités

Le droit revient aux joueurs de la partie — un `GameSeat` dont le `userId` est
celui du demandeur — et à l'hôte de la table (`GameRoom.hostUserId`), qui peut
n'avoir jamais pris place.

**Un invité sans compte n'a ni droit de partage ni accès par identifiant.** Ce
n'est pas un oubli : le serveur n'a aucun moyen de l'authentifier après coup.
Son `GameSeat.userId` est nul, et son `seatToken` — le seul identifiant qu'il ait
jamais eu — vit en mémoire dans la room et meurt avec elle ; il n'est pas
persisté, et il ne pourrait pas l'être sans devenir une clé permanente vers
l'intégralité des decks de la table.

Un invité regarde donc le replay **par le lien de partage** qu'un joueur inscrit
a créé — ce qui est exactement l'usage prévu de la fonctionnalité. Limite
assumée : si aucun siège n'a de compte **et** que la table n'a pas d'hôte
inscrit, personne ne peut partager, et le replay reste inaccessible.

---

## 5. Routes

| Route | Qui | Ce qu'elle fait |
|---|---|---|
| `GET /api/rooms/:code/replay` | joueur ou hôte, connecté | `{ available }`, et l'identifiant du dernier replay lisible. Répond `{ available: false }` tant que la partie court. |
| `POST /api/rooms/:code/replay/share` | idem | Crée (ou rend) le jeton de partage. |
| `DELETE /api/rooms/:code/replay/share` | idem | Révoque. |
| `GET /api/replays/:handle` | porteur du jeton, ou joueur par identifiant | En-tête : points de vue proposés, point zéro projeté, nombre de tranches. |
| `GET /api/replays/:handle/frames?chunk=N` | idem | Une tranche de pas, projetée pour le point de vue demandé. |

Côté client : `/replays/:handle` (lien de partage) et `/rooms/:code/replay`
(chemin des joueurs). Les deux déclarations de route **n'ouvrent rien** : elles
sont publiques comme toutes les routes du client, et c'est le serveur qui refuse.

---

## 6. Schéma

`GameReplay` et `ReplayChunk` sont des tables **neuves**. `GameRoom` gagne une
colonne nullable, `endedAt`. Rien n'est supprimé ni renommé : `prisma db push`
n'a rien à détruire.

### Pourquoi pas `GameLog` ?

`GameLog` existe déjà, et il est **écrit** — `persistLog`, dans
`game/registry.ts`, y verse une ligne par entrée de journal. Il ne convient pas
ici, et ce n'est pas une question de forme mais de contenu : il ne porte que le
**texte public** d'une ligne de journal et ses ancres (`{ text, cardIds, actor }`).
Il ne contient ni l'event, ni l'audience, ni `knownTo`, ni l'état des faces —
c'est-à-dire rien de ce qui permet de rejouer une action, et encore moins de
re-dériver la vue d'un siège. On ne peut pas le rendre suffisant sans en changer
la nature.

Il garde son usage propre : c'est l'archive du journal d'une table, durable et
indépendante de la partie enregistrée. **Il ne doit pas disparaître.**

### `GameRoom.endedAt`

`status` disait qu'une partie est finie, jamais **quand**. La colonne est posée
par les deux chemins de clôture qui relèvent de ce chantier :
`POST /api/rooms/:code/close` et `sweepRooms`. Elle n'a **aucune valeur
rétroactive**.

Elle ne porte pas le verrou du replay : celui-ci est `GameReplay.closedAt`, qui
date la fin d'**une partie** et non celle de la table — une table peut enchaîner
trois manches sans jamais passer à `ENDED`.

**Reste à faire :** le chemin `CLOSE_ROOM` du WebSocket
(`apps/server/src/ws/server.ts`) écrit `status: 'ENDED'` sans `endedAt`. Une
ligne à ajouter, hors du périmètre de ce chantier.

---

## 7. `PROTOCOL_VERSION` n'a pas bougé

Le format d'enregistrement ne traverse jamais le socket de partie et ne figure
pas dans `@mtg/shared`. Aucun message de protocole n'a changé de forme ; aucune
table en cours n'est déconnectée au déploiement.

---

## 8. Limites connues

- **Après un mélange, le replay connaît le compte d'une bibliothèque, pas son
  contenu.** `SHUFFLE` réattribue tous les identifiants (§2.1) et n'émet que
  `ZONE_SHUFFLED{zone, count}` : les nouveaux identifiants n'existent **nulle
  part** dans le flux, pas même dans sa variante omnisciente, puisque le serveur
  ne les publie à personne. Le point zéro, lui, énumère les bibliothèques
  entières. Aucune interface n'énumère aujourd'hui une bibliothèque en cours de
  partie, si bien que la limite ne se voit pas ; la lever demanderait d'ajouter
  au pas de mélange un side-car propre au replay, et de faire traiter par le
  réducteur client deux events pour un même `seq`.
- **Une seule entrée par le client.** Le lien vers le replay se trouve sur
  `/rooms/:code/replay`. La page de table (`pages/Room.tsx`) ne le propose pas
  encore : elle est hors du périmètre de ce chantier.
- **Le lecteur laisse les menus contextuels s'ouvrir.** Les actions qu'ils
  proposent n'aboutissent à rien (il n'y a pas de socket) et affichent le
  bandeau « hors ligne ». À reprendre quand `pages/Room.tsx` et les composants
  de table pourront être touchés.
