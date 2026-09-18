/**
 * La bibliothèque de decks du compte.
 *
 * Deux natures cohabitent, et le monde du site les distingue : ce qu'on
 * **remplit** est du papier — les deux formulaires d'import, le rapport qui en
 * revient ; ce qu'on **consulte et manipule** reste sur le sol sombre — la liste
 * des decks enregistrés, qui n'a pas à imiter un imprimé.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DeckSummary, ImportReport } from '@mtg/shared';
import { api, ApiError } from '../lib/api.js';
import { DeckEditor } from '../components/DeckEditor.js';
import { DeckLook } from '../components/DeckLook.js';
import { ImportReportView } from '../components/ImportReportView.js';
import { CardPreview, clearCardPreview, previewHoverProps } from '../components/CardPreview.js';
import { LegalFooter } from '../components/LegalFooter.js';
import { Wordmark } from '../components/Mark.js';
import { AccountBar } from '../components/AccountBar.js';
import { resolveCardImage, useT } from '../lib/i18n/index.js';
import {
  localizedCard,
  localizedCardName,
  useLocalizationTick,
} from '../lib/cardLocalization.js';
import { scryfallImage } from '../lib/cards.js';
import { useForceLocalizedPrinting, useLanguage } from '../store/prefs.js';

/**
 * La miniature d'un deck : l'illustration de sa carte représentative.
 *
 * **Ce qu'elle montre.** Le serveur a déjà élu la carte (`chooseDeckThumbnail`,
 * côté `apps/server/src/decks/thumbnail.ts`) : le commandant par défaut, le
 * premier des deux quand il y a des partenaires, la carte la plus chère de la
 * zone principale quand il n'y a pas de commandant du tout. L'interface ne
 * refait pas ce choix, elle l'affiche.
 *
 * **Le cadrage, et pourquoi il est en bande.** Une carte entière a un rapport de
 * 1 sur 1,4 : à la largeur qu'une ligne de liste peut céder, elle serait haute
 * de cent pixels et doublerait la hauteur de chaque deck. On ne montre donc que
 * l'**illustration**, découpée dans l'image complète : le cadre fait 80 × 40,
 * soit deux fois plus large que haut, ce qui correspond très exactement à la
 * bande d'art d'une carte au cadre moderne (36 % de sa hauteur), et
 * `object-position` la centre à 16 % du haut de l'image — juste sous le titre,
 * juste au-dessus de la ligne de type.
 *
 * On découpe côté navigateur plutôt que de demander l'`art_crop` de Scryfall :
 * ce format n'est pas dans les tailles que `resolveCardImage` sait replier
 * (`small` / `normal` / `large`), et l'y ajouter pour une vignette obligerait à
 * toucher la résolution d'illustration de tout le projet. La différence est un
 * découpage, pas une seconde image.
 *
 * **Le coût réseau.** `small` (146 × 204) et rien d'autre : c'est déjà plus que
 * les 80 pixels affichés, et une page peut aligner vingt decks. `loading="lazy"`
 * laisse le navigateur ignorer ce qui est sous la ligne de flottaison. Aucune
 * requête de localisation n'est déclenchée **par deck** : `localizedCard` range
 * les demandes dans le lot de la frame, qui part en un seul `POST` pour toute la
 * page — et ce lot est le même cache que celui de l'aperçu au survol, qui n'a
 * donc plus rien à demander ensuite.
 *
 * **Invariant de droits.** L'URL rendue pointe le CDN Scryfall et le
 * navigateur du joueur va la chercher lui-même. Rien n'est téléchargé, stocké
 * ni servi par nous : aucune construction d'image en mémoire, aucun
 * préchargement, aucune vignette en base.
 */
