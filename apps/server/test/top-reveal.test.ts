/**
 * Révélation permanente du dessus de la bibliothèque (*Experimental Frenzy*).
 *
 * Ce que ces tests tiennent, dans l'ordre : la révélation s'active, le dessus
 * **suit** les mutations de la bibliothèque (pioche, meule, mélange), elle
 * s'arrête proprement — et surtout, un siège qui n'est pas destinataire
 * n'apprend jamais ni l'identité ni l'identifiant de la carte révélée. Ce
 * dernier point est vérifié sur les **frames brutes**, comme la §12.2 : c'est
 * la seule façon de prendre une fuite sur le fait.
 */
import { describe, expect, it } from 'vitest';
import type { Event, PublicCardView, SeatId, ServerEvent } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { applyEvent, fromSnapshot, normalize } from './client-model.js';
import { seatTable, twoSeatTable, type FakeConnection } from './fixture.js';

/** Les `TOP_REVEALED` reçus par une connexion, dans l'ordre. */
function topEvents(conn: FakeConnection): Array<Extract<Event, { type: 'TOP_REVEALED' }>> {
  return conn.received
    .filter((m): m is ServerEvent => m.t === 'event')
    .map((m) => m.event)
    .filter((e): e is Extract<Event, { type: 'TOP_REVEALED' }> => e.type === 'TOP_REVEALED');
}

/** Le dernier dessus effectivement montré à cette connexion. */
function lastCard(conn: FakeConnection): PublicCardView | null {
  const events = topEvents(conn);
  return events.length > 0 ? (events[events.length - 1]!.card ?? null) : null;
}

function cardHiddenIds(conn: FakeConnection): string[] {
  return conn.received
    .filter((m): m is ServerEvent => m.t === 'event')
    .map((m) => m.event)
    .filter((e): e is Extract<Event, { type: 'CARD_HIDDEN' }> => e.type === 'CARD_HIDDEN')
    .map((e) => e.cardId);
}

function topOfLibrary(room: { state: Parameters<typeof getZone>[0] }, seat: SeatId): string {
  return getZone(room.state, { seat, kind: 'LIBRARY' })[0]!;
}

