/**
 * Éditeur de deck, carte par carte (D1).
 *
 * L'éditeur ne construit aucune liste texte lui-même : il envoie ses entrées
 * structurées à `PUT /api/decks/:id/cards`, et c'est le serveur qui les rend en
 * liste puis les repasse par le parseur et la résolution Scryfall. Il n'existe
 * donc qu'un seul générateur de liste, côté serveur, et l'éditeur hérite
 * gratuitement du rapport d'import — suggestions par distance comprises.
 *
 * Les images sont chargées par le navigateur depuis le CDN Scryfall
 * (`scryfallImage`), jamais servies par notre serveur. La recherche de cartes
 * tape `/api/cards/search`, c'est-à-dire la base locale alimentée par le bulk.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeckZone, ImportReport } from '@mtg/shared';
import { api, ApiError, type CardMeta } from '../lib/api.js';
import { scryfallImage } from '../lib/cards.js';
import { useCloseOnEscape } from '../lib/overlay.js';
import { ImportReportView } from './ImportReportView.js';

/** Mots-clés Magic en anglais, libellés d'interface en français. */
const ZONE_LABEL: Record<DeckZone, string> = {
  COMMANDER: 'Commander',
  MAIN: 'Deck',
  SIDEBOARD: 'Sideboard',
};
const ZONES: DeckZone[] = ['COMMANDER', 'MAIN', 'SIDEBOARD'];

interface EditorEntry {
  scryfallId: string;
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
  quantity: number;
  zone: DeckZone;
  isFoil: boolean;
  typeLine: string;
}

interface EditorView {
  id: string;
  name: string;
  format: string | null;
  source: string;
  sourceUrl: string | null;
  synced: boolean;
  entries: EditorEntry[];
  text: string;
}

/** Ligne de travail : une clé locale stable, pour que React suive les réordonnancements. */
interface Row extends EditorEntry {
  key: string;
}

let nextKey = 0;
function toRows(entries: EditorEntry[]): Row[] {
  return entries.map((e) => ({ ...e, key: `r${nextKey++}` }));
}

