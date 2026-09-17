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
| 1 | Socle — monorepo, Docker, Postgres, ingestion Scryfall, recherche | fait |
| 2 | Comptes — auth, vérification, réinitialisation, préférences, suppression | fait |
| 3 | Decks — parseur, Archidekt, resync, rapport d'import, CRUD | fait |
| 4 | Table — rendu, zones, pioche, déplacements, compteurs, journal | fait |
| 5 | Multijoueur — serveur autoritatif, information cachée, reconnexion, curseurs | fait |
| 6 | Commander — 4 sièges, dégâts de commandant, mulligans, tokens, scry | fait |
| 7 | Confort — playmats, foil, raccourcis, réserve, replays | partiel (replays à faire) |
| 8 | Extras — Planechase, draft Commander temps réel | à faire |

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