function DeckThumbnail({ card }: { card: DeckSummary['thumbnail'] }): React.ReactElement {
  const language = useLanguage();
  const allowSubstitute = useForceLocalizedPrinting();

  /*
   * Le cadre garde sa place même vide, et c'est délibéré : sans lui, la ligne
   * d'un deck sans carte représentative commencerait 92 pixels à gauche des
   * autres, et la colonne des noms ne serait plus une colonne.
   */
  const cadre =
    'h-10 w-20 shrink-0 overflow-hidden rounded-[3px] border border-[color:var(--site-floor-dim)]/40 bg-black/25';

  if (!card) return <div aria-hidden="true" className={cadre} data-test="deck-thumbnail-empty" />;

  /*
   * La langue, par le seul chemin qui existe. `resolveCardImage` sert
   * l'impression française quand elle existe et l'anglaise sinon ; tant que la
   * résolution n'est pas rentrée, il rend l'URL dérivée du catalogue anglais,
   * donc la vignette est visible tout de suite et devient française sans
   * disparaître entre-temps. `allowSubstitute` suit la préférence du joueur
   * pour que la miniature et l'aperçu au survol ne montrent jamais deux
   * illustrations différentes de la même carte.
   */
  const localized = localizedCard(card.scryfallId, language);
  const resolved = resolveCardImage({
    card: { scryfallId: card.scryfallId },
    localized,
    language,
    version: 'small',
    allowSubstitute,
  });

  /*
   * La même résolution sert le nom : l'illustration française et un `alt`
   * anglais désigneraient la même carte par deux mots différents, et c'est le
   * `alt` que lit une synthèse vocale. `localizedCardName` rend l'anglais du
   * catalogue tant que le lot n'est pas rentré, donc jamais de trou.
   */
  const nomAffiché = localizedCardName(localized, card.name) ?? card.name;

  return (
    <div
      className={`${cadre} cursor-help`}
      data-test="deck-thumbnail"
      {...previewHoverProps(card.scryfallId)}
    >
      <img
        /* Le nom de la carte, et non « miniature du deck » : pour un deck de
           60 cartes, c'est le seul endroit de la ligne où il soit lisible. */
        alt={nomAffiché}
        className="h-full w-full object-cover"
        decoding="async"
        draggable={false}
        loading="lazy"
        /* CDN Scryfall, directement : rien n'est hébergé ni proxifié chez nous. */
        src={resolved.url ?? scryfallImage(card.scryfallId, 'small')}
        style={{ objectPosition: '50% 16%' }}
      />
    </div>
  );
}

