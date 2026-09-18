/**
 * Le catalogue des impressions traduites, adossé à Postgres.
 *
 * ——— Ce que ce fichier remplace
 *
 * Afficher une carte en français coûtait jusqu'ici **deux appels réseau par
 * carte** : `GET /cards/{set}/{cn}/{lang}` pour l'impression traduite, puis
 * `GET /cards/search?q=oracleid:… lang:…` pour ses sœurs quand il fallait en
 * substituer une. Au rythme imposé de 100 ms par appel, et avec un 429 au bout
 * d'une vingtaine de recherches consécutives, un deck neuf mettait des dizaines
 * de secondes à devenir français — par vagues, et pas toujours en entier.
 *
 * Les deux appels deviennent ici **une jointure**, faite une fois pour tout un
 * lot. Le plafond par requête, l'état `pending`, les relances du client et le
 * balayage de rattrapage n'ont plus d'objet sur les cartes que le bulk connaît.
 *
 * ——— Ce qu'il ne change pas, et c'est délibéré
 *
 * La **règle de choix** d'une impression de substitution ne vit pas ici. Elle
 * reste `chooseSubstitute()` / `elsewhereFromCandidates()` dans
 * `localization.ts`, et ce module ne fait que lui présenter les mêmes
 * candidates, venues d'ailleurs. Réécrire le classement en SQL aurait produit un
 * second barème, et la première divergence se serait vue sur une carte que
 * personne ne regarde.
 *
 * ——— L'invariant de droits
 *
 * Comme `localization-store.ts`, ce fichier est court exprès : on doit pouvoir
 * vérifier en le lisant que ce qui sort de la base se limite à des **URL** et à
 * des **noms**. Aucun texte de règles n'y entre — le filtrage a lieu à
 * l'ingestion (`ingest.ts`), et la table n'a tout simplement pas de colonne où
 * en mettre.
 */
import { SCRYFALL_LANG, type Language } from '@mtg/shared';
import { prisma } from '../db.js';
import type { ScryfallCard, ScryfallCardFace, ScryfallImageUris } from './scryfall.js';
import type { BulkAnswer, BulkLocalizationSource, CatalogCard } from './localization.js';

/**
 * Le bulk Scryfall qui porte **toutes les langues**.
 *
 * `default_cards` — celui du catalogue anglais — ne contient qu'une impression
 * par carte, en anglais ou dans sa langue d'origine si elle est unilingue. Les
 * impressions traduites n'y sont pas du tout : c'est `all_cards`, et lui seul,
 * qui les publie.
 */
export const LOCALIZED_BULK_TYPE = 'all_cards';

/** Ce que la table rend, et rien de plus. */
interface PrintingRow {
  scryfallId: string;
  oracleId: string | null;
  language: string;
  setCode: string;
  collectorNumber: string;
  printedName: string;
  imageUris: unknown;
  faces: unknown;
  imageStatus: string | null;
  highresImage: boolean;
  illustrationIds: unknown;
  frame: string | null;
  frameEffects: unknown;
  borderColor: string | null;
  isFullArt: boolean;
  isTextless: boolean | null;
  setType: string | null;
  releasedAt: Date | null;
  isDigital: boolean;
  isPromo: boolean;
  isVariation: boolean;
  isPaper: boolean;
}

