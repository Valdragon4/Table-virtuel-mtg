/**
 * La console d'administration.
 *
 * ——— Ce que cet écran n'est pas
 *
 * Ce n'est pas un écran de persuasion. On ne l'ouvre pas pour se réjouir d'une
 * courbe, on l'ouvre quand quelque chose ne va pas. D'où trois partis pris :
 * les chiffres se lisent d'un coup d'œil, un chiffre **anormal** se voit sans
 * qu'on le cherche, et rien n'est mis en avant qui ne soit pas un fait.
 *
 * ——— Cet écran ne protège rien, et c'est important de le savoir
 *
 * Il n'existe pas de « masquer le lien » qui vaille protection : la garde est
 * serveur, sur chaque route (`apps/server/src/admin/guard.ts`). Cette page ne
 * fait que demander ; si le serveur répond 404 — visiteur, compte ordinaire,
 * adresse retirée de la liste, email non vérifié —, elle affiche exactement ce
 * qu'affiche une adresse qui n'existe pas. Elle ne sait même pas laquelle des
 * quatre raisons s'applique : le serveur ne le dit pas, exprès.
 *
 * ——— Piège évité
 *
 * Aucun état ne vient d'un sélecteur qui construirait un tableau : tout est en
 * `useState` local, et les listes sont des références stables entre deux rendus.
 * C'est la panne maison (React #185) qui tue la page avant même qu'elle ouvre
 * quoi que ce soit.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { LegalFooter } from '../components/LegalFooter.js';
import { Wordmark } from '../components/Mark.js';
import { AccountBar } from '../components/AccountBar.js';
import { useT, type BoundT } from '../lib/i18n/index.js';

/* ——— Ce que le serveur publie. Rien de plus n'est attendu ici. ——————— */

interface Ingest {
  bulkType: string;
  bulkUpdatedAt: string;
  startedAt: string;
  finishedAt: string | null;
  cardsUpserted: number;
  outcome: 'ok' | 'failed' | 'running';
  error: string | null;
}

interface Overview {
  generatedAt: string;
  health: { ok: boolean; protocol: number; liveRooms: number; cards: number };
  accounts: {
    total: number;
    verified: number;
    unverified: number;
    activeDay: number;
    activeWeek: number;
    activeMonth: number;
    newWeek: number;
    newMonth: number;
    adminsDeclared: number;
  };
  tables: {
    total: number;
    lobby: number;
    playing: number;
    ended: number;
    activeDay: number;
    newWeek: number;
    seatsOnOpenTables: number;
  };
  decks: { total: number; owners: number };
  catalog: { cards: number; tokens: number; localizations: number; localizedPrintings: number };
  ingest: { last: Ingest | null; bulkAgeHours: number | null; failedWeek: number; runsWeek: number };
  sessions: { active: number; stale: number };
}

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastSeenAt: string;
  decks: number;
  seats: number;
  sessions: number;
  hostedRooms: number;
}

interface SeatRow {
  code: string;
  status: string;
  mode: string;
  seatIndex: number;
  joinedAt: string;
  lastActivityAt: string;
}

interface RoomRow {
  code: string;
  mode: string;
  status: string;
  isPrivate: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastActivityAt: string;
  hostName: string | null;
  seats: number;
}

interface AuditRow {
  id: string;
  at: string;
  actorEmail: string;
  action: string;
  targetKind: string;
  targetRef: string;
  detail: unknown;
}

/**
 * Une ligne du fil. Six champs, quelle que soit sa source : le serveur les
 * ramène toutes à cette forme (`admin/activity.ts`), donc cet écran n'a qu'un
 * seul gabarit à rendre au lieu de six.
 */
interface ActivityRow {
  id: string;
  at: string;
  kind:
    | 'ACCOUNT_CREATED'
    | 'SESSION_OPENED'
    | 'TABLE_OPENED'
    | 'SEAT_JOINED'
    | 'INGEST_RUN'
    | 'ADMIN_ACTION';
  who: string | null;
  ref: string | null;
  note: string | null;
}

