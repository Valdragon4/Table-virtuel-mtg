/**
 * Report d'un changement d'impression fait en partie sur le deck du compte.
 *
 * `SET_PRINTING` ne touchait que l'objet de jeu : le choix d'illustration
 * mourait avec la table, et il fallait le refaire à chaque partie. Ce module
 * est le chemin de retour — le seul endroit qui écrit dans un `Deck` à partir
 * d'une action de jeu.
 *
 * ## Ce qu'on déplace, et pourquoi une seule copie
 *
 * Une ligne `DeckCard` porte une `quantity` : elle représente **toutes** les
 * copies d'une impression, pas une. Le joueur, lui, a changé l'impression d'un
 * seul objet sur la table. Trois choix se présentaient :
 *
 *  - **changer les trois** : le deck rechargé n'aurait plus ressemblé à la
 *    table qu'on vient de quitter. C'est justement pour les cartes en plusieurs
 *    exemplaires — les terrains de base avant tout — qu'on change une
 *    impression : pour que les copies ne soient pas identiques ;
 *  - **ne rien faire au-delà de la quantité 1** : la demande ne serait pas
 *    honorée là où elle sert le plus ;
 *  - **déplacer une copie**, retenu ici : la ligne d'origine perd une unité,
 *    une ligne de la nouvelle impression en gagne une. Le total par carte est
 *    conservé, et le deck rechargé montre exactement la table qu'on a quittée.
 *
 * Le modèle le supporte sans rien inventer : rien n'impose l'unicité de
 * `(deckId, scryfallId)`, la liste texte transporte l'édition ligne par ligne
 * (`renderDeckLine`) et le dédoublonnage d'import travaille par
 * `scryfallId|zone|isFoil` — deux impressions de la même carte survivent donc à
 * l'aller-retour par l'éditeur. Et parce qu'on **fusionne** dans une ligne
 * existante quand elle existe, changer puis rechanger d'avis ne fragmente pas
 * le deck : il revient à son état d'avant.
 *
 * ## Comment on retrouve la ligne
 *
 * Par l'**ancien** `scryfallId`, jamais par l'`oracleId`. Un deck peut
 * légitimement contenir deux impressions de la même carte — c'est même ce que
 * ce module fabrique —, et l'oracle ne les départage pas. L'oracle ne sert
 * qu'en garde-fou : si les deux impressions n'ont pas le même, on n'écrit rien,
 * parce qu'on est alors en train de remplacer une carte par une autre.
 *
 * Deux changements successifs s'enchaînent d'eux-mêmes : le premier a fait
 * passer la ligne de A à B, et le second arrive avec B pour ancienne impression.
 *
 * ## Ce qui reste du choix après une resynchronisation
 *
 * La ligne qui **reçoit** la copie est marquée `printingPinned`, dans les trois
 * branches de la transaction. Sans cette marque, une resynchronisation depuis
 * Archidekt ou Moxfield remplace le contenu du deck en bloc et le choix
 * disparaît sans un mot — ce module écrivait alors dans le vide dès le premier
 * clic sur « Resynchroniser ».
 *
 * La marque ne fige que l'**illustration**, jamais la quantité : la source
 * garde la main sur le contenu du deck. Les règles d'arbitrage sont dans
 * `pinned-printings.ts`, qui les applique.
 *
 * ## Qui a le droit
 *
 * Trois barrières, et aucune ne fait confiance au client :
 *  - un **invité** n'a pas de compte, donc pas de deck : `userId` est `null` ;
 *  - une **liste collée** fige un `DeckSnapshot` sans `deckId` (voir
 *    `snapshotFromReport`) : il n'y a aucune ligne à mettre à jour ;
 *  - le deck appartient à son **propriétaire**, pas au siège : on relit
 *    `Deck.userId` en base et on refuse s'il ne correspond pas. Le chargement
 *    vérifie déjà la propriété, mais une seconde vérification au moment d'écrire
 *    ne coûte rien et ferme la question.
 */
import type { DeckZone } from '@mtg/shared';
import { prisma } from '../db.js';

/** Ce qu'un siège a changé sur la table, tel que la room le rapporte. */
export interface DeckPrintingChange {
  /** Compte du joueur assis, `null` pour un invité. */
  userId: string | null;
  /** Deck figé chargé sur le siège, `null` si aucun deck n'a été chargé. */
  deckSnapshotId: string | null;
  /** Zone d'origine de la carte dans le deck figé. */
  zone: DeckZone;
  previousScryfallId: string;
  nextScryfallId: string;
  previousIsFoil: boolean;
  nextIsFoil: boolean;
}

