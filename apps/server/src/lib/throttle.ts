/**
 * Limiteur à seau de jetons, en mémoire.
 *
 * Utilisé pour deux choses : les tentatives d'authentification par compte (en
 * complément du plafond par IP), et le débit d'intents par socket de partie.
 */
export interface BucketOptions {
  /** Capacité du seau, donc taille de la rafale tolérée. */
  capacity: number;
  /** Jetons regagnés par seconde. */
  refillPerSecond: number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

export class TokenBucket {
  private readonly buckets = new Map<string, BucketState>();

  constructor(private readonly options: BucketOptions) {}

  /** Consomme un jeton. Retourne false si le seau est vide. */
  take(key: string, cost = 1, now = Date.now()): boolean {
    const state = this.buckets.get(key) ?? { tokens: this.options.capacity, lastRefill: now };
    const elapsed = (now - state.lastRefill) / 1000;
    state.tokens = Math.min(this.options.capacity, state.tokens + elapsed * this.options.refillPerSecond);
    state.lastRefill = now;

    if (state.tokens < cost) {
      this.buckets.set(key, state);
      return false;
    }
    state.tokens -= cost;
    this.buckets.set(key, state);
    return true;
  }

  /** Secondes à attendre avant qu'un jeton soit disponible. */
  retryAfter(key: string, now = Date.now()): number {
    const state = this.buckets.get(key);
    if (!state) return 0;
    const deficit = 1 - state.tokens;
    if (deficit <= 0) return 0;
    return Math.ceil(deficit / this.options.refillPerSecond);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Évacue les seaux pleins : sans ça, la map grossit indéfiniment. */
  sweep(now = Date.now()): void {
    for (const [key, state] of this.buckets) {
      const elapsed = (now - state.lastRefill) / 1000;
      if (state.tokens + elapsed * this.options.refillPerSecond >= this.options.capacity) {
        this.buckets.delete(key);
      }
    }
  }
}

/** 10 tentatives, puis une regagnée toutes les 30 s. */
export const authAttempts = new TokenBucket({ capacity: 10, refillPerSecond: 1 / 30 });
