/**
 * Cycle de vie des decks : import, persistance, resynchronisation.
 *
 * Un import ne persiste rien tant qu'il n'est pas rattaché à un compte : un
 * invité peut coller une liste, jouer avec, et ne créer un compte qu'après.
 */
import type { DeckSource, DeckSummary, ImportReport, ParsedDeck } from '@mtg/shared';
import { prisma } from '../db.js';
import { parseDeckText } from '../import/text.js';
import { resolveDeck } from '../import/resolve.js';
import { importFromArchidekt, DeckImportError } from '../import/archidekt.js';
import { importFromMoxfield, isMoxfieldUrl, MOXFIELD_PASTE_HINT, moxfieldApiConfigured } from '../import/moxfield.js';

export interface ImportInput {
  source?: DeckSource;
  url?: string;
  text?: string;
  name?: string;
  /**
   * Relire la liste chez la source plutôt que de servir le cache.
   * Réservé à la resynchronisation, qui est une demande explicite.
   */
  fresh?: boolean;
}

export interface ImportOutcome {
  report: ImportReport;
  source: DeckSource;
  sourceUrl?: string;
  sourceDeckId?: string;
}

/** Devine le chemin d'import à partir de ce que l'utilisateur a fourni. */
export async function runImport(input: ImportInput): Promise<ImportOutcome> {
  if (input.url) {
    const url = input.url.trim();

    if (isMoxfieldUrl(url)) {
      // On laisse passer même si l'accès a été révoqué depuis : `importFromMoxfield`
      // servira son cache s'il en a un, et refusera proprement sinon.
      if (!moxfieldApiConfigured()) {
        throw new DeckImportError(
          "L'import Moxfield par URL n'est pas disponible.",
          'MOXFIELD_DISABLED',
          MOXFIELD_PASTE_HINT,
        );
      }
      const { deckId, parsed } = await importFromMoxfield(url);
      return {
        report: await resolveDeck(parsed, { deckName: input.name ?? 'Deck Moxfield', source: 'MOXFIELD', sourceUrl: url }),
        source: 'MOXFIELD',
        sourceUrl: url,
        sourceDeckId: deckId,
      };
    }

    const { deckId, parsed } = await importFromArchidekt(url, { fresh: input.fresh === true });
    return {
      report: await resolveDeck(parsed, { deckName: input.name ?? 'Deck Archidekt', source: 'ARCHIDEKT', sourceUrl: url }),
      source: 'ARCHIDEKT',
      sourceUrl: url,
      sourceDeckId: deckId,
    };
  }

  if (input.text?.trim()) {
    const parsed: ParsedDeck = parseDeckText(input.text);
    // Une liste collée depuis Moxfield reste un import texte : c'est le chemin
    // par défaut, pas un mode dégradé.
    const source: DeckSource = input.source === 'MOXFIELD' ? 'MOXFIELD' : 'TEXT';
    return {
      report: await resolveDeck(parsed, { deckName: input.name ?? 'Deck collé', source }),
      source,
    };
  }

  throw new DeckImportError('Fournis une URL de deck ou une liste collée.', 'BAD_URL');
}

export interface PersistOptions {
  userId: string;
  deckId?: string;
  name?: string;
  format?: string | null;
}

