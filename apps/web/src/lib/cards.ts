/**
 * Cache de métadonnées de cartes, côté client.
 *
 * Les images ne passent jamais par notre serveur : le navigateur va les chercher
 * sur le CDN de Scryfall, dont le motif d'URL est stable et dérivable de
 * l'identifiant. Seuls les noms et types viennent de notre API, par lots.
 */
import { api, type CardMeta } from './api.js';

/**
 * Dimensions de référence, relevées sur la table de référence : une carte en
 * main fait 166×230 px, soit le rapport 63×88 mm d'une vraie carte. Les autres
 * zones en dérivent par un facteur d'échelle. Elles vivent ici, et non dans un
 * composant, parce que le calcul de dépôt (`lib/drag.ts`) en a besoin lui aussi.
 */
export const CARD_WIDTH = 166;
export const CARD_HEIGHT = 230;
/** Facteur appliqué aux permanents : ~83×115, comme sur la table de référence. */
export const BATTLEFIELD_SCALE = 0.5;
/** Facteur des vignettes de pile (bibliothèque, cimetière, exil, commandement). */
export const PILE_SCALE = 0.42;

const cache = new Map<string, CardMeta>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let flushTimer: number | null = null;

export function subscribeCards(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function cardMeta(scryfallId: string | undefined): CardMeta | undefined {
  if (!scryfallId) return undefined;
  const hit = cache.get(scryfallId);
  if (hit) return hit;
  requestCard(scryfallId);
  return undefined;
}

/**
 * Un identifiant Scryfall est un UUID. Le vérifier n'est pas de la paranoïa :
 * un seul identifiant d'objet (ULID) glissé dans un lot le fait rejeter en
 * bloc, et ce sont alors **tous** les noms de la frame qui manquent.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Demande différée : les identifiants vus dans la même frame partent ensemble. */
export function requestCard(scryfallId: string): void {
  if (!UUID.test(scryfallId)) return;
  if (cache.has(scryfallId) || inFlight.has(scryfallId)) return;
  inFlight.add(scryfallId);

  flushTimer ??= window.setTimeout(() => {
    flushTimer = null;
    const ids = [...inFlight].slice(0, 500);
    if (ids.length === 0) return;

    void api
      .post<{ cards: CardMeta[] }>('/api/cards/batch', { ids })
      .then(({ cards }) => {
        for (const card of cards) cache.set(card.scryfallId, card);
      })
      .catch(() => undefined)
      .finally(() => {
        for (const id of ids) inFlight.delete(id);
        for (const listener of listeners) listener();
      });
  }, 30);
}

/**
 * URL d'image Scryfall, dérivée de l'identifiant sans aucun appel réseau
 * préalable — c'est le motif que Scryfall publie dans `image_uris`.
 */
export function scryfallImage(
  scryfallId: string,
  version: 'small' | 'normal' | 'large' = 'large',
  face: 'front' | 'back' = 'front',
): string {
  const a = scryfallId[0] ?? '0';
  const b = scryfallId[1] ?? '0';
  return `https://cards.scryfall.io/${version}/${face}/${a}/${b}/${scryfallId}.jpg`;
}

/**
 * Dos de carte officiel, servi par le CDN de Scryfall.
 *
 * C'est une illustration de Wizards of the Coast, et nous l'affichons au même
 * titre que les 117 000 faces de cartes : leur politique de contenu de fan
 * autorise un projet non commercial à le faire, et le nôtre s'y déclare. La
 * règle que nous tenons est plus précise que « aucun asset » — elle est :
 * **ne rien héberger, ne rien proxifier, ne rien mettre en cache**. C'est le
 * navigateur du joueur qui va chercher l'image, directement, chez Scryfall.
 */
const CARD_BACK_ID = '0aeebaf5-8c7d-4636-9e82-8c27447861f7';

export function scryfallCardBack(version: 'small' | 'normal' | 'large' = 'normal'): string {
  const a = CARD_BACK_ID[0];
  const b = CARD_BACK_ID[1];
  // Note : les dos vivent sur `backs.scryfall.io`, pas sur `cards.scryfall.io`,
  // et le chemin n'a pas de segment de face. Vérifié : `cards.scryfall.io`
  // renvoie 404 pour cet identifiant.
  return `https://backs.scryfall.io/${version}/${a}/${b}/${CARD_BACK_ID}.jpg`;
}

export function cardName(scryfallId: string | undefined): string {
  if (!scryfallId) return 'Carte';
  return cardMeta(scryfallId)?.name ?? '…';
}

export function isDoubleFaced(meta: CardMeta | undefined): boolean {
  if (!meta) return false;
  return ['transform', 'modal_dfc', 'double_faced_token', 'reversible_card'].includes(meta.layout);
}
