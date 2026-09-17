/**
 * Recherche de cartes côté serveur : création de tokens, ajout de carte à la
 * volée pendant une partie. Elle tape uniquement la base locale alimentée par
 * le bulk — jamais Scryfall en chemin chaud.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { normalizeName } from '../import/normalize.js';

export interface CardSearchHit {
  scryfallId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  typeLine: string;
  manaCost: string | null;
  colorIdentity: string[];
  imageUris: unknown;
  faces: unknown;
  isToken: boolean;
  power: string | null;
  toughness: string | null;
  /** Sert à distinguer deux jetons de même nom : « Spirit blanc » vs « Spirit rouge-blanc ». */
  colors: string[];
}

const SELECT = Prisma.sql`
  "scryfallId", "name", "setCode", "setName", "collectorNumber", "typeLine",
  "manaCost", "colorIdentity", "colors", "imageUris", "faces", "isToken", "power", "toughness"
`;

export interface SearchOptions {
  query: string;
  tokensOnly?: boolean;
  excludeTokens?: boolean;
  limit?: number;
}

/**
 * Plafond absolu d'une recherche, jetons compris. Une réponse ne porte que des
 * métadonnées et des URLs d'images — jamais d'image —, donc quelques centaines
 * de lignes restent une réponse légère.
 */
export const MAX_SEARCH_LIMIT = 500;

/** Nombre de résultats rendus par défaut à une recherche de carte. */
export const DEFAULT_CARD_LIMIT = 20;

/**
 * Nombre de résultats rendus par défaut à une recherche de **jeton**.
 *
 * C'est le cœur du défaut corrigé ici. Depuis qu'un jeton ne se dédoublonne
 * plus — chaque impression et chaque illustration est un résultat à part —, le
 * nom le plus chargé du jeu, « Spirit », compte une centaine d'impressions.
 * Avec les vingt places d'une recherche de carte, quatre-vingts d'entre elles
 * tombaient hors de la réponse, et l'égalité parfaite de leur classement
 * laissait Postgres choisir lesquelles : le joueur qui cherchait son Esprit 3/2
 * rouge-blanc, ses Insectes de `tdsc` ou son Esprit de `ttdm` se voyait dire
 * qu'ils n'existaient pas, alors qu'ils étaient tous en base.
 *
 * On tient donc la famille de jetons la plus nombreuse en entier, avec de la
 * marge devant elle.
 */
export const DEFAULT_TOKEN_LIMIT = 200;

/**
 * Ce qui distingue vraiment deux jetons sur la table : leur nom, leur ligne de
 * type, leur taille et leurs couleurs. Deux lignes qui partagent tout cela sont
 * le **même** jeton dans deux illustrations ; deux lignes qui en diffèrent sont
 * deux jetons qu'on ne peut pas confondre.
 */
const TOKEN_VARIANT = Prisma.sql`"normalizedName", "typeLine", "power", "toughness", "colors"`;

/**
 * Recherche floue par trigrammes, avec les correspondances de préfixe d'abord.
 *
 * **Une carte n'est pas un jeton, et le dédoublonnage ne peut pas être le
 * même.** Pour une carte, un nom désigne une seule carte : n'en garder que la
 * meilleure impression est exactement ce qu'on veut. Pour un jeton, le nom ne
 * désigne rien — il existe seize « Spirit » différents, du 1/1 blanc au 3/2
 * rouge-blanc, et les réduire à un seul revenait à dire au joueur que son
 * jeton n'existe pas. Il était pourtant bien en base, avec ses quatre
 * impressions ; la recherche ne le montrait simplement jamais.
 *
 * Un jeton est donc identifié par ce qui le distingue vraiment sur la table :
 * son nom, sa ligne de type, sa force, son endurance et ses couleurs.
 */
export async function searchCards(options: SearchOptions): Promise<CardSearchHit[]> {
  const sql = buildSearchSql(options);
  if (!sql) return [];
  return prisma.$queryRaw<CardSearchHit[]>(sql);
}

/**
 * Construit la requête, séparément de son exécution : c'est la seule façon d'en
 * tester la forme sans base de données sous la main.
 */
