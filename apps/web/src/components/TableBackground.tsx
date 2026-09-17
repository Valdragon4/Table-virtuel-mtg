import { useMemo } from 'react';
import { buildOrnament, buildScenery, sceneryMargin } from './tableBoard.js';
import { GAP, PANEL_HEIGHT, PANEL_WIDTH } from './SeatPanel.js';

/**
 * Fond de table : une **dalle de pierre vue du dessus**.
 *
 * C'est la langue visuelle de Legend of Runeterra, de Teamfight Tactics ou de
 * Magic Arena, et elle est juste pour cet usage — non par goût, mais parce
 * qu'un dallage est **radial** : il se lit pareil des quatre côtés. Les deux
 * versions précédentes de ce fond étaient des paysages, avec un haut et un
 * bas ; à quatre sièges disposés en croix, cela fait un joueur bien placé et
 * trois qui regardent le ciel de côté.
 *
 * Le sol est une **photographie de dallage sous licence CC0**, répétée. Elle a
 * remplacé un dallage que nous dessinions : une texture donne la matière — le
 * grain, l'usure, les éclats de bord — qu'aucune géométrie ne rend. Ce qui
 * reste dessiné (`tableBoard`) est ce qu'aucune texture ne peut savoir :
 * l'emblème gravé au centre et le cadre de l'aire de jeu, calés sur la
 * disposition des sièges.
 *
 * Quatre propriétés portent ce composant.
 *
 * 1. **Il vit dans le repère du monde partagé.** Il est rendu à l'intérieur du
 *    plan transformé, à des coordonnées dérivées de la seule disposition des
 *    sièges — jamais du siège local. Deux joueurs voient la même dalle dans la
 *    même orientation, et un curseur posé sur une gravure tombe sur cette
 *    gravure chez l'autre.
 *
 * 2. **Rien de Wizards of the Coast.** La texture est du domaine public et sa
 *    provenance est consignée dans `public/table/PROVENANCE.md`. Les faces de
 *    cartes et le dos officiel restent chargés par le navigateur du joueur
 *    depuis le CDN de Scryfall, sans copie dans ce dépôt. Un opérateur peut
 *    substituer sa propre image par `VITE_TABLE_BACKGROUND_URL`, à sa charge
 *    d'en détenir les droits.
 *
 * 3. **Aucun bord atteignable.** La texture est **sans couture** et répétée sur
 *    toute la surface, débordement compris (`BLEED` de chaque côté de la grille
 *    des sièges) : il n'y a pas de bord, il n'y a que du dallage. Un
 *    assombrissement radial éteint la périphérie, pour que l'œil revienne au
 *    centre.
 *
 * 4. **Ça reste un fond.** La dalle est assombrie et désaturée sous un voile,
 *    et la gravure est à peine plus claire que la pierre. Le playmat de siège
 *    étant translucide, le sol traverse la table : tout ce qui passe dessous
 *    doit être calme.
 *
 * **Coût.** Rien n'est recalculé au pan ni au zoom : la répétition est faite
 * par le compositeur, qui ne rasterise que les tuiles visibles, et l'ornement
 * est figé par `useMemo`. **Aucun filtre SVG n'est appliqué à la surface** —
 * un `feTurbulence` étalé sur 30 000 px serait recalculé à chaque changement
 * d'échelle et détruirait la fluidité du plan.
 */

/**
 * Marge de décor débordant la grille des sièges, en unités de monde.
 *
 * La borne haute est imposée par le rasteriseur : au-delà de 32 767 px de
 * côté, la peinture d'un élément décroche. 14 000 laisse
 * `2 × 14000 + 2568 ≈ 30 570`.
 */
const BLEED = 14000;

/**
 * Côté d'une tuile de dallage, en unités de monde.
 *
 * L'image fait 1024 px et porte quatre dalles par côté : à 880 unités la
 * tuile, une dalle mesure ~220 unités, soit un peu plus qu'une carte (166).
 * C'est la proportion des jeux de référence — une carte tient sur une dalle et
 * demie — et l'image reste légèrement réduite, donc nette.
 */
const TILE = 880;

const OPERATOR_IMAGE: string | undefined = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env?.['VITE_TABLE_BACKGROUND_URL'];

