/**
 * Ce qui borde l'aire de jeu, et ce qui est gravé dedans.
 *
 * Le sol est une photographie de dallage sous licence CC0, répétée par
 * `TableBackground`. Ce fichier dessine les deux choses qu'aucune texture ne
 * peut savoir, parce qu'elles dépendent de la disposition des sièges :
 *
 *  - `buildScenery` : le **décor**. Le dallage s'arrête sur une bordure de
 *    mosaïque ; au-delà, un sol de feuilles mortes, et un brasero à chaque
 *    angle. C'est ce qui donne une place à la table plutôt qu'un rectangle
 *    flottant — la cour des jeux qui servent de référence.
 *
 *    Une version précédente y dessinait des balustres et des massifs. Vus en
 *    capture, ils lisaient comme du bricolage : de la géométrie simple posée
 *    côte à côte ne fait pas un décor. Un vrai carrelage ornemental,
 *    photographié et sans couture, en fait un.
 *  - `buildOrnament` : l'**emblème gravé** au centre de la dalle et le cadre
 *    doré de l'aire de jeu.
 *
 * Les deux sont séparés parce que le voile d'ambiance passe **entre** eux :
 * le décor doit être assombri par la périphérie comme le reste du sol, alors
 * que la gravure et le cadre se posent par-dessus, au premier plan.
 *
 * Trois principes tiennent ce fichier.
 *
 * 1. **Rien qui ne soit à nous.** La géométrie est calculée ici ; les deux
 *    seules images sont CC0 et leur provenance est consignée dans
 *    `public/table/PROVENANCE.md`.
 *
 * 2. **Rien sous les cartes.** Tout le décor est bâti *à l'extérieur* du
 *    rectangle de jeu, par construction et non par réglage d'opacité. Seule la
 *    gravure du centre passe sous les panneaux, et elle est à peine plus claire
 *    que la pierre.
 *
 * 3. **La gravure est creusée, pas posée.** Chaque trait est doublé : une ligne
 *    sombre, et la même décalée de quelques unités vers le bas en clair. C'est
 *    tout ce qu'il faut pour que l'œil lise un sillon dans la pierre plutôt
 *    qu'un autocollant.
 */

/** Les encres. Ce ne sont pas des couleurs, ce sont des ombres. */
const INK = {
  groove: '#141820',
  lip: '#c8cdd6',
  gild: '#b89a62',
  gildDeep: '#6b5836',
  /** La pierre taillée du muret, plus froide que le dallage. */
  wall: '#3b4350',
  wallLip: '#7d8794',
  wallShade: '#10141c',
  /** La braise. */
  ember: '#ff9d4d',
  emberCore: '#ffd9a0',
} as const;

/** Un rectangle arrondi, en chemin. */
function frame(cx: number, cy: number, halfW: number, halfH: number, radius: number): string {
  const l = cx - halfW;
  const r = cx + halfW;
  const t = cy - halfH;
  const b = cy + halfH;
  const k = Math.min(radius, halfW, halfH);
  return [
    `M ${l + k} ${t}`,
    `H ${r - k}`,
    `A ${k} ${k} 0 0 1 ${r} ${t + k}`,
    `V ${b - k}`,
    `A ${k} ${k} 0 0 1 ${r - k} ${b}`,
    `H ${l + k}`,
    `A ${k} ${k} 0 0 1 ${l} ${b - k}`,
    `V ${t + k}`,
    `A ${k} ${k} 0 0 1 ${l + k} ${t}`,
    'Z',
  ].join(' ');
}

/** Un losange couché, centré sur un point, orienté selon un axe. */
function lozenge(x: number, y: number, long: number, wide: number, vertical: boolean): string {
  const lx = vertical ? wide : long;
  const ly = vertical ? long : wide;
  return [
    `${(x - lx).toFixed(1)},${y.toFixed(1)}`,
    `${x.toFixed(1)},${(y - ly).toFixed(1)}`,
    `${(x + lx).toFixed(1)},${y.toFixed(1)}`,
    `${x.toFixed(1)},${(y + ly).toFixed(1)}`,
  ].join(' ');
}

/**
 * La cadence de losanges le long du cadre : c'est elle qui fait lire une
 * ferrure plutôt qu'un trait. Le pas est recalculé pour tomber juste sur chaque
 * côté, faute de quoi les coins reçoivent un intervalle bâtard qu'on remarque.
 */
