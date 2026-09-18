# Console d'administration

Ce document décrit **le modèle de protection** de la console `/admin`. Les règles
qui suivent ne sont pas des précautions : ce sont des invariants. Une
modification qui en casse une est un bug de sécurité, même si tout compile et que
tous les écrans s'affichent.

---

## 1. La garde est serveur, sur chaque route, et rien d'autre ne compte

Masquer un lien dans l'interface n'est pas une protection : le client est entre
les mains de celui qu'on essaie d'arrêter. La seule chose qui protège la console
est le pré-gestionnaire `requireAdmin` (`apps/server/src/admin/guard.ts`), posé
sur **chaque** route de `apps/server/src/admin/routes.ts`.

La route cliente `/admin` déclarée dans `apps/web/src/main.tsx` est publique,
comme toutes les routes du client. N'importe qui peut la taper. Elle ne rend
rien, parce que le serveur ne répond rien.

### La réponse de refus est unique

Quatre profils sont refusés, et ils reçoivent **le même octet** :

| profil | réponse |
| --- | --- |
| visiteur sans session | `404 {"error":"NOT_FOUND"}` |
| compte connecté ordinaire | `404 {"error":"NOT_FOUND"}` |
| adresse retirée de `ADMIN_EMAILS` | `404 {"error":"NOT_FOUND"}` |
| adresse déclarée, email non vérifié | `404 {"error":"NOT_FOUND"}` |

C'est exactement la 404 que `app.ts` rend sur tout chemin `/api` inconnu. Un 401
dirait « connecte-toi », un 403 dirait « tu es connecté mais pas admin » : les
deux confirment à celui qui sonde que la route existe, et le second lui confirme
même qu'il a trouvé la bonne adresse dans la mauvaise boîte. Sonder
`/api/admin/*` ne doit rapporter rien de plus que sonder `/api/nimportequoi`.

Le prix est assumé : un administrateur dont la session a expiré voit « il n'y a
rien ici » et non « reconnecte-toi ». L'écran de refus le dit en clair, parce que
c'est le seul endroit où le dire ne coûte rien — il est rendu par le client, qui
ne sait de toute façon pas laquelle des quatre raisons s'applique.

`apps/server/test/admin-garde.test.ts` **capture** la liste des routes à
l'enregistrement plutôt que de la recopier. Une route ajoutée demain entre donc
d'elle-même dans les quatre scénarios de refus, et il n'existe pas de façon d'en
écrire une qui échappe à ce test sans le modifier.

---

## 2. Comment un administrateur est désigné

Un administrateur est **une adresse inscrite dans `ADMIN_EMAILS`**, dans le
`.env` du serveur, **dont le compte a vérifié son email**. Les deux conditions,
pas une.

### Pourquoi le `.env` et pas une colonne `isAdmin`

Le `.env` vit sur le serveur, n'est jamais transféré par le déploiement, et porte
déjà le secret de session et l'accès à la base : y ajouter la liste des
administrateurs ne crée pas une racine de confiance, elle réutilise celle qui
existe.

Ce que cela achète, et qu'une colonne n'achèterait pas : **aucun chemin
d'écriture applicatif ne peut promouvoir quelqu'un.** Il n'y a pas de route à
garder, pas de `PATCH` à auditer, pas d'injection à craindre sur ce point précis.
L'escalade de privilège est fermée *par construction* plutôt que *par vigilance*.
Un test le maintient : `admin-garde.test.ts` refuse qu'une route dont le nom
évoque un droit apparaisse dans la console.

### Le premier administrateur

Il n'y en a pas à créer. Le premier administrateur est le premier nom écrit dans
le `.env` par la personne qui a déjà les clés de la machine. Il n'existe donc
jamais de fenêtre pendant laquelle « le premier inscrit devient admin », qui est
la faille classique de ce genre de bootstrap.

Mise en service :

