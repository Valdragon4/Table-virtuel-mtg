/**
 * Éditeur de deck (D1).
 *
 * Deux propriétés, et ce sont elles qui empêchent l'éditeur de faire des dégâts :
 *  1. l'aller-retour texte est fidèle — un deck rendu en liste puis relu par le
 *     parseur redonne exactement les mêmes cartes, zones, éditions et foils ;
 *  2. la décision d'écriture est prise côté serveur — propriété du deck vérifiée
 *     depuis la session, et arbitrage explicite du cas « deck synchronisé ».
 *
 * La résolution Scryfall n'est pas rejouée ici : elle est déterministe à partir
 * de `(nom, édition, numéro)`, qui est exactement ce que l'aller-retour conserve.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckZone, ImportReport } from '@mtg/shared';
import { parseDeckText } from '../src/import/text.js';
import { renderDeckLine, renderDeckText, type DeckTextEntry } from '../src/decks/text-format.js';

// ---------------------------------------------------------------------------
// 1. Aller-retour texte
// ---------------------------------------------------------------------------

/** Ce que l'aller-retour doit conserver, carte par carte. */
function shape(entry: {
  name: string;
  setCode?: string | null;
  collectorNumber?: string | null;
  quantity: number;
  zone: DeckZone;
  isFoil: boolean;
}) {
  return {
    name: entry.name,
    setCode: entry.setCode?.toLowerCase() ?? undefined,
    collectorNumber: entry.collectorNumber ?? undefined,
    quantity: entry.quantity,
    zone: entry.zone,
    isFoil: entry.isFoil,
  };
}

const DECK: DeckTextEntry[] = [
  { name: 'Selenia, Dark Angel', setCode: 'wl', collectorNumber: '61', quantity: 1, zone: 'COMMANDER', isFoil: true },
  { name: 'Sol Ring', setCode: 'c21', collectorNumber: '263', quantity: 1, zone: 'MAIN', isFoil: false },
  { name: 'Arcane Signet', setCode: 'eld', collectorNumber: '331', quantity: 1, zone: 'MAIN', isFoil: true },
  { name: 'Swamp', setCode: 'unf', collectorNumber: '239', quantity: 12, zone: 'MAIN', isFoil: false },
  { name: 'Juzám Djinn', setCode: 'ard', collectorNumber: '39', quantity: 1, zone: 'MAIN', isFoil: false },
  { name: "Gaea's Cradle", setCode: 'usg', collectorNumber: '321', quantity: 1, zone: 'MAIN', isFoil: false },
  {
    name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
    setCode: 'neo',
    collectorNumber: '141',
    quantity: 4,
    zone: 'MAIN',
    isFoil: false,
  },
  { name: '1996 World Champion', setCode: 'pcel', collectorNumber: '1', quantity: 1, zone: 'MAIN', isFoil: false },
  { name: 'Black Lotus', setCode: 'lea', collectorNumber: '232', quantity: 1, zone: 'SIDEBOARD', isFoil: false },
  { name: 'Pithing Needle', setCode: 'sok', collectorNumber: '166', quantity: 2, zone: 'SIDEBOARD', isFoil: false },
];

