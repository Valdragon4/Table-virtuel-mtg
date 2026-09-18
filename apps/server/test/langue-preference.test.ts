/**
 * La langue est une préférence de compte comme les autres.
 *
 * L'utilisateur veut pouvoir changer de langue depuis les paramètres **et**
 * depuis une partie en cours, le second devant modifier le premier. La façon la
 * plus sûre d'obtenir cela est de n'avoir qu'un seul chemin d'écriture : la
 * route PATCH /api/me existante. Ces tests tiennent cette promesse — la langue
 * y est validée comme `uiScale`, et rien ne garde cette route au-delà de
 * « il faut être connecté », donc rien n'empêche de l'appeler depuis la table.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env['DATABASE_URL'] ??= 'postgresql://mtg:mtg@localhost:5432/mtg';
process.env['SESSION_SECRET'] ??= 'secret-de-test-assez-long-pour-passer-la-validation';
process.env['SCRYFALL_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
process.env['ARCHIDEKT_USER_AGENT'] ??= 'mtg-vtt-test/1.0';

const { prefsSchema, userRoutes } = await import('../src/users/routes.js');
const { requireUser } = await import('../src/auth/guard.js');
// La liste fait autorité depuis `@mtg/shared`, d'où le serveur la lit
// désormais. Le test la lit à la même source : il vérifie que la route accepte
// exactement ce que l'interface propose, et non qu'une copie vaut l'autre.
const { LANGUAGES, DEFAULT_LANGUAGE } = await import('@mtg/shared');

describe('préférence de langue', () => {
  it('accepte chaque langue annoncée comme supportée', () => {
    for (const langue of LANGUAGES) {
      const parsed = prefsSchema.safeParse({ language: langue });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.language).toBe(langue);
    }
  });

  it('a le français pour défaut', () => {
    expect(DEFAULT_LANGUAGE).toBe('fr');
    expect(LANGUAGES).toContain('fr');
    expect(LANGUAGES).toContain('en');
  });

  it('refuse une langue que nous ne servons pas', () => {
    // Pas de silence : une langue inconnue doit rendre 400, pas s'enregistrer
    // pour afficher ensuite une interface à moitié traduite.
    expect(prefsSchema.safeParse({ language: 'de' }).success).toBe(false);
    expect(prefsSchema.safeParse({ language: 'FR' }).success).toBe(false);
    expect(prefsSchema.safeParse({ language: '' }).success).toBe(false);
  });

  it('se change en même temps que les autres préférences', () => {
    const parsed = prefsSchema.safeParse({ language: 'en', uiScale: 1.25, autoUntapStep: false });
    expect(parsed.success).toBe(true);
  });
});

/** Fastify de façade : on n'exerce pas le serveur, on inspecte ce qu'il déclare. */
interface RouteDeclaree {
  method: string;
  path: string;
  opts: { preHandler?: unknown };
}

async function declarations(): Promise<RouteDeclaree[]> {
  const routes: RouteDeclaree[] = [];
  const capture =
    (method: string) =>
    (path: string, opts: { preHandler?: unknown }, _handler: unknown): void => {
      routes.push({ method, path, opts });
    };
  const faux = {
    get: capture('GET'),
    post: capture('POST'),
    patch: capture('PATCH'),
    delete: capture('DELETE'),
  } as unknown as FastifyInstance;
  await userRoutes(faux);
  return routes;
}

describe('changer de langue pendant une partie', () => {
  it('passe par la route de préférences, sans canal dédié', async () => {
    const routes = await declarations();
    const patch = routes.find((r) => r.method === 'PATCH' && r.path === '/api/me');
    expect(patch).toBeDefined();

    // Aucune route de langue à part : c'est bien PATCH /api/me qui sert dans les
    // deux cas, donc un changement en partie écrit la préférence du compte.
    expect(routes.filter((r) => r.path.includes('lang'))).toHaveLength(0);
  });

  it("n'est gardée que par l'authentification", async () => {
    const patch = (await declarations()).find((r) => r.method === 'PATCH' && r.path === '/api/me');
    /*
     * Le point à surveiller dans la durée : si quelqu'un ajoutait un jour un
     * garde « pas pendant une partie » ici, la demande de l'utilisateur
     * tomberait en silence. Une seule garde, et c'est `requireUser`.
     */
    expect(patch?.opts.preHandler).toBe(requireUser);
  });
});
