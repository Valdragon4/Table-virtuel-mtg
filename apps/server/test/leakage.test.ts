/**
 * Chasse aux fuites : on cherche activement les chemins par lesquels une
 * information cachée pourrait sortir vers un siège qui n'y a pas droit.
 *
 * Tous ces tests lisent les *frames* telles qu'elles partiraient sur le socket.
 * L'état interne n'y peut rien : seule compte la sérialisation.
 */
import { describe, expect, it } from 'vitest';
import { HIDDEN_VIEW_ALLOWED_KEYS } from '@mtg/shared';
import type { Event, PublicCardView } from '@mtg/shared';
import { applyIntent } from '../src/game/engine.js';
import { seededRandom } from '../src/game/random.js';
import { getZone } from '../src/game/state.js';
import { fakeConnection, seatTable, twoSeatTable } from './fixture.js';
import { auditInvariants } from './invariants.js';

function hiddenViewsIn(frames: string[]): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (obj['faceDown'] === true) found.push(obj);
      Object.values(obj).forEach(walk);
    }
  };
  for (const frame of frames) walk(JSON.parse(frame));
  return found;
}

function expectNoIds(frames: string[], ids: readonly string[]): void {
  const joined = frames.join('\n');
  for (const id of ids) expect(joined, `identifiant ${id} sorti`).not.toContain(`"${id}"`);
}

describe('RESOLVE_LOOK', () => {
  it('ne laisse rien filtrer de la bibliothèque vers l’autre siège', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    b.frames.length = 0;

    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 4,
      mode: 'SCRY',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    const secrets = look.cardIds.map((id) => room.state.objects.get(id)!.card.scryfallId);

    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [look.cardIds[0]!, look.cardIds[1]!],
      bottom: [look.cardIds[2]!],
      toGraveyard: [look.cardIds[3]!],
    });

    const bobFrames = b.frames.join('\n');
    // La carte envoyée au cimetière est publique : son identité a le droit de
    // sortir. Les trois autres, non.
    const buried = room.state.objects.get(look.cardIds[3]!)!.card.scryfallId;
    for (const secret of secrets) {
      if (secret === buried) continue;
      expect(bobFrames).not.toContain(`"${secret}"`);
    }
    // Et aucun identifiant resté en bibliothèque n'a été publié.
    expectNoIds(b.frames, getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }));
    auditInvariants(room.state);
  });

  it('purge la connaissance des cartes renvoyées au fond', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 3,
      mode: 'SCRY',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    const sunk = look.cardIds[2]!;

    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [look.cardIds[0]!, look.cardIds[1]!],
      bottom: [sunk],
    });

    expect(room.state.objects.get(sunk)?.knownTo.size).toBe(0);
  });
});

describe('SEARCH', () => {
  it('ne révèle pas l’ordre réel de la bibliothèque, même à son propriétaire', async () => {
    const { room, a } = twoSeatTable();
    const realOrder = [...getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })];
    a.frames.length = 0;

    await room.handleIntent(a, 'search', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 'ALL',
      mode: 'SEARCH',
    });

    const result = a.frames
      .map((f) => JSON.parse(f) as { t: string; event?: { type: string } })
      .find((m) => m.t === 'event' && m.event?.type === 'LOOK_RESULT') as
      | { event: Extract<Event, { type: 'LOOK_RESULT' }> }
      | undefined;
    expect(result).toBeDefined();

    const shown: PublicCardView[] = result!.event.cards;
    expect(shown.map((c) => c.id)).not.toEqual(realOrder);
    // Le `sortIndex` publié est le rang montré, pas le rang réel : sinon il
    // suffirait de le lire pour reconstituer l'ordre que le brassage masque.
    expect(shown.map((c) => c.sortIndex)).toEqual(shown.map((_, i) => i));
    const realIndex = new Map(realOrder.map((id, i) => [id, i]));
    expect(shown.some((c) => realIndex.get(c.id) !== c.sortIndex)).toBe(true);
  });

  it('cache aussi l’ordre réel dans le snapshot d’une consultation en cours', async () => {
    const { room, a } = twoSeatTable();
    const realOrder = [...getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })];
    await room.handleIntent(a, 'search', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 'ALL',
      mode: 'SEARCH',
    });

    const pending = room.snapshotFor('seat_0').pendingLook;
    expect(pending).toBeDefined();
    expect(pending!.cards.map((c) => c.id)).not.toEqual(realOrder);
    expect(pending!.cards.map((c) => c.sortIndex)).toEqual(pending!.cards.map((_, i) => i));
  });
});

