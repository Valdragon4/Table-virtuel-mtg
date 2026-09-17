import type { ErrorCode } from '@mtg/shared';

/** Refus d'un intent. Traduit tel quel en message `reject` vers l'auteur. */
export class IntentError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IntentError';
  }
}
