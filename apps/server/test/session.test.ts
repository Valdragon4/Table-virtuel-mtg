/**
 * Gestion de partie : relance, réserve, cosmétiques, départ d'un siège, taxe de
 * commandant, journal public.
 *
 * Trois de ces intents étaient déclarés dans le protocole et refusés par le
 * moteur ; ces tests sont là pour que le document cesse de mentir.
 */
import { describe, expect, it } from 'vitest';
import type { Event, ServerEvent } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { applyEvent, fromSnapshot, normalize } from './client-model.js';
import { auditInvariants } from './invariants.js';
import { fakeConnection, seatTable, twoSeatTable, type FakeConnection } from './fixture.js';

function eventsOf(conn: FakeConnection): ServerEvent[] {
  return conn.frames
    .map((f) => JSON.parse(f) as { t: string })
    .filter((m): m is ServerEvent => m.t === 'event');
}

function eventTypes(conn: FakeConnection): string[] {
  return eventsOf(conn).map((e) => e.event.type);
}

function lastReject(conn: FakeConnection): { code?: string } | undefined {
  return [...conn.received].reverse().find((m) => m.t === 'reject') as { code?: string } | undefined;
}

describe('journal public', () => {
  it('atteint tous les sièges, même quand l’event ne les concerne pas', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');

    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'play', {
      type: 'MOVE_CARD',
      cardId: hand,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
      faceDown: true,
    });
    b.frames.length = 0;

    await room.handleIntent(a, 'peek', { type: 'PEEK_FACE_DOWN', cardId: hand });

    // §6.1 : « seat_2 regarde une carte face cachée » est annoncé publiquement.
    const noted = eventsOf(b).filter((e) => e.event.type === 'NOTED');
    expect(noted).toHaveLength(1);
    expect(noted[0]!.log?.text).toContain('a regardé une carte face cachée');
    // Sans que rien de la carte ne transpire.
    expect(b.frames.join('\n')).not.toContain('"scryfallId"');
  });

  it('porte le même seq pour tous les sièges', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'play', {
      type: 'MOVE_CARD',
      cardId: hand,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
      faceDown: true,
    });
    a.frames.length = 0;
    b.frames.length = 0;

    await room.handleIntent(a, 'peek', { type: 'PEEK_FACE_DOWN', cardId: hand });

    // §5 : deux variantes du même fait partagent leur `seq`.
    const forA = eventsOf(a).map((e) => e.seq);
    const forB = eventsOf(b).map((e) => e.seq);
    expect(forB).toEqual(forA);
  });

  it('n’emploie plus PHASE_CHANGED comme prétexte', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    b.frames.length = 0;

    await room.handleIntent(a, 'untap', { type: 'UNTAP_ALL' });
    const card = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'rev', { type: 'REVEAL', cardIds: [card], toSeats: ['seat_1'] });

    // La phase n'a pas changé : aucun event ne doit le prétendre.
    expect(eventTypes(b)).not.toContain('PHASE_CHANGED');
    expect(eventTypes(b)).toContain('NOTED');
    expect(room.state.phase).toBe('MAIN1');
  });

  it('ne cite jamais un objet de bibliothèque dans ses ancres', async () => {
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

    // Alice engage une carte de sa bibliothèque : l'event lui est réservé, et le
    // journal qui l'accompagne ne doit pas en publier l'identifiant.
    await room.handleIntent(a, 'tap', { type: 'TAP', cardIds: [look.cardIds[0]!] });

    const joined = b.frames.join('\n');
    for (const id of look.cardIds) expect(joined).not.toContain(`"${id}"`);
    expect(eventTypes(b)).toContain('NOTED');
  });
});

