/**
 * Regroupement des changements de points de vie.
 *
 * Un joueur qui encaisse 12 dégâts clique douze fois sur `−`. Envoyer douze
 * intents produit douze events, douze lignes de journal, et noie la table sous
 * un décompte que personne ne lit. On accumule donc localement, et on n'envoie
 * **qu'une fois le joueur arrêté** — un seul intent, une seule ligne : « passe à
 * 28 points de vie (−12) ».
 *
 * La valeur affichée pendant l'accumulation est une **prédiction locale** au sens
 * de la §10 du protocole : elle est remplacée par l'état serveur dès que l'event
 * revient. Les autres joueurs, eux, ne voient rien avant l'envoi — c'est
 * précisément le but.
 */
import type { Intent, SeatId } from '@mtg/shared';

/** Délai d'inactivité avant envoi. Assez long pour enchaîner les clics. */
export const LIFE_BATCH_MS = 1500;

interface Pending {
  delta: number;
  timer: number;
}

type Send = (intent: Intent) => void;

const pending = new Map<SeatId, Pending>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** S'abonne aux changements du cumul en cours, pour l'afficher. */
export function subscribeLifeBatch(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cumul en attente d'envoi pour ce siège, 0 s'il n'y a rien. */
export function pendingLifeDelta(seat: SeatId): number {
  return pending.get(seat)?.delta ?? 0;
}

/**
 * Enregistre un clic. Le minuteur repart à chaque appel : tant que le joueur
 * continue, rien ne part.
 */
export function queueLifeChange(seat: SeatId, delta: number, send: Send): void {
  const current = pending.get(seat);
  if (current) window.clearTimeout(current.timer);

  const total = (current?.delta ?? 0) + delta;
  const timer = window.setTimeout(() => flushLife(seat, send), LIFE_BATCH_MS);
  pending.set(seat, { delta: total, timer });
  notify();
}

/**
 * Envoie immédiatement le cumul en attente. À appeler aussi quand la vue se
 * démonte : sans cela, quitter la table pendant le délai perdrait le décompte.
 */
export function flushLife(seat: SeatId, send: Send): void {
  const current = pending.get(seat);
  if (!current) return;

  window.clearTimeout(current.timer);
  pending.delete(seat);
  // Un cumul nul — autant de `+` que de `−` — n'a rien à annoncer.
  if (current.delta !== 0) send({ type: 'ADJUST_LIFE', seat, delta: current.delta });
  notify();
}

/** Vide tout, sans rien envoyer. Réservé aux tests et au démontage forcé. */
export function resetLifeBatch(): void {
  for (const { timer } of pending.values()) window.clearTimeout(timer);
  pending.clear();
  notify();
}
