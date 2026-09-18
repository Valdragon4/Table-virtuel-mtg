/**
 * De quoi exercer la console d'administration **pour de vrai** — le serveur
 * Fastify, le hook de session, la garde, les gestionnaires — sans base de
 * données.
 *
 * Pourquoi aller jusque-là plutôt que d'appeler les fonctions à la main : la
 * protection n'est pas dans une fonction, elle est dans le **câblage**. Une
 * garde parfaite qu'on aurait oublié d'accrocher à une route passerait tous les
 * tests unitaires du monde. Ici, la requête entre par `app.inject()` et traverse
 * exactement ce que traverserait une requête réelle.
 *
 * Le faux Prisma rend volontairement des lignes **complètes**, secrets compris,
 * quel que soit le `select` demandé. C'est le scénario que l'on veut couvrir :
 * quelqu'un élargit un jour une requête, et rien en base ne l'arrête. Seule la
 * liste blanche de `publish.ts` doit l'arrêter — et si elle ne le fait pas, le
 * test de fuite le voit.
 */

/** Les variables exigées par `src/env.ts`, posées avant tout import de `src/`. */
export function bootEnv(adminEmails: string): void {
  process.env['DATABASE_URL'] ??= 'postgresql://mtg:mtg@localhost:5432/mtg';
  process.env['SESSION_SECRET'] ??= 'secret-de-test-assez-long-pour-passer-la-validation';
  process.env['SCRYFALL_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
  process.env['ARCHIDEKT_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
  process.env['ADMIN_EMAILS'] = adminEmails;
}

/** L'adresse inscrite dans `ADMIN_EMAILS` pour toute cette campagne de tests. */
export const ADMIN_EMAIL = 'patronne@example.org';
/** Un compte ordinaire, connecté, parfaitement légitime — et sans droit ici. */
export const PLAIN_EMAIL = 'joueur@example.org';
/**
 * Une adresse qui **était** administratrice et ne l'est plus : elle a été
 * retirée de `ADMIN_EMAILS`. Son compte existe toujours, sa session aussi.
 */
export const REMOVED_EMAIL = 'ancienne@example.org';
/** Un administrateur déclaré qui n'a jamais vérifié son email. */
export const UNVERIFIED_ADMIN_EMAIL = 'pasverifiee@example.org';

export const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
export const PLAIN_ID = '22222222-2222-4222-8222-222222222222';
export const REMOVED_ID = '33333333-3333-4333-8333-333333333333';
export const UNVERIFIED_ADMIN_ID = '44444444-4444-4444-8444-444444444444';
/** Un identifiant bien formé qui ne désigne personne. */
export const ABSENT_ID = '55555555-5555-4555-8555-555555555555';

/** Les jetons de session en clair. Le faux Prisma les indexe par leur empreinte. */
export const TOKENS = {
  admin: 'jeton-de-la-patronne',
  plain: 'jeton-du-joueur',
  removed: 'jeton-de-lancienne',
  unverified: 'jeton-non-verifie',
} as const;

interface FakeUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
  _count: { decks: number; seats: number; sessions: number; rooms: number };
}

const NOW = new Date('2026-09-18T10:00:00.000Z');

function user(
  id: string,
  email: string,
  displayName: string,
  verified: boolean,
): FakeUser {
  return {
    id,
    email,
    displayName,
    // Le secret qui ne doit jamais ressortir. Sa valeur est reconnaissable
    // exprès : le test de fuite cherche la **chaîne** autant que la clé.
    passwordHash: '$argon2id$SECRET-QUI-NE-DOIT-JAMAIS-SORTIR',
    emailVerifiedAt: verified ? new Date('2026-01-02T00:00:00.000Z') : null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-09-17T09:00:00.000Z'),
    _count: { decks: 3, seats: 1, sessions: 2, rooms: 1 },
  };
}

export const USERS: FakeUser[] = [
  user(ADMIN_ID, ADMIN_EMAIL, 'Patronne', true),
  user(PLAIN_ID, PLAIN_EMAIL, 'Joueur', true),
  user(REMOVED_ID, REMOVED_EMAIL, 'Ancienne', true),
  user(UNVERIFIED_ADMIN_ID, UNVERIFIED_ADMIN_EMAIL, 'PasVerifiee', false),
];

/** Empreintes SHA-256 des jetons, calculées comme `session.ts` le fait. */
async function sessionIndex(): Promise<Map<string, { userId: string; expiresAt: Date }>> {
  const { createHash } = await import('node:crypto');
  const hash = (t: string): string => createHash('sha256').update(t).digest('hex');
  const far = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  return new Map([
    [hash(TOKENS.admin), { userId: ADMIN_ID, expiresAt: far }],
    [hash(TOKENS.plain), { userId: PLAIN_ID, expiresAt: far }],
    [hash(TOKENS.removed), { userId: REMOVED_ID, expiresAt: far }],
    [hash(TOKENS.unverified), { userId: UNVERIFIED_ADMIN_ID, expiresAt: far }],
  ]);
}

/** Ce que le faux journal a enregistré, pour que les tests l'inspectent. */
export const auditWrites: Array<Record<string, unknown>> = [];
/** Les révocations demandées, sous la forme `userId`. */
export const revoked: string[] = [];

const ROOMS = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    code: 'ABC123',
    gameMode: 'COMMANDER',
    status: 'PLAYING',
    isPrivate: true,
    // Second secret reconnaissable : le mot de passe d'une table privée.
    passwordHash: '$argon2id$MOT-DE-PASSE-DE-TABLE',
    hostUserId: PLAIN_ID,
    createdAt: NOW,
    lastActivityAt: NOW,
    host: { displayName: 'Joueur' },
    _count: { seats: 4 },
  },
];

