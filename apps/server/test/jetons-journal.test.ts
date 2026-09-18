/**
 * Ce que dit le journal quand une action porte sur un lot de cartes.
 *
 * Même défaut que le « a tout dégagé » corrigé dans `engine.ts` : une ligne
 * annonçait une action de masse sans dire sur quoi elle portait. Ici, la
 * destruction de jetons — pourtant posés au vu de tous — et la défausse au
 * hasard, qui nommait sans jamais s'abréger.
 *
 * Le dernier bloc garde la porte close sur `REVEAL_HAND` : le `text` d'une
 * `LogEntry` est construit une fois et voyage avec le remplissage `NOTED`
 * jusqu'aux sièges hors audience, donc nommer une main révélée à un seul joueur
 * la publierait à toute la table. Tout se lit sur les **frames brutes** du siège
 * qui n'est pas dans l'audience : c'est la seule mesure honnête d'une fuite.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { seatTable, twoSeatTable, type Table } from './fixture.js';

function journalRecu(conn: { frames: string[] }): { text: string; cardIds: string[] }[] {
  return conn.frames
    .map((f) => JSON.parse(f) as { t: string })
    .filter((m): m is ServerEvent => m.t === 'event')
    .map((e) => e.log)
    .filter((l): l is { text: string; cardIds: string[] } => l !== undefined);
}

/**
 * Ce texte nomme-t-il cette carte, en mot entier ?
 *
 * Les cartes du banc d'essai s'appellent « Carte 1 » … « Carte 20 » : un simple
 * `toContain` ferait passer « Carte 12 » pour « Carte 1 », et un test de fuite
 * qui se trompe de sens est pire qu'absent.
 */
const nomme = (texte: string, carte: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${carte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(texte);

/**
 * Pose `count` cartes d'Alice sur son champ, puis crée un jeton copiant chacune.
 *
 * `CREATE_TOKEN` ne sait copier qu'un permanent visible du champ de bataille :
 * c'est le seul chemin qui donne des jetons **de noms distincts**, sans quoi
 * l'abrègement ne se distinguerait pas d'une simple déduplication.
 */
async function jetonsDistincts(t: Table, count: number): Promise<{ ids: string[]; noms: string[] }> {
  const sources = getZone(t.room.state, { seat: 'seat_0', kind: 'LIBRARY' }).slice(0, count);
  await t.room.handleIntent(t.a, 'pose', {
    type: 'MOVE_CARDS',
    cardIds: sources,
    to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
  });

  const ids: string[] = [];
  const noms: string[] = [];
  for (const [i, source] of sources.entries()) {
    await t.room.handleIntent(t.a, `jeton-${i}`, { type: 'CREATE_TOKEN', copyOf: source, x: i * 40, y: 0 });
    const cree = [...t.room.state.objects.values()].find((o) => o.kind === 'TOKEN' && !ids.includes(o.id))!;
    ids.push(cree.id);
    noms.push(cree.card.name);
  }
  return { ids, noms };
}

describe('DESTROY_TOKEN dit ce qu’il détruit', () => {
  it('nomme les jetons détruits, sans les ancrer', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');
    const { ids, noms } = await jetonsDistincts(t, 3);

    t.b.frames.length = 0;
    await t.room.handleIntent(t.a, 'detruire', { type: 'DESTROY_TOKEN', cardIds: ids });

    const ligne = journalRecu(t.b).find((l) => l.text.includes('détruits'));
    expect(ligne).toBeDefined();
    // Le compte reste — c'est lui qu'on lit en diagonale — et les noms
    // s'ajoutent après, comme « a tout dégagé : … » dans `engine.ts`.
    expect(ligne!.text).toContain('3 jetons de Alice ont été détruits : ');
    for (const n of noms) expect(nomme(ligne!.text, n)).toBe(true);

    /*
     * Pas d'ancres, et c'est la seule réponse juste : les objets viennent d'être
     * effacés de `state`, une ancre de survol pointerait sur un mort.
     */
    expect(ligne!.cardIds).toEqual([]);
  });

  it('garde la forme singulière quand un seul jeton tombe', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');
    const { ids, noms } = await jetonsDistincts(t, 1);

    t.b.frames.length = 0;
    await t.room.handleIntent(t.a, 'detruire', { type: 'DESTROY_TOKEN', cardIds: ids });

    const ligne = journalRecu(t.b).find((l) => l.text.includes('détruit'))!;
    expect(ligne.text).toBe(`le jeton ${noms[0]} de Alice a été détruit`);
    expect(ligne.cardIds).toEqual([]);
  });

  it('abrège au-delà du seuil plutôt que de noyer le journal', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');
    const { ids } = await jetonsDistincts(t, 9);

    t.b.frames.length = 0;
    await t.room.handleIntent(t.a, 'detruire', { type: 'DESTROY_TOKEN', cardIds: ids });

    const ligne = journalRecu(t.b).find((l) => l.text.includes('détruits'))!;
    // Six noms, puis le compte : une ligne de journal tient dans 288 pixels.
    expect(ligne.text).toContain('3 autres cartes');
    expect(ligne.text.length).toBeLessThan(160);
  });

  it('ne compte pas deux fois un identifiant répété', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');
    const { ids } = await jetonsDistincts(t, 2);

    t.b.frames.length = 0;
    await t.room.handleIntent(t.a, 'detruire', {
      type: 'DESTROY_TOKEN',
      cardIds: [ids[0]!, ids[0]!, ids[1]!],
    });

    const ligne = journalRecu(t.b).find((l) => l.text.includes('détruits'))!;
    expect(ligne.text).toContain('2 jetons de Alice ont été détruits : ');
  });
});

