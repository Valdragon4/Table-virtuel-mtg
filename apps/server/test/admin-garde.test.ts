/**
 * Le refus, autant que le fonctionnement.
 *
 * Ce fichier existe parce que « le tout protégé » est la partie difficile de la
 * console, et parce qu'une protection ne se démontre pas en montrant qu'elle
 * laisse passer le bon. Trois profils doivent être refusés sur **chaque** route :
 * le visiteur, le compte connecté ordinaire, et l'adresse retirée de
 * `ADMIN_EMAILS`. Un quatrième s'y ajoute, moins évident et plus intéressant :
 * l'adresse inscrite dans la liste dont le compte n'a **pas vérifié son email**,
 * qui est le chemin par lequel on volerait des droits en s'inscrivant le premier.
 *
 * La liste des routes n'est pas recopiée à la main : elle est **capturée** à
 * l'enregistrement. Une route ajoutée demain entre donc d'elle-même dans les
 * quatre scénarios de refus, et il n'existe pas de façon d'en écrire une qui
 * échappe à ce fichier sans le modifier.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ABSENT_ID,
  ADMIN_EMAIL,
  ADMIN_ID,
  PLAIN_ID,
  TOKENS,
  UNVERIFIED_ADMIN_EMAIL,
  auditWrites,
  bootEnv,
  revoked,
} from './admin-fixture.js';

// La liste ne contient **pas** `REMOVED_EMAIL` : c'est tout l'objet du scénario
// « retirée de la liste ». Elle contient en revanche l'adresse non vérifiée.
bootEnv(`${ADMIN_EMAIL}, ${UNVERIFIED_ADMIN_EMAIL}`);

vi.mock('../src/db.js', async () => {
  const { fakePrisma } = await import('./admin-fixture.js');
  return { prisma: fakePrisma, disconnect: async (): Promise<void> => undefined };
});

const { adminRoutes } = await import('../src/admin/routes.js');
const { requireAdmin, ADMIN_DENIED } = await import('../src/admin/guard.js');
const { buildApp } = await import('../src/app.js');

/* — Les routes, telles qu'elles sont déclarées ———————————————— */

interface Declaree {
  method: 'GET' | 'POST';
  path: string;
  preHandler: unknown;
}

async function declarations(): Promise<Declaree[]> {
  const routes: Declaree[] = [];
  const capture =
    (method: 'GET' | 'POST') =>
    (path: string, opts: { preHandler?: unknown }, _handler: unknown): void => {
      routes.push({ method, path, preHandler: opts?.preHandler });
    };
  const faux = {
    get: capture('GET'),
    post: capture('POST'),
    decorateRequest: (): void => undefined,
  } as unknown as FastifyInstance;
  await adminRoutes(faux);
  return routes;
}

/** Le chemin concret à injecter : les paramètres reçoivent une valeur plausible. */
function concrete(path: string): string {
  return path.replace(':id', ABSENT_ID);
}

let app: FastifyInstance;
let routes: Declaree[];

beforeAll(async () => {
  routes = await declarations();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('la garde est sur chaque route', () => {
  it('déclare au moins toute la surface attendue', () => {
    const paths = routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /api/admin/overview');
    expect(paths).toContain('GET /api/admin/users');
    expect(paths).toContain('GET /api/admin/users/:id');
    expect(paths).toContain('GET /api/admin/rooms');
    expect(paths).toContain('GET /api/admin/audit');
    expect(paths).toContain('GET /api/admin/activity');
    expect(paths).toContain('POST /api/admin/users/:id/revoke-sessions');
  });

  it("n'expose aucune route hors de /api/admin/", () => {
    // Une route d'administration posée ailleurs échapperait à la lecture de
    // quiconque relit ce module en cherchant la surface protégée.
    for (const route of routes) expect(route.path.startsWith('/api/admin/')).toBe(true);
  });

  it('porte `requireAdmin` sur toutes, sans exception', () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.preHandler, `${route.method} ${route.path} n'est pas gardée`).toBe(requireAdmin);
    }
  });
});

/* — Les quatre refus ——————————————————————————————————————— */

const REFUSES = [
  { nom: 'un visiteur sans session', cookie: undefined },
  { nom: 'un compte connecté ordinaire', cookie: TOKENS.plain },
  { nom: 'une adresse retirée de ADMIN_EMAILS', cookie: TOKENS.removed },
  { nom: 'une adresse déclarée mais non vérifiée', cookie: TOKENS.unverified },
] as const;

