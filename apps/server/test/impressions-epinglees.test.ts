/**
 * Réconciliation des impressions épinglées avec la liste d'une source externe.
 *
 * Ce que ces tests tiennent, et qui est toute la difficulté du sujet : **la
 * source décide du contenu du deck, nous ne décidons que de l'illustration.**
 * Une épingle ne doit jamais ajouter une copie, jamais en retenir une que la
 * source a retirée, et jamais survivre à la disparition de sa carte — mais elle
 * doit survivre à tout le reste, y compris à un aller-retour par l'éditeur.
 */
import { describe, expect, it } from 'vitest';
import {
  reconcilePinnedPrintings,
  type IncomingPrinting,
  type PinnedPrinting,
} from '../src/decks/pinned-printings.js';

const FOREST = 'oracle-forest';
const ELD = 'print-eld';
const UNF = 'print-unf';
const ZNR = 'print-znr';

function incoming(overrides: Partial<IncomingPrinting> = {}): IncomingPrinting {
  return {
    identity: FOREST,
    scryfallId: ELD,
    quantity: 4,
    zone: 'MAIN',
    isFoil: false,
    requestedSetCode: 'eld',
    requestedCollectorNumber: '266',
    sortIndex: 3,
    ...overrides,
  };
}

function pin(overrides: Partial<PinnedPrinting> = {}): PinnedPrinting {
  return {
    identity: FOREST,
    scryfallId: UNF,
    quantity: 1,
    zone: 'MAIN',
    isFoil: false,
    requestedSetCode: 'unf',
    requestedCollectorNumber: '243',
    sortIndex: 3,
    ...overrides,
  };
}

/** Le deck tel qu'on le lirait : une entrée par impression, quantités comprises. */
function shape(rows: ReturnType<typeof reconcilePinnedPrintings>['rows']) {
  return rows.map((r) => ({
    scryfallId: r.scryfallId,
    quantity: r.quantity,
    isFoil: r.isFoil,
    pinned: r.printingPinned,
  }));
}

