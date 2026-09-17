/**
 * Couche de glisser-déposer, unique pour toute la table.
 *
 * Elle écoute les mouvements au niveau de la fenêtre : une carte saisie dans la
 * main peut donc être lâchée sur le champ de bataille, une carte du cimetière
 * renvoyée en bibliothèque, un commandant sorti de sa zone — sans que chaque
 * zone ait à réimplémenter le geste.
 *
 * Deux choix de performance, tous deux mesurables :
 *
 * 1. Pendant le geste, **rien ne passe par React**. La position du pointeur vit
 *    dans `dragPointer` et cette couche écrit elle-même le `transform` du
 *    fantôme. Faire transiter la position par le store re-rendait la table
 *    entière — tous les sièges, tous les sprites — à la fréquence du pointeur.
 *
 * 2. Au relâchement, la nouvelle position sur un champ de bataille est appliquée
 *    localement sans attendre l'aller-retour serveur. C'est la seule prédiction
 *    que le protocole autorise (§10) : cosmétique, réversible, et réconciliée
 *    par l'event qui suit — ou annulée sur `reject`.
 */
import { useEffect, useRef } from 'react';
import type { CardView, Intent, ObjectId, ZoneRef } from '@mtg/shared';
import { useGame, zoneKey } from '../store/game.js';
import { dragPointer, findDropTarget, handInsertIndex, type DropTarget } from '../lib/drag.js';
import { CARD_HEIGHT, CARD_WIDTH } from '../lib/cards.js';
import { CardSprite } from './CardSprite.js';

/**
 * Décalage entre deux cartes posées d'un même geste depuis la main. Assez pour
 * que le coin de chacune reste visible, assez peu pour qu'elles se lisent comme
 * un groupe et non comme un éparpillement.
 */
const FAN_STEP_X = 26;
const FAN_STEP_Y = 18;

/** Échelle de la carte fantôme : lisible, sans masquer la cible. */
const GHOST_SCALE = 0.62;

/** Démarre un glissement depuis n'importe quel composant affichant une carte. */
export function startCardDrag(card: CardView, event: React.PointerEvent): void {
  if (event.button !== 0) return;
  event.stopPropagation();
  // Surtout pas de `preventDefault()` ici : annuler le `pointerdown` supprime
  // les événements souris de compatibilité, donc `click` et `dblclick` — le
  // double-clic pour engager ne partait jamais. Le glissement d'image et la
  // sélection de texte sont déjà neutralisés par `draggable={false}` et
  // `select-none` sur le sprite.
  useGame.getState().beginDrag(card.id, event.clientX, event.clientY);
}

/**
 * Un dépôt se termine par un `click` sur ce qui se trouvait sous le curseur —
 * typiquement le bouton d'une pile, qui ouvrirait sa fenêtre. Les composants
 * qui portent à la fois un dépôt et un clic interrogent ce garde-fou.
 */
let lastDropAt = 0;
export function dragJustEnded(): boolean {
  return Date.now() - lastDropAt < 300;
}

/** Position écran du fantôme, centré sur le curseur. */
function ghostTransform(): string {
  const left = dragPointer.x - (CARD_WIDTH * GHOST_SCALE) / 2;
  const top = dragPointer.y - (CARD_HEIGHT * GHOST_SCALE) / 2;
  return `translate3d(${left}px, ${top}px, 0)`;
}

/**
 * Nom lisible d'une zone, pour la pastille qui suit le fantôme.
 */
const ZONE_LABELS: Record<string, string> = {
  BATTLEFIELD: 'champ de bataille',
  HAND: 'main',
  GRAVEYARD: 'cimetière',
  EXILE: 'exil',
  LIBRARY: 'bibliothèque',
  COMMAND: 'zone de commandement',
  SIDEBOARD: 'réserve',
  STACK_NOTE: 'pile',
  FACEDOWN_TEMP: 'pile face cachée',
};

