import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { DeckSummary } from '@mtg/shared';
import { api, type Me } from '../lib/api.js';
import { useGame } from '../store/game.js';
import { Table, highlightCards } from '../components/Table.js';
import { Hand } from '../components/Hand.js';
import { ActionLog } from '../components/ActionLog.js';
import { PlayerPanel } from '../components/PlayerPanel.js';
import { DiceBar, Toolbar } from '../components/Toolbar.js';
import { LookModal } from '../components/LookModal.js';
import { PublicRevealModal } from '../components/PublicRevealModal.js';
import { TokenSearch } from '../components/TokenSearch.js';
import { CountersPanel } from '../components/CountersPanel.js';
import { ShortcutsHelp, useShortcuts } from '../components/Shortcuts.js';
import { CardMenu } from '../components/CardMenu.js';
import { ZoneMenu } from '../components/ZoneMenu.js';
import { ZONE_PANEL_WIDTH, ZonePanel } from '../components/ZonePanel.js';
import { DragLayer } from '../components/DragLayer.js';
import { SeatSettings } from '../components/SeatSettings.js';
import { installHoverTracking } from '../lib/hover.js';
import { LegalFooter } from '../components/LegalFooter.js';
import { Wordmark } from '../components/Mark.js';
import { CardPreview } from '../components/CardPreview.js';
import { TokenShelf } from '../components/TokenShelf.js';
import { TableMenu } from '../components/TableMenu.js';
import { LeaveTable } from '../components/LeaveTable.js';
import { TurnOrder } from '../components/TurnOrder.js';
import { TableClosed } from '../components/TableClosed.js';
import { PreGameDeck } from '../components/PreGameDeck.js';
import { hasSeatToken } from '../net/socket.js';

/**
 * Jeton rapide : on résout le nom en impression via la recherche serveur, puis on
 * demande la création. Deux appels, mais aucune liste d'identifiants codée en dur
 * qui deviendrait fausse à la prochaine édition.
 */
async function createQuickToken(name: string, send: ReturnType<typeof useGame.getState>['send']): Promise<void> {
  try {
    const { results } = await api.get<{ results: Array<{ scryfallId: string }> }>(
      `/api/cards/search?q=${encodeURIComponent(name)}&type=token&limit=1`,
    );
    const first = results[0];
    if (first) send({ type: 'CREATE_TOKEN', scryfallId: first.scryfallId, x: 60, y: 60 });
  } catch {
    // Silencieux : l'utilisateur peut toujours passer par la recherche complète.
  }
}

