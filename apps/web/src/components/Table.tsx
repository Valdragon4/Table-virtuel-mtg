import { memo, useEffect, useRef, useState } from 'react';
import type { CardView, ZoneRef } from '@mtg/shared';
import { useGame, zoneKey } from '../store/game.js';
import { COMMAND_COLUMN, PANEL_HEIGHT, PANEL_WIDTH, SeatPanel } from './SeatPanel.js';
import { startCardDrag } from './DragLayer.js';
import { TableLabel } from './TableLabel.js';
import { TableBackground } from './TableBackground.js';
import { sceneryMargin } from './tableBoard.js';
import { GAP } from './SeatPanel.js';
import { OpponentHand } from './OpponentHand.js';
import { rotateToBottom, toShared, toView, type Cell } from '../lib/seatView.js';
import { handRailHeight } from '../lib/handMetrics.js';
import { groupOf, tapIntent } from '../lib/tap.js';
import { findDropTarget } from '../lib/drag.js';


/** Agrandissement maximal : une carte n'a pas à dépasser sa taille de référence. */
const MAX_SCALE = 2.5;
/** Plancher absolu, au cas où le cadre serait minuscule. */
const MIN_SCALE_FLOOR = 0.14;
const CURSOR_INTERVAL_MS = 50;

/**
 * La surface du plan : `overflow-clip`, et surtout pas `overflow-hidden`.
 *
 * Les deux rognent pareil, mais `hidden` fait de la surface une **boîte
 * défilante**. Le navigateur a alors le droit de la faire défiler tout seul
 * pour amener un descendant à l'écran — un bouton qui prend le focus, un
 * `scrollIntoView` — et il n'existe aucune barre pour revenir. Le plan reste
 * décalé **sans que la caméra ait changé** : `view.x/y` et le `transform`
 * disent une chose, les pixels en disent une autre. Or tout ce qui convertit
 * l'écran vers le monde part du rectangle de la surface et de ce transform,
 * jamais du défilement : un dépôt, un curseur, un lasso atterrissent alors à
 * côté, d'autant de pixels que la surface a glissé — mesuré à 38 × 260 px, et
 * rien ne le remet jamais à zéro. Les pastilles de marqueur devenues des
 * `<button>` rendent le cas bien plus atteignable qu'avant, puisqu'elles
 * vivent dans le plan et prennent le focus. `clip` rogne sans créer de boîte
 * défilante : le décalage devient impossible.
 */
const SURFACE_CLASS = 'table-surface absolute inset-0 overflow-clip';

/**
 * Encombrement des panneaux flottants, en pixels écran. Le cadrage automatique
 * les évite : un panneau de siège caché sous le journal ne serait pas cliquable.
 */
const SIDE_LOG_WIDTH = 304;
const SIDE_PANEL_WIDTH = 240;
const TOP_BAR_HEIGHT = 60;
/**
 * Ce que le rail de main prend en bas de l'écran.
 *
 * Il n'est plus figé : sa hauteur suit la fenêtre (`handRailHeight`). La
 * constante d'avant valait 256 px partout, si bien que sur un écran court la
 * caméra cadrait sur une place que la main n'occupait pas — et sur un grand
 * écran elle s'en réservait une qu'elle n'utilisait pas.
 */
function handHeight(): number {
  return handRailHeight(window.innerWidth, window.innerHeight) + 12;
}

/**
 * Plan de table : pan, zoom, et disposition des zones de chaque joueur. Le siège
 * local est toujours en bas au centre, les autres autour, comme à une vraie table.
 *
 * **Et il ne se re-rend que pour lui-même.**
 *
 * `Table` n'a aucune prop : tout ce dont il dépend est lu dans le magasin, et
 * chaque lecture est déjà un abonnement précis. Mais il est rendu par
 * `RoomPage`, qui porte une dizaine d'états locaux — panneau des zones,
 * recherche de jeton, réglages, aide, bandeau de refus. Chacun re-rendait la
 * page, donc le plan entier, alors que rien de la table n'avait bougé. Le cas
 * qui a fait tomber la recette est le plus sournois parce qu'il n'est
 * déclenché par aucun geste : `lastReject` s'efface **tout seul quatre
 * secondes après** un intent refusé, et ce minuteur-là tombe où il veut — y
 * compris au milieu d'une mesure de `window.__mtgTableRenders`, où il se lit
 * « le survol du cimetière re-rend la table ». Mesuré : un refus coûtait deux
 * rendus du plan, l'ouverture-fermeture du panneau des zones deux autres.
 *
 * `memo` sur un composant sans prop est exactement la bonne réponse : il coupe
 * le lien avec le rendu du parent sans rien changer aux abonnements, et le
 * compteur continue donc de mesurer ce pour quoi il existe — les rendus dus à
 * l'état de la table.
 */
