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
    /*
     * En **capture**, comme `Dialog`, `CardMenu`, `TableMenu`, `LookModal` et
     * `ZoneMenu`.
     *
     * Tous ces voisins écoutent `Échap` en capture **et** coupent la
     * propagation. Un écouteur posé ici en bouillonnement ne recevait donc
     * jamais la touche dès que l'un d'eux était monté : la surface restait
     * ouverte, et son voile plein écran avalait ensuite tous les clics — ce que
     * l'en-tête de ce fichier annonce précisément comme le dégât à éviter.
     *
     * Le cas s'est réellement produit sur `ZoneMenu`, où le drapeau avait été
     * retiré par inadvertance : dix étapes saines de `verify-ui` tombaient en
     * cascade, et le coupable a mis une matinée à se désigner.
     */
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
}