1. `ADMIN_EMAILS=patronne@exemple.org` dans le `.env` du serveur ;
2. redémarrer le serveur (la liste est lue une fois au chargement — un
   comportement à moitié dynamique serait pire qu'un comportement franc) ;
3. se connecter avec ce compte, **email vérifié** ;
4. ouvrir `/admin`.

### Pourquoi l'email vérifié est une condition et pas un confort

Sans elle, quelqu'un qui devine ou apprend une adresse d'administrateur pourrait
s'inscrire avec elle **avant son propriétaire** et hériter des droits sans jamais
avoir eu accès à la boîte. La contrainte d'unicité sur `User.email` fait gagner
le premier arrivé, pas le légitime : c'est la vérification qui tranche.

### Retirer un administrateur

On retire l'adresse du `.env` et on redémarre. Il n'y a pas de bouton, et c'est
voulu : **un administrateur ne peut ni se dégrader, ni dégrader un autre**, donc
on ne peut pas se retrouver sans aucun administrateur par un clic malheureux.

---

## 3. Aucune information cachée de partie ne traverse cette console

**C'est la règle la plus grave, et elle est spécifique à ce projet.**

Le serveur est autoritatif et la visibilité est décidée **à l'émission** : ce
qu'un siège n'a pas le droit de voir ne traverse pas le socket (`docs/protocol.md`).
Une route d'administration qui lirait l'état d'une partie contournerait tout cet
édifice d'un seul geste — un administrateur verrait les mains et les
bibliothèques de joueurs qui n'en sauraient rien.

Donc :

> **La console ne publie que des comptes et des métadonnées.** Nombre de sièges,
> statut, date de création, dernière activité. **Jamais** le contenu d'une zone,
> **jamais** une carte, **jamais** un identifiant d'objet de partie.

Conséquences concrètes, à respecter en ajoutant quoi que ce soit :

- aucune fonction de `src/admin/` n'importe `game/` autrement que pour lire
  `liveRoomCount()`, qui rend un **entier** et que `/api/health` publie déjà à
  tout le monde ;
- `GameLog` et `DeckSnapshot` ne sont lus nulle part ;
- `GameSeat.deckSnapshotId` n'est jamais publié : c'est la clé qui mène à une
  bibliothèque figée ;
- `GameRoom.id` n'est pas publié non plus. Une table se désigne par son **code**,
  qui ne sert de clé vers rien.

`apps/server/test/admin-fuite.test.ts` balaie les corps de réponse réels à la
recherche de ce vocabulaire.

---

## 4. Rien de sensible sur un compte

Les champs publiés sont choisis par une **liste blanche**, jamais par un `select`
implicite. Elle est écrite dans `apps/server/src/admin/publish.ts`, où chaque
objet est construit champ par champ à partir d'un type d'entrée écrit à la main
— dériver le type de Prisma ferait entrer les nouvelles colonnes toutes seules.

Les requêtes utilisent en plus un `select` explicite (`USER_SELECT`,
`ROOM_SELECT`) et **jamais** `include` : le secret n'est même pas chargé en
mémoire.

### Compte (`PUBLISHED_USER_KEYS`)

`id`, `email`, `displayName`, `emailVerified` (booléen), `isAdmin` (**calculé**
par la même fonction que la garde, jamais lu en base), `createdAt`, `lastSeenAt`,
`decks`, `seats`, `sessions`, `hostedRooms`.

### Table (`PUBLISHED_ROOM_KEYS`)

`code`, `mode`, `status`, `isPrivate`, `hasPassword` (**l'existence** d'un mot de
passe, jamais son empreinte), `createdAt`, `lastActivityAt`, `hostName`, `seats`.

### Siège (`PUBLISHED_SEAT_KEYS`)

`code`, `status`, `mode`, `seatIndex`, `joinedAt`, `lastActivityAt`.

### Ligne du fil d'activité (`PUBLISHED_ACTIVITY_KEYS`)

`id`, `at`, `kind`, `who`, `ref`, `note`. Six champs, **quelle que soit la
source** : chaque source passe par le constructeur unique `activityEntry()`, ce
qui interdit d'en laisser fuir un septième « parce qu'il était déjà dans la ligne
Prisma ».

`id` est **synthétique** — `kind`, date, rang. Le fil a besoin d'une clé de rendu
stable, pas de publier l'identifiant d'une `Session` (qui **est** l'empreinte du
jeton), d'un `GameSeat` ou d'une `GameRoom`.

### Ingestion (`PUBLISHED_INGEST_KEYS`)

`bulkType`, `bulkUpdatedAt`, `startedAt`, `finishedAt`, `cardsUpserted`,
`outcome` (`ok` / `failed` / `running` — trois états distincts, les confondre
ferait passer une ingestion bloquée pour une réussite), `error`.

### Ce qui ne sort jamais

`User.passwordHash`, l'identifiant de `Session` (qui **est** l'empreinte du jeton
de connexion), `AuthToken.tokenHash` (vérification d'email et réinitialisation de
mot de passe), `GameRoom.passwordHash`. Ces quatre-là sont en base et il serait
facile de les faire sortir sans y penser.