export const Table = memo(function Table(): React.ReactElement {
  const seats = useGame((s) => s.seats);
  const cards = useGame((s) => s.cards);
  const counts = useGame((s) => s.zoneCounts);
  const labels = useGame((s) => s.labels);
  const chat = useGame((s) => s.chat);
  const mySeat = useGame((s) => s.mySeat);
  const selection = useGame((s) => s.selection);
  const setSelection = useGame((s) => s.setSelection);
  const toggleSelected = useGame((s) => s.toggleSelected);
  const openMenu = useGame((s) => s.openMenu);
  const activeSeat = useGame((s) => s.turn.activeSeat);
  const turnNumber = useGame((s) => s.turn.turnNumber);
  const send = useGame((s) => s.send);

  const drag = useGame((s) => s.drag);
  const predicted = useGame((s) => s.predicted);
  const setViewScale = useGame((s) => s.setViewScale);
  const attachPending = useGame((s) => s.attachPending);
  const cancelAttach = useGame((s) => s.cancelAttach);

  // Compteur de rendus du plan de table. Il ne change aucun comportement : il
  // existe pour que la recette puisse mesurer qu'un glissement ne re-rend pas
  // la table, au lieu de juger « à l'œil ».
  if (typeof window !== 'undefined') {
    window.__mtgTableRenders = (window.__mtgTableRenders ?? 0) + 1;
  }

  const surface = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 0.8, x: 0, y: 0 });
  const [highlight, setHighlightState] = useState<string[]>([]);
  /**
   * Le tracé du lasso ne passe pas par React. Le mettre dans un état re-rendait
   * tout le plan à chaque mouvement du pointeur — exactement le piège corrigé
   * pour le glisser-déposer. On écrit donc directement dans le polygone, et l'on
   * marque les cartes capturées en basculant une classe sur leur nœud.
   */
  const lassoShape = useRef<SVGPolygonElement>(null);
  /** Un clic droit qui a déplacé la caméra n'ouvre pas le menu du fond. */
  const suppressMenu = useRef(false);
  const lassoSvg = useRef<SVGSVGElement>(null);
  const lastCursorAt = useRef(0);

  /**
   * Echap annule une attente d'accrochage. Le gestionnaire global des
   * raccourcis vide aussi la sélection sur Echap ; les deux effets cohabitent
   * sans se gêner, et c'est bien la même touche qui « annule ce qui est en
   * cours ».
   */
  useEffect(() => {
    if (!attachPending) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelAttach();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attachPending, cancelAttach]);

  // La couche de glisser-déposer a besoin de l'échelle pour situer un dépôt.
  useEffect(() => {
    setViewScale(view.scale);
  }, [view.scale, setViewScale]);

  /**
   * Disposition : fonction pure de `seatIndex`, donc identique sur tous les
   * clients. C'est l'invariant du repère commun — les coordonnées de `CURSOR`
   * sont des coordonnées de monde (§6.7), et un monde qui tournerait avec le
   * siège local afficherait le curseur d'autrui sur le panneau d'un tiers. Le
   * confort du « je suis en bas » se rend par le cadrage, pas par la géométrie.
   */
  const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex).map((s) => s.id);
  /** Les cases du repere **partage**, celles dont parlent les coordonnees echangees. */
  const positions = layout(ordered.length);
  /** Les memes cases, reattribuees pour que notre siege tombe en bas de l'ecran. */
  const viewPositions = rotateToBottom(positions, ordered.indexOf(mySeat ?? ''));
  const span = tableSpan(positions);
  const highlighted = new Set(highlight);

  /**
   * Borne la caméra : on ne dézoome jamais au-delà de la table, et on ne dérive
   * jamais dans le vide.
   *
   * Sans cela, deux gestes sans retour possible : dézoomer jusqu'à ce que la
   * table devienne un timbre-poste, et faire glisser le fond si loin qu'on perd
   * la table de vue sans savoir dans quelle direction revenir. Le décor ne peut
   * rien y faire — aucune étendue finie ne couvre un pan illimité —, c'est donc
   * ici que ça se règle.
   *
   * On tolère une marge autour de la table : la coller aux bords du cadre serait
   * étouffant, et on a parfois besoin de place pour poser une carte en bordure.
   */
  function clampView(
    next: { scale: number; x: number; y: number },
    // Un déplacement ne doit jamais modifier le zoom : si l'échelle courante est
    // hors bornes (fenêtre redimensionnée, sièges arrivés), la corriger *pendant*
    // un pan ferait sauter la vue sous la main du joueur. On ne la reprend qu'au
    // moment où il touche réellement au zoom.
    options: { keepScale?: boolean } = {},
  ): { scale: number; x: number; y: number } {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return next;
    const free = freeArea(rect);

    // Plancher de zoom : on autorise à descendre jusqu'à ce que la table
    // n'occupe plus qu'environ la moitié du cadre. C'est assez pour prendre du
    // recul et poser des cartes loin du centre, et ça garde la table repérable
    // — la borne existe pour empêcher qu'elle devienne un timbre-poste, pas
    // pour interdire toute vue d'ensemble.
    const fit = Math.min(free.width / (span.width * 2.2), free.height / (span.height * 2.2));
    const minScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE_FLOOR, fit));
    const scale = options.keepScale
      ? next.scale
      : Math.min(MAX_SCALE, Math.max(minScale, next.scale));

    // Marge de débattement, en pixels écran.
    const margin = Math.min(free.width, free.height) * 0.35;
    const clampAxis = (value: number, start: number, size: number, extent: number): number => {
      const min = start + margin - extent * scale;
      const max = start + size - margin;
      // Table plus petite que le cadre : les bornes se croisent, on centre.
      return min > max ? start + (size - extent * scale) / 2 : Math.min(max, Math.max(min, value));
    };

    return {
      scale,
      x: clampAxis(next.x, free.left, free.width, span.width),
      y: clampAxis(next.y, free.top, free.height, span.height),
    };
  }

  /**
   * Origine de chaque panneau dans le monde partagé. Elle sert à situer une
   * carte hors de son panneau — pour une étiquette accrochée, qui vit dans le
   * plan de table et non dans le panneau.
   */
  const seatOrigin = new Map<string, { x: number; y: number }>();
  ordered.forEach((seatId, index) => {
    const pos = viewPositions[index] ?? { col: 0, row: 0 };
    seatOrigin.set(seatId, { x: pos.col * (PANEL_WIDTH + GAP), y: pos.row * (PANEL_HEIGHT + GAP) });
  });

  /** Position de monde d'un permanent, prédiction locale comprise. */
  function worldOf(cardId: string | undefined): { x: number; y: number } | null {
    if (!cardId) return null;
    const card = cards.get(cardId);
    if (!card || card.zone.kind !== 'BATTLEFIELD') return null;
    const origin = seatOrigin.get(card.zone.seat);
    if (!origin) return null;
    const guess = predicted.get(cardId);
    // Le champ de bataille commence après la colonne de commandement : c'est
    // le repère dans lequel le serveur exprime les x/y des permanents.
    return { x: origin.x + COMMAND_COLUMN + (guess?.x ?? card.x), y: origin.y + (guess?.y ?? card.y) };
  }

  /**
   * Second temps d'un accrochage : la source a été désignée dans un menu, la
   * cible est celle que l'on vient de cliquer.
   *
   * Rien n'est deviné dans la sélection courante, et c'est tout le propos :
   * l'ancienne version cherchait la cible parmi les cartes sélectionnées et
   * n'envoyait rien — en silence — quand il n'y en avait pas, c'est-à-dire
   * presque toujours.
   */
  function completeAttach(card: CardView): void {
    const pending = attachPending;
    if (!pending) return;
    cancelAttach();

    if (pending.kind === 'CARD') {
      if (pending.sourceId === card.id) return;
      send({ type: 'ATTACH', sourceId: pending.sourceId, targetId: card.id });
      return;
    }

    const label = labels.find((l) => l.id === pending.labelId);
    const anchor = worldOf(card.id);
    if (!label || !anchor) return;
    // Les x/y d'une étiquette accrochée sont un décalage relatif à la carte :
    // on convertit sa position de monde actuelle pour qu'elle ne saute pas au
    // moment de l'accrochage.
    /*
     * Les deux repères, et la faute qui se cachait dans le `?? 0`.
     *
     * `anchor` et `previous` sortent de `worldOf`, qui compose l'origine d'un
     * panneau **affiché** : ils parlent le repère de vue. Les `x`/`y` d'une
     * étiquette **flottante**, eux, sortent du magasin et parlent le repère
     * **partagé**. Les soustraire l'un de l'autre sans traduction donnait un
     * décalage faux d'exactement une case — invisible à un seul siège, où la
     * réattribution est l'identité, et flagrant dès qu'un second joueur
     * s'asseyait : l'étiquette sautait au moment même de l'accrochage, alors
     * que tout le geste existe pour qu'elle ne bouge pas.
     */
    const previous = label.attachedTo ? worldOf(label.attachedTo) : null;
    const current = previous
      ? { x: previous.x + label.x, y: previous.y + label.y }
      : toView({ x: label.x, y: label.y }, positions, viewPositions);
    send({ type: 'SET_LABEL', labelId: label.id, attachedTo: card.id });
    send({
      type: 'MOVE_LABEL',
      labelId: label.id,
      x: Math.round(current.x - anchor.x),
      y: Math.round(current.y - anchor.y),
    });
  }

  /**
   * Les deux gestes du fond de table.
   *
   *  - **bouton gauche** : le lasso de sélection. C'est le geste que l'on fait
   *    le plus souvent, il prend donc le bouton principal ;
   *  - **bouton droit** (ou celui du milieu) : déplacement de la caméra. Un clic
   *    droit *sans déplacement* ouvre le menu du fond comme avant — c'est le
   *    mouvement qui distingue les deux, pas le bouton.
   *
   * Molette : zoom.
   */
  function onSurfacePointerDown(event: React.PointerEvent): void {
    // Un geste de table ne part jamais d'un contrôle : sans ce garde-fou, le pan
    // et le rectangle de sélection avalaient le clic des boutons flottants.
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const selecting = event.button === 0;
    // Le bouton droit prend la main sur tout le reste : une carte ne doit pas
    // avaler le geste de caméra sous prétexte qu'on a commencé sur elle.
    if (!selecting) event.stopPropagation();

    if (!selecting) {
      // On copie les coordonnées : l'événement React est réutilisé, le relire
      // dans un gestionnaire différé ne donne rien de fiable.
      const downX = event.clientX;
      const downY = event.clientY;
      // Le bouton aussi : l'événement React est recyclé, et `event.button` relu
      // dans le gestionnaire de relâchement valait 0 — le menu du fond
      // s'ouvrait donc à la fin de chaque déplacement de caméra.
      const button = event.button;
      const startX = downX - view.x;
      const startY = downY - view.y;
      const move = (e: PointerEvent): void =>
        setView((v) => clampView({ ...v, x: e.clientX - startX, y: e.clientY - startY }, { keepScale: true }));
      const up = (e: PointerEvent): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        /*
         * Un clic droit *net* reste un clic droit : il doit ouvrir le menu du
         * fond. Ce n'est qu'à partir du moment où l'on a réellement déplacé la
         * caméra que le menu devient parasite — on le supprime alors pour ce
         * geste-là seulement.
         */
        const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 4;
        if (button === 2 && moved) {
          /*
           * Le menu contextuel qui suit ce relâchement n'appartient pas
           * forcément au fond : si le geste est parti d'une carte, c'est le
           * menu de la carte qui s'ouvrirait. On l'intercepte donc à la racine,
           * une seule fois, plutôt qu'au cas par cas.
           */
          suppressMenu.current = true;
          const swallow = (menuEvent: Event): void => {
            menuEvent.preventDefault();
            menuEvent.stopPropagation();
            suppressMenu.current = false;
          };
          window.addEventListener('contextmenu', swallow, { capture: true, once: true });
          // Si aucun menu ne suit (certaines plateformes), on ne laisse pas le
          // piège armé pour le prochain clic droit.
          window.setTimeout(() => {
            window.removeEventListener('contextmenu', swallow, { capture: true });
            suppressMenu.current = false;
          }, 600);
        } else if (button === 0 && !moved) {
          setSelection(new Set());
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    /*
     * Lasso (glisser du bouton gauche sur le fond). Il attrape tout permanent
     * que le tracé traverse, et tout permanent qu'il enferme.
     *
     * Portée, et c'est un choix assumé : le lasso ne ramasse que les permanents
     * que **vous contrôlez**. Les panneaux des adversaires sont côte à côte, un
     * tracé un peu large emporterait leurs cartes sans qu'on l'ait voulu, et
     * engager par mégarde le terrain d'un voisin est une gêne réelle à une table
     * qui s'auto-arbitre. Pour les inclure délibérément, tenir **Alt**.
     */
    const additive = event.ctrlKey || event.metaKey;
    const everyone = event.altKey;
    const owner = everyone ? null : mySeat;
    const origin = { x: event.clientX, y: event.clientY };
    const base = additive ? new Set(selection) : new Set<string>();
    const path: Array<{ x: number; y: number }> = [origin];

    let marked = new Set<string>();
    let frame: number | null = null;

    const paint = (): void => {
      frame = null;
      lassoShape.current?.setAttribute('points', path.map((p) => `${p.x},${p.y}`).join(' '));
      if (lassoSvg.current) lassoSvg.current.style.display = 'block';
      // Aperçu en direct de la prise : même prédicat que la sélection finale,
      // appliqué en continu, et rendu par une classe CSS plutôt que par React.
      markLassoHits(new Set(cardsInLasso(path, owner)), marked);
      marked = new Set(cardsInLasso(path, owner));
    };
    paint();

    const move = (e: PointerEvent): void => {
      const last = path[path.length - 1]!;
      // On n'enregistre un point que s'il apporte quelque chose : un tracé de
      // plusieurs milliers de points ne sélectionne pas mieux.
      if (Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6) return;
      path.push({ x: e.clientX, y: e.clientY });
      if (frame === null) frame = window.requestAnimationFrame(paint);
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (lassoSvg.current) lassoSvg.current.style.display = 'none';
      markLassoHits(new Set(), marked);
      path.push({ x: e.clientX, y: e.clientY });

      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) <= 4 && path.length < 3) {
        if (!additive) setSelection(new Set());
        return;
      }
      // Une seule écriture dans le store, à la fin du geste.
      setSelection(new Set([...base, ...cardsInLasso(path, owner)]));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /**
   * Clic droit sur le fond. Les cartes et les piles arrêtent la propagation
   * avant d'arriver ici : ce gestionnaire n'est atteint que lorsque rien de plus
   * précis n'a pris le clic.
   */
  function onSurfaceContextMenu(event: React.MouseEvent): void {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    event.preventDefault();
    // Le déplacement de caméra qui vient de finir ne doit pas se terminer sur
    // un menu ouvert sous le curseur.
    if (suppressMenu.current) {
      suppressMenu.current = false;
      return;
    }

    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    // Une étiquette flottante vit en coordonnées de monde partagé : on traduit
    // le point visé avant de le donner au menu.
    const pointed = toShared(
      {
        x: (event.clientX - rect.left - view.x) / view.scale,
        y: (event.clientY - rect.top - view.y) / view.scale,
      },
      positions,
      viewPositions,
    );
    const worldX = Math.round(pointed.x);
    const worldY = Math.round(pointed.y);

    // Le point est-il tombé sur mon propre champ de bataille ? Si oui, on en
    // garde les coordonnées locales, celles qu'attend `CREATE_TOKEN`.
    const target = findDropTarget(event.clientX, event.clientY, view.scale);
    const local =
      target && target.zone.kind === 'BATTLEFIELD' && target.zone.seat === mySeat
        ? { x: target.x, y: target.y }
        : null;

    openMenu({ kind: 'TABLE', x: event.clientX, y: event.clientY, worldX, worldY, local });
  }

  /**
   * Zoom **ancré** : le point du plan situé sous `clientX/clientY` y reste.
   *
   * Le plan est peint avec `translate(view.x, view.y) scale(view.scale)` et une
   * origine de transformation fixe (`origin-top-left`). Ne toucher qu'à
   * `scale`, ce que faisait la molette, éloigne ou rapproche donc tout de
   * **l'origine du plan** : le zoom ne visait jamais le curseur, et selon
   * l'endroit où la caméra se trouvait cela donnait l'impression de viser le
   * centre du terrain. Il faut compenser `x`/`y`.
   *
   * On reprend la conversion écran → monde déjà employée par `onPointerMove` et
   * par le menu du fond : rectangle de la surface, moins `view.x/y`, divisé par
   * l'échelle. **Sans traduction de siège** : `toShared`/`toView` servent à
   * parler du monde partagé aux autres clients, alors que le zoom est une
   * affaire de caméra, entièrement locale et entièrement dans le repère
   * affiché. Traduire ici démultiplierait le déplacement dès qu'un second
   * joueur s'assied.
   *
   * Deux précautions :
   *
   *  - **l'échelle retenue décide de la compensation.** On demande d'abord à
   *    `clampView` quelle échelle il accepte, et c'est avec celle-là qu'on
   *    calcule le nouveau `x`/`y`. Un cran de molette au plafond (ou au
   *    plancher) ne change plus rien : on rend l'état **tel quel**, donc sans
   *    déplacement — et sans rendu, la même référence faisant renoncer React.
   *    Compenser pour une échelle que le bridage refuse ferait dériver la table
   *    sous un zoom qui ne bouge plus, et ça se voit tout de suite.
   *  - **le bridage de position garde le dernier mot.** `clampView` borne aussi
   *    `x`/`y` pour qu'on ne perde jamais la table de vue ; si la compensation
   *    sort de ces bornes, elle est rognée et le point visé glisse un peu sur
   *    l'axe bridé. C'est le bon arbitrage : mieux vaut un zoom légèrement
   *    décalé en bordure du débattement qu'une caméra partie dans le vide.
   */
  function zoomAt(factor: number, clientX: number, clientY: number): void {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    setView((v) => {
      // Premier passage : on ne garde que l'échelle, pour savoir ce que les
      // bornes acceptent réellement avant de calculer quoi que ce soit.
      const scale = clampView({ ...v, scale: v.scale * factor }).scale;
      if (scale === v.scale) return v;

      // Le point du plan actuellement sous le curseur, en pixels de monde.
      const worldX = (clientX - rect.left - v.x) / v.scale;
      const worldY = (clientY - rect.top - v.y) / v.scale;

      // On replace la caméra pour que ce même point retombe sous le curseur.
      return clampView({
        scale,
        x: clientX - rect.left - worldX * scale,
        y: clientY - rect.top - worldY * scale,
      });
    });
  }

  function onWheel(event: React.WheelEvent): void {
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    // Les coordonnées sont lues ici, pas dans la mise à jour différée :
    // l'événement React est recyclé, le relire plus tard ne donne rien de sûr.
    zoomAt(factor, event.clientX, event.clientY);
  }

  function onPointerMove(event: React.PointerEvent): void {
    const now = Date.now();
    if (now - lastCursorAt.current < CURSOR_INTERVAL_MS) return;
    lastCursorAt.current = now;

    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    /*
     * On pointe dans le repère **affiché**, où notre siège est en bas ; on le
     * dit dans le repère **partagé**, le seul que les autres sauront lire.
     * Sans cette traduction, le curseur d'autrui tomberait sur le panneau d'un
     * tiers — c'est le défaut que l'invariant du repère commun avait corrigé,
     * et qu'une disposition par client réintroduit si l'on n'y prend garde.
     */
    const pointed = toShared(
      {
        x: (event.clientX - rect.left - view.x) / view.scale,
        y: (event.clientY - rect.top - view.y) / view.scale,
      },
      positions,
      viewPositions,
    );
    send({
      type: 'CURSOR',
      x: Math.round(pointed.x),
      y: Math.round(pointed.y),
      ...(drag ? { holding: drag.cardId } : {}),
    });
  }

  /**
   * Recentre le plan dans l'espace réellement libre : les panneaux flottants
   * (journal à gauche, panneau joueur à droite, barre du haut, main en bas) sont
   * en position fixe, et une table qui passerait dessous serait inatteignable au
   * clic. On n'agrandit jamais au-delà de 1 : une carte n'a pas à dépasser sa
   * taille de référence.
   */
  function recenter(): void {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return setView({ scale: 0.8, x: 0, y: 0 });

    const free = freeArea(rect);
    /*
     * On cadre la grille **et son décor** : muret, massifs et braseros font
     * partie de la table, et « voir toute la table » qui s'arrête au bord des
     * panneaux n'en montre justement rien.
     */
    const margin = sceneryMargin(span.width, span.height);
    const shownW = span.width + margin * 2;
    const shownH = span.height + margin * 2;
    // Plancher bas : à quatre sièges, la vue d'ensemble est une carte du
    // terrain, pas une vue de lecture. Mieux vaut tout montrer en petit que
    // rogner.
    const scale = Math.min(1, Math.max(0.12, Math.min(free.width / shownW, free.height / shownH)));

    setView({
      scale,
      x: free.left + (free.width - span.width * scale) / 2,
      y: free.top + (free.height - span.height * scale) / 2,
    });
  }

  /**
   * Cadrage sur le siège local : son panneau est amené en bas du cadre, centré.
   * Le monde n'a pas bougé — seule la caméra de ce client a changé.
   */
  function focusOnMe(): void {
    const rect = surface.current?.getBoundingClientRect();
    const index = ordered.indexOf(mySeat ?? '');
    const pos = index >= 0 ? viewPositions[index] : undefined;
    if (!rect || !pos) return recenter();

    const free = freeArea(rect);
    const scale = Math.min(1, Math.max(0.35, Math.min(free.width / (PANEL_WIDTH * 1.15), free.height / (PANEL_HEIGHT * 1.6))));
    const panelX = pos.col * (PANEL_WIDTH + GAP);
    const panelY = pos.row * (PANEL_HEIGHT + GAP);

    setView({
      scale,
      x: free.left + free.width / 2 - (panelX + PANEL_WIDTH / 2) * scale,
      y: free.top + free.height - (panelY + PANEL_HEIGHT) * scale,
    });
  }

  /**
   * Cadrage initial, posé une seule fois — et seulement quand tout ce qu'il
   * faut pour le calculer est là : le siège local, sa place dans la
   * disposition, et un conteneur qui a une taille. Au premier rendu, aucune de
   * ces trois choses n'est acquise, et calculer trop tôt donnait un cadrage à
   * l'origine du monde, c'est-à-dire la zone du joueur en haut à gauche.
   *
   * Une fois posé, il ne l'est plus jamais : un pan du joueur n'est pas écrasé.
   */
  const framedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!mySeat || framedFor.current === mySeat) return;
    if (ordered.indexOf(mySeat) < 0) return;

    let cancelled = false;
    const tryFrame = (): void => {
      if (cancelled) return;
      const rect = surface.current?.getBoundingClientRect();
      if (!rect || rect.width < 50 || rect.height < 50) {
        window.requestAnimationFrame(tryFrame);
        return;
      }
      framedFor.current = mySeat;
      focusOnMe();
    };
    tryFrame();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySeat, ordered.length]);

  /**
   * Suivre son propre siège quand la disposition change sous la caméra.
   *
   * Le cadrage d'ouverture est juste — il pose le bas du panneau local
   * exactement au bord du bandeau réservé à la main. Mais il est posé **une
   * fois**, alors que la disposition, elle, est une fonction pure du nombre de
   * sièges : à l'arrivée d'un second joueur, `layout` passe d'une rangée à
   * deux, et notre case descend d'une rangée entière. Le monde glisse sous une
   * caméra qui, elle, ne bouge pas.
   *
   * Mesuré à 1600 × 1000 : le panneau local tombait de 460 px, si bien que tout
   * son champ de bataille passait sous le rail de main (448 px pris par le
   * rail, 206 px carrément hors de l'écran). Une carte posée là n'était
   * cliquable par personne — ni engagée, ni ouverte au menu, ni déplacée — tant
   * que le joueur n'avait pas compris qu'il devait recadrer lui-même. Le rail
   * n'y était pour rien : il avait seulement le tort d'être à l'endroit où la
   * table avait été posée.
   *
   * On **compense** le déplacement au lieu de recadrer : la caméra se translate
   * de l'opposé exact, notre siège reste au même pixel d'écran. C'est ce qui
   * permet de corriger sans écraser le pan du joueur — un recadrage d'office
   * ferait sauter la vue de quelqu'un qui s'était placé où il voulait, alors
   * qu'ici le point de vue est conservé, y compris quand un siège **part** et
   * que la disposition se resserre.
   */
  const myIndex = ordered.indexOf(mySeat ?? '');
  const myPos = myIndex >= 0 ? viewPositions[myIndex] : undefined;
  const myOriginX = myPos ? myPos.col * (PANEL_WIDTH + GAP) : null;
  const myOriginY = myPos ? myPos.row * (PANEL_HEIGHT + GAP) : null;
  const lastOrigin = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (myOriginX === null || myOriginY === null) return;
    const before = lastOrigin.current;
    lastOrigin.current = { x: myOriginX, y: myOriginY };
    // Première mesure : c'est le cadrage d'ouverture qui fait foi, pas nous.
    if (!before) return;
    const dx = myOriginX - before.x;
    const dy = myOriginY - before.y;
    if (dx === 0 && dy === 0) return;
    setView((v) => clampView({ ...v, x: v.x - dx * v.scale, y: v.y - dy * v.scale }, { keepScale: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOriginX, myOriginY]);

  return (
    <div
      ref={surface}
      className={SURFACE_CLASS}
      onContextMenu={onSurfaceContextMenu}
      // Le bouton droit est traité en **capture** : il déplace la caméra même
      // quand le geste part d'une carte, qui interrompt sinon la propagation
      // avant d'arriver à la surface. Les autres boutons suivent le chemin
      // normal, pour ne pas voler leurs gestes aux cartes.
      onPointerDown={(event) => {
        if (event.button !== 2) onSurfacePointerDown(event);
      }}
      onPointerDownCapture={(event) => {
        if (event.button === 2) onSurfacePointerDown(event);
      }}
      onPointerMove={onPointerMove}
      onWheel={onWheel}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <TableBackground width={span.width} height={span.height} />
        {ordered.map((seatId, index) => {
          const seat = seats.find((s) => s.id === seatId);
          if (!seat) return null;
          const pos = viewPositions[index] ?? { col: 0, row: 0 };
          const mine = [...cards.values()].filter((c) => c.zone.seat === seat.id);
          // On ne retire la carte du panneau qu'une fois le glissement engagé.
          // La retirer dès l'appui détruisait son nœud DOM entre les deux clics
          // d'un double-clic : le navigateur n'émettait alors jamais `dblclick`,
          // et « double-cliquer pour engager » ne marchait pas du tout.
          const draggedAway = drag?.moved ? drag.cardId : null;
          /*
           * La carte tenue reste dans la liste, et c'est `SeatPanel` qui
           * s'abstient d'en peindre le sprite.
           *
           * La retirer d'ici la retirait aussi du calcul des attachements : une
           * aura dont le porteur était en cours de glissement ne retrouvait plus
           * sa cible, retombait sur ses **propres** coordonnées — celles,
           * périmées, qu'elle avait avant d'être attachée — et sautait à travers
           * le terrain le temps du geste, pour se remettre en place au
           * relâchement. C'est exactement le symptôme rapporté. L'ancre doit
           * donc survivre au geste : le porteur n'est invisible, il n'est pas
           * absent.
           */
          const battlefield = mine
            .filter((c) => c.zone.kind === 'BATTLEFIELD')
            // Une position prédite prend le pas, le temps que l'event arrive.
            // Elle ne touche que x/y : rien d'autre n'est deviné localement.
            .map((c) => {
              const guess = predicted.get(c.id);
              return guess ? ({ ...c, x: guess.x, y: guess.y } as CardView) : c;
            });
          const graveyard = mine
            .filter((c) => c.zone.kind === 'GRAVEYARD')
            .sort((a, b) => a.sortIndex - b.sortIndex);
          const command = mine
            .filter((c) => c.zone.kind === 'COMMAND' && c.id !== draggedAway)
            .sort((a, b) => a.sortIndex - b.sortIndex);

          return (
            <div
              key={seat.id}
              className="absolute"
              style={{ left: pos.col * (PANEL_WIDTH + GAP), top: pos.row * (PANEL_HEIGHT + GAP) }}
            >
              {/*
                La main d'un adversaire se tient **devant lui**, au-dessus de
                son terrain — pas dessus. Elle est rendue ici et non dans le
                panneau, qui rogne ce qui en sort.
              */}
              {seat.id !== mySeat && (
                <OpponentHand seat={seat} />
              )}
              <SeatPanel
                seat={seat}
                isMe={seat.id === mySeat}
                isActive={seat.id === activeSeat}
                battlefield={battlefield}
                draggedAwayId={draggedAway}
                command={command}
                counts={{
                  library: counts.get(zoneKey({ seat: seat.id, kind: 'LIBRARY' })) ?? 0,
                  graveyard: counts.get(zoneKey({ seat: seat.id, kind: 'GRAVEYARD' })) ?? 0,
                  exile: counts.get(zoneKey({ seat: seat.id, kind: 'EXILE' })) ?? 0,
                  command: counts.get(zoneKey({ seat: seat.id, kind: 'COMMAND' })) ?? command.length,
                  hand: counts.get(zoneKey({ seat: seat.id, kind: 'HAND' })) ?? seat.handCount,
                }}
                topGraveyard={graveyard[graveyard.length - 1]}
                selection={selection}
                highlight={highlighted}
                attachPendingId={attachPending?.kind === 'CARD' ? attachPending.sourceId : null}
                turnNumber={turnNumber}
                onCardPointerDown={(card, event) => {
                  // Un accrochage en attente capte le clic gauche : c'est lui
                  // qui désigne la cible, et rien d'autre ne doit partir.
                  if (attachPending && event.button === 0) {
                    event.stopPropagation();
                    completeAttach(card);
                    return;
                  }
                  if (event.ctrlKey || event.metaKey) {
                    event.stopPropagation();
                    toggleSelected(card.id, true);
                    return;
                  }
                  startCardDrag(card, event);
                }}
                onCardDoubleClick={(card) => {
                  // Sur une carte de la sélection, le double-clic bascule tout
                  // le groupe, en un seul intent ; sur une carte hors sélection,
                  // elle seule.
                  send(tapIntent(groupOf(card.id)));
                }}
                onCardContextMenu={(card, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openMenu({ kind: 'CARD', card, x: event.clientX, y: event.clientY });
                }}
                onZoneContextMenu={(kind, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openMenu({ kind: 'ZONE', zone: { seat: seat.id, kind }, x: event.clientX, y: event.clientY });
                }}
                onZoneClick={(kind) => {
                  // Toutes les piles ouvrent le panneau latéral. La bibliothèque
                  // n'y montre rien : elle y explique qu'une consultation est
                  // publique et propose de la lancer.
                  window.dispatchEvent(
                    new CustomEvent('mtg:browse-zone', { detail: { seat: seat.id, kind } }),
                  );
                }}
              />
            </div>
          );
        })}

        {labels.map((label) => {
          const anchor = label.attachedTo ? worldOf(label.attachedTo) : null;
          // Accrochée à une carte que l'on ne voit pas — partie au cimetière,
          // ou sur un terrain hors de vue —, l'étiquette n'a pas de place :
          // la rendre à ses seuls décalages la poserait au coin du monde.
          if (label.attachedTo && !anchor) return null;
          /*
            Une étiquette accrochée suit sa carte : son ancre est déjà dans le
            repère affiché. Une étiquette **flottante**, elle, porte des
            coordonnées de monde partagé — il faut les traduire, exactement
            comme un curseur.
          */
          const placed =
            label.attachedTo !== undefined
              ? label
              : { ...label, ...toView({ x: label.x, y: label.y }, positions, viewPositions) };
          return (
            <TableLabel
              key={label.id}
              anchor={anchor}
              label={placed}
              scale={view.scale}
              toShared={(point) => toShared(point, positions, viewPositions)}
            />
          );
        })}

        <CursorLayer shared={positions} view={viewPositions} />
      </div>

      {/* Toujours monté, masqué au repos : on écrit dedans sans re-rendre. */}
      <svg
        ref={lassoSvg}
        className="pointer-events-none absolute inset-0 h-full w-full"
        data-test="lasso"
        style={{ display: 'none' }}
      >
        <polygon
          ref={lassoShape}
          fill="rgb(56 189 248 / 12%)"
          points=""
          stroke="rgb(56 189 248 / 85%)"
          strokeDasharray="5 4"
          strokeWidth="1.5"
        />
      </svg>

      {/* Bulles de chat éphémères, ancrées sur le panneau de leur auteur. */}
      <div className="pointer-events-none absolute inset-x-0 top-20 flex flex-col items-center gap-1">
        {chat.map((bubble) => {
          const seat = seats.find((s) => s.id === bubble.seat);
          return (
            <span
              key={bubble.id}
              className="rounded-full bg-slate-900/90 px-3 py-1 text-sm ring-1 ring-white/10"
              style={{ color: seat?.color ?? '#e2e8f0' }}
            >
              {/* Le nom ne se coupe pas sur son espace ; le message, lui, peut couler. */}
              <strong className="mr-1 whitespace-nowrap">{seat?.displayName}</strong>
              <span className="text-slate-200">{bubble.text}</span>
            </span>
          );
        })}
      </div>

      {/*
        `fixed` et non `absolute` : ces contrôles doivent gagner sur le rail de
        main, qui est un frère de la table dans la page. Un z-index posé à
        l'intérieur de la table ne pèserait pas contre lui.
      */}
      <div className="fixed bottom-3 left-3 z-30 flex gap-2">
        <button
          className="rounded border border-edge bg-panel/80 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
          data-test="recenter"
          onClick={recenter}
          onPointerDown={(event) => event.stopPropagation()}
        >
          Voir toute la table
        </button>
        <button
          className="rounded border border-edge bg-panel/80 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
          data-test="recenter-me"
          onClick={focusOnMe}
          onPointerDown={(event) => event.stopPropagation()}
        >
          Recentrer sur moi
        </button>
      </div>

      {/*
        Indicateur d'attente d'accrochage. Il est en `fixed` : il doit rester
        lisible quel que soit le cadrage, et survivre à un zoom en plein geste.
      */}
      {attachPending && (
        <div
          className="pointer-events-auto fixed left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-sky-500/60 bg-slate-950/95 px-4 py-2 text-sm text-sky-100 shadow-xl"
          data-test="attach-pending"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          <span>
            {attachPending.kind === 'CARD'
              ? 'Cliquez la carte à laquelle attacher'
              : 'Cliquez la carte sur laquelle accrocher cette étiquette'}
          </span>
          <button
            className="rounded border border-edge px-2 py-0.5 text-xs text-slate-300 hover:text-white"
            data-test="attach-cancel"
            onClick={cancelAttach}
            onPointerDown={(event) => event.stopPropagation()}
          >
            Echap pour annuler
          </button>
        </div>
      )}

      <HighlightBridge onChange={setHighlightState} />
    </div>
  );
});

