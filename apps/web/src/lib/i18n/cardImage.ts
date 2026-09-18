/**
 * Quelle illustration afficher, selon la langue.
 *
 * **Pourquoi ce n'est pas une réécriture d'URL.** Chez Scryfall, une carte
 * française n'est pas la même carte avec une autre image : c'est un **objet
 * distinct**, de même édition et même numéro de collection, mais d'identifiant
 * différent, avec ses propres `image_uris`. On ne peut donc pas fabriquer
 * l'URL française à partir de l'identifiant anglais — il faut la résolution que
 * l'API des cartes rend (`POST /api/cards/localized`). Ce fichier ne fait que
 * **choisir** parmi ce qui est déjà là.
 *
 * **Invariant de droits, non négociable.** Cette fonction rend une URL Scryfall
 * et rien d'autre. Rien de Wizards of the Coast n'est hébergé, proxifié, ni mis
 * en cache par nous — un cache est une copie. Pas de préchargement, pas de
 * `Image()` déclenchée ici, pas de service worker qui garderait une jaquette :
 * c'est le navigateur du joueur qui va chercher l'image, directement, chez
 * Scryfall, comme il le fait déjà pour le catalogue anglais.
 *
 * La fonction est **pure** : mêmes entrées, même URL, aucun effet de bord.
 */
import { SCRYFALL_LANG, type Language } from '@mtg/shared';
import { scryfallImage } from '../cards.js';
import { isTokenTypeLine } from './tokenNames.js';

export type ImageVersion = 'small' | 'normal' | 'large';

/** Ce qu'on lit d'un `image_uris` Scryfall. Les autres tailles ne servent pas ici. */
export interface ImageUris {
  small?: string | undefined;
  normal?: string | undefined;
  large?: string | undefined;
}

/** Une face de carte recto-verso, telle que l'API la renvoie déjà (`CardMeta.faces`). */
export interface FaceLike {
  name?: string;
  imageUris?: ImageUris | null;
}

/** Une source d'images : la carte du catalogue, ou son impression localisée. */
export interface ImageSource {
  scryfallId: string;
  imageUris?: ImageUris | null;
  faces?: readonly FaceLike[] | null;
  /**
   * La ligne de type **anglaise** du catalogue (`CardMeta.typeLine`), lue par la
   * seule exception de ce fichier : les terrains de base. Facultative — une
   * carte dont les métadonnées ne sont pas encore arrivées se comporte comme
   * avant, c'est-à-dire comme une carte ordinaire.
   */
  typeLine?: string | null;
}

/**
 * Un terrain de base, et **rien d'autre**.
 *
 * **L'exception, et la raison qui la justifie.** Un terrain de base n'a pas de
 * texte à lire : l'illustration *est* la carte, et c'est souvent pour elle qu'on
 * choisit une édition. Un joueur qui monte son deck avec les Plaines d'Amonkhet
 * ne veut pas les voir remplacées par celles d'une autre extension au nom d'une
 * traduction dont il n'a que faire ; et un repère « non traduite » sur une
 * Plaine ne lui apprend rien tout en salissant son terrain, à raison de vingt ou
 * trente exemplaires par table. Donc, pour un terrain de base et lui seul : ni
 * substitution d'édition, ni repère de langue.
 *
 * Quelqu'un finira par vouloir « uniformiser » cette exception. Ce paragraphe
 * est là pour qu'il sache ce qu'il retire.
 *
 * **Le critère est le supertype `Basic` accompagné du type `Land`**, pas le nom
 * de la carte : `Basic Land — Plains`, `Basic Land` (*Wastes*) et
 * `Basic Snow Land — Island` en sont ; `Land — Plains Island` (les duals
 * originels), les fetchlands et tous les terrains à texte n'en sont pas — pour
 * eux la traduction compte vraiment —, et `Basic Creature — Shapeshifter` non
 * plus. Supertypes et types précèdent le tiret cadratin : on ne lit que ce qui
 * est devant lui.
 *
 * **Toujours sur la ligne de type anglaise du catalogue**, jamais sur un
 * `printed_type_line` : celui-ci dirait « Terrain de base » et le critère
 * casserait pour un joueur anglophone. Le miroir serveur de cette règle est
 * `isBasicLandTypeLine` (`apps/server/src/cards/scryfall.ts`).
 */
const BASIC_LAND_TYPE_LINE = /^\s*Basic\b[^—/]*\bLand\b/;