/** Pourquoi une écriture n'a pas eu lieu. Sert au journal serveur, et aux tests. */
export type DeckPrintingSkip =
  | 'GUEST'
  | 'NO_DECK'
  | 'PASTED_LIST'
  | 'SNAPSHOT_GONE'
  | 'DECK_GONE'
  | 'NOT_OWNER'
  | 'UNKNOWN_PRINTING'
  | 'OTHER_CARD'
  | 'NO_CHANGE'
  | 'ROW_NOT_FOUND';

export type DeckPrintingSyncResult =
  | { applied: false; reason: DeckPrintingSkip }
  | { applied: true; deckId: string; deckName: string; setCode: string; collectorNumber: string };

/**
 * Déplace une copie d'une impression à l'autre dans le deck enregistré.
 *
 * Ne lève jamais pour un refus : un changement d'impression en partie reste
 * valide même quand le deck ne bouge pas. Une panne de base, elle, remonte —
 * c'est à l'appelant de l'absorber (voir `Room.handleIntent`).
 */
export async function applyPrintingToDeck(
  change: DeckPrintingChange,
): Promise<DeckPrintingSyncResult> {
  if (!change.userId) return { applied: false, reason: 'GUEST' };
  if (!change.deckSnapshotId) return { applied: false, reason: 'NO_DECK' };
  if (
    change.previousScryfallId === change.nextScryfallId &&
    change.previousIsFoil === change.nextIsFoil
  ) {
    return { applied: false, reason: 'NO_CHANGE' };
  }

  const snapshot = await prisma.deckSnapshot.findUnique({
    where: { id: change.deckSnapshotId },
    select: { deckId: true },
  });
  if (!snapshot) return { applied: false, reason: 'SNAPSHOT_GONE' };
  // Snapshot sans deck : c'est une liste collée, il n'y a rien derrière.
  if (!snapshot.deckId) return { applied: false, reason: 'PASTED_LIST' };

  const deck = await prisma.deck.findUnique({
    where: { id: snapshot.deckId },
    select: { id: true, userId: true, name: true },
  });
  if (!deck) return { applied: false, reason: 'DECK_GONE' };
  // Le deck d'un autre ne se modifie pas depuis un siège, quel qu'il soit.
  if (deck.userId !== change.userId) return { applied: false, reason: 'NOT_OWNER' };

  const cards = await prisma.card.findMany({
    where: { scryfallId: { in: [change.previousScryfallId, change.nextScryfallId] } },
    select: { scryfallId: true, oracleId: true, name: true, setCode: true, collectorNumber: true },
  });
  const before = cards.find((c) => c.scryfallId === change.previousScryfallId);
  const after = cards.find((c) => c.scryfallId === change.nextScryfallId);
  if (!before || !after) return { applied: false, reason: 'UNKNOWN_PRINTING' };

  /*
   * Garde-fou : on change d'impression, pas de carte. Le moteur compare déjà
   * les noms, mais il travaille sur des données figées dans le snapshot ; ici
   * on a la base sous la main, donc l'oracle, qui est la vraie identité d'une
   * carte. Oracle absent (carte ingérée avant la colonne, jeton) : on retombe
   * sur le nom plutôt que de laisser passer sans rien vérifier.
   */
  const sameCard =
    before.oracleId !== null && after.oracleId !== null
      ? before.oracleId === after.oracleId
      : before.name === after.name;
  if (!sameCard) return { applied: false, reason: 'OTHER_CARD' };

  const rows = await prisma.deckCard.findMany({
    where: {
      deckId: deck.id,
      zone: change.zone,
      scryfallId: { in: [change.previousScryfallId, change.nextScryfallId] },
    },
  });

  /*
   * Une même impression peut figurer deux fois dans une zone, une ligne foil et
   * une ligne non foil : on prend celle qui correspond à l'objet tel qu'il était
   * avant le changement, et on se rabat sur la première sinon.
   */
  const candidates = rows.filter((r) => r.scryfallId === change.previousScryfallId);
  const source =
    candidates.find((r) => r.isFoil === change.previousIsFoil) ?? candidates[0] ?? null;
  if (!source || source.quantity < 1) return { applied: false, reason: 'ROW_NOT_FOUND' };

  const target =
    rows.find(
      (r) => r.scryfallId === change.nextScryfallId && r.isFoil === change.nextIsFoil,
    ) ?? null;

  await prisma.$transaction(async (tx) => {
    if (target && target.id !== source.id) {
      // La nouvelle impression est déjà là : on lui donne la copie, plutôt que
      // d'ajouter une deuxième ligne identique à côté d'elle.
      await tx.deckCard.update({
        where: { id: target.id },
        data: { quantity: target.quantity + 1, printingPinned: true },
      });
      if (source.quantity > 1) {
        await tx.deckCard.update({
          where: { id: source.id },
          data: { quantity: source.quantity - 1 },
        });
      } else {
        await tx.deckCard.delete({ where: { id: source.id } });
      }
    } else if (source.quantity > 1) {
      await tx.deckCard.update({
        where: { id: source.id },
        data: { quantity: source.quantity - 1 },
      });
      await tx.deckCard.create({
        data: {
          deckId: deck.id,
          scryfallId: change.nextScryfallId,
          quantity: 1,
          zone: change.zone,
          // L'édition demandée suit l'impression retenue : sans cela, une
          // réécriture de la liste texte proposerait l'ancienne.
          requestedSetCode: after.setCode,
          requestedCollectorNumber: after.collectorNumber,
          isFoil: change.nextIsFoil,
          // Le même rang que sa sœur : les deux impressions restent voisines
          // dans la liste.
          sortIndex: source.sortIndex,
          printingPinned: true,
        },
      });
    } else {
      // Une seule copie : la ligne change d'impression sur place.
      await tx.deckCard.update({
        where: { id: source.id },
        data: {
          scryfallId: change.nextScryfallId,
          requestedSetCode: after.setCode,
          requestedCollectorNumber: after.collectorNumber,
          isFoil: change.nextIsFoil,
          printingPinned: true,
        },
      });
    }

    /*
     * Le deck a changé, sa date doit le dire : la liste des decks se trie par
     * `updatedAt`, et une modification invisible dans cette liste est
     * exactement le genre de changement qu'on découvre trois semaines plus tard.
     */
    await tx.deck.update({ where: { id: deck.id }, data: { updatedAt: new Date() } });
  });

  return {
    applied: true,
    deckId: deck.id,
    deckName: deck.name,
    setCode: after.setCode,
    collectorNumber: after.collectorNumber,
  };
}

