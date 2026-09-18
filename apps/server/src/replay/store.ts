/**
 * Persistance des replays.
 *
 * Tout ce qui écrit est **hors du chemin chaud** : la room appelle un puits qui
 * empile des promesses et avale ses échecs. Une base lente ou tombée ralentit
 * l'écriture d'un replay, jamais une pioche.
 *
 * Tout ce qui lit applique le verrou, et l'applique **à la lecture** : un
 * enregistrement dont `closedAt` est nul n'existe pour personne. Voir
 * docs/replay.md.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
import type { ReplayFrame, ReplayOrigin } from './types.js';
import type { ReplaySink } from './recorder.js';

/**
 * Sérialisation des écritures par enregistrement.
 *
 * `open` doit atterrir avant le premier `append`, et `close` après le dernier.
 * Une chaîne de promesses par clé suffit : les écritures d'une même partie sont
 * peu nombreuses (une par tranche de 500 pas) et strictement ordonnées.
 */
const queues = new Map<string, Promise<unknown>>();

function enqueue(key: string, task: () => Promise<unknown>): void {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task).catch(() => undefined);
  queues.set(key, next);
  void next.then(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}

/** Attend que les écritures en vol soient posées. Réservé aux tests. */
export async function drainReplayWrites(): Promise<void> {
  await Promise.all([...queues.values()]);
}

async function replayIdOf(roomId: string, startSeq: number): Promise<string | null> {
  const row = await prisma.gameReplay.findUnique({
    where: { roomId_startSeq: { roomId, startSeq } },
    select: { id: true },
  });
  return row?.id ?? null;
}

export const prismaReplaySink: ReplaySink = {
  open(roomId, startSeq, origin: ReplayOrigin) {
    enqueue(`${roomId}|${startSeq}`, async () => {
      await prisma.gameReplay.upsert({
        where: { roomId_startSeq: { roomId, startSeq } },
        create: {
          roomId,
          startSeq,
          origin: origin as never,
          seats: origin.seats as never,
          lastSeq: startSeq,
        },
        // Réouvrir la même clé veut dire « on recommence » : l'enregistrement
        // repart de zéro, et surtout il redevient non clos, donc illisible.
        update: {
          origin: origin as never,
          seats: origin.seats as never,
          lastSeq: startSeq,
          eventCount: 0,
          bytes: 0,
          truncated: false,
          closedAt: null,
          closedFor: null,
        },
      });
      const id = await replayIdOf(roomId, startSeq);
      if (id) await prisma.replayChunk.deleteMany({ where: { replayId: id } });
    });
  },

  append(roomId, startSeq, frames: ReplayFrame[]) {
    if (frames.length === 0) return;
    enqueue(`${roomId}|${startSeq}`, async () => {
      const id = await replayIdOf(roomId, startSeq);
      if (!id) return;
      const index = await prisma.replayChunk.count({ where: { replayId: id } });
      await prisma.replayChunk.create({
        data: {
          replayId: id,
          index,
          firstSeq: frames[0]!.seq,
          lastSeq: frames[frames.length - 1]!.seq,
          frames: frames as never,
        },
      });
    });
  },

  close(roomId, startSeq, stats) {
    enqueue(`${roomId}|${startSeq}`, async () => {
      await prisma.gameReplay.updateMany({
        where: { roomId, startSeq },
        data: {
          closedAt: new Date(),
          closedFor: stats.reason,
          lastSeq: stats.lastSeq,
          eventCount: stats.eventCount,
          bytes: stats.bytes,
          truncated: stats.truncated,
        },
      });
    });
  },
};

export interface StoredReplay {
  id: string;
  roomId: string;
  roomCode: string;
  hostUserId: string | null;
  startSeq: number;
  lastSeq: number;
  eventCount: number;
  truncated: boolean;
  startedAt: Date;
  closedAt: Date;
  shareToken: string | null;
  origin: ReplayOrigin;
}

/**
 * Charge un enregistrement **lisible**, ou `null`.
 *
 * `closedAt: { not: null }` n'est pas un détail d'implémentation, c'est le
 * verrou : tant que la partie court, la ligne existe mais cette requête ne la
 * ramène pas, et aucun appelant n'a de chemin pour la contourner — il n'y a
 * pas d'autre fonction de chargement.
 */