export function isBasicLand(source: ImageSource | null | undefined): boolean {
  return BASIC_LAND_TYPE_LINE.test(source?.typeLine ?? '');
}

/**
 * Le résultat d'une résolution localisée, tel que `POST /api/cards/localized`
 * le rend. On n'en lit que ce dont l'affichage a besoin ; le reste (nom
 * imprimé, `pending`) intéresse d'autres composants.
 */
export interface LocalizedPrinting extends ImageSource {
  /** La langue réellement servie : elle vaut `'en'` quand le serveur a replié. */
  language: string;
  /**
   * Vrai dès que l'anglais est servi à la place de la langue demandée. C'est le
   * cas **courant** — la plupart des cartes n'ont jamais été imprimées en
   * français — et non une erreur.
   *
   * Attention : ce drapeau **ne dit pas** que la réponse est définitive. Le
   * serveur le pose aussi sur une carte qu'il n'a pas eu le temps de résoudre,
   * qui porte alors `pending` en plus. Testez donc toujours `pending` avant de
   * conclure quoi que ce soit de `fallback`.
   */
  fallback?: boolean;
  /**
   * Vrai quand la résolution n'a **pas encore eu lieu** : le serveur plafonne
   * ses appels vivants à Scryfall par requête. La carte revient en anglais,
   * affichable immédiatement, et redemander plus tard rendra la traduction.
   * C'est le seul drapeau qui distingue « pas de traduction » de « pas encore
   * cherché », puisque les deux portent `fallback`.
   */
  pending?: boolean;
  /** L'identifiant de l'impression traduite, différent de celui du protocole. */
  localizedScryfallId?: string | null;
  /**
   * `image_status` de Scryfall pour l'impression servie — `missing`,
   * `placeholder`, `lowres` ou `highres_scan`. Voir `USABLE_IMAGE_STATUS`.
   */
  imageStatus?: string | null;
  /** `highres_image` de Scryfall. Informatif : la décision se prend sur le statut. */
  highresImage?: boolean;
  /**
   * Une **autre** impression de la même carte, celle-là traduite.
   *
   * Le serveur la retient quand l'impression choisie n'existe pas dans la
   * langue demandée, et la publie toujours — mais elle n'est **jamais** servie
   * d'office : il faut que l'appelant passe `allowSubstitute`. La raison tient
   * en une phrase : l'illustration est un choix du joueur, et la changer sans
   * qu'il l'ait demandé ferait voir deux images différentes à deux joueurs de
   * la même table.
   */
  substitute?: SubstitutePrinting | null;
}

/** Une impression de substitution, telle que l'affichage la lit. */
export interface SubstitutePrinting extends ImageSource {
  /** L'édition d'où vient cette illustration : l'interface doit pouvoir la dire. */
  setCode?: string | null;
  collectorNumber?: string | null;
  imageStatus?: string | null;
  highresImage?: boolean;
}

/**
 * Les statuts d'image qu'on accepte d'afficher à la place de l'anglais.
 *
 * **L'arbitrage, et il n'est pas évident.** Les impressions non anglaises sont
 * très souvent `lowres` chez Scryfall : mesuré sur un deck réel, 34 des 55
 * impressions françaises trouvées le sont, contre 1 sur 55 côté anglais.
 * L'URL `large` existe et rend bien 672 × 936 — le chemin de dégradation de
 * taille ci-dessous ne se déclenche donc **jamais** pour cette raison — mais
 * elle est agrandie depuis un scan de basse définition, et pèse 40 à 60 % de
 * l'image anglaise à dimensions égales. C'est exactement le flou constaté.
 *
 * On garde quand même le `lowres`, à toutes les tailles. En vignette, la
 * réduction efface la différence. En grand aperçu, le joueur vient de demander
 * à **lire** la carte : une image française un peu molle se lit, une image
 * anglaise parfaitement nette ne se lit pas du tout pour qui a choisi le
 * français. Lui rendre l'anglais au moment précis où il agrandit reviendrait à
 * retirer la traduction là où elle sert le plus.
 *
 * `placeholder` et `missing` sont l'autre cas, et celui-là se tranche seul : ce
 * n'est pas un scan mou de la carte, c'est une image de remplacement qui ne
 * porte **ni** le texte français **ni** l'illustration. Il n'y a rien à y
 * gagner, on reprend l'anglais — silencieusement, comme tout repli.
 */
const USABLE_IMAGE_STATUS = new Set(['lowres', 'highres_scan']);