/**
 * L'arène illustrée, fournie par le propriétaire du projet.
 *
 * Elle représente exactement ce que le dallage dessiné cherchait à approcher :
 * une cour vue du dessus, quatre aires de jeu autour d'un emblème central. Elle
 * remplace donc la matière **et** le décor, qui feraient double emploi.
 *
 * Provenance et droits : `public/table/PROVENANCE.md`.
 */
const ARENA = '/table/arena.jpg';

/**
 * Proportions de l'illustration, et son ampleur.
 *
 * Deux choses réglées ensemble, parce qu'elles se tenaient :
 *
 *  - **le rapport est respecté.** Un `backgroundSize: 100% 100%` étirait l'image
 *    aux proportions de la grille — à un seul joueur, 1260 × 660, soit un
 *    aplatissement de moitié : la cour devenait un couloir ;
 *  - **l'ampleur.** Elle était calée sur la grille plus 42 % ; l'image tenait
 *    donc à peine autour des panneaux et se perdait dans le noir. Elle couvre
 *    maintenant plus de deux fois la grille dans les deux dimensions : on voit
 *    la cour, ses escaliers et sa rivière, pas seulement son dallage central.
 *
 * La limite est la définition : l'image fait 2200 px de large. À ce facteur
 * elle est étirée d'environ quatre fois sa taille, et se ramollit à hauteur de
 * jeu — c'est le prix de l'ampleur demandée, et le seul moyen de le lever
 * serait une source plus définie.
 */
const ARENA_RATIO = 2200 / 1575;
const ARENA_COVER = 3.45;

/**
 * Taille de référence de l'arène : **celle d'une table pleine**, toujours.
 *
 * La calquer sur la grille courante la faisait grandir à chaque joueur qui
 * s'assoit : la cour changeait d'échelle en pleine partie, et l'on ne
 * reconnaissait plus l'endroit. L'arène est un lieu, pas une conséquence du
 * nombre de convives — elle est donc dimensionnée une fois pour toutes sur la
 * grille à quatre sièges, qui est le plafond (`LIMITS.maxSeats`).
 */
const FULL_GRID = {
  width: 2 * (PANEL_WIDTH + GAP) - GAP,
  height: 2 * (PANEL_HEIGHT + GAP) - GAP,
};

/**
 * Où la table est-elle posée ?
 *
 * Deux fonds coexistent : l'arène illustrée, et le dallage que nous
 * composons. Le second reste dans le code parce qu'il est **le nôtre** — il ne
 * dépend d'aucune image fournie, et c'est vers lui qu'on retombe si l'on veut
 * un fond entièrement libre de droits.
 *
 * Le choix se fait au moment du rendu, sans reconstruction :
 * `localStorage.setItem('mtg.fond', 'dalle')` pour revenir au dallage,
 * `'arene'` pour l'illustration, rien pour le défaut.
 */
function chosenBackground(): 'arene' | 'dalle' {
  try {
    return localStorage.getItem('mtg.fond') === 'dalle' ? 'dalle' : 'arene';
  } catch {
    // Stockage refusé (navigation privée) : le défaut, sans bruit.
    return 'arene';
  }
}

