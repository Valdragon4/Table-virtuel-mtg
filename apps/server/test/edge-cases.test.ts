/**
 * Cas limites du moteur : bibliothèque vide, consultations, sièges qui vont et
 * viennent, annulation. Chaque test correspond à un chemin qui s'est révélé
 * fragile ou qui doit le rester sous surveillance.
 */
import { describe, expect, it } from 'vitest';
import { getZone } from '../src/game/state.js';
import { LIMITS } from '@mtg/shared';
import { auditInvariants } from './invariants.js';
import { deck, fakeConnection, twoSeatTable } from './fixture.js';

function lastReject(conn: { received: Array<{ t: string }> }): { code?: string } | undefined {
  return [...conn.received].reverse().find((m) => m.t === 'reject') as { code?: string } | undefined;
}

async function emptyLibrary(room: { state: unknown }, seat: string): Promise<void> {
  const state = room.state as Parameters<typeof getZone>[0];
  getZone(state, { seat, kind: 'LIBRARY' }).length = 0;
  for (const [id, obj] of state.objects) {
    if (obj.owner === seat && obj.zone.kind === 'LIBRARY') state.objects.delete(id);
  }
}

describe('audit des invariants', () => {
  it('détecte réellement un état incohérent', () => {
    const { room } = twoSeatTable();
    auditInvariants(room.state);

    // Un identifiant fantôme injecté dans une zone doit faire échouer l'audit.
    getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' }).push('objet-inexistant');
    expect(() => auditInvariants(room.state)).toThrow(/fantôme/);
  });

  it('détecte un sortIndex qui ne suit plus le rang', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'm', { type: 'MILL', count: 3 });
    auditInvariants(room.state);

    const id = getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' })[1]!;
    room.state.objects.get(id)!.sortIndex = 42;
    expect(() => auditInvariants(room.state)).toThrow(/sortIndex/);
  });
});

describe('bibliothèque vide', () => {
  it('refuse DRAW, MILL, EXILE_TOP et LOOK plutôt que de ne rien faire', async () => {
    const { room, a } = twoSeatTable();
    await emptyLibrary(room, 'seat_0');

    for (const intent of [
      { type: 'DRAW', count: 1 },
      { type: 'MILL', count: 1 },
      { type: 'EXILE_TOP', count: 1 },
      { type: 'LOOK', zone: { seat: 'seat_0', kind: 'LIBRARY' }, count: 1, mode: 'SCRY' },
    ] as const) {
      a.received.length = 0;
      await room.handleIntent(a, `e-${intent.type}`, intent);
      expect(lastReject(a), intent.type).toMatchObject({ code: 'ERR_BAD_ZONE' });
    }
    // Aucune session de consultation fantôme n'a été ouverte au passage.
    expect(room.state.pendingLooks.size).toBe(0);
    auditInvariants(room.state);
  });
});

describe('MULLIGAN', () => {
  it('ne rappelle que la main, laisse le reste en place', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    await room.handleIntent(a, 'play', {
      type: 'MOVE_CARD',
      cardId: hand[0]!,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 1,
      y: 1,
    });
    await room.handleIntent(a, 'mill', { type: 'MILL', count: 2 });

    await room.handleIntent(a, 'mull', { type: 'MULLIGAN' });

    expect(getZone(room.state, { seat: 'seat_0', kind: 'HAND' })).toHaveLength(7);
    // Le permanent et le cimetière ne bougent pas : un mulligan ne range pas la table.
    expect(getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })).toHaveLength(1);
    expect(getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' })).toHaveLength(2);
    // 20 cartes : 1 en jeu, 2 au cimetière, 7 en main, 10 en bibliothèque.
    expect(getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })).toHaveLength(10);
    auditInvariants(room.state);
  });

  it('annonce le bon nombre de cartes mélangées', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    a.frames.length = 0;

    await room.handleIntent(a, 'mull', { type: 'MULLIGAN' });

    const shuffled = a.frames
      .map((f) => JSON.parse(f) as { t: string; event?: { type: string; count?: number } })
      .find((m) => m.t === 'event' && m.event?.type === 'ZONE_SHUFFLED');
    // 20 cartes en tout : le mélange porte sur les 20, pas sur les 13 restantes
    // une fois la nouvelle main piochée.
    expect(shuffled?.event?.count).toBe(20);
  });
});