S'y ajoutent, non par secret mais par sobriété : `Session.ip` et
`Session.userAgent`. On publie le **nombre** de sessions d'un compte, pas d'où
elles viennent — exploiter la plateforme ne demande pas de savoir où quelqu'un
habite.

### Le test qui doit échouer

`apps/server/test/admin-fuite.test.ts` tient deux filets redondants :

1. l'ensemble **exact** des clés produites par chaque fonction de publication ;
2. un balayage récursif de chaque réponse réelle, **par nom de clé et par
   valeur**.

Le faux Prisma de `admin-fixture.ts` ignore les `select` et rend des lignes
entières, secrets compris : il simule en permanence la base telle qu'elle serait
si le `select` avait déjà été élargi. Vérifié : élargir `publishUser` d'un seul
`...row` fait tomber trois tests, dont deux sur les corps de réponse.

---

## 5. Les actions

### La seule action offerte : révoquer les sessions d'un compte

`POST /api/admin/users/:id/revoke-sessions`.

Elle est acceptable parce qu'elle est **réversible** : la personne se reconnecte
avec son mot de passe. Elle ne fait pas non plus tomber une table, parce que le
WebSocket résout la session **une fois**, à la poignée de main
(`apps/server/src/ws/server.ts`) ; un joueur déjà connecté à sa partie y reste.

Deux garde-fous :

- **jamais sur soi-même** (`400 SELF_TARGET`), vérifié *avant* toute écriture.
  C'est la même règle qui, appliquée aux droits, empêcherait de se retrouver sans
  administrateur ; ici elle empêche surtout de se déconnecter de la console en
  croyant agir sur la ligne voisine ;
- **journalisée** dans `AdminAudit` : qui, quoi, quand. La réponse porte
  `logged`, et l'écran le dit si le journal n'a pas pu être écrit — le journal
  fait partie de l'action, pas de son décor.

### Ce que j'ai refusé d'implémenter : la suppression d'un compte

« Les gérer individuellement » appelait l'action. Je la refuse pour cette
première version, et ce n'est pas de la timidité.

Supprimer un `User` fait tomber en cascade (`onDelete: Cascade`) ses `Session`,
ses `Deck` — donc ses `DeckCard` —, ses `Playmat`, ses `UserPrefs` et ses
`AuthToken`, et met à `null` le `userId` de ses `GameSeat` (`onDelete: SetNull`).

Le cas qui décide : **si le compte est assis à une table en cours**, la room
vivante garde son siège en mémoire, avec son nom et son deck. La partie
continuerait autour d'un joueur qui n'existe plus, et le siège orphelin en base
ne se rattacherait plus à personne. Rien de tout cela n'est réversible, et rien
ne prévient l'intéressé.

Un compte peut déjà se supprimer lui-même (`DELETE /api/me`), avec son mot de
passe. Pour un retrait décidé par l'exploitant, il faut d'abord savoir **vider un
siège proprement** — et ce n'est pas le même travail. En attendant, la console
**montre** ce qu'il faudrait pour décider : la fiche d'un compte liste les tables
où il a une place et signale en rouge celles qui ne sont pas rangées.

Une console qui montre bien vaut mieux qu'une console qui casse.

### Le journal

