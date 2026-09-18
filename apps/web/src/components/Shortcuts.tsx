/**
 * Raccourcis clavier de la table.
 *
 * Deux familles, et une seule règle d'arbitrage, écrite ici et nulle part
 * ailleurs :
 *
 *     carte survolée  >  sélection courante  >  action globale
 *
 * Un raccourci contextuel agit sur la carte sous le curseur ; s'il n'y en a
 * pas, sur la sélection ; si la touche n'a pas de sens dans la zone de cette
 * carte, on retombe sur l'action globale. C'est ce qui rend la collision
 * volontaire lisible : `S` met une carte sur la pile quand on en survole une,
 * et mélange la bibliothèque sinon.
 *
 * Pendant un glisser-déposer, le survol est ignoré : on est en train de
 * déplacer une carte, pas de la commander au clavier.
 *
 * Les mots-clés de Magic restent en anglais (scry, surveil, mill, mulligan).
 */
import { useEffect } from 'react';
import type { CardView, Intent, ObjectId, ZoneKind } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { useCloseOnEscape } from '../lib/overlay.js';
import { tapIntent } from '../lib/tap.js';
import { useT, type BoundT } from '../lib/i18n/index.js';

interface Binding {
  keys: string;
  label: string;
}

/*
 * Les tables de raccourcis sont des **fonctions** de `t`, et non des constantes
 * de module : leurs libellés changent avec la langue, et une constante figée à
 * l'import garderait la langue du premier chargement. Les lettres (`P`, `L`,
 * `Ctrl + Z`) ne se traduisent pas — ce sont les touches physiques ; seuls les
 * noms de touches nommées (`Entrée`, `Échap`, `Suppr`…) en sont.
 */

/** Raccourcis agissant sur la carte survolée (ou, à défaut, la sélection). */
const handBindings = (t: BoundT): Binding[] => [
  { keys: 'P', label: t('card.play') },
  { keys: 'M', label: t('card.playFaceDown') },
  { keys: 'S', label: t('card.toStack') },
  { keys: 'G', label: t('card.discard') },
  { keys: 'E', label: t('card.exile') },
  { keys: 'L', label: t('zone.libraryTop') },
  { keys: 'B', label: t('zone.libraryBottom') },
];

const permanentBindings = (t: BoundT): Binding[] => [
  { keys: 'T', label: t('shortcut.tapUntap') },
  { keys: 'F', label: t('card.transform') },
  { keys: 'M', label: t('shortcut.flipFace') },
  { keys: 'C', label: t('card.copyAsToken') },
  { keys: '+ / −', label: t('shortcut.plusCounter') },
  { keys: 'H', label: t('card.toHand') },
  { keys: `G / ${t('keys.delete')}`, label: t('card.toGraveyard') },
  { keys: 'E', label: t('card.exile') },
  { keys: 'L / B', label: t('shortcut.libraryTopBottom') },
];

const pileBindings = (t: BoundT): Binding[] => [
  { keys: 'P', label: t('card.toBattlefield') },
  { keys: 'H', label: t('card.toHand') },
  { keys: 'G / E', label: t('shortcut.graveyardOrExile') },
  { keys: 'L / B', label: t('shortcut.libraryTopBottom') },
];

/** Raccourcis agissant quand aucune carte n'est survolée. */
const globalBindings = (t: BoundT): Binding[] => [
  { keys: 'D', label: t('tableMenu.drawCard') },
  { keys: 'U', label: t('tableMenu.untapAll') },
  { keys: 'S', label: t('tableMenu.shuffleLibrary') },
  { keys: 'E', label: t('toolbar.passTurn') },
  { keys: 'Y', label: t('zoneMenu.scry1') },
  { keys: 'M', label: t('zoneMenu.mill1') },
  { keys: 'Ctrl + Z', label: t('toolbar.undo') },
  { keys: t('keys.enter'), label: t('shortcut.writeMessage') },
  { keys: t('keys.esc'), label: t('shortcut.clearSelection') },
  { keys: '?', label: t('shortcut.thisHelp') },
];

