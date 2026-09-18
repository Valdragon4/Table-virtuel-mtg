/**
 * Report d'un changement d'impression fait en partie sur le deck du compte.
 *
 * Ce que ces tests tiennent, et qui compte plus que le chemin nominal : on
 * n'écrit **que** dans le deck de celui qui joue, et jamais au prix d'une
 * action de jeu. Un invité, une liste collée ou une base en panne laissent la
 * partie intacte.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type DeckPayload } from '../src/game/room.js';
import { seededRandom } from '../src/game/random.js';
import { fakeConnection } from './fixture.js';
import { getZone, type CardData } from '../src/game/state.js';

interface FakeDeckCard {
  id: string;
  deckId: string;
  scryfallId: string;
  quantity: number;
  zone: string;
  requestedSetCode: string | null;
  requestedCollectorNumber: string | null;
  isFoil: boolean;
  sortIndex: number;
}

const snapshots = new Map<string, { id: string; deckId: string | null }>();
const decks = new Map<string, { id: string; userId: string; name: string; updatedAt: Date }>();
let deckCards: FakeDeckCard[] = [];
const cards = new Map<
  string,
  { scryfallId: string; oracleId: string | null; name: string; setCode: string; collectorNumber: string }
>();
/** Armé par un test pour simuler une base qui refuse l'écriture. */
let writeFails = false;
let nextRowId = 0;

