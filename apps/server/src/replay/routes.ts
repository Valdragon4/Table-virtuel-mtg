/**
 * Routes du replay.
 *
 * **Le verrou avant la fonctionnalité.** Un replay n'existe, n'est servi et
 * n'est devinable qu'une fois la partie terminée. Ce n'est pas une précaution :
 * c'est ce qui rend la fonctionnalité acceptable. Sans lui, un joueur ouvre le
 * replay de sa propre partie en cours, bascule sur le point de vue de son
 * adversaire et lit sa main en direct — le replay deviendrait l'outil de triche
 * parfait et contournerait d'un coup tout l'édifice de visibilité du projet.
 *
 * Trois propriétés tiennent ce verrou :
 *
 * 1. **Il est porté par la donnée.** `readableById` / `readableByToken` sont les
 *    seules portes d'entrée, et elles filtrent sur `closedAt: { not: null }`.
 *    Une route nouvelle qui oublierait la garde ne trouverait rien à servir.
 * 2. **Il est vérifié à la lecture, à chaque appel.** Rien n'est mis en cache,
 *    aucune décision n'est figée au moment du partage : un enregistrement
 *    rouvert cesse d'être lisible immédiatement, jeton en main ou non.
 * 3. **Il double la garde avec la room vivante.** Si la table est en mémoire et
 *    qu'elle rejoue la partie de cet enregistrement, on refuse, quoi que dise
 *    la base.
 *
 * Un refus est toujours un **404**, jamais un 403 : l'existence d'un replay est
 * elle-même une information. Un joueur qui teste l'adresse du replay de sa
 * partie en cours doit lire la même chose qu'une adresse inexistante.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth/guard.js';
import { peekRoom } from '../game/registry.js';
import { projectFrame, projectOrigin } from './projection.js';
import {
  chunkCountOf,
  latestReadableOfRoom,
  readChunk,
  readableById,
  readableByToken,
  revokeShare,
  shareReplay,
  type StoredReplay,
} from './store.js';
import type { ReplayView } from './types.js';

const handleSchema = z.object({ handle: z.string().min(8).max(200) });
const codeSchema = z.object({ code: z.string().min(4).max(16) });

/**
 * La table rejoue-t-elle en ce moment la partie de cet enregistrement ?
 *
 * Deuxième garde, indépendante de la base. Elle attrape le cas où la ligne
 * aurait été refermée à tort — un balayage trop zélé, une écriture manuelle —
 * alors que la partie tourne encore dans ce processus.
 */
function liveGameCollides(replay: StoredReplay): boolean {
  const live = peekRoom(replay.roomCode);
  if (!live) return false;
  return live.state.status === 'PLAYING' && live.state.seq >= replay.startSeq;
}

/** Points de vue proposés : la vue omnisciente, puis un siège par joueur. */
function viewsOf(replay: StoredReplay): Array<{ id: string; displayName: string }> {
  const seats = Array.isArray(replay.origin.seats) ? replay.origin.seats : [];
  return seats.map((raw) => {
    const s = raw as Record<string, unknown>;
    return {
      id: typeof s['id'] === 'string' ? s['id'] : '',
      displayName: typeof s['displayName'] === 'string' ? s['displayName'] : 'Joueur',
    };
  });
}

function parseView(raw: unknown, replay: StoredReplay): ReplayView | null {
  if (raw === undefined || raw === 'ALL') return 'ALL';
  if (typeof raw !== 'string') return null;
  return viewsOf(replay).some((v) => v.id === raw) ? raw : null;
}

/**
 * Résout un `handle` — jeton de partage ou identifiant d'enregistrement — en un
 * replay que l'appelant a le droit de lire.
 *
 * Un jeton de partage ouvre à quiconque le détient : c'est tout son propos. Un
 * identifiant, lui, n'ouvre qu'aux joueurs de la partie et à l'hôte de la
 * table, et seulement s'ils ont un compte — voir docs/replay.md sur le sort des
 * invités.
 */
async function resolve(handle: string, userId: string | null): Promise<StoredReplay | null> {
  const byToken = await readableByToken(handle);
  if (byToken) return liveGameCollides(byToken) ? null : byToken;

  if (!userId) return null;
  const byId = await readableById(handle);
  if (!byId || liveGameCollides(byId)) return null;

  if (byId.hostUserId === userId) return byId;
  const seat = await prisma.gameSeat.findFirst({
    where: { roomId: byId.roomId, userId },
    select: { id: true },
  });
  return seat ? byId : null;
}