describe('SET_SEAT_COSMETICS', () => {
  it('change le tapis et le dos de carte de son siège', async () => {
    const { room, a } = twoSeatTable();

    await room.handleIntent(a, 'cos', {
      type: 'SET_SEAT_COSMETICS',
      playmatUrl: 'https://example.org/tapis.jpg',
      cardBackUrl: 'https://example.org/dos.jpg',
    });

    expect(lastReject(a)).toBeUndefined();
    const summary = room.snapshotFor('seat_1').seats.find((s) => s.id === 'seat_0');
    expect(summary?.playmatUrl).toBe('https://example.org/tapis.jpg');
    expect(summary?.cardBackUrl).toBe('https://example.org/dos.jpg');
    expect(eventTypes(a)).toContain('SEAT_COSMETICS');
  });

  it('accepte de remettre à null, et ne touche pas au champ absent', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'c1', {
      type: 'SET_SEAT_COSMETICS',
      playmatUrl: 'https://example.org/tapis.jpg',
      cardBackUrl: 'https://example.org/dos.jpg',
    });
    await room.handleIntent(a, 'c2', { type: 'SET_SEAT_COSMETICS', playmatUrl: null });

    const seat = room.state.seats.get('seat_0')!;
    expect(seat.playmatUrl).toBeNull();
    expect(seat.cardBackUrl).toBe('https://example.org/dos.jpg');
  });

  it('ne touche que son propre siège', async () => {
    const { room, a, b } = twoSeatTable();
    await room.handleIntent(a, 'cos', { type: 'SET_SEAT_COSMETICS', playmatUrl: 'https://example.org/a.jpg' });

    expect(room.state.seats.get('seat_1')?.playmatUrl).toBeNull();
    void b;
  });
});

describe('SWAP_SIDEBOARD', () => {
  function tableWithSideboard() {
    const room = twoSeatTable().room;
    const conn = fakeConnection('conn-side');
    room.addConnection(conn);
    room.sitDown(conn, 2, 'Carol', null);
    room.loadDeck(
      'seat_2',
      {
        name: 'Deck Carol',
        cards: [
          ...Array.from({ length: 8 }, (_, i) => ({
            scryfallId: `id-main-${i}`,
            quantity: 1,
            zone: 'MAIN' as const,
            isFoil: false,
            name: `Main ${i}`,
            setCode: 'tst',
            collectorNumber: '1',
            typeLine: 'Test',
            manaCost: '{1}',
            colorIdentity: [],
            layout: 'normal',
            imageUris: {},
            faces: null,
          })),
          ...Array.from({ length: 3 }, (_, i) => ({
            scryfallId: `id-side-${i}`,
            quantity: 1,
            zone: 'SIDEBOARD' as const,
            isFoil: false,
            name: `Réserve ${i}`,
            setCode: 'tst',
            collectorNumber: '1',
            typeLine: 'Test',
            manaCost: '{1}',
            colorIdentity: [],
            layout: 'normal',
            imageUris: {},
            faces: null,
          })),
        ],
      },
      null,
    );
    conn.frames.length = 0;
    conn.received.length = 0;
    return { room, conn };
  }

  it('échange des cartes entre réserve et bibliothèque, puis remélange', async () => {
    const { room, conn } = tableWithSideboard();
    const side = getZone(room.state, { seat: 'seat_2', kind: 'SIDEBOARD' });
    const library = getZone(room.state, { seat: 'seat_2', kind: 'LIBRARY' });
    const entering = side[0]!;
    const leaving = library[0]!;

    await room.handleIntent(conn, 'swap', { type: 'SWAP_SIDEBOARD', in: [entering], out: [leaving] });

    expect(lastReject(conn)).toBeUndefined();
    expect(getZone(room.state, { seat: 'seat_2', kind: 'SIDEBOARD' })).toContain(leaving);
    expect(getZone(room.state, { seat: 'seat_2', kind: 'SIDEBOARD' })).toHaveLength(3);
    expect(getZone(room.state, { seat: 'seat_2', kind: 'LIBRARY' })).toHaveLength(8);
    // Le mélange a réattribué les identifiants : la carte entrée n'est plus
    // corrélable à celle que les autres sièges ont vue sortir.
    expect(room.state.objects.has(entering)).toBe(false);
    expect(eventTypes(conn)).toContain('ZONE_SHUFFLED');
    auditInvariants(room.state);
  });

  it('refuse en cours de partie', async () => {
    const { room, conn } = tableWithSideboard();
    room.startGame('seat_0');
    const side = getZone(room.state, { seat: 'seat_2', kind: 'SIDEBOARD' })[0]!;
    conn.received.length = 0;

    await room.handleIntent(conn, 'swap', { type: 'SWAP_SIDEBOARD', in: [side], out: [] });

    expect(lastReject(conn)).toMatchObject({ code: 'ERR_GAME_ALREADY_STARTED' });
  });

  it('refuse la réserve d’un autre siège', async () => {
    const { room, conn } = tableWithSideboard();
    const alien = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })[0]!;
    conn.received.length = 0;

    await room.handleIntent(conn, 'swap', { type: 'SWAP_SIDEBOARD', in: [], out: [alien] });

    expect(lastReject(conn)).toMatchObject({ code: 'ERR_NOT_YOURS' });
  });

  it('refuse une carte qui ne vient pas de la bonne zone', async () => {
    const { room, conn } = tableWithSideboard();
    const library = getZone(room.state, { seat: 'seat_2', kind: 'LIBRARY' })[0]!;
    conn.received.length = 0;

    // `in` doit venir de la réserve, pas de la bibliothèque.
    await room.handleIntent(conn, 'swap', { type: 'SWAP_SIDEBOARD', in: [library], out: [] });

    expect(lastReject(conn)).toMatchObject({ code: 'ERR_BAD_ZONE' });
  });
});

