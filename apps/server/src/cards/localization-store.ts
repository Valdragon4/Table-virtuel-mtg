/**
 * Mémoire des impressions localisées, adossée à Postgres.
 *
 * Séparée de la décision (src/cards/localization.ts) pour deux raisons : la
 * logique de repli se teste alors sans base ni réseau, et l'on voit d'un coup
 * d'œil que ce qui est persisté se limite à des URL et à des noms — jamais un
 * octet d'image.
 */
import { Prisma } from '@prisma/client';
import type { Language } from '@mtg/shared';
import { prisma } from '../db.js';
import {
  SUBSTITUTE_SEARCH_VERSION,
  type CatalogCard,
  type LocalizationRecord,
  type LocalizationStore,
  type PendingSubstituteLoader,
} from './localization.js';

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export const prismaLocalizationStore: LocalizationStore = {
  async load(scryfallIds: string[], language: Language): Promise<LocalizationRecord[]> {
    if (scryfallIds.length === 0) return [];
    const rows = await prisma.cardLocalization.findMany({
      where: { language, scryfallId: { in: scryfallIds } },
    });
    return rows.map((row) => ({
      scryfallId: row.scryfallId,
      language: row.language as Language,
      localizedScryfallId: row.localizedScryfallId,
      printedName: row.printedName,
      imageUris: row.imageUris,
      faces: row.faces,
      imageStatus: row.imageStatus,
      highresImage: row.highresImage,
      nameChecked: row.nameChecked,
      substituteSearchVersion: row.substituteSearchVersion,
      missing: row.missing,
      // La substitution ne se recompose que si l'on a bien retenu une autre
      // impression : les lignes écrites avant que ces colonnes n'existent
      // rendent `null`, c'est-à-dire le comportement d'hier.
      substitute: row.substituteScryfallId
        ? {
            scryfallId: row.substituteScryfallId,
            setCode: row.substituteSetCode ?? '',
            collectorNumber: row.substituteCollectorNumber ?? '',
            imageUris: row.substituteImageUris,
            faces: row.substituteFaces,
            imageStatus: row.substituteImageStatus,
            highresImage: row.substituteHighresImage,
          }
        : null,
    }));
  },

  async save(records: LocalizationRecord[]): Promise<void> {
    // Un `upsert` par ligne plutôt qu'un `createMany` : deux requêtes
    // concurrentes peuvent très bien résoudre la même carte au même instant, et
    // la seconde ne doit pas tomber sur une violation de clé primaire.
    for (const record of records) {
      const data = {
        localizedScryfallId: record.localizedScryfallId,
        printedName: record.printedName,
        imageUris: toJson(record.imageUris),
        faces: toJson(record.faces),
        imageStatus: record.imageStatus,
        highresImage: record.highresImage,
        nameChecked: record.nameChecked,
        substituteSearchVersion: record.substituteSearchVersion,
        missing: record.missing,
        // Là encore : des URL et des métadonnées d'identification, jamais un
        // octet d'image. Écrite une fois, la substitution ne bouge plus — c'est
        // ce qui fait qu'une carte montre la **même** édition de remplacement
        // d'une session à l'autre.
        substituteScryfallId: record.substitute?.scryfallId ?? null,
        substituteSetCode: record.substitute?.setCode ?? null,
        substituteCollectorNumber: record.substitute?.collectorNumber ?? null,
        substituteImageUris: toJson(record.substitute?.imageUris),
        substituteFaces: toJson(record.substitute?.faces),
        substituteImageStatus: record.substitute?.imageStatus ?? null,
        substituteHighresImage: record.substitute?.highresImage ?? false,
        fetchedAt: new Date(),
      };
      await prisma.cardLocalization.upsert({
        where: {
          scryfallId_language: { scryfallId: record.scryfallId, language: record.language },
        },
        create: { scryfallId: record.scryfallId, language: record.language, ...data },
        update: data,
      });
    }
  },
};

