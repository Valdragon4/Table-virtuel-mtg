/**
 * Trier sa main.
 *
 * Le glisser range à la main, carte par carte ; ceci range d'un coup, dans
 * l'ordre où un joueur tient réellement ses cartes : les terrains d'un côté,
 * puis le reste par coût croissant. C'est l'ordre qu'on retrouve sur toutes les
 * tables, parce qu'il répond aux deux questions qu'on se pose en jouant —
 * « ai-je un terrain ? » et « qu'est-ce que je peux lancer ce tour ? ».
 *
 * Le tri ne s'invente rien : il lit l'index de cartes déjà chargé côté client.
 * Une carte dont la fiche n'est pas encore arrivée est laissée en fin de main
 * plutôt que classée au hasard.
 */
import type { CardView } from '@mtg/shared';
import { cardMeta } from './cards.js';

/** Coût converti, déduit du coût de mana écrit. */
function manaValue(cost: string | null | undefined): number {
  if (!cost) return 0;
  let total = 0;
  for (const symbol of cost.matchAll(/\{([^}]+)\}/g)) {
    const body = symbol[1]!;
    const generic = Number.parseInt(body, 10);
    if (Number.isFinite(generic)) total += generic;
    // X vaut zéro dans la main : on ne sait pas encore ce qu'on y mettra.
    else if (body !== 'X' && body !== 'Y' && body !== 'Z') total += 1;
  }
  return total;
}

/**
 * Rang de la grande famille de la carte. Les terrains d'abord — c'est la carte
 * qu'on cherche en premier à chaque tour.
 */
function familyRank(typeLine: string): number {
  const type = typeLine.toLowerCase();
  if (type.includes('land')) return 0;
  if (type.includes('creature')) return 1;
  if (type.includes('instant') || type.includes('sorcery')) return 2;
  return 3;
}

/** L'ordre voulu, exprimé en identifiants. */
export function sortedHand(hand: readonly CardView[]): string[] {
  return [...hand]
    .map((card, rank) => {
      const meta = card.faceDown === false ? cardMeta(card.scryfallId) : undefined;
      return { card, rank, meta };
    })
    .sort((a, b) => {
      // Sans fiche, on ne classe pas : ces cartes gardent leur ordre, à la fin.
      if (!a.meta || !b.meta) {
        if (!a.meta && !b.meta) return a.rank - b.rank;
        return a.meta ? -1 : 1;
      }
      const family = familyRank(a.meta.typeLine) - familyRank(b.meta.typeLine);
      if (family !== 0) return family;
      const cost = manaValue(a.meta.manaCost) - manaValue(b.meta.manaCost);
      if (cost !== 0) return cost;
      return a.meta.name.localeCompare(b.meta.name, 'fr');
    })
    .map((entry) => entry.card.id);
}
