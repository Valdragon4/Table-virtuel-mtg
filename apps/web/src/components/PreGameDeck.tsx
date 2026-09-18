/**
 * Composer son deck depuis la table, avant le lancement.
 *
 * C'est le moment qui manquait. On s'asseyait avec une liste, et plus rien
 * n'était modifiable : ni changer de deck, ni sortir une carte, ni faire entrer
 * une carte de réserve. Il fallait quitter la table, éditer le deck, revenir.
 *
 * Deux choses ici, et rien d'autre :
 *
 *  - **changer de deck** — un des siens, ou une liste collée. Le serveur
 *    remplace tout le matériel du siège ; hors partie, c'est sans conséquence ;
 *  - **le sideboard** — la bibliothèque et la réserve côte à côte, une carte
 *    passe de l'une à l'autre d'un clic.
 *
 * Le panneau ne s'ouvre qu'avant le lancement, parce que ce qu'il montre
 * n'existe qu'avant le lancement : le serveur ne publie le contenu de la
 * bibliothèque à son propriétaire que tant que la partie n'a pas commencé — le
 * mélange du départ réattribue ensuite tous les identifiants (protocole §2.1).
 *
 * Les cartes sont groupées par nom, comme sur une liste de deck : personne ne
 * raisonne en « la troisième Plains », on raisonne en « mes Plains ».
 */
import { useEffect, useMemo, useState } from 'react';
import type { CardView, DeckSummary, Language } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { api } from '../lib/api.js';
import { cardName } from '../lib/cards.js';
import { localizedCard, localizedCardName, useLocalizationTick } from '../lib/cardLocalization.js';
import { useLanguage } from '../store/prefs.js';
import { useT } from '../lib/i18n/index.js';
import { matchesCardQuery } from './ZonePanel.js';

/**
 * Une ligne de liste : un nom, et les exemplaires qui le portent.
 *
 * **Deux noms, et ce n'est pas un doublon.** `name` est celui du catalogue,
 * anglais : c'est lui qui regroupe les exemplaires et qui ordonne la liste —
 * exactement comme le panneau de zone. `label` est ce qu'on lit à l'écran. Le
 * filtre, lui, interroge les deux : on doit retrouver sa carte par le nom
 * qu'on lit comme par celui qu'on recopie d'une liste de deck. Les confondre
 * partout ailleurs ferait regrouper deux impressions d'une
 * même carte sous deux lignes dès que l'une est traduite et l'autre pas encore
 * arrivée, et la liste se réordonnerait sous les doigts du joueur à mesure que
 * les lots de résolution rentrent.
 */
interface Stack {
  name: string;
  label: string;
  ids: string[];
}

