/**
 * Monotonie de la connaissance : on n'oublie pas ce qu'on a vu.
 *
 * « Si une carte est révélée un jour, elle doit le rester peu importe la zone,
 * **sauf si elle repasse par la bibliothèque**. » C'est la règle de la vraie
 * table : un adversaire qui reprend en main une créature que vous avez regardée
 * ne vous fait pas oublier laquelle c'était.
 *
 * Avant, `relocate()` **recalculait** `knownTo` depuis la zone d'arrivée : la
 * carte rentrait en main, et le siège d'arrivée écrasait tout le monde. Chacun
 * des tests ci-dessous échouerait si l'on y revenait.
 *
 * L'unique effacement — l'entrée en bibliothèque — est vérifié juste après, avec
 * son corollaire : le mélange réattribue l'identifiant, et il ne reste donc rien
 * à quoi rattacher un souvenir.
 */
import { describe, expect, it } from 'vitest';
import { getZone } from '../src/game/state.js';
import { applyEvent, fromSnapshot, normalize } from './client-model.js';
import { auditInvariants } from './invariants.js';
import { twoSeatTable, type Table } from './fixture.js';

/** Bob voit-il l'identité de cette carte dans son snapshot ? */
function bobSees(room: Table['room'], cardId: string): boolean {
  const view = room.snapshotFor('seat_1').cards.find((c) => c.id === cardId);
  return view !== undefined && view.faceDown === false;
}

/** Alice montre à Bob la première carte de sa main, et rend son identifiant. */
async function shownToBob(table: Table): Promise<string> {
  const { room, a } = table;
  room.startGame('seat_0');
  const cardId = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
  await room.handleIntent(a, 'rev', { type: 'REVEAL', cardIds: [cardId], toSeats: ['seat_1'] });
  expect(bobSees(room, cardId)).toBe(true);
  return cardId;
}

const move = (room: Table['room'], a: Table['a'], cardId: string, kind: string, extra = {}) =>
  room.handleIntent(a, `mv-${kind}-${Math.random()}`, {
    type: 'MOVE_CARD',
    cardId,
    to: { seat: 'seat_0', kind },
    ...extra,
  } as never);

describe('la connaissance survit aux changements de zone', () => {
  it('main → champ → cimetière → main : Bob la connaît à chaque étape', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const cardId = await shownToBob(table);

    for (const kind of ['BATTLEFIELD', 'GRAVEYARD', 'HAND'] as const) {
      await move(room, a, cardId, kind, kind === 'BATTLEFIELD' ? { x: 10, y: 10 } : {});
      expect(room.state.objects.get(cardId)!.zone.kind).toBe(kind);
      // Le cœur de la règle : le retour en main n'efface rien.
      expect(room.state.objects.get(cardId)!.knownTo.has('seat_1')).toBe(true);
      expect(bobSees(room, cardId)).toBe(true);
    }
    auditInvariants(room.state);
  });

  it('… puis retour en bibliothèque : Bob ne la connaît plus, et le mélange change l’identifiant', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const cardId = await shownToBob(table);
    await move(room, a, cardId, 'BATTLEFIELD', { x: 10, y: 10 });
    await move(room, a, cardId, 'GRAVEYARD');
    expect(room.state.objects.get(cardId)!.knownTo.has('seat_1')).toBe(true);

    await move(room, a, cardId, 'LIBRARY', { index: 'TOP' });

    // L'unique effacement : plus personne, pas même Alice.
    expect([...room.state.objects.get(cardId)!.knownTo]).toEqual([]);
    expect(bobSees(room, cardId)).toBe(false);
    expect(room.snapshotFor('seat_1').cards.some((c) => c.id === cardId)).toBe(false);

    await room.handleIntent(a, 'sh', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });

    // Et l'identifiant meurt avec le mélange : il ne relie plus aucun « avant »
    // à aucun « après ». C'est ce qui rend l'oubli cohérent plutôt qu'arbitraire.
    expect(room.state.objects.has(cardId)).toBe(false);
    auditInvariants(room.state);
  });

  it('la réserve et la pile face cachée ne lessivent rien non plus', async () => {
    for (const kind of ['SIDEBOARD', 'FACEDOWN_TEMP'] as const) {
      const table = twoSeatTable();
      const { room, a } = table;
      const cardId = await shownToBob(table);

      await move(room, a, cardId, kind);

      expect(room.state.objects.get(cardId)!.zone.kind).toBe(kind);
      expect(room.state.objects.get(cardId)!.knownTo.has('seat_1')).toBe(true);
    }
  });

  it('exilée face cachée depuis la main, elle reste connue de qui l’avait vue', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const cardId = await shownToBob(table);

    await move(room, a, cardId, 'EXILE', { faceDown: true });

    const obj = room.state.objects.get(cardId)!;
    expect(obj.faceDown).toBe(true);
    // Retourner une carte ne la fait pas oublier : c'est exactement la vraie
    // table, où l'on a vu la carte *avant* qu'elle ne soit retournée.
    expect(obj.knownTo.has('seat_1')).toBe(true);
    expect(room.snapshotFor('seat_1').cards.find((c) => c.id === cardId)).toMatchObject({
      faceDown: false,
      facedownOnTable: true,
    });
  });

  it('mais une carte jamais vue reste secrète en passant face cachée', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const cardId = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[1]!;
    const secret = room.state.objects.get(cardId)!.card.scryfallId;
    b.frames.length = 0;

    await room.handleIntent(a, 'pose', {
      type: 'MOVE_CARD',
      cardId,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      faceDown: true,
      x: 5,
      y: 5,
    });

    // La monotonie n'ajoute rien à ce qui fuit : elle empêche d'oublier, elle ne
    // révèle pas.
    expect(room.state.objects.get(cardId)!.knownTo.has('seat_1')).toBe(false);
    expect(b.frames.join('\n')).not.toContain(`"${secret}"`);
  });

  it('TURN_FACE_DOWN ne reprend pas ce qu’un siège avait déjà vu', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const cardId = await shownToBob(table);
    await move(room, a, cardId, 'BATTLEFIELD', { x: 1, y: 1 });

    await room.handleIntent(a, 'fd', { type: 'TURN_FACE_DOWN', cardId });

    expect(room.state.objects.get(cardId)!.faceDown).toBe(true);
    expect(room.state.objects.get(cardId)!.knownTo.has('seat_1')).toBe(true);
  });

  it('le commandant renvoyé en zone de commandement reste public', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const commanderId = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;

    await move(room, a, commanderId, 'BATTLEFIELD', { x: 2, y: 2 });
    await move(room, a, commanderId, 'COMMAND');

    expect(room.state.objects.get(commanderId)!.knownTo.has('seat_1')).toBe(true);
    expect(bobSees(room, commanderId)).toBe(true);
  });
});