describe('RESTART_GAME', () => {
  it('rejoue avec les mêmes decks et remet les sièges à neuf', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');

    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'play', {
      type: 'MOVE_CARD',
      cardId: hand,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
    });
    const permanent = getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })[0]!;
    await room.handleIntent(a, 'tok', { type: 'CREATE_TOKEN', copyOf: permanent });
    await room.handleIntent(a, 'life', { type: 'ADJUST_LIFE', seat: 'seat_0', delta: -17 });
    await room.handleIntent(a, 'poison', { type: 'SET_PLAYER_COUNTER', seat: 'seat_0', kind: 'poison', value: 4 });
    await room.handleIntent(b, 'mill', { type: 'MILL', count: 3 });

    await room.handleIntent(a, 'restart', { type: 'RESTART_GAME', keepDecks: true });

    expect(lastReject(a)).toBeUndefined();
    expect(room.state.status).toBe('LOBBY');
    expect(room.state.turnNumber).toBe(0);
    expect(room.state.activeSeat).toBeNull();
    for (const seat of ['seat_0', 'seat_1']) {
      // 20 cartes de deck reviennent en bibliothèque, le commandant en zone de
      // commandement, et rien ailleurs.
      expect(getZone(room.state, { seat, kind: 'LIBRARY' })).toHaveLength(20);
      expect(getZone(room.state, { seat, kind: 'COMMAND' })).toHaveLength(1);
      expect(getZone(room.state, { seat, kind: 'HAND' })).toHaveLength(0);
      expect(getZone(room.state, { seat, kind: 'BATTLEFIELD' })).toHaveLength(0);
      expect(getZone(room.state, { seat, kind: 'GRAVEYARD' })).toHaveLength(0);
      const state = room.state.seats.get(seat)!;
      expect(state.life).toBe(40);
      expect(state.playerCounters.size).toBe(0);
      expect(state.deckName).not.toBeNull();
    }
    // Le jeton n'a pas survécu.
    expect([...room.state.objects.values()].some((o) => o.kind === 'TOKEN')).toBe(false);
    auditInvariants(room.state);

    // Et la table est immédiatement rejouable.
    room.startGame('seat_0');
    expect(getZone(room.state, { seat: 'seat_0', kind: 'HAND' })).toHaveLength(7);
    auditInvariants(room.state);
  });

  it('conserve un échange de réserve d’une manche à l’autre', async () => {
    const room = twoSeatTable().room;
    const conn = fakeConnection('conn-side');
    room.addConnection(conn);
    room.sitDown(conn, 2, 'Carol', null);
    room.loadDeck(
      'seat_2',
      {
        name: 'Deck Carol',
        cards: [
          {
            scryfallId: 'id-main-1',
            quantity: 6,
            zone: 'MAIN',
            isFoil: false,
            name: 'Main',
            setCode: 'tst',
            collectorNumber: '1',
            typeLine: 'Test',
            manaCost: '{1}',
            colorIdentity: [],
            layout: 'normal',
            imageUris: {},
            faces: null,
          },
          {
            scryfallId: 'id-side-1',
            quantity: 2,
            zone: 'SIDEBOARD',
            isFoil: false,
            name: 'Réserve',
            setCode: 'tst',
            collectorNumber: '1',
            typeLine: 'Test',
            manaCost: '{1}',
            colorIdentity: [],
            layout: 'normal',
            imageUris: {},
            faces: null,
          },
        ],
      },
      null,
    );

    const entering = getZone(room.state, { seat: 'seat_2', kind: 'SIDEBOARD' })[0]!;
    const leaving = getZone(room.state, { seat: 'seat_2', kind: 'LIBRARY' })[0]!;
    await room.handleIntent(conn, 'swap', { type: 'SWAP_SIDEBOARD', in: [entering], out: [leaving] });
    await room.handleIntent(conn, 'restart', { type: 'RESTART_GAME', keepDecks: true });

    // `origin` suit la carte : celle qui est passée en réserve y reste, celle qui
    // en est sortie reste dans le deck. Un sideboard ne se défait pas tout seul.
    expect(getZone(room.state, { seat: 'seat_2', kind: 'LIBRARY' })).toHaveLength(6);
    expect(getZone(room.state, { seat: 'seat_2', kind: 'SIDEBOARD' })).toHaveLength(2);
    auditInvariants(room.state);
  });

  it('vide la table quand keepDecks est faux', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    await room.handleIntent(a, 'restart', { type: 'RESTART_GAME', keepDecks: false });

    expect(room.state.objects.size).toBe(0);
    expect(room.state.seats.get('seat_0')?.deckName).toBeNull();
    for (const list of room.state.zones.values()) expect(list).toHaveLength(0);
    auditInvariants(room.state);
  });

  it('est réservé à l’hôte', async () => {
    const { room, b } = twoSeatTable();
    room.startGame('seat_0');
    b.received.length = 0;

    await room.handleIntent(b, 'restart', { type: 'RESTART_GAME', keepDecks: true });

    expect(lastReject(b)).toMatchObject({ code: 'ERR_NOT_YOURS' });
    expect(room.state.status).toBe('PLAYING');
  });

  it('laisse un client rattrapé par delta dans le même état qu’un snapshot', async () => {
    const { room, a, b } = twoSeatTable(5);
    room.startGame('seat_0');
    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'play', {
      type: 'MOVE_CARD',
      cardId: hand,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 2,
      y: 2,
    });

    const start = room.state.seq;
    const model = fromSnapshot(room.snapshotFor('seat_1'));
    await room.handleIntent(a, 'restart', { type: 'RESTART_GAME', keepDecks: true });

    const delta = room.deltaFor('seat_1', start);
    expect(delta).not.toBeNull();
    for (const frame of delta!) applyEvent(model, frame);
    expect(normalize(model)).toEqual(normalize(fromSnapshot(room.snapshotFor('seat_1'))));
    void b;
  });
});

