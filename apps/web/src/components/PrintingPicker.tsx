import { useEffect, useState } from 'react';
import type { PublicCardView } from '@mtg/shared';
import { api, type CardMeta } from '../lib/api.js';
import { scryfallImage } from '../lib/cards.js';
import { localizedCard, localizedCardName, useLocalizationTick } from '../lib/cardLocalization.js';
import { resolveCardImage, useT } from '../lib/i18n/index.js';
import { useGame } from '../store/game.js';
import { useLanguage } from '../store/prefs.js';
import { useCloseOnEscape } from '../lib/overlay.js';

/**
 * Choix d'une impression précise pour une carte déjà en jeu, foil compris.
 * Les impressions viennent de la base locale : aucun appel à Scryfall ici.
 *
 * **Deux identifiants, et il ne faut jamais les confondre.** `printing.scryfallId`
 * est celui du **catalogue** : c'est lui qu'on compare à l'impression en jeu et
 * lui seul qui part dans `SET_PRINTING`. L'impression française a un identifiant
 * différent, qui vit dans la résolution localisée et ne sert qu'à choisir
 * l'illustration montrée — `resolveCardImage` s'en charge, et rien de ce qui
 * sort d'ici ne le porte.
 */
export function PrintingPicker({
  card,
  onClose,
}: {
  card: PublicCardView;
  onClose: () => void;
}): React.ReactElement {
  const t = useT();
  const send = useGame((s) => s.send);
  const [printings, setPrintings] = useState<CardMeta[] | null>(null);
  const [foil, setFoil] = useState(card.isFoil);
  useCloseOnEscape(onClose);
  useLocalizationTick();
  const language = useLanguage();

  /*
   * Pas d'aperçu agrandi ici, et c'est délibéré.
   *
   * Le geste y manque pourtant — choisir une illustration sans la voir en grand
   * n'a guère de sens. Mais cette modale-ci vit **à la table**, sous un voile
   * `z-50` qui ouvre son propre contexte d'empilement : l'aperçu monté par la
   * salle (`z-[45]`) se peint dessous, et en monter un second à l'intérieur
   * ferait exister deux `data-test="card-preview"` en même temps — ce que la
   * recette d'interface compte. Le faire proprement demande de décider **où**
   * la salle monte le sien, donc de toucher `Room.tsx`. À reprendre là-bas.
   */

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
          <h2 className="font-medium">{t('printing.choose')}</h2>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input checked={foil} type="checkbox" onChange={(event) => setFoil(event.target.checked)} />
            Foil
          </label>
        </header>

        <div className="scrollbar-thin grid max-h-[60vh] grid-cols-4 gap-3 overflow-y-auto p-4 sm:grid-cols-6">
          {printings === null && (
            <p className="col-span-full text-sm text-slate-500">{t('common.loading')}</p>
          )}
          {printings?.map((printing) => {
            const localized = localizedCard(printing.scryfallId, language);
            // Le repli est invisible : sans traduction, c'est l'anglais qui
            // s'affiche, et le motif du CDN reste le dernier recours.
            const src =
              resolveCardImage({ card: printing, localized, language, version: 'small' }).url ??
              scryfallImage(printing.scryfallId, 'small');
            const shownName = localizedCardName(localized, printing.name) ?? printing.name;
            return (
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
                alt={t('printing.label', { name: shownName, setCode: printing.setCode })}
                className="w-full rounded transition group-hover:brightness-110"
                loading="lazy"
                src={src}
              />
              <p className="mt-1 truncate text-[11px] uppercase text-slate-500">
                {printing.setCode} · {printing.collectorNumber}
              </p>
            </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
