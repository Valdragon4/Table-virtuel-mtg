/**
 * Traduire une chaîne.
 *
 * `t` est **pure** : langue, clé, paramètres → texte. Elle ne lit aucun store,
 * ne touche pas au DOM, et se teste donc sans React. Le lien avec la langue
 * courante se fait ailleurs, dans `useT` — c'est ce qui permet au journal de
 * partie, au service worker près, de rendre une phrase dans une langue qui
 * n'est pas celle affichée si un jour on en a besoin.
 *
 * Il n'y a pas de bibliothèque derrière : ce fichier est le moteur entier.
 */
import { DEFAULT_LANGUAGE, type Language } from '@mtg/shared';
import { fr, type Catalog, type CatalogKey } from './catalog.fr.js';
import { en } from './catalog.en.js';
import type { ArgsFor, Entry, PluralEntry, Vars } from './types.js';

/**
 * Les catalogues, par langue. Une langue de plus, c'est une ligne de plus ici
 * et un fichier `catalog.xx.ts` — jamais une modification du moteur.
 */
const CATALOGS: Record<Language, { readonly [K in CatalogKey]: Entry }> = { fr, en };

/**
 * Le choix de la forme plurielle, langue par langue.
 *
 * Le français et l'anglais ne coupent **pas** au même endroit : on écrit
 * « 0 carte » mais « 0 cards ». C'est exactement le genre de détail qu'un
 * `n > 1 ? 's' : ''` recopié dans 39 composants ne pouvait pas porter. Une
 * langue à trois formes demanderait d'élargir `PluralEntry` en même temps que
 * cette table, et il est bon que ce soit visiblement les deux ensemble.
 */
const PLURAL_FORM: Record<Language, (n: number) => keyof PluralEntry> = {
  fr: (n) => (Math.abs(n) < 2 ? 'one' : 'other'),
  en: (n) => (Math.abs(n) === 1 ? 'one' : 'other'),
};

export function pluralForm(language: Language, count: number): keyof PluralEntry {
  return (PLURAL_FORM[language] ?? PLURAL_FORM[DEFAULT_LANGUAGE])(count);
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Remplace les `{accolades}`.
 *
 * Un paramètre absent laisse son accolade **visible** plutôt que de produire un
 * trou ou un « undefined ». Le typage rend le cas impossible depuis du code
 * TypeScript ; s'il survient quand même — une chaîne venue du serveur, un
 * `any` glissé quelque part — on veut le voir, pas le masquer.
 */
export function interpolate(template: string, vars: Record<string, unknown> | undefined): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

function entryFor(language: Language, key: CatalogKey): Entry {
  // Une langue inconnue ne doit pas rendre une page blanche : on retombe sur la
  // source française, qui est par construction toujours complète.
  const catalog = CATALOGS[language] ?? CATALOGS[DEFAULT_LANGUAGE];
  return catalog[key] ?? fr[key];
}

/**
 * Traduit une clé.
 *
 * La signature est variadique : une entrée sans accolade s'appelle
 * `t(lang, 'common.cancel')`, une entrée avec accolades exige l'objet complet,
 * et un paramètre oublié est une **erreur de compilation**. Une clé absente du
 * catalogue l'est aussi : `CatalogKey` est fermé.
 */
export function t<K extends CatalogKey>(
  language: Language,
  key: K,
  ...args: ArgsFor<Catalog[K]>
): string {
  const entry = entryFor(language, key);
  const vars = args[0] as Record<string, unknown> | undefined;

  if (typeof entry === 'string') return interpolate(entry, vars);

  const count = Number(vars?.['count'] ?? 0);
  return interpolate(entry[pluralForm(language, count)], vars);
}

/** La fonction `t` d'une langue donnée, pour ne pas la repasser à chaque appel. */
export type BoundT = <K extends CatalogKey>(key: K, ...args: ArgsFor<Catalog[K]>) => string;

export function translator(language: Language): BoundT {
  return ((key, ...args) => t(language, key, ...(args as never))) as BoundT;
}

export type { CatalogKey, Catalog, Vars };