const SEATS = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    seatIndex: 2,
    joinedAt: NOW,
    userId: PLAIN_ID,
    guestName: null,
    // Troisième secret reconnaissable : la porte vers un deck figé.
    deckSnapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    room: {
      code: 'ABC123',
      status: 'PLAYING',
      gameMode: 'COMMANDER',
      lastActivityAt: NOW,
      passwordHash: '$argon2id$MOT-DE-PASSE-DE-TABLE',
    },
  },
];

type Where = { id?: string } & Record<string, unknown>;

/**
 * Le faux client. Il ne modélise pas Prisma — il répond juste ce qu'il faut aux
 * appels que la console fait réellement, et rend des lignes **entières**.
 */
export const fakePrisma = {
  user: {
    async findUnique({ where }: { where: Where }) {
      return USERS.find((u) => u.id === where.id) ?? null;
    },
    async findMany() {
      return USERS;
    },
    async count() {
      return USERS.length;
    },
  },
  session: {
    async findUnique({ where }: { where: Where }) {
      const index = await sessionIndex();
      const found = where.id ? index.get(where.id) : undefined;
      return found ? { id: where.id!, ...found, userAgent: 'test', ip: '127.0.0.1' } : null;
    },
    async update() {
      return null;
    },
    async delete() {
      return null;
    },
    async deleteMany({ where }: { where: { userId?: string } }) {
      if (where.userId) revoked.push(where.userId);
      return { count: 2 };
    },
    async count() {
      return 7;
    },
  },
  gameRoom: {
    async findMany() {
      return ROOMS;
    },
    async count() {
      return ROOMS.length;
    },
    async findUnique() {
      return ROOMS[0] ?? null;
    },
  },
  gameSeat: {
    async findMany() {
      return SEATS;
    },
    async count() {
      return SEATS.length;
    },
  },
  deck: {
    async count() {
      return 12;
    },
    async findMany() {
      return [{ userId: PLAIN_ID }];
    },
  },
  card: {
    async count() {
      return 99_000;
    },
  },
  cardLocalization: {
    async count() {
      return 4_200;
    },
  },
  localizedPrinting: {
    async count() {
      return 55_000;
    },
  },
  ingestRun: {
    async findFirst() {
      return {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        bulkType: 'default_cards',
        bulkUpdatedAt: new Date('2026-09-17T04:00:00.000Z'),
        startedAt: new Date('2026-09-17T04:05:00.000Z'),
        finishedAt: new Date('2026-09-17T04:20:00.000Z'),
        cardsUpserted: 98_000,
        error: null,
      };
    },
    async count() {
      return 7;
    },
  },
  adminAudit: {
    async create({ data }: { data: Record<string, unknown> }) {
      auditWrites.push(data);
      return { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', createdAt: NOW, ...data };
    },
    async findMany() {
      return auditWrites.map((w, i) => ({
        id: `journal-${i}`,
        createdAt: NOW,
        actorUserId: w['actorUserId'],
        actorEmail: w['actorEmail'],
        action: w['action'],
        targetKind: w['targetKind'],
        targetRef: w['targetRef'],
        detail: w['detail'],
      }));
    },
  },
};
