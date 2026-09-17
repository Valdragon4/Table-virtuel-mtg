/**
 * Réglages cosmétiques du siège : playmat et dos de carte.
 *
 * Deux sources : les playmats enregistrés sur le compte (`/api/me`, créés par
 * `/api/me/playmats`) et une URL libre, pour qui joue en invité. Rien n'est
 * appliqué localement — on envoie `SET_SEAT_COSMETICS` et on attend l'event.
 *
 * Aucune image n'est hébergée ni redistribuée par ce projet : le navigateur va
 * chercher celle dont le joueur donne l'adresse.
 */
import { useEffect, useState } from 'react';
import { api, type Me } from '../lib/api.js';
import { useGame } from '../store/game.js';
import { useCloseOnEscape } from '../lib/overlay.js';

export function SeatSettings({ onClose }: { onClose: () => void }): React.ReactElement {
  const send = useGame((s) => s.send);
  const mySeat = useGame((s) => s.mySeat);
  const seats = useGame((s) => s.seats);
  const me = seats.find((s) => s.id === mySeat);

  const [account, setAccount] = useState<Me | null>(null);
  const [playmatUrl, setPlaymatUrl] = useState(me?.playmatUrl ?? '');
  const [cardBackUrl, setCardBackUrl] = useState(me?.cardBackUrl ?? '');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useCloseOnEscape(onClose);

  useEffect(() => {
    void api
      .get<Me>('/api/me')
      .then(setAccount)
      .catch(() => setAccount(null));
  }, []);

  function apply(next: { playmatUrl?: string | null; cardBackUrl?: string | null }): void {
    send({ type: 'SET_SEAT_COSMETICS', ...next });
  }

  async function savePlaymat(): Promise<void> {
    setError(null);
    try {
      await api.post('/api/me/playmats', { name: newName.trim(), imageUrl: playmatUrl.trim() });
      setNewName('');
      setAccount(await api.get<Me>('/api/me'));
    } catch {
      setError("Enregistrement impossible : il faut un compte, un nom et une URL d'image valides.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-edge bg-panel p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-4 font-medium">Playmat et dos de carte</h2>

        {account && account.playmats.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Vos playmats</p>
            <div className="grid grid-cols-3 gap-2">
              {account.playmats.map((playmat) => (
                <button
                  key={playmat.id}
                  className="overflow-hidden rounded border border-edge hover:border-sky-500"
                  onClick={() => {
                    setPlaymatUrl(playmat.imageUrl);
                    apply({ playmatUrl: playmat.imageUrl });
                  }}
                  title={playmat.name}
                >
                  <img alt={playmat.name} className="h-16 w-full object-cover" src={playmat.imageUrl} />
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="mb-3 block text-sm text-slate-400">
          URL du playmat
          <input
            className="mt-1 w-full rounded border border-edge bg-table px-3 py-2 text-sm text-slate-200"
            placeholder="https://…"
            value={playmatUrl}
            onChange={(event) => setPlaymatUrl(event.target.value)}
          />
        </label>

        <div className="mb-4 flex gap-2">
          <button
            className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-white"
            onClick={() => apply({ playmatUrl: playmatUrl.trim() || null })}
          >
            Appliquer
          </button>
          <button
            className="rounded border border-edge px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
            onClick={() => {
              setPlaymatUrl('');
              apply({ playmatUrl: null });
            }}
          >
            Retirer
          </button>
          {account && (
            <>
              <input
                className="w-28 rounded border border-edge bg-table px-2 py-1.5 text-sm text-slate-200"
                placeholder="Nom"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <button
                className="rounded border border-edge px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
                disabled={!newName.trim() || !playmatUrl.trim()}
                onClick={() => void savePlaymat()}
              >
                Enregistrer
              </button>
            </>
          )}
        </div>

        <label className="mb-3 block text-sm text-slate-400">
          URL du dos de carte
          <input
            className="mt-1 w-full rounded border border-edge bg-table px-3 py-2 text-sm text-slate-200"
            placeholder="https://…"
            value={cardBackUrl}
            onChange={(event) => setCardBackUrl(event.target.value)}
          />
        </label>

        <div className="mb-4 flex gap-2">
          <button
            className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-white"
            onClick={() => apply({ cardBackUrl: cardBackUrl.trim() || null })}
          >
            Appliquer
          </button>
          <button
            className="rounded border border-edge px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
            onClick={() => {
              setCardBackUrl('');
              apply({ cardBackUrl: null });
            }}
          >
            Dos neutre
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}
        <p className="mb-4 text-xs text-slate-500">
          Utilisez vos propres images. Ce projet n'héberge ni ne redistribue aucun visuel
          de Wizards of the Coast.
        </p>

        <button
          className="w-full rounded border border-edge py-1.5 text-sm hover:border-slate-500"
          onClick={onClose}
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