export interface CardImageRequest {
  /** La carte telle que le catalogue (anglais) la connaît — `CardMeta` convient. */
  card: ImageSource;
  /** Ce que la résolution localisée a rendu, si elle est déjà arrivée. */
  localized?: LocalizedPrinting | null;
  language: Language;
  /** 0 = recto. Une carte recto-verso a une image par face, pas une image retournée. */
  face?: number;
  version?: ImageVersion;
  /**
   * Autorise l'illustration d'une **autre impression** quand celle que le
   * joueur a choisie n'existe pas dans sa langue.
   *
   * Faux par défaut, et ce défaut est le comportement historique : l'édition
   * affichée est celle que le joueur a choisie, point. L'option lève la règle
   * **pour celui qui regarde**, et elle est purement locale — le `scryfallId`
   * du protocole, ce qu'un deck enregistre et ce que voient les autres joueurs
   * n'en dépendent à aucun moment.
   */
  allowSubstitute?: boolean;
}

export interface ResolvedCardImage {
  /** `null` quand la face demandée n'existe pas — une carte simple n'a pas de verso. */
  url: string | null;
  /** La langue de l'illustration réellement servie. */
  language: Language;
  /** Vrai quand on montre l'anglais alors qu'autre chose était demandé. */
  fallback: boolean;
  /**
   * Vrai quand l'anglais servi n'est que provisoire : la résolution reste à
   * faire côté serveur. C'est le seul cas où redemander la carte apporte
   * quelque chose — un `fallback` sans `pending` ne changera jamais.
   */
  pending: boolean;
  /**
   * Vrai quand l'illustration vient d'une **autre impression** que celle que le
   * joueur a choisie. N'arrive que si l'appelant l'a autorisé.
   *
   * C'est le drapeau qui empêche le sélecteur d'impression de mentir : l'image
   * affichée et l'impression choisie ont divergé, et l'interface doit pouvoir
   * le dire.
   */
  substituted: boolean;
  /** L'édition de la substitution, ou `null` quand il n'y en a pas. */
  substituteSetCode: string | null;
  /**
   * Pourquoi l'anglais est servi, quand il l'est. `null` s'il ne l'est pas.
   *
   *  - `untranslated` : cette impression n'existe pas dans la langue demandée.
   *    Ce n'est pas la même chose que « cette carte n'existe pas en français » —
   *    elle existe peut-être dans vingt autres éditions.
   *  - `unusableImage` : l'impression traduite existe, mais Scryfall n'en a
   *    qu'une image de remplacement (`placeholder` / `missing`), qui ne porte ni
   *    l'illustration ni le texte. On a préféré l'anglais.
   */
  fallbackReason: 'untranslated' | 'unusableImage' | null;
  /**
   * Cette carte est un **terrain de base** : elle garde son édition quoi qu'il
   * arrive et ne porte aucun repère de langue (voir `isBasicLand`).
   *
   * Le drapeau est publié plutôt que de mentir sur `fallback` ou
   * `fallbackReason`, qui continuent de dire la vérité : l'illustration servie
   * *est* bien l'anglaise, on a seulement décidé que ça n'intéressait personne.
   */
  basicLand: boolean;
  /**
   * Cette carte est un **jeton** : il n'en existe aucune impression traduite,
   * dans aucune langue, et il n'en existera pas.
   *
   * Le drapeau sert exactement comme `basicLand` : `fallback` et
   * `fallbackReason` continuent de dire la vérité — l'illustration servie *est*
   * l'anglaise —, mais le repère de langue s'abstient. Voir `cardLanguageMark`.
   */
  token: boolean;
}

/**
 * On demande `large`, mais toutes les impressions n'ont pas toutes les tailles.
 * L'ordre de repli descend vers ce qui existe le plus souvent plutôt que de
 * rendre `undefined` et afficher un cadre vide.
 */
const DEGRADE: Record<ImageVersion, readonly ImageVersion[]> = {
  large: ['large', 'normal', 'small'],
  normal: ['normal', 'large', 'small'],
  small: ['small', 'normal', 'large'],
};

function pickVersion(uris: ImageUris | null | undefined, version: ImageVersion): string | null {
  if (!uris) return null;
  for (const size of DEGRADE[version]) {
    const url = uris[size];
    if (url) return url;
  }
  return null;
}

