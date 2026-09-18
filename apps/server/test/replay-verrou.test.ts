/**
 * **Le verrou, et le refus autant que le fonctionnement.**
 *
 * Le test qui compte ici est le premier : une partie en cours n'a de replay
 * accessible par aucune route, pour personne — ni un joueur assis, ni l'hôte,
 * ni un porteur de jeton. Sans lui, un joueur ouvrirait le replay de sa propre
 * partie, basculerait sur le point de vue de son adversaire, et lirait sa main
 * en direct : la fonctionnalité deviendrait un outil de triche parfait.
 *
 * Les autres refus comptent presque autant : un jeton révoqué ne sert plus, un
 * jeton inconnu est refusé comme une adresse inexistante, et quelqu'un qui n'a
 * pas joué n'entre pas par l'identifiant.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// `requireUser` tire la pile de session, qui valide la configuration au
// chargement. Aucune de ces valeurs n'est utilisée : la base est simulée.
process.env['DATABASE_URL'] ??= 'postgresql://mtg:mtg@localhost:5432/mtg';
process.env['SESSION_SECRET'] ??= 'secret-de-test-assez-long-pour-passer-la-validation';
process.env['SCRYFALL_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
process.env['ARCHIDEKT_USER_AGENT'] ??= 'mtg-vtt-test/1.0';

/* — Une base en mémoire, réduite à ce que le replay appelle ——————— */

interface Row {
  [key: string]: unknown;
}

const db = {
  gameRoom: [] as Row[],
  gameSeat: [] as Row[],
  gameReplay: [] as Row[],
  replayChunk: [] as Row[],
};

let ids = 0;
const nextId = (): string => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

/** `where` réduit aux formes que le code du replay utilise réellement. */
function matches(row: Row, where: Row): boolean {
  for (const [key, want] of Object.entries(where)) {
    if (key === 'roomId_startSeq') {
      const w = want as { roomId: string; startSeq: number };
      if (row['roomId'] !== w.roomId || row['startSeq'] !== w.startSeq) return false;
      continue;
    }
    if (key === 'replayId_index') {
      const w = want as { replayId: string; index: number };
      if (row['replayId'] !== w.replayId || row['index'] !== w.index) return false;
      continue;
    }
    if (want !== null && typeof want === 'object') {
      const cond = want as Row;
      if ('not' in cond) {
        if (cond['not'] === null ? row[key] === null || row[key] === undefined : row[key] === cond['not']) {
          return false;
        }
        continue;
      }
      if ('lt' in cond) {
        if (!(new Date(row[key] as string) < new Date(cond['lt'] as string))) return false;
        continue;
      }
      return false;
    }
    if (row[key] !== want) return false;
  }
  return true;
}

function table(name: keyof typeof db) {
  const rows = (): Row[] => db[name];
  return {
    findUnique: async ({ where }: { where: Row }) => rows().find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
      let found = rows().filter((r) => matches(r, where));
      if (orderBy && 'startSeq' in orderBy) {
        found = [...found].sort((a, b) => (b['startSeq'] as number) - (a['startSeq'] as number));
      }
      const row = found[0];
      if (!row) return null;
      // `include: { room: … }` : une seule relation à servir.
      if (name === 'gameReplay') {
        const room = db.gameRoom.find((r) => r['id'] === row['roomId']);
        return { ...row, room };
      }
      return row;
    },
    findMany: async ({ where }: { where: Row }) =>
      rows()
        .filter((r) => matches(r, where))
        .map((row) => ({ ...row, room: db.gameRoom.find((r) => r['id'] === row['roomId']) })),
    count: async ({ where }: { where: Row }) => rows().filter((r) => matches(r, where)).length,
    create: async ({ data }: { data: Row }) => {
      const row = { id: nextId(), ...data };
      rows().push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows().find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const found = rows().filter((r) => matches(r, where));
      for (const row of found) Object.assign(row, data);
      return { count: found.length };
    },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const row = rows().find((r) => matches(r, where));
      if (row) {
        Object.assign(row, update);
        return row;
      }
      const made = { id: nextId(), startedAt: new Date(), closedAt: null, shareToken: null, ...create };
      rows().push(made);
      return made;
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const keep = rows().filter((r) => !matches(r, where));
      db[name] = keep;
      return { count: 0 };
    },
  };
}

