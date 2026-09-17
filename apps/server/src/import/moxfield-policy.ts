/**
 * Politique d'appel Moxfield, isolée de tout : ni réseau, ni base, ni `env`.
 *
 * Elle encode une seule idée, celle de `docs/moxfield.md` §3.1 : notre accès est
 * une faveur nominative et révocable. Un refus ne se retente pas, une demande de
 * ralentir se respecte à la seconde près. Le reste du module Moxfield branche
 * cette politique sur le vrai monde.
 */

export type MoxfieldVerdict =
  /** 404 : deck absent ou privé. Rien à retenter, rien à désactiver. */
  | { kind: 'NOT_FOUND' }
  /** 403 : l'autorisation n'est pas (ou plus) appliquée. Le chemin se ferme. */
  | { kind: 'REVOKED' }
  /** 429 : on nous demande de ralentir, éventuellement jusqu'à une date. */
  | { kind: 'RATE_LIMITED'; retryAfterMs: number }
  /** Tout le reste : panne, timeout, réponse illisible. */
  | { kind: 'UPSTREAM' };

/** Pause par défaut quand un 429 arrive sans `Retry-After` exploitable. */
export const MOXFIELD_DEFAULT_COOLDOWN_MS = 60_000;
/** Plafond : on ne se met pas en pause plus d'une heure sur un en-tête fantaisiste. */
export const MOXFIELD_MAX_COOLDOWN_MS = 60 * 60_000;

/**
 * `Retry-After` en millisecondes. La RFC 9110 autorise deux formes : un nombre
 * de secondes, ou une date HTTP. Les deux sont acceptées ; une valeur absente,
 * négative ou illisible retombe sur la pause par défaut.
 */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number {
  const raw = header?.trim();
  if (!raw) return MOXFIELD_DEFAULT_COOLDOWN_MS;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    if (seconds <= 0) return MOXFIELD_DEFAULT_COOLDOWN_MS;
    return Math.min(seconds * 1000, MOXFIELD_MAX_COOLDOWN_MS);
  }

  const date = Date.parse(raw);
  if (Number.isNaN(date)) return MOXFIELD_DEFAULT_COOLDOWN_MS;
  const delta = date - now;
  if (delta <= 0) return MOXFIELD_DEFAULT_COOLDOWN_MS;
  return Math.min(delta, MOXFIELD_MAX_COOLDOWN_MS);
}

export function classifyMoxfieldStatus(
  status: number,
  header: string | null | undefined,
  now = Date.now(),
): MoxfieldVerdict {
  if (status === 404) return { kind: 'NOT_FOUND' };
  // 401 comme 403 : notre identité n'est pas acceptée. Insister serait devenir
  // exactement le « baddie » que la liste blanche sert à filtrer.
  if (status === 403 || status === 401) return { kind: 'REVOKED' };
  if (status === 429) return { kind: 'RATE_LIMITED', retryAfterMs: retryAfterMs(header, now) };
  return { kind: 'UPSTREAM' };
}

export type MoxfieldGateState =
  | { open: true }
  | { open: false; reason: 'REVOKED' }
  | { open: false; reason: 'COOLDOWN'; until: number };

/**
 * Portillon d'accès au chemin API. Il ne fait pas de requête : il dit seulement
 * si on a le droit d'en faire une, et retient ce que la dernière a coûté.
 *
 * L'état vit dans le processus. Une révocation constatée ferme le chemin
 * jusqu'au redémarrage : c'est délibéré, la réouverture passe par l'opérateur,
 * qui règle la question avec le support Moxfield.
 */
export class MoxfieldGate {
  private revoked = false;
  private cooldownUntil = 0;

  state(now = Date.now()): MoxfieldGateState {
    if (this.revoked) return { open: false, reason: 'REVOKED' };
    if (now < this.cooldownUntil) return { open: false, reason: 'COOLDOWN', until: this.cooldownUntil };
    return { open: true };
  }

  get isRevoked(): boolean {
    return this.revoked;
  }

  /** Enregistre le verdict d'un appel et referme le portillon s'il le faut. */
  note(verdict: MoxfieldVerdict, now = Date.now()): void {
    if (verdict.kind === 'REVOKED') this.revoked = true;
    else if (verdict.kind === 'RATE_LIMITED') {
      this.cooldownUntil = Math.max(this.cooldownUntil, now + verdict.retryAfterMs);
    }
  }

  /** Réservé aux tests : remet le portillon dans son état de départ. */
  reset(): void {
    this.revoked = false;
    this.cooldownUntil = 0;
  }
}