/**
 * Est-ce une source multi-faces ? On ne se fie pas au `layout` : une carte
 * recto-verso se reconnaît ici à ce qui compte pour l'affichage — plusieurs
 * entrées `faces` porteuses d'images. Un `split` ou un `adventure`, qui ont
 * deux faces logiques mais une seule illustration, n'en ont pas.
 */
function faceImages(source: ImageSource): readonly FaceLike[] | null {
  const faces = source.faces;
  if (!faces || faces.length < 2) return null;
  return faces.some((f) => f.imageUris?.normal ?? f.imageUris?.large ?? f.imageUris?.small)
    ? faces
    : null;
}

function urlFromSource(
  source: ImageSource,
  id: string,
  face: number,
  version: ImageVersion,
): string | null {
  const faces = faceImages(source);

  if (faces) {
    const chosen = faces[face];
    if (!chosen) return null;
    // Le CDN ne sait dériver que le recto et le verso ; au-delà, seule l'URL
    // publiée par Scryfall existe (aucune carte n'a trois faces à ce jour).
    return pickVersion(chosen.imageUris, version) ?? (face < 2 ? derive(id, face, version) : null);
  }

  // Une carte à une seule illustration n'a pas de verso propre : le dos générique
  // est l'affaire de `CardBack`, pas de cette fonction.
  if (face !== 0) return null;
  return pickVersion(source.imageUris, version) ?? derive(id, 0, version);
}

/** Le motif d'URL du CDN, déjà tenu par `lib/cards.ts` : on ne le réécrit pas ici. */
function derive(id: string, face: number, version: ImageVersion): string {
  return scryfallImage(id, version, face === 0 ? 'front' : 'back');
}

/**
 * Résout l'illustration à afficher, avec repli anglais.
 *
 * L'ordre est délibéré : on ne prend l'impression localisée que si elle est
 * **réellement** dans la langue demandée. Le serveur renvoie déjà l'anglais
 * dans `localized` quand la traduction n'existe pas ; le vérifier ici rend la
 * fonction juste quelle que soit la façon dont on l'appelle, et c'est ce test
 * qui produit le drapeau `fallback` que l'interface peut expliquer au joueur.
 */