export function RoomPage(): React.ReactElement {
  const { code = '' } = useParams();
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const status = useGame((s) => s.status);
  const statusDetail = useGame((s) => s.statusDetail);
  const mySeat = useGame((s) => s.mySeat);
  const roomCode = useGame((s) => s.roomCode);
  const room = useGame((s) => s.room);
  const seats = useGame((s) => s.seats);
  const send = useGame((s) => s.send);
  const lastReject = useGame((s) => s.lastReject);
  const dismissReject = useGame((s) => s.dismissReject);
  const menu = useGame((s) => s.menu);
  const openMenu = useGame((s) => s.openMenu);

  const [countersOpen, setCountersOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState(false);
  /** Où poser le prochain jeton créé par la recherche, en repère de panneau. */
  const tokenSpot = useRef<{ x: number; y: number } | null>(null);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  /** Le panneau de composition, ouvert seulement avant le lancement. */
  const [preGame, setPreGame] = useState(false);
  /** Le panneau des zones est ancré à droite : le reste doit lui céder la place. */
  const [zonePanel, setZonePanel] = useState(false);
  const rightInset = zonePanel ? ZONE_PANEL_WIDTH + 8 : 0;
  /** Les sièges qui n'ont pas encore de deck : lancer la partie leur est dû. */
  const waitingForDecks = seats.filter((seat) => !seat.deckName).map((seat) => seat.displayName);
  useShortcuts(() => setHelp(true));

  useEffect(() => {
    connect(code);
    return () => disconnect();
  }, [code, connect, disconnect]);

  // Le survol doit se réévaluer quand les cartes changent sous un curseur
  // immobile : sans cela, un raccourci contextuel n'a plus de cible au coup
  // suivant. Voir `lib/hover.ts`.
  useEffect(() => installHoverTracking(), []);

  useEffect(() => {
    if (!lastReject) return;
    const timer = window.setTimeout(dismissReject, 4000);
    return () => window.clearTimeout(timer);
  }, [lastReject, dismissReject]);

  /*
   * Une coupure fatale — protocole incompatible, surtout — doit se voir
   * **avant** tout le reste. Le bandeau ne vivait qu'à l'intérieur de la table,
   * donc un client trop ancien restait bloqué sur « Connexion à la table… »
   * sans jamais lire qu'il devait recharger.
   */
  if (status === 'fatal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-table p-6">
        <div className="max-w-sm rounded border border-edge bg-panel p-5 text-center">
          <p className="mb-4 text-sm text-slate-300">
            {statusDetail ?? 'La connexion a été refusée.'}
          </p>
          <button
            className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white"
            onClick={() => location.reload()}
          >
            Recharger
          </button>
        </div>
      </div>
    );
  }

  // Le siège doit être celui de **cette** table. Le store est global : un
  // siège encore en mémoire, acquis ailleurs, ferait servir la table à
  // quelqu'un qui n'y a jamais pris place. `connect()` remet l'état à neuf,
  // mais le premier rendu le précède d'une frame.
  if (!mySeat || roomCode !== code) {
    /*
     * On tient une place à cette table et la reprise n'a pas encore abouti :
     * surtout ne pas montrer le salon. Il demanderait un nom et un deck à
     * quelqu'un qui a déjà une main et un terrain — c'est ce qu'on voyait
     * pendant plusieurs secondes quand la reprise traînait, et l'on pouvait
     * même s'asseoir une seconde fois par-dessus soi-même.
     */
    if (status !== 'open' && hasSeatToken(code)) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-table text-sm text-slate-400">
          <p data-test="resuming">Reprise de votre place à la table {code}…</p>
        </div>
      );
    }
    return <Lobby code={code} />;
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-table">
      <Table />
      <TableClosed />

      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3"
        style={{ paddingRight: 12 + rightInset }}
      >
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-2.5">
          <LeaveTable />
          <button
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs sm:text-sm text-slate-200 hover:bg-slate-800 hover:border-slate-600 hover:text-white shadow-sm backdrop-blur transition-all active:scale-95"
            onClick={() => void navigator.clipboard.writeText(location.href)}
            title="Copier le lien d'invitation"
          >
            🔗
          </button>
          <button
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs sm:text-sm text-slate-200 hover:bg-slate-800 hover:border-slate-600 hover:text-white shadow-sm backdrop-blur transition-all active:scale-95"
            onClick={() => setSettings(true)}
            title="Playmat et dos de carte"
          >
            ⚙
          </button>
          <span className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-xs font-semibold text-slate-300 backdrop-blur shadow-sm">
            {seats.length} joueur{seats.length > 1 ? 's' : ''} · table <span className="font-mono text-sky-400 font-bold">{code}</span>
          </span>
          {status !== 'open' && (
            <span className="rounded-lg bg-amber-900/80 border border-amber-600/60 px-2.5 py-1 text-xs font-semibold text-amber-200 shadow-sm animate-pulse">
              {status === 'connecting' ? 'Connexion…' : 'Reconnexion en cours…'}
            </span>
          )}
        </div>

        <Toolbar
          onCreateToken={() => setTokenSearch(true)}
          onQuickToken={(name) => void createQuickToken(name, send)}
          onOpenHelp={() => setHelp(true)}
          onOpenSettings={() => setSettings(true)}
        />
      </div>

      <div className="pointer-events-none absolute left-3 top-16 w-72 space-y-2">
        <TurnOrder />
        <DiceBar />
        <ActionLog onHighlight={highlightCards} />
      </div>

      <div
        className="pointer-events-none absolute top-16 flex w-60 flex-col gap-2"
        style={{ right: 12 + rightInset }}
      >
        <PlayerPanel />
        <TokenShelf onSearch={() => setTokenSearch(true)} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
        {room?.status === 'LOBBY' && (
          <div className="pointer-events-auto mx-auto mb-2 w-fit rounded border border-edge bg-panel px-4 py-2 text-sm">
            {/*
              Le serveur refuse `START_GAME` tant qu'un siège n'a pas de deck
              (`ERR_GAME_NOT_STARTED`). Offrir le bouton quand même, c'est
              promettre une action qui sera refusée : le chargement d'une liste
              est asynchrone, et l'hôte cliquait pendant que le deck du voisin
              se résolvait encore. On dit qui manque, plutôt que de laisser
              cliquer dans le vide.
            */}
            <span className="mr-3 text-slate-400">
              {waitingForDecks.length === 0
                ? "La partie n'a pas commencé."
                : `Deck en cours de chargement : ${waitingForDecks.join(', ')}.`}
            </span>
            {/*
              Le dernier moment où le deck se compose : une fois lancé, il n'y a
              plus ni changement de liste ni sideboard. Le bouton est donc ici,
              à côté de celui qui ferme cette porte.
            */}
            <button
              className="mr-2 rounded border border-edge px-3 py-1 text-slate-200 hover:border-slate-500"
              data-test="open-pregame"
              onClick={() => setPreGame(true)}
            >
              Mon deck
            </button>
            <button
              className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              data-test="start-game"
              disabled={waitingForDecks.length > 0}
              onClick={() => send({ type: 'START_GAME' })}
            >
              Lancer la partie
            </button>
          </div>
        )}
        <Hand
          onCardDoubleClick={(card) =>
            send({ type: 'MOVE_CARD', cardId: card.id, to: { seat: mySeat, kind: 'BATTLEFIELD' }, x: 60, y: 60 })
          }
        />
      </div>

      {preGame && room?.status !== 'PLAYING' && <PreGameDeck onClose={() => setPreGame(false)} />}
      <CardPreview />
      <DragLayer />
      <LookModal />
      <PublicRevealModal />
      <ZonePanel onOpenChange={setZonePanel} />
      {menu?.kind === 'CARD' && (
        <CardMenu card={menu.card} x={menu.x} y={menu.y} onClose={() => openMenu(null)} />
      )}
      {menu?.kind === 'ZONE' && (
        <ZoneMenu zone={menu.zone} x={menu.x} y={menu.y} onClose={() => openMenu(null)} />
      )}
      {menu?.kind === 'TABLE' && (
        <TableMenu
          target={menu}
          onClose={() => openMenu(null)}
          onOpenCounters={() => setCountersOpen(true)}
          onCreateToken={(at) => {
            tokenSpot.current = at;
            setTokenSearch(true);
          }}
        />
      )}
      {tokenSearch && (
        <TokenSearch
          at={tokenSpot.current}
          onClose={() => {
            tokenSpot.current = null;
            setTokenSearch(false);
          }}
        />
      )}
      {countersOpen && <CountersPanel onClose={() => setCountersOpen(false)} />}
      {settings && <SeatSettings onClose={() => setSettings(false)} />}
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}

      {/*
        Le refus doit passer au-dessus de tout, modales et menus compris : c'est
        précisément en manipulant une modale qu'on se fait refuser une action, et
        un message peint dessous n'existe pas. `z-[60]` dépasse la modale la plus
        haute (`z-50`). `pointer-events-none` pour ne pas voler le clic suivant.
      */}
      {lastReject && (
        <div
          className="pointer-events-none absolute bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded bg-rose-900/95 px-4 py-2 text-sm text-rose-100 shadow-lg ring-1 ring-rose-600"
          data-test="reject-toast"
          role="status"
        >
          {lastReject}
        </div>
      )}
    </div>
  );
}