describe('donner une carte a un adversaire', () => {
  it('lui en donne le controle, et il peut agir dessus', async () => {
    const { room, a, b } = seatTable(2);
    room.startGame('seat_0');

    const carte = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'don', {
      type: 'MOVE_CARD',
      cardId: carte,
      to: { seat: 'seat_1', kind: 'BATTLEFIELD' },
      x: 40,
      y: 40,
    });

    const obj = room.state.objects.get(carte)!;
    // Le proprietaire ne change pas : la carte lui reviendra en quittant le champ.
    expect(obj.owner).toBe('seat_0');
    // Le controleur, si : c'est le siege dont la zone la porte.
    expect(obj.controller).toBe('seat_1');

    /*
     * Le defaut signale : le destinataire voyait la carte sur son terrain sans
     * pouvoir la bouger ni l'engager. `assertMayTouch` la lui refusait.
     */
    const avant = room.state.seq;
    await room.handleIntent(b, 'engage', { type: 'TAP', cardIds: [carte] });
    expect(room.state.seq).toBeGreaterThan(avant);
    expect(room.state.objects.get(carte)!.tapped).toBe(true);
  });

  it('rend le controle au proprietaire quand elle quitte le champ', async () => {
    const { room, a, b } = seatTable(2);
    room.startGame('seat_0');
    const carte = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'don', {
      type: 'MOVE_CARD',
      cardId: carte,
      to: { seat: 'seat_1', kind: 'BATTLEFIELD' },
    });
    await room.handleIntent(b, 'cimetiere', {
      type: 'MOVE_CARD',
      cardId: carte,
      to: { seat: 'seat_0', kind: 'GRAVEYARD' },
    });
    const obj = room.state.objects.get(carte)!;
    expect(obj.owner).toBe('seat_0');
    expect(obj.controller).toBe('seat_0');
  });
});