export function buildSearchSql(options: SearchOptions): Prisma.Sql | null {
  const q = normalizeName(options.query);
  if (q.length < 2) return null;

  const fallback = options.tokensOnly ? DEFAULT_TOKEN_LIMIT : DEFAULT_CARD_LIMIT;
  const limit = Math.min(options.limit ?? fallback, MAX_SEARCH_LIMIT);
  const tokenFilter = options.tokensOnly
    ? Prisma.sql`AND "isToken" = true`
    : options.excludeTokens
      ? Prisma.sql`AND "isToken" = false`
      : Prisma.empty;

  /*
   * La langue, troisième règle qui faisait disparaître des jetons.
   *
   * Le bulk `default_cards` ne porte qu'**une** ligne par impression : l'anglaise
   * quand elle existe, sinon celle de la seule langue où la carte est parue.
   * Exiger l'anglais n'écarte donc aucun doublon côté jeton — cela écarte les
   * trente-cinq impressions japonaises qui n'existent qu'en japonais, dont
   * l'Esprit 3/2 rouge-blanc de `wmom`. Et le nom reste cherchable : Scryfall
   * garde le nom anglais dans `name`, la version imprimée vivant à part.
   *
   * Pour une carte, en revanche, le filtre reste utile : il garde la recherche
   * sur un vocabulaire unique.
   */
  const langFilter = options.tokensOnly ? Prisma.empty : Prisma.sql`AND "lang" = 'en'`;

  /*
   * **Un jeton ne se dédoublonne pas du tout.**
   *
   * Pour une carte, un nom désigne une seule carte : n'en garder que la
   * meilleure impression est exactement ce qu'on veut. Pour un jeton, non
   * seulement le nom ne désigne rien — il existe seize « Spirit » différents —
   * mais deux jetons identiques au texte près n'ont **pas la même
   * illustration**, et c'est souvent sur elle qu'on choisit. Trois « Insect
   * 1/1 vert » de la même extension sont trois dessins : les réduire à un
   * revenait à dire au joueur que les deux autres n'existent pas.
   *
   * On rend donc chaque impression. C'est ce que montrent les sites de deck :
   * une grille d'illustrations, dans laquelle on prend celle qu'on veut.
   */
  const identity = options.tokensOnly
    ? Prisma.sql`"scryfallId"`
    : Prisma.sql`"normalizedName", "isToken"`;

  /*
   * Un jeton se cherche aussi par sa taille : « spirit 3/2 » est la façon dont
   * on le nomme à voix haute à une table. La force et l'endurance entrent donc
   * dans le texte interrogé, pour les jetons seulement — une carte ne se
   * cherche pas ainsi.
   */
  const haystack = options.tokensOnly
    ? Prisma.sql`("normalizedName" || ' ' || coalesce("power", '') || '/' || coalesce("toughness", ''))`
    : Prisma.sql`"normalizedName"`;

  /*
   * Rang de l'impression **au sein de son jeton**. Il ne retire rien : il sert
   * uniquement à ordonner. Si la réponse doit un jour être coupée, elle rend
   * d'abord une illustration de chaque jeton distinct, puis la deuxième de
   * chacun, et ainsi de suite. Aucun jeton ne peut donc disparaître entièrement
   * derrière les quarante illustrations d'un autre — ce qui est exactement ce
   * qui arrivait aux Insectes de `tdsc`.
   */
  const variantRank = options.tokensOnly
    ? Prisma.sql`ROW_NUMBER() OVER (
               PARTITION BY ${TOKEN_VARIANT}
               ORDER BY "printingScore" DESC, "releasedAt" DESC NULLS LAST, "scryfallId" ASC
             )`
    : Prisma.sql`1`;

  return Prisma.sql`
    SELECT ${SELECT}
    FROM (
      SELECT ${SELECT},
             ROW_NUMBER() OVER (
               PARTITION BY ${identity}
               ORDER BY "printingScore" DESC, "releasedAt" DESC NULLS LAST
             ) AS rn,
             ${variantRank} AS variant_rank,
             -- Le classement porte sur le **même** texte que la recherche :
             -- sans cela « spirit 3/2 » trouvait bien le 3/2, mais le rangeait
             -- derrière une douzaine d'autres Spirit, ce qui revenait à ne pas
             -- l'avoir trouvé.
             similarity(${haystack}, ${q}) AS sim,
             (${haystack} LIKE ${q + '%'}) AS prefix,
             (${haystack} LIKE ${'%' + q + '%'}) AS contains
      FROM "Card"
      WHERE (${haystack} % ${q} OR ${haystack} LIKE ${'%' + q + '%'})
        ${langFilter}
        ${tokenFilter}
    ) ranked
    WHERE rn = 1
    -- Les deux dernières clés ne changent rien au classement voulu : elles le
    -- rendent déterministe. Sans elles, une centaine de « Spirit » strictement
    -- à égalité laissaient Postgres rendre l'ordre qui l'arrangeait, et deux
    -- recherches identiques ne donnaient pas la même page.
    ORDER BY contains DESC, prefix DESC, variant_rank ASC, sim DESC, "name" ASC,
             "power" ASC NULLS FIRST, "toughness" ASC NULLS FIRST,
             "setCode" ASC, "collectorNumber" ASC
    LIMIT ${limit}
  `;
}

/** Impression exacte par code d'édition et numéro de collection. */
export async function findPrinting(setCode: string, collectorNumber: string) {
  return prisma.card.findFirst({
    where: {
      setCode: setCode.toLowerCase(),
      collectorNumber: { equals: collectorNumber, mode: 'insensitive' },
    },
  });
}