vi.mock('../src/db.js', () => {
  const db = {
    deckSnapshot: {
      findUnique: async ({ where }: { where: { id: string } }) => snapshots.get(where.id) ?? null,
    },
    deck: {
      findUnique: async ({ where }: { where: { id: string } }) => decks.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { updatedAt: Date } }) => {
        Object.assign(decks.get(where.id)!, data);
        return decks.get(where.id);
      },
    },
    card: {
      findMany: async ({ where }: { where: { scryfallId: { in: string[] } } }) =>
        where.scryfallId.in.map((id) => cards.get(id)).filter((c) => c !== undefined),
    },
    deckCard: {
      findMany: async ({ where }: { where: { deckId: string; zone: string; scryfallId: { in: string[] } } }) =>
        deckCards
          .filter((r) => r.deckId === where.deckId && r.zone === where.zone && where.scryfallId.in.includes(r.scryfallId))
          .map((r) => ({ ...r })),
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeDeckCard> }) => {
        if (writeFails) throw new Error('base indisponible');
        const row = deckCards.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      create: async ({ data }: { data: Omit<FakeDeckCard, 'id'> }) => {
        if (writeFails) throw new Error('base indisponible');
        const row = { id: `row-${++nextRowId}`, ...data };
        deckCards.push(row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        if (writeFails) throw new Error('base indisponible');
        deckCards = deckCards.filter((r) => r.id !== where.id);
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { prisma: db };
});

const { applyPrintingToDeck } = await import('../src/decks/printing-sync.js');

const OWNER = 'user-alice';
const INTRUDER = 'user-bob';
/** Deux impressions de la même carte : même oracle, éditions différentes. */
const OLD_PRINTING = 'print-old';
const NEW_PRINTING = 'print-new';

function seed(): void {
  snapshots.clear();
  decks.clear();
  cards.clear();
  deckCards = [];
  nextRowId = 0;
  writeFails = false;

  cards.set(OLD_PRINTING, {
    scryfallId: OLD_PRINTING,
    oracleId: 'oracle-forest',
    name: 'Forest',
    setCode: 'eld',
    collectorNumber: '266',
  });
  cards.set(NEW_PRINTING, {
    scryfallId: NEW_PRINTING,
    oracleId: 'oracle-forest',
    name: 'Forest',
    setCode: 'unf',
    collectorNumber: '243',
  });
  // Une carte homonyme mais d'un autre oracle : le garde-fou doit la refuser.
  cards.set('print-autre', {
    scryfallId: 'print-autre',
    oracleId: 'oracle-autre',
    name: 'Forest',
    setCode: 'xyz',
    collectorNumber: '1',
  });

  decks.set('deck-1', { id: 'deck-1', userId: OWNER, name: 'Deck d’Alice', updatedAt: new Date(0) });
  snapshots.set('snap-deck', { id: 'snap-deck', deckId: 'deck-1' });
  // Le snapshot d'une liste collée n'a pas de deck derrière lui.
  snapshots.set('snap-colle', { id: 'snap-colle', deckId: null });
}

function change(overrides: Partial<Parameters<typeof applyPrintingToDeck>[0]> = {}) {
  return {
    userId: OWNER,
    deckSnapshotId: 'snap-deck',
    zone: 'MAIN' as const,
    previousScryfallId: OLD_PRINTING,
    nextScryfallId: NEW_PRINTING,
    previousIsFoil: false,
    nextIsFoil: false,
    ...overrides,
  };
}

function row(overrides: Partial<FakeDeckCard> = {}): FakeDeckCard {
  const r: FakeDeckCard = {
    id: `row-${++nextRowId}`,
    deckId: 'deck-1',
    scryfallId: OLD_PRINTING,
    quantity: 1,
    zone: 'MAIN',
    requestedSetCode: 'eld',
    requestedCollectorNumber: '266',
    isFoil: false,
    sortIndex: 7,
    ...overrides,
  };
  deckCards.push(r);
  return r;
}

beforeEach(seed);

describe('report sur le deck enregistré', () => {
  it('déplace la ligne quand le joueur inscrit n’a qu’un exemplaire', async () => {
    const line = row();

    const result = await applyPrintingToDeck(change());

    expect(result).toMatchObject({ applied: true, deckId: 'deck-1', setCode: 'unf' });
    expect(deckCards).toHaveLength(1);
    expect(deckCards[0]).toMatchObject({
      id: line.id,
      scryfallId: NEW_PRINTING,
      quantity: 1,
      requestedSetCode: 'unf',
      requestedCollectorNumber: '243',
    });
    // La liste des decks se trie par date : la modification doit s'y voir.
    expect(decks.get('deck-1')!.updatedAt.getTime()).toBeGreaterThan(0);
  });

  it('ne déplace qu’une copie sur trois, et conserve le total', async () => {
    row({ quantity: 3 });

    await applyPrintingToDeck(change());

    const total = deckCards.reduce((sum, r) => sum + r.quantity, 0);
    expect(total).toBe(3);
    expect(deckCards.find((r) => r.scryfallId === OLD_PRINTING)?.quantity).toBe(2);
    const created = deckCards.find((r) => r.scryfallId === NEW_PRINTING)!;
    expect(created).toMatchObject({ quantity: 1, zone: 'MAIN', requestedSetCode: 'unf' });
    // Voisines dans la liste : même rang que la ligne dont elle est issue.
    expect(created.sortIndex).toBe(7);
  });

  it('fusionne au lieu de fragmenter quand la nouvelle impression est déjà là', async () => {
    row({ quantity: 2 });
    row({ scryfallId: NEW_PRINTING, quantity: 1, requestedSetCode: 'unf', requestedCollectorNumber: '243' });

    await applyPrintingToDeck(change());

    expect(deckCards).toHaveLength(2);
    expect(deckCards.find((r) => r.scryfallId === OLD_PRINTING)?.quantity).toBe(1);
    expect(deckCards.find((r) => r.scryfallId === NEW_PRINTING)?.quantity).toBe(2);
  });

  it('revient exactement à l’état d’avant quand le joueur rechange d’avis', async () => {
    row({ quantity: 3 });

    await applyPrintingToDeck(change());
    await applyPrintingToDeck(
      change({ previousScryfallId: NEW_PRINTING, nextScryfallId: OLD_PRINTING }),
    );

    expect(deckCards).toHaveLength(1);
    expect(deckCards[0]).toMatchObject({ scryfallId: OLD_PRINTING, quantity: 3 });
  });

  it('n’écrit rien pour un invité', async () => {
    row();

    const result = await applyPrintingToDeck(change({ userId: null }));

    expect(result).toEqual({ applied: false, reason: 'GUEST' });
    expect(deckCards[0]!.scryfallId).toBe(OLD_PRINTING);
  });

  it('n’écrit rien pour une liste collée', async () => {
    row();

    const result = await applyPrintingToDeck(change({ deckSnapshotId: 'snap-colle' }));

    expect(result).toEqual({ applied: false, reason: 'PASTED_LIST' });
    expect(deckCards[0]!.scryfallId).toBe(OLD_PRINTING);
  });

  it('n’écrit rien quand aucun deck n’est chargé sur le siège', async () => {
    row();

    const result = await applyPrintingToDeck(change({ deckSnapshotId: null }));

    expect(result).toEqual({ applied: false, reason: 'NO_DECK' });
  });

  it('ne touche jamais au deck d’un autre compte', async () => {
    row();

    const result = await applyPrintingToDeck(change({ userId: INTRUDER }));

    expect(result).toEqual({ applied: false, reason: 'NOT_OWNER' });
    expect(deckCards[0]!.scryfallId).toBe(OLD_PRINTING);
    expect(decks.get('deck-1')!.updatedAt.getTime()).toBe(0);
  });

  it('refuse de remplacer une carte par une autre, même homonyme', async () => {
    row();

    const result = await applyPrintingToDeck(change({ nextScryfallId: 'print-autre' }));

    expect(result).toEqual({ applied: false, reason: 'OTHER_CARD' });
    expect(deckCards[0]!.scryfallId).toBe(OLD_PRINTING);
  });

  it('laisse le deck intact quand la carte n’y figure pas dans cette zone', async () => {
    row({ zone: 'SIDEBOARD' });

    const result = await applyPrintingToDeck(change());

    expect(result).toEqual({ applied: false, reason: 'ROW_NOT_FOUND' });
    expect(deckCards[0]!.scryfallId).toBe(OLD_PRINTING);
  });

  it('distingue la ligne foil de la ligne normale de la même impression', async () => {
    row({ quantity: 1, isFoil: false });
    const foil = row({ quantity: 1, isFoil: true });

    await applyPrintingToDeck(change({ previousIsFoil: true, nextIsFoil: true }));

    expect(deckCards.find((r) => r.id === foil.id)?.scryfallId).toBe(NEW_PRINTING);
    expect(deckCards.filter((r) => r.scryfallId === OLD_PRINTING)).toHaveLength(1);
  });
});

// --------------------------------------------------------------- côté partie

/** Deck minimal à un commandant, pour tenir le chemin `SET_PRINTING` complet. */
function commanderDeck(): DeckPayload {
  return {
    name: 'Mono-vert',
    cards: [
      {
        scryfallId: OLD_PRINTING,
        quantity: 1,
        zone: 'COMMANDER',
        isFoil: false,
        name: 'Forest',
        setCode: 'eld',
        collectorNumber: '266',
        typeLine: 'Basic Land',
        manaCost: null,
        colorIdentity: ['G'],
        layout: 'normal',
        imageUris: null,
        faces: null,
      },
    ],
  };
}

const NEW_CARD: CardData = {
  scryfallId: NEW_PRINTING,
  name: 'Forest',
  setCode: 'unf',
  collectorNumber: '243',
  typeLine: 'Basic Land',
  manaCost: null,
  colorIdentity: ['G'],
  layout: 'normal',
  imageUris: null,
  faces: null,
};

describe('SET_PRINTING en partie', () => {
  it('rapporte le changement avec le compte, le snapshot et la zone d’origine', async () => {
    const seen: unknown[] = [];
    const room = new Room('room-p', 'PRNT01', 'COMMANDER', seededRandom(3), {
      lookupCard: async () => NEW_CARD,
      syncDeckPrinting: (c) => seen.push(c),
    });
    const conn = fakeConnection('c0');
    room.addConnection(conn);
    room.sitDown(conn, 0, 'Alice', OWNER);
    room.loadDeck('seat_0', commanderDeck(), 'snap-deck');

    const card = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;
    await room.handleIntent(conn, 'c1', { type: 'SET_PRINTING', cardId: card, scryfallId: NEW_PRINTING });

    expect(seen).toEqual([
      {
        userId: OWNER,
        deckSnapshotId: 'snap-deck',
        zone: 'COMMANDER',
        previousScryfallId: OLD_PRINTING,
        nextScryfallId: NEW_PRINTING,
        previousIsFoil: false,
        nextIsFoil: false,
      },
    ]);
  });

  it('rapporte `userId: null` pour un invité : rien à écrire en aval', async () => {
    const seen: Array<{ userId: string | null }> = [];
    const room = new Room('room-g', 'PRNT02', 'COMMANDER', seededRandom(3), {
      lookupCard: async () => NEW_CARD,
      syncDeckPrinting: (c) => seen.push(c),
    });
    const conn = fakeConnection('c0');
    room.addConnection(conn);
    room.sitDown(conn, 0, 'Invité', null);
    room.loadDeck('seat_0', commanderDeck(), 'snap-colle');

    const card = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;
    await room.handleIntent(conn, 'c1', { type: 'SET_PRINTING', cardId: card, scryfallId: NEW_PRINTING });

    expect(seen[0]?.userId).toBeNull();
  });

  it('change quand même l’impression à l’écran quand l’écriture de deck échoue', async () => {
    const room = new Room('room-f', 'PRNT03', 'COMMANDER', seededRandom(3), {
      lookupCard: async () => NEW_CARD,
      syncDeckPrinting: () => {
        throw new Error('base indisponible');
      },
    });
    const conn = fakeConnection('c0');
    room.addConnection(conn);
    room.sitDown(conn, 0, 'Alice', OWNER);
    room.loadDeck('seat_0', commanderDeck(), 'snap-deck');
    conn.received.length = 0;

    const card = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;
    await room.handleIntent(conn, 'c1', { type: 'SET_PRINTING', cardId: card, scryfallId: NEW_PRINTING });

    // L'action est acquittée, pas refusée, et l'objet porte bien la nouvelle
    // impression : la table ne dépend pas de la base.
    expect(conn.received.some((m) => m.t === 'reject')).toBe(false);
    expect(conn.received.some((m) => m.t === 'ack')).toBe(true);
    expect(room.state.objects.get(card)!.card.scryfallId).toBe(NEW_PRINTING);
  });

  it('n’appelle pas le report quand le changement d’impression est refusé', async () => {
    const seen: unknown[] = [];
    const room = new Room('room-r', 'PRNT04', 'COMMANDER', seededRandom(3), {
      // Une autre carte : le moteur refuse, donc rien ne doit descendre au deck.
      lookupCard: async () => ({ ...NEW_CARD, name: 'Black Lotus' }),
      syncDeckPrinting: (c) => seen.push(c),
    });
    const conn = fakeConnection('c0');
    room.addConnection(conn);
    room.sitDown(conn, 0, 'Alice', OWNER);
    room.loadDeck('seat_0', commanderDeck(), 'snap-deck');

    const card = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;
    await room.handleIntent(conn, 'c1', { type: 'SET_PRINTING', cardId: card, scryfallId: NEW_PRINTING });

    expect(seen).toEqual([]);
  });

  it('n’écrit rien en base quand une écriture échoue, sans casser la partie', async () => {
    row();
    writeFails = true;

    await expect(applyPrintingToDeck(change())).rejects.toThrow('base indisponible');
    expect(deckCards[0]!.scryfallId).toBe(OLD_PRINTING);
  });
});