const fakePrisma = {
  gameRoom: table('gameRoom'),
  gameSeat: table('gameSeat'),
  gameReplay: table('gameReplay'),
  replayChunk: table('replayChunk'),
  gameLog: { createMany: async () => ({ count: 0 }) },
  card: { findUnique: async () => null },
};

vi.mock('../src/db.js', () => ({
  prisma: fakePrisma,
  disconnect: async (): Promise<void> => undefined,
}));

const { replayRoutes } = await import('../src/replay/routes.js');
const { prismaReplaySink, drainReplayWrites } = await import('../src/replay/store.js');
const { Room } = await import('../src/game/room.js');
const { seededRandom } = await import('../src/game/random.js');
const { deck, fakeConnection } = await import('./fixture.js');

/* — Le serveur de test ————————————————————————————— */

const ALICE = 'user-alice';
const BOB = 'user-bob';
const ETRANGER = 'user-etranger';

/**
 * L'authentification est simulée par un en-tête.
 *
 * Le verrou testé ici n'est pas celui de la session : c'est celui du statut de
 * la partie. Brancher toute la pile d'auth n'apporterait que du bruit.
 */
async function server(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('userId', null);
  app.addHook('preHandler', async (request) => {
    const header = request.headers['x-test-user'];
    (request as { userId: string | null }).userId = typeof header === 'string' ? header : null;
  });
  await app.register(replayRoutes);
  await app.ready();
  return app;
}

const ROOM_ID = 'room-verrou';
const CODE = 'VERROU';

/** Une partie jouée, enregistrée dans la fausse base, **non terminée**. */
async function partieEnCours(): Promise<InstanceType<typeof Room>> {
  db.gameRoom.push({ id: ROOM_ID, code: CODE, hostUserId: ALICE, status: 'PLAYING', lastActivityAt: new Date() });
  db.gameSeat.push({ id: 'seat-a', roomId: ROOM_ID, userId: ALICE, seatIndex: 0 });
  db.gameSeat.push({ id: 'seat-b', roomId: ROOM_ID, userId: BOB, seatIndex: 1 });

  const room = new Room(ROOM_ID, CODE, 'COMMANDER', seededRandom(21), {
    replaySink: prismaReplaySink,
  });
  const names = Array.from({ length: 20 }, (_, i) => `Carte ${i + 1}`);
  for (const [index, userId] of [ALICE, BOB].entries()) {
    const conn = fakeConnection(`conn-${index}`);
    room.addConnection(conn);
    room.sitDown(conn, index, index === 0 ? 'Alice' : 'Bob', userId);
    room.loadDeck(`seat_${index}`, deck(`Deck ${index}`, names.map((n) => `${n}-${index}`), `Cmd${index}`), null);
  }
  room.startGame('seat_0');
  const a = [...(room as unknown as { connections: Map<string, unknown> }).connections.values()][0];
  void room.handleIntent(a as never, 'x1', { type: 'DRAW', count: 3 });
  await drainReplayWrites();
  return room;
}

function replayId(): string {
  return db.gameReplay[0]!['id'] as string;
}

beforeEach(() => {
  db.gameRoom = [];
  db.gameSeat = [];
  db.gameReplay = [];
  db.replayChunk = [];
});

