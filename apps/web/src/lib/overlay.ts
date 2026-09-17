/**
 * Fermeture d'une surface modale à la touche Échap.
 *
 * Ce geste est attendu partout : un voile plein écran qui ne se ferme pas au
 * clavier finit par avaler tous les clics de la table.
 */
import { useEffect } from 'react';

export function useCloseOnEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