const pointerBindings = (t: BoundT): Binding[] => [
  { keys: t('keys.wheel'), label: t('shortcut.zoom') },
  { keys: t('keys.drag'), label: t('shortcut.lasso') },
  { keys: t('keys.altDrag'), label: t('shortcut.lassoAll') },
  { keys: t('keys.rightDrag'), label: t('shortcut.panTable') },
  { keys: t('keys.middleClick'), label: t('shortcut.panTableAnywhere') },
  { keys: t('keys.ctrlClick'), label: t('shortcut.toggleSelection') },
  { keys: t('keys.dragCard'), label: t('shortcut.dropInZone') },
  { keys: t('keys.doubleClick'), label: t('shortcut.tapUntap') },
  { keys: t('keys.rightClick'), label: t('shortcut.contextMenu') },
];

export function useShortcuts(onHelp: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      const state = useGame.getState();
      if (!state.mySeat) return;

      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        state.send({ type: 'UNDO_LAST' });
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape') {
        state.setSelection(new Set());
        state.openMenu(null);
        return;
      }

      // --- Arbitrage : carte survolée, sinon sélection, sinon global. -------
      const hovered = state.drag
        ? undefined
        : state.hoveredCardId
          ? state.cards.get(state.hoveredCardId)
          : undefined;
      const selected = [...state.selection]
        .map((id) => state.cards.get(id))
        .filter((card): card is CardView => Boolean(card));
      const focus = hovered ?? selected[0];
      const targets: ObjectId[] = hovered
        ? state.selection.has(hovered.id)
          ? [...state.selection]
          : [hovered.id]
        : selected.map((card) => card.id);

      if (focus && targets.length > 0) {
        const intents = contextualIntents(event.key, focus, targets);
        if (intents.length > 0) {
          event.preventDefault();
          for (const intent of intents) state.send(intent);
          return;
        }
      }

      // --- Aucune carte concernée, ou touche sans effet ici : global. -------
      const seat = state.mySeat;
      switch (event.key.toLowerCase()) {
        case 'd':
          state.send({ type: 'DRAW', count: 1 });
          break;
        case 'u':
          state.send({ type: 'UNTAP_ALL' });
          break;
        case 's':
          state.send({ type: 'SHUFFLE', zone: { seat, kind: 'LIBRARY' } });
          break;
        case 'e':
          state.send({ type: 'END_TURN' });
          break;
        case 'y':
          state.send({ type: 'LOOK', zone: { seat, kind: 'LIBRARY' }, count: 1, mode: 'SCRY' });
          break;
        /*
         * `M` comme « meuler », alors que `M` sert déjà, **sur une carte visée**,
         * à la poser ou la retourner face cachée.
         *
         * La surcharge n'est pas un accident : c'est le motif du fichier. `S`
         * range une carte sur la pile quand une carte est visée et mélange la
         * bibliothèque sinon ; `E` exile ou finit le tour. Le contextuel passe
         * toujours en premier, et l'on ne retombe ici que si aucune carte n'est
         * survolée ni sélectionnée — donc quand « meuler » est le seul sens
         * possible du geste.
         */
        case 'm':
          state.send({ type: 'MILL', count: 1 });
          break;
        case '?':
          onHelp();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Aucune dépendance d'état : tout est relu dans `useGame.getState()` au
    // moment de la frappe. Un écouteur qui capturerait `mySeat` au montage
    // resterait inerte, puisqu'il est monté avant qu'on ait un siège.
  }, [onHelp]);
}

/**
 * Intents d'un raccourci contextuel, selon la zone de la carte visée. Renvoie
 * une liste vide si la touche n'a pas de sens ici — l'appelant retombe alors
 * sur l'action globale.
 */
