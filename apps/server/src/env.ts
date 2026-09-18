import { z } from 'zod';

const bool = z
  .string()
  .transform((v) => v.toLowerCase() === 'true' || v === '1')
  .pipe(z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET doit faire au moins 32 caractères'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool.default('false'),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('no-reply@localhost'),

  /**
   * Les adresses qui ouvrent la console d'administration, séparées par des
   * virgules. Vide par défaut : **aucun** administrateur, donc aucune surface
   * exposée tant qu'un opérateur n'a rien décidé.
   *
   * C'est volontairement une variable d'environnement et non une colonne de la
   * base : le `.env` vit sur le serveur, n'est jamais transféré par le
   * déploiement, et porte déjà le secret de session et l'accès à la base. Aucune
   * écriture applicative ne peut donc promouvoir qui que ce soit — l'escalade de
   * privilège est fermée par construction, pas par vigilance. Voir docs/admin.md.
   */
  ADMIN_EMAILS: z.string().default(''),

  SCRYFALL_USER_AGENT: z.string().min(5),
  INGEST_ON_BOOT: bool.default('true'),
  INGEST_CRON_HOUR: z.coerce.number().int().min(0).max(23).default(4),

  ARCHIDEKT_USER_AGENT: z.string().min(5),
  ARCHIDEKT_RATE_PER_MIN: z.coerce.number().int().min(1).max(60).default(30),
  ARCHIDEKT_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).default(900),

  MOXFIELD_API_ENABLED: bool.default('false'),
  MOXFIELD_USER_AGENT: z.string().optional(),
  MOXFIELD_API_TOKEN: z.string().optional(),
  // Nettement plus conservateur qu'Archidekt : Moxfield ne publie aucune limite,
  // et notre accès est une faveur nominative (docs/moxfield.md §3.1).
  MOXFIELD_RATE_PER_MIN: z.coerce.number().int().min(1).max(30).default(6),
  MOXFIELD_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide (voir .env.example) :\n${details}`);
  }
  const env = parsed.data;

  // Le chemin API Moxfield n'est utilisable que si un opérateur a obtenu un
  // User-Agent autorisé auprès de leur support. Sans lui, on reste sur le collage.
  if (env.MOXFIELD_API_ENABLED && !env.MOXFIELD_USER_AGENT) {
    throw new Error(
      'MOXFIELD_API_ENABLED=true exige MOXFIELD_USER_AGENT, obtenu auprès du support Moxfield.',
    );
  }
  return env;
}

export type Env = z.infer<typeof schema>;
export const env: Env = load();
export const isProd = env.NODE_ENV === 'production';
