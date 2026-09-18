/**
 * Cartes localisées : résoudre l'impression traduite d'une carte du catalogue.
 *
 * Le point important, et contre-intuitif : chez Scryfall, une carte française
 * n'est pas « la même carte avec une autre URL d'image ». C'est un **objet carte
 * distinct**, de même édition et même numéro de collection, mais d'identifiant
 * différent, avec son `lang`, son `printed_name` et ses propres `image_uris`.
 * Afficher une carte en français demande donc une résolution, pas une réécriture
 * d'URL.
 *
 * Trois règles tiennent ce module :
 *
 *  1. **Aucune image ne nous traverse.** On ne stocke que des URL Scryfall, que
 *     le navigateur du joueur ira chercher lui-même. Rien de Wizards of the
 *     Coast n'est hébergé, proxifié ni mis en cache ici.
 *  2. **Le 404 est une réponse, pas une panne.** La plupart des cartes n'ont
 *     jamais été imprimées en français ; Scryfall répond alors 404. C'est le
 *     repli anglais, et il se mémorise — sans quoi chaque affichage rejouerait
 *     l'appel pour apprendre la même chose.
 *  3. **Un seul robinet vers Scryfall.** On passe par le `RateLimitedFetcher`
 *     déjà partagé par l'ingestion (src/cards/scryfall.ts), jamais par un
 *     `fetch` direct qui ignorerait la file d'attente.
 *
 * Les dépendances (stockage, appel réseau) sont injectées : la décision — que
 * relire, que demander, quand se rabattre — se teste alors sans base ni réseau.
 */
import { SCRYFALL_LANG, type Language } from '@mtg/shared';
import { HttpError } from '../lib/http.js';
import { CATALOG_LANGUAGE } from './languages.js';
import {
  compactFaces,
  hasImage,
  illustrationIdsOf,
  isBasicLandTypeLine,
  printingScore,
  scryfall,
  type ScryfallCard,
} from './scryfall.js';

/** Le minimum qu'il faut connaître d'une carte pour aller chercher sa traduction. */
export interface CatalogCard {
  scryfallId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  imageUris: unknown;
  faces: unknown;
  /**
   * L'identifiant oracle : la **carte**, indépendamment de son impression.
   *
   * Il ne sert pas à choisir l'illustration — celle-là reste celle de
   * l'impression que le joueur a choisie — mais à retrouver le **nom français**
   * d'une carte dont cette impression-ci n'existe pas en français. Voir
   * `fetchLocalizedElsewhere`.
   */
  oracleId?: string | null;
  /**
   * La ligne de type **anglaise** du catalogue : elle seule dit si c'est un
   * terrain de base, et un terrain de base ne se substitue jamais. Voir
   * `isBasicLandTypeLine`.
   */
  typeLine?: string | null;
  /**
   * La date de sortie de l'impression.
   *
   * Elle ne sert qu'à une chose, mais elle est décisive : savoir si le catalogue
   * localisé ingéré en masse a **le droit** de répondre pour cette carte. Une
   * impression parue après le bulk que nous avons chargé en est forcément
   * absente, et son absence n'y veut alors rien dire — c'est le chemin
   * paresseux qui doit reprendre la main. Voir `BulkLocalizationSource`.
   */
  releasedAt?: Date | string | null;

  /* ——— Les traits de l'impression choisie, pour la ressemblance ———————————
   *
   * Tous facultatifs : une carte ingérée avant l'ajout de ces colonnes les rend
   * `null`, et le classement retombe alors sur la règle d'avant. Voir
   * `chooseSubstitute`. */
  illustrationId?: string | null;
  frame?: string | null;
  frameEffects?: unknown;
  isTextless?: boolean | null;
  borderColor?: string | null;
  isFullArt?: boolean | null;
  setType?: string | null;
}

/**
 * Ce qui fait qu'une impression **ressemble** à une autre.
 *
 * Rien n'est inventé ici : chaque champ est publié tel quel par Scryfall.
 * `null` veut dire « on ne sait pas » — et non « absent » —, ce qui compte :
 * un trait inconnu ne doit départager personne, pas départager à tort.
 */
export interface PrintingTraits {
  /** L'identifiant de l'œuvre. Le signal décisif. */
  illustrationId: string | null;
  frame: string | null;
  frameEffects: readonly string[] | null;
  borderColor: string | null;
  fullArt: boolean | null;
  textless: boolean | null;
  setType: string | null;
}

function asStringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string');
}

/** Les traits de l'impression que le joueur a choisie, lus dans notre catalogue. */
export function traitsOfCatalogCard(card: CatalogCard): PrintingTraits {
  return {
    illustrationId: card.illustrationId ?? null,
    frame: card.frame ?? null,
    frameEffects: asStringList(card.frameEffects),
    borderColor: card.borderColor ?? null,
    fullArt: card.isFullArt ?? null,
    textless: card.isTextless ?? null,
    setType: card.setType ?? null,
  };
}

/** Les mêmes traits, lus sur un objet carte de Scryfall. */
export function traitsOfPrinting(printing: ScryfallCard): PrintingTraits {
  return {
    illustrationId: illustrationIdsOf(printing)[0] ?? null,
    frame: printing.frame ?? null,
    frameEffects: printing.frame_effects ?? [],
    borderColor: printing.border_color ?? null,
    fullArt: printing.full_art ?? false,
    textless: printing.textless ?? false,
    setType: printing.set_type ?? null,
  };
}

/** Ce qu'on retient d'une résolution, y compris quand elle a dit « non ». */
export interface LocalizationRecord {
  scryfallId: string;
  language: Language;
  localizedScryfallId: string | null;
  printedName: string | null;
  imageUris: unknown;
  faces: unknown;
  /** `image_status` de Scryfall, ou `null` quand il n'y a pas d'impression. */
  imageStatus: string | null;
  /** `highres_image` de Scryfall : faux tant qu'on n'a pas vu le contraire. */
  highresImage: boolean;
  /**
   * Vrai quand le nom traduit a été cherché, trouvé ou non. Il distingue « pas
   * encore cherché » de « cherché, rien trouvé » — sans quoi une carte sans nom
   * français serait recherchée à chaque passage.
   *
   * **Il ne commande plus la recherche.** Voir `substituteSearchVersion` : ce
   * drapeau-ci ne répond qu'à la question du nom.
   */
  nameChecked: boolean;
  /**
   * La version de la recherche de substitution réellement menée sur cette
   * ligne. `0` veut dire « jamais cherchée ». Voir `SUBSTITUTE_SEARCH_VERSION`.
   */
  substituteSearchVersion: number;
  missing: boolean;
  /**
   * L'impression **de substitution** : une autre impression de la même carte,
   * celle-là traduite — et, depuis la version 2 de la recherche, la plus
   * **ressemblante** plutôt que la meilleure. Retenue par la même recherche que
   * `printedName`, donc sans appel réseau supplémentaire.
   *
   * Elle n'est lue que par les joueurs qui ont coché l'option, et jamais servie
   * d'office : l'illustration reste un choix du joueur. `null` quand la carte
   * n'existe dans cette langue sur aucune impression affichable.
   */
  substitute: SubstitutePrinting | null;
}

/**
 * Une impression traduite d'une **autre** édition, gardée pour les joueurs qui
 * ont demandé qu'on la leur montre à la place de l'anglais.
 *
 * Comme partout : des URL et des métadonnées d'identification, jamais un octet
 * d'image.
 */
export interface SubstitutePrinting {
  scryfallId: string;
  /** L'édition réelle de cette illustration — l'interface doit pouvoir la dire. */
  setCode: string;
  collectorNumber: string;
  imageUris: unknown;
  faces: unknown;
  imageStatus: string | null;
  highresImage: boolean;
}