describe.each(REFUSES)('refus : $nom', ({ cookie }) => {
  it('sur chaque route, avec la même réponse qu’une URL inexistante', async () => {
    // Le point de comparaison : ce que rend le serveur sur un chemin d'API qui
    // n'existe pas. Si les refus lui ressemblent octet pour octet, sonder
    // `/api/admin/*` n'apprend rien.
    const temoin = await app.inject({ method: 'GET', url: '/api/il-ny-a-rien-ici' });
    expect(temoin.statusCode).toBe(404);

    for (const route of routes) {
      const res = await app.inject({
        method: route.method,
        url: concrete(route.path),
        ...(cookie ? { cookies: { mtg_session: cookie } } : {}),
      });
      const ou = `${route.method} ${route.path}`;
      expect(res.statusCode, ou).toBe(404);
      expect(res.body, ou).toBe(temoin.body);
      expect(res.json(), ou).toEqual(ADMIN_DENIED);
    }
  });

  it("n'exécute aucune action : rien n'est révoqué, rien n'est journalisé", async () => {
    revoked.length = 0;
    auditWrites.length = 0;
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${PLAIN_ID}/revoke-sessions`,
      ...(cookie ? { cookies: { mtg_session: cookie } } : {}),
    });
    expect(revoked).toEqual([]);
    expect(auditWrites).toEqual([]);
  });
});

/* — Et le fonctionnement, pour que le refus veuille dire quelque chose ——— */

describe('un administrateur vérifié', () => {
  const cookies = { mtg_session: TOKENS.admin };

  it('lit la vue d’ensemble', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/overview', cookies });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accounts: { total: number }; health: { ok: boolean } };
    expect(body.health.ok).toBe(true);
    expect(body.accounts.total).toBeGreaterThan(0);
  });

  it('liste les comptes et les tables', async () => {
    const users = await app.inject({ method: 'GET', url: '/api/admin/users', cookies });
    expect(users.statusCode).toBe(200);
    expect((users.json() as { users: unknown[] }).users.length).toBeGreaterThan(0);

    const rooms = await app.inject({ method: 'GET', url: '/api/admin/rooms', cookies });
    expect(rooms.statusCode).toBe(200);
    expect((rooms.json() as { rooms: unknown[] }).rooms.length).toBeGreaterThan(0);
  });

  it('lit le fil des dernières actions, toutes sources mêlées et trié par date', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/activity', cookies });
    expect(res.statusCode).toBe(200);
    const { entries } = res.json() as { entries: Array<{ at: string; kind: string }> };
    expect(entries.length).toBeGreaterThan(0);

    // Plusieurs sources, sinon ce n'est pas un fil : c'est une liste.
    expect(new Set(entries.map((e) => e.kind)).size).toBeGreaterThan(1);

    // Strictement décroissant au sens large : le tri est la seule chose qui
    // donne un sens à la fusion de six requêtes indépendantes.
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i - 1]!.at >= entries[i]!.at, `ligne ${i}`).toBe(true);
    }
  });

  it('plafonne le fil : on ne rapatrie jamais la base par ce chemin', async () => {
    const trop = await app.inject({
      method: 'GET',
      url: '/api/admin/activity?take=500',
      cookies,
    });
    // Le plafond n'est pas un conseil : au-delà, la requête est refusée plutôt
    // que silencieusement rabotée.
    expect(trop.statusCode).toBe(400);

    const un = await app.inject({ method: 'GET', url: '/api/admin/activity?take=1', cookies });
    expect(un.statusCode).toBe(200);
    expect((un.json() as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('voit qui est administrateur, calculé et non stocké', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', cookies });
    const { users } = res.json() as { users: Array<{ id: string; isAdmin: boolean }> };
    expect(users.find((u) => u.id === ADMIN_ID)?.isAdmin).toBe(true);
    expect(users.find((u) => u.id === PLAIN_ID)?.isAdmin).toBe(false);
  });
});

describe('révoquer les sessions d’un compte', () => {
  const cookies = { mtg_session: TOKENS.admin };

  it('agit et se journalise', async () => {
    revoked.length = 0;
    auditWrites.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${PLAIN_ID}/revoke-sessions`,
      cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, revoked: 2, logged: true });
    expect(revoked).toEqual([PLAIN_ID]);

    expect(auditWrites).toHaveLength(1);
    expect(auditWrites[0]).toMatchObject({
      actorUserId: ADMIN_ID,
      actorEmail: ADMIN_EMAIL,
      action: 'REVOKE_SESSIONS',
      targetKind: 'USER',
      targetRef: PLAIN_ID,
    });
  });

  it('refuse de s’appliquer à soi-même', async () => {
    revoked.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${ADMIN_ID}/revoke-sessions`,
      cookies,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('SELF_TARGET');
    // Et surtout : rien n'a été fait avant de répondre.
    expect(revoked).toEqual([]);
  });
});

describe('aucune route ne promeut ni ne dégrade', () => {
  it("n'existe simplement pas", () => {
    const suspectes = routes.filter((r) =>
      /admin|role|promote|grant|revoke-admin/i.test(r.path.replace('/api/admin/', '')),
    );
    // La console n'écrit jamais un droit : `ADMIN_EMAILS` est la seule source, et
    // elle n'est pas joignable depuis l'application. L'escalade est fermée par
    // construction, et ce test est là pour que ça le reste.
    expect(suspectes).toEqual([]);
  });
});