/**
 * Les lignes dont la substitution reste à chercher, avec la carte de catalogue
 * qu'il faut pour la chercher.
 *
 * **C'est la requête qui rend le rattrapage réel plutôt que théorique.** Lever
 * le verrou ne suffisait pas : une ligne que personne n'affiche ne repasse
 * jamais par la route. Celle-ci va les prendre là où elles dorment.
 *
 * Le tri par `fetchedAt` croissant sert deux choses : il commence par les plus
 * anciennes — exactement celles que le verrou avait fermées — et il rend les
 * tranches **stables**, donc le balayage progresse au lieu de repiocher au
 * hasard. Les lignes traitées sortent du filtre puisque leur compteur monte ;
 * celles qu'une panne laisse en place reviennent, et le balayage sait s'en
 * apercevoir.
 */
/**
 * Le filtre des lignes en retard, partagé par le balayage et son comptage.
 *
 * **Deux motifs**, qui n'ont pas la même cause : `missing` (aucune impression
 * traduite de cette édition — la substitution apporte la langue) et un scan qui
 * n'est pas net (la substitution apporte la netteté). Le statut `null` des 109
 * lignes écrites avant la colonne `imageStatus` compte comme « pas net » : on
 * n'en sait rien, et une recherche le dira.
 *
 * **Les terrains de base sont exclus ici, et pas seulement dans le code.** Ils
 * ne se substituent jamais, donc le balayage n'a rien à en faire — c'est **un
 * tiers** des lignes françaises qu'il n'ouvre pas, et autant d'appels Scryfall
 * épargnés. Ce n'est pas qu'une optimisation : une ligne chargée puis
 * silencieusement ignorée ne verrait jamais son compteur monter, reviendrait à
 * la tranche suivante, et le garde-fou anti-boucle du balayage prendrait cette
 * répétition pour une panne de Scryfall et **arrêterait tout le rattrapage**.
 *
 * Le critère SQL est volontairement le plus proche possible de
 * `isBasicLandTypeLine` : supertype `Basic` en tête **et** le mot `Land` dans la
 * ligne de type. `Basic Creature — Shapeshifter`, la seule carte du catalogue à
 * commencer par `Basic` sans être un terrain, n'est donc pas exclue à tort.
 */
function enRetard(language: Language) {
  return {
    language,
    substituteSearchVersion: { lt: SUBSTITUTE_SEARCH_VERSION },
    OR: [
      { missing: true },
      { imageStatus: null },
      { imageStatus: { not: 'highres_scan' } },
    ],
    NOT: {
      card: {
        is: {
          AND: [{ typeLine: { startsWith: 'Basic' } }, { typeLine: { contains: 'Land' } }],
        },
      },
    },
  };
}

/**
 * Ce que la résolution a besoin de savoir de la carte choisie : sa clé chez
 * Scryfall, son `oracleId` pour retrouver ses sœurs traduites, sa ligne de type
 * pour l'exception des terrains de base, et ses **traits de ressemblance** —
 * c'est sur eux que `chooseSubstitute` décide laquelle des impressions
 * françaises ressemble le plus à celle que le joueur a choisie.
 */
const CATALOG_SELECT = {
  scryfallId: true,
  name: true,
  setCode: true,
  collectorNumber: true,
  oracleId: true,
  typeLine: true,
  imageUris: true,
  faces: true,
  // Voir `bulkAuthorityDate` : sans la date de sortie, le catalogue localisé ne
  // peut pas savoir s'il fait autorité sur cette carte, et s'abstient.
  releasedAt: true,
  illustrationId: true,
  frame: true,
  frameEffects: true,
  isTextless: true,
  borderColor: true,
  isFullArt: true,
  setType: true,
} as const;

export const loadPendingSubstitutes: PendingSubstituteLoader = async (language, limit) => {
  const rows = await prisma.cardLocalization.findMany({
    where: enRetard(language),
    orderBy: { fetchedAt: 'asc' },
    take: limit,
    select: { card: { select: CATALOG_SELECT } },
  });
  return rows.map((row) => row.card as CatalogCard);
};

/** Combien de lignes attendent encore leur recherche de substitution. */
export async function pendingSubstituteCount(language: Language): Promise<number> {
  return prisma.cardLocalization.count({ where: enRetard(language) });
}
