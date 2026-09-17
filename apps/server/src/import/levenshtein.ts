/**
 * Distance de Levenshtein bornée, pour les suggestions du rapport d'import.
 * Bornée parce qu'on la lance sur des milliers de candidats : dès que la
 * distance dépasse `max`, on abandonne la ligne.
 */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length]!;
}

export interface Suggestion<T> {
  item: T;
  distance: number;
}

/** Les `limit` candidats les plus proches de `query`, distance ≤ `max`. */
export function nearest<T>(
  query: string,
  candidates: Iterable<T>,
  key: (item: T) => string,
  limit = 5,
  max = 6,
): Array<Suggestion<T>> {
  const out: Array<Suggestion<T>> = [];
  for (const item of candidates) {
    const d = levenshtein(query, key(item), max);
    if (d <= max) out.push({ item, distance: d });
  }
  out.sort((x, y) => x.distance - y.distance || key(x.item).localeCompare(key(y.item)));
  return out.slice(0, limit);
}
