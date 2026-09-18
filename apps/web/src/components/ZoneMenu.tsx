/**
 * Menu contextuel d'une pile : bibliothèque, cimetière, exil.
 *
 * Sur sa propre bibliothèque on peut fouiller, meuler, exiler du dessus ; sur
 * celle d'un adversaire, rien — c'est une zone dont on ne connaît que le compte.
 *
 * **Une action, une ligne.** Les gestes qui portent un nombre — piocher, scry,
 * surveil, regarder, meuler, exiler — se faisaient à un exemplaire dans
 * l'immense majorité des cas, et une modale s'ouvrait quand même pour y taper
 * « 1 ». On avait donc fini par doubler les entrées : « Surveil… » et
 * « Surveil 1 » cohabitaient, comme « Meuler 1 » et « Meuler X… ». Le menu y a
 * gagné quatre lignes et un doublon par geste.
 *
 * Chaque geste tient désormais sur **une seule ligne, avec deux cibles de
 * clic** : le libellé agit tout de suite à 1, le petit « X… » de droite ouvre
 * la saisie du nombre. Les entrées sans nombre — fouiller, mélanger, mulligan,
 * ouvrir le panneau — restent des lignes simples.
 */
import { useEffect, useRef } from 'react';
import type { SeatId, ZoneRef } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { useMenuPlacement } from '../lib/menu.js';
import { askNumber, openDialog } from './Dialog.js';
import { useT } from '../lib/i18n/index.js';

/**
 * Une ligne du menu.
 *
 * `more` est l'action secondaire de la même ligne : elle demande un nombre puis
 * rejoue le même geste. Sans elle, la ligne n'a qu'une cible de clic.
 */
interface Entry {
  label: string;
  run: () => void;
  separatorBefore?: boolean;
  more?: {
    /** Question du dialogue de saisie. */
    question: string;
    /** Valeur proposée par défaut — celle qu'on tape le plus souvent après 1. */
    initial: number;
    run: (count: number) => void;
  };
}