/** Une carte prête à afficher dans la langue demandée, ou dans son repli. */
export interface LocalizedCard {
  /** L'identifiant du protocole de jeu : il ne change jamais avec la langue. */
  scryfallId: string;
  /** La langue réellement servie, qui vaut le repli quand la traduction n'existe pas. */
  language: Language;
  /** Vrai quand on sert l'anglais alors qu'autre chose était demandé. */
  fallback: boolean;
  /**
   * Vrai quand la résolution n'a pas encore pu être faite (quota d'appels de la
   * requête atteint, ou Scryfall momentanément indisponible). On sert l'anglais
   * en attendant ; redemander plus tard rendra la traduction.
   */
  pending: boolean;
  /** L'impression traduite chez Scryfall, utile pour un lien sortant. */
  localizedScryfallId: string | null;
  /** Le nom du catalogue, anglais : il reste la clé de recherche et de deck. */
  name: string;
  /**
   * Le nom à afficher : `printed_name` s'il existe, sinon le nom du catalogue.
   *
   * Il peut être traduit **alors que `language` vaut `'en'`** : cette
   * impression-ci n'existe pas en français, mais la carte y a un nom, repris
   * d'une autre impression. On montre alors le nom français sous l'illustration
   * que le joueur a choisie — celle-ci ne change jamais de langue en douce.
   */
  printedName: string;
  /**
   * `image_status` de l'illustration servie : `lowres` et `placeholder` disent
   * qu'elle est agrandie depuis un scan de basse définition. `null` quand c'est
   * le catalogue anglais qui répond, dont nous n'ingérons pas ce champ.
   */
  imageStatus: string | null;
  /** `highres_image` de l'illustration servie. */
  highresImage: boolean;
  imageUris: unknown;
  faces: unknown;
  /**
   * L'impression de substitution. Deux cas la produisent :
   *  - cette impression-ci n'existe pas dans la langue demandée, mais une autre
   *    édition, elle, y existe — la substitution apporte la **langue** ;
   *  - elle existe, mais Scryfall n'en publie qu'un scan mou, et une autre
   *    édition traduite est nette — la substitution apporte la **netteté**, et
   *    seulement si le gain est réel (voir `chooseSubstitute`).
   *
   * **Le client ne l'affiche que s'il l'a demandé** (préférence de compte
   * `forceLocalizedPrinting`). Elle est publiée dans tous les cas parce que la
   * réponse est mise en cache par `(scryfallId, langue)` côté web : la faire
   * dépendre d'un réglage d'affichage obligerait à invalider ce cache au
   * premier clic, et à demander deux fois la même chose au serveur.
   *
   * Elle ne change **rien** au reste du contrat : `scryfallId` reste
   * l'identifiant du protocole, `imageUris` reste l'illustration de l'impression
   * réellement choisie.
   */
  substitute: SubstitutePrinting | null;
}

export interface LocalizationStore {
  load(scryfallIds: string[], language: Language): Promise<LocalizationRecord[]>;
  save(records: LocalizationRecord[]): Promise<void>;
}

/**
 * Ce que le bulk localisé sait d'une carte : l'impression traduite de **son**
 * édition, et **toutes** les impressions traduites de la carte.
 *
 * Les deux champs correspondent exactement aux deux appels réseau qu'ils
 * remplacent — `GET /cards/{set}/{cn}/{lang}` et
 * `GET /cards/search?q=oracleid:… lang:…` — et se lisent en aval par les mêmes
 * fonctions. Ce n'est pas une coïncidence de forme : c'est ce qui rend les deux
 * chemins interchangeables.
 */
export interface BulkAnswer {
  /** L'impression traduite de cette édition-ci, ou `null` : c'est le 404. */
  printing: ScryfallCard | null;
  /** Les sœurs traduites, toutes éditions confondues. Vide = il n'y en a pas. */
  candidates: readonly ScryfallCard[];
}

/**
 * Le catalogue des impressions traduites, interrogé **en une fois pour tout un
 * lot**.
 *
 * ——— Pourquoi un lot, et pas un appel par carte
 *
 * C'est tout l'intérêt du bulk. Le chemin paresseux est plafonné à vingt appels
 * vivants par requête parce que chacun coûte 100 ms de file d'attente et qu'une
 * vingtaine de `/cards/search` consécutifs déclenchent un 429. Deux requêtes SQL
 * pour cent cartes ne coûtent ni l'un ni l'autre : il n'y a donc plus de
 * plafond à opposer, plus de `pending` à publier, plus de relance à attendre
 * côté client. Un appel par carte, même en base, aurait reconduit la forme du
 * problème sans sa cause.
 *
 * ——— Une carte absente de la réponse n'est pas une carte sans traduction
 *
 * La `Map` rendue ne contient **que** les cartes pour lesquelles le bulk fait
 * autorité. Une carte qui n'y est pas retombe sur le chemin réseau, plafond
 * compris — c'est le repli, et il doit survivre : une impression parue après
 * notre dernière ingestion n'est dans aucun bulk, et le joueur ne doit pas la
 * voir en anglais pour autant.
 *
 * Confondre « absente du bulk » et « sans traduction » graverait un repli
 * anglais définitif sur toutes les nouveautés. C'est la même erreur que
 * mémoriser un 503 (§3.5) : une ignorance passagère écrite comme une réponse.
 */
export interface BulkLocalizationSource {
  lookup(cards: CatalogCard[], language: Language): Promise<Map<string, BulkAnswer>>;
}

/**
 * Résout une impression localisée. Rend `null` — et non une erreur — lorsque
 * Scryfall répond 404 : cette absence est une information qu'on veut mémoriser.
 */
export type LocalizedPrintingFetcher = (
  card: CatalogCard,
  language: Language,
) => Promise<ScryfallCard | null>;

/**
 * Ce qu'une **autre** impression de la même carte nous apprend, quand celle-ci
 * n'existe pas dans la langue demandée.
 *
 * Un seul appel rend les deux : le nom — qui ne dépend pas de l'édition et
 * s'affiche toujours — et l'impression de substitution — qui ne s'affiche que
 * sur demande explicite du joueur. Ouvrir un second chemin réseau pour la
 * seconde aurait doublé la charge sur le `RateLimitedFetcher` partagé sans rien
 * apprendre de plus.
 */
export interface LocalizedElsewhere {
  printedName: string | null;
  substitute: SubstitutePrinting | null;
  /**
   * L'`image_status` de l'impression traduite **de cette édition-ci**, relu dans
   * la même recherche.
   *
   * Il n'est pas redondant : 109 lignes de la base ont été écrites avant que la
   * colonne `imageStatus` n'existe et ne savent donc pas dire si ce qu'elles
   * servent est net. La recherche `oracleid … lang:fr` rend **toutes** les
   * impressions traduites, celle-ci comprise : la relire ne coûte pas un appel
   * de plus. `undefined` quand elle n'est pas dans le lot — c'est le cas
   * `missing`, où il n'y a rien à relire.
   */
  servedImageStatus?: string | null;
  servedHighresImage?: boolean;
}

/**
 * Retrouve ce qu'on peut d'une carte dont cette impression-ci n'existe pas dans
 * la langue demandée. Rend `null` quand la carte n'y a jamais été imprimée.
 */
export type LocalizedElsewhereFetcher = (
  card: CatalogCard,
  language: Language,
) => Promise<LocalizedElsewhere | null>;

/**
 * Plafond d'appels Scryfall par requête HTTP.
 *
 * Une main de départ, un champ de bataille et un cimetière tiennent largement
 * dedans. Sans ce plafond, une demande de 500 cartes froides tiendrait la
 * connexion cinquante secondes à cause du rythme imposé (100 ms par appel). Ce
 * qui dépasse revient marqué `pending` et sera résolu au prochain passage : la
 * partie n'attend jamais après une traduction.
 */
export const MAX_LIVE_LOOKUPS_PER_REQUEST = 20;

/**
 * La version courante de la recherche de substitution.
 *
 * **Le défaut qu'elle répare.** `nameChecked` a été introduit quand la
 * recherche `oracleid` ne rapportait que le **nom** : il empêchait de rejouer
 * indéfiniment l'appel pour une carte sans nom traduit ailleurs, et c'était
 * juste. Quand la substitution est arrivée, elle s'est branchée sur ce même
 * drapeau — déjà `true` sur toutes les lignes écrites avant elle, lesquelles
 * n'avaient évidemment aucune substitution puisque les colonnes n'existaient
 * pas. Le garde-fou anti-boucle est alors devenu un **verrou définitif** :
 * mesuré en base, 669 lignes « déjà cherchées » pour 10 substitutions, et 555
 * cartes sans impression française qui ne pouvaient plus rien en espérer.
 *
 * **Pourquoi un entier.** « A-t-on cherché un nom ? » et « a-t-on cherché une
 * impression de substitution ? » sont deux questions, et un booléen ne peut pas
 * répondre aux deux. Un compteur répond en plus à la seule qui compte
 * vraiment : *quelle* recherche a été menée. Les lignes d'avant portent `0`,
 * c'est-à-dire « jamais cherchée », et repassent **une** fois. Celles qui
 * portent cette version-ci ont été cherchées — l'absence de substitution y est
 * alors une réponse, mémorisée, et on ne les rouvre plus.
 *
 * Monter cette constante rejoue le rattrapage sur toute la table, sans qu'une
 * seule ligne ait à être touchée à la main. C'est ce qu'il faudra faire le jour
 * où `chooseSubstitute` changera de règle.
 *
 * **Version 2 — ce jour-là est arrivé.** `chooseSubstitute` a changé de règle
 * deux fois dans le même mouvement :
 *  - la **ressemblance** prime désormais sur la qualité (même œuvre d'abord,
 *    puis même cadre et même bordure). Les substituts choisis sous la version 1
 *    l'ont été par l'ancien barème et doivent être rejoués ;
 *  - la substitution ne se déclenche plus seulement sur `missing`, mais aussi
 *    quand l'impression traduite servie est **floue** et qu'une impression
 *    française nette existe ailleurs. Des lignes qui n'avaient jamais été
 *    candidates le deviennent.
 *
 * Monter le compteur suffit : le filtre du balayage
 * (`loadPendingSubstitutes`) reprend **toutes** les lignes en retard, y compris
 * celles qui portent déjà un substitut — 441 lignes en base au moment d'écrire
 * ces mots, en plus des 215 qui n'en avaient aucun.
 */