/**
 * Brouillon de salon mis de côté avant un détour par la connexion. Il vit dans
 * `sessionStorage` : le temps d'un onglet, jamais plus, et jamais côté serveur.
 */
const DRAFT_KEY = 'mtg:lobby-draft';

interface LobbyDraft {
  name: string;
  deckText: string;
}

function readDraft(code: string): LobbyDraft | null {
  try {
    const raw = window.sessionStorage.getItem(`${DRAFT_KEY}:${code}`);
    return raw ? (JSON.parse(raw) as LobbyDraft) : null;
  } catch {
    return null;
  }
}

function writeDraft(code: string, draft: LobbyDraft): void {
  try {
    window.sessionStorage.setItem(`${DRAFT_KEY}:${code}`, JSON.stringify(draft));
  } catch {
    // Stockage refusé (navigation privée) : on perd le brouillon, pas la partie.
  }
}

/**
 * Salon : choisir un siège et un deck. Le collage est là aussi un chemin de
 * premier rang — on peut jouer sans compte, avec une liste collée. Le compte
 * n'est qu'un confort : il pré-remplit le pseudo et donne accès aux decks
 * enregistrés, il n'est jamais un péage.
 */
/**
 * L'état de la table, écrit en français et non en « 0 joueur(s) » : un pluriel
 * entre parenthèses est une note du développeur, pas une phrase.
 */
