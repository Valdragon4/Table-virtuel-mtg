/**
 * Placement d'un menu contextuel dans la fenêtre.
 *
 * On mesure le menu réellement rendu plutôt que d'estimer sa hauteur : une
 * estimation ignore les séparateurs, l'en-tête et le repli des libellés, et se
 * trompe toujours par défaut — la dernière entrée finissait hors de l'écran.
 *
 * Règle : sous le point de clic si ça tient, au-dessus sinon, et si le menu est
 * plus haut que la fenêtre entière, il se colle avec un défilement interne.
 */
import { useLayoutEffect, useRef, useState } from 'react';

const MARGIN = 8;

export interface MenuPlacement {
  ref: React.MutableRefObject<HTMLDivElement | null>;
  style: React.CSSProperties;
}

export function useMenuPlacement(x: number, y: number): MenuPlacement {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    left: x,
    top: y,
    // Tant qu'on n'a pas mesuré, le menu occupe la place mais ne s'affiche pas :
    // pas de saut visible entre la position provisoire et la bonne.
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = (): void => {
      const { offsetWidth: width, offsetHeight: height } = element;
      const maxHeight = window.innerHeight - 2 * MARGIN;

      const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));

      let top: number;
      if (height > maxHeight) {
        top = MARGIN;
      } else if (y + height <= window.innerHeight - MARGIN) {
        top = y;
      } else if (y - height >= MARGIN) {
        // Bascule au-dessus du point de clic : c'est le cas d'une carte en main.
        top = y - height;
      } else {
        top = Math.max(MARGIN, window.innerHeight - height - MARGIN);
      }

      // `maxHeight` n'est posé que s'il sert : sinon il modifierait la hauteur
      // mesurée au rendu suivant, et le menu ne se stabiliserait jamais.
      setStyle(
        height > maxHeight
          ? { left, top, maxHeight, overflowY: 'auto', visibility: 'visible' }
          : { left, top, visibility: 'visible' },
      );
    };

    // Une seule mesure, après le rendu : le contenu du menu est statique, et
    // ré-observer sa taille ferait osciller la position.
    measure();
  }, [x, y]);

  return { ref, style };
}
