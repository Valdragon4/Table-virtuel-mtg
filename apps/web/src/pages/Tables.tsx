/**
 * « Mes tables » : les parties où ce compte a une place.
 *
 * Une table de Magic ne se ferme pas toute seule. Tant qu'on n'a pas rangé, on
 * y a une chaise, un deck posé et une partie en cours — et l'on doit pouvoir
 * retrouver tout ça depuis n'importe quel appareil, y revenir, s'en aller pour
 * de bon, ou, si l'on en est l'hôte, dire « on remballe ».
 *
 * Les deux actions destructrices sont nommées pour ce qu'elles font : quitter
 * en cours de partie vaut concession, clore arrête la partie de tout le monde.
 * Aucune des deux ne se déclenche sans confirmation.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { LegalFooter } from '../components/LegalFooter.js';
import { Wordmark } from '../components/Mark.js';

interface GameRow {
  code: string;
  mode: string;
  status: 'LOBBY' | 'PLAYING' | 'ENDED';
  seatIndex: number | null;
  isHost: boolean;
  joinedAt: string | null;
  createdAt: string;
  lastActivityAt: string;
  players: number;
}

const MODE_LABELS: Record<string, string> = {
  COMMANDER: 'Commander',
  DUEL: 'Duel',
  DRAFT: 'Draft',
};

const STATUS_LABELS: Record<GameRow['status'], string> = {
  LOBBY: 'Salon',
  PLAYING: 'Partie en cours',
  ENDED: 'Terminée',
};

/** « il y a 3 h », plutôt qu'une date à décoder. */
function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

export function Tables(): React.ReactElement {
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api.get<{ games: GameRow[] }>('/api/games');
      setGames(data.games);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setGames([]);
      else setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function leave(game: GameRow): Promise<void> {
    const warning =
      game.status === 'PLAYING'
        ? `Quitter la table ${game.code} pendant la partie ? Cela vaut concession : votre jeu quitte le terrain et la partie continue sans vous.`
        : `Quitter la table ${game.code} ? Votre place et votre deck y sont libérés.`;
    if (!window.confirm(warning)) return;
    setBusyCode(game.code);
    setError(null);
    try {
      await api.post(`/api/rooms/${game.code}/leave`, { force: game.status === 'PLAYING' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Départ impossible.');
    } finally {
      setBusyCode(null);
    }
  }

  async function close(game: GameRow): Promise<void> {
    if (!window.confirm(`Clore la table ${game.code} pour tout le monde ? La partie s'arrête pour tous les joueurs.`)) {
      return;
    }
    setBusyCode(game.code);
    setError(null);
    try {
      await api.post(`/api/rooms/${game.code}/close`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Clôture impossible.');
    } finally {
      setBusyCode(null);
    }
  }

  const current = (games ?? []).filter((g) => g.status !== 'ENDED');
  const past = (games ?? []).filter((g) => g.status === 'ENDED');

  return (
    <div className="site site-floor flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-[78rem] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link className="inline-block" to="/">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-5 text-[0.85rem]">
          <Link
            className="text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
            to="/decks"
          >
            Mes decks
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[56rem] flex-1 px-5 pb-16 pt-2 sm:px-8">
        <h1 className="sign text-[2rem] leading-none text-[color:var(--site-floor-text)]">
          Mes tables
        </h1>
        <p className="mt-3 max-w-[42rem] text-[0.9rem] leading-relaxed text-[color:var(--site-floor-dim)]">
          Les parties où vous avez une place. Revenir ne coûte rien : votre siège,
          votre main et votre bibliothèque vous attendent.
        </p>

        {error && (
          <p
            className="mt-5 border-2 border-[#8c2438] px-3 py-2 text-[0.85rem] text-[#f0a1ae]"
            role="alert"
          >
            {error}
          </p>
        )}

        {games === null ? (
          <p className="mt-8 text-[0.9rem] text-[color:var(--site-floor-dim)]">Chargement…</p>
        ) : current.length === 0 ? (
          <div className="cut-shadow mt-8">
            <div className="paper paper-cut p-6">
              <p className="text-[0.95rem] text-[color:var(--site-ink)]">
                Aucune table en cours.
              </p>
              <p className="mt-2 text-[0.85rem] text-[color:var(--site-ink-soft)]">
                Ouvrez-en une depuis l'accueil, ou collez le lien que l'on vous a envoyé.
              </p>
              <Link className="ink-button mt-4 inline-block px-5 py-2.5 text-[0.78rem]" to="/">
                Ouvrir une table
              </Link>
            </div>
          </div>
        ) : (
          <ul className="mt-8 grid gap-4" data-test="tables-current">
            {current.map((game) => (
              <TableCard
                busy={busyCode === game.code}
                game={game}
                key={game.code}
                onClose={() => void close(game)}
                onLeave={() => void leave(game)}
              />
            ))}
          </ul>
        )}

        {past.length > 0 && (
          <>
            <h2 className="sign mt-12 text-[1.2rem] text-[color:var(--site-floor-text)]">
              Tables closes
            </h2>
            <ul className="mt-4 grid gap-2 text-[0.85rem]" data-test="tables-past">
              {past.map((game) => (
                <li
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-[color:var(--site-floor-rule)] pt-2 text-[color:var(--site-floor-dim)]"
                  key={game.code}
                >
                  <span className="typed text-[color:var(--site-floor-text)]">{game.code}</span>
                  <span>{MODE_LABELS[game.mode] ?? game.mode}</span>
                  <span className="ml-auto">{ago(game.lastActivityAt)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      <LegalFooter />
    </div>
  );
}

function TableCard({
  game,
  busy,
  onLeave,
  onClose,
}: {
  game: GameRow;
  busy: boolean;
  onLeave: () => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <li className="cut-shadow">
      <div className="paper paper-cut p-5" data-test={`table-${game.code}`}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="sign text-[1.35rem] leading-none text-[color:var(--site-ink)]">
            {game.code}
          </span>
          <span className="stamped">{STATUS_LABELS[game.status]}</span>
          {game.isHost && <span className="stamped">Hôte</span>}
          <span className="ml-auto text-[0.8rem] text-[color:var(--site-ink-soft)]">
            {ago(game.lastActivityAt)}
          </span>
        </div>

        <p className="mt-2 text-[0.85rem] text-[color:var(--site-ink-soft)]">
          {[
            MODE_LABELS[game.mode] ?? game.mode,
            game.seatIndex !== null
              ? `votre siège nº${game.seatIndex + 1}`
              : 'vous n’y êtes pas encore assis',
            game.players > 0 ? `${game.players} joueur${game.players > 1 ? 's' : ''} à table` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link className="ink-button px-5 py-2.5 text-[0.78rem]" to={`/rooms/${game.code}`}>
            {game.seatIndex === null ? 'Rejoindre' : 'Revenir à la table'}
          </Link>
          {game.seatIndex !== null && (
            <button
              className="floor-button px-4 py-2.5 text-[0.72rem]"
              disabled={busy}
              onClick={onLeave}
              type="button"
            >
              Quitter la table
            </button>
          )}
          {game.isHost && (
            <button
              className="floor-button px-4 py-2.5 text-[0.72rem]"
              disabled={busy}
              onClick={onClose}
              style={{
                borderColor: 'var(--site-alarm)',
                color: 'var(--site-alarm)',
              }}
              type="button"
            >
              Clore la table
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
