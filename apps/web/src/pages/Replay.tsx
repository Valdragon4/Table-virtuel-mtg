/**
 * Le lecteur de replay.
 *
 * Il ne rend **pas** une table de son cru : il rend la vraie, celle de
 * `components/Table`, parce que l'état qu'elle lit est le même `useGame` que
 * pendant une partie. Le pilote (`store/replay.ts`) se contente de lui servir
 * le snapshot d'origine puis les events enregistrés, par le même
 * `handleMessage` qu'un socket. Deux réducteurs auraient fini par diverger, et
 * le replay aurait alors montré autre chose que ce qui s'est passé.
 *
 * La page est publique comme toutes les routes du client : elle n'ouvre rien.
 * C'est le serveur qui refuse en 404 sur chaque appel tant que la partie n'est
 * pas terminée, et l'écran affiche alors la même chose qu'une adresse
 * inexistante — voir docs/replay.md.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Table, highlightCards } from '../components/Table.js';
import { ActionLog } from '../components/ActionLog.js';
import { Hand } from '../components/Hand.js';
import { CardPreview } from '../components/CardPreview.js';
import { LegalFooter } from '../components/LegalFooter.js';
import { api } from '../lib/api.js';
import { useGame } from '../store/game.js';
import { currentSeq, useReplay } from '../store/replay.js';
import { useT } from '../lib/i18n/index.js';

/** Cadence de la lecture automatique : lisible sans être interminable. */
const PLAY_INTERVAL_MS = 700;

/** Ce que la table sait de son propre replay, pour ses joueurs. */
interface RoomReplay {
  available: boolean;
  replayId?: string;
  eventCount?: number;
  truncated?: boolean;
  shareToken?: string | null;
}

