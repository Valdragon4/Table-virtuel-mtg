import { useState, useEffect } from 'react';
import { cardMeta, scryfallImage } from '../lib/cards.js';
import { localizedCard, localizedCardName, useLocalizationTick } from '../lib/cardLocalization.js';
import { resolveCardImage, useT } from '../lib/i18n/index.js';
import { useLanguage } from '../store/prefs.js';
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
  // Les résolutions arrivent par lots, après le premier rendu : sans cet
  // abonnement, une carte révélée resterait en anglais jusqu'au prochain rendu
  // venu d'ailleurs — et ici « ailleurs » peut ne jamais arriver, le bandeau
  // étant immobile tant que le joueur d'en face choisit ses destinations.
  useLocalizationTick();
  const t = useT();
  const language = useLanguage();
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
  const seatName = seat?.displayName || t('reveal.someone');
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
          <span>{t('reveal.reopen', { who: seatName, count })}</span>
          <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-300">
            {t('common.expand')}
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
                  {t('reveal.headline', { count })}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">{t('reveal.hint')}</p>
            </div>
          </div>
          <button
            className="rounded-lg p-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            data-test="public-reveal-close"
            onClick={() => {
              hoverPreview(null);
              setMinimized(true);
            }}
            title={t('common.minimize')}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-3 overflow-y-auto max-h-[60vh] p-1">
          {publicReveal.cards.map((card) => {
            const meta = cardMeta(card.scryfallId);
            const localized = localizedCard(card.scryfallId, language);
            /*
             * Le repli est invisible, ici comme sur la table : une carte jamais
             * imprimée en français montre l'anglais, sans pastille ni trou. Et
             * si la résolution ne rend pas d'URL, on redescend sur le motif du
             * CDN — c'est ce que ce bandeau affichait avant ce chantier, rien
             * ne peut donc disparaître.
             */
            const imageSrc =
              resolveCardImage({
                card: meta ?? { scryfallId: card.scryfallId },
                localized,
                language,
                version: 'normal',
              }).url ?? scryfallImage(card.scryfallId, 'normal');
            const shownName = localizedCardName(localized, meta?.name);
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
                    alt={shownName || t('reveal.altCard')}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    src={imageSrc}
                  />
                </div>
                <div className="mt-2 w-32 text-center">
                  <div className="truncate text-xs font-semibold text-slate-200">
                    {shownName || t('common.loading')}
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