describe('SCOOP', () => {
  it('détache les attachements adverses et détruit les jetons', async () => {
    const { room, a, b } = twoSeatTable();
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
    const alicePermanent = getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })[0]!;
    const bobPermanent = getZone(room.state, { seat: 'seat_1', kind: 'BATTLEFIELD' })[0]!;
    await room.handleIntent(a, 'tok', { type: 'CREATE_TOKEN', copyOf: alicePermanent });
    // L'équipement de Bob est posé sur le permanent d'Alice.
    await room.handleIntent(b, 'att', { type: 'ATTACH', sourceId: bobPermanent, targetId: alicePermanent });
    expect(room.state.objects.get(bobPermanent)?.attachedTo).toBe(alicePermanent);

    await room.handleIntent(a, 'scoop', { type: 'SCOOP' });

    // Plus de référence vers un objet parti en bibliothèque ou effacé.
    expect(room.state.objects.get(bobPermanent)?.attachedTo).toBeUndefined();
    expect(getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })).toHaveLength(0);
    auditInvariants(room.state);
  });
});

describe('attachement et repositionnement', () => {
  /*
   * Le client déplace une sélection au lasso en envoyant un `MOVE_CARD` par
   * carte, y compris pour celle qui est attachée. Il ne le peut que si
   * repositionner une carte **dans le champ de bataille** laisse `attachedTo`
   * intact : sans cette garantie, déplacer un permanent et son aura d'un seul
   * geste les séparerait. On l'épingle ici, parce que c'est une propriété du
   * serveur dont dépend un geste du client.
   */
  it('repositionner sur le champ de bataille ne défait pas l’attachement', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    const main = getZone(room.state, { seat: 'seat_0', kind: 'HAND' }).slice(0, 2);
    const [porteur, aura] = main as [string, string];
    await room.handleIntent(a, 'p1', {
      type: 'MOVE_CARD',
      cardId: porteur,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 100,
      y: 100,
    });
    await room.handleIntent(a, 'p2', {
      type: 'MOVE_CARD',
      cardId: aura,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 300,
      y: 300,
    });
    await room.handleIntent(a, 'att', { type: 'ATTACH', sourceId: aura, targetId: porteur });
    expect(room.state.objects.get(aura)?.attachedTo).toBe(porteur);

    // La même translation pour les deux, exactement ce qu'envoie un dépôt de
    // sélection multiple sur le champ de bataille.
    await room.handleIntent(a, 'm1', {
      type: 'MOVE_CARD',
      cardId: porteur,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 160,
      y: 140,
    });
    await room.handleIntent(a, 'm2', {
      type: 'MOVE_CARD',
      cardId: aura,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 360,
      y: 340,
    });

    expect(room.state.objects.get(aura)?.attachedTo).toBe(porteur);
    expect(room.state.objects.get(porteur)?.x).toBe(160);
    expect(room.state.objects.get(aura)?.x).toBe(360);

    // Et quitter le champ de bataille, lui, défait bien le lien.
    await room.handleIntent(a, 'g', {
      type: 'MOVE_CARD',
      cardId: porteur,
      to: { seat: 'seat_0', kind: 'GRAVEYARD' },
    });
    expect(room.state.objects.get(aura)?.attachedTo).toBeUndefined();
    auditInvariants(room.state);
  });
});

