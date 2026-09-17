/**
 * La marque du site : une table vue du dessus, et ses quatre places.
 *
 * Dessin original, identique au favicon (`public/favicon.svg`). La place basse
 * est plus large — c'est celle du joueur local, celle sur laquelle la table se
 * recentre à l'arrivée. Rien ici n'emprunte à l'iconographie de Wizards of the
 * Coast : ce sont cinq rectangles.
 */
export function Mark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <rect width="32" height="32" rx="7" fill="var(--site-stamp)" />
      <g fill="var(--site-paper)">
        <rect x="11" y="11" width="10" height="10" rx="2.6" />
        <rect x="12.5" y="5.4" width="7" height="3" rx="1.5" />
        <rect x="5.4" y="12.5" width="3" height="7" rx="1.5" />
        <rect x="23.6" y="12.5" width="3" height="7" rx="1.5" />
        <rect x="11" y="23.6" width="10" height="3" rx="1.5" />
      </g>
    </svg>
  );
}

/** Le bloc-marque complet : glyphe + nom, tel qu'il apparaît en tête de page. */
export function Wordmark({ size = 28 }: { size?: number }): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark size={size} />
      <span className="sign-sm text-[0.94rem] leading-none text-[color:var(--site-floor-text)]">
        Table virtuelle <span className="text-[color:var(--site-stamp-pale)]">MTG</span>
      </span>
    </span>
  );
}
