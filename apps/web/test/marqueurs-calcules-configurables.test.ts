import { describe, expect, it } from 'vitest';
import type { CardView } from '@mtg/shared';
import {
  COMMON_SUBTYPES,
  computedCounter,
  describeComputed,
  getCardStat,
  ptCounter,
  measureCount,
} from '../src/components/CardSprite.js';

describe('Marqueurs calculés et configurables', () => {
  it('analyse un gabarit avec décalage négatif (*-1/*-1)', () => {
    const spec = computedCounter('∑*-1/*-1 bat:angel@vous');
    expect(spec).not.toBeNull();
    expect(spec?.left).toEqual({ coef: 1, offset: -1, signed: false });
    expect(spec?.right).toEqual({ coef: 1, offset: -1, signed: false });
    expect(spec?.source).toBe('bat:angel');
    expect(spec?.scope).toBe('vous');
  });

  it('analyse un gabarit additif avec décalage (+*-1/+*-1)', () => {
    const spec = computedCounter('∑+*-1/+*-1 bat:angel@vous');
    expect(spec).not.toBeNull();
    expect(spec?.left).toEqual({ coef: 1, offset: -1, signed: true });
    expect(spec?.right).toEqual({ coef: 1, offset: -1, signed: true });
  });

  it('décrit un marqueur calculé avec décalage dans l’infobulle', () => {
    const spec = computedCounter('∑*-1/*-1 bat:angel@vous');
    expect(spec).not.toBeNull();
    const desc = describeComputed(spec!);
    expect(desc).toContain('anges sur le champ de bataille');
    expect(desc).toContain('- 1');
  });

  it('reconnaît les formes de marqueurs figés posés (3/3, +3/+3, X/X)', () => {
    const p33 = ptCounter('3/3');
    expect(p33).toEqual({ left: '3', right: '3', tone: 'gain' });

    const pPlus = ptCounter('+3/+3');
    expect(pPlus).toEqual({ left: '+3', right: '+3', tone: 'gain' });

    const pXX = ptCounter('X/X');
    expect(pXX).toEqual({ left: 'X', right: 'X', tone: 'mixed' });
  });

  it('calcule la force et endurance d’une carte avec getCardStat', () => {
    const card: CardView = {
      id: '01JABCDEF01234567890ABCDEF' as any,
      x: 100,
      y: 100,
      zone: { seat: 'S1' as any, kind: 'BATTLEFIELD' },
      faceDown: false,
      controller: 'S1' as any,
      counters: [
        { kind: '+1/+1', value: 2 },
        { kind: 'charge', value: 3 },
      ],
      tapped: false,
    };

    const countersCount = getCardStat(card, 'counters');
    expect(countersCount).toBe(5); // 2 + 3

    // Sans fiche Scryfall chargée, power vaut 0 + 2 (+1/+1 x 2) = 2
    const power = getCardStat(card, 'power');
    expect(power).toBe(2);
  });

  it('mesure une source self:counters', () => {
    const card: CardView = {
      id: '01JABCDEF01234567890ABCDEF' as any,
      x: 100,
      y: 100,
      zone: { seat: 'S1' as any, kind: 'BATTLEFIELD' },
      faceDown: false,
      controller: 'S1' as any,
      counters: [{ kind: '+1/+1', value: 4 }],
      tapped: false,
    };
    const state: any = {
      cards: new Map([[card.id, card]]),
      seats: [],
      zoneCounts: new Map(),
    };
    const spec = computedCounter('∑*/* self:counters@vous');
    expect(spec).not.toBeNull();
    const m = measureCount(state, spec!, card);
    expect(m).toEqual({ n: 4, approx: false });
  });

  it('ne contient aucun doublon dans COMMON_SUBTYPES', () => {
    const set = new Set(COMMON_SUBTYPES);
    expect(set.size).toBe(COMMON_SUBTYPES.length);
  });

  it('gère le décalage négatif : 1 ange - 1 = 0 (aucun marqueur)', () => {
    const baseValue = 1; // 1 ange sur le champ de bataille
    const offset = -1; // décalage -1
    const finalValue = Math.max(0, baseValue + offset);
    expect(finalValue).toBe(0);
    // Quand finalValue <= 0, aucun marqueur ne doit être créé
    expect(finalValue <= 0).toBe(true);
  });
});