describe('consultation', () => {
  it('refuse une résolution portant sur une carte hors session', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 2,
      mode: 'SCRY',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    const outsider = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).at(-1)!;

    a.received.length = 0;
    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [outsider],
      bottom: [],
    });

    expect(lastReject(a)).toMatchObject({ code: 'ERR_UNKNOWN_OBJECT' });
    // Rien n'a bougé : la session reste ouverte, la carte reste où elle est.
    expect(room.state.pendingLooks.size).toBe(1);
    auditInvariants(room.state);
  });

  it('accepte une résolution partielle sans perdre de carte', async () => {
    const { room, a } = twoSeatTable();
    const before = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).length;
    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 4,
      mode: 'SCRY',
    });
    const look = [...room.state.pendingLooks.values()][0]!;

    // Deux cartes seulement sont placées : les deux autres restent en place.
    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [look.cardIds[0]!],
      bottom: [look.cardIds[3]!],
    });

    expect(getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })).toHaveLength(before);
    expect(room.state.pendingLooks.size).toBe(0);
    auditInvariants(room.state);
  });

  it('gèle la bibliothèque : pioche, meule et mélange sont refusés', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 2,
      mode: 'SCRY',
    });

    for (const intent of [
      { type: 'DRAW', count: 1 },
      { type: 'MILL', count: 1 },
      { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } },
      { type: 'SCOOP' },
    ] as const) {
      a.received.length = 0;
      await room.handleIntent(a, `l-${intent.type}`, intent);
      expect(lastReject(a), intent.type).toMatchObject({ code: 'ERR_LOOK_PENDING' });
    }
    auditInvariants(room.state);
  });

  it('abandonne la consultation d’un joueur déconnecté et rend son secret', async () => {
    const { room, a, b } = twoSeatTable();
    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 3,
      mode: 'SCRY',
    });
    const look = [...room.state.pendingLooks.values()][0]!;

    room.removeConnection(a.id);
    // Le délai court depuis la coupure, pas depuis l'ouverture : tant que la
    // déconnexion est fraîche, la consultation tient.
    look.startedAt = Date.now() - LIMITS.lookAbandonMs * 10;
    room.sweepLooks();
    expect(room.state.pendingLooks.size).toBe(1);

    // On antidate la déconnexion plutôt que d'attendre 120 s.
    room.state.seats.get('seat_0')!.disconnectedAt = Date.now() - LIMITS.lookAbandonMs - 1;
    room.sweepLooks();

    expect(room.state.pendingLooks.size).toBe(0);
    for (const id of look.cardIds) {
      expect(room.state.objects.get(id)?.knownTo.size).toBe(0);
    }
    // Et Bob n'a rien appris de la bibliothèque d'Alice au passage.
    expect(b.frames.join('\n')).not.toContain('"scryfallId"');
    auditInvariants(room.state);
  });

  it('libère la consultation d’un siège qui se lève', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 3,
      mode: 'SCRY',
    });
    expect(room.state.pendingLooks.size).toBe(1);

    room.standUp(a);

    expect(room.state.pendingLooks.size).toBe(0);
    expect(room.state.seats.has('seat_0')).toBe(false);
  });
});

