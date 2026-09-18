/**
 * La langue de l'interface, partagée entre le serveur et le client.
 *
 * Elle vit dans `@mtg/shared` parce que les deux côtés en ont besoin pour la
 * *même* valeur : le serveur la valide avant de l'écrire dans les préférences
 * du compte, le client l'affiche et choisit le catalogue de traduction. Deux
 * définitions parallèles auraient dérivé au premier ajout de langue.
 *
 * Tout est dérivé de la seule liste `LANGUAGES` : ajouter l'espagnol, c'est
 * ajouter `'es'` ici, puis écrire le catalogue côté web. Rien d'autre dans ce
 * fichier n'est à toucher — c'est le but.
 */
import { z } from 'zod';

/** Ordre d'affichage dans le sélecteur ; le premier n'a rien de spécial. */
export const LANGUAGES = ['fr', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

/**
 * Le français est la langue par défaut parce que c'est celle dans laquelle
 * l'interface a été écrite : le catalogue `fr` est la source, l'anglais en est
 * la traduction. Un compte sans préférence enregistrée voit donc l'original.
 */
export const DEFAULT_LANGUAGE: Language = 'fr';

/**
 * Le nom de chaque langue **dans cette langue**. On ne traduit pas un nom de
 * langue : quelqu'un qui cherche l'anglais cherche « English », pas
 * « Anglais » — surtout s'il est arrivé sur une interface qu'il ne lit pas.
 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  fr: 'Français',
  en: 'English',
};

/**
 * Le code de langue tel que Scryfall le publie sur chaque impression.
 *
 * Il se trouve qu'il coïncide aujourd'hui avec le nôtre, mais la table est
 * explicite : Scryfall écrit `pt` pour le portugais et `zhs`/`zht` pour le
 * chinois, et le jour où l'on ajoute l'une de ces langues, c'est ici que la
 * correspondance se pose, pas au milieu d'une fonction d'affichage.
 */
export const SCRYFALL_LANG: Record<Language, string> = {
  fr: 'fr',
  en: 'en',
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Ramène n'importe quelle valeur à une langue connue.
 *
 * C'est le garde-fou des frontières : une préférence lue en base, un
 * `localStorage` bricolé à la main, un `navigator.language` qui vaut `fr-CA`.
 * Rien de tout cela n'a le droit de faire tomber l'interface — on retombe sur
 * le défaut, silencieusement, parce qu'une langue inconnue n'est pas une erreur
 * de l'utilisateur.
 */
export function asLanguage(value: unknown, fallback: Language = DEFAULT_LANGUAGE): Language {
  if (isLanguage(value)) return value;
  // « fr-CA », « en-US » : on garde la sous-étiquette primaire.
  if (typeof value === 'string') {
    const primary = value.split('-')[0]?.toLowerCase();
    if (isLanguage(primary)) return primary;
  }
  return fallback;
}

/** Schéma zod, pour la route de préférences et tout autre contrôle d'entrée. */
export const languageSchema = z.enum(LANGUAGES);