export function DeckEditor({
  deckId,
  onClose,
  onSaved,
}: {
  deckId: string;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  useCloseOnEscape(onClose);

  const [view, setView] = useState<EditorView | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  /** Posée quand le serveur a répondu 409 : l'enregistrement détachera le deck. */
  const [detachAsked, setDetachAsked] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void api
      .get<EditorView>(`/api/decks/${deckId}/editor`)
      .then((v) => {
        setView(v);
        setRows(toRows(v.entries));
        setName(v.name);
        setRawText(v.text);
      })
      .catch((err: unknown) => {
        setError({ message: err instanceof ApiError ? err.message : 'Deck illisible.' });
      });
  }, [deckId]);

  const patch = useCallback((key: string, change: Partial<Row>) => {
    setDirty(true);
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }, []);

  const remove = useCallback((key: string) => {
    setDirty(true);
    setRows((current) => current.filter((r) => r.key !== key));
  }, []);

  const addCard = useCallback((card: CardMeta, zone: DeckZone) => {
    setDirty(true);
    setRows((current) => [
      ...current,
      {
        key: `r${nextKey++}`,
        scryfallId: card.scryfallId,
        name: card.name,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        quantity: 1,
        zone,
        isFoil: false,
        typeLine: card.typeLine,
      },
    ]);
  }, []);

  async function save(detach: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const payload = rawMode
        ? { text: rawText }
        : {
            entries: rows.map((r) => ({
              name: r.name,
              setCode: r.setCode,
              collectorNumber: r.collectorNumber,
              quantity: r.quantity,
              zone: r.zone,
              isFoil: r.isFoil,
            })),
          };

      const result = await api.put<{ report: ImportReport }>(`/api/decks/${deckId}/cards`, {
        ...payload,
        name,
        ...(detach ? { detachFromSource: true } : {}),
      });

      setReport(result.report);
      setDirty(false);
      setDetachAsked(false);
      onSaved();

      // Le deck a changé sous nos pieds (éditions retenues, doublons fusionnés) :
      // on relit ce que le serveur a réellement enregistré plutôt que de garder
      // notre vue optimiste.
      const fresh = await api.get<EditorView>(`/api/decks/${deckId}/editor`);
      setView(fresh);
      setRows(toRows(fresh.entries));
      setRawText(fresh.text);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SOURCE_SYNCED') {
        setDetachAsked(true);
        setError({ message: err.message, hint: err.hint });
      } else if (err instanceof ApiError) {
        setError({ message: err.message, hint: err.hint });
      } else {
        setError({ message: 'Enregistrement impossible.' });
      }
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const byZone = { COMMANDER: 0, MAIN: 0, SIDEBOARD: 0 } as Record<DeckZone, number>;
    for (const r of rows) byZone[r.zone] += r.quantity;
    return byZone;
  }, [rows]);

  return (
    <div className="site fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-3 sm:p-8" onClick={onClose}>
      <div
        className="dark-panel flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg shadow-[0_30px_70px_-20px_rgba(0,0,0,0.9)]"
        data-testid="deck-editor"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-[color:var(--site-floor-rule)] px-5 py-4">
          <input
            aria-label="Nom du deck"
            className="dark-field sign-sm min-w-0 flex-1 basis-[12rem] rounded px-3 py-2 text-[0.85rem]"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
          />
          <span className="typed text-[0.76rem] text-[color:var(--site-floor-dim)]">
            {counts.COMMANDER > 0 && `${counts.COMMANDER} commander · `}
            {counts.MAIN} deck
            {counts.SIDEBOARD > 0 && ` · ${counts.SIDEBOARD} sideboard`}
          </span>
          <button
            className="floor-button rounded px-2.5 py-1.5 text-[0.68rem]"
            onClick={() => {
              // La liste texte n'est rendue que par le serveur : changer de mode
              // repart donc du dernier état enregistré. On prévient plutôt que
              // de laisser filer des modifications en silence.
              if (dirty && !window.confirm('Changer de mode abandonne les modifications non enregistrées. Continuer ?')) {
                return;
              }
              if (view) {
                setRows(toRows(view.entries));
                setName(view.name);
                setRawText(view.text);
              }
              setDirty(false);
              setError(null);
              setRawMode((m) => !m);
            }}
          >
            {rawMode ? 'Mode liste' : 'Mode texte'}
          </button>
          <button className="floor-button rounded px-2.5 py-1.5 text-[0.68rem]" onClick={onClose}>
            Fermer
          </button>
        </header>

        {view?.synced && (
          <p className="border-b border-amber-700/50 bg-amber-950/40 px-5 py-2.5 text-[0.78rem] text-amber-200">
            Ce deck est synchronisé depuis {view.source.toLowerCase()}. L'enregistrer le détachera de
            sa source : vos corrections seront conservées, mais la resynchronisation ne sera plus
            proposée.
          </p>
        )}

        <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
          {view === null && !error && <p className="text-[0.88rem] text-[color:var(--site-floor-dim)]">Chargement…</p>}

          {view !== null && rawMode && (
            <textarea
              aria-label="Liste du deck"
              className="scrollbar-thin dark-field typed h-96 w-full resize-none rounded px-3 py-2 text-[0.8rem] leading-relaxed"
              value={rawText}
              onChange={(event) => {
                setRawText(event.target.value);
                setDirty(true);
              }}
            />
          )}

          {view !== null && !rawMode && (
            <div className="space-y-5">
              {ZONES.map((zone) => {
                const inZone = rows.filter((r) => r.zone === zone);
                if (inZone.length === 0 && zone !== 'MAIN') return null;
                return (
                  <section key={zone}>
                    <h3 className="sign-sm mb-2.5 text-[0.68rem] text-[color:var(--site-stamp-pale)]">
                      {ZONE_LABEL[zone]} <span className="font-normal">({counts[zone]})</span>
                    </h3>
                    {inZone.length === 0 && <p className="text-[0.78rem] text-[color:var(--site-floor-dim)]">Vide.</p>}
                    <ul className="space-y-1">
                      {inZone.map((row) => (
                        <CardRow key={row.key} row={row} onChange={patch} onRemove={remove} />
                      ))}
                    </ul>
                  </section>
                );
              })}

              <AddCard onAdd={addCard} />
            </div>
          )}
        </div>

        {(error || report) && (
          <div className="space-y-3 border-t border-[color:var(--site-floor-rule)] p-5">
            {error && (
              <div className="border-2 border-[color:var(--site-alarm-floor)]/70 px-3.5 py-2.5 text-[0.88rem]" role="alert">
                <p className="text-[color:var(--site-alarm-floor)]">{error.message}</p>
                {error.hint && (
                  <p className="mt-1 text-[color:var(--site-floor-dim)]">{error.hint}</p>
                )}
              </div>
            )}
            {report && <ImportReportView report={report} />}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-[color:var(--site-floor-rule)] px-5 py-4">
          {dirty && <span className="sign-sm mr-auto text-[0.68rem] text-amber-300">Modifications non enregistrées</span>}
          {detachAsked ? (
            <button
              className="floor-button rounded px-4 py-2.5 text-[0.72rem]"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Détacher de la source et enregistrer
            </button>
          ) : (
            <button
              className="ink-button px-5 py-2.5 text-[0.78rem]"
              data-testid="deck-editor-save"
              disabled={busy || view === null}
              onClick={() => void save(false)}
            >
              Enregistrer
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Une carte de la liste : quantité, zone, édition, foil, retrait. */
function CardRow({
  row,
  onChange,
  onRemove,
}: {
  row: Row;
  onChange: (key: string, change: Partial<Row>) => void;
  onRemove: (key: string) => void;
}): React.ReactElement {
  const [pickingEdition, setPickingEdition] = useState(false);

  return (
    <li className="rounded border border-[color:var(--site-floor-rule)] bg-[color:var(--site-floor)]/70 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <img
          alt=""
          className="h-10 w-7 shrink-0 rounded-sm object-cover"
          loading="lazy"
          src={scryfallImage(row.scryfallId, 'small')}
        />

        <div className="min-w-0 flex-1 basis-[10rem]">
          <p className="truncate text-[0.9rem]">{row.name}</p>
          <p className="typed truncate text-[0.7rem] text-[color:var(--site-floor-dim)]">
            {row.setCode?.toUpperCase() ?? '—'} {row.collectorNumber ?? ''} · {row.typeLine}
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:shrink-0 sm:flex-nowrap">
          <button
            aria-label={`Retirer un exemplaire de ${row.name}`}
            className="floor-button h-6 w-6 rounded text-[0.72rem]"
            disabled={row.quantity <= 1}
            onClick={() => onChange(row.key, { quantity: row.quantity - 1 })}
          >
            −
          </button>
          <input
            aria-label={`Quantité de ${row.name}`}
            className="dark-field typed w-12 rounded px-1 py-0.5 text-center text-[0.75rem]"
            max={1000}
            min={1}
            type="number"
            value={row.quantity}
            onChange={(event) =>
              onChange(row.key, { quantity: Math.max(1, Math.min(1000, Number(event.target.value) || 1)) })
            }
          />
          <button
            aria-label={`Ajouter un exemplaire de ${row.name}`}
            className="floor-button h-6 w-6 rounded text-[0.72rem]"
            onClick={() => onChange(row.key, { quantity: row.quantity + 1 })}
          >
            +
          </button>

          <select
            aria-label={`Zone de ${row.name}`}
            className="dark-field dark-select rounded py-1 pl-2 text-[0.72rem]"
            value={row.zone}
            onChange={(event) => onChange(row.key, { zone: event.target.value as DeckZone })}
          >
            {ZONES.map((z) => (
              <option key={z} value={z}>
                {ZONE_LABEL[z]}
              </option>
            ))}
          </select>

          <button
            aria-pressed={row.isFoil}
            className="floor-toggle rounded px-2.5 py-1.5 text-[0.68rem]"
            onClick={() => onChange(row.key, { isFoil: !row.isFoil })}
            title={row.isFoil ? 'Impression foil' : 'Impression normale'}
            type="button"
          >
            Foil
          </button>

          <button
            className="floor-button rounded px-2.5 py-1.5 text-[0.68rem]"
            onClick={() => setPickingEdition((p) => !p)}
          >
            Édition
          </button>

          <button
            aria-label={`Retirer ${row.name}`}
            className="floor-button floor-button-danger rounded px-2.5 py-1.5 text-[0.68rem]"
            onClick={() => onRemove(row.key)}
          >
            ✕
          </button>
        </div>
      </div>

      {pickingEdition && (
        <EditionPicker
          scryfallId={row.scryfallId}
          onPick={(printing) => {
            onChange(row.key, {
              scryfallId: printing.scryfallId,
              name: printing.name,
              setCode: printing.setCode,
              collectorNumber: printing.collectorNumber,
            });
            setPickingEdition(false);
          }}
        />
      )}
    </li>
  );
}

/** Impressions d'une carte, servies par la base locale — jamais par Scryfall. */
function EditionPicker({
  scryfallId,
  onPick,
}: {
  scryfallId: string;
  onPick: (printing: CardMeta) => void;
}): React.ReactElement {
  const [printings, setPrintings] = useState<CardMeta[] | null>(null);

  useEffect(() => {
    void api
      .get<{ printings: CardMeta[] }>(`/api/cards/${scryfallId}/printings`)
      .then((r) => setPrintings(r.printings))
      .catch(() => setPrintings([]));
  }, [scryfallId]);

  return (
    <div className="scrollbar-thin mt-2 flex max-h-40 gap-2 overflow-x-auto border-t border-[color:var(--site-floor-rule)] pt-2.5">
      {printings === null && <p className="typed text-[0.76rem] text-[color:var(--site-floor-dim)]">Chargement des impressions…</p>}
      {printings?.length === 0 && <p className="typed text-[0.76rem] text-[color:var(--site-floor-dim)]">Aucune autre impression.</p>}
      {printings?.map((printing) => (
        <button
          key={printing.scryfallId}
          className={`shrink-0 text-left ${printing.scryfallId === scryfallId ? 'ring-2 ring-[color:var(--site-stamp)]' : ''}`}
          onClick={() => onPick(printing)}
        >
          <img
            alt={`${printing.name} (${printing.setCode})`}
            className="h-24 w-auto rounded"
            loading="lazy"
            src={scryfallImage(printing.scryfallId, 'small')}
          />
          <p className="typed mt-1 truncate text-[0.66rem] uppercase text-[color:var(--site-floor-dim)]">
            {printing.setCode} · {printing.collectorNumber}
          </p>
        </button>
      ))}
    </div>
  );
}

/** Ajout d'une carte par recherche sur la base locale. */
function AddCard({ onAdd }: { onAdd: (card: CardMeta, zone: DeckZone) => void }): React.ReactElement {
  const [query, setQuery] = useState('');
  const [zone, setZone] = useState<DeckZone>('MAIN');
  const [results, setResults] = useState<CardMeta[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .get<{ results: CardMeta[] }>(`/api/cards/search?q=${encodeURIComponent(query)}&type=card`)
        .then((r) => setResults(r.results))
        .catch(() => setResults([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <section className="rounded border border-[color:var(--site-floor-rule)] bg-[color:var(--site-floor)]/60 p-4">
      <h3 className="sign-sm mb-2.5 text-[0.68rem] text-[color:var(--site-stamp-pale)]">Ajouter une carte</h3>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          aria-label="Chercher une carte"
          className="dark-field flex-1 rounded px-3 py-2 text-[0.85rem]"
          data-testid="deck-editor-search"
          placeholder="Nom de la carte…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Zone d'ajout"
          className="dark-field dark-select rounded py-2 pl-2.5 text-[0.75rem]"
          value={zone}
          onChange={(event) => setZone(event.target.value as DeckZone)}
        >
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {ZONE_LABEL[z]}
            </option>
          ))}
        </select>
      </div>

      {results.length > 0 && (
        <ul className="scrollbar-thin mt-2 max-h-48 space-y-1 overflow-y-auto">
          {results.map((card) => (
            <li key={card.scryfallId}>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[color:var(--site-floor-lift)]"
                data-testid="deck-editor-result"
                onClick={() => {
                  onAdd(card, zone);
                  setQuery('');
                  setResults([]);
                  inputRef.current?.focus();
                }}
              >
                <img
                  alt=""
                  className="h-8 w-6 shrink-0 rounded-sm object-cover"
                  loading="lazy"
                  src={scryfallImage(card.scryfallId, 'small')}
                />
                <span className="min-w-0 flex-1 truncate text-[0.88rem]">{card.name}</span>
                <span className="typed shrink-0 text-[0.7rem] uppercase text-[color:var(--site-floor-dim)]">{card.setCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