function cadence(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  step: number,
  long: number,
  wide: number,
): React.ReactElement[] {
  const shapes: React.ReactElement[] = [];
  const alongX = Math.max(2, Math.round((halfW * 2) / step));
  const alongY = Math.max(2, Math.round((halfH * 2) / step));

  for (let i = 0; i <= alongX; i++) {
    const x = cx - halfW + (i * halfW * 2) / alongX;
    shapes.push(<polygon key={`t${i}`} points={lozenge(x, cy - halfH, long, wide, false)} />);
    shapes.push(<polygon key={`b${i}`} points={lozenge(x, cy + halfH, long, wide, false)} />);
  }
  for (let i = 1; i < alongY; i++) {
    const y = cy - halfH + (i * halfH * 2) / alongY;
    shapes.push(<polygon key={`l${i}`} points={lozenge(cx - halfW, y, long, wide, true)} />);
    shapes.push(<polygon key={`r${i}`} points={lozenge(cx + halfW, y, long, wide, true)} />);
  }
  return shapes;
}

/**
 * Générateur déterministe.
 *
 * Les feuilles éparpillées doivent tomber au même endroit chez tout le monde :
 * le décor vit dans le monde partagé, et deux joueurs qui ne voient pas la même
 * feuille au même endroit ne voient pas la même table. `Math.random` est donc
 * exclu.
 */
function sower(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * L'emblème gravé : un anneau denté, ses satellites, et les quatre points
 * cardinaux — une place par siège. Rendu deux fois par l'appelant, une fois en
 * creux et une fois en lèvre : la fonction ne connaît ni couleur ni opacité.
 */
function sigil(cx: number, cy: number, r: number): React.ReactElement {
  const teeth: React.ReactElement[] = [];
  const TOOTH_COUNT = 36;
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const a = (i * 2 * Math.PI) / TOOTH_COUNT;
    teeth.push(
      <line
        key={`d${i}`}
        x1={cx + r * 0.42 * Math.cos(a)}
        x2={cx + r * 0.5 * Math.cos(a)}
        y1={cy + r * 0.42 * Math.sin(a)}
        y2={cy + r * 0.5 * Math.sin(a)}
      />,
    );
  }

  const satellites: React.ReactElement[] = [];
  const SAT_COUNT = 8;
  for (let i = 0; i < SAT_COUNT; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / SAT_COUNT;
    const sx = cx + r * 0.78 * Math.cos(a);
    const sy = cy + r * 0.78 * Math.sin(a);
    satellites.push(
      <g key={`s${i}`}>
        <circle cx={sx} cy={sy} r={r * 0.13} />
        <circle cx={sx} cy={sy} r={r * 0.08} />
        <line
          x1={cx + r * 0.58 * Math.cos(a)}
          x2={cx + r * 0.65 * Math.cos(a)}
          y1={cy + r * 0.58 * Math.sin(a)}
          y2={cy + r * 0.65 * Math.sin(a)}
        />
      </g>,
    );
  }

  return (
    <g>
      <circle cx={cx} cy={cy} r={r * 0.58} />
      <circle cx={cx} cy={cy} r={r * 0.5} />
      <circle cx={cx} cy={cy} r={r * 0.42} />
      <circle cx={cx} cy={cy} r={r * 0.24} />
      {teeth}
      {satellites}
    </g>
  );
}

/**
 * Les mesures du décor, dérivées de la seule grille des sièges.
 *
 * Tout est en fraction du plus petit côté : la composition tient donc de un à
 * quatre joueurs sans réglage, et un siège qui s'ajoute repousse le décor au
 * lieu de le faire chevaucher l'aire de jeu.
 */
function measures(w: number, h: number, gridW: number, gridH: number) {
  const unit = Math.min(gridW, gridH);
  const inset = unit * 0.05;
  const innerW = gridW / 2 + inset;
  const innerH = gridH / 2 + inset;
  /** Le dallage déborde encore un peu au-delà du cadre : c'est le parvis. */
  const apron = unit * 0.3;
  /** L'épaisseur du muret. */
  const wall = unit * 0.075;
  const paveW = innerW + apron;
  const paveH = innerH + apron;
  const wallW = paveW + wall;
  const wallH = paveH + wall;
  return {
    cx: w / 2,
    cy: h / 2,
    unit,
    inset,
    innerW,
    innerH,
    apron,
    wall,
    paveW,
    paveH,
    wallW,
    wallH,
    radius: unit * 0.08,
  };
}