function contextualIntents(rawKey: string, focus: CardView, targets: ObjectId[]): Intent[] {
  const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
  const zone = (kind: ZoneKind) => ({ seat: focus.owner, kind });
  const move = (kind: ZoneKind, extra: Record<string, unknown> = {}): Intent[] =>
    targets.map((cardId) => ({ type: 'MOVE_CARD', cardId, to: zone(kind), ...extra }) as Intent);

  if (focus.zone.kind === 'HAND') {
    switch (key) {
      case 'p':
        return move('BATTLEFIELD', { x: 60, y: 60 });
      case 'm':
        return move('BATTLEFIELD', { x: 60, y: 60, faceDown: true });
      case 's':
        return move('STACK_NOTE');
      case 'g':
        return move('GRAVEYARD');
      case 'e':
        return move('EXILE');
      case 'l':
        return move('LIBRARY', { index: 'TOP' });
      case 'b':
        return move('LIBRARY', { index: 'BOTTOM' });
      default:
        return [];
    }
  }

  if (focus.zone.kind === 'BATTLEFIELD') {
    switch (key) {
      case 't':
        // Bascule de groupe : règle unique, dans `lib/tap.ts`.
        return [tapIntent(targets)];
      case 'f':
        return targets.map((cardId) => ({ type: 'FLIP_FACE', cardId }));
      case 'm':
        return targets.map((cardId) =>
          focus.faceDown ? { type: 'TURN_FACE_UP', cardId } : { type: 'TURN_FACE_DOWN', cardId },
        );
      case 'c':
        return [{ type: 'CREATE_TOKEN', copyOf: focus.id, x: focus.x + 24, y: focus.y + 24 }];
      case '+':
      case '=':
        return targets.map((targetId) => ({ type: 'ADD_COUNTER', targetId, kind: '+1/+1', delta: 1 }));
      case '-':
        return targets.map((targetId) => ({ type: 'ADD_COUNTER', targetId, kind: '+1/+1', delta: -1 }));
      case 'h':
        return move('HAND');
      case 'g':
      // `Suppr` est le second chemin vers le cimetière, et le plus attendu :
      // c'est la touche qu'on cherche quand un permanent meurt. Elle suit
      // exactement la règle d'arbitrage du fichier — la carte survolée, ou
      // toute la sélection si la carte survolée en fait partie — parce que
      // c'est `targets` qui la porte, et non ce `case`.
      case 'Delete':
        return move('GRAVEYARD');
      case 'e':
        return move('EXILE');
      case 'l':
        return move('LIBRARY', { index: 'TOP' });
      case 'b':
        return move('LIBRARY', { index: 'BOTTOM' });
      default:
        return [];
    }
  }

  if (['GRAVEYARD', 'EXILE', 'COMMAND', 'STACK_NOTE'].includes(focus.zone.kind)) {
    switch (key) {
      case 'p':
        return move('BATTLEFIELD', { x: 60, y: 60 });
      case 'h':
        return move('HAND');
      case 'g':
        return focus.zone.kind === 'GRAVEYARD' ? [] : move('GRAVEYARD');
      case 'e':
        return focus.zone.kind === 'EXILE' ? [] : move('EXILE');
      case 'l':
        return move('LIBRARY', { index: 'TOP' });
      case 'b':
        return move('LIBRARY', { index: 'BOTTOM' });
      default:
        return [];
    }
  }

  return [];
}

/**
 * Aide des raccourcis.
 *
 * C'est la première chose qu'un joueur ouvre en découvrant la table, donc elle
 * se lit d'un coup d'œil : deux familles annoncées, des touches dessinées, une
 * ligne par geste, et la règle d'arbitrage en tête — parce que c'est elle, et
 * non la liste, qui explique pourquoi `S` fait deux choses.
 *
 * Palette : celle de `docs/ui-reference.md` (panneau `#1f2937`, bordure
 * `#374151`, accent doré pour ce qui compte). Les mots-clés de Magic restent
 * en anglais, le reste en français.
 */
