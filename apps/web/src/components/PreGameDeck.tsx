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
import type { CardView, DeckSummary } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { api } from '../lib/api.js';
import { cardName } from '../lib/cards.js';

/** Une ligne de liste : un nom, et les exemplaires qui le portent. */
interface Stack {
  name: string;
  ids: string[];
}

function stacksOf(cards: readonly CardView[]): Stack[] {
  const byName = new Map<string, string[]>();
  for (const card of cards) {
    const name = card.faceDown === false ? cardName(card.scryfallId) : '…';
    const list = byName.get(name);
    if (list) list.push(card.id);
    else byName.set(name, [card.id]);
  }
  return [...byName.entries()]
    .map(([name, ids]) => ({ name, ids }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function PreGameDeck({ onClose }: { onClose: () => void }): React.ReactElement {
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
      library: stacksOf(mine.filter((c) => c.zone.kind === 'LIBRARY')),
      sideboard: stacksOf(mine.filter((c) => c.zone.kind === 'SIDEBOARD')),
    };
  }, [cards, mySeat]);

  const keep = (stack: Stack): boolean =>
    filter.trim() === '' || stack.name.toLowerCase().includes(filter.trim().toLowerCase());

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
            <h2 className="text-sm font-semibold text-slate-100">Avant la partie</h2>
            <p className="text-[11px] text-slate-500">
              Changez de deck, ou faites passer des cartes entre votre bibliothèque et votre
              réserve. Tout est encore modifiable tant que personne n’a lancé.
            </p>
          </div>
          <button
            className="rounded border border-edge px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
            onClick={onClose}
            type="button"
          >
            Fermer
          </button>
        </header>

        {/* ------------------------------------------------------ changer de deck */}
        <div className="border-b border-edge px-5 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[16rem] flex-1">
              <span className="block text-[11px] text-slate-500">
                Deck chargé : {me?.deckName ?? 'aucun'}
              </span>
              <select
                className="mt-1 w-full rounded border border-edge bg-table px-2 py-1.5 text-sm text-slate-200"
                onChange={(event) => setDeckId(event.target.value)}
                value={deckId}
              >
                <option value="">— coller une liste à la place —</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name} ({deck.cardCount})
                  </option>
                ))}
              </select>
            </label>
            {!deckId && (
              <label className="block min-w-[18rem] flex-[2]">
                <span className="block text-[11px] text-slate-500">Coller une liste</span>
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
              Charger ce deck
            </button>
          </div>
          <p className="mt-2 text-[11px] text-amber-300/80">
            Charger un deck remplace tout ce que vous avez sur la table.
          </p>
        </div>

        {/* --------------------------------------------------------- le sideboard */}
        <div className="border-b border-edge px-5 py-2">
          <input
            className="w-full rounded border border-edge bg-table px-2 py-1.5 text-sm text-slate-200"
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filtrer par nom…"
            value={filter}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-edge">
          <Column
            empty="Aucune carte dans la bibliothèque."
            label={`Bibliothèque (${library.reduce((n, s) => n + s.ids.length, 0)})`}
            action="Mettre de côté →"
            stacks={library.filter(keep)}
            onMove={(stack) => moveOne(stack, 'SIDEBOARD')}
          />
          <Column
            empty="Réserve vide."
            label={`Réserve (${sideboard.reduce((n, s) => n + s.ids.length, 0)})`}
            action="← Remettre au deck"
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
            <span className="min-w-0 flex-1 truncate text-slate-200">{stack.name}</span>
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