export function TableBackground({
  width,
  height,
}: {
  width: number;
  height: number;
}): React.ReactElement {
  const w = width + BLEED * 2;
  const h = height + BLEED * 2;

  /**
   * L'ornement est ancré sur le centre de la grille des sièges. `useMemo` le
   * fige : il ne dépend que de l'encombrement de la grille, c'est-à-dire du
   * nombre de joueurs, et pas du tout de la caméra.
   */
  const scenery = useMemo(() => buildScenery(w, h, width, height), [w, h, width, height]);
  const ornament = useMemo(() => buildOrnament(w, h, width, height), [w, h, width, height]);

  /**
   * Le voile. Il fait trois choses d'un coup, et c'est pour cela qu'il est un
   * seul dégradé : il refroidit la pierre pour qu'elle s'accorde au reste de
   * l'interface, il l'assombrit assez pour qu'une carte claire s'en détache, et
   * il éteint la périphérie pour ramener l'œil au centre de la table.
   *
   * Son rayon est calé sur l'**encombrement du décor**, pas sur celui de la
   * grille : réglé sur la grille seule, il éteignait le muret, les massifs et
   * les braseros au moment même où l'on dézoomait pour les regarder.
   */
  /**
   * L'encombrement de l'illustration : assez grande pour couvrir la grille dans
   * les deux sens, et à son propre rapport — jamais étirée.
   */
  const arena = (() => {
    const w2 = Math.max(
      FULL_GRID.width * ARENA_COVER,
      FULL_GRID.height * ARENA_COVER * ARENA_RATIO,
    );
    return { width: w2, height: w2 / ARENA_RATIO };
  })();

  const margin = sceneryMargin(width, height);
  const veilX = Math.round((width / 2 + margin) * 1.9);
  const veilY = Math.round((height / 2 + margin) * 1.9);
  const veil =
    `radial-gradient(ellipse ${veilX}px ${veilY}px at 50% 50%,` +
    ` rgb(10 14 24 / 18%) 0%, rgb(8 11 20 / 26%) 55%, rgb(5 7 13 / 60%) 80%, rgb(3 5 9 / 92%) 100%)`;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      data-test="table-background"
      style={{ left: -BLEED, top: -BLEED, width: w, height: h, zIndex: 0 }}
    >
      {OPERATOR_IMAGE ? (
        <img alt="" className="h-full w-full object-cover opacity-60" src={OPERATOR_IMAGE} />
      ) : chosenBackground() === 'arene' ? (
        <>
          {/*
            L'arène est posée **centrée sur la grille des sièges**, et non
            étirée sur toute la surface de débordement : à 30 000 px de côté,
            un `object-cover` l'aurait diluée jusqu'à l'illisible. Autour, le
            vide reste noir — il n'y a donc toujours aucun bord à atteindre,
            seulement une table posée dans l'obscurité.
          */}
          <div
            className="absolute"
            data-test="table-arena"
            style={{
              left: BLEED + width / 2 - arena.width / 2,
              top: BLEED + height / 2 - arena.height / 2,
              width: arena.width,
              height: arena.height,
              backgroundImage: `url("${ARENA}")`,
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
              /*
                Les bords de l'illustration se dissolvent dans le noir. Sans
                masque, le rectangle se voyait franchement dès qu'on dézoomait :
                une table posée sur rien, avec une découpe nette au couteau.
              */
              maskImage:
                'radial-gradient(ellipse 58% 58% at 50% 50%, #000 62%, rgb(0 0 0 / 0.35) 84%, transparent 100%)',
              WebkitMaskImage:
                'radial-gradient(ellipse 58% 58% at 50% 50%, #000 62%, rgb(0 0 0 / 0.35) 84%, transparent 100%)',
            }}
          />
          {/*
            Le voile, plus léger qu'avec le dallage : l'illustration porte déjà
            sa propre lumière, et l'assombrir autant l'éteindrait. Il reste là
            pour que les cartes se détachent et pour fondre les bords de l'image
            dans le noir.
          */}
          <div
            className="absolute inset-0"
            style={{
              background:
                `radial-gradient(ellipse ${veilX}px ${veilY}px at 50% 50%,` +
                ` rgb(10 14 24 / 10%) 0%, rgb(8 11 20 / 16%) 46%,` +
                ` rgb(5 7 13 / 62%) 72%, rgb(3 5 9 / 96%) 100%)`,
            }}
          />
          {ornament}
        </>
      ) : (
        <>
          {/* Le dallage, répété. Sans couture : il n'a donc pas de bord. */}
          <div
            className="absolute inset-0"
            data-test="table-floor"
            style={{
              backgroundImage: 'url("/table/stone-floor.jpg")',
              backgroundRepeat: 'repeat',
              backgroundSize: `${TILE}px ${TILE}px`,
            }}
          />
          {/*
           * Le décor — muret, massifs, braseros — puis le voile, puis seulement
           * les repères de jeu. L'ordre compte : le décor doit s'éteindre avec
           * la périphérie comme le sol, alors que le cadre de l'aire de jeu et
           * la gravure sont des repères et ne doivent pas s'assombrir avec lui.
           */}
          {scenery}
          <div className="absolute inset-0" style={{ background: veil }} />
          {ornament}
        </>
      )}
    </div>
  );
}