describe('révélation permanente du dessus de la bibliothèque', () => {
  it('publie le dessus dès l’activation, au seul destinataire', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    a.received.length = 0;
    b.received.length = 0;

    void room.handleIntent(a, 'c1', { type: 'REVEAL_TOP', toSeats: ['seat_1'] });

    const top = topOfLibrary(room, 'seat_0');
    const seen = lastCard(b);
    expect(seen).not.toBeNull();
    expect(seen!.id).toBe(top);
    expect(seen!.scryfallId).toBe(room.state.objects.get(top)!.card.scryfallId);

    // Alice n'est pas destinataire : elle apprend le fait, pas la carte. Une
    // révélation « aux autres seulement » est un geste légitime, et le serveur
    // ne doit pas lui offrir au passage la connaissance de son propre dessus.
    const forAlice = topEvents(a);
    expect(forAlice).toHaveLength(1);
    expect(forAlice[0]!.card).toBeNull();
    expect(forAlice[0]!.toSeats).toEqual(['seat_1']);
  });

  it('se révèle à soi-même, sans rien apprendre aux autres', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    a.received.length = 0;
    b.frames.length = 0;
    b.received.length = 0;

    void room.handleIntent(a, 'c1', { type: 'REVEAL_TOP', toSeats: ['seat_0'] });

    const top = topOfLibrary(room, 'seat_0');
    expect(lastCard(a)!.id).toBe(top);
    expect(lastCard(b)).toBeNull();
    expect(b.frames.join('\n')).not.toContain(`"${top}"`);
  });

  it('suit le dessus à chaque pioche', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    void room.handleIntent(a, 'c1', { type: 'REVEAL_TOP', toSeats: ['seat_1'] });

    const first = lastCard(b)!;
    expect(first.id).toBe(topOfLibrary(room, 'seat_0'));

    void room.handleIntent(a, 'c2', { type: 'DRAW', count: 1 });
    const second = lastCard(b)!;
    expect(second.id).not.toBe(first.id);
    expect(second.id).toBe(topOfLibrary(room, 'seat_0'));

    void room.handleIntent(a, 'c3', { type: 'DRAW', count: 1 });
    expect(lastCard(b)!.id).toBe(topOfLibrary(room, 'seat_0'));

    // La carte piochée est partie en main, et **Bob continue de la connaître** :
    // il l'a vue de ses yeux sur le dessus, et la monotonie de `knownTo` veut
    // qu'un changement de zone n'efface rien. Seul le retour en bibliothèque le
    // ferait. C'est l'inverse de ce que faisait la première version, qui
    // recalculait `knownTo` à l'entrée en main.
    expect(room.state.objects.get(first.id)!.zone.kind).toBe('HAND');
    expect(room.state.objects.get(first.id)!.knownTo.has('seat_1')).toBe(true);
  });

  it('suit le dessus après une meule', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    void room.handleIntent(a, 'c1', { type: 'REVEAL_TOP', toSeats: ['seat_1'] });
    const before = lastCard(b)!;

    void room.handleIntent(a, 'c2', { type: 'MILL', count: 2 });

    const after = lastCard(b)!;
    expect(after.id).toBe(topOfLibrary(room, 'seat_0'));
    expect(after.id).not.toBe(before.id);
  });

  it('repart d’un identifiant neuf après un mélange, sans laisser de corrélation', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    void room.handleIntent(a, 'c1', { type: 'REVEAL_TOP', toSeats: ['seat_1'] });
    const before = lastCard(b)!;

    void room.handleIntent(a, 'c2', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });

    // §2.1 : le mélange réattribue tous les identifiants de la zone. Celui que
    // Bob connaissait n'existe plus nulle part — il ne relie donc aucun
    // « avant » à aucun « après », et le canal de corrélation reste fermé.
    expect(room.state.objects.has(before.id)).toBe(false);
    expect(getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })).not.toContain(before.id);
    // Et on le lui fait explicitement oublier.
    expect(cardHiddenIds(b)).toContain(before.id);

    const after = lastCard(b)!;
    expect(after.id).toBe(topOfLibrary(room, 'seat_0'));
    expect(after.id).not.toBe(before.id);
  });

  it('fait oublier la carte quand la révélation s’arrête', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    void room.handleIntent(a, 'c1', { type: 'REVEAL_TOP', toSeats: ['seat_1'] });
    const shown = lastCard(b)!;
    b.received.length = 0;

    void room.handleIntent(a, 'c2', { type: 'REVEAL_TOP', toSeats: [] });

    expect(cardHiddenIds(b)).toContain(shown.id);
    const last = topEvents(b).at(-1)!;
    expect(last.toSeats).toEqual([]);
    expect(last.card).toBeNull();
    // Le droit est rendu, pas seulement masqué à l'écran.
    expect(room.state.objects.get(shown.id)!.knownTo.has('seat_1')).toBe(false);
    expect(room.state.seats.get('seat_0')!.topRevealedTo.size).toBe(0);

    // Et le dessus continue de changer sans que Bob n'en sache plus rien.
    b.frames.length = 0;
    void room.handleIntent(a, 'c3', { type: 'DRAW', count: 1 });
    const top = topOfLibrary(room, 'seat_0');
    expect(b.frames.join('\n')).not.toContain(`"${top}"`);
  });

  it('n’envoie jamais rien de la carte à un siège non destinataire', () => {
    const { room, seats } = seatTable(3);
    const [alice, bob, carol] = seats as [FakeConnection, FakeConnection, FakeConnection];
    room.startGame('seat_0');

    void room.handleIntent(alice, 'c1', { type: 'REVEAL_TOP', toSeats: ['seat_1'] });
    carol.frames.length = 0;
    carol.received.length = 0;

    /*
     * Après chaque geste, la carte que Bob voit sur le dessus est mesurée
     * **pendant qu'elle y est** : ni son identifiant ni son identité ne doivent
     * avoir atteint Carol. Le contrôle a lieu à cet instant, et non à la fin :
     * une fois piochée, la carte entre dans une zone énumérable et son
     * identifiant devient légitimement public — c'est le déplacement qui le
     * publie, pas la révélation.
     */
    let seen = 0;
    const check = (): void => {
      const card = lastCard(bob);
      if (!card) return;
      seen += 1;
      expect(room.state.objects.get(card.id)?.zone.kind).toBe('LIBRARY');
      const frames = carol.frames.join('\n');
      expect(frames).not.toContain(`"${card.id}"`);
      expect(frames).not.toContain(`"${card.scryfallId}"`);
    };
    check();
    for (const intent of [
      { type: 'DRAW', count: 1 },
      { type: 'MILL', count: 1 },
      { type: 'DRAW', count: 2 },
      { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } },
      { type: 'DRAW', count: 1 },
    ] as const) {
      void room.handleIntent(alice, `x-${seen}`, intent);
      check();
    }
    expect(seen).toBeGreaterThan(4);

    // Carol ne reçoit que le fait, jamais la carte.
    for (const event of topEvents(carol)) expect(event.card).toBeNull();
  });

  it('donne le même état par snapshot et par delta', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    void room.handleIntent(a, 'c0', { type: 'REVEAL_TOP', toSeats: ['seat_1'] });

    const base = fromSnapshot(room.snapshotFor('seat_1'));
    const from = room.state.seq;

    void room.handleIntent(a, 'c1', { type: 'DRAW', count: 2 });
    void room.handleIntent(a, 'c2', { type: 'MILL', count: 1 });
    void room.handleIntent(a, 'c3', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });
    void room.handleIntent(a, 'c4', { type: 'REVEAL_TOP', toSeats: ['seat_1', 'seat_0'] });
    void room.handleIntent(a, 'c5', { type: 'DRAW', count: 1 });

    for (const frame of room.deltaFor('seat_1', from) ?? []) applyEvent(base, frame);
    expect(normalize(base)).toEqual(normalize(fromSnapshot(room.snapshotFor('seat_1'))));
    expect(base.topReveals.get('seat_0')?.cardId).toBe(topOfLibrary(room, 'seat_0'));
    void b;
  });

  it('ne laisse aucun destinataire fantôme derrière un joueur qui se lève', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    void room.handleIntent(a, 'c1', { type: 'REVEAL_TOP', toSeats: ['seat_1'] });
    expect(lastCard(b)).not.toBeNull();

    room.standUp(b, { force: true });

    expect(room.state.seats.get('seat_0')!.topRevealedTo.size).toBe(0);
    for (const obj of room.state.objects.values()) {
      expect(obj.knownTo.has('seat_1')).toBe(false);
    }
  });

  it('refuse un destinataire qui n’est pas à la table', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    a.received.length = 0;
    await room.handleIntent(a, 'c1', { type: 'REVEAL_TOP', toSeats: ['seat_3'] });
    expect(a.received.some((m) => m.t === 'reject' && m.code === 'ERR_NOT_SEATED')).toBe(true);
  });
});
