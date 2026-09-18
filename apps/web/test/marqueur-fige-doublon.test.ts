/**
 * La scène exacte du rapport de bug : « pourquoi ça met +3/+3 et +2/+2 alors
 * que ça ne devait faire que +2/+2 ».
 *
 * Trois anges sur le champ de bataille, dont la carte porteuse. Un marqueur
 * figé « +X/+X — bonus global » comptant les anges du contrôleur, périmètre
 * « autres cartes uniquement », ajustement vide.
 *
 * Avant correction, la pose émettait **deux** `SET_COUNTER` : un « +1/+1 ×3 »
 * calculé avant l'exclusion (que la pastille cumule en « +3/+3 »), puis le
 * « +2/+2 » attendu. Le premier était une ligne oubliée au milieu de la boucle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardView } from '@mtg/shared';

/** La ligne de type de chaque carte de la scène, par identifiant Scryfall. */
const TYPE_LINES: Record<string, string> = {
  thrix: 'Legendary Creature — Angel',
  giada: 'Legendary Creature — Angel',
  sephara: 'Legendary Creature — Angel',
  liturgy: 'Creature — Human Cleric',
};

vi.mock('../src/lib/cards.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/cards.js')>();
  return {
    ...original,
    // Les fiches n'arrivent pas d'un serveur ici : sans elles, `measureCount`
    // ne saurait pas qu'une carte est un ange et compterait zéro.
    cardMeta: (id: string | undefined) =>
      id && TYPE_LINES[id] ? { id, name: id, typeLine: TYPE_LINES[id] } : undefined,
  };
});

const { frozenCount, frozenCounterIntents, parseOffset } = await import(
  '../src/components/CardSprite.js'
);

/** Un permanent du siège S1, identifié par sa fiche du lexique ci-dessus. */
function permanent(scryfallId: string): CardView {
  return {
    id: `c-${scryfallId}`,
    scryfallId,
    x: 0,
    y: 0,
    zone: { seat: 'S1', kind: 'BATTLEFIELD' },
    faceDown: false,
    controller: 'S1',
    counters: [],
    tapped: false,
  } as unknown as CardView;
}

type FakeState = Parameters<typeof frozenCount>[0];

let state: FakeState;
let thrix: CardView;

beforeEach(() => {
  thrix = permanent('thrix');
  const cards = [thrix, permanent('giada'), permanent('sephara'), permanent('liturgy')];
  state = {
    cards: new Map(cards.map((c) => [c.id as unknown as string, c])),
    seats: [{ id: 'S1', life: 40 }],
    zoneCounts: new Map(),
  } as unknown as FakeState;
});

describe('Marqueur figé « pour chaque autre ange »', () => {
  it('compte trois anges, en exclut la porteuse, et n’en garde que deux', () => {
    const count = frozenCount(state, thrix, {
      src: 'bat:angel',
      qui: 'vous',
      offset: 0,
      excludeOther: true,
    });
    expect(count).toEqual({ base: 2, final: 2 });
  });

  it('n’émet qu’un seul marqueur, et c’est +2/+2', () => {
    const intents = frozenCounterIntents(
      state,
      thrix,
      { src: 'bat:angel', qui: 'vous', offset: 0, excludeOther: true },
      'pt_add',
      'charge',
    );
    // Le cœur de la non-régression : un seul intent. Le doublon se voyait ici,
    // et nulle part ailleurs — deux `send` successifs ne laissent aucune trace.
    expect(intents).toEqual([{ kind: '+2/+2' }]);
  });

  it('sans exclusion, compte bien les trois anges', () => {
    const intents = frozenCounterIntents(
      state,
      thrix,
      { src: 'bat:angel', qui: 'vous', offset: 0, excludeOther: false },
      'pt_add',
      'charge',
    );
    expect(intents).toEqual([{ kind: '+3/+3' }]);
  });

  it('ne compte pas l’Humain Clerc parmi les anges', () => {
    const count = frozenCount(state, thrix, {
      src: 'bat:angel',
      qui: 'vous',
      offset: 0,
      excludeOther: false,
    });
    expect(count?.base).toBe(3);
  });

  it('les autres formes figées ne posent elles aussi qu’un marqueur', () => {
    const opts = { src: 'bat:angel', qui: 'vous' as const, offset: 0, excludeOther: true };
    expect(frozenCounterIntents(state, thrix, opts, 'pt_set', 'charge')).toEqual([{ kind: '2/2' }]);
    expect(frozenCounterIntents(state, thrix, opts, 'pt_counters', 'charge')).toEqual([
      { kind: '+1/+1', value: 2 },
    ]);
    expect(frozenCounterIntents(state, thrix, opts, 'named', 'charge')).toEqual([
      { kind: 'charge', value: 2 },
    ]);
  });

  it('un décompte nul ne pose rien du tout', () => {
    const intents = frozenCounterIntents(
      state,
      thrix,
      { src: 'bat:angel', qui: 'vous', offset: -2, excludeOther: true },
      'pt_add',
      'charge',
    );
    expect(intents).toEqual([]);
  });
});

describe('Ajustement (décalage de départ)', () => {
  it('un champ vide vaut 0, comme l’aide le promet', () => {
    expect(parseOffset('')).toBe(0);
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset('   ')).toBe(0);
    // Un texte qui n'est pas un nombre ne doit pas propager NaN dans le calcul.
    expect(parseOffset('abc')).toBe(0);
    expect(parseOffset('+')).toBe(0);
    expect(parseOffset('-')).toBe(0);
  });

  it('lit les décalages signés des boutons rapides', () => {
    expect(parseOffset('+2')).toBe(2);
    expect(parseOffset('-1')).toBe(-1);
    expect(parseOffset('0')).toBe(0);
  });

  it('applique le décalage après l’exclusion, et non avant', () => {
    const count = frozenCount(state, thrix, {
      src: 'bat:angel',
      qui: 'vous',
      offset: -1,
      excludeOther: true,
    });
    // 3 anges, moins la porteuse = 2, moins 1 de décalage = 1.
    expect(count).toEqual({ base: 2, final: 1 });
  });
});
