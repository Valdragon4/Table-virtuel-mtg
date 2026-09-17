/**
 * Dos de carte.
 *
 * Trois niveaux, dans cet ordre :
 *
 * 1. **Le dos personnalisé du joueur**, s'il en a configuré un — c'est son choix
 *    et il prime sur tout.
 * 2. **Le dos officiel de Magic**, chargé depuis le CDN de Scryfall par le
 *    navigateur du joueur. C'est une illustration de Wizards of the Coast, et
 *    nous l'affichons exactement comme les faces de cartes : leur politique de
 *    contenu de fan l'autorise pour un projet non commercial, ce que ce projet
 *    déclare être. La règle tenue n'est pas « aucun asset » mais **« rien
 *    d'hébergé, rien de proxifié, rien de mis en cache »** — le dépôt ne contient
 *    aucune copie, et notre serveur ne sert jamais cette image.
 * 3. **Un dos dessiné**, original, si l'image ne charge pas : réseau coupé,
 *    CDN indisponible, URL personnalisée cassée. Une table sans dos de carte
 *    serait illisible ; ce repli garantit qu'il y en a toujours un.
 */
import { useEffect, useState } from 'react';
import { scryfallCardBack } from '../lib/cards.js';

export function CardBack({
  url,
  version = 'normal',
  className = '',
}: {
  url?: string | null;
  version?: 'small' | 'normal' | 'large';
  className?: string;
}): React.ReactElement {
  const source = url ?? scryfallCardBack(version);
  const [failed, setFailed] = useState(false);

  // Changer de source doit redonner sa chance à l'image : sans cela, un échec
  // sur un dos personnalisé condamnerait aussi le dos par défaut.
  useEffect(() => setFailed(false), [source]);

  if (!failed) {
    return (
      <img
        alt="Dos de carte"
        className={`h-full w-full rounded-[6px] object-cover ${className}`}
        draggable={false}
        loading="lazy"
        src={source}
        onError={() => setFailed(true)}
      />
    );
  }

  return <DrawnBack className={className} />;
}

/** Dos de repli, dessiné ici de bout en bout — aucun emprunt. */
function DrawnBack({ className }: { className: string }): React.ReactElement {
  return (
    <div className={`relative h-full w-full overflow-hidden rounded-[6px] ${className}`}>
      <svg aria-hidden className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 166 230">
        <defs>
          <radialGradient id="cb-core" cx="50%" cy="46%" r="62%">
            <stop offset="0%" stopColor="#3b3357" />
            <stop offset="55%" stopColor="#221d36" />
            <stop offset="100%" stopColor="#100d1c" />
          </radialGradient>
          <linearGradient id="cb-edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6b5a3a" />
            <stop offset="50%" stopColor="#b79b5e" />
            <stop offset="100%" stopColor="#6b5a3a" />
          </linearGradient>
        </defs>

        <rect width="166" height="230" fill="url(#cb-edge)" rx="8" />
        <rect x="5" y="5" width="156" height="220" fill="url(#cb-core)" rx="5" />
        <rect
          x="11"
          y="11"
          width="144"
          height="208"
          fill="none"
          stroke="#b79b5e"
          strokeOpacity="0.45"
          strokeWidth="1"
          rx="3"
        />

        <g transform="translate(83 115)" fill="none" stroke="#c7ad72" strokeOpacity="0.7">
          <circle r="42" strokeWidth="1.2" />
          <circle r="33" strokeWidth="0.6" strokeOpacity="0.45" />
          <circle r="21" strokeWidth="1" />
          <path d="M0 -46 L11 0 L0 46 L-11 0 Z" strokeWidth="1.1" />
          <path d="M-46 0 L0 11 L46 0 L0 -11 Z" strokeWidth="1.1" />
          <circle r="5" fill="#c7ad72" stroke="none" fillOpacity="0.85" />
        </g>

        <g stroke="#b79b5e" strokeOpacity="0.35" strokeWidth="1" fill="none">
          <path d="M18 18 q16 2 20 18 q-18 -2 -20 -18" />
          <path d="M148 18 q-16 2 -20 18 q18 -2 20 -18" />
          <path d="M18 212 q16 -2 20 -18 q-18 2 -20 18" />
          <path d="M148 212 q-16 -2 -20 -18 q18 2 20 18" />
        </g>
      </svg>
    </div>
  );
}
