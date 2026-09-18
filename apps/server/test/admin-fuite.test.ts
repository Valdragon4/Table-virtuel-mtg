/**
 * Ce test doit échouer le jour où quelqu'un élargit une requête.
 *
 * C'est sa raison d'être, et elle dicte sa forme. Le faux Prisma de
 * `admin-fixture.ts` ignore les `select` et rend des lignes **entières** :
 * `passwordHash`, l'empreinte d'un mot de passe de table, un `deckSnapshotId`.
 * Autrement dit, il simule en permanence la base telle qu'elle serait si le
 * `select` avait déjà été élargi. La seule chose qui empêche alors ces valeurs
 * de sortir est la liste blanche de `publish.ts` — et c'est exactement ce qu'on
 * vérifie ici, sur les **corps de réponse réels**.
 *
 * Deux filets, volontairement redondants :
 *
 *  1. L'ensemble **exact** des clés produites par chaque fonction de publication.
 *     Ajouter un champ sans le déclarer casse le test ; le déclarer oblige à le
 *     regarder en face.
 *  2. Un balayage récursif de chaque réponse, par nom de clé **et** par valeur.
 *     Le second attrape ce que le premier laisserait passer : une route écrite
 *     plus tard qui ne passerait pas par `publish.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_EMAIL, PLAIN_ID, TOKENS, bootEnv } from './admin-fixture.js';

bootEnv(ADMIN_EMAIL);

vi.mock('../src/db.js', async () => {
  const { fakePrisma } = await import('./admin-fixture.js');
  return { prisma: fakePrisma, disconnect: async (): Promise<void> => undefined };
});

const publish = await import('../src/admin/publish.js');
const { buildApp } = await import('../src/app.js');

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

/* — Filet 1 : l'ensemble exact des clés ————————————————————— */

/** Une ligne Prisma complète, secrets compris, comme la base la rendrait. */
const LIGNE_COMPLETE = {
  id: PLAIN_ID,
  email: 'joueur@example.org',
  displayName: 'Joueur',
  passwordHash: '$argon2id$SECRET-QUI-NE-DOIT-JAMAIS-SORTIR',
  emailVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  lastSeenAt: new Date('2026-09-17T09:00:00.000Z'),
  _count: { decks: 3, seats: 1, sessions: 2, rooms: 1 },
};

describe('liste blanche des champs publiés', () => {
  it('un compte ne publie que ses onze champs, et pas un de plus', () => {
    const publie = publish.publishUser(LIGNE_COMPLETE, () => false);
    expect(Object.keys(publie).sort()).toEqual([...publish.PUBLISHED_USER_KEYS].sort());
    expect(JSON.stringify(publie)).not.toContain('SECRET-QUI-NE-DOIT-JAMAIS-SORTIR');
  });

  it('une table publie l’existence d’un mot de passe, jamais son empreinte', () => {
    const publie = publish.publishRoom({
      code: 'ABC123',
      gameMode: 'COMMANDER',
      status: 'PLAYING',
      isPrivate: true,
      passwordHash: '$argon2id$MOT-DE-PASSE-DE-TABLE',
      createdAt: new Date(),
      lastActivityAt: new Date(),
      host: { displayName: 'Joueur' },
      _count: { seats: 4 },
    });
    expect(Object.keys(publie).sort()).toEqual([...publish.PUBLISHED_ROOM_KEYS].sort());
    expect(publie.hasPassword).toBe(true);
    expect(JSON.stringify(publie)).not.toContain('MOT-DE-PASSE-DE-TABLE');
  });

  it('un siège publie son index, jamais son deck figé', () => {
    const publie = publish.publishSeat({
      seatIndex: 2,
      joinedAt: new Date(),
      room: {
        code: 'ABC123',
        status: 'PLAYING',
        gameMode: 'COMMANDER',
        lastActivityAt: new Date(),
      },
    });
    expect(Object.keys(publie).sort()).toEqual([...publish.PUBLISHED_SEAT_KEYS].sort());
  });

  it('une ingestion publie son issue et son âge, rien de plus', () => {
    const publie = publish.publishIngest({
      bulkType: 'default_cards',
      bulkUpdatedAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
      cardsUpserted: 0,
      error: null,
    });
    expect(Object.keys(publie).sort()).toEqual([...publish.PUBLISHED_INGEST_KEYS].sort());
    // Ni réussie ni échouée : toujours en cours. Ces trois cas sont distincts, et
    // les confondre ferait passer une ingestion bloquée pour une réussite.
    expect(publie.outcome).toBe('running');
  });
});

/* — Filet 2 : balayage des réponses réelles ————————————————— */

/** Tous les noms de clés d'une valeur JSON, à toute profondeur. */
function toutesLesCles(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) toutesLesCles(v, acc);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k);
      toutesLesCles(v, acc);
    }
  }
  return acc;
}

/**
 * Les valeurs qui ne doivent apparaître dans aucune réponse, quelle que soit la
 * clé sous laquelle quelqu'un aurait pu les glisser.
 */
const VALEURS_INTERDITES = [
  'SECRET-QUI-NE-DOIT-JAMAIS-SORTIR',
  'MOT-DE-PASSE-DE-TABLE',
  // L'identifiant du deck figé du faux jeu de données : la porte d'entrée vers
  // le contenu d'une bibliothèque.
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
];

const SURFACE = [
  { method: 'GET' as const, url: '/api/admin/overview' },
  { method: 'GET' as const, url: '/api/admin/users' },
  { method: 'GET' as const, url: `/api/admin/users/${PLAIN_ID}` },
  { method: 'GET' as const, url: '/api/admin/rooms' },
  { method: 'GET' as const, url: '/api/admin/audit' },
];

describe('aucune réponse ne laisse sortir un secret', () => {
  it.each(SURFACE)('$method $url', async ({ method, url }) => {
    const res = await app.inject({ method, url, cookies: { mtg_session: TOKENS.admin } });
    expect(res.statusCode).toBe(200);

    for (const interdit of publish.FORBIDDEN_FIELDS) {
      expect(toutesLesCles(res.json()), `clé « ${interdit} »`).not.toContain(interdit);
    }
    for (const valeur of VALEURS_INTERDITES) {
      expect(res.body, `valeur « ${valeur} »`).not.toContain(valeur);
    }
  });
});

describe('aucune information cachée de partie ne traverse la console', () => {
  it('ne publie ni zone, ni carte, ni identifiant d’objet de partie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/rooms',
      cookies: { mtg_session: TOKENS.admin },
    });
    const cles = new Set(toutesLesCles(res.json()));
    // Le vocabulaire du moteur, mot par mot : s'il apparaissait ici, c'est que
    // quelqu'un aurait ouvert une room pour la regarder.
    for (const mot of ['zones', 'cards', 'cardId', 'hand', 'library', 'graveyard', 'seatsState']) {
      expect(cles, mot).not.toContain(mot);
    }
    // La table ne se désigne que par son code : pas d'identifiant interne, donc
    // rien qui serve de clé vers `GameLog` ou `DeckSnapshot`.
    expect(cles).not.toContain('id');
    expect(cles).toContain('code');
  });
});
