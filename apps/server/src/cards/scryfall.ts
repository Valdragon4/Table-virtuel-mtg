/**
 * Accès Scryfall. Deux règles tenues strictement :
 *  - aucune requête unitaire en chemin chaud : l'alimentation se fait par bulk data ;
 *  - aucune image ne transite par le serveur, on ne manipule que des URLs.
 */
import { env } from '../env.js';
import { RateLimitedFetcher } from '../lib/http.js';

/** 100 ms entre deux appels, au-dessus de ce que Scryfall demande. */
export const scryfall = new RateLimitedFetcher(100, {
  'User-Agent': env.SCRYFALL_USER_AGENT,
  Accept: 'application/json;q=0.9,*/*;q=0.8',
});

export interface ScryfallBulkEntry {
  type: string;
  updated_at: string;
  /** Fichier JSONL compressé en gzip : un objet carte par ligne. */
  jsonl_download_uri: string;
  compressed_size: number;
}

export interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
}

export interface ScryfallCardFace {
  name: string;
  type_line?: string;
  mana_cost?: string;
  image_uris?: ScryfallImageUris;
  power?: string;
  toughness?: string;
  loyalty?: string;
  /**
   * L'identifiant de l'**œuvre** de cette face.
   *
   * Scryfall ne pose pas `illustration_id` au premier niveau d'une carte
   * recto-verso : il y en a **un par face**. Voir `illustrationIdsOf`.
   */
  illustration_id?: string;
}

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  lang: string;
  released_at?: string;
  layout: string;
  set: string;
  set_name: string;
  set_type?: string;
  collector_number: string;
  type_line?: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  rarity?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  promo?: boolean;
  digital?: boolean;
  variation?: boolean;
  full_art?: boolean;
  border_color?: string;
  frame?: string;
  /**
   * L'identifiant de l'**œuvre**, et non de l'impression : deux impressions qui
   * le partagent portent exactement la même illustration. C'est le signal le
   * plus fort dont on dispose pour dire qu'une impression *ressemble* à celle
   * que le joueur a choisie. Absent au premier niveau des cartes recto-verso.
   */
  illustration_id?: string;
  /** `extendedart`, `showcase`, `legendary`, `inverted`… : le traitement du cadre. */
  frame_effects?: string[];
  /**
   * Les **mécaniques** que porte la carte : `['Haste', 'Cascade']`, `['Discover']`.
   *
   * Scryfall le publie **à côté** d'`oracle_text`, et c'est ce qui le rend
   * lisible ici : ce sont des noms de mots-clés, pas des phrases de la carte —
   * la même nature que `type_line`. On sait qu'une carte cascade ; on ne sait ni
   * ce que sa cascade fait, ni avec quel nombre (« Discover », jamais
   * « Discover 4 »). Le texte de règles, lui, n'est pas déclaré ici et ne doit
   * pas l'être : voir la note de propriété intellectuelle de `schema.prisma`.
   */
  keywords?: string[];
  /** Vrai pour les impressions sans encadré de texte (certaines promos, les Unfinity). */
  textless?: boolean;
  finishes?: string[];
  games?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
}

export async function getBulkEntry(type = 'default_cards'): Promise<ScryfallBulkEntry> {
  const body = await scryfall.json<{ data: ScryfallBulkEntry[] }>('https://api.scryfall.com/bulk-data');
  const entry = body.data.find((d) => d.type === type);
  if (!entry) throw new Error(`Bulk Scryfall « ${type} » introuvable`);
  if (!entry.jsonl_download_uri) {
    throw new Error(
      `Le bulk « ${type} » n'expose pas de jsonl_download_uri : le format Scryfall a changé, adapter src/cards/ingest.ts.`,
    );
  }
  return entry;
}

/**
 * Pénalités par type d'édition. Sans elles, « l'impression la plus récente »
 * finit par désigner The List ou un Secret Lair, qui ne sont pas ce qu'un joueur
 * attend quand il écrit simplement « 1 Sol Ring ».
 */
const SET_TYPE_PENALTY: Record<string, number> = {
  funny: 400,
  memorabilia: 500,
  token: 400,
  minigame: 400,
  treasure_chest: 300,
  vault: 200,
  from_the_vault: 200,
  premium_deck: 150,
  spellbook: 150,
  box: 250, // Secret Lair
  promo: 250,
  masterpiece: 250,
  alchemy: 1000,
};

/**
 * Score de préférence d'une impression, utilisé quand une ligne de deck ne
 * précise pas d'édition : on veut l'impression la plus « normale » et la plus
 * récente, pas une promo étrange sans image. À score égal, la date tranche.
 */
