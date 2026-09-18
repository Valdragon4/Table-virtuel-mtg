/**
 * Les réglages d'affichage : la langue, et ce qu'on accepte de voir changer
 * pour l'obtenir.
 *
 * Il est conçu pour être posé **tel quel** partout : dans les paramètres du
 * compte, dans une barre d'en-tête étroite, dans la barre du haut en partie. Il
 * ne suppose donc rien de son environnement — ni siège, ni partie, ni modale
 * autour — et ne prend aucune prop obligatoire. Changer un réglage ici
 * enregistre la préférence du **compte** : c'est le même `setLanguage` des deux
 * côtés, pas une « langue de session » qui divergerait de ce que l'écran de
 * paramètres affiche.
 *
 * **Le nom accessible ne dépend pas du libellé.** Avec `hideLabel`, le
 * `<label>` disparaît et un lecteur d'écran n'annoncerait plus que la valeur
 * courante — « Français », sans jamais dire de quoi il s'agit. Le composant pose
 * donc lui-même un `aria-label` dans ce cas, plutôt que d'attendre une prop
 * qu'un point de montage finira par oublier.
 */
import { useId } from 'react';
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '@mtg/shared';
import {
  useForceLocalizedPrinting,
  useLanguage,
  useLanguageError,
  useLanguageSaving,
  useSetForceLocalizedPrinting,
  useSetLanguage,
} from '../store/prefs.js';
import { useT } from '../lib/i18n/index.js';

export interface LanguagePickerProps {
  /**
   * `'select'` pour un formulaire de paramètres, `'segmented'` pour une barre
   * d'outils où deux langues tiennent en deux boutons. Le comportement est
   * identique ; seule la surface change.
   */
  variant?: 'select' | 'segmented';
  /** Masque le libellé quand le contexte le dit déjà (un menu « Langue »). */
  hideLabel?: boolean;
  /** Masque la phrase d'explication, trop longue pour une barre d'outils. */
  hideHint?: boolean;
  /**
   * Masque l'option « forcer une édition disponible dans ma langue ».
   *
   * Elle se masque déjà d'elle-même en anglais, où elle n'a rien à forcer : le
   * catalogue **est** anglais. Cette prop sert aux contextes où il n'y a
   * vraiment pas la place, et il vaut mieux la retirer explicitement que la
   * voir déborder.
   */
  hidePrintingOption?: boolean;
  className?: string;
  /** Prévenu **après** l'enregistrement tenté ; purement informatif. */
  onChange?: (language: Language) => void;
}

