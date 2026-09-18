/**
 * L'éventail de la main d'un adversaire.
 *
 * Ce qu'on protège ici n'est pas une formule mais une promesse : **une place
 * par carte**. L'ancien éventail plafonnait à dix dos et confiait le reste à une
 * pastille, si bien qu'une main de onze et une main de trente se ressemblaient
 * — or l'épaisseur d'une main est la première chose qu'on lit chez un
 * adversaire.
 *
 * Le prix à payer, c'est que la largeur ne peut plus suivre le nombre : elle
 * doit rester bornée par le panneau, sans quoi l'éventail irait recouvrir le
 * siège voisin. D'où les deux régimes vérifiés plus bas — pas nominal tant que
 * ça rentre, pas resserré ensuite — et le garde-fou du pas minimal, en dessous
 * duquel les dos ne formeraient plus qu'un aplat.
 */
import { describe, expect, it } from 'vitest';
import {
  FAN_MAX_W,
  FAN_STEP,
  FAN_STEP_MIN,
  handFanSlots,
  handFanStep,
  handFanWidth,
} from '../src/components/OpponentHand.js';

describe("Pas de l'éventail", () => {
  it('laisse le pas nominal aux mains ordinaires', () => {
    /* Le cas qui a motivé le changement : trente et une cartes. Elles tiennent
       encore au pas nominal, donc rien ne doit bouger de ce qu'on voyait. */
    for (const n of [1, 2, 7, 10, 31, 64]) {
      expect(handFanStep(n)).toBe(FAN_STEP);
    }
    expect(handFanWidth(10)).toBe(48 + 9 * FAN_STEP);
    expect(handFanWidth(31)).toBe(48 + 30 * FAN_STEP);
  });

  it('resserre dès que la largeur nominale déborderait', () => {
    /* 64 cartes rentrent tout juste, 65 non : c'est là que le régime change. */
    expect(handFanWidth(64)).toBeLessThanOrEqual(FAN_MAX_W);
    expect(handFanStep(65)).toBeLessThan(FAN_STEP);
    expect(handFanStep(65)).toBeGreaterThan(FAN_STEP_MIN);
  });

  it("borne la largeur de l'éventail par le panneau, jusqu'au pas minimal", () => {
    for (let n = 1; n <= 191; n += 1) {
      expect(handFanWidth(n)).toBeLessThanOrEqual(FAN_MAX_W);
    }
    /* Une main de cent cartes — un deck de Commander entier — rentre encore, et
       garde une tranche de plus de dix pixels par carte. */
    expect(handFanStep(100)).toBeGreaterThan(10);
    expect(handFanWidth(100)).toBeCloseTo(FAN_MAX_W, 6);
  });

  it('ne descend jamais sous le pas minimal, quitte à déborder', () => {
    /* Le cas extrême assumé : passé 191 cartes on préfère déborder plutôt que
       de réduire les dos à un aplat uni où plus rien ne se compte. */
    expect(handFanStep(192)).toBe(FAN_STEP_MIN);
    expect(handFanStep(1000)).toBe(FAN_STEP_MIN);
    expect(handFanWidth(192)).toBeGreaterThan(FAN_MAX_W);
  });

  it('ne rétrécit jamais quand la main grossit', () => {
    /* Sans quoi une main plus grosse pourrait paraître plus fine — le défaut
       même qu'on corrige. La largeur croît au pas nominal, puis plafonne à
       `FAN_MAX_W` le temps du régime resserré : elle stagne, mais ne recule
       jamais. C'est alors la densité des tranches qui porte l'information. */
    for (let n = 1; n < 300; n += 1) {
      expect(handFanWidth(n + 1)).toBeGreaterThanOrEqual(handFanWidth(n));
    }
    /* Tant que le pas est nominal, en revanche, elle croît strictement. */
    for (let n = 1; n < 64; n += 1) {
      expect(handFanWidth(n + 1)).toBeGreaterThan(handFanWidth(n));
    }
  });
});

describe("Places de l'éventail", () => {
  const carte = (id: string) => ({ id });

  it('rend une place par carte annoncée, sans plafond', () => {
    expect(handFanSlots([], 31)).toHaveLength(31);
    expect(handFanSlots([], 31).every((s) => s === null)).toBe(true);
    expect(handFanSlots([], 120)).toHaveLength(120);
  });

  it('place les cartes connues en tête et complète par des dos', () => {
    const slots = handFanSlots([carte('a'), carte('b')], 5);
    expect(slots).toHaveLength(5);
    expect(slots[0]).toEqual(carte('a'));
    expect(slots[1]).toEqual(carte('b'));
    expect(slots.slice(2)).toEqual([null, null, null]);
  });

  it("ne cache jamais une carte connue derrière un compte en retard", () => {
    /* Montrer un dos à la place d'une carte révélée serait un mensonge : si le
       compte est transitoirement plus bas, ce sont les connues qui gagnent. */
    const slots = handFanSlots([carte('a'), carte('b'), carte('c')], 1);
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => s !== null)).toBe(true);
  });
});
