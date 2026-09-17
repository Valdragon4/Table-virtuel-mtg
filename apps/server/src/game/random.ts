/**
 * Source d'aléa de la partie. Toujours côté serveur, jamais côté client :
 * dés, pièces, mélanges et insertions aléatoires passent tous par ici.
 */
import { randomInt } from 'node:crypto';

export interface RandomSource {
  /** Entier dans [0, max). `max` nul renvoie 0. */
  below(max: number): number;
  shuffle<T>(items: T[]): T[];
}

export const cryptoRandom: RandomSource = {
  below(max: number): number {
    return max <= 0 ? 0 : randomInt(max);
  },
  shuffle<T>(items: T[]): T[] {
    // Fisher-Yates, en place.
    for (let i = items.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      const a = items[i]!;
      const b = items[j]!;
      items[i] = b;
      items[j] = a;
    }
    return items;
  },
};

/** Générateur déterministe, réservé aux tests. */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0 || 1;
  const next = (): number => {
    // xorshift32 : suffisant pour reproduire une partie dans un test.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  return {
    below: (max) => (max <= 0 ? 0 : Math.floor(next() * max)),
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = items[i]!;
        const b = items[j]!;
        items[i] = b;
        items[j] = a;
      }
      return items;
    },
  };
}