Modèle `AdminAudit`. **Sans clé étrangère vers `User`**, délibérément : une
action porte souvent sur un compte, et si ce compte disparaît un jour, la cascade
emporterait précisément la ligne qui dit ce qu'on lui a fait. Un journal qui
s'efface avec son sujet ne sert à rien. On garde donc des identifiants morts,
plus l'adresse de l'acteur **recopiée au moment des faits** — ce qui la fige même
si le `.env` change ensuite.

`detail` ne contient que des métadonnées de l'action. Aucun état de partie,
aucune carte, aucun secret : c'est la règle §3, qui vaut ici aussi.

---

## 6. Ce que la console montre

- **Santé** : tables vivantes en mémoire (ce processus, pas un total base),
  version du protocole, sessions valides et sessions expirées non purgées, et
  l'état de la dernière ingestion — issue, âge de la matière, cartes écrites,
  échecs sur sept jours, message d'erreur le cas échéant.
- **Comptes** : total, vérifiés / non vérifiés, vus sous 24 h / 7 j / 30 j, créés
  sous 7 j / 30 j, et le **nombre** d'adresses administratrices déclarées (jamais
  lesquelles).
- **Tables** : total, en salon, en cours, rangées, actives sous 24 h, ouvertes
  sous 7 j, sièges occupés sur les tables non rangées.
- **Catalogue** : cartes, jetons, traductions résolues, impressions traduites,
  decks et comptes possédant un deck.
- **Listes** : comptes (recherche par adresse ou pseudo), tables (filtre par
  statut), fil des dernières actions, journal d'administration.

### Les horodatages : deux lectures, jamais une

Partout où une date compte — ouverture d'une table, dernière activité, prise d'un
siège —, l'écran donne **la date absolue et le relatif** : « 18/09/26 14:01 · il y
a 59 min ».

Ce n'est pas de la redondance. On ouvre ce tableau de bord quand quelque chose ne
va pas, et l'on y cherche « depuis quand ». Un relatif seul répond tout de suite
mais ne se recoupe avec rien ; une date absolue seule se recoupe avec le journal
du serveur mais oblige à calculer de tête. Les deux coûtent une demi-ligne.

L'échelle du relatif et ses clés (`time.justNow`, `time.minutesAgo`…) sont celles
de « Mes tables » : deux écrans du même produit ne comptent pas le temps de deux
façons différentes.

---

## 6 bis. Le fil des dernières actions

`GET /api/admin/activity?take=…`. Six sources, toutes déjà en base, toutes
datées, fusionnées et triées par date décroissante.

### Ce qui y entre

| source | colonne de tri | ce que la ligne dit |
| --- | --- | --- |
| `AdminAudit` | `createdAt` | ce que l'administrateur a fait |
| `User` | `createdAt` | un compte est né |
| `Session` | `createdAt` | quelqu'un s'est connecté |
| `GameRoom` | `createdAt` | une table a été ouverte |
| `GameSeat` | `joinedAt` | quelqu'un s'est assis |
| `IngestRun` | `startedAt` | le catalogue a été mis à jour, ou a échoué |

De `Session`, on publie **quand**, jamais l'identifiant (qui est l'empreinte du
jeton), ni l'IP, ni le navigateur — règle §4. De `GameSeat`, la table et le nom du
joueur, jamais `deckSnapshotId`.

### Ce qui n'y entre pas, et pourquoi

**Les actions de jeu.** Elles ne sont pas persistées : le modèle `GameLog` existe
au schéma mais **personne ne l'écrit** — aucun `prisma.gameLog.create` dans le
serveur —, et le journal d'une partie vit en mémoire dans la room. Les montrer
demanderait un chantier de persistance qui devrait de toute façon répondre
d'abord à la règle §3 : un journal de partie contient des cartes et des zones,
c'est-à-dire exactement ce qui n'a pas le droit de traverser cette console.