export function resolveCardImage(request: CardImageRequest): ResolvedCardImage {
  const {
    card,
    localized,
    language,
    face = 0,
    version = 'large',
    allowSubstitute = false,
  } = request;
  const wanted = SCRYFALL_LANG[language];
  // L'exception des terrains de base, décidée ici et pas ailleurs : c'est
  // l'affichage qui la porte, et elle ne vaut que pour celui qui regarde.
  const basicLand = isBasicLand(card);
  /*
   * Le jeton, seconde exception, et de même nature : Scryfall n'en publie aucun
   * hors anglais, donc il n'y a ni impression traduite à servir ni substitution
   * à chercher. Seul le **nom** se traduit, et cela se passe ailleurs
   * (`tokenNames.ts`) — ici on se contente de le dire à qui dessine le repère.
   */
  const token = isTokenTypeLine(card.typeLine);

  const usable =
    localized?.imageStatus == null || USABLE_IMAGE_STATUS.has(localized.imageStatus);

  /*
   * **L'impression traduite est là, mais elle est floue.**
   *
   * C'est le second motif de substitution, et il ne se voit pas dans le premier
   * `if` : `lowres` fait partie des statuts affichables, donc sans ce test on
   * servirait le scan mou et on ne regarderait **jamais** la substitution nette
   * que le serveur a pourtant retenue. C'est très exactement ce que le joueur a
   * signalé — « pourquoi certaines cartes sont encore en basse résolution » —
   * avec l'option de substitution cochée.
   *
   * Le garde-fou est le même que côté serveur : on ne bouge que vers un
   * `highres_scan`, et seulement depuis une image qui ne l'est pas. Remplacer un
   * flou par un autre flou ferait perdre au joueur l'œuvre qu'il a choisie
   * contre rien.
   */
  const substituteIsSharper =
    allowSubstitute &&
    !basicLand &&
    localized?.substitute?.imageStatus === 'highres_scan' &&
    localized.imageStatus !== 'highres_scan';

  /**
   * L'impression traduite de l'édition choisie, quand elle est servable.
   *
   * Elle est calculée une fois et essayée **deux** fois : avant la substitution
   * dans le cas normal, après elle quand la substitution était plus nette mais
   * n'a finalement pas d'image pour cette face. Sans ce second essai, un scan
   * français un peu mou serait remplacé par de l'**anglais** — l'inverse de ce
   * qu'on cherchait en le remplaçant.
   */
  const servirLocalisee = (): ResolvedCardImage | null => {
    if (!localized || localized.language !== wanted || localized.pending || !usable) return null;
    const id = localized.localizedScryfallId ?? localized.scryfallId;
    const url = urlFromSource(localized, id, face, version);
    // Une impression localisée sans image pour cette face n'est pas une raison
    // de ne rien montrer : on redescend sur le catalogue anglais.
    if (!url) return null;
    return {
      url,
      language,
      fallback: false,
      pending: false,
      substituted: false,
      substituteSetCode: null,
      fallbackReason: null,
      basicLand,
      token,
    };
  };

  if (!substituteIsSharper) {
    const servie = servirLocalisee();
    if (servie) return servie;
  }

  /*
   * L'impression de substitution, et **seulement** si le joueur l'a demandée.
   *
   * On arrive ici quand l'impression choisie n'existe pas dans la langue
   * voulue. Le joueur qui a coché l'option préfère lire sa carte plutôt que
   * garder l'illustration exacte de l'édition qu'il a choisie ; c'est son
   * arbitrage, il ne vaut que pour lui, et le repère de divergence ci-dessous
   * (`substituted`) le lui rappelle pour que le sélecteur d'impression ne se
   * mette pas à mentir en silence.
   *
   * **Jamais pour un terrain de base** : son illustration est tout ce qu'il a, et
   * son édition est un choix qu'on ne troque pas contre une traduction qui ne
   * traduit rien. Le serveur ne lui en cherche d'ailleurs aucune, mais la
   * décision d'affichage se prend ici, et elle doit tenir même sur une ligne
   * écrite avant cette règle.
   */
  const substitute = localized?.substitute;
  const substituteUsable =
    substitute?.imageStatus == null || USABLE_IMAGE_STATUS.has(substitute.imageStatus);
  if (allowSubstitute && !basicLand && substitute && !localized?.pending && substituteUsable) {
    const url = urlFromSource(substitute, substitute.scryfallId, face, version);
    if (url) {
      return {
        url,
        // L'illustration **est** dans la langue demandée : ce n'est pas un repli.
        language,
        fallback: false,
        pending: false,
        substituted: true,
        substituteSetCode: substitute.setCode ?? null,
        fallbackReason: null,
        basicLand,
        token,
      };
    }
  }

  // La substitution était plus nette mais n'a pas d'image pour cette face : le
  // scan français un peu mou reste bien meilleur que l'anglais.
  if (substituteIsSharper) {
    const servie = servirLocalisee();
    if (servie) return servie;
  }

  // Sans résolution du tout, on ne sait pas encore : c'est « à redemander »,
  // pas « pas de version française ». Les confondre ferait soit clignoter
  // l'avertissement de repli sur chaque premier rendu, soit renoncer à jamais
  // à une traduction qui n'attendait qu'un second appel.
  const pending = language !== 'en' && (localized?.pending ?? true);
  const fallback = language !== 'en';

  return {
    url: urlFromSource(card, card.scryfallId, face, version),
    // Le catalogue que nous ingérons est anglais : ce qui en sort l'est aussi.
    language: 'en',
    fallback,
    pending,
    substituted: false,
    substituteSetCode: null,
    /*
     * Deux raisons de servir l'anglais, et elles ne se disent pas pareil au
     * joueur. « Pas de version française de cette impression » invite à
     * changer d'édition ; « Scryfall n'a pas de scan de l'impression
     * française » dit que le problème est ailleurs et qu'il n'y a rien à faire.
     */
    fallbackReason: !fallback || pending
      ? null
      : localized && localized.language === wanted && !usable
        ? 'unusableImage'
        : 'untranslated',
    basicLand,
    token,
  };
}

