/**
 * Défense en profondeur côté client : un `hello/delta` qui chevauche ce qu'on a
 * déjà reçu ne doit pas redoubler une ligne de journal.
 *
 * Le serveur ne laisse plus de trou de séquence (voir
 * apps/server/test/densite-sequence.test.ts), donc ce chevauchement ne devrait
 * plus se produire. « Ne devrait plus » n'est pas « ne peut plus » : un delta
 * demandé deux fois, ou un event reçu pendant qu'un resync est en vol, rejoue
 * les mêmes `seq`. La déduplication tient le journal droit dans ce cas-là.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@mtg/shared';
import { handleMessage, useGame } from '../src/store/game.js';

function apply(message: ServerMessage): void {
  handleMessage(message, useGame.setState, useGame.getState);
}

/** Un event porteur d'une ligne de journal, sans charge utile. */
function noted(seq: number, text: string) {
  return {
    t: 'event' as const,
    seq,
    at: 1_000 + seq,
    actor: 'seat_1',
    event: { type: 'NOTED' as const },
    log: { text, cardIds: [] },
  };
}

describe('journal et rattrapage', () => {
  beforeEach(() => {
    useGame.setState({ seq: 0, log: [] });
  });

  it('n’ajoute pas deux fois une entrée déjà connue quand le delta chevauche', () => {
    apply(noted(1, 'Invité a révélé la carte du dessus'));
    apply(noted(2, 'Invité a terminé sa révélation'));
    expect(useGame.getState().log.map((e) => e.seq)).toEqual([1, 2]);

    // Le serveur répond un delta qui repart d'avant ce qu'on a déjà appliqué.
    apply({
      t: 'hello',
      protocol: 3,
      seat: 'seat_0',
      roomCode: 'TEST01',
      delta: [noted(1, 'Invité a révélé la carte du dessus'), noted(2, 'Invité a terminé sa révélation')],
    } as ServerMessage);

    const log = useGame.getState().log;
    expect(log.map((e) => e.seq)).toEqual([1, 2]);
    expect(log.filter((e) => e.text === 'Invité a terminé sa révélation')).toHaveLength(1);
  });

  it('accepte les entrées du delta qu’il ne connaissait pas encore', () => {
    apply(noted(1, 'première'));
    apply({
      t: 'hello',
      protocol: 3,
      seat: 'seat_0',
      roomCode: 'TEST01',
      delta: [noted(1, 'première'), noted(2, 'deuxième'), noted(3, 'troisième')],
    } as ServerMessage);

    expect(useGame.getState().log.map((e) => e.text)).toEqual(['première', 'deuxième', 'troisième']);
    expect(useGame.getState().seq).toBe(3);
  });

  it('ne demande qu’un seul resync tant que le hello n’est pas revenu', () => {
    const asked: number[] = [];
    useGame.setState({
      seq: 5,
      log: [],
      socket: { resync: (since: number) => asked.push(since) } as never,
    });

    // Trois events d'affilée en trou de séquence : un seul rattrapage doit partir.
    apply(noted(9, 'a'));
    apply(noted(10, 'b'));
    apply(noted(11, 'c'));
    expect(asked).toEqual([5]);

    // Le `hello` désarme la garde ; un trou ultérieur redemande bien.
    apply({ t: 'hello', protocol: 3, seat: 'seat_0', roomCode: 'TEST01', delta: [] } as ServerMessage);
    apply(noted(20, 'd'));
    expect(asked).toEqual([5, 5]);

    useGame.setState({ socket: null });
  });
});
