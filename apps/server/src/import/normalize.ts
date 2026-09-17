/**
 * Normalisation des noms de cartes.
 *
 * Deux formes coexistent volontairement :
 *  - `normalizeName` : forme canonique, stockée dans `Card.normalizedName` et
 *    utilisée pour la résolution exacte. Elle préserve la ponctuation utile
 *    (virgules, traits d'union) pour ne pas confondre deux cartes distinctes.
 *  - `looseKey` : forme agressive, sans aucun caractère non alphanumérique,
 *    utilisée en second recours quand la forme canonique ne donne rien.
 */

const DIACRITICS = /[̀-ͯ]/g;

/** Apostrophes et guillemets typographiques → apostrophe droite. */
function normalizeQuotes(input: string): string {
  return input
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Tirets typographiques → trait d'union simple. */
function normalizeDashes(input: string): string {
  return input.replace(/[‐-―−]/g, '-');
}

export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(DIACRITICS, '').normalize('NFC');
}

export function normalizeName(input: string): string {
  return stripDiacritics(normalizeDashes(normalizeQuotes(input)))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function looseKey(input: string): string {
  return normalizeName(input).replace(/[^a-z0-9]/g, '');
}

/**
 * Un nom de carte recto-verso peut être écrit « Recto // Verso », « Recto / Verso »
 * ou juste « Recto ». On renvoie toutes les clés sous lesquelles la carte peut
 * légitimement être cherchée, la plus spécifique d'abord.
 */
export function nameCandidates(rawName: string): string[] {
  const full = normalizeName(rawName);
  const out = [full];

  const parts = full.split(/\s*\/\/\s*|\s+\/\s+/).filter(Boolean);
  if (parts.length > 1) {
    // Forme canonique Scryfall : double slash avec espaces.
    out.push(parts.join(' // '));
    const front = parts[0];
    if (front) out.push(front);
  }
  return [...new Set(out)];
}

/** Clés d'indexation d'une carte Scryfall : nom complet + face avant seule. */
export function indexKeysForCardName(name: string): string[] {
  const full = normalizeName(name);
  const keys = [full];
  const front = full.split(' // ')[0];
  if (front && front !== full) keys.push(front);
  return keys;
}