/** Classe portée par un permanent que le tracé tient en ce moment même. */
const LASSO_HIT_CLASS = 'lasso-hit';

/**
 * Marque les cartes capturées et démarque les autres, en ne touchant qu'aux
 * nœuds dont l'état change. Aucun rendu React : c'est un aperçu, il doit coûter
 * le prix d'un changement de classe.
 */
function markLassoHits(hits: Set<string>, previous: Set<string>): void {
  for (const id of previous) {
    if (hits.has(id)) continue;
    document.querySelector(`[data-card="${id}"]`)?.classList.remove(LASSO_HIT_CLASS);
  }
  for (const id of hits) {
    if (previous.has(id)) continue;
    document.querySelector(`[data-card="${id}"]`)?.classList.add(LASSO_HIT_CLASS);
  }
}

type Point = { x: number; y: number };

/**
 * Permanents attrapés par un lasso.
 *
 * On lit la position réelle des sprites dans le DOM : aucune conversion de
 * repère à tenir à jour quand le plan est déplacé ou zoomé. Une carte est prise
 * si le tracé la traverse, ou s'il l'enferme.
 *
 * `owner` limite la prise à un siège ; `null` ne limite rien.
 */
function cardsInLasso(path: Point[], owner: string | null): string[] {
  if (path.length < 2) return [];
  const bounds = {
    left: Math.min(...path.map((p) => p.x)),
    right: Math.max(...path.map((p) => p.x)),
    top: Math.min(...path.map((p) => p.y)),
    bottom: Math.max(...path.map((p) => p.y)),
  };

  /*
   * **Le lasso ne prend que des permanents.**
   *
   * Le tracé balaie tout le DOM, et `[data-card]` ne distingue rien : il
   * correspond aussi bien à l'aperçu posé sur une pile — cimetière, exil, zone
   * de commandement — qu'aux cartes du rail de main. Passer le tracé au-dessus
   * d'une pile embarquait donc la carte du dessus, qui n'est pas en jeu.
   *
   * Le filtre porte sur le **modèle** et non sur le DOM : c'est la zone que le
   * serveur a publiée qui décide, et aucune réorganisation de l'affichage ne
   * peut la contredire.
   */
  const cards = useGame.getState().cards;
  const eligible = new Set(
    [...cards.values()]
      .filter((c) => c.zone.kind === 'BATTLEFIELD' && (!owner || c.controller === owner))
      .map((c) => c.id),
  );

  const hits: string[] = [];
  // L'attribut porté par les sprites est `data-card` : un sélecteur qui ne
  // correspond à rien ne lève aucune erreur, il rend juste le lasso inerte.
  for (const holder of document.querySelectorAll<HTMLElement>('[data-card]')) {
    const id = holder.dataset['card'];
    if (!id || !eligible.has(id)) continue;

    const rect = holder.getBoundingClientRect();
    // Rejet rapide : hors de la boîte du tracé, inutile d'aller plus loin.
    if (rect.right < bounds.left || rect.left > bounds.right) continue;
    if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;

    if (pathCrossesRect(path, rect) || pointInPath(path, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })) {
      hits.push(id);
    }
  }
  return hits;
}

