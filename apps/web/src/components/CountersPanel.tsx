/**
 * Compteurs de joueur : création, ajustement, suppression.
 *
 * Remplace les enchaînements de `window.prompt` qui servaient jusqu'ici. Côté
 * protocole il n'y a qu'un intent, `SET_PLAYER_COUNTER`, et une convention :
 * **la valeur zéro supprime le compteur**, comme un marqueur de carte remis à
 * zéro. C'est ce qui permet de retirer un compteur posé par erreur plutôt que
 * de laisser une ligne morte dans le panneau.
 */
import { useState } from 'react';
import { useGame } from '../store/game.js';
import { useCloseOnEscape } from '../lib/overlay.js';

/** Les compteurs qu'on pose réellement à une table, dans l'ordre de fréquence. */
const COMMON = [
  { kind: 'poison', label: 'Poison', color: '#84cc16' },
  { kind: 'énergie', label: 'Énergie', color: '#38bdf8' },
  { kind: 'expérience', label: 'Expérience', color: '#f59e0b' },
  { kind: 'rad', label: 'Radiation', color: '#22c55e' },
  { kind: 'ticket', label: 'Ticket', color: '#e879f9' },
  { kind: 'ville', label: "L'Initiative / Ville", color: '#fbbf24' },
];

export function CountersPanel({ onClose }: { onClose: () => void }): React.ReactElement | null {
  const mySeat = useGame((s) => s.mySeat);
  const seats = useGame((s) => s.seats);
  const send = useGame((s) => s.send);
  const [custom, setCustom] = useState('');
  useCloseOnEscape(onClose);

  const me = seats.find((s) => s.id === mySeat);
  if (!me) return null;

  /*
   * Un compteur de joueur porte toujours un nombre — c'est le marqueur d'une
   * **carte** qui peut n'être qu'un mot-clé, et les deux partagent le même
   * type. D'où ce repli à zéro, qui ne se produit jamais en pratique.
   */
  const existing = new Map(me.playerCounters.map((c) => [c.kind, c.value ?? 0]));
  const set = (kind: string, value: number): void => {
    // Borné à zéro : on ne descend pas sous la suppression.
    send({ type: 'SET_PLAYER_COUNTER', seat: me.id, kind, value: Math.max(0, value) });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-8" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-lg border border-edge bg-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="font-medium">Compteurs de joueur</h2>
          <button className="text-slate-500 hover:text-slate-200" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="space-y-4 p-4">
          {existing.size > 0 ? (
            <ul className="space-y-2">
              {[...existing].map(([kind, value]) => {
                const known = COMMON.find((c) => c.kind === kind);
                return (
                  <li
                    key={kind}
                    className="flex items-center gap-3 rounded border border-edge/70 px-3 py-2"
                    /* Repères de recette : le défaut « retirer le met à 0 mais
                       ne l'enlève pas » ne se constate qu'en vérifiant que la
                       ligne **disparaît**, pas qu'elle affiche 0. */
                    data-test="player-counter-row"
                    data-counter={kind}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: known?.color ?? '#94a3b8' }}
                    />
                    <span className="flex-1 truncate text-sm">{known?.label ?? kind}</span>
                    <button
                      className="h-7 w-7 rounded bg-slate-800 text-lg leading-none hover:bg-slate-700"
                      onClick={() => set(kind, value - 1)}
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-lg font-semibold">{value}</span>
                    <button
                      className="h-7 w-7 rounded bg-slate-800 text-lg leading-none hover:bg-slate-700"
                      onClick={() => set(kind, value + 1)}
                    >
                      +
                    </button>
                    <button
                      className="ml-1 rounded px-2 py-1 text-xs text-rose-300 hover:bg-rose-950/60"
                      data-test="player-counter-remove"
                      onClick={() => set(kind, 0)}
                      title="Retirer ce compteur"
                    >
                      Retirer
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Aucun compteur. Ajoutez-en un ci-dessous.</p>
          )}

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Ajouter</p>
            <div className="flex flex-wrap gap-2">
              {COMMON.filter((c) => !existing.has(c.kind)).map((counter) => (
                <button
                  key={counter.kind}
                  className="rounded border border-edge px-3 py-1.5 text-sm hover:border-slate-500"
                  onClick={() => set(counter.kind, 1)}
                >
                  <span
                    className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: counter.color }}
                  />
                  {counter.label}
                </button>
              ))}
            </div>
          </div>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const kind = custom.trim();
              if (!kind) return;
              set(kind, 1);
              setCustom('');
            }}
          >
            <input
              className="flex-1 rounded border border-edge bg-table px-3 py-2 text-sm"
              maxLength={64}
              placeholder="Compteur personnalisé…"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
            />
            <button
              className="rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              disabled={custom.trim().length === 0}
              type="submit"
            >
              Ajouter
            </button>
          </form>
        </div>

        <footer className="border-t border-edge px-4 py-2 text-xs text-slate-500">
          Les compteurs sont visibles de toute la table. Les remettre à zéro les retire.
        </footer>
      </div>
    </div>
  );
}
