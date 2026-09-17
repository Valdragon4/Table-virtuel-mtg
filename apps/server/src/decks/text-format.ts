/**
 * Rendu d'un deck en liste texte — le sens inverse de `parseDeckText`.
 *
 * C'est la pièce qui amorce l'éditeur : un deck en base redevient la liste que
 * l'utilisateur aurait pu coller, l'éditeur la modifie, et le résultat repart
 * par le chemin d'import habituel (parseur, résolution Scryfall, rapport avec
 * suggestions). Aucune pile parallèle : le texte reste le format d'échange.
 *
 * Propriété à tenir, testée dans `deck-text.test.ts` : `parseDeckText(render(d))`
 * redonne exactement les mêmes lignes que `d` — même nom, même édition, même
 * quantité, même zone, même marqueur foil. C'est elle qui empêche l'éditeur de
 * corrompre un deck qu'on ouvre puis qu'on enregistre sans rien changer.
 *
 * L'édition rendue est l'impression **résolue** (celle qui est réellement dans
 * le deck), pas l'édition demandée à l'import : c'est la seule qui garantit que
 * la relecture retombe sur le même `scryfallId`. Quand l'import avait dû se
 * rabattre sur une autre impression, l'export entérine ce repli plutôt que de
 * redemander une édition qui n'existe pas.
 */
import type { DeckZone } from '@mtg/shared';

export interface DeckTextEntry {
  name: string;
  setCode?: string | null;
  collectorNumber?: string | null;
  quantity: number;
  zone: DeckZone;
  isFoil: boolean;
}

/**
 * En-têtes de section. Mots-clés Magic en anglais, comme partout ailleurs, et
 * comme le parseur les attend (`SECTIONS` dans `import/text.ts`).
 */
export const ZONE_HEADING: Record<DeckZone, string> = {
  COMMANDER: 'Commander',
  MAIN: 'Deck',
  SIDEBOARD: 'Sideboard',
};

/** Ordre de lecture conventionnel d'une liste : le commandant ouvre le bal. */
export const ZONE_ORDER: DeckZone[] = ['COMMANDER', 'MAIN', 'SIDEBOARD'];

/**
 * Le parseur ne sait relire `(SET) NUM` que dans ces formes. Une impression dont
 * le code ou le numéro sort de ces classes est rendue sans édition : mieux vaut
 * une ligne qui se relit et retombe sur la meilleure impression qu'une ligne
 * dont le suffixe finirait avalé par le nom de la carte.
 */
const SAFE_SET = /^[A-Za-z0-9]{2,6}$/;
const SAFE_NUMBER = /^[A-Za-z0-9★†*+-]{1,12}$/;

export function renderDeckLine(entry: DeckTextEntry): string {
  const parts = [`${entry.quantity} ${entry.name.trim()}`];

  const set = entry.setCode?.trim();
  const num = entry.collectorNumber?.trim();
  if (set && num && SAFE_SET.test(set) && SAFE_NUMBER.test(num)) {
    parts.push(`(${set.toUpperCase()}) ${num}`);
  }

  if (entry.isFoil) parts.push('*F*');
  return parts.join(' ');
}

/**
 * Liste texte complète, regroupée par zone. Les zones vides ne produisent pas
 * d'en-tête : une liste sans réserve ne doit pas suggérer qu'il en existe une.
 *
 * L'ordre à l'intérieur d'une zone est celui des entrées reçues — `getDeck` les
 * rend déjà triées par `sortIndex`, donc l'ordre d'origine survit à l'aller-retour.
 */
export function renderDeckText(entries: readonly DeckTextEntry[]): string {
  const blocks: string[] = [];

  for (const zone of ZONE_ORDER) {
    const inZone = entries.filter((e) => e.zone === zone && e.quantity > 0);
    if (inZone.length === 0) continue;
    blocks.push([ZONE_HEADING[zone], ...inZone.map(renderDeckLine)].join('\n'));
  }

  return blocks.join('\n\n');
}