/** Le nom de chaque sorte d'événement. Table au niveau du module : `useT` est un hook. */
const ACTIVITY_KEYS = {
  ACCOUNT_CREATED: 'admin.actAccountCreated',
  SESSION_OPENED: 'admin.actSessionOpened',
  TABLE_OPENED: 'admin.actTableOpened',
  SEAT_JOINED: 'admin.actSeatJoined',
  INGEST_RUN: 'admin.actIngest',
  ADMIN_ACTION: 'admin.actAdmin',
} as const satisfies Record<ActivityRow['kind'], string>;

const STATUS_KEYS: Record<string, 'table.statusLobby' | 'table.statusPlaying' | 'table.statusEnded'> =
  {
    LOBBY: 'table.statusLobby',
    PLAYING: 'table.statusPlaying',
    ENDED: 'table.statusEnded',
  };

/** Les entiers longs se lisent mieux espacés : 99 231, pas 99231. */
function num(value: number): string {
  return value.toLocaleString('fr-FR').replace(/ /g, ' ');
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * « il y a 3 h ». La même échelle et les mêmes clés que « Mes tables »
 * (`Tables.tsx`) : deux écrans du même produit ne doivent pas compter le temps
 * de deux façons différentes.
 */
function ago(iso: string, t: BoundT): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { value: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { value: hours });
  const days = Math.round(hours / 24);
  return t('time.daysAgo', { value: days });
}

/**
 * Les **deux** lectures d'un instant : « 18/09/26 13:42 · il y a 3 h ».
 *
 * Ce n'est pas de la redondance décorative. On ouvre cet écran quand quelque
 * chose ne va pas, et l'on y cherche « depuis quand » : un relatif seul répond
 * tout de suite mais ne se recoupe avec rien, une date absolue seule se recoupe
 * avec le journal du serveur mais oblige à calculer de tête. Les deux ensemble
 * coûtent une demi-ligne et évitent l'aller-retour.
 */
function stamp(iso: string, t: BoundT): string {
  return `${shortDate(iso)} ${clock(iso)} · ${ago(iso, t)}`;
}

/* ——— Les tuiles ————————————————————————————————————————————— */

/**
 * Une tuile de chiffre.
 *
 * `alarm` n'est pas une décoration : c'est **la** raison d'être de l'écran. Un
 * chiffre anormal doit se voir sans être cherché, donc il change de couleur et
 * porte une bordure d'alarme — le même rouge que le bouton « clore une table »,
 * pour que le vocabulaire visuel reste celui du projet.
 */