export const SUBSTITUTE_SEARCH_VERSION = 2;

/**
 * Reste-t-il une recherche de substitution à mener sur cette ligne ?
 *
 * C'est **le** point où se distingue « jamais cherché » de « cherché sans
 * succès » : le premier a un compteur en retard, le second est à jour. Une
 * panne n'écrivant jamais rien, une carte dont la recherche a échoué reste dans
 * le premier cas et repassera — exactement ce qu'on veut.
 *
 * **Deux motifs de chercher**, et ils n'ont pas la même cause :
 *  - `missing` : aucune impression traduite de cette édition. La substitution
 *    apporte la **langue** ;
 *  - une impression traduite existe mais son scan n'est pas net (`lowres`,
 *    `placeholder`, ou statut inconnu parce que la ligne est antérieure à la
 *    colonne). La substitution apporte alors la **netteté** — et seulement si
 *    elle en apporte vraiment, ce dont `chooseSubstitute` juge.
 *
 * Une impression traduite déjà nette est close des deux côtés : il n'y a ni
 * langue ni netteté à gagner.
 *
 * `card` est facultatif, et sert à une seule exception : un **terrain de base**
 * ne se substitue jamais (`isBasicLandTypeLine`). Le passer économise un appel
 * Scryfall par terrain, et ils pèsent lourd : **un tiers** des lignes françaises
 * de la base de mesure. (On écrit la proportion et non le compte : un
 * dénominateur vieillit à chaque partie jouée, une proportion non.)
 */
export function needsSubstituteSearch(
  record: LocalizationRecord,
  card?: { typeLine?: string | null } | null,
): boolean {
  if (card && isBasicLandTypeLine(card.typeLine)) return false;
  // `?? 0` n'est pas décoratif : une ligne venue d'une base qui n'a pas encore
  // reçu la colonne, ou d'un enregistrement construit à la main, doit compter
  // comme « jamais cherchée » et non comme `NaN`, qui rendrait `false` et
  // referait exactement le verrou qu'on retire.
  const faite = record.substituteSearchVersion ?? 0;
  if (faite >= SUBSTITUTE_SEARCH_VERSION) return false;
  if (record.missing) return true;
  return record.imageStatus !== SHARP_IMAGE_STATUS;
}

/** `https://api.scryfall.com/cards/{set}/{collector_number}/{lang}` */
export function localizedPrintingUrl(card: CatalogCard, language: Language): string {
  return `https://api.scryfall.com/cards/${encodeURIComponent(card.setCode)}/${encodeURIComponent(
    card.collectorNumber,
  )}/${encodeURIComponent(language)}`;
}

/**
 * Appel réel, par la file partagée avec l'ingestion.
 *
 * `attempts` vaut 4 sur ce client : un 404 n'étant pas réessayable, il remonte
 * immédiatement en `HttpError`, et c'est lui qu'on traduit en « pas de version
 * dans cette langue ».
 */