/** Une face telle que `localizedFaces()` l'a écrite à l'ingestion. */
interface FaceRow {
  name?: string;
  typeLine?: string | null;
  manaCost?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  imageUris?: ScryfallImageUris | null;
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Une ligne de la table, rendue sous la forme d'un objet carte Scryfall.
 *
 * **Pourquoi reconstituer la forme d'origine plutôt qu'adapter les appelants.**
 * `chooseSubstitute`, `printingScore`, `toSubstitute`, `localizedFaces` et
 * `printedNameOf` sont ce qui décide de ce qui sera écrit en base. Leur donner
 * à manger exactement ce que le réseau leur donnait est la seule façon
 * d'affirmer — et de tester — que les deux chemins rendent le **même**
 * résultat. Un jeu de fonctions parallèles « qui font pareil » aurait demandé de
 * le re-prouver à chaque correction.
 *
 * Deux détails qui ne sont pas devinables :
 *
 *  - `printed_name` est posé au premier niveau **et** sur chaque face, parce que
 *    c'est ce que Scryfall fait et que `printedNameOf()` / `localizedFaces()`
 *    lisent les deux. Le nom stocké est déjà celui que ces fonctions avaient
 *    calculé à l'ingestion : le tour complet redonne donc la même valeur.
 *  - `games` est reconstruit depuis `isPaper` parce que `printingScore()` lit
 *    `games`, et non un booléen. On stocke les **entrées** du barème, jamais son
 *    résultat : le classement reste ainsi celui de la version courante du
 *    barème, pas celui de la version qui tournait le jour de l'ingestion.
 */
function asScryfallCard(row: PrintingRow): ScryfallCard {
  const stored = asList<FaceRow>(row.faces);
  const illustrations = asList<string>(row.illustrationIds);

  const faces: ScryfallCardFace[] | undefined =
    stored.length > 0
      ? stored.map((face, i) => ({
          name: face.name ?? row.printedName,
          printed_name: face.name ?? row.printedName,
          ...(face.typeLine ? { type_line: face.typeLine } : {}),
          ...(face.manaCost ? { mana_cost: face.manaCost } : {}),
          ...(face.power ? { power: face.power } : {}),
          ...(face.toughness ? { toughness: face.toughness } : {}),
          ...(face.loyalty ? { loyalty: face.loyalty } : {}),
          ...(face.imageUris ? { image_uris: face.imageUris } : {}),
          ...(illustrations[i] ? { illustration_id: illustrations[i] } : {}),
        }))
      : undefined;

  return {
    id: row.scryfallId,
    ...(row.oracleId ? { oracle_id: row.oracleId } : {}),
    name: row.printedName,
    printed_name: row.printedName,
    lang: SCRYFALL_LANG[row.language as Language] ?? row.language,
    set: row.setCode,
    set_name: '',
    ...(row.setType ? { set_type: row.setType } : {}),
    collector_number: row.collectorNumber,
    // `layout` et `set_name` ne servent à rien en aval ; les inventer serait
    // pire que de les laisser vides.
    layout: '',
    ...(row.releasedAt ? { released_at: row.releasedAt.toISOString().slice(0, 10) } : {}),
    ...(row.imageUris ? { image_uris: row.imageUris as ScryfallImageUris } : {}),
    ...(faces ? { card_faces: faces } : {}),
    ...(faces ? {} : illustrations[0] ? { illustration_id: illustrations[0] } : {}),
    image_status: row.imageStatus ?? undefined,
    highres_image: row.highresImage,
    ...(row.frame ? { frame: row.frame } : {}),
    frame_effects: asList<string>(row.frameEffects),
    ...(row.borderColor ? { border_color: row.borderColor } : {}),
    full_art: row.isFullArt,
    ...(row.isTextless === null ? {} : { textless: row.isTextless }),
    digital: row.isDigital,
    promo: row.isPromo,
    variation: row.isVariation,
    games: row.isPaper ? ['paper'] : [],
  } as ScryfallCard;
}

const SELECT = {
  scryfallId: true,
  oracleId: true,
  language: true,
  setCode: true,
  collectorNumber: true,
  printedName: true,
  imageUris: true,
  faces: true,
  imageStatus: true,
  highresImage: true,
  illustrationIds: true,
  frame: true,
  frameEffects: true,
  borderColor: true,
  isFullArt: true,
  isTextless: true,
  setType: true,
  releasedAt: true,
  isDigital: true,
  isPromo: true,
  isVariation: true,
  isPaper: true,
} as const;

/**
 * Jusqu'à quelle date le catalogue localisé fait autorité.
 *
 * **C'est la question centrale de tout ce dispositif**, et elle se pose à
 * l'envers de l'intuition. Le bulk ne dit pas « cette carte n'a pas de version
 * française » : il dit « au jour de sa publication, voici toutes les impressions
 * françaises ». Une carte absente du bulk n'a donc pas de traduction **si elle
 * existait déjà quand le bulk a été produit** ; sinon, son absence ne veut
 * strictement rien dire.
 *
 * Écrire `missing` sur une carte parue après notre dernière ingestion graverait
 * un repli anglais définitif sur toutes les nouveautés — la même faute que
 * mémoriser un 503 (`docs/i18n.md` §3.5), et elle serait invisible : personne ne
 * remarque une carte qui *reste* en anglais.
 *
 * `null` tant qu'aucune ingestion n'a abouti : une base vierge n'a donc aucune
 * autorité, et tout passe par le chemin paresseux. C'est ce qui rend le premier
 * démarrage utilisable **pendant** l'ingestion plutôt qu'après.
 */
let autorite: { at: number; date: Date | null } | null = null;
const AUTORITE_TTL_MS = 60_000;

export async function bulkAuthorityDate(): Promise<Date | null> {
  if (autorite && Date.now() - autorite.at < AUTORITE_TTL_MS) return autorite.date;
  const run = await prisma.ingestRun.findFirst({
    where: { bulkType: LOCALIZED_BULK_TYPE, finishedAt: { not: null }, error: null },
    orderBy: { bulkUpdatedAt: 'desc' },
    select: { bulkUpdatedAt: true },
  });
  autorite = { at: Date.now(), date: run?.bulkUpdatedAt ?? null };
  return autorite.date;
}

/** Pour les tests, et pour l'ingestion qui vient de changer la réponse. */
export function resetBulkAuthority(): void {
  autorite = null;
}

/**
 * Le catalogue localisé tel que `resolveLocalizedCards` le consomme.
 *
 * **Une seule requête pour tout le lot**, par `oracleId`. Elle rend d'un coup
 * toutes les impressions traduites des cartes demandées ; l'impression de
 * *cette* édition-ci s'y reconnaît à son couple (édition, numéro de collection),
 * exactement comme `elsewhereFromCandidates` la reconnaît dans une réponse de
 * `/cards/search`. Une seconde requête, minuscule, rattrape les rares cartes du
 * catalogue sans `oracleId`, pour lesquelles il n'y a pas de sœurs à chercher
 * mais une impression exacte à trouver quand même.
 */
export const prismaBulkLocalizationSource: BulkLocalizationSource = {
  async lookup(cards: CatalogCard[], language: Language): Promise<Map<string, BulkAnswer>> {
    const out = new Map<string, BulkAnswer>();
    if (cards.length === 0) return out;

    const jusqua = await bulkAuthorityDate();
    if (!jusqua) return out;

    // Une carte sans date de sortie ne peut pas être située par rapport au
    // bulk : on ne tranche pas, le chemin paresseux reprend.
    const eligibles = cards.filter(
      (c) => c.releasedAt != null && new Date(c.releasedAt) <= jusqua,
    );
    if (eligibles.length === 0) return out;

    const oracleIds = [...new Set(eligibles.map((c) => c.oracleId).filter((id): id is string => Boolean(id)))];
    const sansOracle = eligibles.filter((c) => !c.oracleId);

    const parOracle = new Map<string, ScryfallCard[]>();
    if (oracleIds.length > 0) {
      const rows = (await prisma.localizedPrinting.findMany({
        where: { language, oracleId: { in: oracleIds } },
        select: SELECT,
      })) as PrintingRow[];
      for (const row of rows) {
        const key = row.oracleId;
        if (!key) continue;
        const list = parOracle.get(key);
        if (list) list.push(asScryfallCard(row));
        else parOracle.set(key, [asScryfallCard(row)]);
      }
    }

    const exactes = new Map<string, ScryfallCard>();
    if (sansOracle.length > 0) {
      const rows = (await prisma.localizedPrinting.findMany({
        where: {
          language,
          OR: sansOracle.map((c) => ({
            setCode: c.setCode,
            collectorNumber: c.collectorNumber,
          })),
        },
        select: SELECT,
      })) as PrintingRow[];
      for (const row of rows) {
        exactes.set(`${row.setCode}/${row.collectorNumber}`, asScryfallCard(row));
      }
    }

    for (const card of eligibles) {
      const candidates = card.oracleId ? (parOracle.get(card.oracleId) ?? []) : [];
      /*
       * L'impression traduite de **cette** édition. Le `toLowerCase` reprend
       * celui d'`elsewhereFromCandidates` : les deux codes d'édition viennent du
       * même champ Scryfall, mais comparer autrement ici et là serait un écart
       * gratuit entre les deux chemins.
       */
      const printing =
        candidates.find(
          (c) =>
            c.set.toLowerCase() === card.setCode.toLowerCase() &&
            c.collector_number === card.collectorNumber,
        ) ??
        exactes.get(`${card.setCode}/${card.collectorNumber}`) ??
        null;
      out.set(card.scryfallId, { printing, candidates });
    }
    return out;
  },
};

/** Combien d'impressions traduites le catalogue porte, par langue. */
export async function localizedPrintingCount(language?: Language): Promise<number> {
  return prisma.localizedPrinting.count(language ? { where: { language } } : undefined);
}