export function LanguagePicker({
  variant = 'select',
  hideLabel = false,
  hideHint = false,
  hidePrintingOption = false,
  className,
  onChange,
}: LanguagePickerProps): React.ReactElement {
  const t = useT();
  const language = useLanguage();
  const saving = useLanguageSaving();
  const error = useLanguageError();
  const setLanguage = useSetLanguage();
  const forcePrinting = useForceLocalizedPrinting();
  const setForcePrinting = useSetForceLocalizedPrinting();
  // `useId` plutôt qu'un identifiant fixe : le composant peut être monté deux
  // fois sur la même page (paramètres ouverts par-dessus la table), et deux
  // `<label for>` identiques désigneraient le mauvais champ.
  const fieldId = useId();

  function choose(next: Language): void {
    if (next === language) return;
    void setLanguage(next).then(() => onChange?.(next));
  }

  /*
   * L'option n'a de sens que dans une langue qui n'est pas celle du catalogue :
   * en anglais, il n'y a rien à substituer, toutes les impressions sont déjà
   * dans la langue affichée. La masquer là évite un réglage sans effet — et
   * c'est ce qui la fait tenir dans une barre étroite, puisqu'elle ne s'ajoute
   * pas systématiquement.
   */
  const showPrintingOption = !hidePrintingOption && language !== 'en';
  // Barre d'outils : pas de libellé, pas d'explication, donc pas la place d'une
  // case à cocher étiquetée. On rend un bouton carré, et tout le sens passe par
  // son nom accessible et son infobulle.
  const compact = hideHint;

  const printingToggle = showPrintingOption ? (
    <button
      type="button"
      aria-pressed={forcePrinting}
      aria-label={t('prefs.localizedPrinting')}
      className={`shrink-0 rounded border px-1 py-1 leading-none disabled:opacity-50 ${
        forcePrinting
          ? 'border-emerald-500/60 bg-emerald-600/20 text-emerald-300'
          : 'border-edge text-slate-400 hover:bg-white/5'
      }`}
      data-test="localized-printing-toggle"
      disabled={saving}
      title={t('prefs.localizedPrintingHint')}
      onClick={() => void setForcePrinting(!forcePrinting)}
    >
      {/* Deux flèches d'échange : l'édition affichée n'est pas celle choisie. */}
      <svg aria-hidden fill="none" height="12" viewBox="0 0 12 10" width="13">
        <path d="M1 3h9L7.6 1M11 7H2l2.4 2" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </button>
  ) : null;

  return (
    <div className={className}>
      {!hideLabel && (
        <label className="mb-1 block text-sm text-slate-400" htmlFor={fieldId}>
          {t('prefs.language')}
        </label>
      )}

      {/*
        `min-w-0` sur le champ : dans une barre d'en-tête étroite (8.5rem chez
        l'appelant actuel), c'est ce qui permet au sélecteur de rétrécir au lieu
        de pousser le bouton hors du cadre.
      */}
      <div className="flex items-center gap-1">
        {variant === 'segmented' ? (
          <div
            className="inline-flex min-w-0 rounded border border-edge"
            id={fieldId}
            role="group"
            // Un `role="group"` sans nom n'est annoncé que par ses boutons ; le
            // libellé étant masqué, c'est ici qu'il faut le poser.
            {...(hideLabel ? { 'aria-label': t('prefs.language') } : {})}
          >
            {LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={code === language}
                disabled={saving}
                className={`px-3 py-1 text-sm first:rounded-l last:rounded-r disabled:opacity-50 ${
                  code === language ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-white/5'
                }`}
                onClick={() => choose(code)}
              >
                {LANGUAGE_NAMES[code]}
              </button>
            ))}
          </div>
        ) : (
          <select
            id={fieldId}
            className="min-w-0 flex-1 rounded border border-edge bg-panel px-2 py-1 text-sm disabled:opacity-50"
            disabled={saving}
            value={language}
            // Sans `<label>` visible, le champ n'aurait plus de nom accessible :
            // un lecteur d'écran annoncerait « Français » sans dire de quoi il
            // s'agit. On le pose d'office plutôt que de compter sur une prop.
            {...(hideLabel ? { 'aria-label': t('prefs.language') } : {})}
            onChange={(event) => choose(event.target.value as Language)}
          >
            {LANGUAGES.map((code) => (
              // Le nom d'une langue ne se traduit pas : qui cherche l'anglais
              // cherche « English », surtout s'il ne lit pas la page courante.
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        )}
        {compact && printingToggle}
      </div>

      {/*
        Hors barre d'outils, la case à cocher est étiquetée et expliquée : c'est
        un réglage dont l'effet demande une phrase. Il change **l'illustration
        affichée**, et rien d'autre — le sélecteur d'impression continue
        d'annoncer l'impression réellement choisie, et les autres joueurs voient
        toujours celle-là.
      */}
      {!compact && showPrintingOption && (
        <label className="mt-2 flex items-start gap-2 text-xs text-slate-300">
          <input
            aria-describedby={`${fieldId}-printing-hint`}
            checked={forcePrinting}
            className="mt-0.5"
            data-test="localized-printing-toggle"
            disabled={saving}
            type="checkbox"
            onChange={(event) => void setForcePrinting(event.target.checked)}
          />
          <span>
            {t('prefs.localizedPrinting')}
            <span className="block text-slate-500" id={`${fieldId}-printing-hint`}>
              {t('prefs.localizedPrintingHint')}
            </span>
          </span>
        </label>
      )}

      {saving && <p className="mt-1 text-xs text-slate-500">{t('prefs.languageSaving')}</p>}
      {!saving && error && <p className="mt-1 text-xs text-amber-500">{t('prefs.languageError')}</p>}
      {!hideHint && !saving && !error && (
        <p className="mt-1 text-xs text-slate-500">{t('prefs.languageHint')}</p>
      )}
    </div>
  );
}