describe('identifiants de bibliothèque', () => {
  it('ne sortent pas quand le propriétaire manipule une carte qu’il a vue', async () => {
    const { room, a, b } = twoSeatTable();
    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 2,
      mode: 'SCRY',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: look.cardIds,
      bottom: [],
    });

    b.frames.length = 0;
    // Alice connaît l'identifiant de la carte du dessus : elle l'engage. L'event
    // ne doit atteindre qu'elle, sinon Bob apprend un identifiant de bibliothèque.
    await room.handleIntent(a, 'tap', { type: 'TAP', cardIds: [look.cardIds[0]!] });

    expectNoIds(b.frames, look.cardIds);
    expect(b.frames.join('\n')).not.toContain('"scryfallId"');
  });

  it('ne sortent pas quand une carte de la main retourne en bibliothèque', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const card = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    b.frames.length = 0;

    await room.handleIntent(a, 'back', {
      type: 'MOVE_CARD',
      cardId: card,
      to: { seat: 'seat_0', kind: 'LIBRARY' },
      index: 'TOP',
    });

    // Bob apprend que la carte disparaît (et le nouveau compte), jamais qu'elle
    // se trouve à tel rang de la bibliothèque : pas de CARD_MOVED vers LIBRARY.
    const bobEvents = b.frames
      .map((f) => JSON.parse(f) as { t: string; event?: { type: string; card?: { zone?: { kind: string } } } })
      .filter((m) => m.t === 'event');
    expect(bobEvents.some((m) => m.event?.type === 'CARD_HIDDEN')).toBe(true);
    expect(
      bobEvents.some((m) => m.event?.type === 'CARD_MOVED' && m.event.card?.zone?.kind === 'LIBRARY'),
    ).toBe(false);
    expect(b.frames.join('\n')).not.toContain('"scryfallId"');
    auditInvariants(room.state);
  });

  it('sont tous réattribués par un mélange, sans rémanence', async () => {
    const { room, a } = twoSeatTable();
    const first = [...getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })];
    await room.handleIntent(a, 's1', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });
    const second = [...getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })];
    await room.handleIntent(a, 's2', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });
    const third = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' });

    expect(second).toHaveLength(first.length);
    expect(third).toHaveLength(first.length);
    expect(second.filter((id) => first.includes(id))).toHaveLength(0);
    expect(third.filter((id) => second.includes(id) || first.includes(id))).toHaveLength(0);
    // Et aucun ancien identifiant ne survit dans la table des objets.
    for (const id of [...first, ...second]) expect(room.state.objects.has(id)).toBe(false);
    auditInvariants(room.state);
  });
});

describe('traversée d’une zone cachée', () => {
  it('efface la connaissance acquise par révélation', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const card = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;

    await room.handleIntent(a, 'rev', { type: 'REVEAL', cardIds: [card], toSeats: ['seat_1'] });
    expect(room.state.objects.get(card)?.knownTo.has('seat_1')).toBe(true);

    // Retour en bibliothèque : le droit de regard tombe.
    await room.handleIntent(a, 'back', {
      type: 'MOVE_CARD',
      cardId: card,
      to: { seat: 'seat_0', kind: 'LIBRARY' },
      index: 'TOP',
    });
    expect(room.state.objects.get(card)?.knownTo.size).toBe(0);

    // Et la repiocher ne la rend connue que d'Alice.
    await room.handleIntent(a, 'draw', { type: 'DRAW', count: 1 });
    expect([...room.state.objects.get(card)!.knownTo]).toEqual(['seat_0']);
  });

  it('retire le droit de regard quand la main est démasquée', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });

    await room.handleIntent(a, 'rh', { type: 'REVEAL_HAND', toSeats: ['seat_1'] });
    expect(hand.every((id) => room.state.objects.get(id)!.knownTo.has('seat_1'))).toBe(true);
    // Une carte piochée pendant la révélation entre sous le même régime.
    await room.handleIntent(a, 'draw', { type: 'DRAW', count: 1 });
    const drawn = getZone(room.state, { seat: 'seat_0', kind: 'HAND' }).at(-1)!;
    expect(room.state.objects.get(drawn)!.knownTo.has('seat_1')).toBe(true);

    await room.handleIntent(a, 'uh', { type: 'UNREVEAL_HAND' });
    const after = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    expect(after.some((id) => room.state.objects.get(id)!.knownTo.has('seat_1'))).toBe(false);
  });
});

