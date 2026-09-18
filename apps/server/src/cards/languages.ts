/**
 * Ce que le serveur sait de la langue **en propre**.
 *
 * La liste des langues, le défaut, la coercition et le schéma zod ne sont plus
 * ici : ils vivent dans `@mtg/shared` (`packages/shared/src/i18n/language.ts`),
 * parce que le client en a besoin pour les *mêmes* valeurs. Deux définitions
 * parallèles ont existé une journée, et la première divergence aurait rendu 400
 * sur une langue que le sélecteur de l'interface propose encore.
 *
 * Il ne reste donc qu'une constante, et c'est la seule qui n'ait rien à faire
 * dans un module partagé : elle ne décrit pas un choix d'utilisateur mais un
 * fait d'implémentation de *notre* catalogue.
 */
import type { Language } from '@mtg/shared';

/**
 * Langue du catalogue local. Le bulk Scryfall que nous ingérons est anglais :
 * une carte demandée en anglais n'a donc jamais besoin d'être résolue, et une
 * carte introuvable dans une autre langue retombe ici.
 */
export const CATALOG_LANGUAGE: Language = 'en';