describe('ce qui doit encore purger la connaissance', () => {
  it('un siège qui se lève ne laisse aucune trace dans les `knownTo`', async () => {
    const table = twoSeatTable();
    const { room, b } = table;
    const cardId = await shownToBob(table);
    expect(room.state.objects.get(cardId)!.knownTo.has('seat_1')).toBe(true);

    await room.handleIntent(b, 'cc', { type: 'CONCEDE' });
    room.standUp(b);

    for (const obj of room.state.objects.values()) {
      expect(obj.knownTo.has('seat_1')).toBe(false);
    }
    auditInvariants(room.state);
  });

  it('une partie relancée repart d’une table sans mémoire', async () => {
    const table = twoSeatTable();
    const { room } = table;
    await shownToBob(table);

    room.restartGame('seat_0', true);

    for (const obj of room.state.objects.values()) {
      // Le commandant excepté : il est public par nature, pas par mémoire.
      if (obj.zone.kind === 'COMMAND') continue;
      expect(obj.knownTo.has('seat_1')).toBe(false);
    }
  });

  it('démasquer sa main reprend ce que la révélation avait donné, et rien d’autre', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const shown = await shownToBob(table);
    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    const other = hand.find((id) => id !== shown)!;

    await room.handleIntent(a, 'rh', { type: 'REVEAL_HAND', toSeats: ['seat_1'] });
    expect(room.state.objects.get(other)!.knownTo.has('seat_1')).toBe(true);

    await room.handleIntent(a, 'uh', { type: 'UNREVEAL_HAND' });

    // Le droit continu se reprend — sinon « masquer sa main » ne ferait rien —,
    // mais seulement sur son propre dépôt : la carte montrée séparément par
    // `REVEAL` reste connue, la monotonie la protège.
    expect(room.state.objects.get(other)!.knownTo.has('seat_1')).toBe(false);
    expect(room.state.objects.get(shown)!.knownTo.has('seat_1')).toBe(true);
    auditInvariants(room.state);
  });
});

describe('équivalence snapshot / delta sous la monotonie', () => {
  it('donne le même état par les deux chemins sur toute la traversée', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const cardId = await shownToBob(table);

    const base = fromSnapshot(room.snapshotFor('seat_1'));
    const from = room.state.seq;

    await move(room, a, cardId, 'BATTLEFIELD', { x: 10, y: 10 });
    await move(room, a, cardId, 'GRAVEYARD');
    await move(room, a, cardId, 'HAND');
    await room.handleIntent(a, 'fd2', { type: 'REVEAL', cardIds: [cardId], toSeats: ['seat_1'] });
    await move(room, a, cardId, 'EXILE', { faceDown: true });
    await move(room, a, cardId, 'LIBRARY', { index: 'BOTTOM' });

    for (const frame of room.deltaFor('seat_1', from) ?? []) applyEvent(base, frame);
    expect(normalize(base)).toEqual(normalize(fromSnapshot(room.snapshotFor('seat_1'))));
    // Et au bout de la chaîne, la bibliothèque a bien tout effacé.
    expect(base.cards.has(cardId)).toBe(false);
  });
});