/** Écrit le résultat d'un import dans un deck, créé ou remplacé. */
export async function persistImport(outcome: ImportOutcome, options: PersistOptions): Promise<string> {
  const { report } = outcome;
  const name = options.name ?? report.deckName;

  return prisma.$transaction(async (tx) => {
    let deckId = options.deckId;

    if (deckId) {
      const existing = await tx.deck.findFirst({ where: { id: deckId, userId: options.userId } });
      if (!existing) throw new DeckImportError('Deck introuvable.', 'NOT_FOUND');
      await tx.deckCard.deleteMany({ where: { deckId } });
      // Liste de champs explicite, et c'est volontaire : `playmatUrl` et
      // `cardBackUrl` n'y figurent pas, donc une resynchronisation depuis
      // Archidekt n'efface pas l'apparence choisie pour ce deck. La source
      // externe ne la connaît pas ; elle n'a pas à la décider.
      await tx.deck.update({
        where: { id: deckId },
        data: {
          name,
          source: outcome.source,
          sourceUrl: outcome.sourceUrl ?? null,
          sourceDeckId: outcome.sourceDeckId ?? null,
          lastSyncedAt: outcome.sourceUrl ? new Date() : existing.lastSyncedAt,
          ...(options.format !== undefined ? { format: options.format } : {}),
        },
      });
    } else {
      /*
       * Réimporter une source déjà importée, c'est la **resynchroniser**.
       *
       * Un couple (compte, source, identifiant de deck) est unique en base :
       * créer sans regarder faisait remonter la contrainte Prisma brute à
       * l'utilisateur — « Unique constraint failed on the fields… » — pour un
       * geste parfaitement légitime, recoller l'URL d'un deck qu'on a déjà.
       * On met donc à jour celui qui existe, ce qui est de toute façon ce que
       * l'utilisateur voulait : il n'a pas demandé un second exemplaire du même
       * deck, il a demandé la version à jour.
       *
       * Comme pour `resyncDeck`, l'apparence choisie (`playmatUrl`,
       * `cardBackUrl`) n'est pas touchée : la source externe ne la connaît pas.
       */
      const twin =
        outcome.sourceDeckId && outcome.source !== 'MANUAL'
          ? await tx.deck.findFirst({
              where: {
                userId: options.userId,
                source: outcome.source,
                sourceDeckId: outcome.sourceDeckId,
              },
            })
          : null;

      if (twin) {
        await tx.deckCard.deleteMany({ where: { deckId: twin.id } });
        await tx.deck.update({
          where: { id: twin.id },
          data: {
            name,
            sourceUrl: outcome.sourceUrl ?? null,
            lastSyncedAt: outcome.sourceUrl ? new Date() : twin.lastSyncedAt,
            ...(options.format !== undefined ? { format: options.format } : {}),
          },
        });
        deckId = twin.id;
      } else {
        const created = await tx.deck.create({
          data: {
            userId: options.userId,
            name,
            format: options.format ?? null,
            source: outcome.source,
            sourceUrl: outcome.sourceUrl ?? null,
            sourceDeckId: outcome.sourceDeckId ?? null,
            lastSyncedAt: outcome.sourceUrl ? new Date() : null,
          },
        });
        deckId = created.id;
      }
    }

    if (report.cards.length > 0) {
      await tx.deckCard.createMany({
        data: report.cards.map((c) => ({
          deckId: deckId!,
          scryfallId: c.scryfallId,
          quantity: c.quantity,
          zone: c.zone,
          requestedSetCode: c.requestedSetCode ?? null,
          requestedCollectorNumber: c.requestedCollectorNumber ?? null,
          isFoil: c.isFoil,
          sortIndex: c.sortIndex,
        })),
      });
    }

    return deckId!;
  });
}

/**
 * Resynchronise un deck importé depuis une URL. Le deck existant est mis à jour
 * en place — `sourceDeckId` fait foi — plutôt que dupliqué.
 */
export async function resyncDeck(deckId: string, userId: string): Promise<ImportReport> {
  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId } });
  if (!deck) throw new DeckImportError('Deck introuvable.', 'NOT_FOUND');
  if (!deck.sourceUrl) {
    throw new DeckImportError(
      "Ce deck n'a pas d'origine externe : il n'y a rien à resynchroniser.",
      'BAD_URL',
      deck.source === 'MOXFIELD' ? MOXFIELD_PASTE_HINT : undefined,
    );
  }

  /*
   * `fresh` : une resynchronisation va **relire** la liste chez la source.
   * Sans lui, elle était servie depuis le cache pendant quinze minutes — donc
   * le bouton répondait « c'est fait » sans avoir rien relu, et un changement
   * d'édition fait juste avant ne prenait pas.
   *
   * Moxfield ne reçoit pas ce traitement, et c'est délibéré : l'accès y est
   * accordé à titre de faveur, et servir le cache y est une règle posée
   * (`docs/moxfield.md` §4), pas une optimisation qu'on peut lever.
   */
  const outcome = await runImport({ url: deck.sourceUrl, name: deck.name, fresh: true });
  await persistImport(outcome, { userId, deckId, name: deck.name });
  return outcome.report;
}