/** Le tracé passe-t-il à travers ce rectangle ? */
function pathCrossesRect(path: Point[], rect: DOMRect): boolean {
  const corners: Point[] = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    for (let c = 0; c < 4; c++) {
      if (segmentsIntersect(a, b, corners[c]!, corners[(c + 1) % 4]!)) return true;
    }
  }
  return false;
}

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  return o1 !== o2 && o3 !== o4;
}

/** Point dans le polygone fermé du tracé, par lancer de rayon. */
function pointInPath(path: Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i]!;
    const b = path[j]!;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Encombrement du plan, pour le cadrage automatique. */
function tableSpan(positions: Array<{ col: number; row: number }>): { width: number; height: number } {
  const cols = Math.max(1, ...positions.map((p) => p.col + 1));
  const rows = Math.max(1, ...positions.map((p) => p.row + 1));
  return { width: cols * (PANEL_WIDTH + GAP) - GAP, height: rows * (PANEL_HEIGHT + GAP) - GAP };
}

/** Passerelle de mise en évidence depuis le journal, sans prop-drilling. */
let highlightSetter: ((ids: string[]) => void) | null = null;
export function highlightCards(ids: string[]): void {
  highlightSetter?.(ids);
}
function HighlightBridge({ onChange }: { onChange: (ids: string[]) => void }): null {
  useEffect(() => {
    highlightSetter = onChange;
    return () => {
      highlightSetter = null;
    };
  }, [onChange]);
  return null;
}