describe('révélation à des sièges nommés', () => {
  it('n’atteint pas les sièges absents de la liste', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const card = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    const secret = room.state.objects.get(card)!.card.scryfallId;
    b.frames.length = 0;

    // Révélation à elle-même seulement : rien ne doit atteindre Bob.
    await room.handleIntent(a, 'rev', { type: 'REVEAL', cardIds: [card], toSeats: ['seat_0'] });

    expect(b.frames.join('\n')).not.toContain(`"${secret}"`);
    expect(room.state.objects.get(card)?.knownTo.has('seat_1')).toBe(false);
  });

  it('atteint exactement les sièges listés', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const card = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    const secret = room.state.objects.get(card)!.card.scryfallId;
    b.frames.length = 0;

    await room.handleIntent(a, 'rev', { type: 'REVEAL', cardIds: [card], toSeats: ['seat_1'] });

    expect(b.frames.join('\n')).toContain(`"${secret}"`);
    // Et le journal public ne nomme pas la carte : il dit seulement qu'il y a
    // eu révélation, et à combien de joueurs.
    const log = room.state.log.at(-1)!;
    expect(log.text).not.toContain(room.state.objects.get(card)!.card.name);
    expect(log.text).toContain('1 carte(s) à 1 joueur(s)');
  });
});

describe('CREATE_TOKEN', () => {
  it('refuse de copier autre chose qu’un permanent du champ de bataille', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const inHand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    a.received.length = 0;

    await room.handleIntent(a, 'tok', { type: 'CREATE_TOKEN', copyOf: inHand });

    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_BAD_ZONE' });
  });

  it('refuse de copier un permanent face cachée d’un autre siège', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const card = getZone(room.state, { seat: 'seat_1', kind: 'HAND' })[0]!;
    await room.handleIntent(b, 'play', {
      type: 'MOVE_CARD',
      cardId: card,
      to: { seat: 'seat_1', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
      faceDown: true,
    });
    a.received.length = 0;

    await room.handleIntent(a, 'tok', { type: 'CREATE_TOKEN', copyOf: card });

    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_NOT_VISIBLE' });
  });
});

describe('MOVE_CARDS', () => {
  it('ne sert pas de porte dérobée vers la main d’un autre siège', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const bobCard = getZone(room.state, { seat: 'seat_1', kind: 'HAND' })[0]!;
    await room.handleIntent(b, 'play', {
      type: 'MOVE_CARD',
      cardId: bobCard,
      to: { seat: 'seat_1', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
    });
    a.received.length = 0;

    // Le permanent de Bob est public : Alice peut le toucher, pas se l'approprier.
    await room.handleIntent(a, 'steal', {
      type: 'MOVE_CARDS',
      cardIds: [bobCard],
      to: { seat: 'seat_0', kind: 'HAND' },
    });
    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_NOT_YOURS' });
    expect(room.state.objects.get(bobCard)?.zone.kind).toBe('BATTLEFIELD');

    // Et l'inverse : cacher sa propre carte dans la main d'un autre siège.
    const mine = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    a.received.length = 0;
    await room.handleIntent(a, 'plant', {
      type: 'MOVE_CARDS',
      cardIds: [mine],
      to: { seat: 'seat_1', kind: 'HAND' },
    });
    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_BAD_ZONE' });
    expect(room.state.objects.get(mine)?.zone.seat).toBe('seat_0');
    auditInvariants(room.state);
  });

  it('ne publie pas les identifiants d’un lot rangé en bibliothèque', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const cards = getZone(room.state, { seat: 'seat_0', kind: 'HAND' }).slice(0, 3);
    b.frames.length = 0;

    await room.handleIntent(a, 'bulk', {
      type: 'MOVE_CARDS',
      cardIds: cards,
      to: { seat: 'seat_0', kind: 'LIBRARY' },
      index: 'BOTTOM',
    });

    expect(b.frames.join('\n')).not.toContain('"scryfallId"');
    expect(b.frames.join('\n')).toContain('"CARD_HIDDEN"');
    auditInvariants(room.state);
  });
});

