/**
 * Règle unique de bascule d'engagement.
 *
 * Elle vit ici parce que trois gestes la demandent — le double-clic, la touche
 * `T` et le menu contextuel — et qu'une règle recopiée trois fois finit par
 * diverger. C'est déjà arrivé : décider d'après la seule première carte laissait
 * la moitié d'une sélection dans l'état inverse.
 *
 * La règle : on ne dégage que si **tout** est déjà engagé ; sinon on engage.
 * Un seul intent part pour tout le groupe.
 */
import type { Intent, ObjectId } from '@mtg/shared';
import { useGame } from '../store/game.js';

export function allTapped(targets: ObjectId[]): boolean {
  const cards = useGame.getState().cards;
  return targets.length > 0 && targets.every((id) => cards.get(id)?.tapped === true);
}

export function tapIntent(targets: ObjectId[]): Intent {
  return { type: allTapped(targets) ? 'UNTAP' : 'TAP', cardIds: targets };
}

/**
 * Cibles d'un geste porté sur une carte : la sélection entière si la carte en
 * fait partie, la carte seule sinon.
 */
export function groupOf(cardId: ObjectId): ObjectId[] {
  const selection = useGame.getState().selection;
  return selection.has(cardId) && selection.size > 1 ? [...selection] : [cardId];
}