export const fetchLocalizedPrinting: LocalizedPrintingFetcher = async (card, language) => {
  try {
    const res = await scryfall.raw(localizedPrintingUrl(card, language));
    return (await res.json()) as ScryfallCard;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
};

/**
 * Ce qu'une **autre impression** de la même carte apprend : son nom traduit, et
 * l'impression elle-même au cas où le joueur demanderait à la voir.
 *
 * **Pourquoi le nom est servi d'office et l'illustration non.** Une carte peut
 * n'avoir jamais été imprimée en français *dans cette édition-ci* tout en
 * portant un nom français depuis vingt ans — c'est le cas de la plupart des
 * produits Commander, des rééditions promotionnelles et des Secret Lair. Mesuré
 * sur un deck réel de 84 lignes : 29 impressions rendent 404, et 27 d'entre
 * elles ont pourtant une impression française ailleurs. Le nom imprimé ne dépend
 * pas de l'édition — « Chemin vers l'exil » est le même sur les 28 impressions
 * françaises de *Path to Exile* — donc l'afficher ne trahit aucun choix.
 * L'**illustration**, elle, est un choix du joueur : la substituer d'office
 * ferait voir deux images différentes à deux joueurs de la même table et
 * rendrait le sélecteur d'impression menteur. On la retient sans la servir, et
 * c'est le client qui décide, pour lui seul.
 *
 * `unique=prints` et non `unique=cards` : il faut **toutes** les impressions
 * traduites pour pouvoir en choisir une bonne (voir `chooseSubstitute`), là où
 * `unique=cards` n'en rendait qu'une, arbitraire.
 *
 * Un seul appel, mémorisé comme le 404 qui l'a provoqué : la ligne reste
 * `missing: true` — l'impression traduite de cette édition n'existe toujours
 * pas — mais porte désormais un nom et, peut-être, une substitution.
 */
export const fetchLocalizedElsewhere: LocalizedElsewhereFetcher = async (card, language) => {
  if (!card.oracleId) return null;
  const query = `oracleid:${card.oracleId} lang:${language}`;
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(
    query,
  )}&unique=prints&order=released&dir=desc`;
  try {
    const res = await scryfall.raw(url);
    const body = (await res.json()) as { data?: ScryfallCard[] };
    const candidates = (body.data ?? []).filter((c) => c.lang === SCRYFALL_LANG[language]);
    return elsewhereFromCandidates(card, candidates);
  } catch (err) {
    // Aucune impression dans cette langue : Scryfall rend 404 sur une recherche
    // sans résultat. C'est une réponse, pas une panne.
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
};

/**
 * Ce qu'un lot d'impressions traduites apprend sur une carte du catalogue.
 *
 * **C'est la décision, et elle ne connaît pas sa source.** Hier ces candidates
 * arrivaient d'une recherche `/cards/search?q=oracleid:… lang:fr` ; elles
 * peuvent aujourd'hui venir d'une jointure sur `LocalizedPrinting`, alimentée
 * par le bulk `all_cards`. La règle de classement, elle, est la même fonction —
 * pas une seconde implémentation qui lui ressemblerait. C'est la seule façon
 * d'être certain que les deux chemins écrivent la **même** chose, plutôt que de
 * l'espérer et de le découvrir faux sur une carte que personne ne regarde.
 *
 * Les candidates doivent déjà être filtrées sur la langue demandée : la
 * recherche Scryfall le fait par `c.lang`, la base par sa colonne `language`.
 */
export function elsewhereFromCandidates(
  card: CatalogCard,
  candidates: readonly ScryfallCard[],
): LocalizedElsewhere | null {
  if (candidates.length === 0) return null;

  /*
   * L'impression traduite **de cette édition-ci**, si elle est dans le lot.
   * Chez Scryfall, une traduction porte la même édition et le même numéro de
   * collection que l'original — c'est ce qui la rend reconnaissable sans
   * appel supplémentaire.
   *
   * Elle sert à deux choses : dire si ce qu'on sert déjà est net, et — quand
   * notre catalogue est trop ancien pour porter l'`illustration_id` — fournir
   * les traits de l'impression choisie, puisque c'est la **même impression**
   * dans une autre langue, donc la même œuvre et le même cadre.
   */
  const servie =
    candidates.find(
      (c) =>
        c.set.toLowerCase() === card.setCode.toLowerCase() &&
        c.collector_number === card.collectorNumber,
    ) ?? null;

  const duCatalogue = traitsOfCatalogCard(card);
  const reference =
    duCatalogue.illustrationId || !servie ? duCatalogue : traitsOfPrinting(servie);

  const chosen = chooseSubstitute(candidates, {
    reference,
    ...(servie
      ? {
          servedImageStatus: (servie as { image_status?: string }).image_status ?? null,
          servedScryfallId: servie.id,
        }
      : {}),
  });
  return {
    /*
     * Le nom se lit sur n'importe quelle impression traduite — il ne dépend
     * pas de l'édition. On prend celle de cette édition-ci quand elle existe,
     * sinon la substitution, sinon la première venue : même sans illustration
     * affichable nulle part, le nom reste bon à prendre.
     */
    printedName: printedNameOf(servie ?? chosen ?? candidates[0]!),
    substitute: chosen ? toSubstitute(chosen) : null,
    ...(servie
      ? {
          servedImageStatus: (servie as { image_status?: string }).image_status ?? null,
          servedHighresImage:
            (servie as { highres_image?: boolean }).highres_image ?? false,
        }
      : {}),
  };
}

/**
 * Les statuts d'image qu'une substitution a le droit de porter.
 *
 * `placeholder` et `missing` ne sont pas des scans mous : ce sont des images de
 * remplacement, qui ne portent ni l'illustration ni le texte. Substituer l'une
 * d'elles à une image anglaise nette serait une perte sèche. La même liste vit
 * côté web sous le nom `USABLE_IMAGE_STATUS` ; ici elle sert à ne **pas
 * mémoriser** ce qu'on ne montrerait de toute façon jamais.
 */
const USABLE_IMAGE_STATUS = new Set(['lowres', 'highres_scan']);

/** Le statut d'image qu'on considère comme « net ». */
const SHARP_IMAGE_STATUS = 'highres_scan';

function imageStatusOf(c: ScryfallCard): string | undefined {
  return (c as { image_status?: string }).image_status;
}

/**
 * Combien une impression **ressemble** à celle que le joueur a choisie, hors
 * l'œuvre elle-même — qui, elle, est traitée à part parce qu'elle est décisive.
 *
 * Les poids ne cherchent pas à être exacts : ils ordonnent des signaux publiés
 * par Scryfall, du plus visible au moins visible. Le cadre et la bordure sautent
 * aux yeux (un *retro frame* de 1997 à côté d'un cadre moderne ne se confond
 * avec rien) ; la nature de l'édition se remarque moins.
 *
 * **Un trait inconnu de la référence ne départage personne** : il vaut `0` pour
 * tous les candidats, donc le classement retombe proprement sur la suite. C'est
 * exactement ce qui arrive aux cartes ingérées avant l'ajout des colonnes.
 */
function resemblanceScore(c: ScryfallCard, ref: PrintingTraits | null): number {
  if (!ref) return 0;
  let score = 0;
  if (ref.frame != null && ref.frame === (c.frame ?? null)) score += 8;
  if (ref.borderColor != null && ref.borderColor === (c.border_color ?? null)) score += 6;
  if (ref.frameEffects != null) {
    const mien = [...ref.frameEffects].sort().join(',');
    const sien = [...(c.frame_effects ?? [])].sort().join(',');
    if (mien === sien) score += 4;
  }
  if (ref.fullArt != null && ref.fullArt === (c.full_art ?? false)) score += 3;
  if (ref.textless != null && ref.textless === (c.textless ?? false)) score += 3;
  if (ref.setType != null && ref.setType === (c.set_type ?? null)) score += 2;
  return score;
}

/** Cette impression porte-t-elle la **même œuvre** que celle qu'on remplace ? */
function sameArtwork(c: ScryfallCard, ref: PrintingTraits | null): boolean {
  if (!ref?.illustrationId) return false;
  return illustrationIdsOf(c).includes(ref.illustrationId);
}

/** Le contexte d'un choix de substitution. */
export interface SubstituteContext {
  /**
   * Les traits de l'impression que le joueur a choisie. Sans elle, la
   * ressemblance ne peut pas se mesurer et le classement retombe **exactement**
   * sur la règle d'avant : qualité, score d'impression, date, identifiant.
   */
  reference?: PrintingTraits | null;
  /**
   * L'`image_status` de l'impression traduite **déjà servie**, quand il y en a
   * une. `undefined` veut dire qu'il n'y en a aucune (le cas `missing`) :
   * n'importe quelle impression affichable est alors un gain.
   *
   * Quand il y en a une, la substitution ne se justifie plus par la langue —
   * elle est déjà dans la bonne langue — mais seulement par la **netteté**, et
   * elle doit donc rapporter quelque chose. Voir `chooseSubstitute`.
   */
  servedImageStatus?: string | null;
  /** L'identifiant de l'impression servie, pour ne pas se substituer à soi-même. */
  servedScryfallId?: string | null;
}

/**
 * Laquelle des impressions traduites substituer.
 *
 * **Le problème d'hier, et il était réel.** La règle classait les candidates par
 * **qualité** : `highres_scan` d'abord, puis le `printingScore` du catalogue,
 * puis la date. Elle rendait donc la *meilleure* impression, jamais la plus
 * *ressemblante*. Un joueur qui avait délibérément choisi une illustration se
 * voyait proposer une autre œuvre — ou, mesuré sur *Lyra Dawnbringer* `FDN·707`,
 * la même œuvre mais dans le **cadre rétro de 1997**, alors qu'une impression
 * française au cadre moderne existait dans la même édition.
 *
 * **La règle, dans cet ordre :**
 *  1. écarter ce qui n'est pas affichable — pas d'image, ou une image de
 *     remplacement (`placeholder` / `missing`). Ressembler ne sert à rien si
 *     l'image ne porte ni l'illustration ni le texte ;
 *  2. si une impression traduite est **déjà servie**, ne garder que ce qui est
 *     franchement plus net qu'elle (voir plus bas) ;
 *  3. **la même œuvre d'abord** (`illustration_id`). C'est le critère décisif :
 *     une impression française de *son* illustration passe devant une impression
 *     de meilleure qualité d'une autre œuvre ;
 *  4. puis la ressemblance de présentation — cadre, effets de cadre, bordure,
 *     pleine illustration, sans texte, nature de l'édition (`resemblanceScore`) ;
 *  5. puis `highres_scan` avant `lowres` ;
 *  6. puis le `printingScore` du catalogue, celui-là même qui départage déjà les
 *     impressions quand une ligne de deck n'en précise aucune. On ne réinvente
 *     pas un second barème qui divergerait du premier ;
 *  7. puis la date de sortie, la plus récente d'abord ;
 *  8. puis l'identifiant, croissant.
 *
 * **Pourquoi la ressemblance passe avant la netteté.** L'illustration est un
 * choix **explicite** du joueur ; la netteté est une contrainte subie, et il l'a
 * de fait déjà acceptée puisqu'il lit ses cartes en français. Rendre une autre
 * œuvre au prétexte qu'elle est mieux scannée, c'est échanger ce qu'il a choisi
 * contre ce que nous préférons. Le conflit « même œuvre floue contre autre œuvre
 * nette » se tranche donc pour la même œuvre — et il ne se pose de toute façon
 * pas dans le cas *qualité*, où l'étape 2 a déjà écarté tout ce qui n'est pas net.
 *
 * **La substitution pour cause de qualité ne se fait que vers un gain réel.**
 * Deux conditions : la candidate est un `highres_scan`, et ce n'est pas
 * l'impression déjà servie. Remplacer un `lowres` par un autre `lowres` ne
 * changerait que l'illustration sans rien améliorer — le joueur perdrait l'œuvre
 * qu'il a choisie contre rien.
 *
 * **Faut-il aller jusqu'à changer d'œuvre pour gagner en netteté ? Oui, et c'est
 * mesuré.** Sur la base d'aujourd'hui, 128 lignes françaises sont servies floues
 * alors qu'une impression française nette existe ailleurs — mais **16 seulement**
 * portent la même œuvre, et ces 16 ne couvrent que **trois cartes distinctes**.
 * Exiger l'œuvre identique rendrait donc la règle à peu près inerte, et
 * laisserait le flou constaté par le joueur sur 112 lignes sur 128.
 *
 * Ce qui justifie l'échange, c'est le **sens de l'option** : « forcer une édition
 * disponible dans ma langue » dit déjà « je préfère lire ma carte, quitte à
 * changer d'édition ». Un joueur qui l'a cochée a accepté ce troc pour les
 * cartes sans version française ; l'appliquer à une version française illisible
 * est le même arbitrage, pas un nouveau. Et il n'est pas silencieux : le client
 * pose le repère `substituted`, qui nomme l'édition d'où vient l'illustration,
 * de sorte que le sélecteur d'impression ne ment jamais.
 *
 * L'ordre ci-dessus reste celui qui décide : **si une impression nette porte la
 * même œuvre, c'est elle qui gagne**, et le joueur ne perd rien du tout.
 *
 * **La stabilité vient des deux bouts.** L'ordre se termine sur l'identifiant,
 * donc il est **total** : à ensemble de candidats égal, il rend toujours la même
 * impression. Et le résultat est **écrit en base** à la première résolution :
 * même si Scryfall publiait demain une nouvelle impression française mieux
 * classée, la carte continuerait d'afficher celle qu'elle affichait hier.
 */
export function chooseSubstitute(
  candidates: readonly ScryfallCard[],
  context: SubstituteContext = {},
): ScryfallCard | null {
  const reference = context.reference ?? null;
  const dejaServi = context.servedImageStatus !== undefined;

  let usable = candidates.filter((c) => {
    if (!hasImage(c)) return false;
    const status = imageStatusOf(c);
    // Statut absent : on ne peut pas savoir, et l'image existe — on la garde.
    return status === undefined || USABLE_IMAGE_STATUS.has(status);
  });

  if (dejaServi) {
    // Déjà net : il n'y a rien à gagner, et tout à perdre.
    if (context.servedImageStatus === SHARP_IMAGE_STATUS) return null;
    usable = usable.filter(
      (c) => imageStatusOf(c) === SHARP_IMAGE_STATUS && c.id !== context.servedScryfallId,
    );
  }

  if (usable.length === 0) return null;

  const rank = (c: ScryfallCard): number => (imageStatusOf(c) === SHARP_IMAGE_STATUS ? 1 : 0);

  return [...usable].sort((a, b) => {
    const parOeuvre = Number(sameArtwork(b, reference)) - Number(sameArtwork(a, reference));
    if (parOeuvre !== 0) return parOeuvre;
    const parRessemblance = resemblanceScore(b, reference) - resemblanceScore(a, reference);
    if (parRessemblance !== 0) return parRessemblance;
    const parQualite = rank(b) - rank(a);
    if (parQualite !== 0) return parQualite;
    const parScore = printingScore(b) - printingScore(a);
    if (parScore !== 0) return parScore;
    const parDate = (b.released_at ?? '').localeCompare(a.released_at ?? '');
    if (parDate !== 0) return parDate;
    return a.id.localeCompare(b.id);
  })[0]!;
}

/** Des URL et des métadonnées d'identification. Rien d'autre n'est retenu. */
function toSubstitute(printing: ScryfallCard): SubstitutePrinting {
  const quality = printing as { image_status?: string; highres_image?: boolean };
  return {
    scryfallId: printing.id,
    setCode: printing.set,
    collectorNumber: printing.collector_number,
    imageUris: printing.image_uris ?? null,
    faces: localizedFaces(printing),
    imageStatus: quality.image_status ?? null,
    highresImage: quality.highres_image ?? false,
  };
}

/**
 * Ne garde de la réponse Scryfall que des URL et des noms — jamais de texte de
 * règles.
 *
 * `printedName` est aussi le seul champ que porte un enregistrement `missing` :
 * la carte n'a pas d'impression traduite **ici**, mais elle a souvent un nom
 * traduit ailleurs, et ce nom-là est le même quelle que soit l'édition.
 *
 * `searchSettled` dit que la question de la substitution est **tranchée** pour
 * cette ligne : soit la recherche a réellement eu lieu, soit elle n'avait pas
 * lieu d'être — c'est le cas d'un terrain de base, qui ne se substitue jamais.
 * Faux, le compteur reste à `0` et la ligne attendra son rattrapage.
 */
export function toLocalizationRecord(
  scryfallId: string,
  language: Language,
  printing: ScryfallCard | null,
  elsewhere: LocalizedElsewhere | null = null,
  searchSettled = false,
): LocalizationRecord {
  if (!printing) {
    return {
      scryfallId,
      language,
      localizedScryfallId: null,
      printedName: elsewhere?.printedName ?? null,
      imageUris: null,
      faces: null,
      imageStatus: null,
      highresImage: false,
      nameChecked: searchSettled,
      // Le compteur ne monte que si la question a **été tranchée**. Sinon la
      // ligne reste à `0` : elle est en attente de rattrapage, pas cherchée en
      // vain.
      substituteSearchVersion: searchSettled ? SUBSTITUTE_SEARCH_VERSION : 0,
      missing: true,
      substitute: elsewhere?.substitute ?? null,
    };
  }
  // `image_status` et `highres_image` ne sont pas dans `ScryfallCard` : ce type
  // décrit ce dont l'ingestion a besoin, et l'élargir toucherait l'ingestion.
  const quality = printing as { image_status?: string; highres_image?: boolean };
  const imageStatus = quality.image_status ?? null;
  /*
   * L'impression traduite existe. Elle **n'appelle plus forcément** de
   * substitution — mais elle n'est plus close d'office non plus : quand son
   * scan est flou, une autre édition française nette peut valoir la peine, et
   * c'est `chooseSubstitute` qui en juge. Une impression déjà nette, elle, est
   * close des deux côtés : ni langue ni netteté à gagner.
   */
  const dejaNette = imageStatus === SHARP_IMAGE_STATUS;
  return {
    scryfallId,
    language,
    localizedScryfallId: printing.id,
    printedName: printedNameOf(printing),
    imageUris: printing.image_uris ?? null,
    faces: localizedFaces(printing),
    imageStatus,
    highresImage: quality.highres_image ?? false,
    // Le nom vient de l'impression traduite elle-même : rien à chercher ailleurs.
    nameChecked: true,
    substituteSearchVersion: dejaNette || searchSettled ? SUBSTITUTE_SEARCH_VERSION : 0,
    missing: false,
    substitute: elsewhere?.substitute ?? null,
  };
}

/**
 * Même forme que `Card.faces` — une image par face —, mais avec le nom imprimé
 * de chaque face quand Scryfall le donne. Sans cela, une carte française
 * recto-verso s'annonçait en anglais dès qu'on la retournait.
 */
export function localizedFaces(printing: ScryfallCard): Array<Record<string, unknown>> | null {
  const faces = compactFaces(printing);
  if (!faces) return null;
  return faces.map((face, i) => {
    const printed = (printing.card_faces?.[i] as { printed_name?: string } | undefined)?.printed_name;
    return printed ? { ...face, name: printed } : face;
  });
}

/**
 * Le `printed_name` d'une carte recto-verso vit sur ses faces : Scryfall ne le
 * pose pas au premier niveau. On recompose alors « recto // verso », comme le
 * fait `name` pour les cartes anglaises.
 */
export function printedNameOf(printing: ScryfallCard): string {
  const top = (printing as { printed_name?: string }).printed_name;
  if (top) return top;
  const faces = (printing.card_faces ?? [])
    .map((f) => (f as { printed_name?: string; name: string }).printed_name ?? f.name)
    .filter(Boolean);
  return faces.length > 0 ? faces.join(' // ') : printing.name;
}

/**
 * La carte telle qu'elle sort du catalogue, sans traduction.
 *
 * `printedName` peut malgré tout être traduit : voir `applyRecord`. C'est le
 * seul endroit du contrat où la langue du **nom** et celle de l'**image**
 * divergent, et c'est assumé — l'illustration reste celle que le joueur a
 * choisie, le nom devient lisible.
 */
function asCatalog(
  card: CatalogCard,
  language: Language,
  pending: boolean,
  printedName: string | null = null,
  substitute: SubstitutePrinting | null = null,
): LocalizedCard {
  return {
    substitute,
    scryfallId: card.scryfallId,
    language: CATALOG_LANGUAGE,
    fallback: language !== CATALOG_LANGUAGE,
    pending,
    localizedScryfallId: null,
    name: card.name,
    printedName: printedName ?? card.name,
    // Le catalogue anglais que nous ingérons est intégralement en haute
    // définition : nous n'en stockons donc pas le statut d'image.
    imageStatus: null,
    highresImage: true,
    imageUris: card.imageUris ?? null,
    faces: card.faces ?? null,
  };
}

/**
 * `outstanding` : la recherche de substitution de cette ligne est encore à
 * faire, et le plafond de la requête l'a renvoyée à la file de fond.
 *
 * On le publie alors en `pending`, et ce n'est pas un détail : le cache client
 * est indexé par `(scryfallId, langue)` et ne redemande **que** les `pending`.
 * Sans ce drapeau, une carte servie pendant le rattrapage serait mise en cache
 * comme réponse définitive, et la substitution écrite trente secondes plus tard
 * par la file de fond n'atteindrait le joueur qu'au rechargement de la page.
 * C'est le sens même de `pending` : « la résolution n'a pas encore eu lieu ».
 *
 * **Il ne vaut que pour une ligne `missing`.** Sur une ligne qui a bien son
 * impression traduite, `pending` ferait redescendre l'affichage sur l'anglais
 * alors que le français est là — voir plus bas.
 */
function applyRecord(
  card: CatalogCard,
  record: LocalizationRecord,
  outstanding = false,
): LocalizedCard {
  // Pas d'impression traduite de **cette** édition : on rend l'illustration
  // anglaise, mais on garde le nom français si on a su le retrouver ailleurs.
  if (record.missing) {
    return asCatalog(card, record.language, outstanding, record.printedName, record.substitute);
  }
  return {
    /*
     * L'impression choisie existe bien dans cette langue — et pourtant une
     * substitution peut l'accompagner : quand son scan est flou, on a retenu une
     * autre édition française **nette**. Le client ne la montre que s'il a coché
     * l'option, exactement comme dans le cas `missing`.
     */
    substitute: record.substitute,
    scryfallId: card.scryfallId,
    language: record.language,
    fallback: false,
    /*
     * **Jamais `pending` ici, même quand la recherche de netteté reste à faire.**
     *
     * Le drapeau a un effet côté client qu'on ne veut surtout pas : une
     * impression localisée `pending` n'est **pas** utilisée par
     * `resolveCardImage`, qui redescend sur le catalogue anglais. Le poser sur
     * une carte dont l'impression française existe et s'affiche très bien
     * remplacerait du français par de l'anglais pendant tout le rattrapage —
     * 727 lignes au premier balayage, c'est-à-dire l'inverse exact de ce que ce
     * chantier cherche.
     *
     * Ce qu'on perd est mineur et connu : la substitution de netteté écrite par
     * la file de fond n'atteindra le joueur qu'au prochain chargement, puisque
     * son cache est indexé par `(carte, langue)` et ne redemande que les
     * `pending`. Il garde d'ici là l'illustration française qu'il avait déjà.
     * La carte reste malgré tout dans `unresolved` : la file de fond, elle,
     * termine bien le travail.
     */
    pending: false,
    localizedScryfallId: record.localizedScryfallId,
    name: card.name,
    printedName: record.printedName ?? card.name,
    imageStatus: record.imageStatus,
    highresImage: record.highresImage,
    // Une impression traduite a toujours sa propre illustration ; si elle en
    // manquait, mieux vaut l'image anglaise qu'un cadre vide.
    imageUris: record.imageUris ?? card.imageUris ?? null,
    faces: record.faces ?? card.faces ?? null,
  };
}

/**
 * Une ligne déjà en base, complétée par ce qu'une **autre impression** vient
 * d'apprendre.
 *
 * **Une seule implémentation, appelée par les deux chemins.** Le rattrapage
 * réseau et le rattrapage par le bulk écrivent donc littéralement les mêmes
 * colonnes, et non deux blocs jumeaux qui divergeraient à la première
 * correction faite d'un seul côté. La source des candidates change ; ce qu'on
 * en retient, non.
 */
function completerDepuisAilleurs(
  known: LocalizationRecord,
  ailleurs: LocalizedElsewhere | null,
): LocalizationRecord {
  return {
    ...known,
    // Le nom déjà connu ne se perd pas si la recherche n'en rend plus :
    // il a été vrai une fois, il l'est encore.
    printedName: ailleurs?.printedName ?? known.printedName,
    substitute: ailleurs?.substitute ?? null,
    /*
     * La même recherche a relu l'impression **servie** : 109 lignes de la base
     * datent d'avant la colonne `imageStatus` et ne savaient pas dire si ce
     * qu'elles montrent est net. Corriger le statut ici ne coûte pas un appel
     * de plus, et évite qu'elles repassent sans fin.
     */
    ...(ailleurs?.servedImageStatus !== undefined
      ? {
          imageStatus: ailleurs.servedImageStatus,
          highresImage: ailleurs.servedHighresImage ?? known.highresImage,
        }
      : {}),
    nameChecked: true,
    substituteSearchVersion: SUBSTITUTE_SEARCH_VERSION,
  };
}

export interface ResolveOptions {
  cards: CatalogCard[];
  language: Language;
  store: LocalizationStore;
  fetch: LocalizedPrintingFetcher;
  /**
   * Le rattrapage par une **autre impression**, quand l'impression exacte
   * n'existe pas dans la langue demandée : le nom traduit, et la substitution
   * que le joueur pourra demander. Facultatif : sans lui, un 404 reste un repli
   * anglais complet, exactement comme avant.
   */
  fetchElsewhere?: LocalizedElsewhereFetcher;
  /**
   * Le catalogue des impressions traduites, quand il est disponible. Sans lui,
   * la résolution se comporte exactement comme avant : réseau, plafond et
   * `pending`. C'est volontairement facultatif — une base vierge dont
   * l'ingestion n'a pas encore tourné doit rester utilisable.
   */
  bulk?: BulkLocalizationSource;
  maxLookups?: number;
}

export interface ResolveResult {
  language: Language;
  cards: LocalizedCard[];
  /** Nombre d'appels réellement passés à Scryfall : ce que les tests surveillent. */
  lookups: number;
  /**
   * Ce que le plafond a laissé de côté : ni en base, ni résolu. C'est ce que la
   * résolution de fond reprend, pour que le prochain passage n'ait plus rien à
   * demander à Scryfall.
   */
  unresolved: CatalogCard[];
}

/**
 * Résout un lot de cartes dans une langue.
 *
 * L'ordre de sortie suit celui de l'entrée, et une carte inconnue du catalogue
 * n'apparaît simplement pas : c'est à l'appelant de constater le manque.
 */
export async function resolveLocalizedCards({
  cards,
  language,
  store,
  fetch,
  fetchElsewhere,
  bulk,
  maxLookups = MAX_LIVE_LOOKUPS_PER_REQUEST,
}: ResolveOptions): Promise<ResolveResult> {
  // Le catalogue est anglais : demander l'anglais ne coûte ni base ni réseau.
  if (language === CATALOG_LANGUAGE) {
    return {
      language,
      cards: cards.map((c) => asCatalog(c, language, false)),
      lookups: 0,
      unresolved: [],
    };
  }

  const cached = new Map<string, LocalizationRecord>();
  for (const record of await store.load(
    cards.map((c) => c.scryfallId),
    language,
  )) {
    cached.set(record.scryfallId, record);
  }

  /*
   * ——— Le catalogue localisé, interrogé une fois pour tout le lot
   *
   * On ne demande que ce qui reste à faire : une carte déjà résolue et à jour
   * n'a rien à y gagner, et la relire coûterait deux jointures pour rien. Le
   * filtre est **exactement** celui qui déclencherait un appel réseau plus bas.
   *
   * Une panne de base ne se mémorise pas plus qu'une panne de Scryfall : on
   * repart simplement sur le chemin paresseux, plafond compris.
   */
  let bulkAnswers = new Map<string, BulkAnswer>();
  if (bulk) {
    const aChercher = cards.filter((card) => {
      const known = cached.get(card.scryfallId);
      return !known || needsSubstituteSearch(known, card);
    });
    if (aChercher.length > 0) {
      try {
        bulkAnswers = await bulk.lookup(aChercher, language);
      } catch {
        bulkAnswers = new Map();
      }
    }
  }

  const fresh: LocalizationRecord[] = [];
  const out: LocalizedCard[] = [];
  const unresolved: CatalogCard[] = [];
  let lookups = 0;

  for (const card of cards) {
    const known = cached.get(card.scryfallId);
    if (known) {
      /*
       * Rattrapage des lignes écrites avant que la substitution n'existe :
       * elles disent « pas d'impression traduite » sans dire si une autre
       * édition pourrait la remplacer. On complète **une** fois — le compteur
       * `substituteSearchVersion` empêche d'y revenir, même quand la réponse
       * est « rien ».
       *
       * La condition ne se lit plus sur `nameChecked` : ce drapeau était déjà
       * `true` sur les lignes d'avant, et les fermait à jamais.
       */
      /*
       * Le rattrapage par le catalogue localisé : la même recherche, mais en
       * base. Il passe **avant** le chemin réseau et ne consomme pas le
       * plafond — c'est tout l'objet du bulk. Le compteur monte, donc la ligne
       * ne repassera plus, exactement comme après une recherche Scryfall.
       */
      const enMasse = bulkAnswers.get(card.scryfallId);
      if (needsSubstituteSearch(known, card) && enMasse) {
        const ailleurs = elsewhereFromCandidates(card, enMasse.candidates);
        const complete = completerDepuisAilleurs(known, ailleurs);
        fresh.push(complete);
        cached.set(card.scryfallId, complete);
        out.push(applyRecord(card, complete));
        continue;
      }

      const aRattraper = needsSubstituteSearch(known, card) && Boolean(fetchElsewhere);
      if (aRattraper && fetchElsewhere && lookups < maxLookups) {
        lookups += 1;
        try {
          const ailleurs = await fetchElsewhere(card, language);
          const complete = completerDepuisAilleurs(known, ailleurs);
          fresh.push(complete);
          cached.set(card.scryfallId, complete);
          out.push(applyRecord(card, complete));
          continue;
        } catch {
          // Panne : on garde la ligne telle quelle et on réessaiera plus tard.
          // Rien n'est écrit, donc le compteur reste en retard — la carte
          // repassera, et un 503 ne se grave pas en « pas de substitut ».
          out.push(applyRecord(card, known, true));
          unresolved.push(card);
          continue;
        }
      }
      if (aRattraper) {
        // Le plafond est atteint : la tâche de fond finira le rattrapage. Sans
        // cela, une ligne ancienne n'aurait droit qu'à une chance par requête.
        unresolved.push(card);
        out.push(applyRecord(card, known, true));
        continue;
      }
      out.push(applyRecord(card, known));
      continue;
    }

    /*
     * ——— Première résolution, sans réseau
     *
     * Le bulk connaît cette carte : il répond pour les **deux** appels que le
     * chemin réseau aurait passés — l'impression traduite de cette édition, et
     * ses sœurs. La condition `chercherAilleurs` est recopiée mot pour mot du
     * chemin réseau, et ce n'est pas de la superstition : sans elle, une
     * impression déjà nette recevrait ici une substitution que le réseau ne lui
     * aurait jamais écrite, et les deux chemins produiraient deux lignes
     * différentes pour la même carte selon l'ordre où elles ont été vues.
     */
    const enMasse = bulkAnswers.get(card.scryfallId);
    if (enMasse) {
      const terrainDeBase = isBasicLandTypeLine(card.typeLine);
      const chercherAilleurs =
        !terrainDeBase &&
        (!enMasse.printing || imageStatusOf(enMasse.printing) !== SHARP_IMAGE_STATUS);
      const ailleurs = chercherAilleurs
        ? elsewhereFromCandidates(card, enMasse.candidates)
        : null;
      const record = toLocalizationRecord(
        card.scryfallId,
        language,
        enMasse.printing,
        ailleurs,
        chercherAilleurs || terrainDeBase,
      );
      fresh.push(record);
      cached.set(card.scryfallId, record);
      out.push(applyRecord(card, record));
      continue;
    }

    if (lookups >= maxLookups) {
      out.push(asCatalog(card, language, true));
      unresolved.push(card);
      continue;
    }

    lookups += 1;
    try {
      const printing = await fetch(card, language);
      /*
       * Deux raisons de regarder une **autre** impression, et un seul appel pour
       * les deux :
       *  - il n'y a pas d'impression traduite de cette édition (404) : la
       *    substitution apporte la **langue** ;
       *  - il y en a une, mais son scan n'est pas net : elle peut apporter la
       *    **netteté**, et `chooseSubstitute` refusera de bouger si le gain
       *    n'est pas réel.
       *
       * L'appel rend aussi le nom, servi d'office. La ligne est écrite juste
       * après, 404 compris, et on ne repassera jamais ici.
       *
       * **Sauf pour un terrain de base**, qui ne se substitue jamais : on
       * économise l'appel et on ferme la ligne. Voir `isBasicLandTypeLine`.
       */
      const terrainDeBase = isBasicLandTypeLine(card.typeLine);
      const chercherAilleurs =
        Boolean(fetchElsewhere) &&
        !terrainDeBase &&
        (!printing || imageStatusOf(printing) !== SHARP_IMAGE_STATUS);

      let ailleurs: LocalizedElsewhere | null = null;
      if (chercherAilleurs && fetchElsewhere) {
        lookups += 1;
        ailleurs = await fetchElsewhere(card, language);
      }
      const record = toLocalizationRecord(
        card.scryfallId,
        language,
        printing,
        ailleurs,
        chercherAilleurs || terrainDeBase,
      );
      fresh.push(record);
      cached.set(card.scryfallId, record);
      out.push(applyRecord(card, record));
    } catch {
      /*
       * Panne de Scryfall, pas absence de traduction : on ne mémorise rien —
       * écrire `missing` ici graverait un repli anglais définitif à cause d'une
       * indisponibilité passagère. La carte revient `pending`, et le prochain
       * passage retentera.
       *
       * Le nom cherché ailleurs tombe dans le même filet : un échec de la
       * recherche laisse la carte `pending` plutôt que d'écrire une ligne
       * `missing` sans nom, qu'on ne relirait jamais.
       */
      out.push(asCatalog(card, language, true));
      unresolved.push(card);
    }
  }

  if (fresh.length > 0) await store.save(fresh);
  return { language, cards: out, lookups, unresolved };
}

/**
 * La résolution de fond : ce que le plafond a laissé de côté.
 *
 * **Pourquoi elle existe.** Le plafond par requête protège la connexion du
 * joueur, pas notre quota — mesuré sur un deck de 84 cartes froides, le client
 * n'en obtenait que 40 en français (20 au premier passage, 20 au rattrapage), et
 * les 44 autres restaient anglaises jusqu'au rechargement de la page, sans
 * qu'aucune d'elles ne soit un vrai 404. Le plafond dur était donc devenu la
 * première cause de « carte non traduite ».
 *
 * La file continue le travail **après** la réponse, au rythme du
 * `RateLimitedFetcher` partagé — le même robinet que l'ingestion, donc sans
 * sortir du quota. Quand le client redemande ses `pending`, le serveur n'a plus
 * qu'à relire la base : aucun appel vivant, réponse immédiate.
 *
 * Trois gardes :
 *  - **une seule file** en vol, sinon plusieurs tables se mettraient à tirer
 *    en parallèle sur un robinet séquentiel ;
 *  - **un plafond de file** (`MAX_BACKGROUND_QUEUE`), pour qu'une rafale de
 *    requêtes ne fasse pas enfler la mémoire indéfiniment ;
 *  - **rien n'est mémorisé d'une panne**, puisque c'est `resolveLocalizedCards`
 *    qui travaille : la règle du 503 tient aussi ici.
 */
export const MAX_BACKGROUND_QUEUE = 2000;
/** Par tranches, pour rendre la main et relire ce qui a pu être résolu entre-temps. */
const BACKGROUND_SLICE = 10;

interface BackgroundJob {
  card: CatalogCard;
  language: Language;
}

const backgroundQueue = new Map<string, BackgroundJob>();
let backgroundRunning = false;
/** La vidange en cours, pour que le rattrapage puisse l'attendre sans sonder. */
let backgroundDrain: Promise<void> | null = null;

/**
 * Se résout quand la file de fond est vide.
 *
 * Le rattrapage de masse s'en sert pour avancer **tranche par tranche** : sans
 * cela il déverserait ses milliers de cartes d'un coup dans une file plafonnée,
 * et tout ce qui dépasse `MAX_BACKGROUND_QUEUE` serait silencieusement perdu.
 */
export function backgroundLocalizationIdle(): Promise<void> {
  return backgroundDrain ?? Promise.resolve();
}

export interface BackgroundDeps {
  store: LocalizationStore;
  fetch: LocalizedPrintingFetcher;
  fetchElsewhere?: LocalizedElsewhereFetcher;
  /**
   * Le catalogue localisé vaut aussi ici, et c'est ce qui vide la file de fond
   * au lieu de l'étaler : une tranche que le bulk tranche entièrement ne passe
   * plus une seconde dans le `RateLimitedFetcher`.
   */
  bulk?: BulkLocalizationSource;
}

/** Met en file ce qui n'a pas pu être résolu. Ne rend jamais d'erreur à l'appelant. */
export function scheduleBackgroundLocalization(
  cards: readonly CatalogCard[],
  language: Language,
  deps: BackgroundDeps,
): void {
  if (language === CATALOG_LANGUAGE) return;
  for (const card of cards) {
    if (backgroundQueue.size >= MAX_BACKGROUND_QUEUE) break;
    backgroundQueue.set(`${language}:${card.scryfallId}`, { card, language });
  }
  if (backgroundRunning || backgroundQueue.size === 0) return;
  backgroundRunning = true;
  backgroundDrain = drainBackground(deps).finally(() => {
    backgroundRunning = false;
    backgroundDrain = null;
  });
  void backgroundDrain;
}

async function drainBackground(deps: BackgroundDeps): Promise<void> {
  while (backgroundQueue.size > 0) {
    const batch = [...backgroundQueue.entries()].slice(0, BACKGROUND_SLICE);
    for (const [key] of batch) backgroundQueue.delete(key);

    // Une tranche ne mélange pas les langues : la résolution en prend une seule.
    const byLanguage = new Map<Language, CatalogCard[]>();
    for (const [, job] of batch) {
      const list = byLanguage.get(job.language) ?? [];
      list.push(job.card);
      byLanguage.set(job.language, list);
    }

    for (const [language, list] of byLanguage) {
      try {
        await resolveLocalizedCards({
          cards: list,
          language,
          store: deps.store,
          fetch: deps.fetch,
          ...(deps.fetchElsewhere ? { fetchElsewhere: deps.fetchElsewhere } : {}),
          ...(deps.bulk ? { bulk: deps.bulk } : {}),
          // Pas de plafond ici : personne n'attend au bout du fil. Le rythme est
          // tenu par le `RateLimitedFetcher`, pas par un compteur.
          maxLookups: Number.POSITIVE_INFINITY,
        });
      } catch {
        // Une tranche perdue n'est pas une absence : elle n'a rien écrit, et la
        // prochaine demande du client la remettra en file.
      }
    }
  }
}

/** Remise à zéro de la file. N'existe que pour les tests. */
export function resetBackgroundLocalization(): void {
  backgroundQueue.clear();
  backgroundDrain = null;
  backgroundRunning = false;
  prochainBalayage.clear();
}

/* ————————————————————————————————————————————————————————————————————————
 * Le rattrapage de masse.
 * ——————————————————————————————————————————————————————————————————————— */

/**
 * Les cartes dont la substitution reste à chercher, lues en base.
 *
 * Injecté plutôt qu'importé : la décision — combien à la fois, quand s'arrêter,
 * comment ne pas boucler — se teste alors sans Postgres.
 */
export type PendingSubstituteLoader = (
  language: Language,
  limit: number,
) => Promise<CatalogCard[]>;

/** La tranche du rattrapage : assez pour avancer, assez peu pour rendre la main. */
export const BACKFILL_SLICE = 100;
/**
 * Le plafond d'un balayage.
 *
 * Il borne le travail d'un processus sur une langue. Au-delà, le balayage
 * s'arrête et reprendra au prochain démarrage ou à la prochaine langue
 * demandée : mieux vaut un rattrapage qui progresse par paliers qu'un
 * rattrapage qui tire sur Scryfall sans fin visible.
 */
export const MAX_BACKFILL_PER_SWEEP = 5_000;

export interface BackfillDeps extends BackgroundDeps {
  loadPending: PendingSubstituteLoader;
}

/**
 * Rattrape les lignes que le verrou avait laissées derrière.
 *
 * **Pourquoi il faut un balayage et pas seulement le chemin de lecture.** Lever
 * le verrou suffit à ce qu'une carte *réaffichée* obtienne sa substitution. Mais
 * les 555 lignes de la base ne sont pas toutes réaffichées : un deck rangé, une
 * carte croisée une fois, et la ligne dort. Le rattrapage resterait théorique.
 * Ce balayage-ci va les chercher **là où elles sont** — en base — et les fait
 * passer par le même chemin que tout le reste.
 *
 * **Comment il ne déborde pas.** Il n'ouvre aucun chemin réseau à lui : il
 * remplit la file de fond, qui tire sur le `RateLimitedFetcher` partagé, au même
 * rythme que l'ingestion. Il attend chaque tranche avant d'en charger une autre,
 * donc la file ne dépasse jamais sa taille de tranche et rien n'est perdu au
 * plafond. Personne n'attend au bout d'une connexion HTTP : le balayage est
 * lancé sans être attendu.
 *
 * **Comment il se termine.** Trois issues, et aucune n'est une boucle :
 *  - la base ne rend plus rien à faire : c'est fini ;
 *  - une tranche ne rend que des cartes déjà tentées dans ce balayage — c'est
 *    le signe que Scryfall n'écrit plus (panne), et rien ne sert d'insister :
 *    les lignes gardent leur compteur en retard et seront reprises plus tard ;
 *  - le plafond `MAX_BACKFILL_PER_SWEEP` est atteint.
 *
 * Rend le nombre de cartes réellement soumises.
 */
export async function backfillSubstitutes(
  language: Language,
  deps: BackfillDeps,
  slice = BACKFILL_SLICE,
): Promise<number> {
  if (language === CATALOG_LANGUAGE) return 0;

  const tentees = new Set<string>();
  while (tentees.size < MAX_BACKFILL_PER_SWEEP) {
    const cards = await deps.loadPending(language, slice);
    if (cards.length === 0) return tentees.size;

    const neuves = cards.filter((c) => !tentees.has(c.scryfallId));
    // Rien de neuf : la tranche précédente n'a rien écrit. On s'arrête plutôt
    // que de redemander les mêmes cartes à un Scryfall qui ne répond pas.
    if (neuves.length === 0) return tentees.size;
    for (const c of neuves) tentees.add(c.scryfallId);

    scheduleBackgroundLocalization(neuves, language, deps);
    await backgroundLocalizationIdle();
    /*
     * Course bénigne : une vidange qui se terminait au moment précis où l'on
     * mettait la tranche en file la laisse en place sans la traiter. On relance
     * alors une vidange à vide plutôt que d'abandonner la tranche.
     */
    if (backgroundQueue.size > 0) {
      scheduleBackgroundLocalization([], language, deps);
      await backgroundLocalizationIdle();
    }
  }
  return tentees.size;
}

/**
 * Le délai avant qu'un balayage puisse repartir sur la même langue.
 *
 * **Pourquoi ce n'est plus « une fois par processus ».** Le balayage s'arrête
 * proprement dès qu'une tranche entière échoue — c'est le garde-fou anti-boucle,
 * et il est juste. Mais `/cards/search` de Scryfall est nettement plus avare que
 * `/cards/{id}` : mesuré ici, une vingtaine de recherches consécutives suffisent
 * à déclencher un 429. Un rattrapage de neuf cents lignes s'arrêtait donc au
 * bout de vingt, et ne repartait **qu'au redémarrage du serveur** — ce qui, sur
 * une machine qui tourne des semaines, revient à ne jamais finir.
 *
 * Dix minutes est un compromis lisible : assez pour que le quota de Scryfall se
 * reconstitue, assez peu pour qu'un rattrapage aboutisse dans la journée sans
 * que personne n'ait à toucher à quoi que ce soit.
 */
export const BACKFILL_RETRY_MS = 10 * 60_000;

/** Quand chaque langue a le droit de repartir. Remplace le « déjà balayé ». */
const prochainBalayage = new Map<Language, number>();

/**
 * Lance le balayage d'une langue, sans l'attendre, au plus une fois par
 * `BACKFILL_RETRY_MS`.
 *
 * Appelé depuis la route des cartes localisées : le rattrapage démarre quand
 * quelqu'un joue effectivement dans cette langue, ce qui évite de faire chauffer
 * Scryfall sur un serveur que personne n'utilise, et évite surtout de le faire
 * au démarrage, quand l'ingestion tient déjà le robinet.
 *
 * Quand il n'y a plus rien à rattraper, le balayage rend `0` immédiatement sans
 * toucher au réseau : le rappel périodique ne coûte alors qu'une requête en base
 * toutes les dix minutes, et seulement si quelqu'un joue en français.
 */
export function scheduleSubstituteBackfill(language: Language, deps: BackfillDeps): void {
  if (language === CATALOG_LANGUAGE) return;
  const maintenant = Date.now();
  if (maintenant < (prochainBalayage.get(language) ?? 0)) return;
  prochainBalayage.set(language, maintenant + BACKFILL_RETRY_MS);
  void backfillSubstitutes(language, deps).catch(() => {
    // Un balayage perdu n'a rien gravé : les lignes gardent leur compteur en
    // retard, et la prochaine fenêtre reprendra là où il s'est arrêté.
  });
}
