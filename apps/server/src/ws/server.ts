/**
 * Serveur WebSocket.
 *
 * Handshake versionné, validation stricte des payloads, quotas par socket, et
 * resynchronisation par `seq`. Aucune logique de jeu ici : ce fichier ne fait
 * que transporter des intents vers la room et des messages vers le client.
 */
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { ulid } from 'ulid';
import {
  CLOSE_PROTOCOL_MISMATCH,
  CLOSE_RATE_LIMITED,
  LIMITS,
  PROTOCOL_VERSION,
  clientMessageSchema,
  type ServerMessage,
} from '@mtg/shared';
import { prisma } from '../db.js';
import { resolveSession, SESSION_COOKIE } from '../auth/session.js';
import { getRoom } from '../game/registry.js';
import { IntentError } from '../game/errors.js';
import { snapshotDeck, snapshotFromReport, runImport } from '../decks/service.js';
import { setDeckSyncLogger } from '../decks/printing-sync.js';
import { TokenBucket } from '../lib/throttle.js';
import type { Connection, DeckPayload, Room } from '../game/room.js';

const ROOM_PATH = /^\/ws\/rooms\/([A-Za-z0-9_-]{4,16})$/;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name && rest.length > 0) out[name] = decodeURIComponent(rest.join('='));
  }
  return out;
}

export function registerWebSocket(app: FastifyInstance): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxFrameBytes });

  /*
   * Modifier le deck enregistré d'un joueur à partir d'une action de jeu doit
   * laisser une trace ailleurs que dans la base : c'est ici qu'on la branche
   * sur le journal du serveur, le seul endroit où l'instance Fastify est en vue.
   */
  setDeckSyncLogger({
    info: (msg) => app.log.info(msg),
    error: (msg) => app.log.error(msg),
  });

  app.server.on('upgrade', (request, socket, head) => {
    const match = ROOM_PATH.exec(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      void handleConnection(app, ws, match[1]!, request.headers.cookie);
    });
  });

  // Keepalive : trois pings sans réponse et le socket est considéré mort.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const conn = (client as WebSocket & { _conn?: Connection })._conn;
      if (!conn) continue;
      if (conn.missedPongs >= LIMITS.missedPongsBeforeClose) {
        client.close(1001, 'pong manquant');
        continue;
      }
      conn.missedPongs += 1;
      client.ping();
    }
  }, LIMITS.pingIntervalMs);
  heartbeat.unref();

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    wss.close();
  });
}

async function handleConnection(
  app: FastifyInstance,
  ws: WebSocket,
  code: string,
  cookieHeader: string | undefined,
): Promise<void> {
  const room = await getRoom(code);
  if (!room) {
    send(ws, { t: 'error', code: 'ERR_ROOM_NOT_FOUND', message: 'Table inconnue.', fatal: true });
    ws.close(4404, 'room inconnue');
    return;
  }

  const session = await resolveSession(parseCookies(cookieHeader)[SESSION_COOKIE]);
  const conn: Connection = {
    id: ulid(),
    seatId: null,
    userId: session?.userId ?? null,
    lastSeq: 0,
    send: (message) => send(ws, message),
    close: (closeCode, reason) => ws.close(closeCode, reason),
    bucket: new TokenBucket({ capacity: LIMITS.intentsBurst, refillPerSecond: LIMITS.intentsPerSecond }),
    lastCursorAt: 0,
    missedPongs: 0,
  };
  (ws as WebSocket & { _conn?: Connection })._conn = conn;
  room.addConnection(conn);

  let greeted = false;
  let rateStrikes = 0;

  ws.on('pong', () => {
    conn.missedPongs = 0;
  });

  ws.on('message', (raw) => {
    void (async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        conn.send({ t: 'error', code: 'ERR_PAYLOAD', message: 'JSON invalide.', fatal: false });
        return;
      }

      const message = clientMessageSchema.safeParse(parsed);
      if (!message.success) {
        conn.send({ t: 'error', code: 'ERR_PAYLOAD', message: 'Message refusé par le schéma.', fatal: false });
        return;
      }

      switch (message.data.t) {
        case 'hello': {
          if (message.data.protocol !== PROTOCOL_VERSION) {
            conn.send({
              t: 'error',
              code: 'ERR_PROTOCOL',
              message: `Version de protocole ${message.data.protocol} incompatible (attendu ${PROTOCOL_VERSION}). Recharge la page.`,
              fatal: true,
            });
            conn.close(CLOSE_PROTOCOL_MISMATCH, 'protocole');
            return;
          }
          greeted = true;

          // Reprise de siège : le jeton rend sa place au joueur, y compris invité.
          if (message.data.seatToken) room.resumeSeat(conn, message.data.seatToken);

          const sinceSeq = message.data.sinceSeq;
          const delta = sinceSeq !== undefined ? room.deltaFor(conn.seatId, sinceSeq) : null;
          conn.send({
            t: 'hello',
            protocol: PROTOCOL_VERSION,
            seat: conn.seatId,
            roomCode: code,
            ...(conn.seatId ? { seatToken: room.state.seats.get(conn.seatId)?.seatToken } : {}),
            ...(delta ? { delta } : { snapshot: room.snapshotFor(conn.seatId) }),
          });
          return;
        }

        case 'ping':
          conn.send({ t: 'pong', ts: message.data.ts, serverTs: Date.now() });
          return;

        case 'resync': {
          const delta = room.deltaFor(conn.seatId, message.data.sinceSeq);
          conn.send({
            t: 'hello',
            protocol: PROTOCOL_VERSION,
            seat: conn.seatId,
            roomCode: code,
            ...(delta ? { delta } : { snapshot: room.snapshotFor(conn.seatId) }),
          });
          return;
        }

        case 'intent': {
          if (!greeted) {
            conn.send({ t: 'error', code: 'ERR_PROTOCOL', message: 'hello attendu d’abord.', fatal: true });
            conn.close(CLOSE_PROTOCOL_MISMATCH, 'handshake');
            return;
          }

          // Les curseurs ont leur propre étranglement et ne consomment aucun quota.
          if (message.data.intent.type === 'CURSOR') {
            const now = Date.now();
            if (now - conn.lastCursorAt < LIMITS.cursorMinIntervalMs) return;
            conn.lastCursorAt = now;
          } else if (!conn.bucket.take(conn.id)) {
            rateStrikes += 1;
            conn.send({
              t: 'reject',
              cid: message.data.cid,
              code: 'ERR_RATE_LIMIT',
              message: 'Trop d’actions trop vite.',
            });
            if (rateStrikes >= 5) conn.close(CLOSE_RATE_LIMITED, 'quota');
            return;
          }

          await handleRoomIntent(app, room, conn, message.data.cid, message.data.intent);
          return;
        }
      }
    })().catch((err: unknown) => {
      app.log.error({ err }, 'Erreur de traitement WebSocket');
    });
  });

  ws.on('close', () => {
    room.removeConnection(conn.id);
  });
}