/**
 * De combien le décor déborde la grille des sièges, de chaque côté.
 *
 * `Table` en a besoin pour cadrer : « Voir toute la table » montrait la grille
 * au pixel près, donc exactement ce qu'il fallait voir avant qu'il y ait un
 * décor — et pas un balustre après. La valeur est dérivée des mêmes fractions
 * que le décor lui-même, pour qu'elle ne puisse pas s'en désynchroniser.
 */
export function sceneryMargin(gridW: number, gridH: number): number {
  const unit = Math.min(gridW, gridH);
  // cadre (0,05) + parvis (0,30) + muret (0,075) + massifs (0,11 + 0,19).
  return unit * 0.725;
}

/**
 * Le décor autour de l'aire de jeu : sol de feuilles, muret, balustres,
 * massifs, braseros. Rendu **sous** le voile d'ambiance, pour s'assombrir avec
 * la périphérie comme le reste du sol.
 */
export function buildScenery(
  w: number,
  h: number,
  gridW: number,
  gridH: number,
): React.ReactElement {
  const m = measures(w, h, gridW, gridH);
  const { cx, cy, unit } = m;
  const outer = frame(cx, cy, m.wallW, m.wallH, m.radius * 1.5);
  const paved = frame(cx, cy, m.paveW, m.paveH, m.radius * 1.4);

  /** Une feuille : un simple ovale incliné, qui suffit à cette taille. */
  const leaves: React.ReactElement[] = [];
  const random = sower(0x5eed);
  const LEAF_COUNT = 260;
  for (let i = 0; i < LEAF_COUNT; i++) {
    // Semées sur une couronne autour de l'aire de jeu : denses près du bord,
    // rares vers le centre — c'est ainsi que le vent les dépose vraiment.
    const side = Math.floor(random() * 4);
    const along = random();
    const depth = random() ** 1.8;
    const x =
      side === 0 || side === 1
        ? cx - m.paveW + along * m.paveW * 2
        : cx + (side === 2 ? -1 : 1) * (m.paveW - depth * m.apron * 1.2);
    const y =
      side === 0 || side === 1
        ? cy + (side === 0 ? -1 : 1) * (m.paveH - depth * m.apron * 1.2)
        : cy - m.paveH + along * m.paveH * 2;
    const size = unit * (0.006 + random() * 0.006);
    leaves.push(
      <ellipse
        key={`f${i}`}
        cx={x}
        cy={y}
        fill={random() > 0.55 ? '#7a5a32' : '#6b4f2c'}
        fillOpacity={0.35 + random() * 0.35}
        rx={size}
        ry={size * 0.55}
        transform={`rotate(${Math.round(random() * 180)} ${x.toFixed(1)} ${y.toFixed(1)})`}
      />,
    );
  }

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Les matières, toutes CC0. Voir public/table/PROVENANCE.md. */}
        <pattern height={unit * 0.55} id="sc-leaves" patternUnits="userSpaceOnUse" width={unit * 0.55}>
          <image height={unit * 0.55} href="/table/foliage.jpg" width={unit * 0.55} />
        </pattern>
        {/*
          La bordure de mosaïque. C'est un vrai carrelage ornemental photographié
          et sans couture, et il a remplacé une rangée de balustres et de massifs
          que nous dessinions : de la géométrie simple posée côte à côte lisait
          comme du bricolage, là où un motif dessiné par un carreleur lit comme
          un sol. La tuile est calée pour que le motif tombe juste sur la largeur
          de la bande.
        */}
        <pattern
          height={m.wall * 2}
          id="sc-mosaic"
          patternUnits="userSpaceOnUse"
          width={m.wall * 2}
        >
          <image height={m.wall * 2} href="/table/mosaic.jpg" width={m.wall * 2} />
        </pattern>

        <radialGradient id="sc-ember" r="50%">
          <stop offset="0%" stopColor={INK.emberCore} stopOpacity="0.5" />
          <stop offset="30%" stopColor={INK.ember} stopOpacity="0.26" />
          <stop offset="100%" stopColor={INK.ember} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sc-drop" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={INK.wallShade} stopOpacity="0.55" />
          <stop offset="100%" stopColor={INK.wallShade} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/*
       * Le sol au-delà de la bordure : feuilles mortes. Il couvre tout sauf
       * l'aire pavée — d'où la règle `evenodd` et le trou au milieu.
       */}
      <path
        d={`M0 0 H${w} V${h} H0 Z ${outer}`}
        fill="url(#sc-leaves)"
        fillOpacity="0.9"
        fillRule="evenodd"
      />
      <path
        d={`M0 0 H${w} V${h} H0 Z ${outer}`}
        fill="#0a0d14"
        fillOpacity="0.22"
        fillRule="evenodd"
      />

      {/* La bande de mosaïque, entre le parvis et le sol de feuilles. */}
      <path d={`${outer} ${paved}`} fill="url(#sc-mosaic)" fillRule="evenodd" />
      {/* À peine refroidie, pour qu'elle appartienne au même monde que la dalle. */}
      <path d={`${outer} ${paved}`} fill="#101828" fillOpacity="0.3" fillRule="evenodd" />

      {/* Les deux joints de pierre qui la bordent : c'est ce qui la pose. */}
      <path
        d={paved}
        fill="none"
        stroke={INK.wallShade}
        strokeOpacity="0.65"
        strokeWidth={Math.max(3, m.wall * 0.1)}
      />
      <path
        d={outer}
        fill="none"
        stroke={INK.wallShade}
        strokeOpacity="0.5"
        strokeWidth={Math.max(3, m.wall * 0.12)}
      />

      {/* Les braseros des quatre angles, et la flaque de lumière qu'ils jettent. */}
      {[
        [cx - m.wallW, cy - m.wallH],
        [cx + m.wallW, cy - m.wallH],
        [cx - m.wallW, cy + m.wallH],
        [cx + m.wallW, cy + m.wallH],
      ].map(([bx, by], i) => (
        <g key={`br${i}`}>
          <circle cx={bx} cy={by} fill="url(#sc-ember)" r={unit * 0.4} />
          <circle
            cx={bx}
            cy={by}
            fill={INK.wall}
            r={unit * 0.04}
            stroke={INK.wallShade}
            strokeOpacity="0.7"
            strokeWidth={Math.max(2, unit * 0.004)}
          />
          <circle cx={bx} cy={by} fill={INK.emberCore} fillOpacity="0.7" r={unit * 0.02} />
        </g>
      ))}

      {/* Les feuilles que le vent a poussées sur le parvis. */}
      <g>{leaves}</g>

      {/* L'ombre de la bordure, tombant vers l'intérieur. */}
      <path
        d={paved}
        fill="none"
        stroke="url(#sc-drop)"
        strokeOpacity="0.45"
        strokeWidth={m.apron * 0.2}
      />
    </svg>
  );
}