export function ReplayPage(): React.ReactElement {
  /*
   * Deux entrées, une seule page.
   *
   * `/replays/:handle` ouvre un replay désigné : un jeton de partage, ou
   * l'identifiant de l'enregistrement pour un joueur de la partie.
   * `/rooms/:code/replay` est le chemin des joueurs, qui ne connaissent que
   * leur code de table ; il demande d'abord au serveur **s'il y a** un replay,
   * et cette question-là est déjà gardée par le verrou.
   */
  const { handle = '', code = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'ALL';
  const t = useT();

  /*
   * **L'instant courant vit dans l'adresse, et il y vit en `seq`.**
   *
   * Deux raisons, et la seconde est un cadeau. D'abord c'est ce qui survit au
   * rechargement qu'impose un changement de point de vue : la vue se recalcule
   * côté serveur, donc on repasse par `load`, et sans ancre on repartait du pas
   * zéro — c'est-à-dire qu'on perdait exactement le moment qu'on voulait
   * regarder autrement. Ensuite, un lien de replay devient de ce fait un lien
   * **vers un instant précis** de la partie, ce qui est très exactement ce
   * qu'on veut envoyer à quelqu'un.
   *
   * Il est lu dans une ref, et l'effet de chargement ne s'abonne pas à lui :
   * sans cela, chaque pas franchi rechargerait tout le flux.
   */
  const at = params.get('at');
  const atSeq = at === null ? null : Number.parseInt(at, 10);
  const anchor = useRef<number | null>(null);
  anchor.current = atSeq !== null && Number.isFinite(atSeq) ? atSeq : null;

  const [byRoom, setByRoom] = useState<RoomReplay | null>(null);
  const [roomFailed, setRoomFailed] = useState(false);

  const load = useReplay((s) => s.load);
  const reset = useReplay((s) => s.reset);
  const head = useReplay((s) => s.head);
  const loading = useReplay((s) => s.loading);
  const error = useReplay((s) => s.error);
  const cursor = useReplay((s) => s.cursor);
  const total = useReplay((s) => s.steps.length);
  const seek = useReplay((s) => s.seek);
  const playing = useReplay((s) => s.playing);
  const setPlaying = useReplay((s) => s.setPlaying);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    api
      .get<RoomReplay>(`/api/rooms/${encodeURIComponent(code)}/replay`)
      .then((info) => {
        if (alive) setByRoom(info);
      })
      .catch(() => {
        if (alive) setRoomFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [code]);

  // Le `handle` effectif : celui de l'adresse, ou celui que la table vient de
  // nous donner. Tant qu'on ne l'a pas, on ne charge rien.
  const resolved = handle || byRoom?.replayId || '';

  /*
   * Changer de point de vue **recharge le flux**, et c'est un choix.
   *
   * On pourrait imaginer garder le flux omniscient en mémoire et re-dériver la
   * vue localement, sans aller-retour. Ce serait plus rapide, et ce serait une
   * faute : les règles de visibilité vivent dans `projection.ts`, côté serveur,
   * appuyées sur `GameObjectState` et `canSeeIdentity`. Les rejouer dans le
   * navigateur voudrait dire soit en écrire une seconde implémentation — celle
   * qui divergera, et le jour où elle diverge le replay montre à un siège une
   * carte qu'il n'a jamais vue —, soit déménager l'état de partie du serveur
   * dans `@mtg/shared`, ce qui est une autre décision que celle-ci.
   *
   * La bonne réponse n'était donc pas de supprimer le rechargement mais de le
   * rendre invisible : la table reste à l'écran (voir `load`), et l'on revient
   * au même `seq` grâce à `anchor`. `at` n'est délibérément pas dans les
   * dépendances — il change à chaque pas, et l'y mettre rechargerait tout le
   * flux à chaque flèche.
   */
  useEffect(() => {
    if (!resolved) return;
    void load(resolved, view, anchor.current);
  }, [resolved, view, load]);

  /*
   * Le nettoyage n'appartient **qu'au démontage**.
   *
   * Il était accroché à l'effet de chargement, donc il tournait aussi à chaque
   * changement de point de vue : il vidait `head` et `steps` avant même que le
   * nouveau flux ne soit demandé, la page retombait sur son écran de
   * chargement, et la table s'éteignait puis se rallumait. Ici, elle reste
   * allumée pendant toute la bascule.
   */
  useEffect(() => reset, [reset]);

  /*
   * L'adresse suit le pas courant, en remplaçant l'entrée d'historique plutôt
   * qu'en en empilant une par pas — sans quoi le bouton « précédent » du
   * navigateur remonterait le replay action par action.
   */
  const seqNow = useReplay(currentSeq);
  useEffect(() => {
    if (seqNow === null) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('at', String(seqNow));
        return next;
      },
      { replace: true },
    );
  }, [seqNow, setParams]);

  // La lecture automatique : un pas toutes les `PLAY_INTERVAL_MS`, et elle
  // s'arrête d'elle-même à la fin plutôt que de tourner dans le vide.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      const state = useReplay.getState();
      if (state.cursor >= state.steps.length) {
        state.setPlaying(false);
        return;
      }
      state.seek(state.cursor + 1);
    }, PLAY_INTERVAL_MS);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [playing]);

  // Les flèches du clavier font ce qu'on attend d'elles dans un lecteur.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight') useReplay.getState().stepForward();
      else if (event.key === 'ArrowLeft') useReplay.getState().stepBack();
      else if (event.key === ' ') {
        event.preventDefault();
        useReplay.getState().setPlaying(!useReplay.getState().playing);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pas de replay pour cette table : le serveur ne dit pas pourquoi — partie en
  // cours, aucun enregistrement, ou vous n'y avez pas joué — et cette page ne
  // le devine pas non plus.
  if (code && (roomFailed || byRoom?.available === false)) {
    return <Message title={t('replay.notFound')} body={t('replay.notFoundBody')} />;
  }
  /*
   * L'écran de chargement n'est **que** pour le premier chargement.
   *
   * Un changement de point de vue recharge lui aussi, mais la table d'avant est
   * encore à l'écran et parfaitement lisible : la remplacer par « Chargement… »
   * pour le temps d'un aller-retour ferait clignoter l'instant qu'on regarde.
   */
  if (!head && (loading || (!resolved && code))) return <Message title={t('replay.loading')} />;

  if (error === 'NOT_FOUND') {
    return <Message title={t('replay.notFound')} body={t('replay.notFoundBody')} />;
  }
  if (error === 'NETWORK') return <Message title={t('replay.networkError')} />;
  if (!head) return <Message title={t('replay.loading')} />;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden">
      <Table />
      <CardPreview />

      {/* La main du point de vue choisi. C'est elle qui donne tout son sens à
          la bascule : en vue omnisciente on lit celle du premier siège, en vue
          de siège on lit exactement ce que ce joueur avait en main à ce pas. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[7.5rem] z-30">
        <Hand onCardDoubleClick={() => undefined} />
      </div>

      {/* Le journal, à gauche, comme à la table. C'est lui qui donne le sens
          de chaque pas : le transport dit « où », le journal dit « quoi ». */}
      <div className="pointer-events-auto absolute left-3 top-3 z-20 max-h-[45vh] w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg">
        <ActionLog onHighlight={highlightCards} />
      </div>

      <ReplayBar
        view={view}
        onView={(next) => {
          setPlaying(false);
          /*
           * On change `view` et **on ne touche à rien d'autre** : `at` porte
           * l'instant regardé, et l'écraser ici renverrait au début de la
           * partie, ce que la bascule doit précisément éviter. L'ancienne
           * écriture, `setParams({ view })`, remplaçait la totalité des
           * paramètres.
           */
          setParams((previous) => {
            const params = new URLSearchParams(previous);
            if (next === 'ALL') params.delete('view');
            else params.set('view', next);
            return params;
          });
        }}
      />

      {code && byRoom?.available ? <SharePanel code={code} initial={byRoom.shareToken ?? null} /> : null}

      {head.truncated ? (
        <p className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded bg-amber-900/80 px-3 py-1.5 text-[0.78rem] text-amber-50">
          {t('replay.truncated')}
        </p>
      ) : null}

      <div className="sr-only" aria-live="polite">
        {t('replay.position', { current: cursor, total })}
      </div>
      <input
        aria-label={t('replay.position', { current: cursor, total })}
        className="absolute bottom-[4.5rem] left-1/2 z-40 w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2"
        type="range"
        min={0}
        max={total}
        value={cursor}
        onChange={(e) => {
          setPlaying(false);
          seek(Number(e.target.value));
        }}
      />
    </div>
  );
}

