# MTG Virtual Table

Table virtuelle multijoueur pour Magic: The Gathering, dans le navigateur, **sans moteur
de règles** : les joueurs arbitrent eux-mêmes, comme sur une vraie table. Comptes,
persistance serveur, import de decks depuis Archidekt, Moxfield (par collage) et texte brut.

## Démarrer

```sh
cp .env.example .env         # renseigner SESSION_SECRET, POSTGRES_PASSWORD et les User-Agent
docker compose up --build
```

C'est tout : le conteneur applique le schéma, lance le serveur, sert le client et
déclenche l'ingestion des cartes en tâche de fond. L'application écoute sur
`http://localhost:3000`.

La première ingestion télécharge le bulk Scryfall (environ 78 Mo compressés, plusieurs
centaines de Mo décompressés) et prend quelques minutes. Le serveur répond dès le
démarrage ; la recherche de cartes se remplit au fur et à mesure.

### En développement

```sh
npm install
docker compose up -d postgres
npx prisma db push --schema apps/server/prisma/schema.prisma
npm run dev        # serveur Fastify sur :3000
npm run dev:web    # client Vite sur :5173, proxy vers :3000
```

| Commande | Effet |
|---|---|
| `npm test` | Tests unitaires (parseur, moteur, visibilité, resynchronisation) |
| `npm run typecheck` | Vérification TypeScript de tout le dépôt |
| `npm run build` | Build partagé + serveur + client |
| `npm run ingest -w @mtg/server -- --force` | Force une réingestion Scryfall |
| `npx playwright test` | Tests de bout en bout (voir `e2e/README.md`) |
| `node scripts/verify-ui.mjs <dossier>` | Recette d'interface dans un vrai navigateur, contre la pile démarrée : glisser-déposer, menus, raccourcis, cohérence des curseurs entre deux clients. Les captures atterrissent dans le dossier passé en argument. |
| `node scripts/smoke.mjs <dossier>` | Fumée rapide : créer une table, s'asseoir, jouer quelques actions. |

## Architecture

```
packages/shared   Protocole typé : intents, events, schémas Zod. Source unique de vérité.
apps/server       Fastify + Prisma + WebSocket. Détient l'état de partie.
apps/web          React + Vite + Zustand. N'applique que ce que le serveur diffuse.
docs/protocol.md  Le document qui verrouille l'architecture réseau.
docs/ui-reference.md  L'interface cible, relevée sur la capture de référence.
```

L'état de partie vit **en mémoire** dans le processus propriétaire de la room. Postgres
ne stocke que les comptes, les decks, les snapshots de deck et le journal. Un
déploiement multi-instances exigerait de router une room vers un processus unique.

### Information cachée

C'est la contrainte structurante du projet, et elle est tenue par construction :

- Une carte en bibliothèque n'a **aucun identifiant publié**, pas même vers son
  propriétaire. Un mélange **réattribue tous les identifiants** de la zone : sans cela,
  noter les identifiants avant et après un mélange suffirait à reconstruire l'ordre.
- Un même fait de jeu est sérialisé en **deux variantes partageant le même `seq`** :
  riche pour qui a le droit de voir, pauvre pour les autres. Le filtrage a lieu à
  l'émission, jamais à la réception.
- Une seule fonction, `projectFor(seat, state)`, sert aux events **et** aux snapshots :
  il n'existe qu'un endroit où la confidentialité est décidée.
- Le journal d'actions ne nomme jamais une carte que tous les sièges ne peuvent pas voir,
  et ne cite jamais l'identifiant d'un objet de bibliothèque. Il est en revanche diffusé
  à **tous** les sièges, même quand l'event qui le porte ne les concerne pas.