/**
 * L'emblème gravé et le cadre de l'aire de jeu. Rendu **au-dessus** du voile :
 * ce sont les repères de jeu, ils ne doivent pas s'éteindre avec le décor.
 */
export function buildOrnament(
  w: number,
  h: number,
  gridW: number,
  gridH: number,
): React.ReactElement {
  const m = measures(w, h, gridW, gridH);
  const { cx, cy, inset, innerW, innerH, radius } = m;

  const sigilR = Math.min(gridW, gridH) * 0.3;
  const lip = Math.max(3, sigilR * 0.012);

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* L'emblème gravé : le creux d'abord, puis sa lèvre décalée vers le bas. */}
      <g fill="none" stroke={INK.groove} strokeOpacity="0.5" strokeWidth={Math.max(4, sigilR * 0.014)}>
        {sigil(cx, cy, sigilR)}
      </g>
      <g fill="none" stroke={INK.lip} strokeOpacity="0.16" strokeWidth={Math.max(3, sigilR * 0.01)}>
        {sigil(cx, cy + lip, sigilR)}
      </g>

      {/* Le cadre de l'aire de jeu : une ferrure posée sur le dallage. */}
      <g fill="none" stroke={INK.gildDeep} strokeOpacity="0.55">
        <path d={frame(cx, cy, innerW, innerH, radius)} strokeWidth={Math.max(7, inset * 0.16)} />
      </g>
      <g fill="none" stroke={INK.gild} strokeOpacity="0.42">
        <path d={frame(cx, cy, innerW, innerH, radius)} strokeWidth={Math.max(3, inset * 0.06)} />
        <path
          d={frame(cx, cy, innerW * 1.014, innerH * 1.024, radius)}
          strokeOpacity="0.2"
          strokeWidth={Math.max(2, inset * 0.04)}
        />
      </g>
      <g fill={INK.gild} fillOpacity="0.4">
        {cadence(cx, cy, innerW, innerH, m.apron * 0.5, inset * 0.34, inset * 0.13)}
      </g>
    </svg>
  );
}