export function ZoneMenu({
  zone,
  x,
  y,
  onClose,
}: {
  zone: ZoneRef;
  x: number;
  y: number;
  onClose: () => void;
}): React.ReactElement | null {
  const t = useT();
  const send = useGame((s) => s.send);
  const mySeat = useGame((s) => s.mySeat);
  const seats = useGame((s) => s.seats);
  const topReveals = useGame((s) => s.topReveals);
  const mine = zone.seat === mySeat;
  const { ref, style } = useMenuPlacement(x, y);

  // Sans ça, le voile plein écran du menu restait et avalait tous les clics.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    useGame.getState().setHovered(null);
    useGame.getState().hoverPreview(null);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
    };
    /*
     * En **capture**, comme `CardMenu`, `TableMenu`, `Dialog` et `LookModal`.
     *
     * Tous ces voisins écoutent `Échap` en capture et appellent
     * `stopPropagation()`. Un écouteur posé ici en bouillonnement ne recevrait
     * donc jamais la touche dès que l'un d'eux est monté : le menu de zone
     * resterait ouvert, et son voile plein écran avalerait tous les clics
     * suivants. Le cas s'est produit — le drapeau avait été retiré par
     * inadvertance, et dix étapes saines de `verify-ui` tombaient en cascade.
     */
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /**
   * « Combien ? », par un vrai dialogue.
   *
   * Le menu se referme dès le clic — c'est le dialogue, dans sa propre racine,
   * qui prend la suite. L'appel n'est donc plus une valeur de retour mais une
   * suite donnée en argument : `window.prompt` rendait la main tout de suite
   * parce qu'il gelait la page, ce dialogue ne gèle rien.
   */
  const ask = (question: string, fallback: string, use: (count: number) => void): void => {
    void askNumber({
      title: question,
      label: t('zoneMenu.cardCountLabel'),
      initial: Number.parseInt(fallback, 10),
      quick: [1, 2, 3, 4, 5, 10],
    }).then((count) => {
      if (count !== null && count > 0) use(count);
    });
  };

  /**
   * Révélation permanente du dessus de sa bibliothèque.
   *
   * *Experimental Frenzy*, *Realmbreaker*, *Vizier of the Menagerie* : la carte
   * du dessus reste visible et change à chaque pioche. Le choix porte sur les
   * **destinataires** — soi seul, un adversaire, toute la table — et n'en
   * cocher aucun arrête la révélation. C'est le même geste dans les deux sens ;
   * une entrée « Arrêter » séparée n'aurait été proposée qu'à moitié du temps.
   */
  const askReveal = (): void => {
    const current = topReveals.get(zone.seat)?.toSeats ?? [];
    void openDialog({
      title: t('zoneMenu.revealTopTitle'),
      description: t('zoneMenu.revealTopDescription'),
      submitLabel: t('common.apply'),
      choicesLabel: t('zoneMenu.revealTopVisibleBy'),
      choices: seats.map((seat) => ({
        id: seat.id,
        label:
          seat.id === mySeat ? t('seat.meSuffix', { name: seat.displayName }) : seat.displayName,
        color: seat.color,
        checked: current.includes(seat.id),
      })),
    }).then((result) => {
      if (!result) return;
      send({ type: 'REVEAL_TOP', toSeats: result.chosen as SeatId[] });
    });
  };

  const entries: Entry[] = [];

  if (mine && zone.kind === 'LIBRARY') {
    entries.push(
      {
        label: t('zoneMenu.draw1'),
        run: () => send({ type: 'DRAW', count: 1 }),
        more: {
          question: t('zoneMenu.drawHowMany'),
          initial: 2,
          run: (n) => send({ type: 'DRAW', count: n }),
        },
      },
      {
        label: t('zoneMenu.scry1'),
        separatorBefore: true,
        run: () => send({ type: 'LOOK', zone, count: 1, mode: 'SCRY' }),
        more: {
          question: t('zoneMenu.scryHowMany'),
          initial: 2,
          run: (n) => send({ type: 'LOOK', zone, count: n, mode: 'SCRY' }),
        },
      },
      {
        label: t('zoneMenu.surveil1'),
        run: () => send({ type: 'LOOK', zone, count: 1, mode: 'SURVEIL' }),
        more: {
          question: t('zoneMenu.surveilHowMany'),
          initial: 2,
          run: (n) => send({ type: 'LOOK', zone, count: n, mode: 'SURVEIL' }),
        },
      },
      {
        label: t('zoneMenu.peekTop'),
        run: () => send({ type: 'LOOK', zone, count: 1, mode: 'PEEK' }),
        more: {
          question: t('zoneMenu.peekHowMany'),
          initial: 3,
          run: (n) => send({ type: 'LOOK', zone, count: n, mode: 'PEEK' }),
        },
      },
      {
        label: t('zoneMenu.mill1'),
        run: () => send({ type: 'MILL', count: 1 }),
        more: {
          question: t('zoneMenu.millHowMany'),
          initial: 3,
          run: (n) => send({ type: 'MILL', count: n }),
        },
      },
      {
        label: t('zoneMenu.exileTop'),
        run: () => send({ type: 'EXILE_TOP', count: 1 }),
        more: {
          question: t('zoneMenu.exileHowMany'),
          initial: 2,
          run: (n) => send({ type: 'EXILE_TOP', count: n }),
        },
      },
      {
        label: t('zoneMenu.exileTopFaceDown'),
        run: () => send({ type: 'EXILE_TOP', count: 1, faceDown: true }),
        more: {
          question: t('zoneMenu.exileFaceDownHowMany'),
          initial: 2,
          run: (n) => send({ type: 'EXILE_TOP', count: n, faceDown: true }),
        },
      },
      {
        label: t('zoneMenu.searchLibrary'),
        separatorBefore: true,
        run: () => send({ type: 'LOOK', zone, count: 'ALL', mode: 'SEARCH' }),
      },
      {
        label: t('zoneMenu.revealTopX'),
        run: () => send({ type: 'LOOK', zone, count: 1, mode: 'REVEAL' }),
        more: {
          question: t('zoneMenu.revealHowMany'),
          initial: 4,
          run: (n) => send({ type: 'LOOK', zone, count: n, mode: 'REVEAL' }),
        },
      },
      {
        label:
          (topReveals.get(zone.seat)?.toSeats.length ?? 0) > 0
            ? t('zoneMenu.revealTopOngoing')
            : t('zoneMenu.revealTop'),
        run: askReveal,
      },
      {
        label: t('zoneMenu.openZonePanel'),
        run: () => window.dispatchEvent(new CustomEvent('mtg:browse-zone', { detail: zone })),
      },
      { label: t('common.shuffle'), separatorBefore: true, run: () => send({ type: 'SHUFFLE', zone }) },
      { label: t('toolbar.mulligan'), run: () => send({ type: 'MULLIGAN' }) },
    );
  } else if (zone.kind === 'COMMAND') {
    entries.push({
      label: t('zoneMenu.openInZonePanel'),
      run: () => {
        window.dispatchEvent(new CustomEvent('mtg:browse-zone', { detail: zone }));
      },
    });
  } else if (zone.kind === 'GRAVEYARD' || zone.kind === 'EXILE') {
    entries.push({
      label: t('zoneMenu.openInZonePanel'),
      run: () => {
        // Ces zones sont publiques : les parcourir se fait côté client, sans intent.
        window.dispatchEvent(new CustomEvent('mtg:browse-zone', { detail: zone }));
      },
    });
    if (mine && zone.kind === 'GRAVEYARD') {
      entries.push({
        label: t('zoneMenu.graveyardToLibrary'),
        separatorBefore: true,
        run: () => {
          const ids = [...useGame.getState().cards.values()]
            .filter((c) => c.zone.seat === zone.seat && c.zone.kind === 'GRAVEYARD')
            .map((c) => c.id);
          if (ids.length > 0) {
            send({ type: 'MOVE_CARDS', cardIds: ids, to: { seat: zone.seat, kind: 'LIBRARY' }, index: 'TOP' });
          }
        },
      });
    }
  }

  if (entries.length === 0) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="scrollbar-thin fixed z-50 w-60 rounded border border-edge bg-panel py-1 shadow-xl"
        data-test="zone-menu"
        style={style}
      >
        {entries.map((entry) => (
          <div
            key={entry.label}
            className={`flex items-stretch ${
              entry.separatorBefore ? 'mt-1 border-t border-edge/60 pt-1' : ''
            }`}
          >
            <button
              className="flex-1 px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
              data-test="zone-menu-item"
              onClick={() => {
                entry.run();
                onClose();
              }}
            >
              {entry.label}
            </button>
            {entry.more && (
              /*
               * La seconde cible de clic de la ligne. Elle est étroite mais
               * pleine hauteur : c'est ce qui la rend visable sans viser.
               */
              <button
                className="shrink-0 border-l border-edge/50 px-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                data-test="zone-menu-more"
                data-for={entry.label}
                onClick={() => {
                  const more = entry.more!;
                  ask(more.question, String(more.initial), more.run);
                  onClose();
                }}
                title={entry.more.question}
              >
                X…
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