describe('LOAD_DECK', () => {
  it('dit aux clients d’oublier le deck qu’il remplace', () => {
    const { room, a, b } = seatTable(2);
    const before = [...getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })];
    expect(before.length).toBeGreaterThan(0);

    b.received.length = 0;
    room.loadDeck(
      'seat_0',
      {
        name: 'Autre deck',
        cards: [{ scryfallId: '00000000-0000-4000-8000-000000000001', name: 'Autre carte', quantity: 3, zone: 'MAIN', isFoil: false, sortIndex: 0 }],
      } as never,
      null,
    );

    /*
     * L'état serveur était bien remis à neuf, mais rien ne l'annonçait : les
     * autres clients gardaient à l'écran le deck précédent, et l'on voyait
     * deux decks superposés.
     */
    const oubliees = new Set(
      b.received
        .filter((m) => m.t === 'event' && m.event.type === 'CARD_HIDDEN')
        .map((m) => (m as { event: { cardId: string } }).event.cardId),
    );
    for (const id of before) expect(oubliees.has(id)).toBe(true);
    void a;
  });
});

describe('STAND_UP', () => {
  it('est refusé en cours de partie sans confirmation explicite', () => {
    const { room, a } = seatTable(3);
    room.startGame('seat_0');

    // Sur une vraie table, on ne s'évapore pas avec ses permanents en jeu : on
    // peut partir, mais pas par accident.
    expect(() => room.standUp(a)).toThrowError(/Confirme/);
    expect(room.state.seats.has('seat_0')).toBe(true);
  });

  it('laisse partir en pleine partie quand le départ est confirmé', () => {
    const { room, a } = seatTable(3);
    room.startGame('seat_0');

    room.standUp(a, { force: true });
    expect(room.state.seats.has('seat_0')).toBe(false);
    expect(a.seatId).toBeNull();
    // Son matériel a quitté l'état : plus un objet ne lui appartient.
    expect([...room.state.objects.values()].some((o) => o.owner === 'seat_0')).toBe(false);
  });

  it('termine la partie quand le départ ne laisse qu’un joueur en lice', () => {
    const { room, a, b } = seatTable(2);
    room.startGame('seat_0');

    room.standUp(a, { force: true });
    expect(room.state.status).toBe('ENDED');
    void b;
  });

  it('une table close n’accepte plus rien, et l’on ne s’y rassoit pas', async () => {
    const { room, a, b } = seatTable(2);
    room.startGame('seat_0');
    room.closeRoom('seat_0');

    // Clore n'est pas annoncer : plus aucun intent ne passe.
    const before = room.state.seq;
    await room.handleIntent(b, 'apres-cloture', { type: 'DRAW', count: 1 });
    expect(room.state.seq).toBe(before);

    // Et la place ne se reprend pas.
    b.seatId = null;
    expect(() => room.sitDown(b, 1, 'Revenant', null)).toThrowError(/close/);
    void a;
  });

  it('laisse l’hôte clore la table, et lui seul', () => {
    const { room, b } = seatTable(2);
    room.startGame('seat_0');

    expect(() => room.closeRoom('seat_1')).toThrowError(/hôte/);
    expect(room.state.status).toBe('PLAYING');

    room.closeRoom('seat_0');
    expect(room.state.status).toBe('ENDED');
    void b;
  });

  it('emporte tout le matériel du siège une fois la partie concédée', async () => {
    const { room, a, b, seats } = seatTable(3);
    room.startGame('seat_0');

    const aliceCard = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    const bobCard = getZone(room.state, { seat: 'seat_1', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'p1', {
      type: 'MOVE_CARD',
      cardId: aliceCard,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
    });
    await room.handleIntent(b, 'p2', {
      type: 'MOVE_CARD',
      cardId: bobCard,
      to: { seat: 'seat_1', kind: 'BATTLEFIELD' },
      x: 2,
      y: 2,
    });
    await room.handleIntent(a, 'tok', { type: 'CREATE_TOKEN', copyOf: aliceCard });
    // L'équipement de Bob est posé sur le permanent d'Alice, qui va partir.
    await room.handleIntent(b, 'att', { type: 'ATTACH', sourceId: bobCard, targetId: aliceCard });
    await room.handleIntent(a, 'rh', { type: 'REVEAL_HAND', toSeats: ['seat_1'] });
    await room.handleIntent(b, 'rh2', { type: 'REVEAL_HAND', toSeats: ['seat_0'] });
    await room.handleIntent(a, 'dmg', {
      type: 'SET_COMMANDER_DAMAGE',
      from: 'seat_0',
      to: 'seat_1',
      commanderId: aliceCard,
      value: 3,
    });
    await room.handleIntent(a, 'label', { type: 'ADD_LABEL', text: 'à moi', x: 1, y: 1 });

    await room.handleIntent(a, 'concede', { type: 'CONCEDE' });
    room.standUp(a);

    expect(room.state.seats.has('seat_0')).toBe(false);
    expect([...room.state.objects.values()].filter((o) => o.owner === 'seat_0')).toHaveLength(0);
    for (const [key, list] of room.state.zones) {
      if (key.startsWith('seat_0|')) expect(list).toHaveLength(0);
    }
    // Plus aucune référence au partant nulle part.
    expect(room.state.objects.get(bobCard)?.attachedTo).toBeUndefined();
    expect([...room.state.objects.values()].some((o) => o.knownTo.has('seat_0'))).toBe(false);
    expect(room.state.seats.get('seat_1')?.handRevealedTo.has('seat_0')).toBe(false);
    expect(room.state.seats.get('seat_1')?.commanderDamage.has('seat_0')).toBe(false);
    expect([...room.state.labels.values()].some((l) => l.owner === 'seat_0')).toBe(false);
    expect(room.state.hostSeat).not.toBe('seat_0');
    auditInvariants(room.state);
    void seats;
  });

  it('laisse les clients restants dans le même état par delta et par snapshot', async () => {
    const { room, a, b } = seatTable(3, 17);
    room.startGame('seat_0');
    const aliceCard = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'p1', {
      type: 'MOVE_CARD',
      cardId: aliceCard,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
    });
    await room.handleIntent(a, 'tok', { type: 'CREATE_TOKEN', copyOf: aliceCard, count: 2 });
    await room.handleIntent(a, 'label', { type: 'ADD_LABEL', text: 'à moi', x: 1, y: 1 });

    const start = room.state.seq;
    const model = fromSnapshot(room.snapshotFor('seat_1'));
    await room.handleIntent(a, 'concede', { type: 'CONCEDE' });
    room.standUp(a);

    const delta = room.deltaFor('seat_1', start);
    expect(delta).not.toBeNull();
    for (const frame of delta!) applyEvent(model, frame);
    expect(normalize(model)).toEqual(normalize(fromSnapshot(room.snapshotFor('seat_1'))));
    void b;
  });

  it('libère le siège pour un nouvel arrivant, sans lui léguer le matériel', async () => {
    const { room, a } = seatTable(3);
    room.startGame('seat_0');
    await room.handleIntent(a, 'concede', { type: 'CONCEDE' });
    room.standUp(a);

    const nouveau = fakeConnection('conn-neuf');
    room.addConnection(nouveau);
    const seat = room.sitDown(nouveau, 0, 'Zoé', null);

    expect(seat.id).toBe('seat_0');
    expect(seat.deckName).toBeNull();
    expect(getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })).toHaveLength(0);
    expect(room.snapshotFor('seat_0').cards.filter((c) => c.zone.seat === 'seat_0')).toHaveLength(0);
    auditInvariants(room.state);
  });
});

