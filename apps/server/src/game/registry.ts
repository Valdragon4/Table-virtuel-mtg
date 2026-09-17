/**
 * Registre des rooms vivantes de ce processus.
 *
 * L'état de partie vit en mémoire ; la base ne sert qu'à retrouver la room, à
 * journaliser et à figer les decks. Un déploiement multi-instances exigerait de
 * router une room vers un processus unique (affinité par code de room).
 */
import { GAME_MODES, type GameMode, type LogEntry } from '@mtg/shared';
import { prisma } from '../db.js';
import { Room } from './room.js';
import type { CardData } from './state.js';

const rooms = new Map<string, Room>();
/** Au-delà, une room sans activité est libérée. */
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;

async function persistLog(roomId: string, entries: LogEntry[]): Promise<void> {
  await prisma.gameLog
    .createMany({
      data: entries.map((e) => ({
        roomId,
        seq: e.seq,
        type: 'LOG',
        payload: { text: e.text, cardIds: e.cardIds, actor: e.actor } as never,
      })),
      skipDuplicates: true,
    })
    .catch(() => undefined);
}

async function lookupCard(scryfallId: string): Promise<CardData | null> {
  const card = await prisma.card.findUnique({ where: { scryfallId } });
  if (!card) return null;
  return {
    scryfallId: card.scryfallId,
    name: card.name,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    typeLine: card.typeLine,
    manaCost: card.manaCost,
    colorIdentity: card.colorIdentity,
    layout: card.layout,
    imageUris: card.imageUris,
    faces: card.faces,
  };
}

/**
 * Ramène un mode enregistré vers un mode encore proposé.
 *
 * Planechase a été retiré du produit, mais sa valeur reste dans l'enum Prisma :
 * la supprimer casserait les parties déjà en base. Une table ouverte à l'époque
 * repart donc en Commander plutôt que de faire échouer son chargement.
 */
function supportedMode(mode: string): GameMode {
  return (GAME_MODES as readonly string[]).includes(mode) ? (mode as GameMode) : 'COMMANDER';
}

export async function getRoom(code: string): Promise<Room | null> {
  const existing = rooms.get(code);
  if (existing) return existing;

  const record = await prisma.gameRoom.findUnique({ where: { code } });
  if (!record) return null;

  const room = new Room(record.id, record.code, supportedMode(record.gameMode), undefined, {
    persistLog: (roomId, entries) => void persistLog(roomId, entries),
    lookupCard,
  });
  // Une table close ne se rouvre pas en la rechargeant depuis la base : sans
  // cela, il suffisait de recharger la page pour ressusciter une room close et
  // s'y rasseoir comme si de rien n'était.
  if (record.status === 'ENDED') {
    room.state.status = 'ENDED';
    room.state.closed = true;
  }
  rooms.set(code, room);
  return room;
}

/**
 * La room vivante, si elle l'est — sans jamais la ressusciter.
 *
 * `getRoom` charge depuis la base : l'appeler pour lister « mes tables »
 * réveillerait toutes les rooms endormies d'un coup, alors qu'on ne veut que
 * regarder celles qui tournent encore.
 */
export function peekRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function forgetRoom(code: string): void {
  rooms.delete(code);
}

/** Entretien périodique : consultations abandonnées, rooms oubliées. */
export function sweepRooms(log: { info: (msg: string) => void }): void {
  for (const [code, room] of rooms) {
    room.sweepLooks();
    if (room.isEmpty && room.idleMs > ROOM_IDLE_MS) {
      rooms.delete(code);
      log.info(`Room ${code} libérée après inactivité.`);
      void prisma.gameRoom
        .update({ where: { code }, data: { status: 'ENDED' } })
        .catch(() => undefined);
    }
  }
}

export function liveRoomCount(): number {
  return rooms.size;
}