/**
 * Le repère « cette carte n'est pas dans votre langue ».
 *
 * **Il n'est vu que par celui qui regarde.** Rien de tout cela ne passe par un
 * event, un intent ou une projection : c'est dérivé, côté client, de ce que la
 * résolution localisée a rendu pour *cette* langue-ci. `PROTOCOL_VERSION` ne
 * bouge pas, rien ne part au serveur, et un joueur ne voit jamais le repère
 * d'un autre. Un joueur en anglais n'en voit aucun : pour lui, `fallback` est
 * faux par construction (le catalogue est anglais), donc rien n'est « non
 * traduit ».
 *
 * **`identityKnown` est la garde d'étanchéité, et elle n'a pas de valeur par
 * défaut : l'appelant doit la nommer.** Une carte face cachée n'a pas de
 * résolution localisée — le client ne connaît même pas son `scryfallId`. Un
 * repère posé dessus apprendrait à son porteur que notre client, lui, en
 * connaît l'identité : ce serait une fuite d'information là où le protocole
 * décide la visibilité **à l'émission**. Cette fonction refuse donc de rendre
 * quoi que ce soit sans cette affirmation explicite, et `CardSprite` la dérive
 * du seul endroit qui fasse foi (`card.faceDown === false`).
 *
 * **`pending` n'est pas marqué.** La carte va probablement devenir française
 * dans quelques secondes ; un repère qui clignote puis disparaît est pire que
 * pas de repère.
 */
export type CardLanguageMarkKind = 'untranslated' | 'unusableImage' | 'substituted';

export interface CardLanguageMark {
  kind: CardLanguageMarkKind;
  /** La langue **demandée**, celle de celui qui regarde. */
  language: Language;
  /** L'édition de la substitution, quand c'en est une. */
  setCode: string | null;
}

export function cardLanguageMark(input: {
  /**
   * Le client connaît-il l'identité de cette carte ? Sans valeur par défaut,
   * pour qu'on ne puisse pas l'oublier : voir plus haut.
   */
  identityKnown: boolean;
  resolved: ResolvedCardImage | null | undefined;
  /** La langue demandée par celui qui regarde. */
  language: Language;
}): CardLanguageMark | null {
  const { identityKnown, resolved, language } = input;
  // La garde d'étanchéité, en premier et sans condition : une carte dont on ne
  // connaît pas l'identité ne porte aucun repère, quoi qu'on ait résolu.
  if (!identityKnown) return null;
  if (!resolved) return null;
  // « Pas encore cherché » n'est pas « pas de traduction ».
  if (resolved.pending) return null;
  /*
   * **Un terrain de base ne porte jamais de repère.** Il n'a pas de texte à
   * lire : lui signaler qu'il n'est pas traduit n'informe de rien, et vingt ou
   * trente pastilles par table salissent le champ de bataille pour rien. Voir
   * `isBasicLand`.
   */
  if (resolved.basicLand) return null;
  /*
   * **Un jeton n'en porte jamais non plus, et la raison est plus forte encore.**
   *
   * Le repère `untranslated` dit « cette impression-ci n'existe pas dans votre
   * langue », ce qui invite à en changer — c'est même à cela qu'il sert sur une
   * carte ordinaire. Sur un jeton il mentirait : Scryfall ne publie **aucun**
   * jeton hors anglais, il n'y a donc pas d'édition à aller chercher, et le
   * joueur passerait le sélecteur d'impression en revue pour rien. Le nom, lui,
   * est bien français (`tokenNames.ts`) : une pastille « non traduite » à côté
   * d'un jeton qui s'annonce « Soldat » serait doublement fausse.
   *
   * Même arbitrage que pour les terrains de base (`docs/i18n.md` §3.9) et pour
   * une raison voisine : on ne signale pas un repli sur lequel personne ne peut
   * rien.
   */
  if (resolved.token) return null;

  if (resolved.substituted) {
    return { kind: 'substituted', language, setCode: resolved.substituteSetCode };
  }
  if (!resolved.fallback) return null;
  return { kind: resolved.fallbackReason ?? 'untranslated', language, setCode: null };
}

/** La même chose quand seule l'URL intéresse l'appelant. */
export function cardImageUrl(request: CardImageRequest): string | null {
  return resolveCardImage(request).url;
}

/**
 * Les cartes dont la traduction reste à demander.
 *
 * `POST /api/cards/localized` plafonne ses appels vivants à Scryfall par
 * requête : ce qui dépasse revient `pending`, en anglais, affichable tout de
 * suite. Un second appel — **un**, plus tard, jamais en boucle — rend le reste.
 * La fonction est pure : c'est à l'appelant de choisir le moment, et rien ici
 * ne déclenche de réseau ni ne met quoi que ce soit en cache.
 */
export function pendingLocalizations(
  entries: Iterable<LocalizedPrinting> | null | undefined,
): string[] {
  const ids: string[] = [];
  for (const entry of entries ?? []) {
    if (entry.pending) ids.push(entry.scryfallId);
  }
  return ids;
}