export function ShortcutsHelp({ onClose }: { onClose: () => void }): React.ReactElement {
  const t = useT();
  useCloseOnEscape(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        aria-label={t('toolbar.shortcuts')}
        aria-modal
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-edge bg-[#151c28] shadow-2xl shadow-black/70"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="flex items-start gap-4 border-b border-edge bg-panel/70 px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight text-slate-100">
              {t('toolbar.shortcuts')}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              {t('shortcut.ruleLead')}{' '}
              <span className="font-medium text-amber-200/90">{t('shortcut.ruleUnderCursor')}</span>
              {t('shortcut.ruleOtherwise')}{' '}
              <span className="font-medium text-sky-300/90">{t('shortcut.ruleSelection')}</span>
              {t('shortcut.ruleOtherwise')}{' '}
              <span className="font-medium text-slate-200">{t('shortcut.ruleTable')}</span>.
            </p>
          </div>
          <button
            aria-label={t('common.close')}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge text-slate-400 transition hover:border-slate-500 hover:bg-white/5 hover:text-slate-100"
            onClick={onClose}
            type="button"
          >
            <svg aria-hidden fill="none" height="14" viewBox="0 0 14 14" width="14">
              <path
                d="M1.5 1.5 L12.5 12.5 M12.5 1.5 L1.5 12.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.6"
              />
            </svg>
          </button>
        </header>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">
          <Group hint={t('shortcut.groupHoverHint')} title={t('shortcut.groupHover')}>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <Section bindings={handBindings(t)} title={t('shortcut.sectionHand')} />
              <Section bindings={permanentBindings(t)} title={t('shortcut.sectionPermanent')} />
              <Section bindings={pileBindings(t)} title={t('shortcut.sectionPile')} />
            </div>
          </Group>

          <Group hint={t('shortcut.groupTableHint')} title={t('shortcut.groupTable')}>
            <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
              <Section bindings={globalBindings(t)} title={t('shortcut.sectionGlobal')} />
              <Section bindings={pointerBindings(t)} title={t('shortcut.sectionMouse')} />
            </div>
          </Group>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-edge bg-panel/50 px-6 py-3 text-[11px] text-slate-500">
          <span>{t('shortcut.footerClose')}</span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">?</kbd> {t('shortcut.footerReopen')}
          </span>
        </footer>
      </div>
    </div>
  );
}

/** Famille de raccourcis : un titre, une phrase d'explication, puis ses colonnes. */
function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-2.5 flex items-baseline gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/80">
          {title}
        </h3>
        <span className="h-px flex-1 bg-edge" />
      </div>
      <p className="mb-3 max-w-2xl text-[11px] leading-relaxed text-slate-500">{hint}</p>
      {children}
    </section>
  );
}

function Section({ title, bindings }: { title: string; bindings: Binding[] }): React.ReactElement {
  return (
    <div>
      <h4 className="mb-2 border-b border-edge/60 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {title}
      </h4>
      <dl className="space-y-0.5">
        {bindings.map((binding) => (
          <div
            className="flex items-center justify-between gap-3 rounded px-1 py-[3px] transition-colors hover:bg-white/[0.04]"
            key={binding.keys}
          >
            <dt className="shrink-0">
              <Keys keys={binding.keys} />
            </dt>
            <dd className="text-right text-[13px] leading-snug text-slate-300">{binding.label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Touches dessinées. `Ctrl + Z` se lit comme une combinaison, `L / B` comme un
 * choix : le séparateur est conservé entre les pastilles au lieu d'être noyé
 * dans une chaîne monospace.
 */
function Keys({ keys }: { keys: string }): React.ReactElement {
  const parts = keys.split(/\s+(\+|\/)\s+/);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {parts.map((part, index) =>
        // `split` avec un groupe capturant intercale les séparateurs aux rangs
        // impairs. On teste le rang, et non le texte : sans cela la touche `+`
        // de « + / − » serait prise pour le liant d'une combinaison.
        index % 2 === 1 ? (
          <span className="kbd-join" key={index}>
            {part}
          </span>
        ) : (
          <kbd className="kbd" key={index}>
            {part}
          </kbd>
        ),
      )}
    </span>
  );
}