function stacksOf(cards: readonly CardView[], language: Language): Stack[] {
  /* La première impression rencontrée sert de porte-parole du groupe : toutes
     portent le même nom anglais, donc le même nom imprimé. */
  const byName = new Map<string, { ids: string[]; scryfallId?: string }>();
  for (const card of cards) {
    const name = card.faceDown === false ? cardName(card.scryfallId) : '…';
    const entry = byName.get(name);
    if (entry) entry.ids.push(card.id);
    else
      byName.set(name, {
        ids: [card.id],
        ...(card.faceDown === false ? { scryfallId: card.scryfallId } : {}),
      });
  }
  return [...byName.entries()]
    .map(([name, { ids, scryfallId }]) => ({
      name,
      // Repli invisible : sans traduction, on lit l'anglais, sans rien qui le
      // signale — c'est le cas courant.
      label: localizedCardName(localizedCard(scryfallId, language), name) ?? name,
      ids,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function PreGameDeck({ onClose }: { onClose: () => void }): React.ReactElement {
  // Les noms imprimés arrivent par lots : sans ce compteur en dépendance, la
  // liste resterait celle du premier rendu, donc anglaise, jusqu'à ce qu'une
  // carte bouge.
  const tick = useLocalizationTick();
  const language = useLanguage();
  const t = useT();
  const send = useGame((s) => s.send);
  const mySeat = useGame((s) => s.mySeat);
  const cards = useGame((s) => s.cards);
  const seats = useGame((s) => s.seats);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [deckId, setDeckId] = useState('');
  const [deckText, setDeckText] = useState('');
  const [filter, setFilter] = useState('');

  const me = seats.find((s) => s.id === mySeat);

  useEffect(() => {
    void api
      .get<{ decks: DeckSummary[] }>('/api/decks')
      .then((r) => setDecks(r.decks))
      .catch(() => setDecks([]));
  }, []);

  const { library, sideboard } = useMemo(() => {
    const mine = [...cards.values()].filter((c) => c.zone.seat === mySeat);
    return {
      library: stacksOf(mine.filter((c) => c.zone.kind === 'LIBRARY'), language),
      sideboard: stacksOf(mine.filter((c) => c.zone.kind === 'SIDEBOARD'), language),
    };
    // `tick` n'est pas lu dans le corps : il n'est là que pour refaire le calcul
    // quand un lot de résolutions rentre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, mySeat, language, tick]);

  /* Le filtre interroge les **deux** noms, comme la recherche du panneau de
     zone : celui du catalogue, qui est celui des listes de deck qu'on recopie,
     et celui qui est imprimé sur la ligne juste à côté. Le regroupement et le
     tri, eux, restent sur `name` seul — c'est la clé, et elle ne bouge pas avec
     la langue. */
  const keep = (stack: Stack): boolean => matchesCardQuery(filter, stack.name, stack.label);

  function moveOne(stack: Stack, to: 'LIBRARY' | 'SIDEBOARD'): void {
    const id = stack.ids[0];
    if (!id || !mySeat) return;
    send({
      type: 'MOVE_CARD',
      cardId: id,
      to: { seat: mySeat, kind: to },
      // Une carte qui rentre dans le deck ne doit pas atterrir sur le dessus :
      // la partie n'a pas commencé, mais autant ne pas prendre l'habitude.
      ...(to === 'LIBRARY' ? { index: 'RANDOM' as const } : {}),
    });
  }

  function loadDeck(): void {
    if (deckId) send({ type: 'LOAD_DECK', deckId });
    else if (deckText.trim()) send({ type: 'LOAD_DECK', deckText });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex max-h-[86vh] w-[min(64rem,96vw)] flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl"
        data-test="pregame-deck"
      >
        <header className="flex items-baseline justify-between border-b border-edge px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{t('pregame.title')}</h2>
            <p className="text-[11px] text-slate-500">{t('pregame.intro')}</p>
          </div>
          <button
            className="rounded border border-edge px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
            onClick={onClose}
            type="button"
          >
            {t('common.close')}
          </button>
        </header>

        {/* ------------------------------------------------------ changer de deck */}
        <div className="border-b border-edge px-5 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[16rem] flex-1">
              <span className="block text-[11px] text-slate-500">
                {t('pregame.loadedDeck', { name: me?.deckName ?? t('pregame.noDeck') })}
              </span>
              <select
                className="mt-1 w-full rounded border border-edge bg-table px-2 py-1.5 text-sm text-slate-200"
                onChange={(event) => setDeckId(event.target.value)}
                value={deckId}
              >
                <option value="">{t('pregame.pasteInstead')}</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name} ({deck.cardCount})
                  </option>
                ))}
              </select>
            </label>
            {!deckId && (
              <label className="block min-w-[18rem] flex-[2]">
                <span className="block text-[11px] text-slate-500">{t('deck.pasteList')}</span>
                <textarea
                  className="scrollbar-thin mt-1 h-16 w-full resize-none rounded border border-edge bg-table px-2 py-1.5 font-mono text-[11px] text-slate-200"
                  onChange={(event) => setDeckText(event.target.value)}
                  placeholder={'1 Sol Ring\n1 Arcane Signet'}
                  value={deckText}
                />
              </label>
            )}
            <button
              className="rounded border border-edge bg-slate-800 px-4 py-2 text-xs text-slate-100 hover:border-slate-500 disabled:opacity-40"
              disabled={!deckId && deckText.trim() === ''}
              onClick={loadDeck}
              type="button"
            >
              {t('pregame.loadDeck')}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-amber-300/80">{t('pregame.loadWarning')}</p>
        </div>

        {/* --------------------------------------------------------- le sideboard */}
        <div className="border-b border-edge px-5 py-2">
          <input
            className="w-full rounded border border-edge bg-table px-2 py-1.5 text-sm text-slate-200"
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('pregame.filterPlaceholder')}
            value={filter}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-edge">
          <Column
            empty={t('pregame.libraryEmpty')}
            label={t('pregame.libraryHeading', {
              value: library.reduce((n, s) => n + s.ids.length, 0),
            })}
            action={t('pregame.setAside')}
            stacks={library.filter(keep)}
            onMove={(stack) => moveOne(stack, 'SIDEBOARD')}
          />
          <Column
            empty={t('pregame.sideboardEmpty')}
            label={t('pregame.sideboardHeading', {
              value: sideboard.reduce((n, s) => n + s.ids.length, 0),
            })}
            action={t('pregame.backToDeck')}
            stacks={sideboard.filter(keep)}
            onMove={(stack) => moveOne(stack, 'LIBRARY')}
          />
        </div>
      </div>
    </div>
  );
}

function Column({
  label,
  action,
  stacks,
  empty,
  onMove,
}: {
  label: string;
  action: string;
  stacks: Stack[];
  empty: string;
  onMove: (stack: Stack) => void;
}): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-col bg-panel">
      <p className="border-b border-edge px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {stacks.map((stack) => (
          <li
            className="flex items-center gap-2 border-b border-edge/50 px-4 py-1.5 text-sm"
            key={stack.name}
          >
            <span className="w-6 shrink-0 text-right text-slate-500">{stack.ids.length}</span>
            <span className="min-w-0 flex-1 truncate text-slate-200">{stack.label}</span>
            <button
              className="shrink-0 rounded border border-edge px-2 py-0.5 text-[11px] text-slate-400 hover:border-sky-500 hover:text-slate-100"
              onClick={() => onMove(stack)}
              type="button"
            >
              {action}
            </button>
          </li>
        ))}
        {stacks.length === 0 && <li className="px-4 py-6 text-center text-xs text-slate-500">{empty}</li>}
      </ul>
    </div>
  );
}