describe('RANDOM_DISCARD s’abrège comme les autres lots', () => {
  it('replie au-delà du seuil mais garde toutes les ancres', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');
    const main = [...getZone(t.room.state, { seat: 'seat_0', kind: 'HAND' })];
    expect(main.length).toBe(7);

    t.b.frames.length = 0;
    await t.room.handleIntent(t.a, 'defausse', { type: 'RANDOM_DISCARD', count: 7 });

    const ligne = journalRecu(t.b).find((l) => l.text.includes('défaussé au hasard'))!;
    // Les sept partent bien : la borne du tirage était recalculée sur un `pool`
    // qui rétrécissait, et n'en défaussait que quatre.
    expect(getZone(t.room.state, { seat: 'seat_0', kind: 'HAND' })).toHaveLength(0);
    expect(ligne.text).toContain('1 autre carte');
    // Le texte s'abrège, pas la liaison aux cartes : `TAKE_BACK` parcourt
    // `cardIds`, et une carte publique laissée hors des ancres serait hors de
    // sa portée.
    expect([...ligne.cardIds].sort()).toEqual([...main].sort());
  });
});

describe('REVEAL_HAND ne nomme rien', () => {
  it('laisse le siège hors audience sans un seul nom de la main révélée', async () => {
    const t = seatTable(3);
    t.room.startGame('seat_0');
    const carol = t.seats[2]!;

    const main = getZone(t.room.state, { seat: 'seat_0', kind: 'HAND' });
    const noms = main.map((id) => t.room.state.objects.get(id)!.card.name);

    carol.frames.length = 0;
    await t.room.handleIntent(t.a, 'revele', { type: 'REVEAL_HAND', toSeats: ['seat_1'] });

    /*
     * Carol reçoit bien la ligne — `Room.commit` l'attache aussi au `NOTED` de
     * remplissage, et `state.log` est unique pour toute la table. C'est
     * précisément pour cela qu'elle ne doit contenir aucun nom : la ligne est
     * publique quand l'événement, lui, ne l'est pas.
     */
    const ligne = journalRecu(carol).find((l) => l.text.includes('a révélé sa main'));
    expect(ligne).toBeDefined();
    expect(ligne!.cardIds).toEqual([]);

    for (const n of noms) {
      expect(nomme(ligne!.text, n), `« ${ligne!.text} » nomme ${n}`).toBe(false);
      expect(nomme(carol.frames.join('\n'), n), `${n} a traversé le socket de Carol`).toBe(false);
    }
  });
});
