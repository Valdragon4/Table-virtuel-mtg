/**
 * « Les dernières actions » — ce que la base sait réellement dire de ce qui
 * vient de se passer, et ce qu'elle ne sait pas dire.
 *
 * ——— Ce que ce fil n'est pas
 *
 * Ce n'est **pas** le journal d'une partie. Les actions de jeu ne sont pas
 * persistées : le modèle `GameLog` existe au schéma mais **personne ne l'écrit**
 * (vérifié : aucun `prisma.gameLog.create` dans le serveur), et le journal d'une
 * table vit en mémoire dans la room. Une console ne peut donc pas les montrer
 * sans un chantier de persistance — qui aurait de toute façon à répondre d'abord
 * à la règle §3 de `docs/admin.md` : le journal d'une partie contient des cartes
 * et des zones, c'est-à-dire exactement ce qui n'a pas le droit de traverser
 * cette console.
 *
 * Ce fil répond à la question qu'on se pose vraiment en ouvrant un tableau de
 * bord : **que s'est-il passé sur cette instance récemment ?** Il agrège six
 * sources, toutes déjà en base, toutes datées, toutes faites de métadonnées.
 *
 * ——— Ce qui y est, et pourquoi
 *
 *  - `AdminAudit`      → ce que l'administrateur a fait. Le seul vrai journal.
 *  - `User.createdAt`  → un compte est né.
 *  - `Session.createdAt` → quelqu'un s'est connecté. On publie **quand**, jamais
 *    l'identifiant de session (qui est l'empreinte du jeton), ni l'IP, ni le
 *    navigateur : exploiter la plateforme ne demande pas de savoir où les gens
 *    habitent.
 *  - `GameRoom.createdAt` → une table a été ouverte.
 *  - `GameSeat.joinedAt` → quelqu'un s'est assis.
 *  - `IngestRun.startedAt` → le catalogue a été mis à jour, ou a échoué.
 *
 * ——— Ce qui n'y est pas, et pourquoi
 *
 * **La clôture d'une table.** Il n'existe **aucune colonne** qui la date.
 * `POST /api/rooms/:code/close` écrit `status: 'ENDED'` et rien d'autre, et le
 * ménage automatique fait pareil ; `lastActivityAt` n'est pas touché par l'un ni
 * par l'autre, donc il date la dernière action *de jeu*, pas le rangement. La
 * mettre dans un fil chronologique reviendrait à afficher un événement à une
 * heure qui n'est pas la sienne — un tableau de bord qui ment est pire qu'un
 * tableau de bord incomplet. Cela demanderait une colonne `closedAt` posée par
 * `rooms/routes.ts` et par `game/registry.ts` : une écriture dans un chemin de
 * jeu, donc une décision qui n'est pas prise ici.
 *
 * **Les départs de table et les suppressions de compte.** Ce sont des `delete`
 * en base : la ligne partie, sa date part avec elle. Même remarque.
 *
 * ——— Le coût, qui est la vraie contrainte
 *
 * Six requêtes, **une par source**, toutes de la forme `ORDER BY <date> DESC
 * LIMIT take`, toutes servies par un index sur la colonne de tri (ajoutés au
 * schéma pour celles qui n'en avaient pas). Aucun `count`, aucun `skip`, aucune
 * jointure au-delà du pseudo de l'auteur.
 *
 * Le fil rapatrie donc au pire `6 × take` lignes, les fusionne en mémoire et
 * n'en garde que `take`. Avec le plafond `take ≤ 50`, c'est **300 lignes
 * lues au maximum, quelle que soit la taille de la base** — et ce nombre ne
 * bouge plus jamais. C'est le point important : le coût est borné par la
 * demande, pas par les données.
 */
import { prisma } from '../db.js';
import { activityEntry, type PublishedActivity } from './publish.js';

/**
 * Le plafond dur. Il est ici et pas seulement dans le schéma zod pour que la
 * borne du coût soit lisible à côté du calcul qui la consomme.
 */
export const ACTIVITY_MAX = 50;

/** Une seule ligne d'invité ou de compte : le pseudo, jamais l'identifiant. */
function nom(user: { displayName: string } | null | undefined): string | null {
  return user?.displayName ?? null;
}

export async function activity(take: number): Promise<PublishedActivity[]> {
  const limite = Math.min(Math.max(take, 1), ACTIVITY_MAX);

  const [comptes, sessions, tables, sieges, ingestions, journal] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: { displayName: true, createdAt: true },
    }),
    prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
      take: limite,
      // Ni `id` (l'empreinte du jeton), ni `ip`, ni `userAgent`. Le `select` est
      // la première barrière : le secret n'est même pas chargé en mémoire.
      select: { createdAt: true, user: { select: { displayName: true } } },
    }),
    prisma.gameRoom.findMany({
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        code: true,
        gameMode: true,
        createdAt: true,
        host: { select: { displayName: true } },
      },
    }),
    prisma.gameSeat.findMany({
      orderBy: { joinedAt: 'desc' },
      take: limite,
      // Ni `deckSnapshotId`, ni `id`. Un siège se désigne ici par sa table.
      select: {
        joinedAt: true,
        guestName: true,
        user: { select: { displayName: true } },
        room: { select: { code: true } },
      },
    }),
    prisma.ingestRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limite,
      select: { bulkType: true, startedAt: true, finishedAt: true, error: true },
    }),
    prisma.adminAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        createdAt: true,
        actorEmail: true,
        action: true,
        targetKind: true,
        targetRef: true,
      },
    }),
  ]);

  const entrees: PublishedActivity[] = [];

  comptes.forEach((row, i) => {
    entrees.push(activityEntry('ACCOUNT_CREATED', row.createdAt, { who: row.displayName }, i));
  });

  sessions.forEach((row, i) => {
    entrees.push(activityEntry('SESSION_OPENED', row.createdAt, { who: nom(row.user) }, i));
  });

  tables.forEach((row, i) => {
    entrees.push(
      activityEntry(
        'TABLE_OPENED',
        row.createdAt,
        { who: nom(row.host), ref: row.code, note: row.gameMode },
        i,
      ),
    );
  });

  sieges.forEach((row, i) => {
    // Un invité n'a pas de compte : son nom de table est la seule chose qui
    // permette de le reconnaître, et il est déjà visible de tous à la table.
    entrees.push(
      activityEntry(
        'SEAT_JOINED',
        row.joinedAt,
        { who: nom(row.user) ?? row.guestName ?? null, ref: row.room?.code ?? null },
        i,
      ),
    );
  });

  ingestions.forEach((row, i) => {
    // Les trois mêmes états que la vue d'ensemble, et pour la même raison : une
    // ingestion bloquée n'est pas une ingestion réussie.
    const issue = row.error !== null ? 'failed' : row.finishedAt === null ? 'running' : 'ok';
    entrees.push(
      activityEntry('INGEST_RUN', row.startedAt, { ref: row.bulkType, note: issue }, i),
    );
  });

  journal.forEach((row, i) => {
    entrees.push(
      activityEntry(
        'ADMIN_ACTION',
        row.createdAt,
        {
          who: row.actorEmail,
          ref: `${row.targetKind} ${row.targetRef}`,
          note: row.action,
        },
        i,
      ),
    );
  });

  // Le tri se fait sur `at`, qui est une date ISO en UTC : l'ordre
  // lexicographique y est l'ordre chronologique, il n'y a donc pas de `Date` à
  // reconstruire pour comparer 300 lignes.
  entrees.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return entrees.slice(0, limite);
}
