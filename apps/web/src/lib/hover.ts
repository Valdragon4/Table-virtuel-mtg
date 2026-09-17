/**
 * Suivi de la carte sous le curseur.
 *
 * `pointerenter` / `pointerleave` suffisent tant que le curseur bouge. Ils ne
 * suffisent plus dès qu'une carte disparaît de sous un curseur immobile : après
 * un raccourci contextuel — jouer la carte survolée, par exemple — la carte
 * suivante se retrouve sous le curseur sans qu'aucun événement de pointeur ne
 * soit émis, et la touche suivante n'avait plus de cible.
 *
 * On mémorise donc la dernière position du pointeur et, à chaque changement du
 * jeu de cartes, on redemande au navigateur ce qui se trouve dessous. C'est de
 * la lecture du DOM, jamais une supposition sur l'état de la partie.
 */
import { useGame } from '../store/game.js';

let pointerX: number | null = null;
let pointerY: number | null = null;
let installed = false;
let frame: number | null = null;

/** Identifiant de la carte rendue sous un point de l'écran, s'il y en a une. */
function cardAt(x: number, y: number): string | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const holder = (element as HTMLElement).closest<HTMLElement>('[data-card]');
    const id = holder?.dataset['card'];
    if (id) return id;
  }
  return null;
}

function resolve(): void {
  frame = null;
  if (pointerX === null || pointerY === null) return;
  const found = cardAt(pointerX, pointerY);
  const state = useGame.getState();
  if (state.hoveredCardId !== found) state.setHovered(found);
}

/**
 * Installe le suivi. Idempotent : la table peut être montée et démontée sans
 * empiler les écouteurs.
 */
export function installHoverTracking(): () => void {
  if (installed) return () => undefined;
  installed = true;

  const onMove = (event: PointerEvent): void => {
    pointerX = event.clientX;
    pointerY = event.clientY;
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  // Le rendu suit le changement d'état : on attend la frame suivante pour
  // interroger un DOM à jour.
  const unsubscribe = useGame.subscribe((state, previous) => {
    if (state.cards === previous.cards) return;
    if (frame !== null) return;
    frame = window.requestAnimationFrame(resolve);
  });

  return () => {
    installed = false;
    window.removeEventListener('pointermove', onMove);
    unsubscribe();
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
  };
}