export function DecksPage(): React.ReactElement {
  const t = useT();
  const language = useLanguage();
  /*
   * Un seul abonnement aux résolutions localisées pour toute la page, et non un
   * par miniature : quand le lot rentre, la page se re-rend, et les vignettes
   * relisent le cache au passage. Vingt abonnements pour vingt decks feraient
   * vingt fois le même travail.
   */
  useLocalizationTick();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [styling, setStyling] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');

  const refresh = useCallback(async () => {
    try {
      const { decks: list } = await api.get<{ decks: DeckSummary[] }>('/api/decks');
      setDecks(list);
    } catch {
      setDecks([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Quitter la page par un lien laisse le curseur là où il était : aucun
  // `pointerleave` ne viendra éteindre un aperçu resté allumé.
  useEffect(() => clearCardPreview, []);

  async function runImport(payload: { url?: string; text?: string }): Promise<void> {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const result = await api.post<{ report: ImportReport; deckId?: string }>(
        '/api/decks/import',
        payload,
      );
      setReport(result.report);
      setUrl('');
      setText('');
      await refresh();
    } catch (err) {
      // `ApiError` porte un message et une indication rédigés par le serveur :
      // ils s'affichent tels quels, il n'y a rien à traduire ici.
      if (err instanceof ApiError) setError({ message: err.message, hint: err.hint });
      else setError({ message: t('deck.importFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function resync(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ report: ImportReport }>(`/api/decks/${id}/resync`);
      setReport(result.report);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Rend les illustrations de ce deck à sa source.
   *
   * Aucune confirmation : rien ne se perd qu'on ne puisse refaire — le contenu
   * du deck ne bouge pas, et rechanger l'impression en partie repose l'épingle.
   * Les impressions elles-mêmes ne changent qu'à la prochaine
   * resynchronisation, ce que l'infobulle du bouton annonce.
   */
  async function releasePinnedPrintings(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/decks/${id}/printing-pins`);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) setError({ message: err.message, hint: err.hint });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site site-floor min-h-screen">
      <header className="mx-auto flex max-w-[72rem] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link to="/">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            className="sign-sm text-[0.72rem] text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
            to="/tables"
          >
            {t('nav.myTables')}
          </Link>
          <Link
            className="sign-sm text-[0.72rem] text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
            to="/"
          >
            {t('nav.backHome')}
          </Link>
          <AccountBar />
        </nav>
      </header>

      <main className="mx-auto max-w-[72rem] px-5 pb-16 sm:px-8">
        <h1 className="sign text-[clamp(2rem,5vw,3rem)] text-[color:var(--site-floor-text)]">
          {t('nav.myDecks')}
        </h1>
        <p className="mt-3 max-w-[58ch] text-[0.95rem] leading-relaxed text-[color:var(--site-floor-dim)]">
          {t('decks.intro')}
        </p>

        {/* Les deux chemins d'import. Ils sont de même rang : le collage n'est
            pas un repli, c'est le chemin par défaut pour Moxfield. */}
        <section className="mt-9 grid gap-5 md:grid-cols-2">
          <div className="cut-shadow">
            <div className="paper paper-cut flex h-full flex-col p-6">
              <h2 className="sign-sm text-[0.78rem]">{t('deck.importFromUrl')}</h2>
              <div className="rule-ink mt-3 flex flex-1 flex-col pt-5">
                <p className="paper-dim mb-4 text-[0.83rem] leading-relaxed">
                  {t('deck.moxfieldNote')}
                </p>
                <input
                  className="paper-field typed mb-4 text-[0.85rem]"
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://archidekt.com/decks/123456/mon-deck"
                  value={url}
                />
                <button
                  className="ink-button mt-auto w-full px-5 py-3 text-[0.82rem]"
                  disabled={busy || url.trim().length < 10}
                  onClick={() => void runImport({ url })}
                  type="button"
                >
                  {busy ? t('deck.importing') : t('deck.import')}
                </button>
              </div>
            </div>
          </div>

          <div className="cut-shadow">
            <div className="paper paper-cut flex h-full flex-col p-6">
              <h2 className="sign-sm text-[0.78rem]">{t('deck.pasteList')}</h2>
              <div className="rule-ink mt-3 flex flex-1 flex-col pt-5">
                <p className="paper-dim mb-4 text-[0.83rem] leading-relaxed">
                  {/* « Commander » et « Sideboard » sont les sections que le
                      parseur reconnaît : elles restent en anglais des deux
                      côtés, et seule la phrase autour se traduit. */}
                  {t('deck.pasteListNoteBefore')} <span className="typed">Commander</span>{' '}
                  {t('deck.pasteListNoteAnd')} <span className="typed">Sideboard</span>{' '}
                  {t('deck.pasteListNoteAfter')}
                </p>
                <textarea
                  className="scrollbar-thin paper-field typed mb-4 h-28 resize-none text-[0.8rem] leading-relaxed"
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'1 Sol Ring (C21) 263\n1 Arcane Signet\n\n// Commander\n1 Selenia, the Cursed Heart'}
                  value={text}
                />
                <button
                  className="ink-button mt-auto w-full px-5 py-3 text-[0.82rem]"
                  disabled={busy || text.trim().length < 3}
                  onClick={() => void runImport({ text })}
                  type="button"
                >
                  {busy ? t('deck.importing') : t('deck.importPasted')}
                </button>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="mt-6 border-2 border-[color:var(--site-alarm-floor)]/70 px-4 py-3" role="alert">
            <p className="text-[0.9rem] text-[color:var(--site-alarm-floor)]">{error.message}</p>
            {error.hint && (
              <p className="mt-1 text-[0.85rem] text-[color:var(--site-floor-dim)]">{error.hint}</p>
            )}
          </div>
        )}

        {report && (
          <div className="mt-6">
            <ImportReportView report={report} />
            {/*
              Ce que la resynchronisation a gardé de nous. Une préservation
              silencieuse s'explique mal trois mois plus tard, quand le deck ne
              ressemble plus à sa source et qu'on ne sait plus pourquoi.

              La phrase est ici et non dans `ImportReportView` : ce composant
              rend le rapport de la **source**, et ceci n'en est pas — c'est ce
              que nous avons décidé de garder contre elle.
            */}
            {report.pinnedPrintingsKept !== undefined && report.pinnedPrintingsKept > 0 && (
              <p className="mt-3 text-[0.85rem] text-[color:var(--site-floor-dim)]">
                {t('deck.pinnedKept', { count: report.pinnedPrintingsKept })}
              </p>
            )}
          </div>
        )}

        <section className="mt-12">
          <h2 className="sign rule-stamp pt-6 text-[1.4rem] text-[color:var(--site-floor-text)]">
            {t('decks.savedHeading')}
          </h2>

          {decks === null && (
            <p className="mt-5 text-[0.9rem] text-[color:var(--site-floor-dim)]">
              {t('common.loading')}
            </p>
          )}
          {decks?.length === 0 && (
            <p className="mt-5 max-w-[56ch] text-[0.92rem] leading-relaxed text-[color:var(--site-floor-dim)]">
              {t('decks.empty')}
            </p>
          )}

          <ul className="mt-2">
            {decks?.map((deck) => (
              <li className="rule-floor py-5" key={deck.id}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  {/* La miniature ouvre la ligne, à gauche du nom : c'est l'ordre
                      de lecture, et c'est aussi ce qui permet de balayer la
                      colonne des illustrations sans lire un seul mot. */}
                  <div className="flex min-w-0 items-center gap-3">
                    <DeckThumbnail card={deck.thumbnail} />
                    <div className="min-w-0">
                      <p className="sign-sm truncate text-[1rem] text-[color:var(--site-floor-text)]">
                        {deck.name}
                      </p>
                      <p className="mt-1 text-[0.82rem] text-[color:var(--site-floor-dim)]">
                        <span className="typed">{deck.cardCount}</span>{' '}
                        {t('card.countWord', { count: deck.cardCount })} ·{' '}
                        {deck.source.toLowerCase()}
                        {/* Les noms de commandant viennent du catalogue Scryfall :
                            ils ne passent pas par le catalogue de libellés.

                            Ce sont les seules cartes visibles sur la liste
                            elle-même, et chacune porte son `scryfallId` : on les
                            rend une à une plutôt qu'en une chaîne jointe, pour
                            que le survol désigne un commandant et pas la ligne
                            entière. */}
                        {deck.commanders.map((commander, index) => {
                          /*
                           * Le nom imprimé, par le chemin commun — et **pas** par
                           * le glossaire des jetons : `tokenNames.ts` traduit des
                           * noms de type (« Soldier », « Treasure »), et un nom
                           * propre de carte n'y a rien à faire.
                           *
                           * `localizedCard` ne coûte pas une requête de plus : la
                           * demande rejoint le lot de la frame, celui que les
                           * miniatures viennent d'ouvrir juste au-dessus, et
                           * repart en un seul `POST` pour toute la page. Tant
                           * qu'il n'est pas rentré, `localizedCardName` rend
                           * l'anglais du catalogue : le nom est là tout de suite
                           * et bascule sans clignoter — c'est le même texte au
                           * même endroit, pas un texte qui apparaît.
                           *
                           * `commander.name` reste la clé : rien de ce qui est
                           * traduit ici ne repart au serveur ni ne sert d'identité.
                           */
                          const localized = localizedCard(commander.scryfallId, language);
                          const nomAffiché =
                            localizedCardName(localized, commander.name) ?? commander.name;
                          return (
                            <span key={commander.scryfallId}>
                              {index === 0 ? ' · ' : ' & '}
                              <span
                                className="cursor-help underline decoration-dotted underline-offset-2"
                                data-test="deck-commander"
                                {...previewHoverProps(commander.scryfallId)}
                              >
                                {nomAffiché}
                              </span>
                            </span>
                          );
                        })}
                        {/* La date suit la langue choisie, et non un `'fr-FR'` figé :
                            « 09/18/2026 » sous un texte français, ou « 18/09/2026 »
                            sous un texte anglais, se lit de travers dans les deux
                            sens — et une date mal lue à un jour près se remarque. */}
                        {deck.lastSyncedAt &&
                          ` · ${t('deck.syncedOn', {
                            date: new Date(deck.lastSyncedAt).toLocaleDateString(language),
                          })}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      className="floor-button px-3 py-1.5 text-[0.7rem]"
                      data-testid={`deck-edit-${deck.id}`}
                      onClick={() => setEditing(deck.id)}
                      type="button"
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      className="floor-button px-3 py-1.5 text-[0.7rem]"
                      data-testid={`deck-look-${deck.id}`}
                      onClick={() => setStyling(styling === deck.id ? null : deck.id)}
                      type="button"
                    >
                      {t('deck.look')}
                    </button>
                    {deck.sourceUrl && (
                      <button
                        className="floor-button px-3 py-1.5 text-[0.7rem]"
                        disabled={busy}
                        onClick={() => void resync(deck.id)}
                        type="button"
                      >
                        {t('deck.resync')}
                      </button>
                    )}
                    <button
                      className="floor-button floor-button-danger px-3 py-1.5 text-[0.7rem]"
                      onClick={() => void api.del(`/api/decks/${deck.id}`).then(refresh)}
                      type="button"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>

                {/*
                  Les illustrations choisies à la main sur ce deck.

                  On les **montre** avant de proposer de les rendre : chaque nom
                  porte le même survol que les commandants juste au-dessus, donc
                  l'illustration en jeu s'affiche dans l'aperçu — c'est elle
                  qu'on s'apprête à perdre, et la voir vaut mieux que de la lire.

                  Rien ne s'affiche tant qu'il n'y a rien d'épinglé, c'est-à-dire
                  sur la quasi-totalité des decks : la ligne ne s'alourdit que
                  pour ceux à qui la question se pose.
                */}
                {deck.pinnedPrintings.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[0.78rem] text-[color:var(--site-floor-dim)]">
                      {t('deck.pinnedPrintings', { count: deck.pinnedPrintings.length })} ·{' '}
                      {deck.pinnedPrintings.map((printing, index) => (
                        <span key={`${printing.scryfallId}-${index}`}>
                          {index > 0 && ' · '}
                          <span
                            className="cursor-help underline decoration-dotted underline-offset-2"
                            data-test="deck-pinned-printing"
                            {...previewHoverProps(printing.scryfallId)}
                          >
                            {printing.name}
                          </span>{' '}
                          <span className="typed">{printing.setCode.toUpperCase()}</span>
                        </span>
                      ))}
                    </span>
                    <button
                      className="floor-button px-2.5 py-1 text-[0.66rem]"
                      data-testid={`deck-unpin-${deck.id}`}
                      disabled={busy}
                      onClick={() => void releasePinnedPrintings(deck.id)}
                      title={t('deck.pinnedReleaseHint')}
                      type="button"
                    >
                      {t('deck.pinnedRelease')}
                    </button>
                  </div>
                )}

                {styling === deck.id && (
                  <DeckLook
                    deck={deck}
                    onClose={() => setStyling(null)}
                    onSaved={() => {
                      setStyling(null);
                      void refresh();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>

      {editing !== null && (
        <DeckEditor deckId={editing} onClose={() => setEditing(null)} onSaved={() => void refresh()} />
      )}

      {/*
        Le même aperçu qu'à la table, au même endroit — en bas à gauche. Il est
        `fixed` et transparent aux gestes : il ne recouvre aucun champ de saisie
        au sens où il empêcherait d'y écrire, et les listes continuent de
        défiler sous lui.

        Monté ici, il sert les commandants de la liste. L'éditeur monte le sien,
        parce que son voile `z-50` ouvre un contexte d'empilement dont celui-ci
        ne peut pas sortir — et **il n'y en a jamais deux à la fois** : la
        recette d'interface compte les `data-test="card-preview"`, et deux
        panneaux superposés n'auraient de toute façon rien à s'apprendre.
      */}
      {editing === null && <CardPreview />}

      <LegalFooter />
    </div>
  );
}
