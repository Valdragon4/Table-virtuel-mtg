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
import { LegalFooter } from '../components/LegalFooter.js';
import { Wordmark } from '../components/Mark.js';

export function DecksPage(): React.ReactElement {
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
      if (err instanceof ApiError) setError({ message: err.message, hint: err.hint });
      else setError({ message: 'Import impossible.' });
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
            Mes tables
          </Link>
          <Link
            className="sign-sm text-[0.72rem] text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
            to="/"
          >
            Retour à l’accueil
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-[72rem] px-5 pb-16 sm:px-8">
        <h1 className="sign text-[clamp(2rem,5vw,3rem)] text-[color:var(--site-floor-text)]">
          Mes decks
        </h1>
        <p className="mt-3 max-w-[58ch] text-[0.95rem] leading-relaxed text-[color:var(--site-floor-dim)]">
          Ce que vous gardez ici vous suit d’une table à l’autre. Rien n’y est obligatoire :
          une liste collée directement au salon d’une table fonctionne tout aussi bien.
        </p>

        {/* Les deux chemins d'import. Ils sont de même rang : le collage n'est
            pas un repli, c'est le chemin par défaut pour Moxfield. */}
        <section className="mt-9 grid gap-5 md:grid-cols-2">
          <div className="cut-shadow">
            <div className="paper paper-cut flex h-full flex-col p-6">
              <h2 className="sign-sm text-[0.78rem]">Importer depuis une URL</h2>
              <div className="rule-ink mt-3 flex flex-1 flex-col pt-5">
                <p className="paper-dim mb-4 text-[0.83rem] leading-relaxed">
                  Archidekt est pris en charge directement. Pour Moxfield, passez par le
                  collage : leur API n’est pas ouverte aux applications tierces, et nous ne
                  la contournons pas.
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
                  {busy ? 'Import…' : 'Importer'}
                </button>
              </div>
            </div>
          </div>

          <div className="cut-shadow">
            <div className="paper paper-cut flex h-full flex-col p-6">
              <h2 className="sign-sm text-[0.78rem]">Coller une liste</h2>
              <div className="rule-ink mt-3 flex flex-1 flex-col pt-5">
                <p className="paper-dim mb-4 text-[0.83rem] leading-relaxed">
                  Un export Moxfield, MTGO, TappedOut, ou une liste tapée à la main. Les
                  sections <span className="typed">Commander</span> et{' '}
                  <span className="typed">Sideboard</span> sont reconnues.
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
                  {busy ? 'Import…' : 'Importer la liste collée'}
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
          </div>
        )}

        <section className="mt-12">
          <h2 className="sign rule-stamp pt-6 text-[1.4rem] text-[color:var(--site-floor-text)]">
            Decks enregistrés
          </h2>

          {decks === null && (
            <p className="mt-5 text-[0.9rem] text-[color:var(--site-floor-dim)]">Chargement…</p>
          )}
          {decks?.length === 0 && (
            <p className="mt-5 max-w-[56ch] text-[0.92rem] leading-relaxed text-[color:var(--site-floor-dim)]">
              Aucun deck pour l’instant. Importez-en un ci-dessus — ou jouez sans compte, en
              collant une liste directement au salon d’une table.
            </p>
          )}

          <ul className="mt-2">
            {decks?.map((deck) => (
              <li className="rule-floor py-5" key={deck.id}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="sign-sm truncate text-[1rem] text-[color:var(--site-floor-text)]">
                      {deck.name}
                    </p>
                    <p className="mt-1 text-[0.82rem] text-[color:var(--site-floor-dim)]">
                      <span className="typed">{deck.cardCount}</span> cartes ·{' '}
                      {deck.source.toLowerCase()}
                      {deck.commanders.length > 0 &&
                        ` · ${deck.commanders.map((c) => c.name).join(' & ')}`}
                      {deck.lastSyncedAt &&
                        ` · synchronisé le ${new Date(deck.lastSyncedAt).toLocaleDateString('fr-FR')}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      className="floor-button px-3 py-1.5 text-[0.7rem]"
                      data-testid={`deck-edit-${deck.id}`}
                      onClick={() => setEditing(deck.id)}
                      type="button"
                    >
                      Modifier
                    </button>
                    <button
                      className="floor-button px-3 py-1.5 text-[0.7rem]"
                      data-testid={`deck-look-${deck.id}`}
                      onClick={() => setStyling(styling === deck.id ? null : deck.id)}
                      type="button"
                    >
                      Apparence
                    </button>
                    {deck.sourceUrl && (
                      <button
                        className="floor-button px-3 py-1.5 text-[0.7rem]"
                        disabled={busy}
                        onClick={() => void resync(deck.id)}
                        type="button"
                      >
                        Resynchroniser
                      </button>
                    )}
                    <button
                      className="floor-button floor-button-danger px-3 py-1.5 text-[0.7rem]"
                      onClick={() => void api.del(`/api/decks/${deck.id}`).then(refresh)}
                      type="button"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>

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

      <LegalFooter />
    </div>
  );
}
