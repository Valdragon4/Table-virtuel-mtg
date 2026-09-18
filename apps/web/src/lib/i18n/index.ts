/**
 * Point d'entrée du dossier : `import { useT } from '../lib/i18n/index.js'`.
 *
 * Un seul chemin d'import pour les 39 composants à reprendre, pour que la
 * seconde vague soit mécanique — et pour qu'un déplacement de fichier plus tard
 * ne se paie pas en 39 modifications.
 */
export { fr, type Catalog, type CatalogKey } from './catalog.fr.js';
export { en } from './catalog.en.js';
export { defineTranslation } from './defineTranslation.js';
export { interpolate, pluralForm, t, translator, type BoundT } from './translate.js';
export { useT } from './useT.js';
export type { ArgsFor, Entry, ParamsIn, ParamsOf, PluralEntry, Vars } from './types.js';
export {
  cardImageUrl,
  cardLanguageMark,
  pendingLocalizations,
  resolveCardImage,
  type CardImageRequest,
  type CardLanguageMark,
  type CardLanguageMarkKind,
  type SubstitutePrinting,
  type FaceLike,
  type ImageSource,
  type ImageUris,
  type ImageVersion,
  type LocalizedPrinting,
  type ResolvedCardImage,
} from './cardImage.js';
export {
  canonKeyword,
  foldKeyword,
  isKnownKeyword,
  keywordLabel,
  keywordName,
  keywordSearchTerms,
  COMMON_KEYWORDS,
  KEYWORD_NAMES_FR,
  MOTS_CLES_EN_ANGLAIS,
} from './keywordNames.js';
export {
  isTokenForNaming,
  isTokenTypeLine,
  tokenName,
  tokenQueryAliases,
  typeTermFr,
  TOKEN_NAMES_FR,
  TERMES_LAISSES_EN_ANGLAIS,
} from './tokenNames.js';