describe('impressions épinglées face à une resynchronisation', () => {
  it('laisse la liste intacte quand rien n’est épinglé', () => {
    const list = [incoming(), incoming({ scryfallId: 'print-sol', identity: 'oracle-sol', quantity: 1 })];

    const { rows, kept } = reconcilePinnedPrintings(list, []);

    expect(kept).toBe(0);
    expect(shape(rows)).toEqual([
      { scryfallId: ELD, quantity: 4, isFoil: false, pinned: false },
      { scryfallId: 'print-sol', quantity: 1, isFoil: false, pinned: false },
    ]);
  });

  it('prend une copie sur les quatre annoncées, sans changer le total', () => {
    const { rows, kept } = reconcilePinnedPrintings([incoming({ quantity: 4 })], [pin()]);

    expect(kept).toBe(1);
    expect(rows.reduce((sum, r) => sum + r.quantity, 0)).toBe(4);
    expect(shape(rows)).toEqual([
      { scryfallId: ELD, quantity: 3, isFoil: false, pinned: false },
      { scryfallId: UNF, quantity: 1, isFoil: false, pinned: true },
    ]);
  });

  it('suit la source quand elle monte : la copie épinglée reste unique', () => {
    const { rows } = reconcilePinnedPrintings([incoming({ quantity: 8 })], [pin()]);

    expect(shape(rows)).toEqual([
      { scryfallId: ELD, quantity: 7, isFoil: false, pinned: false },
      { scryfallId: UNF, quantity: 1, isFoil: false, pinned: true },
    ]);
  });

  it('laisse l’épinglée gagner quand la source descend à une seule copie', () => {
    const { rows, kept } = reconcilePinnedPrintings([incoming({ quantity: 1 })], [pin()]);

    expect(kept).toBe(1);
    // Plus de ligne de la source : il n'y avait qu'une copie, elle est épinglée.
    expect(shape(rows)).toEqual([{ scryfallId: UNF, quantity: 1, isFoil: false, pinned: true }]);
  });

  it('sacrifie les épingles en trop quand la source descend sous leur nombre', () => {
    const pins = [pin({ scryfallId: UNF }), pin({ scryfallId: ZNR, requestedSetCode: 'znr' })];

    const { rows, kept } = reconcilePinnedPrintings([incoming({ quantity: 1 })], pins);

    // Une seule copie annoncée : une seule épingle peut être servie, et c'est
    // toujours la même — l'arbitrage est déterministe, pas au hasard de la base.
    expect(kept).toBe(1);
    expect(shape(rows)).toEqual([{ scryfallId: UNF, quantity: 1, isFoil: false, pinned: true }]);
  });

  it('fait disparaître l’épingle avec la carte que la source a retirée', () => {
    const list = [incoming({ identity: 'oracle-sol', scryfallId: 'print-sol', quantity: 1 })];

    const { rows, kept } = reconcilePinnedPrintings(list, [pin()]);

    expect(kept).toBe(0);
    expect(shape(rows)).toEqual([{ scryfallId: 'print-sol', quantity: 1, isFoil: false, pinned: false }]);
  });

  it('garde ensemble deux illustrations de la même carte', () => {
    const pins = [
      pin({ scryfallId: UNF, sortIndex: 3 }),
      pin({ scryfallId: ZNR, requestedSetCode: 'znr', sortIndex: 3 }),
    ];

    const { rows, kept } = reconcilePinnedPrintings([incoming({ quantity: 4 })], pins);

    expect(kept).toBe(2);
    expect(rows.reduce((sum, r) => sum + r.quantity, 0)).toBe(4);
    expect(shape(rows)).toEqual([
      { scryfallId: ELD, quantity: 2, isFoil: false, pinned: false },
      { scryfallId: UNF, quantity: 1, isFoil: false, pinned: true },
      { scryfallId: ZNR, quantity: 1, isFoil: false, pinned: true },
    ]);
  });

  it('épingle le foil comme une impression à part entière', () => {
    const { rows } = reconcilePinnedPrintings(
      [incoming({ quantity: 2 })],
      [pin({ scryfallId: UNF, isFoil: true })],
    );

    expect(shape(rows)).toEqual([
      { scryfallId: ELD, quantity: 1, isFoil: false, pinned: false },
      { scryfallId: UNF, quantity: 1, isFoil: true, pinned: true },
    ]);
  });

  it('distingue le foil du non-foil d’une même impression', () => {
    // La source annonce la ligne non foil ; l'épingle réclame la même impression
    // en foil. Ce ne sont pas les mêmes cartes : l'épingle prend une copie.
    const { rows } = reconcilePinnedPrintings(
      [incoming({ scryfallId: UNF, quantity: 2, requestedSetCode: 'unf' })],
      [pin({ scryfallId: UNF, isFoil: true })],
    );

    expect(shape(rows)).toEqual([
      { scryfallId: UNF, quantity: 1, isFoil: false, pinned: false },
      { scryfallId: UNF, quantity: 1, isFoil: true, pinned: true },
    ]);
  });

  it('ne déplace pas une copie de plus quand la source annonce déjà l’impression épinglée', () => {
    // C'est l'aller-retour par l'éditeur : la liste réécrite porte les deux
    // impressions en clair. Réappliquer l'épingle ne doit rien prendre à
    // personne, sans quoi l'opération grignoterait une copie à chaque passage.
    const list = [
      incoming({ quantity: 2, sortIndex: 3 }),
      incoming({ scryfallId: UNF, quantity: 1, requestedSetCode: 'unf', sortIndex: 4 }),
    ];

    const first = reconcilePinnedPrintings(list, [pin()]);
    expect(first.kept).toBe(1);
    expect(shape(first.rows)).toEqual([
      { scryfallId: ELD, quantity: 2, isFoil: false, pinned: false },
      { scryfallId: UNF, quantity: 1, isFoil: false, pinned: true },
    ]);

    // Idempotence : le résultat repassé en entrée rend exactement le même deck.
    const again = reconcilePinnedPrintings(list, [pin()]);
    expect(shape(again.rows)).toEqual(shape(first.rows));
  });

  it('scinde la ligne quand la source en annonce plus que l’épingle n’en réclame', () => {
    const list = [
      incoming({ quantity: 1, sortIndex: 3 }),
      incoming({ scryfallId: UNF, quantity: 3, requestedSetCode: 'unf', sortIndex: 4 }),
    ];

    const { rows } = reconcilePinnedPrintings(list, [pin()]);

    // Une copie reste épinglée, les deux autres retombent sous l'autorité de la
    // source et fondront avec elle.
    expect(rows.reduce((sum, r) => sum + r.quantity, 0)).toBe(4);
    expect(shape(rows)).toEqual([
      { scryfallId: ELD, quantity: 1, isFoil: false, pinned: false },
      { scryfallId: UNF, quantity: 2, isFoil: false, pinned: false },
      { scryfallId: UNF, quantity: 1, isFoil: false, pinned: true },
    ]);
  });

  it('n’apparie pas deux zones différentes', () => {
    // La même carte au commandement et dans la bibliothèque : deux choix
    // distincts, que la zone sépare.
    const list = [incoming({ zone: 'COMMANDER', quantity: 1 }), incoming({ quantity: 2 })];

    const { rows, kept } = reconcilePinnedPrintings(list, [pin({ zone: 'MAIN' })]);

    expect(kept).toBe(1);
    expect(rows.find((r) => r.zone === 'COMMANDER')).toMatchObject({
      scryfallId: ELD,
      printingPinned: false,
    });
    expect(rows.filter((r) => r.zone === 'MAIN').map((r) => r.scryfallId)).toEqual([ELD, UNF]);
  });

  it('apparie sur le nom normalisé quand l’oracle manque', () => {
    // Repli du garde-fou de `printing-sync.ts` : une carte ingérée avant la
    // colonne `oracleId` ne doit pas perdre ses épingles pour autant.
    const list = [incoming({ identity: 'name:forest', quantity: 2 })];

    const { kept, rows } = reconcilePinnedPrintings(list, [pin({ identity: 'name:forest' })]);

    expect(kept).toBe(1);
    expect(shape(rows)).toEqual([
      { scryfallId: ELD, quantity: 1, isFoil: false, pinned: false },
      { scryfallId: UNF, quantity: 1, isFoil: false, pinned: true },
    ]);
  });

  it('range la ligne épinglée au rang de sa sœur', () => {
    const { rows } = reconcilePinnedPrintings([incoming({ quantity: 2, sortIndex: 11 })], [pin({ sortIndex: 99 })]);

    // Le rang vient de la source, pas de l'épingle : les deux impressions
    // restent voisines dans la liste, comme le fait `printing-sync.ts`.
    expect(rows.map((r) => r.sortIndex)).toEqual([11, 11]);
  });

  it('rend une liste vide sans rien inventer quand la source ne donne plus rien', () => {
    const { rows, kept } = reconcilePinnedPrintings([], [pin()]);

    expect(kept).toBe(0);
    expect(rows).toEqual([]);
  });
});