/**
 * Journal serveur de ce module.
 *
 * ## Pourquoi pas une ligne dans le journal de la partie
 *
 * Une ligne de journal est **publique pour toute la table**, quelle que soit
 * l'audience de l'event qui la porte (docs/protocol.md §5.4). « Alice a mis à
 * jour son deck » n'est pas une information sur la partie : c'est une
 * information sur le compte d'Alice, et ses adversaires n'ont pas à l'avoir.
 * Le journal garde donc la seule phrase qui parle de la table — « Alice a
 * changé l'impression de Forêt (UNF) » —, et l'écriture en base reste dans le
 * journal du serveur.
 *
 * Ce qui manque encore, et qui ne peut pas être fait ici : **le joueur devrait
 * l'apprendre sur le moment**. Cela demande un event adressé à son seul siège,
 * donc une entrée de plus dans l'union `ServerEvent` du paquet partagé, hors
 * du périmètre de ce module.
 */
let log: { info: (msg: string) => void; error: (msg: string) => void } = {
  info: (msg) => console.info(msg),
  error: (msg) => console.error(msg),
};

/** Branche le journal du serveur, au démarrage. Sans cet appel, on écrit sur la console. */
export function setDeckSyncLogger(sink: typeof log): void {
  log = sink;
}

/**
 * Le report, en tâche de fond : ni attente, ni exception qui remonte.
 *
 * C'est la forme sous laquelle la room l'appelle, et la garantie qu'elle
 * réclame — une écriture de deck ne doit jamais pouvoir faire échouer une
 * action de jeu, ni même la ralentir.
 */
export function reportPrintingToDeck(change: DeckPrintingChange): void {
  void applyPrintingToDeck(change)
    .then((result) => {
      if (!result.applied) return;
      log.info(
        `Deck ${result.deckId} : une copie passe en ${result.setCode.toUpperCase()} ${result.collectorNumber} ` +
          `(changement d'impression en partie).`,
      );
    })
    .catch((err: unknown) => {
      log.error(`Report d'impression sur le deck en échec : ${String(err)}`);
    });
}
