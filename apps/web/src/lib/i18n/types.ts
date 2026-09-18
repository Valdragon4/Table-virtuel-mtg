/**
 * La mécanique de typage du catalogue.
 *
 * Tout l'intérêt du dossier est là : sur 39 composants à reprendre, on ne veut
 * **pas** découvrir à l'exécution qu'une clé n'existe pas ou qu'une
 * interpolation manque un paramètre. Le compilateur doit refuser le fichier.
 * D'où ces types, qui lisent les accolades **dans la chaîne française** et en
 * déduisent la signature d'appel de `t`.
 *
 * Pas de bibliothèque : i18next et consorts pèsent plus que ce fichier et
 * n'apportent rien qu'on utiliserait ici — leur typage strict demande de toute
 * façon d'écrire soi-même les déclarations de ressources, et leur moteur de
 * pluriel ICU couvre des langues (arabe, russe) que ce projet n'a pas. Cent
 * lignes suffisent, et elles sont lisibles par la personne qui passera après.
 */

/**
 * Une entrée pluralisée. Deux formes seulement, parce que le français et
 * l'anglais n'en ont que deux ; une langue à trois formes (russe, polonais)
 * demanderait d'élargir cette forme *et* `pluralForm`, et c'est très bien que
 * ce soit ces deux endroits-là, ensemble.
 */
export interface PluralEntry {
  readonly one: string;
  readonly other: string;
}

export type Entry = string | PluralEntry;

/** Les paramètres `{ainsi}` lus dans une chaîne, au niveau du type. */
export type ParamsIn<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | ParamsIn<Rest>
  : never;

/**
 * Les paramètres d'une entrée. Une entrée au pluriel exige toujours `count` :
 * c'est lui qui choisit la forme, même si la chaîne ne l'affiche pas
 * (« une carte » / « {count} cartes »).
 */
export type ParamsOf<E extends Entry> = E extends string
  ? ParamsIn<E>
  : E extends PluralEntry
    ? 'count' | ParamsIn<E['one']> | ParamsIn<E['other']>
    : never;

/** Ce qu'on passe à `t` : des chaînes ou des nombres, rien d'autre. */
export type Vars<P extends string> = Record<P, string | number>;

/**
 * La signature variadique de `t`. Une entrée sans paramètre s'appelle avec la
 * seule clé ; une entrée qui en a un en **exige** l'objet complet, et un
 * paramètre oublié est une erreur de compilation.
 */
export type ArgsFor<E extends Entry> = [ParamsOf<E>] extends [never]
  ? []
  : [vars: Vars<ParamsOf<E>>];

/**
 * Deux entrées attendent-elles exactement les mêmes paramètres ?
 *
 * Sert à interdire une traduction qui aurait perdu (ou inventé) une accolade :
 * si l'anglais dit `{who} drew a card` là où le français dit
 * `{who} a pioché {count} cartes`, l'appelant fournirait un `count` qui ne
 * s'afficherait jamais — ou pire, l'inverse.
 */
export type SameParams<A extends Entry, B extends Entry> = [ParamsOf<A>] extends [ParamsOf<B>]
  ? [ParamsOf<B>] extends [ParamsOf<A>]
    ? unknown
    : never
  : never;