describe('SET_PRINTING', () => {
  it('n’émet rien vers les autres sièges pour une carte de bibliothèque', () => {
    const { room } = twoSeatTable();
    const card = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })[0]!;
    const obj = room.state.objects.get(card)!;

    const result = applyIntent(
      room.state,
      'seat_0',
      { type: 'SET_PRINTING', cardId: card, scryfallId: '00000000-0000-4000-8000-000000000000' },
      seededRandom(1),
      { cardData: { ...obj.card, setCode: 'aut' } },
    );

    // Une carte de bibliothèque n'existe pas pour les autres : son event non plus.
    for (const emission of result.emissions) {
      expect(emission.audience).toEqual({ kind: 'SEAT', seat: 'seat_0' });
    }
  });

  it('refuse de changer l’identité de la carte au passage', () => {
    const { room } = twoSeatTable();
    const card = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;
    const obj = room.state.objects.get(card)!;

    expect(() =>
      applyIntent(
        room.state,
        'seat_0',
        { type: 'SET_PRINTING', cardId: card, scryfallId: '00000000-0000-4000-8000-000000000000' },
        seededRandom(1),
        { cardData: { ...obj.card, name: 'Black Lotus' } },
      ),
    ).toThrowError(/autre carte/);
  });
});

describe('connexion sans siège', () => {
  it('ne reçoit aucun état de partie', () => {
    const { room } = twoSeatTable();
    room.startGame('seat_0');

    const snapshot = room.snapshotFor(null);
    expect(snapshot.cards).toEqual([]);
    expect(snapshot.zoneCounts).toEqual([]);
    expect(snapshot.labels).toEqual([]);
    expect(snapshot.logTail).toEqual([]);
    // Seuls la room et ses sièges sont visibles : de quoi choisir une place.
    expect(snapshot.seats).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toContain('"scryfallId"');
  });
});

describe('liste blanche des vues cachées', () => {
  it('tient sur une longue séquence mêlant toutes les zones', async () => {
    const { room, a, b } = twoSeatTable(99);
    room.startGame('seat_0');
    b.frames.length = 0;

    const hand = () => getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    await room.handleIntent(a, 'q1', { type: 'DRAW', count: 2 });
    await room.handleIntent(a, 'q2', {
      type: 'MOVE_CARD',
      cardId: hand()[0]!,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 3,
      y: 4,
      faceDown: true,
    });
    const facedown = getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })[0]!;
    await room.handleIntent(a, 'q3', { type: 'PEEK_FACE_DOWN', cardId: facedown });
    await room.handleIntent(a, 'q4', { type: 'ADD_COUNTER', targetId: facedown, kind: 'ambush', delta: 2 });
    await room.handleIntent(a, 'q5', { type: 'EXILE_TOP', count: 2, faceDown: true });
    await room.handleIntent(a, 'q6', {
      type: 'MOVE_CARD',
      cardId: hand()[0]!,
      to: { seat: 'seat_0', kind: 'FACEDOWN_TEMP' },
    });
    await room.handleIntent(a, 'q7', { type: 'MULLIGAN' });

    const views = hiddenViewsIn(b.frames);
    expect(views.length).toBeGreaterThan(5);
    for (const view of views) {
      for (const key of Object.keys(view)) {
        expect(HIDDEN_VIEW_ALLOWED_KEYS, `champ interdit « ${key} »`).toContain(key);
      }
    }
    // Et rien dans le flux de Bob ne cite une identité de carte d'Alice.
    expect(b.frames.join('\n')).not.toContain('"id-carte');
    auditInvariants(room.state);
  });
});