describe('une partie en cours n’a pas de replay', () => {
  it('refuse l’identifiant à un joueur assis, à l’hôte, et à un inconnu', async () => {
    await partieEnCours();
    const app = await server();
    const id = replayId();
    expect(id).toBeTruthy();

    for (const user of [ALICE, BOB, ETRANGER]) {
      for (const path of [`/api/replays/${id}`, `/api/replays/${id}/frames?chunk=0`]) {
        const res = await app.inject({ method: 'GET', url: path, headers: { 'x-test-user': user } });
        // 404, pas 403 : l'existence d'un replay est elle-même une information.
        expect(res.statusCode).toBe(404);
      }
    }
    await app.close();
  });

  it('ne se laisse pas rendre partageable, même par l’hôte', async () => {
    await partieEnCours();
    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${CODE}/replay/share`,
      headers: { 'x-test-user': ALICE },
    });
    expect(res.statusCode).toBe(404);
    // Et rien n'a été posé en base au passage : aucun jeton à deviner.
    expect(db.gameReplay[0]!['shareToken']).toBeFalsy();
    await app.close();
  });

  it('ne s’annonce même pas comme disponible', async () => {
    await partieEnCours();
    const app = await server();
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${CODE}/replay`,
      headers: { 'x-test-user': ALICE },
    });
    expect(res.json()).toEqual({ available: false });
    await app.close();
  });

  it('refuse même un jeton valide si la partie a repris entre-temps', async () => {
    const room = await partieEnCours();
    room.close('Alice');
    await drainReplayWrites();

    const app = await server();
    const share = await app.inject({
      method: 'POST',
      url: `/api/rooms/${CODE}/replay/share`,
      headers: { 'x-test-user': ALICE },
    });
    const token = share.json().shareToken as string;
    expect(token).toBeTruthy();

    // La ligne est rouverte à la main : c'est le scénario « le statut a changé
    // après le partage ». Le porteur du jeton ne doit rien obtenir de plus.
    db.gameReplay[0]!['closedAt'] = null;
    const res = await app.inject({ method: 'GET', url: `/api/replays/${token}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('une fois la partie terminée', () => {
  it('sert le replay aux joueurs, et pas aux autres', async () => {
    const room = await partieEnCours();
    room.close('Alice');
    await drainReplayWrites();

    const app = await server();
    const id = replayId();

    for (const user of [ALICE, BOB]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/replays/${id}`,
        headers: { 'x-test-user': user },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().snapshot.cards.length).toBeGreaterThan(0);
    }

    const intrus = await app.inject({
      method: 'GET',
      url: `/api/replays/${id}`,
      headers: { 'x-test-user': ETRANGER },
    });
    expect(intrus.statusCode).toBe(404);

    // Sans compte du tout, l'identifiant n'ouvre rien : seul un jeton le fait.
    const anonyme = await app.inject({ method: 'GET', url: `/api/replays/${id}` });
    expect(anonyme.statusCode).toBe(404);
    await app.close();
  });

  it('partage sur demande, et le partage se referme', async () => {
    const room = await partieEnCours();
    room.close('Alice');
    await drainReplayWrites();
    const app = await server();

    // Rien n'est partagé tant que personne ne l'a demandé.
    expect(db.gameReplay[0]!['shareToken']).toBeFalsy();

    const share = await app.inject({
      method: 'POST',
      url: `/api/rooms/${CODE}/replay/share`,
      headers: { 'x-test-user': BOB },
    });
    const token = share.json().shareToken as string;
    // Le jeton n'est pas le code de table : celui-là est court et sert à rejoindre.
    expect(token.length).toBeGreaterThan(30);
    expect(token).not.toContain(CODE);

    const porteur = await app.inject({ method: 'GET', url: `/api/replays/${token}` });
    expect(porteur.statusCode).toBe(200);

    await app.inject({
      method: 'DELETE',
      url: `/api/rooms/${CODE}/replay/share`,
      headers: { 'x-test-user': BOB },
    });
    const apres = await app.inject({ method: 'GET', url: `/api/replays/${token}` });
    expect(apres.statusCode).toBe(404);
    await app.close();
  });

  it('refuse un jeton inconnu comme une adresse inexistante', async () => {
    const room = await partieEnCours();
    room.close('Alice');
    await drainReplayWrites();
    const app = await server();

    const res = await app.inject({ method: 'GET', url: `/api/replays/${'z'.repeat(43)}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'NOT_FOUND' });
    await app.close();
  });

  it('ne sert que les points de vue de la partie', async () => {
    const room = await partieEnCours();
    room.close('Alice');
    await drainReplayWrites();
    const app = await server();
    const id = replayId();
    const head = { 'x-test-user': ALICE };

    const ok = await app.inject({ method: 'GET', url: `/api/replays/${id}?view=seat_1`, headers: head });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().view).toBe('seat_1');

    // Le siège fictif qui voit tout n'est pas un point de vue qu'on demande :
    // la vue omnisciente s'appelle `ALL`, et rien d'autre n'entre.
    for (const view of ['@omniscient', 'seat_9', '../etc']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/replays/${id}?view=${encodeURIComponent(view)}`,
        headers: head,
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });
});