async function loadReadable(
  where: { id: string } | { shareToken: string },
): Promise<StoredReplay | null> {
  const row = await prisma.gameReplay.findFirst({
    where: { ...where, closedAt: { not: null } },
    include: { room: { select: { code: true, hostUserId: true } } },
  });
  if (!row || !row.closedAt) return null;
  return {
    id: row.id,
    roomId: row.roomId,
    roomCode: row.room.code,
    hostUserId: row.room.hostUserId,
    startSeq: row.startSeq,
    lastSeq: row.lastSeq,
    eventCount: row.eventCount,
    truncated: row.truncated,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    shareToken: row.shareToken,
    origin: row.origin as unknown as ReplayOrigin,
  };
}

export function readableById(id: string): Promise<StoredReplay | null> {
  return loadReadable({ id });
}

export function readableByToken(shareToken: string): Promise<StoredReplay | null> {
  return loadReadable({ shareToken });
}

export async function chunkCountOf(replayId: string): Promise<number> {
  return prisma.replayChunk.count({ where: { replayId } });
}

export async function readChunk(replayId: string, index: number): Promise<ReplayFrame[]> {
  const row = await prisma.replayChunk.findUnique({
    where: { replayId_index: { replayId, index } },
    select: { frames: true },
  });
  return (row?.frames as unknown as ReplayFrame[]) ?? [];
}

/**
 * Le dernier enregistrement **lisible** d'une table, s'il y en a un.
 *
 * Une table qui a enchaîné trois manches en a trois : on propose la dernière,
 * celle que les joueurs viennent de terminer.
 */
export async function latestReadableOfRoom(roomId: string): Promise<StoredReplay | null> {
  const row = await prisma.gameReplay.findFirst({
    where: { roomId, closedAt: { not: null } },
    orderBy: { startSeq: 'desc' },
    select: { id: true },
  });
  return row ? readableById(row.id) : null;
}

/** Jeton de partage : 32 octets d'aléa, imprononçable et indevinable. */
export function makeShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function shareReplay(id: string, byUserId: string): Promise<string | null> {
  // Le verrou vaut aussi pour le partage : on ne rend pas partageable une
  // partie en cours, même à son hôte.
  const readable = await readableById(id);
  if (!readable) return null;
  if (readable.shareToken) return readable.shareToken;
  const token = makeShareToken();
  await prisma.gameReplay.update({
    where: { id },
    data: { shareToken: token, sharedAt: new Date(), sharedById: byUserId },
  });
  return token;
}

export async function revokeShare(id: string): Promise<void> {
  // Révoquer ne dépend pas du verrou : refermer un partage fait par erreur doit
  // marcher dans tous les cas, y compris sur un enregistrement rouvert.
  await prisma.gameReplay.updateMany({
    where: { id },
    data: { shareToken: null, sharedAt: null, sharedById: null },
  });
}

/**
 * Referme les enregistrements des tables abandonnées que plus aucun processus
 * ne tient en mémoire.
 *
 * Sans cela, une partie quittée sans être close resterait sans replay possible
 * indéfiniment : personne ne reviendra jamais émettre son `GAME_ENDED`. La
 * garde est le temps : on ne referme que ce qui n'a plus bougé depuis
 * longtemps, donc jamais une table où quelqu'un est encore assis.
 */
export async function closeAbandonedReplays(
  maxAgeMs: number,
  isLive: (roomCode: string) => boolean,
): Promise<number> {
  /*
   * **Le repère est l'âge de l'enregistrement, pas `GameRoom.lastActivityAt`.**
   *
   * Cette colonne-là ne bouge jamais après la création de la table : rien dans
   * le serveur ne l'écrit, l'activité vit en mémoire dans `GameState`. S'y
   * fier aurait refermé l'enregistrement d'une partie **en cours** dès qu'elle
   * dépasse le délai depuis l'ouverture de la table — c'est-à-dire ouvert le
   * replay d'une partie qui se joue encore, exactement ce que le verrou
   * interdit.
   *
   * Deux gardes, donc, et les deux comptent : l'enregistrement doit être vieux
   * *et* sa table ne doit être vivante dans aucun processus. Une partie qui
   * dure plus longtemps que le délai tient toujours sa room en mémoire.
   */
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await prisma.gameReplay.findMany({
    where: { closedAt: null, startedAt: { lt: cutoff } },
    select: { id: true, room: { select: { code: true } } },
    take: 50,
  });
  let closed = 0;
  for (const row of stale) {
    if (isLive(row.room.code)) continue;
    await prisma.gameReplay
      .update({ where: { id: row.id }, data: { closedAt: new Date(), closedFor: 'TIMEOUT' } })
      .catch(() => undefined);
    closed += 1;
  }
  return closed;
}
