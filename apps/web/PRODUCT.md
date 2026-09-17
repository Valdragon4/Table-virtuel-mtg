# Product

<!-- impeccable:product-schema 1 -->

> Note de provenance : ce fichier a été écrit sans entretien. Aucun outil de
> question structurée n'existait dans la surface d'outils de la session, et la
> session n'était pas interactive. Chaque fait ci-dessous vient soit du dépôt
> (README.md, docs/ui-reference.md, le code), soit du brief explicite de la
> demande, et les rares inférences sont marquées `[inféré]`. À confirmer par le
> propriétaire.

## Platform

web

## Users

Des joueurs de Magic: The Gathering qui jouent **entre amis**, en ligne, souvent
en Commander à plusieurs. Un hôte crée la table et envoie le lien ; les invités
l'ouvrent, parfois depuis leur téléphone, souvent sans avoir de compte, et
veulent être assis en quelques secondes. `[inféré depuis le brief : « celle
qu'on montre à des amis pour les convaincre d'ouvrir une table » et « un joueur
qui reçoit un lien d'invitation l'ouvre souvent sur son téléphone »]`

## Product Purpose

Offrir une table virtuelle de Magic dans le navigateur où l'on joue **comme
autour d'une vraie table** : le logiciel tient les objets, les zones et
l'information cachée, mais **n'arbitre aucune règle**. Les joueurs arbitrent
eux-mêmes. Le succès, c'est une partie entre amis qui démarre sans friction et
se déroule sans que l'outil s'interpose.

## Positioning

**Aucun moteur de règles, assumé.** Là où les autres tables imposent la pile,
les priorités et ce qui est « légal », celle-ci ne dit jamais non : n'importe
quelle carte, n'importe quel format maison, n'importe quel arbitrage de table.
Second point qu'un voisin ne peut pas copier sans le construire : la
confidentialité est tenue **par construction** côté serveur (identifiants de
bibliothèque jamais publiés, réattribués à chaque mélange, filtrage à
l'émission), et non par discipline du client.

## Operating Context

- L'hôte crée une table, choisit un format (Commander, Duel, Planechase), et
  partage un **lien** ou un **code** court.
- On colle sa liste de deck : import Archidekt par URL, collage d'une liste
  texte, ou collage d'un export Moxfield.
- Jusqu'à **quatre sièges** par table (`LIMITS.maxSeats`).
- **Aucun compte n'est nécessaire pour jouer.** Le compte sert à conserver ses
  decks, ses playmats et ses réglages.
- La table elle-même est une surface dense, sombre, pannable/zoomable, décrite
  en détail dans `docs/ui-reference.md`.

## Capabilities and Constraints

- Serveur autoritatif Fastify + Prisma + WebSocket ; état de partie en mémoire ;
  client React + Vite + Tailwind + Zustand qui n'applique que ce que le serveur
  diffuse.
- Recherche de cartes servie par une ingestion Scryfall — **117 964 cartes**
  (chiffre donné par le brief) — via `GET /api/cards/search`.
- **Contrainte dure et permanente : aucun asset de Wizards of the Coast n'est
  hébergé, proxifié ou mis en cache par ce dépôt.** Les images de cartes sont
  chargées par le navigateur du joueur directement depuis le CDN Scryfall
  (`scryfallImage()` dans `apps/web/src/lib/cards.ts`). Aucun symbole de mana,
  cadre, artwork ou texte de règles officiel n'est embarqué.
- La mention légale de pied de page (projet de fan non commercial, non affilié à
  Wizards of the Coast) est **obligatoire et doit rester lisible**.
- Langue : interface en **français**, sauf les mots-clés de Magic qui restent en
  **anglais** (tap, mulligan, scry, token, sideboard…).
- Replays et Planechase : jalons non terminés. Ne rien promettre à leur sujet.

## Brand Commitments

- Nom en place dans le produit : « Table virtuelle MTG ». Aucun logo, aucune
  marque graphique, aucun favicon n'existait avant ce travail.
- Palette incumbente, relevée et documentée : fond `#111827`, panneaux
  `#1f2937`, bordures `#374151`, accent `#38bdf8`/`sky-600`, ambre `#fbbf24`
  pour l'état transitoire, violet `#9333ea` pour l'aléa. Police : pile système
  avec Inter en tête.
- Toute iconographie doit être une **création originale**.

## Evidence on Hand

- Réel : le produit fonctionne et est en production sur
  `https://magic.valentin-marot.fr`.
- Réel : `README.md` (architecture, ressources tierces, jalons) et
  `docs/ui-reference.md` (l'interface de table au pixel).
- Réel : l'API de recherche de cartes et le CDN Scryfall permettent d'afficher
  de vraies cartes sans rien héberger.
- **Absent, à ne pas inventer** : aucun témoignage, aucun chiffre d'audience,
  aucun nombre de parties jouées, aucun logo de presse, aucune tarification.
  Le produit est gratuit et non commercial ; il n'a pas de clients.

## Product Principles

1. **Le logiciel tient la table, jamais l'arbitrage.** Tout ce qui ressemble à
   une règle imposée est un défaut.
2. **Jouer d'abord, s'inscrire peut-être.** Aucun mur de compte sur le chemin
   d'une partie.
3. **Rien d'officiel n'est hébergé ici.** La contrainte est structurante, pas
   cosmétique : elle façonne jusqu'à l'identité visuelle du site.
4. **La confidentialité est une propriété du serveur**, démontrable par les
   tests, pas une promesse.
5. **Le lien est le produit.** Ce qui circule entre amis, c'est une URL ; tout
   ce qui la rend plus rapide à ouvrir compte.

## Accessibility & Inclusion

Pas d'exigence formelle établie par le propriétaire. Contraintes de fait :
surface sombre, interface dense, et une part notable des visiteurs arrivent sur
**téléphone** par un lien d'invitation. `[inféré depuis le brief]`