/** Le transport et le sélecteur de point de vue. */
function ReplayBar({
  view,
  onView,
}: {
  view: string;
  onView: (next: string) => void;
}): React.ReactElement {
  const t = useT();
  const head = useReplay((s) => s.head);
  const cursor = useReplay((s) => s.cursor);
  const total = useReplay((s) => s.steps.length);
  const seek = useReplay((s) => s.seek);
  const playing = useReplay((s) => s.playing);
  const setPlaying = useReplay((s) => s.setPlaying);
  const roomCode = useGame((s) => s.room?.code ?? head?.roomCode ?? '');

  return (
    /* `pl-[19rem]` en grand écran, et ce n'est pas de l'esthétique : les
       commandes de caméra de la table (« Voir toute la table », « Recentrer »)
       sont ancrées en bas à gauche et passaient par-dessus les deux premiers
       boutons du transport. On leur laisse la place plutôt que de les déplacer,
       la table n'étant pas du ressort de cet écran. */
    <div className="absolute bottom-0 left-0 z-40 flex w-full flex-wrap items-center gap-3 bg-black/65 px-4 py-2.5 pl-4 text-[0.82rem] text-neutral-200 backdrop-blur sm:pl-[19rem]">
      <button type="button" className="ink-button px-2.5 py-1" onClick={() => seek(0)}>
        {t('replay.first')}
      </button>
      <button type="button" className="ink-button px-2.5 py-1" onClick={() => { setPlaying(false); seek(cursor - 1); }}>
        ◀ {t('replay.previous')}
      </button>
      <button type="button" className="ink-button px-2.5 py-1" onClick={() => setPlaying(!playing)}>
        {playing ? t('replay.pause') : t('replay.play')}
      </button>
      <button type="button" className="ink-button px-2.5 py-1" onClick={() => { setPlaying(false); seek(cursor + 1); }}>
        {t('replay.next')} ▶
      </button>
      <button type="button" className="ink-button px-2.5 py-1" onClick={() => { setPlaying(false); seek(total); }}>
        {t('replay.last')}
      </button>

      <span className="tabular-nums">{t('replay.position', { current: cursor, total })}</span>

      <label className="ml-auto flex items-center gap-2">
        <span>{t('replay.viewLabel')}</span>
        <select
          className="rounded bg-neutral-800 px-2 py-1"
          value={view}
          onChange={(e) => onView(e.target.value)}
          title={view === 'ALL' ? t('replay.viewAllHint') : t('replay.viewSeatHint')}
        >
          <option value="ALL">{t('replay.viewAll')}</option>
          {(head?.views ?? []).map((seat) => (
            <option key={seat.id} value={seat.id}>
              {seat.displayName}
            </option>
          ))}
        </select>
      </label>

      {roomCode ? (
        <Link className="underline" to={`/rooms/${roomCode}`}>
          {t('replay.backToTable')}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Rendre partageable, et refermer.
 *
 * Deux choses sont dites ici sans détour, parce qu'elles ne vont pas de soi :
 * un replay n'est **pas** partagé tant que personne ne l'a demandé, et le lien
 * expose la partie de **tous** les joueurs, pas seulement celle de qui partage.
 * Le bouton de fermeture est à côté du lien, pas dans un réglage : on referme
 * un partage fait par erreur dans la seconde, pas dans un menu.
 */
function SharePanel({ code, initial }: { code: string; initial: string | null }): React.ReactElement {
  const t = useT();
  const [token, setToken] = useState<string | null>(initial);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const share = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.post<{ shareToken: string }>(`/api/rooms/${encodeURIComponent(code)}/replay/share`);
      setToken(res.shareToken);
    } catch {
      // Le refus le plus probable est le verrou lui-même : la partie a repris.
      setToken(null);
    } finally {
      setBusy(false);
    }
  }, [code]);

  const revoke = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await api.del(`/api/rooms/${encodeURIComponent(code)}/replay/share`);
      setToken(null);
      setCopied(false);
    } finally {
      setBusy(false);
    }
  }, [code]);

  const url = token ? `${window.location.origin}/replays/${token}` : '';

  return (
    <div className="absolute right-3 top-3 z-20 w-[24rem] max-w-[calc(100vw-1.5rem)] rounded-lg bg-black/70 p-3 text-[0.8rem] text-neutral-200 backdrop-blur">
      <h2 className="mb-1 font-semibold">{t('replay.shareTitle')}</h2>
      <p className="mb-2 text-[0.75rem] leading-snug text-neutral-400">{t('replay.shareNote')}</p>
      {token ? (
        <>
          <input className="mb-2 w-full rounded bg-neutral-900 px-2 py-1 text-[0.72rem]" readOnly value={url} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="ink-button px-2.5 py-1"
              onClick={() => {
                void navigator.clipboard?.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? t('replay.shareCopied') : t('replay.open')}
            </button>
            <button type="button" className="ink-button px-2.5 py-1" disabled={busy} onClick={() => void revoke()}>
              {t('replay.shareRevoke')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-2 text-neutral-400">{t('replay.shareNone')}</p>
          <button type="button" className="ink-button px-2.5 py-1" disabled={busy} onClick={() => void share()}>
            {t('replay.shareCreate')}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * L'écran de refus, et il est **volontairement indistinct**.
 *
 * Partie en cours, jeton révoqué, adresse inventée : le serveur répond 404 dans
 * les trois cas, et cette page ne peut donc pas les distinguer. C'est le but :
 * l'existence d'un replay est elle-même une information.
 */
function Message({ title, body }: { title: string; body?: string }): React.ReactElement {
  const t = useT();
  return (
    <div className="site site-floor flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-[72rem] flex-1 flex-col justify-center px-5 py-20 sm:px-8">
        <h1 className="sign text-[clamp(1.6rem,5vw,3rem)] text-[color:var(--site-floor-text)]">{title}</h1>
        {body ? (
          <p className="mt-4 max-w-[52ch] text-[0.98rem] leading-relaxed text-[color:var(--site-floor-dim)]">
            {body}
          </p>
        ) : null}
        <div className="mt-7">
          <a className="ink-button px-5 py-3 text-[0.82rem]" href="/">
            {t('replay.home')}
          </a>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