describe('sièges fantômes', () => {
  it('refuse une révélation à un siège qui n’est pas à la table', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const card = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    a.received.length = 0;

    await room.handleIntent(a, 'rev', { type: 'REVEAL', cardIds: [card], toSeats: ['seat_5'] });
    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_NOT_SEATED' });
    expect(room.state.objects.get(card)?.knownTo.has('seat_5')).toBe(false);

    a.received.length = 0;
    await room.handleIntent(a, 'rh', { type: 'REVEAL_HAND', toSeats: ['seat_5'] });
    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_NOT_SEATED' });
    expect(room.state.seats.get('seat_0')?.handRevealedTo.size).toBe(0);
  });

  it('ne lègue pas au successeur le droit de regard d’un siège parti', async () => {
    const { room, b, seats } = seatTable(3);
    const carol = seats[2]!;
    room.startGame('seat_0');

    // Bob montre sa main à Carol.
    await room.handleIntent(b, 'rh', { type: 'REVEAL_HAND', toSeats: ['seat_2'] });
    const bobHand = getZone(room.state, { seat: 'seat_1', kind: 'HAND' });
    expect(bobHand.every((id) => room.state.objects.get(id)!.knownTo.has('seat_2'))).toBe(true);

    // Carol s'en va par la porte prévue : concession, puis départ.
    await room.handleIntent(carol, 'concede', { type: 'CONCEDE' });
    room.standUp(carol);

    // Un nouveau joueur reprend l'index 2 : il n'hérite de rien.
    const neuf = fakeConnection('conn-neuf');
    room.addConnection(neuf);
    room.sitDown(neuf, 2, 'Zoé', null);

    expect(room.state.seats.get('seat_1')?.handRevealedTo.has('seat_2')).toBe(false);
    expect(bobHand.some((id) => room.state.objects.get(id)!.knownTo.has('seat_2'))).toBe(false);
    const forZoe = room
      .snapshotFor('seat_2')
      .cards.filter((c) => c.zone.seat === 'seat_1' && c.zone.kind === 'HAND');
    expect(forZoe.length).toBeGreaterThan(0);
    expect(forZoe.every((c) => c.faceDown === true)).toBe(true);
    auditInvariants(room.state);
  });
});

describe('carte posée face cachée', () => {
  it('prévient son propriétaire qu’elle est cachée aux autres', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    await room.handleIntent(a, 'play', {
      type: 'MOVE_CARD',
      cardId: hand[0]!,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 10,
      y: 10,
      faceDown: true,
    });
    const id = getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })[0]!;

    // Le propriétaire voit l'identité — et sait qu'elle est posée face cachée.
    const mine = room.snapshotFor('seat_0').cards.find((c) => c.id === id);
    expect(mine?.faceDown).toBe(false);
    expect((mine as { facedownOnTable?: boolean }).facedownOnTable).toBe(true);

    // L'adversaire ne voit qu'un dos, et rien de l'identité.
    const theirs = room.snapshotFor('seat_1').cards.find((c) => c.id === id);
    expect(theirs?.faceDown).toBe(true);
    expect(theirs).not.toHaveProperty('scryfallId');
  });

  it('ne marque pas une carte ordinaire', () => {
    const { room } = twoSeatTable();
    room.startGame('seat_0');

    const mine = room.snapshotFor('seat_0').cards.filter((c) => c.zone.kind === 'HAND');
    expect(mine.length).toBeGreaterThan(0);
    // Une carte en main est cachée aux autres par sa zone, pas posée face cachée.
    expect(mine.every((c) => (c as { facedownOnTable?: boolean }).facedownOnTable === undefined)).toBe(true);
  });
});
