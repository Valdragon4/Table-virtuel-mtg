/**
 * Quelle carte représente un deck.
 *
 * La page « Mes decks » affiche une miniature par deck, pour qu'on reconnaisse
 * une bibliothèque d'un coup d'œil au lieu d'en relire le nom. Il faut donc
 * élire **une** carte, et le choix se fait ici, côté serveur, parce que c'est
 * le seul endroit qui voie la liste complète : le `DeckSummary` ne porte que
 * les commandants, et une page de decks ne va pas rapatrier cinquante cartes
 * par ligne pour en afficher une.
 *
 * La fonction est **pure** : elle ne lit pas la base, ne va pas chez Scryfall,
 * ne rend qu'un identifiant et un nom. L'illustration, elle, sera chargée par
 * le navigateur du joueur directement depuis le CDN Scryfall — rien de Wizards
 * of the Coast ne passe par nous, ni ici ni ailleurs.
 */
import type { DeckZone } from '@mtg/shared';
import { isBasicLandTypeLine } from '../cards/scryfall.js';

/** Ce que le choix a besoin de savoir d'une carte de deck. Rien de plus. */
export interface ThumbnailCandidate {
  scryfallId: string;
  name: string;
  zone: DeckZone;
  sortIndex: number;
  typeLine: string;
  /** La valeur de mana du catalogue. Un terrain vaut 0, comme chez Scryfall. */
  cmc: number;
  /** `mythic`, `rare`, `uncommon`, `common`, et les raretés marginales. */
  rarity: string;
}

export interface DeckThumbnail {
  scryfallId: string;
  name: string;
}

/**
 * L'ordre des raretés, du plus remarquable au plus banal.
 *
 * Il ne sert qu'à **départager** : deux cartes de même valeur de mana ne se
 * valent pas tout à fait, et la mythique est presque toujours celle autour de
 * laquelle le deck a été construit. Une rareté inconnue — Scryfall en publie
 * quelques-unes, `special` et `bonus` — se range derrière tout le monde plutôt
 * que de faire échouer la comparaison.
 */
const RARITY_RANK: Record<string, number> = {
  mythic: 4,
  rare: 3,
  uncommon: 2,
  common: 1,
};

function rarityRank(rarity: string): number {
  return RARITY_RANK[rarity] ?? 0;
}

/**
 * Le repli quand il n'y a pas de commandant : **la plus chère du deck**.
 *
 * L'arbitrage mérite d'être écrit, parce qu'il n'y avait pas de bonne réponse
 * évidente et que le prochain qui passe voudra la changer.
 *
 *  - *La première carte de la liste* est le repli paresseux, et il est mauvais :
 *    `sortIndex` reflète l'ordre de la source, qui est presque toujours
 *    alphabétique. Tous les decks d'un joueur se retrouveraient illustrés par
 *    une carte commençant par « A », ce qui est exactement le contraire du but —
 *    reconnaître un deck d'un coup d'œil.
 *  - *La plus rare* est tentante, mais un deck moderne compte vingt rares dont
 *    la moitié sont des terrains ; la rareté ne désigne donc personne. Elle
 *    reste ici comme départage, où elle est juste.
 *  - *La plus chère en mana* désigne, elle, ce que le deck cherche à faire : la
 *    carte qu'on lance quand le plan marche. C'est aussi, accessoirement, celle
 *    dont l'illustration est la plus spectaculaire — un dragon à huit manas se
 *    reconnaît en vignette, un contresort à deux manas non.
 *
 * **Les terrains de base sont écartés** avant tout classement. Ils valent 0, ils
 * ne gagneraient donc jamais au mana ; mais ils gagneraient dans un deck de
 * terrains, et surtout la règle doit rester vraie si quelqu'un renverse un jour
 * l'ordre de tri. Une Forêt ne représente aucun deck.
 */
function plusRemarquable(cards: readonly ThumbnailCandidate[]): ThumbnailCandidate | null {
  let best: ThumbnailCandidate | null = null;
  for (const card of cards) {
    if (best === null || compareCandidates(card, best) < 0) best = card;
  }
  return best;
}

/** Négatif si `a` passe devant `b`. Total et déterministe : voir plus bas. */
function compareCandidates(a: ThumbnailCandidate, b: ThumbnailCandidate): number {
  if (a.cmc !== b.cmc) return b.cmc - a.cmc;
  const rarete = rarityRank(b.rarity) - rarityRank(a.rarity);
  if (rarete !== 0) return rarete;
  if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
  /*
   * Le dernier départage est l'identifiant, et il n'est pas décoratif : sans
   * lui, deux cartes également chères, également rares et de même `sortIndex`
   * laisseraient le choix dépendre de l'ordre dans lequel la base a rendu les
   * lignes. La miniature changerait alors d'un rechargement à l'autre, sans que
   * rien n'ait bougé dans le deck — le genre de bougé qu'on ne sait jamais
   * expliquer trois mois plus tard.
   */
  return a.scryfallId < b.scryfallId ? -1 : a.scryfallId > b.scryfallId ? 1 : 0;
}

/**
 * La carte représentative d'un deck, ou `null` s'il n'y en a aucune.
 *
 * L'ordre des règles :
 *
 *  1. **Le commandant**, et c'est le cas voulu par défaut : c'est lui qu'on
 *     nomme quand on parle de son deck, et il est déjà écrit sur la ligne.
 *  2. **Le premier commandant** quand il y en a deux — partenaires, Compagnon,
 *     Background. On prend celui de plus petit `sortIndex`, c'est-à-dire
 *     exactement **le premier nom affiché** sur la ligne du deck : la miniature
 *     et le texte désignent alors la même carte. Choisir « le plus cher des
 *     deux » ferait montrer une illustration qui ne correspond pas au premier
 *     nom lu, ce qui se remarque et ne s'explique pas.
 *  3. **Sans commandant** — un deck de 60 cartes, un import sans zone
 *     COMMANDER — la plus chère de la zone principale, hors terrains de base
 *     (voir `plusRemarquable`).
 *  4. **En dernier recours**, si la zone principale n'est faite que de terrains
 *     de base ou est vide, n'importe quelle carte du deck, terrains compris. Une
 *     Forêt est une mauvaise miniature ; un cadre vide en est une pire.
 */
export function chooseDeckThumbnail(
  cards: readonly ThumbnailCandidate[],
): DeckThumbnail | null {
  const commanders = cards.filter((c) => c.zone === 'COMMANDER');
  if (commanders.length > 0) {
    // Le plus petit `sortIndex` d'abord, comme la ligne les affiche.
    const premier = commanders.reduce((a, b) =>
      a.sortIndex !== b.sortIndex
        ? a.sortIndex < b.sortIndex
          ? a
          : b
        : a.scryfallId <= b.scryfallId
          ? a
          : b,
    );
    return { scryfallId: premier.scryfallId, name: premier.name };
  }

  const principale = cards.filter((c) => c.zone === 'MAIN');
  const elue =
    plusRemarquable(principale.filter((c) => !isBasicLandTypeLine(c.typeLine))) ??
    plusRemarquable(principale) ??
    plusRemarquable(cards);

  return elue ? { scryfallId: elue.scryfallId, name: elue.name } : null;
}