**La clôture d'une table.** Aucune colonne ne la date. `POST
/api/rooms/:code/close` écrit `status: 'ENDED'` et rien d'autre, le ménage
automatique fait pareil, et ni l'un ni l'autre ne touche `lastActivityAt` — qui
date donc la dernière action *de jeu*, pas le rangement. La placer dans un fil
chronologique afficherait un événement à une heure qui n'est pas la sienne ; un
tableau de bord qui ment est pire qu'un tableau de bord incomplet. Il faudrait
une colonne `closedAt` écrite par `rooms/routes.ts` et `game/registry.ts` : une
écriture dans un chemin de jeu, donc une décision, et sans valeur rétroactive.

**Les départs de table et les suppressions de compte.** Ce sont des `delete` en
base : la ligne partie, sa date part avec elle.

### Le coût, et son plafond

Six requêtes, une par source, toutes de la forme `ORDER BY <date> DESC LIMIT
take`, toutes servies par un index sur la colonne de tri. Aucun `count`, aucun
`skip`, aucune jointure au-delà du pseudo.

Le fil rapatrie donc au pire `6 × take` lignes, fusionne en mémoire et n'en garde
que `take`. Le plafond `take ≤ 50` est **dur** — au-delà la requête est refusée,
pas rabotée en silence — donc **300 lignes lues au maximum, quelle que soit la
taille de la base**, et ce nombre ne bouge plus jamais. L'écran demande 30.

Pas de pagination : ce fil répond à « que vient-il de se passer », pas à « donne
l'histoire de la plateforme ». Un `skip` ferait glisser une fusion de six sources
sur des pages qui ne s'alignent pas, et coûterait de plus en plus cher à mesure
qu'on s'enfonce.

### « Tables closes » : ce que ce mot recouvre

La demande parlait de « tables closes ». **Il n'existe pas de colonne `closed` en
base.** Ce qui existe :

- `GameRoom.status = 'ENDED'`, le fait persisté ;
- `room.state.closed`, un drapeau **mémoire** de la room vivante, mis en même
  temps que `ENDED`, et qui empêche de se rasseoir en rechargeant la page.

Deux chemins très différents mènent à `ENDED`, et la base **ne les distingue
pas** : l'hôte qui clôt sa table (`POST /api/rooms/:code/close`), et le ménage
automatique qui libère une room vide inactive depuis six heures (`sweepRooms`).

La console compte donc les tables rangées **toutes causes confondues**, et
l'écran l'écrit sous le tableau plutôt que de le maquiller. Les distinguer
demanderait une colonne `closedAt` posée par la route de clôture — donc une
écriture dans `rooms/routes.ts`, et sans valeur rétroactive de toute façon.

### Les seuils d'alarme

Un chiffre anormal doit se voir sans être cherché. Les seuils sont explicites
dans `apps/web/src/pages/Admin.tsx`, parce qu'un seuil muet est un seuil qu'on
n'ose plus changer :

| signal | seuil | pourquoi |
| --- | --- | --- |
| ingestion | issue `failed`, ou un échec sur 7 j | le catalogue ne suit plus Scryfall, et personne ne le saurait autrement |
| fraîcheur du bulk | plus de 48 h | `INGEST_CRON_HOUR` est journalier : deux passages manqués, ce n'est plus un retard |
| sessions expirées | plus nombreuses que les valides | la purge périodique ne passe plus |
| catalogue | zéro carte | ni la recherche ni le chargement d'un deck ne fonctionnent |

---

## 7. Migration

`AdminAudit` est une **table entièrement neuve**. `docker/entrypoint.sh` applique
le schéma par `prisma db push --accept-data-loss` : la table est créée sans
toucher à quoi que ce soit d'existant. Aucune colonne n'est ajoutée, supprimée ni
renommée ailleurs — le changement est intrinsèquement sûr.

Le fil d'activité n'a ajouté **aucune colonne** non plus : il ne lit que des
dates déjà là. Il a en revanche ajouté cinq **index**, sans lesquels un
`ORDER BY <date> DESC LIMIT n` coûte un tri de toute la table :

| table | index |
| --- | --- |
| `User` | `createdAt` |
| `Session` | `createdAt` |
| `GameRoom` | `createdAt` (distinct de `lastActivityAt`, déjà indexé) |
| `GameSeat` | `joinedAt` |
| `IngestRun` | `startedAt` (l'index composite `bulkType, bulkUpdatedAt` ne le sert pas) |

Un index se crée sans rien détruire : `db push` les pose, et une base ancienne
les acquiert au premier démarrage. Vérifié sur la pile locale : les cinq
existent après redémarrage.