export async function replayRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Y a-t-il un replay pour cette table, et puis-je le partager ?
   *
   * Appelée depuis la page de table une fois la partie finie. Elle répond
   * `{ available: false }` tant que la partie court — la même chose qu'une
   * table qui n'a jamais rien enregistré.
   */
  app.get('/api/rooms/:code/replay', { preHandler: requireUser }, async (request, reply) => {
    const params = codeSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const room = await prisma.gameRoom.findUnique({
      where: { code: params.data.code },
      select: { id: true, hostUserId: true },
    });
    if (!room) return reply.code(404).send({ error: 'NOT_FOUND' });

    const replay = await latestReadableOfRoom(room.id);
    if (!replay || liveGameCollides(replay)) return reply.send({ available: false });

    const isHost = room.hostUserId === request.userId;
    const seat = await prisma.gameSeat.findFirst({
      where: { roomId: room.id, userId: request.userId! },
      select: { id: true },
    });
    if (!isHost && !seat) return reply.send({ available: false });

    return reply.send({
      available: true,
      replayId: replay.id,
      eventCount: replay.eventCount,
      truncated: replay.truncated,
      shareToken: replay.shareToken,
    });
  });

  /** Rendre partageable. Acte délibéré, jamais un défaut. */
  app.post('/api/rooms/:code/replay/share', { preHandler: requireUser }, async (request, reply) => {
    const params = codeSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const room = await prisma.gameRoom.findUnique({
      where: { code: params.data.code },
      select: { id: true, hostUserId: true },
    });
    if (!room) return reply.code(404).send({ error: 'NOT_FOUND' });

    const replay = await latestReadableOfRoom(room.id);
    // Le verrou s'applique au partage comme à la lecture : on ne rend pas
    // partageable ce qui n'est pas encore terminé.
    if (!replay || liveGameCollides(replay)) return reply.code(404).send({ error: 'NOT_FOUND' });

    const isHost = room.hostUserId === request.userId;
    const seat = await prisma.gameSeat.findFirst({
      where: { roomId: room.id, userId: request.userId! },
      select: { id: true },
    });
    if (!isHost && !seat) return reply.code(404).send({ error: 'NOT_FOUND' });

    const token = await shareReplay(replay.id, request.userId!);
    if (!token) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send({ shareToken: token });
  });

  /** Refermer un partage. Doit marcher même si l'on s'est trompé de table. */
  app.delete('/api/rooms/:code/replay/share', { preHandler: requireUser }, async (request, reply) => {
    const params = codeSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const room = await prisma.gameRoom.findUnique({
      where: { code: params.data.code },
      select: { id: true, hostUserId: true },
    });
    if (!room) return reply.code(404).send({ error: 'NOT_FOUND' });

    const replay = await latestReadableOfRoom(room.id);
    if (!replay) return reply.code(404).send({ error: 'NOT_FOUND' });

    const isHost = room.hostUserId === request.userId;
    const seat = await prisma.gameSeat.findFirst({
      where: { roomId: room.id, userId: request.userId! },
      select: { id: true },
    });
    if (!isHost && !seat) return reply.code(404).send({ error: 'NOT_FOUND' });

    await revokeShare(replay.id);
    return reply.send({ ok: true });
  });

  /** L'en-tête : de quoi armer le rejeu, point zéro compris. */
  app.get('/api/replays/:handle', async (request, reply) => {
    const params = handleSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'NOT_FOUND' });

    const replay = await resolve(params.data.handle, request.userId);
    if (!replay) return reply.code(404).send({ error: 'NOT_FOUND' });

    const query = z.object({ view: z.string().optional() }).safeParse(request.query ?? {});
    const view = query.success ? parseView(query.data.view, replay) : null;
    if (view === null) return reply.code(400).send({ error: 'INVALID_VIEW' });

    return reply.send({
      replayId: replay.id,
      roomCode: replay.roomCode,
      view,
      views: viewsOf(replay),
      snapshot: projectOrigin(replay.origin, view),
      startSeq: replay.startSeq,
      lastSeq: replay.lastSeq,
      eventCount: replay.eventCount,
      truncated: replay.truncated,
      chunks: await chunkCountOf(replay.id),
      startedAt: replay.startedAt.toISOString(),
      closedAt: replay.closedAt.toISOString(),
    });
  });

  /**
   * Une tranche de pas, projetée pour le point de vue demandé.
   *
   * Le verrou est revérifié ici, et pas seulement sur l'en-tête : un lecteur
   * ouvert avant que l'enregistrement ne soit rouvert n'en tirerait rien de
   * plus.
   */
  app.get('/api/replays/:handle/frames', async (request, reply) => {
    const params = handleSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'NOT_FOUND' });

    const replay = await resolve(params.data.handle, request.userId);
    if (!replay) return reply.code(404).send({ error: 'NOT_FOUND' });

    const query = z
      .object({ chunk: z.coerce.number().int().min(0).default(0), view: z.string().optional() })
      .safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const view = parseView(query.data.view, replay);
    if (view === null) return reply.code(400).send({ error: 'INVALID_VIEW' });

    const total = await chunkCountOf(replay.id);
    const frames = await readChunk(replay.id, query.data.chunk);
    return reply.send({
      chunk: query.data.chunk,
      frames: frames.map((frame) => projectFrame(frame, view)),
      more: query.data.chunk + 1 < total,
    });
  });
}
