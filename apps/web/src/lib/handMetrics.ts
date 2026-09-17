/**
 * La taille du rail de main, déduite de la fenêtre.
 *
 * Le rail était figé : des cartes à l'échelle 1, sur 244 px de haut, quelle que
 * soit la fenêtre. Sur un écran de portable — 768 px de haut — cela fait **un
 * tiers de la hauteur** mangé par sa propre main, au détriment du terrain, qui
 * est pourtant ce qu'on regarde.
 *
 * **La taille ne dépend que de la fenêtre, jamais du nombre de cartes.** C'est
 * délibéré et c'est le point important : faire varier l'échelle avec la taille
 * de la main ferait changer de taille toutes les cartes à chaque pioche et à
 * chaque pose. On viserait une carte qui bouge. La densité de la main, elle,
 * est déjà absorbée ailleurs — par le resserrement du recouvrement, puis par le
 * défilement du rail.
 *
 * Ces fonctions sont pures et partagées : `Hand` s'en sert pour rendre, et
 * `Table` pour savoir quelle hauteur d'écran le rail lui prend. Deux calculs
 * séparés auraient divergé, et la caméra aurait cadré sur une place que la main
 * n'occupe pas.
 */
import { CARD_HEIGHT } from './cards.js';

/**
 * Marge haute réservée au survol.
 *
 * Le rail défile horizontalement, et un conteneur qui défile sur un axe rogne
 * l'autre : `overflow-x: auto` force `overflow-y: auto`, il n'existe pas de
 * « visible » sur un seul axe. La carte qui se soulève au survol serait donc
 * coupée net. On lui réserve la place à l'intérieur du rail.
 */
export const HOVER_HEADROOM = 12;

/** En deçà, une carte de main n'est plus lisible d'un coup d'œil. */
const MIN_SCALE = 0.62;

/**
 * Part de la hauteur de fenêtre que le rail peut prendre.
 *
 * Un quart, pas davantage : au-delà, la main concurrence le terrain. Sur un
 * grand écran la borne ne joue pas — l'échelle est plafonnée à 1, la taille de
 * référence des cartes, qu'on n'agrandit jamais.
 */
const HEIGHT_SHARE = 0.26;

/** Encombrement des colonnes fixes, retiré de la largeur utile du rail. */
const SIDE_FURNITURE = 340;

export function handScale(viewportWidth: number, viewportHeight: number): number {
  const budget = Math.min(CARD_HEIGHT + HOVER_HEADROOM, viewportHeight * HEIGHT_SHARE);
  const byHeight = (budget - HOVER_HEADROOM) / CARD_HEIGHT;

  /*
   * Une fenêtre étroite compte aussi : à 900 px de large, il ne reste que
   * 560 px de rail, et trois cartes à l'échelle 1 le remplissent déjà. On
   * réduit alors un peu, plutôt que de faire défiler dès la troisième carte.
   */
  const usable = Math.max(240, viewportWidth - SIDE_FURNITURE);
  const byWidth = usable / 900;

  return Math.max(MIN_SCALE, Math.min(1, byHeight, byWidth));
}

/** Hauteur totale du rail, marge de survol comprise. */
export function handRailHeight(viewportWidth: number, viewportHeight: number): number {
  return Math.round(CARD_HEIGHT * handScale(viewportWidth, viewportHeight)) + HOVER_HEADROOM;
}