export async function listDecks(userId: string): Promise<DeckSummary[]> {
  const decks = await prisma.deck.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: { cards: { include: { card: { select: { name: true, colorIdentity: true } } } } },
  });

  return decks.map((deck) => {
    const colors = new Set<string>();
    let cardCount = 0;
    const commanders: DeckSummary['commanders'] = [];

    for (const dc of deck.cards) {
      cardCount += dc.quantity;
      for (const c of dc.card.colorIdentity) colors.add(c);
      if (dc.zone === 'COMMANDER') commanders.push({ scryfallId: dc.scryfallId, name: dc.card.name });
    }

    return {
      id: deck.id,
      name: deck.name,
      format: deck.format,
      source: deck.source,
      sourceUrl: deck.sourceUrl,
      lastSyncedAt: deck.lastSyncedAt?.toISOString() ?? null,
      updatedAt: deck.updatedAt.toISOString(),
      cardCount,
      playmatUrl: deck.playmatUrl,
      cardBackUrl: deck.cardBackUrl,
      commanders,
      colorIdentity: [...colors].sort(),
    };
  });
}

export async function getDeck(deckId: string, userId: string) {
  return prisma.deck.findFirst({
    where: { id: deckId, userId },
    include: {
      cards: {
        orderBy: [{ zone: 'asc' }, { sortIndex: 'asc' }],
        include: { card: true },
      },
    },
  });
}

/**
 * Deck figé pour une partie. Le snapshot contient tout ce dont la room a besoin,
 * pour qu'une modification ultérieure du deck ne mute jamais la partie en cours.
 */
export async function snapshotDeck(deckId: string, userId: string): Promise<string> {
  const deck = await getDeck(deckId, userId);
  if (!deck) throw new DeckImportError('Deck introuvable.', 'NOT_FOUND');

  const payload = {
    name: deck.name,
    format: deck.format,
    cards: deck.cards.map((dc) => ({
      scryfallId: dc.scryfallId,
      quantity: dc.quantity,
      zone: dc.zone,
      isFoil: dc.isFoil,
      name: dc.card.name,
      setCode: dc.card.setCode,
      collectorNumber: dc.card.collectorNumber,
      typeLine: dc.card.typeLine,
      manaCost: dc.card.manaCost,
      colorIdentity: dc.card.colorIdentity,
      layout: dc.card.layout,
      imageUris: dc.card.imageUris,
      faces: dc.card.faces,
    })),
  };

  const snapshot = await prisma.deckSnapshot.create({ data: { deckId: deck.id, payload: payload as never } });
  return snapshot.id;
}

/** Snapshot d'une liste collée par un invité, sans deck en base derrière. */
export async function snapshotFromReport(report: ImportReport): Promise<string> {
  const cards = await prisma.card.findMany({
    where: { scryfallId: { in: report.cards.map((c) => c.scryfallId) } },
  });
  const byId = new Map(cards.map((c) => [c.scryfallId, c]));

  const payload = {
    name: report.deckName,
    format: null,
    cards: report.cards.map((c) => {
      const card = byId.get(c.scryfallId);
      return {
        scryfallId: c.scryfallId,
        quantity: c.quantity,
        zone: c.zone,
        isFoil: c.isFoil,
        name: card?.name ?? c.name,
        setCode: card?.setCode ?? c.setCode,
        collectorNumber: card?.collectorNumber ?? c.collectorNumber,
        typeLine: card?.typeLine ?? '',
        manaCost: card?.manaCost ?? null,
        colorIdentity: card?.colorIdentity ?? [],
        layout: card?.layout ?? 'normal',
        imageUris: card?.imageUris ?? null,
        faces: card?.faces ?? null,
      };
    }),
  };

  const snapshot = await prisma.deckSnapshot.create({ data: { payload: payload as never } });
  return snapshot.id;
}