Ces propriétés sont couvertes par `apps/server/test/` : étanchéité et chasse aux fuites
sur les frames brutes (jamais l'état interne), équivalence entre un client rattrapé par
delta et un client rattrapé par snapshot, et un audit d'invariants rejoué après chaque
intent d'une longue séquence aléatoire.

## Ressources tierces

- **Scryfall** — métadonnées via les *bulk data* (`default_cards`, JSONL gzippé, lu en
  flux et jamais chargé en mémoire), jamais de scraping, jamais de requête unitaire en
  chemin chaud. Les images de cartes sont chargées **par le navigateur du client,
  directement depuis le CDN Scryfall** : le serveur ne les proxifie ni ne les met en cache.
- **Archidekt** — endpoint deck public, cache ≥ 15 min, file plafonnée à ~30 req/min,
  backoff exponentiel sur 429, `User-Agent` explicite.
- **Moxfield** — aucune API publique pour les tiers, et les endpoints internes sont
  protégés par Cloudflare avec filtrage par `User-Agent`. **Ce projet n'implémente aucun
  contournement** : ni `cloudscraper`, ni navigateur headless, ni usurpation de
  `User-Agent`. Le chemin par défaut est le collage de l'export natif de Moxfield, mis
  en avant dans l'interface au même rang que l'import par URL. Un chemin API existe
  derrière le flag `MOXFIELD_API_ENABLED`, désactivé par défaut, réservé à un opérateur
  ayant obtenu un `User-Agent` autorisé auprès du support Moxfield. Cette liste blanche
  existe bel et bien et la procédure passe par leur Discord : voir
  [`docs/moxfield.md`](docs/moxfield.md), qui documente aussi comment un service
  concurrent s'y prend et pourquoi nous ne copions pas son architecture.
  Quand ce chemin est activé, il se tient : cache d'une heure, ~6 req/min, aucune
  nouvelle tentative automatique, `Retry-After` respecté sur 429, et un 403 **ferme
  l'accès API** pour la durée du processus — un accès retiré se règle avec Moxfield,
  pas en insistant.

## Décisions d'implémentation

Les arbitrages de conception du protocole sont en §13 de `docs/protocol.md`. Côté
implémentation :

1. **Le rendu de la table est en DOM + transformations CSS**, pas en PixiJS. Les images
   de cartes viennent du CDN Scryfall ; les charger en textures WebGL ajouterait une
   dépendance au CORS de Scryfall pour un gain nul à l'échelle visée (quelques centaines
   d'objets, animés par `transform`, que le compositeur prend en charge). À revoir si
   le profilage montre une limite.
2. **Pas de logique de table côté client**, même en solo : une partie solo est une room
   à un siège. Cela évite deux implémentations divergentes des zones et des déplacements.
3. **Le schéma est appliqué par `prisma db push`** au démarrage du conteneur. Des
   migrations versionnées prendront le relais quand le schéma se sera stabilisé.
4. **Aucun texte de règles n'est stocké** : la table `Card` ne contient ni oracle text ni
   flavor text. L'image Scryfall les porte déjà, et c'est le navigateur qui va la chercher.

## Jalons

| | | État |
|---|---|---|
| 1 | Socle — monorepo, Docker, Postgres, ingestion Scryfall, recherche | **fait** |
| 2 | Comptes — auth, vérification par mail, réinitialisation, préférences | **fait** |
| 3 | Decks — parseur, import Archidekt/Moxfield/texte, éditeur carte par carte, resync, CRUD | **fait** |
| 4 | Table — rendu DOM 60 FPS, zones, pioche, lasso, déplacements, attachements, compteurs, journal | **fait** |
| 5 | Multijoueur — serveur autoritatif, information cachée étanche, reconnexion, curseurs temps réel | **fait** |
| 6 | Commander — 1 à 4 sièges, matrice dégâts de commandant, taxe, mulligans, tokens, scry / surveil | **fait** |
| 7 | Confort & Ergonomie — playmats, dos de cartes, zoom HD, consultation/révélation modale, PWA, raccourcis | **fait** |
| 8 | Extras — Planechase, draft Commander temps réel | *backlog / évolutions futures* |

## Fonctionnalités réalisées & Tenues par construction

### 1. Table de jeu & Expérience visuelle
- **Rendu DOM + transformations CSS** : 60 images/seconde continues, zoom et panoramique fluides (bouton droit ou espace), centrage automatique sans dépendance lourde WebGL.
- **Orientation « Joueur local toujours en bas » (`lib/seatView.ts`)** : chaque joueur voit son champ de bataille au premier plan sans rotation destructrice, tout en conservant le repère partagé universel pour la précision des curseurs multijoueurs.
- **Disposition dynamique multi-sièges** : adaptation géométrique sans aucun chevauchement de 1 à 4 joueurs.
- **Fonds de table immersifs** :
  - Dallage de pierre haute définition sous licence CC0 (Poly Haven), raccordable et sans couture.
  - Arène illustrée personnalisée et plateau radial calculé procéduralement (`tableBoard.tsx`).
  - Playmats translucides par défaut pour laisser respirer le décor, ou personnalisés par URL.
- **Gestion de la main adaptative (`lib/handMetrics.ts`)** :
  - Éventail dynamique dimensionné selon la fenêtre (ne mange jamais le terrain).
  - Resserrement progressif lors des pioches puis défilement molette exclusif sur le rail.
  - Rangement manuel par glisser-insérer ou tri automatique d'un clic (terrains puis coûts convertis).
- **Mains adverses visualisées** : éventail de dos de cartes et pastille de décompte dynamique sur chaque siège adverse.
- **Zoom & Inspection haute définition** :
  - Rendu haute résolution (images Scryfall `normal` / `large`) pour une lisibilité parfaite des cartes complexes.
  - Zoom au curseur et grand aperçu fixe sans débordement sur la table de jeu.

### 2. Manipulation des cartes, Attachements & Marqueurs
- **Lasso de sélection modèle pur** : capture uniquement les permanents réels sur le champ de bataille (exclut les mains, cartes de réserve et aperçus de piles).
- **Système d'attachement précis (auras, équipements, étiquettes)** :
  - Geste en deux temps (menu contextuel puis clic sur la cible, ou glisser direct).
  - Empilement ordonné sous la cible avec décalage millimétré, badge `🔗 N`, mise en surbrillance de la paire au survol et suivi automatique lors des déplacements de la carte parente.
  - Détachement fluide par déplacement de la carte attachée ou via menu contextuel.
- **Cartes face cachée** : indicateur discret pour le propriétaire sans jamais divulguer l'identité aux adversaires.
- **Marqueurs calculés et configurables** :
  - Valeur libre : entiers, compteurs textuels, mots-clés de règles (vol, vigilance, piétinement...).
  - Force / Endurance indépendantes (`X/Y`) avec commandes d'incrément `−` et `+` séparées pour chaque valeur.
  - Compteurs de loyauté, taxe de commandant et compteurs libres déplaçables.
  - Compteurs figés / gelés avec journalisation dédiée dans l'Action Log.
- **Étagère à jetons enrichie (`TokenShelf.tsx`)** :
  - Recherche Scryfall différenciant toutes les variantes d'un même jeton (couleur, force/endurance, type).
  - Réorganisation directe par flèches au survol.

### 3. Bibliothèque, Révélations & Regards
- **Consultation & Regards modaux grand format (`LookModal.tsx`)** :
  - Interface dédiée pour Scry, Surveil et fouille de bibliothèque sans chevauchement de cartes.
  - Révélation aux adversaires et à soi-même des $X$ cartes du dessus de bibliothèque (`REVEAL`).
  - Sélection d'actions par carte : envoi au cimetière, au-dessous de la bibliothèque, sur le champ de bataille, en main, etc.
  - Clôture immédiate via la touche `Échap` sans laisser d'aperçu fantôme ou de survol gelé.
- **Révélation permanente du dessus de bibliothèque (`topReveal.ts`)** :
  - Support natif des cartes comme *Experimental Frenzy* ou *Vizier of the Menagerie*.
  - Réconciliation automatique en un point unique côté serveur (à chaque pioche, meule, mélange, mulligan).
  - Badge visuel « œil » indiquant clairement qui a accès à l'information.
- **Journal d'actions enrichi (`ActionLog.tsx`)** :
  - Traces précises détaillant la nature de l'action (`consultation`, `scry`, `révélation`).
  - Notification exacte des destinations choisies pour chaque carte et mention explicite de l'état de la bibliothèque (`mélangée` ou `sans mélanger`).

### 4. Réseau, Sécurité & Information cachée
- **Serveur autoritatif Fastify + WebSocket** : logique de jeu pure validée côté serveur, aucun arbitrage laissé aux clients.
- **Étanchéité cryptographique et logique** :
  - Aucun identifiant publié pour les cartes en bibliothèque.
  - Réattribution complète de tous les identifiants de la bibliothèque lors de chaque mélange (`SHUFFLE`).
  - Double projection des événements (`seq` partagé) : filtrée à l'émission pour garantir l'absence totale de fuite de données vers les clients non autorisés.
- **Curseurs multijoueurs temps réel** : interpolation fluide, affichés au-dessus des cartes (`z-index: 40`).
- **Gestion des sessions et résilience** :
  - Reconnexion transparente sans perte d'état grâce aux `seatTokens`.
  - Bouton quitter fendu (séparation de l'absence momentanée et de la concession définitive).
  - Clôture irrévocable de la table réservée à l'hôte.

### 5. Gestion des Decks & Comptes
- **Éditeur de deck complet carte par carte** :
  - Modification des quantités, éditions alternatives, drapeaux foil, gestion de la réserve (sideboard).
  - Détachement explicite de la source externe sur confirmation pour éviter tout écrasement accidentel.
- **Composition pré-game sur la table** : ajustement du deck et de la réserve directement depuis la table avant le lancement de la partie.
- **Imports multiples** : Archidekt avec resynchronisation forcée (`fresh: true`), Moxfield (collage propre sans contournement frauduleux de Cloudflare), et listes au format texte brut.
- **Courriels transactionnels soignés (`mailTemplate.ts`)** : modèles HTML responsive en ligne, compatibles Gmail et Outlook, testés avec images bloquées.

### 6. PWA & Qualité de code
- **Progressive Web App installable** : manifeste web complet, icônes adaptatives, raccourcis et fonctionnement plein écran.
- **Mise en cache respectueuse** : le service worker ne met en cache que la coquille applicative locale ; aucun asset sous copyright de Wizards of the Coast n'est hébergé ou stocké.
- **Couverture de tests automatisés** :
  - 294 tests unitaires et d'intégration validés (`Vitest`).
  - Tests d'invariants et de non-fuite par fuzzing sur des centaines d'actions aléatoires.
  - Sondes de bout en bout (`Playwright` / scripts Node) validant l'expérience dans de vrais navigateurs.


## Mention légale

Projet de fan non commercial, **non affilié à Wizards of the Coast LLC** et non
approuvé par elle, publié dans le cadre de leur politique de contenu de fan. Magic: The Gathering et l'ensemble des noms, symboles et illustrations
associés sont la propriété de Wizards of the Coast. Ce dépôt ne contient ni ne
redistribue aucun asset de Wizards of the Coast : ni image de carte, ni artwork, ni
symbole de mana, ni cadre, ni texte de règles.

La règle tenue est donc précise, et ce n'est pas « aucune illustration n'apparaît » :
c'est **rien d'hébergé, rien de proxifié, rien de mis en cache**. Les faces de cartes et
le dos officiel sont affichés — leur politique de contenu de fan l'autorise pour un
projet non commercial — mais c'est le **navigateur du joueur** qui va les chercher chez
Scryfall. Le dépôt n'en contient aucune copie et notre serveur n'en sert aucune. Les
symboles de mana, eux, restent dessinés par nous : ils ne sont servis par aucun CDN
public, les afficher supposerait donc de les héberger.
