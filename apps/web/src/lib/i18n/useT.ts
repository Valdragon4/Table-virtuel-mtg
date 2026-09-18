/**
 * Le lien entre la langue courante et le moteur de traduction.
 *
 * C'est le seul fichier du dossier qui connaît React et le store : `t` et
 * `resolveCardImage` restent purs et testables sans DOM. Un composant n'écrit
 * donc jamais `t(language, …)` à la main — il prend `const t = useT()`.
 */
import { useMemo } from 'react';
import { useLanguage } from '../../store/prefs.js';
import { translator, type BoundT } from './translate.js';

/**
 * `useMemo` sur la langue, pas seulement par économie : une fonction recréée à
 * chaque rendu est une nouvelle référence, et tout `useEffect` ou `useMemo` qui
 * la prendrait en dépendance repartirait en boucle. Même famille de piège que
 * les sélecteurs zustand qui construisent un tableau.
 */
export function useT(): BoundT {
  const language = useLanguage();
  return useMemo(() => translator(language), [language]);
}
