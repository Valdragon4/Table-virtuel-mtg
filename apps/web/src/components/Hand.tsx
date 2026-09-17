import { useEffect, useRef, useState } from 'react';
import type { CardView } from '@mtg/shared';
import { CardSprite } from './CardSprite.js';
import { useGame, zoneKey } from '../store/game.js';
import { zoneAttr } from '../lib/drag.js';
import { HOVER_HEADROOM, handRailHeight, handScale } from '../lib/handMetrics.js';
import { dragJustEnded, startCardDrag } from './DragLayer.js';

/**
 * Recouvrement entre deux cartes de la main, en pixels.
 *
 * Il se resserre à mesure que la main grossit : à sept cartes on les étale, à
 * vingt on les serre comme un vrai éventail. En deçà de `TIGHT`, on ne serre
 * plus — une carte doit rester reconnaissable à son bord gauche.
 */
const LOOSE = 26;
const TIGHT = 116;

/**
 * La marge de survol est **comptée dans la hauteur du rail**, et c'est
 * délibéré : agrandir le rail le ferait mordre sur le bas du champ de bataille,
 * qui est cliquable et où l'on pose des cartes. Le soulèvement est donc court —
 * huit pixels et un passage au premier plan, ce qui suffit à dire « cette
 * carte-ci », l'aperçu agrandi faisant le reste.
 */

function overlapFor(count: number): number {
  return Math.min(TIGHT, LOOSE + Math.max(0, count - 8) * 9);
}

/**
 * Main du joueur local : rail bas, cartes grandes et lisibles, légèrement
 * superposées et remontant au survol. La main des autres n'est qu'un compteur.
 *
 * **Débordement.** Une main de Commander dépasse couramment la largeur de
 * l'écran. Deux issues : passer sur deux rangées, ou défiler. On défile, et la
 * raison est concrète — une seconde rangée mange une carte de haut sur un
 * écran qui n'en a pas de trop, oblige à choisir laquelle des deux rangées est
 * « devant » quand on glisse une carte vers la table, et casse l'éventail
 * continu où l'on repère ses cartes par leur rang. Le resserrement absorbe la
 * plupart des cas, le défilement fait le reste.
 *
 * La molette est déjà le zoom de la table : elle n'est captée **que** sur le
 * rail lui-même, où elle fait défiler l'éventail. Le rail n'est pas un
 * descendant de la surface de table, le geste de zoom n'est donc jamais
 * atteint — on arrête tout de même la propagation, pour que cela reste vrai si
 * la page était réorganisée.
 */