/**
 * Curseurs des autres joueurs, dans le repère du monde partagé.
 *
 * Ils ont leur propre composant parce qu'ils changent vingt fois par seconde :
 * s'ils étaient lus dans le plan de table, chaque frame de curseur re-rendrait
 * tous les panneaux de siège et tous leurs sprites.
 */
/**
 * Position d'un curseur recu, en pixels du plan.
 *
 * `toView` rend un point `{x, y}` ; un `div` se place par `left`/`top`. Diffuser
 * le point tel quel dans le style écrivait donc des propriétés `x` et `y` que
 * le navigateur ignore, et tous les curseurs se posaient à l'origine du plan —
 * sur le coin du panneau du premier siège. La recette l'a vu.
 */
function placeCursor(point: Point, shared: Cell[], view: Cell[]): { left: number; top: number } {
  const placed = toView({ x: point.x, y: point.y }, shared, view);
  return { left: placed.x, top: placed.y };
}

function CursorLayer({ shared, view }: { shared: Cell[]; view: Cell[] }): React.ReactElement {
  const cursors = useGame((s) => s.cursors);
  const seats = useGame((s) => s.seats);
  /**
   * Le zoom courant, pour contre-echeller le curseur.
   *
   * Il vit dans le plan mis a l'echelle, donc il grossissait et retrecissait
   * avec lui : une fleche demesuree de pres, un point de loin. Un curseur est un
   * element d'interface, pas un objet de la table — il garde sa taille a
   * l'ecran. Plancher a 0,15 pour qu'une echelle proche de zero ne le fasse pas
   * exploser.
   */
  const zoom = useGame((s) => Math.max(0.15, s.viewScale));

  return (
    <>
      {cursors.map((cursor) => {
        const seat = seats.find((s) => s.id === cursor.seat);
        return (
          <div
            key={cursor.seat}
            /*
             * `whitespace-nowrap` : la pastille du nom est un élément en flux
             * dans une boîte absolument positionnée, donc de largeur
             * « shrink-to-fit » — plafonnée par ce qui reste jusqu'au bord du
             * plan. Un nom qui contient un espace (« Jean Dupont ») y revenait
             * à la ligne, et la pastille se cassait en deux, d'autant plus tôt
             * que le curseur approchait du bord. Les espaces sont pourtant
             * légitimes : le serveur les accepte. On interdit donc le retour à
             * la ligne plutôt que de toucher aux largeurs — la contre-échelle
             * du zoom, elle, tient aux styles en ligne ci-dessous, et une
             * classe à valeur fixe la casserait.
             */
            className="pointer-events-none absolute whitespace-nowrap"
            data-seat={cursor.seat}
            data-test="cursor"
            /*
             * Les curseurs passaient sous les cartes. Le piège n'est pas
             * l'ordre du DOM — la couche est bien la dernière — mais le fait
             * que les permanents portent un z-index : un élément positionné
             * sans z-index se peint sous tout élément qui en porte un positif,
             * quel que soit son rang dans le document. Les panneaux de siège
             * ne créant aucun contexte d'empilement (ni transform, ni opacité,
             * ni z-index), cartes et curseurs se disputent le même contexte,
             * celui du plan : un z-index franchement plus haut que celui des
             * cartes suffit donc, et il porte réellement.
             */
            /*
              Le curseur arrive en coordonnées de monde **partagé** : on le
              traduit vers la disposition affichée, où notre siège est en bas.
              Sans cela, il apparaîtrait sur le panneau d'un tiers.
            */
            style={{ ...placeCursor(cursor, shared, view), zIndex: 40 }}
          >
            <svg className="drop-shadow" height={18 / zoom} viewBox="0 0 12 18" width={12 / zoom}>
              <path d="M0 0 L0 14 L4 11 L6 17 L9 16 L7 10 L11 10 Z" fill={seat?.color ?? '#94a3b8'} />
            </svg>
            <span
              className="rounded font-medium text-white"
              style={{
                background: seat?.color ?? '#475569',
                // Contre-echelle : un curseur garde la meme taille a l'ecran,
                // quel que soit le zoom. Rendu dans le plan sans cela, il
                // devenait une fleche geante en approchant et un point
                // invisible en prenant du recul.
                marginLeft: 12 / zoom,
                fontSize: 11 / zoom,
                paddingLeft: 6 / zoom,
                paddingRight: 6 / zoom,
                paddingTop: 2 / zoom,
                paddingBottom: 2 / zoom,
                borderRadius: 4 / zoom,
              }}
            >
              {seat?.displayName ?? '?'}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** Espace écran laissé libre par les panneaux flottants. */
function freeArea(rect: DOMRect): { left: number; top: number; width: number; height: number } {
  return {
    left: SIDE_LOG_WIDTH,
    top: TOP_BAR_HEIGHT,
    width: Math.max(200, rect.width - SIDE_LOG_WIDTH - SIDE_PANEL_WIDTH),
    height: Math.max(200, rect.height - TOP_BAR_HEIGHT - handHeight()),
  };
}

/**
 * Disposition des panneaux, de 1 à 4 sièges.
 *
 * `positions[i]` est la place du i-ième siège dans l'ordre des `seatIndex`, et
 * rien d'autre : aucune notion de « mon siège » n'entre ici, sans quoi deux
 * clients n'auraient pas le même monde. Les colonnes sont fractionnaires pour
 * centrer une rangée incomplète ; un pas de colonne vaut une largeur de panneau
 * plus l'écart, donc deux panneaux ne se chevauchent jamais.
 */
function layout(count: number): Array<{ col: number; row: number }> {
  if (count <= 0) return [];
  // La table est plafonnée à quatre joueurs (`LIMITS.maxSeats`). Deux joueurs
  // se font face, en colonne ; trois et quatre forment un carré, deux colonnes
  // sur deux rangées, chacun face à un voisin — c'est la disposition d'une
  // vraie table, et elle se cadre bien plus serré que l'ancienne grille à huit.
  // À trois, la rangée incomplète est centrée par la colonne fractionnaire.
  const cols = count <= 2 ? 1 : 2;
  const rows = Math.ceil(count / cols);

  const positions: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < rows; row++) {
    const size = Math.min(cols, count - row * cols);
    const start = (cols - size) / 2;
    for (let i = 0; i < size; i++) positions.push({ col: start + i, row });
  }
  return positions;
}

declare global {
  interface Window {
    /** Nombre de rendus du plan de table, lu par la recette de vérification. */
    __mtgTableRenders?: number;
  }
}

export type { ZoneRef };