describe('sièges', () => {
  it('refuse deux joueurs sur le même seatIndex', () => {
    const { room } = twoSeatTable();
    const intrus = fakeConnection('conn-c');
    room.addConnection(intrus);

    expect(() => room.sitDown(intrus, 0, 'Intrus', null)).toThrowError(/occupé/);
  });

  it('refuse de récupérer le siège d’un invité déconnecté sans son jeton', () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    room.removeConnection(a.id);

    const intrus = fakeConnection('conn-c');
    room.addConnection(intrus);
    // Sans cette garde, l'intrus recevrait la main d'Alice dans son snapshot.
    expect(() => room.sitDown(intrus, 0, 'Intrus', null)).toThrowError(/occupé/);
    expect(intrus.seatId).toBeNull();
  });

  it('rend le siège sur présentation du seatToken', () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const token = room.state.seats.get('seat_0')!.seatToken;
    room.removeConnection(a.id);

    const retour = fakeConnection('conn-a2');
    room.addConnection(retour);
    const seat = room.resumeSeat(retour, token);

    expect(seat?.id).toBe('seat_0');
    expect(retour.seatId).toBe('seat_0');
    expect(room.snapshotFor('seat_0').cards.filter((c) => c.zone.kind === 'HAND' && !c.faceDown)).toHaveLength(7);
  });

  it('refuse START_GAME tant qu’un siège n’a pas de deck', () => {
    const room = twoSeatTable().room;
    const c = fakeConnection('conn-c');
    room.addConnection(c);
    room.sitDown(c, 2, 'Carol', null);

    expect(() => room.startGame('seat_0')).toThrowError(/Deck manquant/);
    expect(room.state.status).toBe('LOBBY');
  });

  it('démarre quand tous les decks sont là', () => {
    const room = twoSeatTable().room;
    const c = fakeConnection('conn-c');
    room.addConnection(c);
    room.sitDown(c, 2, 'Carol', null);
    room.loadDeck('seat_2', deck('Deck Carol', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']), null);

    room.startGame('seat_0');
    expect(room.state.status).toBe('PLAYING');
    expect(getZone(room.state, { seat: 'seat_2', kind: 'HAND' })).toHaveLength(7);
    auditInvariants(room.state);
  });
});

describe('UNDO_LAST', () => {
  it('annule la dernière action de son auteur', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'life', { type: 'ADJUST_LIFE', seat: 'seat_0', delta: -5 });
    expect(room.state.seats.get('seat_0')?.life).toBe(35);

    a.received.length = 0;
    await room.handleIntent(a, 'undo', { type: 'UNDO_LAST' });

    expect(lastReject(a)).toBeUndefined();
    expect(room.state.seats.get('seat_0')?.life).toBe(40);
  });

  it('refuse d’annuler quand un autre siège a joué depuis', async () => {
    const { room, a, b } = twoSeatTable();
    await room.handleIntent(a, 'life', { type: 'ADJUST_LIFE', seat: 'seat_0', delta: -5 });
    await room.handleIntent(b, 'die', { type: 'ROLL_DIE', sides: 6 });

    a.received.length = 0;
    await room.handleIntent(a, 'undo', { type: 'UNDO_LAST' });

    expect(lastReject(a)).toMatchObject({ code: 'ERR_UNDO_UNAVAILABLE' });
    expect(room.state.seats.get('seat_0')?.life).toBe(35);
  });

  it('ne remonte pas au-delà d’une action irréversible du même siège', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'life', { type: 'ADJUST_LIFE', seat: 'seat_0', delta: -5 });
    // Le mélange n'est pas annulable : il doit aussi rendre inaccessible
    // l'annulation de ce qui le précède (docs/protocol.md §9).
    await room.handleIntent(a, 'shuffle', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });

    a.received.length = 0;
    await room.handleIntent(a, 'undo', { type: 'UNDO_LAST' });

    expect(lastReject(a)).toMatchObject({ code: 'ERR_UNDO_UNAVAILABLE' });
    expect(room.state.seats.get('seat_0')?.life).toBe(35);
  });

  it('n’est pas bloquée par une déconnexion survenue entre-temps', async () => {
    const { room, a, b } = twoSeatTable();
    await room.handleIntent(a, 'life', { type: 'ADJUST_LIFE', seat: 'seat_0', delta: -5 });
    // Commit système, sans auteur : il ne doit pas passer pour l'action d'autrui.
    room.removeConnection(b.id);

    a.received.length = 0;
    await room.handleIntent(a, 'undo', { type: 'UNDO_LAST' });

    expect(lastReject(a)).toBeUndefined();
    expect(room.state.seats.get('seat_0')?.life).toBe(40);
  });
});
