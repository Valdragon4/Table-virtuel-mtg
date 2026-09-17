import { describe, expect, it } from 'vitest';
import { getZone } from '../src/game/state.js';
import { twoSeatTable } from './fixture.js';
import { auditInvariants } from './invariants.js';

describe('REVEAL mode for LOOK and enriched RESOLVE_LOOK log', () => {
  it('révèle les cartes à toute la table dans LOOK_STARTED et les nomme dans le journal', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    b.frames.length = 0;

    await room.handleIntent(a, 'look-reveal', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 4,
      mode: 'REVEAL',
    });

    const look = [...room.state.pendingLooks.values()][0]!;
    expect(look).toBeDefined();
    expect(look.cardIds).toHaveLength(4);

    // Vérification que les cartes sont connues de Bob aussi
    for (const id of look.cardIds) {
      expect(room.state.objects.get(id)!.knownTo.has('seat_1')).toBe(true);
    }

    // Le journal annonce la révélation
    const startLog = room.state.log.at(-1)!;
    expect(startLog.text).toContain('a révélé les 4 cartes du dessus de sa bibliothèque :');
    expect(startLog.cardIds).toHaveLength(4);

    // Bob a reçu LOOK_STARTED avec les cartes
    const bobEvents = b.received
      .filter((m): m is { t: 'event'; event: any; seq: number } => m.t === 'event')
      .map((m) => m.event);
    const lookStarted = bobEvents.find((e) => e.type === 'LOOK_STARTED');
    expect(lookStarted).toBeDefined();
    expect(lookStarted.cards).toHaveLength(4);
    expect(lookStarted.mode).toBe('REVEAL');

    // Résolution : 1 sur champ, 1 au cimetière, 1 en main, 1 au fond, avec mélange
    const [cField, cGrave, cHand, cBottom] = look.cardIds;
    const nameField = room.state.objects.get(cField!)!.card.name;
    const nameGrave = room.state.objects.get(cGrave!)!.card.name;
    const nameHand = room.state.objects.get(cHand!)!.card.name;

    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [],
      bottom: [cBottom!],
      toBattlefield: [cField!],
      toGraveyard: [cGrave!],
      toHand: [cHand!],
      shuffleAfter: true,
    });

    const resolveLog = room.state.log.at(-1)!;
    expect(resolveLog.text).toContain('a terminé sa révélation (0 dessus, 1 dessous, bibliothèque mélangée)');
    expect(resolveLog.text).toContain(`${nameField} vers champ de bataille`);
    expect(resolveLog.text).toContain(`${nameGrave} vers cimetière`);
    expect(resolveLog.text).toContain(`${nameHand} vers main`);

    auditInvariants(room.state);
  });

  it('détaille la fouille de bibliothèque (SEARCH) avec mention du mélange et de la main', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    await room.handleIntent(a, 'search', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 'ALL',
      mode: 'SEARCH',
    });

    const look = [...room.state.pendingLooks.values()][0]!;
    const chosen = look.cardIds[0]!;
    const rest = look.cardIds.slice(1);

    await room.handleIntent(a, 'res-search', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: rest,
      bottom: [],
      toHand: [chosen],
      shuffleAfter: true,
    });

    const resolveLog = room.state.log.at(-1)!;
    expect(resolveLog.text).toContain('a terminé sa fouille de bibliothèque');
    expect(resolveLog.text).toContain('bibliothèque mélangée');
    expect(resolveLog.text).toContain('1 carte vers main');

    auditInvariants(room.state);
  });
});