export function Hand({
  onCardDoubleClick,
}: {
  onCardDoubleClick: (card: CardView) => void;
}): React.ReactElement | null {
  const mySeat = useGame((s) => s.mySeat);
  const cards = useGame((s) => s.cards);
  const seats = useGame((s) => s.seats);
  const openMenu = useGame((s) => s.openMenu);
  const selection = useGame((s) => s.selection);
  const setSelection = useGame((s) => s.setSelection);
  const toggleSelected = useGame((s) => s.toggleSelected);
  const rail = useRef<HTMLDivElement>(null);
  /*
   * La taille des cartes suit la fenêtre. On la garde en état plutôt que de la
   * lire au rendu : sans écouteur, un redimensionnement laisserait le rail à
   * l'échelle d'avant jusqu'au prochain event de jeu.
   */
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1600 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));

  useEffect(() => {
    const onResize = (): void =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  /** Ancre d'une sélection par plage, comme dans le panneau des zones. */
  const anchor = useRef<string | null>(null);

  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    // Écouteur natif et non `onWheel` : React pose ses écouteurs de molette en
    // mode passif, où `preventDefault()` est sans effet — et sans lui, le
    // geste remonterait à la page.
    const onWheel = (event: WheelEvent): void => {
      if (node.scrollWidth <= node.clientWidth) return;
      event.preventDefault();
      event.stopPropagation();
      node.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX;
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  if (!mySeat) return null;
  const me = seats.find((s) => s.id === mySeat);
  const hand = [...cards.values()]
    .filter((c) => c.zone.seat === mySeat && c.zone.kind === 'HAND')
    .sort((a, b) => a.sortIndex - b.sortIndex);
  const scale = handScale(viewport.width, viewport.height);
  // Le recouvrement est exprimé à l'échelle de référence : il doit suivre la
  // carte, sinon des cartes réduites se chevaucheraient de travers.
  const overlap = overlapFor(hand.length) * scale;

  /**
   * Sélection dans la main.
   *
   * Elle manquait purement et simplement : une carte de main ne pouvait entrer
   * dans la sélection que par un lasso qui la balayait au passage, donc par
   * accident. Tout geste sur plusieurs cartes de main était par conséquent
   * unitaire — défausser trois cartes coûtait trois intents et trois lignes de
   * journal, là où le champ de bataille n'en coûte qu'une.
   *
   * Le reste de la chaîne était déjà prêt : le menu contextuel agit sur la
   * sélection, et un lot hors champ de bataille part en un seul `MOVE_CARDS`.
   */
  function pick(card: CardView, event: React.MouseEvent | React.PointerEvent): void {
    if (event.ctrlKey || event.metaKey) {
      toggleSelected(card.id, true);
      anchor.current = card.id;
      return;
    }
    if (event.shiftKey && anchor.current) {
      const from = hand.findIndex((c) => c.id === anchor.current);
      const to = hand.findIndex((c) => c.id === card.id);
      if (from >= 0 && to >= 0) {
        const [a, b] = from <= to ? [from, to] : [to, from];
        setSelection(new Set(hand.slice(a, b + 1).map((c) => c.id)));
        return;
      }
    }
    // Un clic net : cette carte seule, ou rien si elle l'était déjà.
    setSelection(selection.has(card.id) && selection.size === 1 ? new Set() : new Set([card.id]));
    anchor.current = card.id;
  }

  return (
    <div
      ref={rail}
      /* `w-fit` tant que la main tient à l'écran : le rail ne doit pas
         recouvrir les contrôles flottants des coins bas. Au-delà, il se borne
         à la largeur disponible et défile. */
      className="scrollbar-thin pointer-events-auto mx-auto flex w-fit max-w-[calc(100vw-340px)] items-end justify-start overflow-x-auto overflow-y-hidden px-4"
      data-test="hand-rail"
      data-zone={zoneAttr({ seat: mySeat, kind: 'HAND' })}
      style={{
        minHeight: handRailHeight(viewport.width, viewport.height),
        paddingTop: HOVER_HEADROOM,
      }}
    >
      {hand.length === 0 ? (
        <p className="mx-auto pb-6 text-xs text-slate-600">Main vide</p>
      ) : (
        hand.map((card, index) => (
          <div
            key={card.id}
            className="group relative shrink-0 transition-transform duration-150 hover:z-20 hover:-translate-y-2"
            // Le repère que lit `handInsertIndex` : c'est le rail rendu qui fait
            // foi pour savoir où une carte lâchée doit s'insérer.
            data-hand-card={card.id}
            style={{ marginLeft: index === 0 ? 0 : -overlap, zIndex: index }}
          >
            <CardSprite
              card={card}
              cardBackUrl={me?.cardBackUrl}
              scale={scale}
              /* Le lasso balaie tout le DOM, rail de main compris : une carte
                 de main prise par le tracé entrait dans la sélection sans que
                 rien ne le montre, et l'action groupée suivante l'emportait. */
              selected={selection.has(card.id)}
              onPointerDown={(event) => {
                // Ctrl + clic ajoute à la sélection sans rien déplacer : c'est
                // le même geste que sur le champ de bataille.
                if (event.ctrlKey || event.metaKey || event.shiftKey) {
                  event.stopPropagation();
                  pick(card, event);
                  return;
                }
                startCardDrag(card, event);
              }}
              onClick={(event) => {
                // Un dépôt se termine par un `click` : il ne doit pas compter
                // comme une sélection. Un `click` suit aussi le Ctrl + clic
                // déjà traité au `pointerdown` : le laisser passer défaisait
                // aussitôt ce qu'on venait d'ajouter à la sélection.
                if (dragJustEnded()) return;
                if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                setSelection(
                  selection.has(card.id) && selection.size === 1 ? new Set() : new Set([card.id]),
                );
                anchor.current = card.id;
              }}
              onDoubleClick={() => onCardDoubleClick(card)}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu({ kind: 'CARD', card, x: event.clientX, y: event.clientY });
              }}
            />
          </div>
        ))
      )}
    </div>
  );
}

/** Compteur de cartes en main d'un adversaire, affiché dans son bandeau. */
export function handCount(seatId: string): number {
  return useGame.getState().zoneCounts.get(zoneKey({ seat: seatId, kind: 'HAND' })) ?? 0;
}