describe('aller-retour deck → texte → deck', () => {
  it('rend chaque carte à l’identique : nom, édition, quantité, zone, foil', () => {
    const relu = parseDeckText(renderDeckText(DECK));

    expect(relu.unparsed).toEqual([]);
    expect(relu.lines.map(shape)).toEqual(DECK.map(shape));
  });

  it('conserve l’ordre des cartes à l’intérieur de chaque zone', () => {
    const relu = parseDeckText(renderDeckText(DECK));
    for (const zone of ['COMMANDER', 'MAIN', 'SIDEBOARD'] as const) {
      expect(relu.lines.filter((l) => l.zone === zone).map((l) => l.name)).toEqual(
        DECK.filter((e) => e.zone === zone).map((e) => e.name),
      );
    }
  });

  it('est stable : réexporter la liste relue redonne le même texte', () => {
    const once = renderDeckText(DECK);
    const twice = renderDeckText(
      parseDeckText(once).lines.map((l) => ({
        name: l.name,
        setCode: l.setCode ?? null,
        collectorNumber: l.collectorNumber ?? null,
        quantity: l.quantity,
        zone: l.zone,
        isFoil: l.isFoil,
      })),
    );
    expect(twice).toBe(once);
  });

  it('n’invente pas de section vide', () => {
    const text = renderDeckText([
      { name: 'Sol Ring', setCode: 'c21', collectorNumber: '263', quantity: 1, zone: 'MAIN', isFoil: false },
    ]);
    expect(text).toBe('Deck\n1 Sol Ring (C21) 263');
    expect(text).not.toMatch(/Sideboard|Commander/);
  });

  it('omet l’édition plutôt que de produire une ligne que le parseur relira de travers', () => {
    // Un numéro de collection hors des formes connues du parseur finirait collé
    // au nom de la carte : mieux vaut une ligne sans édition.
    const line = renderDeckLine({
      name: 'Sol Ring',
      setCode: 'c21',
      collectorNumber: 'Φ 263 bis',
      quantity: 1,
      zone: 'MAIN',
      isFoil: false,
    });
    expect(line).toBe('1 Sol Ring');
    expect(parseDeckText(line).lines[0]?.name).toBe('Sol Ring');
  });

  it('relit sans édition une carte importée sans édition', () => {
    const entries: DeckTextEntry[] = [
      { name: 'Sol Ring', quantity: 1, zone: 'MAIN', isFoil: false },
      { name: 'Lightning Bolt', setCode: null, collectorNumber: null, quantity: 3, zone: 'MAIN', isFoil: true },
    ];
    const relu = parseDeckText(renderDeckText(entries));
    expect(relu.lines.map(shape)).toEqual(entries.map(shape));
  });
});

// ---------------------------------------------------------------------------
// 2. Écriture : propriété du deck et decks synchronisés
// ---------------------------------------------------------------------------

interface FakeDeck {
  id: string;
  userId: string;
  name: string;
  format: string | null;
  source: string;
  sourceUrl: string | null;
  sourceDeckId: string | null;
  lastSyncedAt: Date | null;
}

const decks = new Map<string, FakeDeck>();
const persisted: Array<{ deckId?: string; userId: string; name?: string }> = [];

vi.mock('../src/db.js', () => ({
  prisma: {
    deck: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
        const deck = decks.get(where.id);
        // La propriété se vérifie en base, pas sur parole du client.
        return deck && deck.userId === where.userId ? deck : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeDeck> }) => {
        Object.assign(decks.get(where.id)!, data);
        return decks.get(where.id);
      },
    },
  },
}));

const emptyReport: ImportReport = {
  deckName: 'x',
  source: 'TEXT',
  cards: [],
  issues: [],
  stats: { linesRead: 1, cardsResolved: 1, cardsTotal: 1, issueCount: 0, editionFallbacks: 0 },
};

vi.mock('../src/decks/service.js', () => ({
  getDeck: async (id: string, userId: string) => {
    const deck = decks.get(id);
    return deck && deck.userId === userId ? { ...deck, cards: [] } : null;
  },
  runImport: async ({ name }: { name?: string }) => ({ report: { ...emptyReport, deckName: name ?? 'x' }, source: 'TEXT' }),
  persistImport: async (
    _outcome: unknown,
    options: { deckId?: string; userId: string; name?: string; preservePinnedPrintings?: boolean },
  ) => {
    persisted.push(options);
    const deck = decks.get(options.deckId!);
    if (deck) {
      deck.source = 'TEXT';
      deck.sourceUrl = null;
      deck.sourceDeckId = null;
    }
    return { deckId: options.deckId!, pinnedPrintingsKept: 0 };
  },
}));

const { DeckEditError, loadDeckForEdit, saveDeckFromText } = await import('../src/decks/edit.js');

const OWNER = 'user-owner';
const INTRUDER = 'user-intruder';