/**
 * Intents de gestion de partie : ils touchent la base (decks, snapshots) et
 * sortent donc du moteur, qui reste synchrone et pur.
 */
async function handleRoomIntent(
  app: FastifyInstance,
  room: Room,
  conn: Connection,
  cid: string,
  intent: Parameters<Room['handleIntent']>[2],
): Promise<void> {
  try {
    // Une table close n'accepte plus rien — pas davantage par cette porte que
    // par le moteur. Seul le départ reste possible, pour rendre sa place.
    if (room.state.closed && intent.type !== 'STAND_UP') {
      conn.send({
        t: 'reject',
        cid,
        code: 'ERR_ROOM_CLOSED',
        message: 'Cette table est close.',
      });
      return;
    }

    switch (intent.type) {
      case 'SIT_DOWN': {
        const name = intent.displayName ?? (await displayNameFor(conn.userId)) ?? 'Invité';
        const seat = room.sitDown(conn, intent.seatIndex, name, conn.userId);
        conn.send({
          t: 'hello',
          protocol: PROTOCOL_VERSION,
          seat: seat.id,
          roomCode: room.state.code,
          seatToken: seat.seatToken,
          snapshot: room.snapshotFor(seat.id),
        });
        if (intent.deckId || intent.deckText) {
          await loadDeckFor(room, conn, { deckId: intent.deckId, deckText: intent.deckText });
        }
        conn.send({ t: 'ack', cid, seq: room.state.seq });
        return;
      }

      case 'STAND_UP': {
        // Le siège doit être relu *avant* le départ : ensuite il n'existe plus,
        // et l'on ne saurait plus quelle ligne libérer en base.
        const seatIndex = conn.seatId ? room.state.seats.get(conn.seatId)?.seatIndex : undefined;
        room.standUp(conn, { force: intent.force ?? false });
        // Quitter veut dire quitter : la place redevient libre pour un autre, et
        // la table disparaît de « mes tables » puisqu'on n'y a plus de siège.
        if (seatIndex !== undefined) {
          await prisma.gameSeat
            .delete({ where: { roomId_seatIndex: { roomId: room.state.roomId, seatIndex } } })
            .catch(() => undefined);
        }
        conn.send({ t: 'ack', cid, seq: room.state.seq });
        return;
      }

      case 'CLOSE_ROOM':
        if (!conn.seatId) throw new IntentError('ERR_NOT_SEATED', 'Assieds-toi d’abord.');
        room.closeRoom(conn.seatId);
        /*
         * `endedAt` avec le statut, et pas seulement dans `POST /rooms/:code/close`.
         *
         * Une table peut être close par deux chemins — cette intention-ci, et la
         * route HTTP — et rien ne dit qu'un joueur passera par l'un plutôt que par
         * l'autre. Ne dater que l'un des deux laisserait le fil d'administration
         * afficher une clôture à l'heure de la dernière action de jeu, qui n'est
         * pas la sienne. `lastActivityAt` ne peut pas servir de repli : il n'est
         * jamais réécrit après la création de la table.
         */
        await prisma.gameRoom
          .update({
            where: { code: room.state.code },
            data: { status: 'ENDED', endedAt: new Date() },
          })
          .catch(() => undefined);
        conn.send({ t: 'ack', cid, seq: room.state.seq });
        return;

      case 'LOAD_DECK':
        await loadDeckFor(room, conn, { deckId: intent.deckId, deckText: intent.deckText });
        conn.send({ t: 'ack', cid, seq: room.state.seq });
        return;

      case 'START_GAME':
        if (!conn.seatId) throw new IntentError('ERR_NOT_SEATED', 'Assieds-toi d’abord.');
        room.startGame(conn.seatId);
        await prisma.gameRoom
          .update({ where: { code: room.state.code }, data: { status: 'PLAYING' } })
          .catch(() => undefined);
        conn.send({ t: 'ack', cid, seq: room.state.seq });
        return;

      case 'RESTART_GAME':
        await room.handleIntent(conn, cid, intent);
        // La room retourne au lobby : la base doit dire la même chose qu'elle.
        await prisma.gameRoom
          .update({ where: { code: room.state.code }, data: { status: room.state.status } })
          .catch(() => undefined);
        return;

      default:
        await room.handleIntent(conn, cid, intent);
        return;
    }
  } catch (err) {
    if (err instanceof IntentError) {
      conn.send({ t: 'reject', cid, code: err.code, message: err.message });
      return;
    }
    app.log.error({ err }, 'Intent de gestion en échec');
    conn.send({ t: 'reject', cid, code: 'ERR_INTERNAL', message: 'Erreur interne.' });
  }
}

