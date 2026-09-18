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
import { AccountBar } from '../components/AccountBar.js';
import { useT, type BoundT } from '../lib/i18n/index.js';

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
  /**
   * Un replay lisible existe pour cette table.
   *
   * Le serveur applique ici le **même** verrou que sur les routes du lecteur —
   * enregistrement clos, donc partie finie. On ne propose donc jamais un lien
   * qui mènerait à « il n'y a pas de replay ici », et surtout jamais sur une
   * partie en cours.
   */
  hasReplay?: boolean;
}

const MODE_LABELS: Record<string, string> = {
  COMMANDER: 'Commander',
  DUEL: 'Duel',
  DRAFT: 'Draft',
};

/**
 * Les clés, pas les phrases : ces tables sont au niveau du module, et `useT`
 * ne s'appelle que dans un composant.
 */
const STATUS_KEYS = {
  LOBBY: 'table.statusLobby',
  PLAYING: 'table.statusPlaying',
  ENDED: 'table.statusEnded',
} as const satisfies Record<GameRow['status'], string>;

/** « il y a 3 h », plutôt qu'une date à décoder. */
function ago(iso: string, t: BoundT): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { value: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { value: hours });
  const days = Math.round(hours / 24);
  return t('time.daysAgo', { value: days });
}

export function Tables(): React.ReactElement {
  const t = useT();
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api.get<{ games: GameRow[] }>('/api/games');
      setGames(data.games);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setGames([]);
      // Le message d'`ApiError` vient du serveur : il s'affiche tel quel.
      else setError(err instanceof ApiError ? err.message : t('common.loadFailed'));
    }
    // `t` n'est pas en dépendance à dessein : changer de langue ne doit pas
    // relancer le chargement de la liste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function leave(game: GameRow): Promise<void> {
    const warning =
      game.status === 'PLAYING'
        ? t('table.leaveWhilePlayingConfirmCode', { code: game.code })
        : t('table.leaveConfirmCode', { code: game.code });
    if (!window.confirm(warning)) return;
    setBusyCode(game.code);
    setError(null);
    try {
      await api.post(`/api/rooms/${game.code}/leave`, { force: game.status === 'PLAYING' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('table.leaveFailed'));
    } finally {
      setBusyCode(null);
    }
  }

  async function close(game: GameRow): Promise<void> {
    if (!window.confirm(t('table.closeConfirmCode', { code: game.code }))) {
      return;
    }
    setBusyCode(game.code);
    setError(null);
    try {
      await api.post(`/api/rooms/${game.code}/close`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('table.closeFailed'));
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
            {t('nav.myDecks')}
          </Link>
          <AccountBar />
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[56rem] flex-1 px-5 pb-16 pt-2 sm:px-8">
        <h1 className="sign text-[2rem] leading-none text-[color:var(--site-floor-text)]">
          {t('nav.myTables')}
        </h1>
        <p className="mt-3 max-w-[42rem] text-[0.9rem] leading-relaxed text-[color:var(--site-floor-dim)]">
          {t('tables.intro')}
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
          <p className="mt-8 text-[0.9rem] text-[color:var(--site-floor-dim)]">{t('common.loading')}</p>
        ) : current.length === 0 ? (
          <div className="cut-shadow mt-8">
            <div className="paper paper-cut p-6">
              <p className="text-[0.95rem] text-[color:var(--site-ink)]">
                {t('tables.emptyTitle')}
              </p>
              <p className="mt-2 text-[0.85rem] text-[color:var(--site-ink-soft)]">
                {t('tables.emptyDetail')}
              </p>
              <Link className="ink-button mt-4 inline-block px-5 py-2.5 text-[0.78rem]" to="/">
                {t('home.openTable')}
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
              {t('tables.closedHeading')}
            </h2>
            <ul className="mt-4 grid gap-2 text-[0.85rem]" data-test="tables-past">
              {past.map((game) => (
                <li
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-[color:var(--site-floor-rule)] pt-2 text-[color:var(--site-floor-dim)]"
                  key={game.code}
                >
                  <span className="typed text-[color:var(--site-floor-text)]">{game.code}</span>
                  <span>{MODE_LABELS[game.mode] ?? game.mode}</span>
                  <span className="ml-auto">{ago(game.lastActivityAt, t)}</span>
                  {/* C'est ici qu'on revient chercher une partie finie : l'écran
                      de fin de partie, lui, disparaît dès qu'on le quitte. */}
                  {game.hasReplay && (
                    <Link
                      className="floor-link whitespace-nowrap"
                      data-test="past-replay-link"
                      to={`/rooms/${game.code}/replay`}
                    >
                      {t('replay.open')}
                    </Link>
                  )}
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
  const t = useT();
  return (
    <li className="cut-shadow">
      <div className="paper paper-cut p-5" data-test={`table-${game.code}`}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="sign text-[1.35rem] leading-none text-[color:var(--site-ink)]">
            {game.code}
          </span>
          <span className="stamped">{t(STATUS_KEYS[game.status])}</span>
          {game.isHost && <span className="stamped">{t('table.host')}</span>}
          <span className="ml-auto text-[0.8rem] text-[color:var(--site-ink-soft)]">
            {ago(game.lastActivityAt, t)}
          </span>
        </div>

        <p className="mt-2 text-[0.85rem] text-[color:var(--site-ink-soft)]">
          {[
            MODE_LABELS[game.mode] ?? game.mode,
            game.seatIndex !== null
              ? t('table.yourSeat', { index: game.seatIndex + 1 })
              : t('table.notSeated'),
            // La coupure du pluriel n'est pas la même dans les deux langues :
            // c'est `count` qui choisit, jamais un `n > 1`.
            game.players > 0 ? t('table.playersAtTable', { count: game.players }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link className="ink-button px-5 py-2.5 text-[0.78rem]" to={`/rooms/${game.code}`}>
            {game.seatIndex === null ? t('table.join') : t('table.returnTo')}
          </Link>
          {game.seatIndex !== null && (
            <button
              className="floor-button px-4 py-2.5 text-[0.72rem]"
              disabled={busy}
              onClick={onLeave}
              type="button"
            >
              {t('table.leave')}
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
              {t('table.close')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