function seed(overrides: Partial<FakeDeck> = {}): FakeDeck {
  const deck: FakeDeck = {
    id: 'deck-1',
    userId: OWNER,
    name: 'Mon deck',
    format: 'commander',
    source: 'TEXT',
    sourceUrl: null,
    sourceDeckId: null,
    lastSyncedAt: null,
    ...overrides,
  };
  decks.set(deck.id, deck);
  return deck;
}

beforeEach(() => {
  decks.clear();
  persisted.length = 0;
});

describe('propriété du deck', () => {
  it('refuse d’ouvrir l’éditeur sur le deck d’autrui', async () => {
    seed();
    await expect(loadDeckForEdit('deck-1', INTRUDER)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuse d’enregistrer sur le deck d’autrui, et n’écrit rien', async () => {
    seed();
    await expect(saveDeckFromText('deck-1', INTRUDER, 'Deck\n1 Sol Ring')).rejects.toBeInstanceOf(DeckEditError);
    expect(persisted).toEqual([]);
    expect(decks.get('deck-1')?.name).toBe('Mon deck');
  });

  it('ne distingue pas « deck d’autrui » de « deck inexistant »', async () => {
    seed();
    await expect(loadDeckForEdit('deck-inconnu', OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(loadDeckForEdit('deck-1', INTRUDER)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('laisse le propriétaire enregistrer', async () => {
    seed();
    await saveDeckFromText('deck-1', OWNER, 'Deck\n1 Sol Ring');
    /*
     * `preservePinnedPrintings: false` fait partie du contrat de ce chemin : la
     * liste envoyée par l'éditeur porte les éditions en clair, c'est **elle**
     * qui décide des impressions. Y remettre une épingle rendrait impossible de
     * retirer une illustration choisie en partie.
     */
    expect(persisted).toEqual([
      { deckId: 'deck-1', userId: OWNER, name: 'Mon deck', preservePinnedPrintings: false },
    ]);
  });
});

describe('deck asservi à une source externe', () => {
  const synced: Partial<FakeDeck> = {
    source: 'ARCHIDEKT',
    sourceUrl: 'https://archidekt.com/decks/123/x',
    sourceDeckId: '123',
    lastSyncedAt: new Date('2026-09-01T00:00:00Z'),
  };

  it('refuse d’enregistrer sans détachement explicite', async () => {
    seed(synced);
    await expect(saveDeckFromText('deck-1', OWNER, 'Deck\n1 Sol Ring')).rejects.toMatchObject({
      code: 'SOURCE_SYNCED',
    });
    expect(persisted).toEqual([]);
    // Le deck reste intact et resynchronisable.
    expect(decks.get('deck-1')?.sourceUrl).toBe(synced.sourceUrl);
  });

  it('enregistre et détache quand le propriétaire l’a demandé', async () => {
    seed(synced);
    await saveDeckFromText('deck-1', OWNER, 'Deck\n1 Sol Ring', { detachFromSource: true });

    expect(persisted).toHaveLength(1);
    expect(decks.get('deck-1')).toMatchObject({
      source: 'MANUAL',
      sourceUrl: null,
      sourceDeckId: null,
      lastSyncedAt: null,
    });
  });

  it('marque MANUAL un deck non synchronisé qu’on vient d’éditer', async () => {
    seed();
    await saveDeckFromText('deck-1', OWNER, 'Deck\n1 Sol Ring');
    expect(decks.get('deck-1')).toMatchObject({ source: 'MANUAL', sourceUrl: null });
  });

  it('refuse une liste vide plutôt que de vider le deck', async () => {
    seed();
    await expect(saveDeckFromText('deck-1', OWNER, '   \n\n')).rejects.toMatchObject({ code: 'EMPTY' });
    expect(persisted).toEqual([]);
  });

  it('accepte de renommer le deck au passage', async () => {
    seed();
    await saveDeckFromText('deck-1', OWNER, 'Deck\n1 Sol Ring', { name: 'Nouveau nom' });
    expect(persisted[0]?.name).toBe('Nouveau nom');
  });
});
