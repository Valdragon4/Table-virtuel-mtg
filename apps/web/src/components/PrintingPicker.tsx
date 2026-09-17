import { useEffect, useState } from 'react';
import type { PublicCardView } from '@mtg/shared';
import { api, type CardMeta } from '../lib/api.js';
import { scryfallImage } from '../lib/cards.js';
import { useGame } from '../store/game.js';
import { useCloseOnEscape } from '../lib/overlay.js';

/**
 * Choix d'une impression précise pour une carte déjà en jeu, foil compris.
 * Les impressions viennent de la base locale : aucun appel à Scryfall ici.
 */
export function PrintingPicker({
  card,
  onClose,
}: {
  card: PublicCardView;
  onClose: () => void;
}): React.ReactElement {
  const send = useGame((s) => s.send);
  const [printings, setPrintings] = useState<CardMeta[] | null>(null);
  const [foil, setFoil] = useState(card.isFoil);
  useCloseOnEscape(onClose);

  useEffect(() => {
    void api
      .get<{ printings: CardMeta[] }>(`/api/cards/${card.scryfallId}/printings`)
      .then((r) => setPrintings(r.printings))
      .catch(() => setPrintings([]));
  }, [card.scryfallId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={onClose}>
      <div
        className="w-full max-w-3xl overflow-hidden rounded-lg border border-edge bg-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="font-medium">Choisir une impression</h2>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input checked={foil} type="checkbox" onChange={(event) => setFoil(event.target.checked)} />
            Foil
          </label>
        </header>

        <div className="scrollbar-thin grid max-h-[60vh] grid-cols-4 gap-3 overflow-y-auto p-4 sm:grid-cols-6">
          {printings === null && <p className="col-span-full text-sm text-slate-500">Chargement…</p>}
          {printings?.map((printing) => (
            <button
              key={printing.scryfallId}
              className={`group text-left ${printing.scryfallId === card.scryfallId ? 'ring-2 ring-sky-500' : ''}`}
              onClick={() => {
                send({
                  type: 'SET_PRINTING',
                  cardId: card.id,
                  scryfallId: printing.scryfallId,
                  isFoil: foil,
                });
                onClose();
              }}
            >
              <img
                alt={`${printing.name} (${printing.setCode})`}
                className="w-full rounded transition group-hover:brightness-110"
                loading="lazy"
                src={scryfallImage(printing.scryfallId, 'small')}
              />
              <p className="mt-1 truncate text-[11px] uppercase text-slate-500">
                {printing.setCode} · {printing.collectorNumber}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
