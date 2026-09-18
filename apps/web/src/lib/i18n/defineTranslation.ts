/**
 * Le contrôle d'un catalogue traduit, au moment de la compilation.
 *
 * Deux choses doivent être impossibles à livrer :
 *
 *  1. **Une clé manquante.** Le paramètre est contraint à porter *toutes* les
 *     clés du français : en oublier une est une erreur de type, pas un libellé
 *     français qui réapparaît discrètement au milieu d'un écran anglais.
 *  2. **Une accolade perdue.** Si le français dit « {value} × {kind} » et
 *     l'anglais « only {value} », l'appelant fournit un `kind` qui ne
 *     s'affichera jamais. `SameParams` rend alors le type de cette entrée
 *     `never` : le littéral écrit dans le catalogue ne lui est pas assignable,
 *     et l'erreur pointe la clé fautive, elle seule.
 *
 * Reste un trou que le type ne peut pas boucher : `{count}` disparu d'une forme
 * plurielle, puisque `ParamsOf` ajoute toujours `count` à un pluriel. C'est un
 * test d'exécution qui le couvre (apps/web/test/i18n-traduction.test.ts).
 *
 * Le prix à payer est le `as const` à l'appel : sans lui, TypeScript élargit les
 * littéraux en `string` et il n'y a plus d'accolades à lire.
 */
import type { Catalog, CatalogKey } from './catalog.fr.js';
import type { Entry, SameParams } from './types.js';

/** Un catalogue candidat : les bonnes clés, des entrées de la bonne forme. */
type CatalogShape = { readonly [K in CatalogKey]: Entry };

/**
 * Le calque de vérification. Chaque entrée vaut `unknown` (neutre dans une
 * intersection) si les paramètres correspondent, et `never` sinon.
 *
 * Les deux gardes `extends` ne sont pas décoratives : une clé absente de `T`
 * laisse le calque **neutre** (`unknown`) au lieu d'y répondre `never`. Sans
 * elles, oublier une clé faisait recracher au compilateur une erreur par
 * entrée — quarante lignes sans jamais nommer celle qui manque. Ici, c'est
 * l'intersection `& CatalogShape` qui parle, et elle nomme la clé.
 */
type ParamsMatchSource<T> = {
  readonly [K in CatalogKey]: K extends keyof T
    ? T[K] extends Entry
      ? SameParams<T[K], Catalog[K]>
      : unknown
    : unknown;
};

/**
 * La contrainte est volontairement **lâche** (`Record<string, Entry>`) et la
 * complétude des clés est exigée par l'intersection `& CatalogShape`.
 *
 * Ce détour n'est pas de la coquetterie : avec `T extends CatalogShape`, une
 * seule clé manquante fait échouer la contrainte, TypeScript rabat alors `T` sur
 * `CatalogShape` — où chaque entrée vaut `string | PluralEntry` — et `SameParams`
 * répond `never` pour *toutes* les autres. On lisait quarante erreurs sans
 * jamais voir laquelle manquait. Ainsi, on lit « Property 'zone.exile' is
 * missing », ce qui est la seule chose utile à savoir.
 */
export function defineTranslation<T extends Record<string, Entry>>(
  catalog: T & CatalogShape & ParamsMatchSource<T>,
): T {
  return catalog;
}