describe('taxe de commandant', () => {
  it('s’incrémente quand le commandant part de la zone de commandement', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const commander = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;
    a.frames.length = 0;

    await room.handleIntent(a, 'cast', {
      type: 'MOVE_CARD',
      cardId: commander,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
    });

    expect(room.state.seats.get('seat_0')?.commanderTax.get(commander)).toBe(1);
    const taxEvent = eventsOf(a).find((e) => e.event.type === 'COMMANDER_TAX_CHANGED');
    expect(taxEvent?.event).toMatchObject({ seat: 'seat_0', commanderId: commander, casts: 1 });
    expect(room.snapshotFor('seat_1').seats.find((s) => s.id === 'seat_0')?.commanderTax[commander]).toBe(1);
  });

  it('compte chaque passage, pas chaque déplacement', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const commander = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;

    for (let i = 0; i < 3; i++) {
      await room.handleIntent(a, `cast-${i}`, {
        type: 'MOVE_CARD',
        cardId: commander,
        to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
        x: 1,
        y: 1,
      });
      // Un aller-retour sur le champ de bataille ne compte pas.
      await room.handleIntent(a, `move-${i}`, {
        type: 'MOVE_CARD',
        cardId: commander,
        to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
        x: 9,
        y: 9,
      });
      await room.handleIntent(a, `back-${i}`, {
        type: 'MOVE_CARD',
        cardId: commander,
        to: { seat: 'seat_0', kind: 'COMMAND' },
      });
    }

    expect(room.state.seats.get('seat_0')?.commanderTax.get(commander)).toBe(3);
  });

  it('se corrige à la main via SET_PLAYER_COUNTER', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const commander = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;
    await room.handleIntent(a, 'cast', {
      type: 'MOVE_CARD',
      cardId: commander,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
    });
    b.frames.length = 0;

    // §6.6 : « corrigible à la main via SET_PLAYER_COUNTER de kind commander_tax:<objectId> ».
    await room.handleIntent(b, 'fix', {
      type: 'SET_PLAYER_COUNTER',
      seat: 'seat_0',
      kind: `commander_tax:${commander}`,
      value: 5,
    });

    expect(room.state.seats.get('seat_0')?.commanderTax.get(commander)).toBe(5);
    // Et ce n'est pas devenu un compteur de joueur ordinaire.
    expect(room.state.seats.get('seat_0')?.playerCounters.has(`commander_tax:${commander}`)).toBe(false);
    const changed = eventsOf(b).find((e) => e.event.type === 'COMMANDER_TAX_CHANGED');
    expect((changed?.event as Extract<Event, { type: 'COMMANDER_TAX_CHANGED' }>).casts).toBe(5);
  });
});

describe('deltaFor et arrivée tardive', () => {
  it('sert un snapshot à un siège né après le seq demandé', () => {
    const { room } = twoSeatTable();
    const tard = fakeConnection('conn-tard');
    room.addConnection(tard);
    const seat = room.sitDown(tard, 3, 'Tardif', null);

    // Avant son arrivée, aucune variante n'a été construite pour lui : rejouer
    // le tampon lui donnerait un état amputé.
    expect(room.deltaFor(seat.id, seat.joinedAtSeq - 1)).toBeNull();
    expect(room.deltaFor(seat.id, seat.joinedAtSeq)).toEqual([]);
  });

  it('sert un snapshot à un siège inconnu', () => {
    const { room } = twoSeatTable();
    expect(room.deltaFor('seat_7', 0)).toBeNull();
  });
});