export function printingScore(card: ScryfallCard): number {
  let score = 0;
  if (card.digital) score -= 1000;
  if (!(card.games ?? []).includes('paper')) score -= 500;
  if (card.promo) score -= 120;
  if (card.variation) score -= 60;
  if (card.border_color && card.border_color !== 'black') score -= 80;
  if (card.full_art) score -= 40;
  if (!hasImage(card)) score -= 2000;
  if (card.lang !== 'en') score -= 150;
  score -= SET_TYPE_PENALTY[card.set_type ?? ''] ?? 0;
  // The List réimprime des cartes hors de leur édition d'origine : utile à
  // reconnaître, mauvais candidat par défaut.
  if (card.set === 'plst' || card.set === 'plist') score -= 250;
  return score;
}

/** Une ligne de type de jeton porte le mot « Token » : « Token Creature — Insect ». */
const TOKEN_TYPE_LINE = /(^|\s)Token(\s|$)/;

/**
 * Cette carte est-elle un jeton ?
 *
 * La disposition suffit presque toujours, et la ligne de type rattrape le reste
 * — sauf pour les cartes **réversibles** (`reversible_card`, les Secret Lair
 * recto-verso), dont l'objet Scryfall n'a **pas** de `type_line` au premier
 * niveau : tout est dans les faces. Ne regarder que le premier niveau classait
 * donc le Mechtitan de `sld` parmi les cartes ordinaires, et la recherche de
 * jeton ne pouvait plus le trouver.
 */
export function isTokenCard(card: ScryfallCard): boolean {
  if (card.layout === 'token' || card.layout === 'double_faced_token') return true;
  if (TOKEN_TYPE_LINE.test(card.type_line ?? '')) return true;
  return (card.card_faces ?? []).some((f) => TOKEN_TYPE_LINE.test(f.type_line ?? ''));
}

/**
 * Un terrain de base, et **rien d'autre**.
 *
 * **Pourquoi cette carte-là fait exception.** Un terrain de base n'a pas de
 * texte à lire : l'illustration *est* la carte, et c'est souvent pour elle
 * qu'une édition est choisie. Un joueur qui monte son deck avec les Plaines
 * d'Amonkhet ne veut pas les voir remplacées par celles d'une autre extension
 * au nom d'une traduction dont il n'a que faire ; et un repère « non traduite »
 * sur une Plaine ne lui apprend rien tout en salissant son terrain, à raison de
 * vingt ou trente exemplaires par table. On ne substitue donc jamais l'édition
 * d'un terrain de base, et on ne le marque jamais.
 *
 * **La règle se lit sur la ligne de type anglaise du catalogue**, jamais sur un
 * `printed_type_line` : celui-ci dirait « Terrain de base » et le critère
 * casserait pour un joueur anglophone.
 *
 * Le critère est le **supertype `Basic` accompagné du type `Land`**, pas le nom
 * de la carte :
 *  - `Basic Land — Plains`, `Basic Land` (*Wastes*) et `Basic Snow Land — Island`
 *    (les terrains enneigés) en sont ;
 *  - `Land — Plains Island` (les duals originels), les fetchlands et tous les
 *    terrains à texte n'en sont pas — pour eux la traduction compte vraiment ;
 *  - `Basic Creature — Shapeshifter` n'en est pas non plus : `Basic` seul ne
 *    suffit pas.
 *
 * Les supertypes et les types précèdent le tiret cadratin ; on ne regarde donc
 * que ce qui est devant lui, et le `//` d'une carte à deux moitiés avec.
 */
const BASIC_LAND_TYPE_LINE = /^\s*Basic\b[^—/]*\bLand\b/;

export function isBasicLandTypeLine(typeLine: string | null | undefined): boolean {
  return BASIC_LAND_TYPE_LINE.test(typeLine ?? '');
}

/**
 * Les identifiants d'œuvre d'une impression.
 *
 * Une carte ordinaire en a un, au premier niveau. Une carte **recto-verso** n'en
 * a pas là : Scryfall en pose un **par face**. On rend donc une liste, et la
 * comparaison se fait par intersection — deux impressions se ressemblent dès
 * qu'elles partagent une œuvre.
 */
export function illustrationIdsOf(card: ScryfallCard): string[] {
  const ids: string[] = [];
  if (card.illustration_id) ids.push(card.illustration_id);
  for (const face of card.card_faces ?? []) {
    if (face.illustration_id) ids.push(face.illustration_id);
  }
  return ids;
}

export function hasImage(card: ScryfallCard): boolean {
  if (card.image_uris?.normal) return true;
  return (card.card_faces ?? []).some((f) => f.image_uris?.normal);
}

/** Faces conservées : nom et images uniquement, jamais de texte de règles. */
export function compactFaces(card: ScryfallCard): Array<Record<string, unknown>> | null {
  if (!card.card_faces?.length) return null;
  return card.card_faces.map((f) => ({
    name: f.name,
    typeLine: f.type_line ?? null,
    manaCost: f.mana_cost ?? null,
    power: f.power ?? null,
    toughness: f.toughness ?? null,
    loyalty: f.loyalty ?? null,
    imageUris: f.image_uris ?? null,
  }));
}