function attendance(count: number): string {
  const free = Math.max(0, 4 - count);
  const here =
    count === 0 ? 'personne encore' : count === 1 ? '1 joueur assis' : `${count} joueurs assis`;
  const left = free === 0 ? 'table complète' : free === 1 ? '1 place libre' : `${free} places libres`;
  return `${here} · ${left}`;
}

function Lobby({ code }: { code: string }): React.ReactElement {
  const send = useGame((s) => s.send);
  const seats = useGame((s) => s.seats);
  const status = useGame((s) => s.status);
  const restored = useRef(readDraft(code));
  const [name, setName] = useState(restored.current?.name ?? '');
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [deckId, setDeckId] = useState('');
  const [deckText, setDeckText] = useState(restored.current?.deckText ?? '');
  /** `null` tant qu'on ne sait pas, `false` si l'on joue en invité. */
  const [account, setAccount] = useState<Me | null | false>(null);
  /** `null` tant qu'on ne sait pas si la table est encore ouverte. */
  const [closed, setClosed] = useState<boolean | null>(null);

  // On demande l'état du salon avant de proposer une chaise : offrir un siège à
  // une table rangée, puis se faire refuser par le serveur, n'est pas une
  // réponse — c'est une fausse promesse suivie d'une erreur.
  useEffect(() => {
    void api
      .get<{ closed: boolean }>(`/api/rooms/${code}`)
      .then((room) => setClosed(room.closed))
      .catch(() => setClosed(false));
  }, [code]);

  // Si l'on est connecté, on montre son pseudo avant de s'asseoir — le serveur
  // sait déjà le retrouver, mais l'utilisateur doit le voir et pouvoir le
  // changer pour cette partie seulement.
  useEffect(() => {
    void api
      .get<Me>('/api/me')
      .then((me) => {
        setAccount(me);
        setName((current) => current.trim() || me.displayName);
      })
      .catch(() => setAccount(false));
  }, []);

  useEffect(() => {
    void api
      .get<{ decks: DeckSummary[] }>('/api/decks')
      .then((r) => setDecks(r.decks))
      .catch(() => setDecks([]));
  }, [account]);

  /** Départ vers la connexion : on garde la saisie et le chemin du retour. */
  function leaveTo(path: string): string {
    writeDraft(code, { name, deckText });
    return `${path}?next=${encodeURIComponent(`/rooms/${code}`)}`;
  }

  const taken = new Set(seats.map((s) => s.seatIndex));
  const firstFree = [...Array(8).keys()].find((i) => !taken.has(i)) ?? 0;

  function sit(): void {
    send({
      type: 'SIT_DOWN',
      seatIndex: firstFree,
      ...(name.trim() ? { displayName: name.trim() } : {}),
      ...(deckId ? { deckId } : {}),
      ...(!deckId && deckText.trim() ? { deckText } : {}),
    });
  }

  return (
    /* Le salon porte l'identité du site, pas celle de la table : c'est le
       premier écran de quelqu'un qui vient de cliquer sur un lien d'invitation,
       et il est de la même famille que l'accueil. Le code de la table est ce
       qu'on lui a envoyé : il est donc la chose la plus grosse à l'écran. */
    <div className="site site-floor flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-[72rem] px-5 py-5 sm:px-8">
        <Link to="/">
          <Wordmark />
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[34rem] flex-1 px-5 pb-16 sm:pt-6">
        <h1 className="typed text-[clamp(2.6rem,12vw,4.2rem)] font-bold leading-none tracking-[0.06em] text-[color:var(--site-floor-text)]">
          {code}
        </h1>
        <p className="mt-3 text-[0.92rem] text-[color:var(--site-floor-dim)]">
          {status === 'open' ? `Code de la table · ${attendance(seats.length)}` : 'Connexion à la table…'}
        </p>

        {seats.length > 0 && (
          <ul className="rule-floor mt-5 pt-4">
            {seats.map((seat) => (
              <li className="flex items-center gap-2.5 py-1.5 text-[0.9rem]" key={seat.id}>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: seat.color }}
                />
                <span className="text-[color:var(--site-floor-text)]">{seat.displayName}</span>
                <span className="text-[color:var(--site-floor-dim)]">
                  {seat.deckName ?? 'sans deck'}
                </span>
                {!seat.connected && (
                  <span className="sign-sm ml-auto text-[0.62rem] text-amber-300">déconnecté</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {closed ? (
          <div className="cut-shadow settle mt-8">
            <div className="paper paper-cut p-6 sm:p-7">
              <h2 className="sign text-[1.4rem] leading-none text-[color:var(--site-ink)]">
                Table close
              </h2>
              <p className="mt-3 text-[0.9rem] leading-relaxed text-[color:var(--site-ink-soft)]">
                L’hôte a rangé cette table. On ne s’y assoit plus, et la partie qui
                s’y jouait est terminée.
              </p>
              <Link className="ink-button mt-5 inline-block px-5 py-2.5 text-[0.8rem]" to="/">
                Ouvrir une autre table
              </Link>
            </div>
          </div>
        ) : (
        /* Ce qu'on remplit avant de s'asseoir : du papier, comme partout
           ailleurs sur le site. */
        <div className="cut-shadow settle mt-8">
          <div className="paper paper-cut p-6 sm:p-7">
            <h2 className="sign-sm text-[0.78rem]">Prendre une place</h2>

            <div className="rule-ink mt-3 space-y-5 pt-5">
              <label className="block">
                <span className="paper-label">Votre nom à table</span>
                <input
                  className="paper-field"
                  maxLength={32}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Invité"
                  value={name}
                />
              </label>

              {decks.length > 0 && (
                <label className="block">
                  <span className="paper-label">Un de vos decks</span>
                  <select
                    className="paper-field paper-select"
                    onChange={(event) => setDeckId(event.target.value)}
                    value={deckId}
                  >
                    <option value="">— coller une liste à la place —</option>
                    {decks.map((deck) => (
                      <option key={deck.id} value={deck.id}>
                        {deck.name} ({deck.cardCount})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {!deckId && (
                <label className="block">
                  <span className="paper-label">Coller une liste</span>
                  <textarea
                    className="scrollbar-thin paper-field typed h-40 resize-none text-[0.8rem] leading-relaxed"
                    onChange={(event) => setDeckText(event.target.value)}
                    placeholder={'1 Sol Ring\n1 Arcane Signet\n\n// Commander\n1 Selenia, the Cursed Heart'}
                    value={deckText}
                  />
                  <span className="paper-dim mt-1.5 block text-[0.78rem] leading-relaxed">
                    Un export Moxfield, Archidekt, MTGO, ou tapée à la main.
                  </span>
                </label>
              )}

              <button
                className="ink-button w-full px-5 py-3.5 text-[0.86rem]"
                disabled={status !== 'open'}
                onClick={sit}
                type="button"
              >
                {status === 'open' ? "S'asseoir à la table" : 'Connexion…'}
              </button>
            </div>
          </div>
        </div>
        )}

        {!closed && account === false && (
          <p className="mt-6 text-[0.9rem] leading-relaxed text-[color:var(--site-floor-dim)]">
            <Link className="floor-link" to={leaveTo('/login')}>
              Se connecter
            </Link>{' '}
            ou{' '}
            <Link className="floor-link" to={leaveTo('/register')}>
              créer un compte
            </Link>{' '}
            — votre nom et la liste collée sont conservés, et vous revenez ici.
          </p>
        )}

        <p className="mt-4 text-[0.84rem] leading-relaxed text-[color:var(--site-floor-dim)]">
          Aucun compte n’est nécessaire pour jouer. Si vous en créez un plus tard, vous
          pourrez y enregistrer la liste que vous venez de coller.
        </p>
      </main>

      <LegalFooter />
    </div>
  );
}
