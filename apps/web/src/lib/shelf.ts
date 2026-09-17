/**
 * Étagère à jetons.
 *
 * C'est une **palette, pas une zone de jeu** : elle ne contient aucun objet de
 * partie, seulement des identifiants d'impression. Rien n'y est caché, rien n'y
 * est arbitré, et le serveur n'en sait rien — poser un jeton depuis l'étagère
 * revient exactement à `CREATE_TOKEN`, comme la recherche de jetons.
 *
 * Persistance : `UserPrefs.extra` pour un compte, `localStorage` pour un
 * invité. Le mode invité reste entier — l'étagère marche sans compte, elle ne
 * suit simplement pas le joueur d'un navigateur à l'autre.
 */
import { api, type Me } from './api.js';

export interface ShelfToken {
  scryfallId: string;
  name: string;
}

const STORAGE_KEY = 'mtg.tokenShelf';
const MAX_ITEMS = 40;

/** Compte connu, ou `false` si l'on joue en invité. `null` : pas encore su. */
let account: Me | null | false = null;

function readLocal(): ShelfToken[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return sanitize(parsed);
  } catch {
    return [];
  }
}

function writeLocal(items: ShelfToken[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Stockage refusé (navigation privée) : l'étagère vit le temps de la page.
  }
}

/** Ne fait jamais confiance à ce qui sort d'un stockage ou d'une API. */
function sanitize(value: unknown): ShelfToken[] {
  if (!Array.isArray(value)) return [];
  const items: ShelfToken[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { scryfallId, name } = entry as Partial<ShelfToken>;
    if (typeof scryfallId !== 'string' || scryfallId.length === 0) continue;
    items.push({ scryfallId, name: typeof name === 'string' ? name : 'Jeton' });
  }
  return items.slice(0, MAX_ITEMS);
}

/**
 * Charge l'étagère. Un compte l'emporte sur le stockage local ; s'il n'a rien,
 * on reprend ce qui traînait localement, ce qui évite de perdre l'étagère d'un
 * invité qui vient de se créer un compte.
 */
export async function loadShelf(): Promise<ShelfToken[]> {
  try {
    const me = await api.get<Me>('/api/me');
    account = me;
    const stored = sanitize((me.prefs?.extra as { tokenShelf?: unknown } | undefined)?.tokenShelf);
    if (stored.length > 0) return stored;
    const local = readLocal();
    if (local.length > 0) await saveShelf(local);
    return local;
  } catch {
    account = false;
    return readLocal();
  }
}

/** Enregistre l'étagère, là où ce joueur-là la garde. */
export async function saveShelf(items: ShelfToken[]): Promise<void> {
  const trimmed = items.slice(0, MAX_ITEMS);
  writeLocal(trimmed);
  if (!account) return;

  // `extra` est remplacé en entier par le PATCH : on relit et on fusionne, pour
  // ne pas effacer les autres préférences qui y vivent.
  const current = (account.prefs?.extra ?? {}) as Record<string, unknown>;
  const extra = { ...current, tokenShelf: trimmed };
  try {
    await api.patch('/api/me', { extra });
    account = { ...account, prefs: { ...(account.prefs ?? { cardBackUrl: null, uiScale: 1 }), extra } };
  } catch {
    // Le stockage local a déjà pris : on ne perd rien de visible.
  }
}