function Stat({
  label,
  value,
  hint,
  alarm,
  test,
}: {
  label: string;
  value: string;
  hint?: string;
  alarm?: boolean;
  test?: string;
}): React.ReactElement {
  return (
    // `cut-shadow` enveloppe la tuile et non la grille : le coin coupé emporte
    // l'ombre portée, et c'est l'enveloppe qui la réapplique en suivant la
    // découpe. Posée sur la grille, elle ombrait le rectangle de la grille.
    // `h-full` sur les deux niveaux : sans lui, une tuile dont le libellé tient
    // sur deux lignes dépasse ses voisines et la rangée part de travers. Un
    // tableau de bord se lit en balayant une ligne de chiffres ; elle doit être
    // droite.
    <div className="cut-shadow h-full" data-test={test}>
      <div
        className="paper paper-cut h-full px-4 py-3"
        style={alarm ? { outline: '2px solid var(--site-alarm)', outlineOffset: '-2px' } : undefined}
      >
        <div
          className="sign text-[1.7rem] leading-none"
          style={{ color: alarm ? 'var(--site-alarm)' : 'var(--site-ink)' }}
        >
          {value}
        </div>
        <div className="mt-1.5 text-[0.72rem] uppercase tracking-[0.08em] text-[color:var(--site-ink-soft)]">
          {label}
        </div>
        {hint && (
          <div className="mt-1 text-[0.72rem] text-[color:var(--site-ink-soft)]">{hint}</div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  note,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mt-10">
      <h2 className="sign text-[1.15rem] text-[color:var(--site-floor-text)]">{title}</h2>
      {note && (
        <p className="mt-1.5 max-w-[60ch] text-[0.78rem] leading-relaxed text-[color:var(--site-floor-dim)]">
          {note}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/* ——— La page ———————————————————————————————————————————————— */

export function Admin(): React.ReactElement {
  const t = useT();
  /**
   * Trois états bien distincts, et les confondre serait mentir : on n'a pas
   * encore demandé (`null`), le serveur a refusé (`denied`), ou on a les
   * chiffres. Un écran vide n'est pas un écran refusé.
   */
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [roomFilter, setRoomFilter] = useState<'' | 'LOBBY' | 'PLAYING' | 'ENDED'>('');
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);

  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    user: UserRow;
    seats: SeatRow[];
    seatedAtOpenTable: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** Un seul endroit sait interpréter le 404 : c'est le refus, et il est muet. */
  const guard = useCallback((err: unknown): void => {
    if (err instanceof ApiError && err.status === 404) setDenied(true);
    else setError(err instanceof ApiError ? err.message : 'Erreur');
  }, []);

  const loadOverview = useCallback(async (): Promise<void> => {
    try {
      setData(await api.get<Overview>('/api/admin/overview'));
    } catch (err) {
      guard(err);
    }
  }, [guard]);

  const loadUsers = useCallback(
    async (q: string): Promise<void> => {
      try {
        const res = await api.get<{ total: number; users: UserRow[] }>(
          `/api/admin/users?take=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        );
        setUsers(res.users);
        setUserTotal(res.total);
      } catch (err) {
        guard(err);
      }
    },
    [guard],
  );

  const loadRooms = useCallback(
    async (status: string): Promise<void> => {
      try {
        const res = await api.get<{ rooms: RoomRow[] }>(
          `/api/admin/rooms?take=50${status ? `&status=${status}` : ''}`,
        );
        setRooms(res.rooms);
      } catch (err) {
        guard(err);
      }
    },
    [guard],
  );

  const loadAudit = useCallback(async (): Promise<void> => {
    try {
      setAudit((await api.get<{ entries: AuditRow[] }>('/api/admin/audit?take=30')).entries);
    } catch (err) {
      guard(err);
    }
  }, [guard]);

  /**
   * `take=30` et pas davantage : le serveur plafonne à 50, et au-delà d'une
   * trentaine de lignes on ne lit plus un fil, on fait défiler. Ce chiffre est
   * aussi ce qui borne le coût côté base — six requêtes limitées à 30 lignes.
   */
  const loadActivity = useCallback(async (): Promise<void> => {
    try {
      setActivity(
        (await api.get<{ entries: ActivityRow[] }>('/api/admin/activity?take=30')).entries,
      );
    } catch (err) {
      guard(err);
    }
  }, [guard]);

  useEffect(() => {
    void loadOverview();
    void loadAudit();
    void loadActivity();
  }, [loadOverview, loadAudit, loadActivity]);

  // La recherche est débattue de 250 ms : on ne tape pas une requête par touche.
  useEffect(() => {
    const id = window.setTimeout(() => void loadUsers(query), 250);
    return () => window.clearTimeout(id);
  }, [query, loadUsers]);

  useEffect(() => {
    void loadRooms(roomFilter);
  }, [roomFilter, loadRooms]);

  useEffect(() => {
    if (!open) {
      setDetail(null);
      return;
    }
    let vivant = true;
    void api
      .get<{ user: UserRow; seats: SeatRow[]; seatedAtOpenTable: boolean }>(
        `/api/admin/users/${open}`,
      )
      .then((d) => {
        if (vivant) setDetail(d);
      })
      .catch(guard);
    return () => {
      vivant = false;
    };
  }, [open, guard]);

  async function revoke(user: UserRow): Promise<void> {
    if (!window.confirm(t('admin.revokeConfirm', { name: user.displayName }))) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.post<{ revoked: number; logged: boolean }>(
        `/api/admin/users/${user.id}/revoke-sessions`,
      );
      setNotice(
        res.logged
          ? t('admin.revokeDone', { count: res.revoked })
          : t('admin.revokeUnlogged'),
      );
      await Promise.all([loadUsers(query), loadAudit(), loadActivity(), loadOverview()]);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : t('admin.revokeFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (denied) return <Denied t={t} />;

  return (
    <div className="site site-floor flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-[84rem] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link className="inline-block" to="/">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-5 text-[0.85rem]">
          <Link
            className="text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
            to="/tables"
          >
            {t('nav.myTables')}
          </Link>
          <AccountBar />
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[84rem] flex-1 px-5 pb-16 pt-2 sm:px-8">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <h1 className="sign text-[2rem] leading-none text-[color:var(--site-floor-text)]">
            {t('admin.title')}
          </h1>
          {data && (
            <span className="text-[0.78rem] text-[color:var(--site-floor-dim)]">
              {t('admin.updatedAt', { time: clock(data.generatedAt) })}
            </span>
          )}
          <button
            className="floor-button ml-auto px-4 py-2 text-[0.72rem]"
            // « Rafraîchir » qui laisserait le fil d'hier à l'écran serait un
            // mensonge : ce bouton remet à jour tout ce qui est daté.
            onClick={() => {
              void loadOverview();
              void loadAudit();
              void loadActivity();
            }}
            type="button"
          >
            {t('admin.refresh')}
          </button>
        </div>
        <p className="mt-3 max-w-[62rem] text-[0.88rem] leading-relaxed text-[color:var(--site-floor-dim)]">
          {t('admin.intro')}
        </p>

        {error && (
          <p
            className="mt-5 border-2 border-[#8c2438] px-3 py-2 text-[0.85rem] text-[#f0a1ae]"
            role="alert"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            className="mt-5 border-2 border-[color:var(--site-floor-rule)] px-3 py-2 text-[0.85rem] text-[color:var(--site-floor-text)]"
            data-test="admin-notice"
            role="status"
          >
            {notice}
          </p>
        )}

        {data === null ? (
          <p className="mt-8 text-[0.9rem] text-[color:var(--site-floor-dim)]">
            {t('common.loading')}
          </p>
        ) : (
          <>
            <HealthBlock data={data} t={t} />
            <AccountsBlock data={data} t={t} />
            <TablesBlock data={data} t={t} />
            <CatalogBlock data={data} t={t} />
          </>
        )}

        {/* — Comptes, un par un —————————————————————————————— */}
        <Section note={t('admin.noDeleteNote')} title={t('admin.sectionUsers')}>
          {/* `dark-field` et non `paper-field` : ce champ est posé sur le sol,
              pas sur une fiche. `paper-field` est transparent et encre sombre —
              sur ce fond, il était rigoureusement invisible. */}
          <label className="block max-w-[26rem]">
            <span className="block text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[color:var(--site-floor-dim)]">
              {t('admin.searchLabel')}
            </span>
            <input
              className="dark-field mt-1 w-full rounded px-3 py-2 text-[0.85rem]"
              data-test="admin-user-search"
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('admin.searchPlaceholder')}
              type="search"
              value={query}
            />
          </label>

          <p className="mt-2 text-[0.75rem] text-[color:var(--site-floor-dim)]">
            {t('admin.showingOf', { shown: users.length, total: userTotal })}
          </p>

          {users.length === 0 ? (
            <p className="mt-4 text-[0.85rem] text-[color:var(--site-floor-dim)]">
              {t('admin.noResults')}
            </p>
          ) : (
            <ul className="mt-3 grid gap-2" data-test="admin-users">
              {users.map((user) => (
                <li className="cut-shadow" key={user.id}>
                  <div className="paper paper-cut px-4 py-3" data-test={`admin-user-${user.id}`}>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="sign text-[1.05rem] leading-none text-[color:var(--site-ink)]">
                        {user.displayName}
                      </span>
                      <span className="typed text-[0.8rem] text-[color:var(--site-ink-soft)]">
                        {user.email}
                      </span>
                      {user.isAdmin && <span className="stamped">{t('admin.badgeAdmin')}</span>}
                      {/* Un tampon ordinaire, pas une alarme : un email non
                          vérifié est un fait sur un compte, pas une panne de la
                          plateforme. Le rouge est réservé à ce qui efface et à
                          ce qui ne va pas. */}
                      {!user.emailVerified && (
                        <span className="stamped">{t('admin.badgeUnverified')}</span>
                      )}
                      <button
                        className="ml-auto text-[0.75rem] underline text-[color:var(--site-ink-soft)]"
                        onClick={() => setOpen(open === user.id ? null : user.id)}
                        type="button"
                      >
                        {open === user.id ? t('common.close') : t('admin.openRecord')}
                      </button>
                    </div>

                    <p className="mt-1.5 text-[0.78rem] text-[color:var(--site-ink-soft)]">
                      {[
                        `${t('admin.colCreated')} ${shortDate(user.createdAt)}`,
                        `${t('admin.colLastSeen')} ${shortDate(user.lastSeenAt)}`,
                        `${t('admin.colDecks')} ${user.decks}`,
                        `${t('admin.colSeats')} ${user.seats}`,
                        `${t('admin.colSessions')} ${user.sessions}`,
                      ].join(' · ')}
                    </p>

                    {open === user.id && (
                      <div className="mt-3 border-t border-[color:var(--site-ink-soft)] pt-3">
                        {detail === null ? (
                          <p className="text-[0.8rem] text-[color:var(--site-ink-soft)]">
                            {t('common.loading')}
                          </p>
                        ) : (
                          <>
                            {detail.seatedAtOpenTable && (
                              <p
                                className="mb-2 text-[0.8rem]"
                                style={{ color: 'var(--site-alarm)' }}
                              >
                                {t('admin.seatedWarning')}
                              </p>
                            )}
                            <p className="mb-1.5 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[color:var(--site-ink-soft)]">
                              {t('admin.detailSeats')}
                            </p>
                            {detail.seats.length === 0 ? (
                              <p className="text-[0.8rem] text-[color:var(--site-ink-soft)]">
                                {t('admin.detailNoSeats')}
                              </p>
                            ) : (
                              <ul className="grid gap-1 text-[0.8rem] text-[color:var(--site-ink-soft)]">
                                {detail.seats.map((seat) => (
                                  <li key={`${seat.code}-${seat.seatIndex}`}>
                                    <span className="typed text-[color:var(--site-ink)]">
                                      {seat.code}
                                    </span>{' '}
                                    · {t(STATUS_KEYS[seat.status] ?? 'table.statusEnded')} ·{' '}
                                    {t('admin.seatLine', { index: seat.seatIndex + 1 })} ·{' '}
                                    {/* `joinedAt` était publié depuis le début et
                                        ne s'affichait nulle part : « depuis quand
                                        ce compte est-il assis là » est pourtant la
                                        question qu'on se pose avant d'agir. */}
                                    {t('admin.colJoined')} {stamp(seat.joinedAt, t)}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <button
                              className="floor-button mt-3 px-4 py-2 text-[0.72rem]"
                              disabled={busy || user.isAdmin}
                              onClick={() => void revoke(user)}
                              style={{
                                borderColor: 'var(--site-alarm)',
                                color: 'var(--site-alarm)',
                              }}
                              type="button"
                            >
                              {t('admin.revoke')}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* — Tables ————————————————————————————————————————— */}
        <Section note={t('admin.endedNote')} title={t('admin.sectionRooms')}>
          <div className="flex flex-wrap gap-2">
            {([
              ['', t('admin.roomsAll')],
              ['LOBBY', t('table.statusLobby')],
              ['PLAYING', t('table.statusPlaying')],
              ['ENDED', t('table.statusEnded')],
            ] as const).map(([value, label]) => (
              <button
                className="floor-button px-3 py-1.5 text-[0.72rem]"
                key={value || 'all'}
                onClick={() => setRoomFilter(value)}
                style={
                  roomFilter === value
                    ? { borderColor: 'var(--site-floor-text)', color: 'var(--site-floor-text)' }
                    : undefined
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {rooms.length === 0 ? (
            <p className="mt-4 text-[0.85rem] text-[color:var(--site-floor-dim)]">
              {t('admin.noRooms')}
            </p>
          ) : (
            <ul className="mt-3 grid gap-1.5 text-[0.82rem]" data-test="admin-rooms">
              {rooms.map((room) => (
                <li
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[color:var(--site-floor-rule)] pt-1.5 text-[color:var(--site-floor-dim)]"
                  key={room.code}
                >
                  <span className="typed text-[color:var(--site-floor-text)]">{room.code}</span>
                  <span>{t(STATUS_KEYS[room.status] ?? 'table.statusEnded')}</span>
                  <span>{room.mode}</span>
                  <span>
                    {t('admin.colSeats')} {room.seats}
                  </span>
                  {room.isPrivate && <span>{t('admin.roomPrivate')}</span>}
                  {room.hasPassword && <span>{t('admin.roomPassword')}</span>}
                  <span>
                    {t('admin.colHost')} {room.hostName ?? '—'}
                  </span>
                  {/* Les deux dates, et non la seule activité : « depuis quand
                      cette table traîne-t-elle ? » se répond en comparant son
                      ouverture à sa dernière activité, pas en lisant l'une des
                      deux. Chacune porte sa date absolue et son relatif. */}
                  <span className="ml-auto whitespace-nowrap">
                    {t('admin.colOpened')} {stamp(room.createdAt, t)}
                  </span>
                  <span className="whitespace-nowrap">
                    {t('admin.colActivity')} {stamp(room.lastActivityAt, t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* — Le fil ————————————————————————————————————————— */}
        {/* Placé **avant** le journal d'administration, qui n'en est qu'une des
            six sources : on veut d'abord « que vient-il de se passer », et
            seulement ensuite « qu'ai-je fait, moi ». */}
        <Section note={t('admin.activityNote')} title={t('admin.sectionActivity')}>
          {activity.length === 0 ? (
            <p className="text-[0.85rem] text-[color:var(--site-floor-dim)]">
              {t('admin.activityEmpty')}
            </p>
          ) : (
            <ul className="grid gap-1.5 text-[0.8rem]" data-test="admin-activity">
              {activity.map((row) => (
                <li
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[color:var(--site-floor-rule)] pt-1.5 text-[color:var(--site-floor-dim)]"
                  key={row.id}
                >
                  {/* La date en tête et en chasse fixe : une colonne de dates qui
                      s'aligne se balaie du regard, une date noyée dans la phrase
                      oblige à la chercher ligne par ligne. */}
                  <span className="typed whitespace-nowrap text-[color:var(--site-floor-text)]">
                    {shortDate(row.at)} {clock(row.at)}
                  </span>
                  <span className="whitespace-nowrap">{ago(row.at, t)}</span>
                  <span className="text-[color:var(--site-floor-text)]">
                    {t(ACTIVITY_KEYS[row.kind])}
                  </span>
                  {row.who && <span>{row.who}</span>}
                  {row.ref && <span className="typed">{row.ref}</span>}
                  {row.note && (
                    // Une ingestion échouée est la seule chose de ce fil qui soit
                    // une panne ; elle porte donc le rouge d'alarme du reste de
                    // l'écran. Tout le reste est un fait, pas un signal.
                    <span
                      style={
                        row.kind === 'INGEST_RUN' && row.note === 'failed'
                          ? { color: 'var(--site-alarm)' }
                          : undefined
                      }
                    >
                      {row.note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* — Journal ———————————————————————————————————————— */}
        <Section title={t('admin.sectionAudit')}>
          {audit.length === 0 ? (
            <p className="text-[0.85rem] text-[color:var(--site-floor-dim)]">
              {t('admin.auditEmpty')}
            </p>
          ) : (
            <ul className="grid gap-1.5 text-[0.8rem]" data-test="admin-audit">
              {audit.map((entry) => (
                <li
                  className="flex flex-wrap items-baseline gap-x-3 border-t border-[color:var(--site-floor-rule)] pt-1.5 text-[color:var(--site-floor-dim)]"
                  key={entry.id}
                >
                  <span className="typed text-[color:var(--site-floor-text)]">
                    {shortDate(entry.at)} {clock(entry.at)}
                  </span>
                  <span>
                    {t('admin.auditLine', {
                      actor: entry.actorEmail,
                      action: entry.action,
                      target: `${entry.targetKind} ${entry.targetRef}`,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </main>

      <LegalFooter />
    </div>
  );
}

/**
 * L'écran de refus : exactement ce que voit quelqu'un qui tape une adresse au
 * hasard. Il ne dit **pas** « vous n'êtes pas administrateur » — le serveur ne
 * l'a pas dit, et l'écran n'a pas le droit d'en savoir plus que lui.
 */
function Denied({ t }: { t: BoundT }): React.ReactElement {
  return (
    <div className="site site-floor flex min-h-screen flex-col" data-test="admin-denied">
      <main className="mx-auto flex w-full max-w-[72rem] flex-1 flex-col justify-center px-5 py-20 sm:px-8">
        <h1 className="sign text-[clamp(2rem,6vw,3.4rem)] text-[color:var(--site-floor-text)]">
          {t('admin.deniedTitle')}
        </h1>
        <p className="mt-4 max-w-[52ch] text-[0.95rem] leading-relaxed text-[color:var(--site-floor-dim)]">
          {t('admin.deniedDetail')}
        </p>
        <div className="mt-7">
          <a className="ink-button px-5 py-3 text-[0.82rem]" href="/">
            {t('home.openTable')}
          </a>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}

/* ——— Les blocs de chiffres ————————————————————————————————— */

function Grid({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(10.5rem,1fr))]">
      {children}
    </div>
  );
}

function HealthBlock({ data, t }: { data: Overview; t: BoundT }): React.ReactElement {
  const { ingest } = data;
  /*
   * Les seuils d'anomalie, écrits ici et commentés, parce qu'un seuil muet est
   * un seuil qu'on n'ose plus changer.
   *
   *  - une ingestion échouée est une anomalie franche : le catalogue ne suit
   *    plus Scryfall et personne ne le saurait autrement ;
   *  - au-delà de 48 h, la matière ingérée a manqué deux passages quotidiens
   *    (INGEST_CRON_HOUR est journalier) : ce n'est plus un retard, c'est une
   *    panne ;
   *  - plus de sessions expirées que de valides veut dire que la purge
   *    périodique ne passe plus.
   */
  /*
   * Deux alarmes distinctes, et les confondre rendait l'écran illisible : on
   * affichait « Réussie » en rouge parce qu'un passage **antérieur** avait
   * échoué dans la semaine. Le mot d'issue ne parle que du dernier passage ;
   * les échecs de la semaine ont leur propre ligne et leur propre couleur.
   */
  const ingestAlarm = ingest.last?.outcome === 'failed';
  const weekAlarm = ingest.failedWeek > 0;
  const staleAlarm = (ingest.bulkAgeHours ?? 0) > 48;
  const sessionAlarm = data.sessions.stale > data.sessions.active;

  return (
    <Section title={t('admin.sectionPlatform')}>
      <Grid>
        <Stat
          label={t('admin.statLiveRooms')}
          test="admin-live-rooms"
          value={num(data.health.liveRooms)}
        />
        <Stat label={t('admin.statProtocol')} value={String(data.health.protocol)} />
        <Stat label={t('admin.statSessionsActive')} value={num(data.sessions.active)} />
        <Stat
          alarm={sessionAlarm}
          label={t('admin.statSessionsStale')}
          value={num(data.sessions.stale)}
        />
      </Grid>

      <div className="cut-shadow mt-3">
        <div className="paper paper-cut px-4 py-3" data-test="admin-ingest">
          <div className="text-[0.72rem] uppercase tracking-[0.08em] text-[color:var(--site-ink-soft)]">
            {t('admin.ingestTitle')}
          </div>
          {ingest.last === null ? (
            <p className="mt-1.5 text-[0.85rem]" style={{ color: 'var(--site-alarm)' }}>
              {t('admin.ingestNever')}
            </p>
          ) : (
            <>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className="sign text-[1.15rem] leading-none"
                  style={{ color: ingestAlarm ? 'var(--site-alarm)' : 'var(--site-ink)' }}
                >
                  {ingest.last.outcome === 'ok'
                    ? t('admin.ingestOk')
                    : ingest.last.outcome === 'failed'
                      ? t('admin.ingestFailed')
                      : t('admin.ingestRunning')}
                </span>
                <span className="typed text-[0.8rem] text-[color:var(--site-ink-soft)]">
                  {ingest.last.bulkType}
                </span>
                <span
                  className="text-[0.8rem]"
                  style={{
                    color: staleAlarm ? 'var(--site-alarm)' : 'var(--site-ink-soft)',
                  }}
                >
                  {t('admin.ingestAge', { hours: ingest.bulkAgeHours ?? 0 })}
                </span>
                <span className="text-[0.8rem] text-[color:var(--site-ink-soft)]">
                  {t('admin.ingestUpserted', { count: ingest.last.cardsUpserted })}
                </span>
              </div>
              <p
                className="mt-1 text-[0.78rem]"
                style={{ color: weekAlarm ? 'var(--site-alarm)' : 'var(--site-ink-soft)' }}
              >
                {t('admin.ingestFailedWeek', {
                  failed: ingest.failedWeek,
                  runs: ingest.runsWeek,
                })}
              </p>
              {ingest.last.error && (
                <p className="mt-1 text-[0.78rem]" style={{ color: 'var(--site-alarm)' }}>
                  {ingest.last.error}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

function AccountsBlock({ data, t }: { data: Overview; t: BoundT }): React.ReactElement {
  const a = data.accounts;
  return (
    <Section title={t('admin.sectionAccounts')}>
      <Grid>
        <Stat label={t('admin.statAccounts')} test="admin-accounts-total" value={num(a.total)} />
        <Stat label={t('admin.statVerified')} value={num(a.verified)} />
        {/* Aucun seuil ici : sur une plateforme jeune, des emails non vérifiés
            sont normaux. Le chiffre suffit à alerter celui qui le lit. */}
        <Stat label={t('admin.statUnverified')} value={num(a.unverified)} />
        <Stat label={t('admin.statActiveDay')} value={num(a.activeDay)} />
        <Stat label={t('admin.statActiveWeek')} value={num(a.activeWeek)} />
        <Stat label={t('admin.statActiveMonth')} value={num(a.activeMonth)} />
        <Stat label={t('admin.statNewWeek')} value={num(a.newWeek)} />
        <Stat label={t('admin.statNewMonth')} value={num(a.newMonth)} />
        {/* Zéro administrateur déclaré est impossible à voir — il faudrait en
            être un pour lire cet écran. Le chiffre est là pour repérer une liste
            qui aurait gonflé sans qu'on s'en aperçoive. */}
        <Stat label={t('admin.statAdmins')} value={num(a.adminsDeclared)} />
      </Grid>
    </Section>
  );
}

function TablesBlock({ data, t }: { data: Overview; t: BoundT }): React.ReactElement {
  const r = data.tables;
  return (
    <Section title={t('admin.sectionTables')}>
      <Grid>
        <Stat label={t('admin.statTables')} value={num(r.total)} />
        <Stat label={t('admin.statLobby')} value={num(r.lobby)} />
        <Stat label={t('admin.statPlaying')} test="admin-tables-playing" value={num(r.playing)} />
        <Stat label={t('admin.statEnded')} test="admin-tables-ended" value={num(r.ended)} />
        <Stat label={t('admin.statTablesActiveDay')} value={num(r.activeDay)} />
        <Stat label={t('admin.statTablesNewWeek')} value={num(r.newWeek)} />
        <Stat label={t('admin.statSeats')} value={num(r.seatsOnOpenTables)} />
      </Grid>
    </Section>
  );
}

function CatalogBlock({ data, t }: { data: Overview; t: BoundT }): React.ReactElement {
  const c = data.catalog;
  return (
    <Section title={t('admin.sectionCatalog')}>
      <Grid>
        {/* Un catalogue vide n'est pas un petit catalogue : plus rien ne
            fonctionne, ni la recherche, ni le chargement d'un deck. */}
        <Stat alarm={c.cards === 0} label={t('admin.statCards')} value={num(c.cards)} />
        <Stat label={t('admin.statTokens')} value={num(c.tokens)} />
        <Stat label={t('admin.statLocalizations')} value={num(c.localizations)} />
        <Stat label={t('admin.statPrintings')} value={num(c.localizedPrintings)} />
        <Stat label={t('admin.statDecks')} value={num(data.decks.total)} />
        <Stat label={t('admin.statDeckOwners')} value={num(data.decks.owners)} />
      </Grid>
    </Section>
  );
}
