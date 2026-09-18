/**
 * Ce que dit le journal quand on dégage tout.
 *
 * Le bouton « Tout dégager » n'annonçait que le geste : « Alice a tout dégagé ».
 * L'adversaire lisait qu'il s'était passé quelque chose sans savoir quoi, alors
 * que le serveur, lui, tient déjà la liste exacte des permanents redressés.
 *
 * Les tests lisent les **frames brutes de Bob**, comme la §12.2 : le `text` d'une
 * `LogEntry` est construit une fois et diffusé à toute la table, donc la seule
 * mesure honnête d'une fuite est ce qui traverse le socket de l'adversaire.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { twoSeatTable, type Table } from './fixture.js';

function journalRecu(conn: { frames: string[] }): { text: string; cardIds: string[] }[] {
  return conn.frames
    .map((f) => JSON.parse(f) as { t: string })
    .filter((m): m is ServerEvent => m.t === 'event')
    .map((e) => e.log)
    .filter((l): l is { text: string; cardIds: string[] } => l !== undefined);
}

const nom = (room: Table['room'], id: string): string => room.state.objects.get(id)!.card.name;

/**
 * Ce texte nomme-t-il cette carte, en mot entier ?
 *
 * Les cartes du banc d'essai s'appellent « Carte 1 » … « Carte 20 » : un simple
 * `toContain` ferait passer « Carte 12 » pour « Carte 1 », et un test de fuite
 * qui se trompe de sens est pire qu'absent. Mêmes bornes que le nettoyage de
 * `TAKE_BACK`.
 */
const nomme = (texte: string, carte: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${carte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(texte);

/** Pose `count` cartes du dessus de la bibliothèque d'Alice sur son champ, engagées. */
async function poserEngage(t: Table, count: number): Promise<string[]> {
  const ids = getZone(t.room.state, { seat: 'seat_0', kind: 'LIBRARY' }).slice(0, count);
  await t.room.handleIntent(t.a, 'pose', {
    type: 'MOVE_CARDS',
    cardIds: ids,
    to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
  });
  await t.room.handleIntent(t.a, 'engage', { type: 'TAP', cardIds: ids });
  return ids;
}

describe('UNTAP_ALL nomme ce qu’il dégage', () => {
  it('nomme les permanents publics, tait la face cachée, et porte leurs ancres', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');

    const [p1, p2] = (await poserEngage(t, 2)) as [string, string];

    // La face cachée vient de la main : Bob ne l'a jamais vue, donc `knownTo`
    // ne le contient pas et `publicName` doit retomber sur la périphrase.
    const cache = getZone(t.room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    const nomCache = nom(t.room, cache);
    await t.room.handleIntent(t.a, 'poser-cachee', {
      type: 'MOVE_CARD',
      cardId: cache,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 3,
      y: 3,
      faceDown: true,
      tapped: true,
    });

    t.b.frames.length = 0;
    await t.room.handleIntent(t.a, 'degager', { type: 'UNTAP_ALL' });

    const ligne = journalRecu(t.b).find((l) => l.text.includes('tout dégagé'));
    expect(ligne).toBeDefined();

    // Les deux permanents publics sont nommés…
    expect(nomme(ligne!.text, nom(t.room, p1))).toBe(true);
    expect(nomme(ligne!.text, nom(t.room, p2))).toBe(true);
    // …et la face cachée ne traverse le socket de Bob nulle part.
    expect(nomme(ligne!.text, nomCache)).toBe(false);
    expect(nomme(t.b.frames.join('\n'), nomCache)).toBe(false);
    // Elle est comptée parmi les tues, pas oubliée du récit.
    expect(ligne!.text).toContain('1 autre carte');

    // Les ancres couvrent les cartes nommables : le survol surligne le lot.
    expect([...ligne!.cardIds].sort()).toEqual([p1, p2].sort());

    // Et le dégagement a bien eu lieu pour les trois, face cachée comprise.
    for (const id of [p1, p2, cache]) expect(t.room.state.objects.get(id)!.tapped).toBe(false);
  });

  it('se tait quand il n’y a rien à dégager', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');
    await poserEngage(t, 2);
    await t.room.handleIntent(t.a, 'degager', { type: 'UNTAP_ALL' });

    // Deuxième appel : plus rien n'est engagé, donc plus rien à dire.
    t.b.frames.length = 0;
    await t.room.handleIntent(t.a, 'degager-a-vide', { type: 'UNTAP_ALL' });

    expect(journalRecu(t.b)).toEqual([]);
  });

  it('abrège au-delà du seuil mais garde toutes les ancres', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');
    const ids = await poserEngage(t, 9);

    t.b.frames.length = 0;
    await t.room.handleIntent(t.a, 'degager', { type: 'UNTAP_ALL' });

    const ligne = journalRecu(t.b).find((l) => l.text.includes('tout dégagé'))!;
    // Six noms, puis le compte : une ligne de journal tient dans 288 pixels.
    expect(ligne.text).toContain('3 autres cartes');
    expect(ligne.text.length).toBeLessThan(160);
    // Le texte s'abrège, pas la liaison aux cartes.
    expect([...ligne.cardIds].sort()).toEqual([...ids].sort());
  });
});
