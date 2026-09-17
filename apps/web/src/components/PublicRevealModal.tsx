import { useState, useEffect } from 'react';
import { cardMeta, scryfallImage } from '../lib/cards.js';
import { useGame } from '../store/game.js';

/**
 * Modalité ou bandeau de révélation publique pour les spectateurs et adversaires.
 *
 * Lorsqu'un joueur révèle les X cartes du dessus de sa bibliothèque (mode REVEAL),
 * tous les autres joueurs à la table reçoivent `publicReveal` avec la liste
 * complète des cartes révélées. Ce composant leur permet de voir ces cartes en
 * direct sans bloquer leur interaction avec le reste de la table.
 */
export function PublicRevealModal(): React.ReactElement | null {
  const publicReveal = useGame((s) => s.publicReveal);
  const mySeat = useGame((s) => s.mySeat);
  const seats = useGame((s) => s.seats);
  const hoverPreview = useGame((s) => s.hoverPreview);

  const [minimized, setMinimized] = useState(false);
  const [lastLookId, setLastLookId] = useState<string | null>(null);

  // À chaque nouveau lookId, on réouvre automatiquement le composant s'il était minimisé
  useEffect(() => {
    if (publicReveal && publicReveal.lookId !== lastLookId) {
      setLastLookId(publicReveal.lookId);
      setMinimized(false);
    }
  }, [publicReveal, lastLookId]);

  useEffect(() => {
    return () => {
      hoverPreview(null);
    };
  }, [hoverPreview]);

  useEffect(() => {
    if (!publicReveal || publicReveal.seat === mySeat) {
      hoverPreview(null);
    }
  }, [publicReveal, mySeat, hoverPreview]);

  // Si pas de révélation en cours ou si c'est moi qui révèle (géré par LookModal)
  if (!publicReveal || publicReveal.seat === mySeat) {
    return null;
  }

  const seat = seats.find((s) => s.id === publicReveal.seat);
  const seatName = seat?.displayName || 'Un adversaire';
  const seatColor = seat?.color || '#38bdf8';
  const count = publicReveal.cards.length;

  if (minimized) {
    return (
      <div className="fixed bottom-20 left-4 z-40">
        <button
          className="flex items-center gap-2 rounded-full border border-sky-500/40 bg-slate-900/95 px-4 py-2 text-xs font-semibold text-sky-200 shadow-xl backdrop-blur transition-all hover:bg-slate-800 hover:border-sky-400"
          data-test="public-reveal-reopen"
          onClick={() => setMinimized(false)}
          type="button"
        >
          <span className="animate-pulse">✨</span>
          <span>{seatName} révèle {count} carte{count > 1 ? 's' : ''}</span>
          <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-300">
            Agrandir
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-4 top-16 z-40 mx-auto max-w-4xl animate-in fade-in slide-in-from-top-4 duration-200"
      data-test="public-reveal-modal"
    >
      <div className="rounded-2xl border border-sky-500/30 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-xl ring-1 ring-white/10">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold shadow"
              style={{ backgroundColor: `${seatColor}25`, color: seatColor }}
            >
              ✨
            </span>
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
                <span>{seatName}</span>
                <span className="text-xs font-normal text-slate-400">
                  révèle {count} carte{count > 1 ? 's' : ''} du dessus de sa bibliothèque
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Survolez une carte pour l'agrandir. Le joueur sélectionne actuellement les destinations.
              </p>
            </div>
          </div>
          <button
            className="rounded-lg p-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            data-test="public-reveal-close"
            onClick={() => {
              hoverPreview(null);
              setMinimized(true);
            }}
            title="Minimiser"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-3 overflow-y-auto max-h-[60vh] p-1">
          {publicReveal.cards.map((card) => {
            const meta = cardMeta(card.scryfallId);
            return (
              <div
                key={card.id}
                className="group relative flex flex-col items-center rounded-xl border border-slate-800 bg-slate-900/60 p-2 transition-all hover:border-sky-500/50 hover:bg-slate-850 hover:shadow-lg hover:shadow-sky-500/10"
                data-test={`public-revealed-card-${card.id}`}
                onPointerEnter={() => hoverPreview(card.scryfallId)}
                onPointerLeave={() => hoverPreview(null)}
              >
                <div className="h-44 w-32 overflow-hidden rounded-lg shadow-md transition-transform group-hover:scale-[1.03]">
                  <img
                    alt={meta?.name || 'Carte révélée'}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    src={scryfallImage(card.scryfallId, 'normal')}
                  />
                </div>
                <div className="mt-2 w-32 text-center">
                  <div className="truncate text-xs font-semibold text-slate-200">
                    {meta?.name || 'Chargement…'}
                  </div>
                  {meta?.typeLine && (
                    <div className="truncate text-[10px] text-slate-400">
                      {meta.typeLine}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