async function displayNameFor(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return user?.displayName ?? null;
}

/**
 * Charge un deck sur le siège : depuis un deck du compte, ou depuis une liste
 * collée par un invité. Dans les deux cas un `DeckSnapshot` est figé.
 */
async function loadDeckFor(
  room: Room,
  conn: Connection,
  input: { deckId?: string; deckText?: string },
): Promise<void> {
  if (!conn.seatId) throw new IntentError('ERR_NOT_SEATED', 'Assieds-toi d’abord.');

  let snapshotId: string;
  // Tapis et dos définis sur le deck : ils s'appliquent au siège au chargement.
  let cosmetics: { playmatUrl: string | null; cardBackUrl: string | null } | null = null;

  if (input.deckId) {
    if (!conn.userId) throw new IntentError('ERR_AUTH', 'Connexion requise pour charger un deck enregistré.');
    snapshotId = await snapshotDeck(input.deckId, conn.userId);
    cosmetics = await prisma.deck
      .findFirst({
        where: { id: input.deckId, userId: conn.userId },
        select: { playmatUrl: true, cardBackUrl: true },
      })
      .catch(() => null);
  } else if (input.deckText) {
    const outcome = await runImport({ text: input.deckText });
    snapshotId = await snapshotFromReport(outcome.report);
  } else {
    throw new IntentError('ERR_PAYLOAD', 'Aucun deck fourni.');
  }

  const snapshot = await prisma.deckSnapshot.findUnique({ where: { id: snapshotId } });
  if (!snapshot) throw new IntentError('ERR_INTERNAL', 'Snapshot de deck introuvable.');

  room.loadDeck(conn.seatId, snapshot.payload as unknown as DeckPayload, snapshotId);

  // Après le deck, ses cosmétiques : on ne touche qu'aux champs renseignés, pour
  // ne pas effacer un tapis que le joueur aurait choisi à la main pour la partie.
  if (cosmetics && (cosmetics.playmatUrl !== null || cosmetics.cardBackUrl !== null)) {
    await room.handleIntent(conn, `deck-cosmetics-${snapshotId}`, {
      type: 'SET_SEAT_COSMETICS',
      ...(cosmetics.playmatUrl !== null ? { playmatUrl: cosmetics.playmatUrl } : {}),
      ...(cosmetics.cardBackUrl !== null ? { cardBackUrl: cosmetics.cardBackUrl } : {}),
    });
  }

  await prisma.gameSeat
    .upsert({
      where: { roomId_seatIndex: { roomId: room.state.roomId, seatIndex: room.state.seats.get(conn.seatId)!.seatIndex } },
      create: {
        roomId: room.state.roomId,
        seatIndex: room.state.seats.get(conn.seatId)!.seatIndex,
        userId: conn.userId,
        guestName: conn.userId ? null : room.state.seats.get(conn.seatId)!.displayName,
        deckSnapshotId: snapshotId,
      },
      update: { deckSnapshotId: snapshotId, userId: conn.userId },
    })
    .catch(() => undefined);
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}