/**
 * Cible mise en évidence pendant le geste.
 *
 * Elle est marquée **hors de React**, en écrivant directement sur le nœud
 * `[data-zone]`, exactement comme le lasso marque ses prises : un surlignage à
 * la fréquence du pointeur qui passerait par le store re-rendrait la table
 * entière, c'est-à-dire le coût qu'on vient d'éliminer du glisser-déposer.
 */
let markedZone: HTMLElement | null = null;
function markZone(node: HTMLElement | null, color: string | null): void {
  if (markedZone === node) {
    if (node && color) node.style.outlineColor = color;
    return;
  }
  if (markedZone) {
    markedZone.style.outline = '';
    markedZone.style.outlineOffset = '';
    markedZone.style.outlineColor = '';
  }
  markedZone = node;
  if (node && color) {
    node.style.outline = `3px solid ${color}`;
    node.style.outlineOffset = '-3px';
  }
}

/** Nœud DOM déclarant cette zone, celui-là même qu'a trouvé `findDropTarget`. */
function zoneNode(zone: ZoneRef): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-zone="${zone.seat}|${zone.kind}"]`);
}

/**
 * Qualification d'un dépôt, calculée pendant le geste comme au relâchement.
 *
 * Les trois refus qu'elle nomme étaient jusqu'ici silencieux : lâcher hors de
 * toute zone, lâcher là d'où l'on vient, et — le plus grave — lâcher sur le
 * terrain du voisin, ce que le serveur accepte et qui donne la carte.
 */
type Verdict =
  | { kind: 'OK'; target: DropTarget; color: string; label: string }
  | { kind: 'NONE' }
  | { kind: 'SAME'; target: DropTarget }
  | { kind: 'REORDER'; target: DropTarget; color: string; label: string }
  | { kind: 'FOREIGN'; target: DropTarget; color: string; label: string };

function judge(card: CardView, target: DropTarget | null, altKey: boolean): Verdict {
  if (!target) return { kind: 'NONE' };
  const state = useGame.getState();
  const seat = state.seats.find((s) => s.id === target.zone.seat);
  const color = seat?.color ?? '#38bdf8';
  const label = `${ZONE_LABELS[target.zone.kind] ?? target.zone.kind}${
    seat && seat.id !== state.mySeat ? ` de ${seat.displayName}` : ''
  }`;

  if (zoneKey(target.zone) === zoneKey(card.zone) && target.zone.kind !== 'BATTLEFIELD') {
    /*
     * Sa propre main fait exception : on y range ses cartes. Un joueur groupe
     * ses terrains, met ses sorts à droite, garde sa pioche à part — c'est un
     * geste de vraie table, et il n'avait ici aucune traduction. Ailleurs,
     * relâcher une carte dans la zone d'où elle vient ne veut rien dire.
     */
    if (target.zone.kind === 'HAND' && target.zone.seat === state.mySeat) {
      return { kind: 'REORDER', target, color, label: 'votre main' };
    }
    return { kind: 'SAME', target };
  }
  // Poser une carte sur le terrain d'un autre siège, c'est la lui donner. Le
  // protocole l'autorise (la table s'auto-arbitre), mais cela ne doit jamais
  // arriver par un geste imprécis : il faut le dire, et le confirmer par Alt —
  // la même touche que le lasso élargi.
  if (target.zone.seat !== state.mySeat && target.zone.kind === 'BATTLEFIELD' && !altKey) {
    return { kind: 'FOREIGN', target, color, label };
  }
  return { kind: 'OK', target, color, label };
}

/**
 * Ranger sa main : on y insère les cartes tenues à l'endroit visé.
 *
 * Chaque carte part dans son propre `MOVE_CARD` avec un index qui avance :
 * `MOVE_CARDS` insère tout le lot au **même** index et en renverserait l'ordre.
 * Cela ne coûte rien au journal — un déplacement au sein d'une même zone n'y
 * écrit pas de ligne — et l'ordre relatif du lot est préservé.
 */
function reorderHand(card: CardView, clientX: number): void {
  const state = useGame.getState();
  const group =
    state.selection.has(card.id) && state.selection.size > 1 ? [...state.selection] : [card.id];
  // On ne range que des cartes de sa propre main : une sélection peut mêler des
  // permanents du terrain, qui n'ont rien à faire ici.
  const moving = group
    .map((id) => state.cards.get(id))
    .filter((c): c is CardView => c !== undefined && zoneKey(c.zone) === zoneKey(card.zone))
    .sort((a, b) => a.sortIndex - b.sortIndex);
  if (moving.length === 0) return;

  const drop = handInsertIndex(clientX, new Set(moving.map((c) => c.id)));
  if (!drop) return;

  moving.forEach((moved, rank) => {
    state.send({ type: 'MOVE_CARD', cardId: moved.id, to: card.zone, index: drop.index + rank });
  });
}

export function DragLayer(): React.ReactElement | null {
  const drag = useGame((s) => s.drag);
  const cards = useGame((s) => s.cards);
  const ghost = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  /** La fente d'insertion montrée quand on range sa main. */
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drag) return;

    let frame: number | null = null;
    let altHeld = false;
    const paint = (): void => {
      frame = null;
      if (ghost.current) ghost.current.style.transform = ghostTransform();

      // Cible sous le curseur, à chaque frame. C'est un `elementsFromPoint`,
      // du même prix que l'écriture de transform ci-dessus, et c'est ce qui
      // répond enfin à « mon geste va-t-il aboutir là où je crois ? ».
      const state = useGame.getState();
      const dragged = state.drag ? state.cards.get(state.drag.cardId) : undefined;
      if (!dragged) return;
      const verdict = judge(
        dragged,
        findDropTarget(dragPointer.x, dragPointer.y, state.viewScale),
        altHeld,
      );

      const chip = hint.current;
      if (verdict.kind !== 'REORDER' && slot.current) slot.current.style.display = 'none';
      switch (verdict.kind) {
        case 'OK':
          markZone(zoneNode(verdict.target.zone), verdict.color);
          if (chip) {
            chip.textContent = verdict.label;
            chip.style.background = verdict.color;
            chip.style.display = 'block';
          }
          if (ghost.current) ghost.current.style.opacity = '0.9';
          break;
        case 'FOREIGN':
          markZone(zoneNode(verdict.target.zone), '#f59e0b');
          if (chip) {
            chip.textContent = `${verdict.label} — Alt pour donner la carte`;
            chip.style.background = '#b45309';
            chip.style.display = 'block';
          }
          if (ghost.current) ghost.current.style.opacity = '0.45';
          break;
        case 'REORDER': {
          // Pas de liseré de zone ici : ce n'est pas « où va la carte », c'est
          // « entre quelles deux cartes ». On montre donc la fente elle-même.
          markZone(null, null);
          const drop = handInsertIndex(
            dragPointer.x,
            new Set(
              state.selection.has(dragged.id) && state.selection.size > 1
                ? [...state.selection]
                : [dragged.id],
            ),
          );
          const bar = slot.current;
          if (bar && drop) {
            const rail = document.querySelector<HTMLElement>('[data-test="hand-rail"]');
            const rect = rail?.getBoundingClientRect();
            bar.style.display = 'block';
            bar.style.transform = `translate(${Math.round(drop.x) - 1}px, ${Math.round(rect?.top ?? 0)}px)`;
            bar.style.height = `${Math.round(rect?.height ?? 200)}px`;
            bar.style.background = verdict.color;
          }
          if (chip) chip.style.display = 'none';
          if (ghost.current) ghost.current.style.opacity = '0.9';
          break;
        }
        case 'SAME':
          markZone(zoneNode(verdict.target.zone), '#64748b');
          if (chip) {
            chip.textContent = 'déjà là';
            chip.style.background = '#475569';
            chip.style.display = 'block';
          }
          if (ghost.current) ghost.current.style.opacity = '0.45';
          break;
        default:
          markZone(null, null);
          if (chip) chip.style.display = 'none';
          if (ghost.current) ghost.current.style.opacity = '0.45';
      }
    };

    const move = (event: PointerEvent): void => {
      altHeld = event.altKey;
      useGame.getState().updateDrag(event.clientX, event.clientY);
      // Une seule écriture de style par frame, jamais une par événement.
      if (frame === null) frame = window.requestAnimationFrame(paint);
    };

    const up = (event: PointerEvent): void => {
      const state = useGame.getState();
      const current = state.drag;
      state.endDrag();
      if (!current) return;

      const card = state.cards.get(current.cardId);
      if (!card) return;

      // Un clic sans déplacement n'est pas un dépôt : on laisse passer le clic.
      if (!current.moved) return;
      lastDropAt = Date.now();

      markZone(null, null);
      if (hint.current) hint.current.style.display = 'none';

      const verdict = judge(
        card,
        findDropTarget(event.clientX, event.clientY, state.viewScale),
        event.altKey,
      );
      if (verdict.kind === 'NONE') {
        useGame.setState({ lastReject: 'Lâchée hors de toute zone : la carte reste où elle était.' });
        return;
      }
      if (verdict.kind === 'FOREIGN') {
        useGame.setState({
          lastReject: `Pour poser cette carte sur le ${verdict.label}, maintenez Alt : c'est la lui donner.`,
        });
        return;
      }
      if (verdict.kind === 'SAME') return;

      if (verdict.kind === 'REORDER') {
        reorderHand(card, event.clientX);
        return;
      }
      const target = verdict.target;

      // Une action groupée ne vaut que si la carte saisie fait partie de la
      // sélection ; sinon, on ne déplace que celle qu'on tient.
      const group =
        state.selection.has(card.id) && state.selection.size > 1
          ? [...state.selection]
          : [card.id];

      /*
       * Un lot est un lot. Hors du champ de bataille, où chaque carte porte ses
       * propres coordonnées, quatre cartes glissées ensemble partaient en
       * quatre `MOVE_CARD` : quatre lignes de journal, et un `Ctrl+Z` qui n'en
       * ramenait qu'une. Un seul `MOVE_CARDS` dit la vérité du geste.
       */
      if (group.length > 1 && target.zone.kind !== 'BATTLEFIELD') {
        for (const id of group) {
          const moved = state.cards.get(id);
          if (moved?.attachedTo) state.send({ type: 'DETACH', sourceId: id });
        }
        state.send({
          type: 'MOVE_CARDS',
          cardIds: group,
          to: target.zone,
          ...(target.zone.kind === 'LIBRARY' ? { index: 'TOP' as const } : {}),
        });
        return;
      }

      // Des cartes qui viennent d'une zone sans coordonnées — la main, un
      // cimetière, une pile — ont toutes x = y = 0 : les poser telles quelles
      // les empilerait exactement, et on croirait n'en avoir posé qu'une. On les
      // étale donc en cascade, assez pour voir le coin de chacune.
      const fanned = group.length > 1 && card.zone.kind !== 'BATTLEFIELD';
      let rank = 0;
      /**
       * Ce que le geste emmène. Sert à distinguer « on arrache l'aura de sa
       * créature » de « on déplace la créature **et** son aura d'un bloc ».
       */
      const travelling = new Set(group);

      for (const id of group) {
        const moved = state.cards.get(id);
        if (!moved) continue;
        const step = rank++;

        /*
         * Détacher — mais seulement quand le porteur, lui, reste en arrière.
         *
         * Une carte attachée se rend sous sa cible et la suit : ses propres
         * coordonnées ne sont plus lues. La tirer seule à un autre endroit
         * n'aurait donc aucun effet visible, et c'est déroutant. On la détache,
         * comme on retire un équipement en le faisant glisser hors de la
         * créature.
         *
         * Quand le lasso a pris **les deux** — le permanent et ce qui lui est
         * attaché — le geste dit exactement l'inverse : « emmène ce bloc ».
         * Détacher ici défaisait le lien à chaque déplacement de groupe, et
         * l'aura, rendue à ses propres coordonnées restées en arrière, partait
         * de travers. À une vraie table, on ne sépare une aura de son permanent
         * que par un geste explicite (« Détacher ») ; déplacer les deux ensemble
         * ne les sépare pas. Le porteur voyage avec elle : on garde le lien, et
         * la translation appliquée ci-dessous est la même pour tout le lot, donc
         * l'écart relatif du couple est préservé.
         */
        if (moved.attachedTo && !travelling.has(moved.attachedTo)) {
          state.send({ type: 'DETACH', sourceId: id });
        }
        // Le groupe garde sa forme : chaque carte conserve son écart à celle
        // qu'on tient réellement.
        const toBattlefield = target.zone.kind === 'BATTLEFIELD';
        const spread = toBattlefield && fanned ? { x: step * FAN_STEP_X, y: step * FAN_STEP_Y } : { x: 0, y: 0 };
        const x = Math.max(0, target.x + (toBattlefield && !fanned ? moved.x - card.x : 0) + spread.x);
        const y = Math.max(0, target.y + (toBattlefield && !fanned ? moved.y - card.y : 0) + spread.y);

        const intent: Intent = {
          type: 'MOVE_CARD',
          cardId: id,
          to: target.zone,
          ...(toBattlefield ? { x, y } : {}),
          ...(target.zone.kind === 'LIBRARY' ? { index: 'TOP' as const } : {}),
        };
        const cid = state.send(intent);

        // Prédiction locale : uniquement un déplacement au sein d'un champ de
        // bataille, c'est-à-dire un changement de coordonnées et rien d'autre.
        // Un changement de zone touche à des comptes et à de l'information
        // cachée : il attend le serveur.
        if (toBattlefield && moved.zone.kind === 'BATTLEFIELD' && zoneKey(moved.zone) === zoneKey(target.zone)) {
          state.predictMove(id, x, y, cid);
        }
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      markZone(null, null);
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag?.cardId]);

  if (!drag?.moved) return null;
  const card = cards.get(drag.cardId);
  if (!card) return null;

  const selection = useGame.getState().selection;
  const others: ObjectId[] = [...selection].filter((id) => id !== card.id);
  const grouped = selection.has(card.id) && others.length > 0;

  return (
    <>
    {/* La fente d'insertion de la main. Elle vit hors du fantôme, qui porte sa
        propre transformation : accrochée à lui, elle suivrait le curseur au
        lieu de rester entre deux cartes. */}
    <div
      ref={slot}
      className="pointer-events-none fixed left-0 top-0 z-[55] w-0.5 rounded-full opacity-90"
      data-test="hand-slot"
      style={{ display: 'none' }}
    />
    <div
      ref={ghost}
      className="pointer-events-none fixed left-0 top-0 z-50 opacity-90"
      /* Le fantôme est centré sur le curseur, exactement comme le point de
         dépôt calculé par `findDropTarget` : ce qu'on voit est ce qu'on pose.
         La position initiale est posée ici, les suivantes par `paint()`. */
      style={{ transform: ghostTransform(), willChange: 'transform' }}
    >
      <CardSprite card={card} scale={GHOST_SCALE} />
      {/* Nom de la cible sous le curseur. Écrit hors de React, comme le reste
          du geste : c'est du texte posé sur un nœud, pas un rendu. */}
      <span
        ref={hint}
        className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium text-white shadow"
        data-test="drop-hint"
        style={{ display: 'none' }}
      />
      {grouped && (
        <span className="absolute -right-2 -top-2 rounded bg-sky-500 px-1.5 text-[11px] font-semibold text-white">
          +{others.length}
        </span>
      )}
    </div>
    </>
  );
}
