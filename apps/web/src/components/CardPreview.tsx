/**
 * Aperçu agrandi de la carte survolée.
 *
 * Trois règles, et elles ne sont pas décoratives :
 *
 * - **Il ne capte jamais le pointeur** (`pointer-events: none`). Un aperçu
 *   cliquable se placerait sous le curseur, tuerait le `pointerleave` de la
 *   carte, et se figerait — il casserait le survol dont il dépend.
 * - **Il se place en bas à gauche**, et il n'en bouge que dans un seul cas :
 *   quand la carte survolée se trouverait dessous. Montrer une carte en grand
 *   tout en cachant l'originale est absurde ; changer de coin pour toute autre
 *   raison l'est presque autant, car l'œil doit alors le chercher à chaque
 *   fois. `previewPlacement.ts` porte la règle et son unique exception.
 * - **Rien n'est affiché pour une carte dont l'identité nous est cachée.**
 *   Deviner ce qu'il y a sous un dos serait une fuite ; il n'y a d'ailleurs rien
 *   à deviner, le client ne l'a pas reçu.
 *
 * Il a **deux sources**, dans cet ordre de priorité :
 *
 * 1. `hoveredCardId` — un objet de partie. C'est le cas riche : la carte porte
 *    son état, et l'aperçu montre la face retournée s'il y a lieu.
 * 2. `hoveredPreview` — une simple impression Scryfall. C'est ce qu'on survole
 *    là où il n'y a pas d'objet de partie : les résultats de la recherche de
 *    jeton, l'étagère, ou une carte montrée dans la main d'un adversaire (pour
 *    celle-là, l'objet existe, mais on ne veut surtout pas le désigner comme
 *    « carte survolée » : les raccourcis contextuels agiraient sur la carte
 *    d'un autre joueur).
 *
 * L'image vient directement du CDN Scryfall, comme partout ailleurs.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGame } from '../store/game.js';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardMeta,
  isDoubleFaced,
  scryfallImage,
  subscribeCards,
} from '../lib/cards.js';
import {
  localizedCard,
  localizedCardName,
  subscribeLocalizations,
} from '../lib/cardLocalization.js';
import { cardLanguageMark, resolveCardImage } from '../lib/i18n/index.js';
import { useForceLocalizedPrinting, useLanguage } from '../store/prefs.js';
import { CardLanguageBadge } from './CardSprite.js';
import { ManaCost } from './ManaCost.js';
import { lastPointer } from '../lib/hover.js';
import {
  DEFAULT_PREVIEW_CORNER,
  choosePreviewCorner,
  hoveredCardRects,
  previewRect,
  type PreviewCorner,
} from '../lib/previewPlacement.js';

const MARGIN = 16;

/**
 * Taille de l'aperçu, déduite de la fenêtre.
 *
 * Elle était figée à 440 px de haut. Deux conséquences, toutes deux visibles :
 * sur une fenêtre basse — un portable, 768 px — l'aperçu prenait plus de la
 * moitié de la hauteur et recouvrait le journal d'actions ; et à 440 px de
 * haut, il fait 317 px de large, **plus large que la colonne de gauche**
 * (304 px), donc il mordait sur la table.
 *
 * On le borne donc par les deux dimensions, et l'on garde le rapport de la
 * carte. Le plafond reste 440 : un aperçu plus grand que ça n'apprend rien de
 * plus, il ne fait qu'occuper l'écran.
 */
function previewSize(viewportWidth: number, viewportHeight: number): { width: number; height: number } {
  const ratio = CARD_WIDTH / CARD_HEIGHT;
  // Agrandissement pour une lisibilité optimale tout en respectant la colonne gauche
  const maxWidth = Math.min(350, Math.max(260, viewportWidth * 0.24));
  const maxHeight = Math.min(500, Math.max(360, viewportHeight * 0.50));
  const height = Math.max(240, Math.min(maxHeight, maxWidth / ratio));
  return { height: Math.round(height), width: Math.round(height * ratio) };
}

export function CardPreview(): React.ReactElement | null {
  const hoveredId = useGame((s) => s.hoveredCardId);
  // Le sélecteur rend la valeur du store telle quelle : construire ici un objet
  // neuf le rendrait inégal à lui-même d'un rendu à l'autre.
  const preview = useGame((s) => s.hoveredPreview);
  const cards = useGame((s) => s.cards);
  const dragging = useGame((s) => s.drag !== null);
  // Sélecteur scalaire : la langue est une chaîne, comparable par `Object.is`.
  const language = useLanguage();
  // Booléen : sélecteur scalaire, comme la langue.
  const forceLocalizedPrinting = useForceLocalizedPrinting();
  const [, setTick] = useState(0);
  const [corner, setCorner] = useState(DEFAULT_PREVIEW_CORNER);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1600 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));

  useEffect(() => {
    const onResize = (): void =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Les métadonnées arrivent par lots : il faut re-rendre quand le nom tombe.
  useEffect(() => subscribeCards(() => setTick((t) => t + 1)), []);
  // Les résolutions localisées aussi : l'aperçu passe alors de l'anglais au
  // français sans disparaître entre les deux.
  useEffect(() => subscribeLocalizations(() => setTick((t) => t + 1)), []);

  const card = hoveredId ? cards.get(hoveredId) : undefined;

  /*
   * Ce qu'on montre, et d'où ça vient.
   *
   * L'objet de partie l'emporte : il porte l'état. Survoler un objet dont
   * l'identité nous est cachée n'affiche rien — et ne se rabat pas sur
   * l'impression survolée ailleurs, qui n'a rien à voir avec lui.
   */
  const source = card ? 'card' : preview ? 'printing' : null;
  // Une carte dont l'identité nous est cachée ne livre rien : pas d'impression
  // de repli non plus, celle survolée ailleurs n'a rien à voir avec elle.
  const known = card && card.faceDown === false ? card : null;
  const scryfallId = card ? known?.scryfallId : preview?.scryfallId;
  // Pendant un glissement, l'aperçu s'efface : la carte traînée est déjà sous
  // les yeux, et un panneau de plus n'ajoute rien à un geste qui demande de la
  // place. C'est le seul cas où masquer vaut mieux que déplacer.
  const shown = !dragging && !!scryfallId && !!source;

  const size = previewSize(viewport.width, viewport.height);

  /*
   * Le coin se choisit après le rendu, sur le DOM réel : le rectangle de la
   * carte survolée n'est mesurable qu'une fois peinte. Un `useLayoutEffect`
   * corrige avant que le navigateur n'affiche la frame, donc sans clignotement.
   *
   * Le calcul repart du bas-gauche à chaque fois — il ne consulte pas le coin
   * courant. C'est ce qui garantit qu'aucun déplacement ne « colle » : dès que
   * la carte survolée change, l'aperçu rentre chez lui si rien ne l'en empêche.
   */
  /*
   * La hauteur réellement occupée, mesurée, et non celle de l'illustration.
   *
   * Sous l'image, le panneau porte un bandeau — nom de la carte, coût de mana —
   * qui n'entre dans aucun calcul si l'on se contente de `size.height`. Le
   * placement posait donc le sommet trop bas et le bandeau débordait d'une
   * vingtaine de pixels sous la fenêtre, à la table comme dans l'éditeur de
   * deck. On mesure plutôt que d'ajouter une constante : un nom long passe à la
   * ligne, et la hauteur n'est pas la même selon la carte survolée.
   *
   * Tant que rien n'est mesuré, on retombe sur la hauteur d'image : c'est
   * l'ancien comportement, et il vaut mieux qu'un saut au premier rendu.
   */
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const boxed = { width: size.width, height: panelHeight ?? size.height };

  const previewKey = preview?.scryfallId ?? null;
  useLayoutEffect(() => {
    const measured = panelRef.current?.getBoundingClientRect().height ?? null;
    if (measured !== null && measured > 0) {
      setPanelHeight((current) =>
        current !== null && Math.abs(current - measured) < 1 ? current : measured,
      );
    }
    const next = shown
      ? choosePreviewCorner({
          size: { width: size.width, height: measured ?? size.height },
          viewport,
          margin: MARGIN,
          hovered: hoveredCardRects(hoveredId, lastPointer()),
        })
      : DEFAULT_PREVIEW_CORNER;
    setCorner((current) => (current === next ? current : next));
  }, [shown, hoveredId, previewKey, size.width, size.height, viewport]);

  if (!shown || !scryfallId || !source) return null;

  const meta = cardMeta(scryfallId);
  // Faces numérotées à partir de 0, comme `resolveCardImage` les compte.
  const faceIndex = known?.flipped && isDoubleFaced(meta) ? 1 : 0;
  const localized = localizedCard(scryfallId, language);
  /*
   * L'image française est une **autre** image, publiée par Scryfall pour une
   * autre carte : elle ne se dérive pas de l'identifiant anglais. Tant que la
   * résolution n'est pas arrivée, l'aperçu montre l'anglais — c'est aussi ce
   * qu'il montrera définitivement pour les nombreuses cartes jamais traduites.
   */
  const resolved = resolveCardImage({
    card: meta ?? { scryfallId },
    localized,
    language,
    face: faceIndex,
    allowSubstitute: forceLocalizedPrinting,
  });
  const imageSrc =
    resolved.url ?? scryfallImage(scryfallId, 'large', faceIndex === 0 ? 'front' : 'back');
  const shownName = localizedCardName(localized, meta?.name, faceIndex) ?? 'Carte';
  /*
   * Le repère de langue, comme sur la vignette.
   *
   * On n'arrive ici qu'avec une identité connue : le chemin « objet de partie »
   * exige `card.faceDown === false` (c'est `known`), et le chemin « impression
   * survolée » n'a pas d'identité cachée du tout — c'est une carte de la
   * recherche ou de l'étagère, publique par construction. L'affirmation est
   * quand même écrite, plutôt que supposée, parce que c'est elle qui empêche le
   * repère d'apparaître sur un dos de carte.
   */
  const languageMark = cardLanguageMark({
    identityKnown: source === 'printing' || known !== null,
    resolved,
    language,
  });

  // `boxed` porte la hauteur **mesurée** du panneau, bandeau de nom compris ;
  // `size` ne décrit que l'illustration et servirait à poser le sommet trop bas.
  const rect = previewRect(corner, boxed, viewport, MARGIN);

  return (
    <div
      /*
        `z-[45]` et non `z-40` : la recherche de jeton est une modale voilée à
        `z-40`, et un aperçu peint dessous serait un aperçu gris. On reste en
        revanche sous les menus et les boîtes de dialogue (`z-50`), qui eux
        doivent rester lisibles.
      */
      className="pointer-events-none fixed z-[45]"
      data-test="card-preview"
      data-preview-corner={corner}
      data-preview-side={corner.endsWith('left') ? 'left' : 'right'}
      data-preview-source={source}
      ref={panelRef}
      style={{ left: rect.left, top: rect.top, width: rect.width }}
    >
      <div className="relative overflow-hidden rounded-[14px] bg-slate-950 shadow-2xl shadow-black/90 ring-1 ring-white/20 transition-all">
        {/* `relative` sur le cadre, pour que le repère se pose sur l'image et
            non sur la fenêtre : l'aperçu lui-même est `fixed`. */}
        {/* Même coin que sur la table — haut-gauche — pour qu'on le cherche au
            même endroit d'une vue à l'autre. Aucun autre repère n'occupe ce coin
            dans l'aperçu, il n'y a donc rien à décaler ici. */}
        {languageMark && (
          <CardLanguageBadge className="absolute left-1.5 top-1.5" mark={languageMark} />
        )}
        <img
          alt={shownName}
          className="w-full object-cover rounded-[14px]"
          draggable={false}
          /* CDN Scryfall, directement : rien n'est hébergé ni proxifié chez nous. */
          src={imageSrc}
        />
      </div>
      {meta && (
        <div className="mt-1.5 flex items-center justify-between gap-1.5 rounded-lg border border-slate-700/90 bg-slate-950/95 px-2.5 py-1 shadow-lg backdrop-blur-md">
          <span className="truncate text-xs font-semibold text-slate-100">
            {shownName}
          </span>
          {meta.manaCost && <ManaCost cost={meta.manaCost} size="md" />}
        </div>
      )}
    </div>
  );
}

/**
 * Les poignées de survol, pour une simple impression.
 *
 * Elles existent pour que les pages **hors table** — l'éditeur de deck, le
 * choix d'une impression — déclenchent le même aperçu que la table sans en
 * réécrire un second : un jumeau divergerait dès la première correction du
 * repli d'illustration, du repère de langue ou du placement.
 *
 * Elles passent volontairement par le chemin « impression » et non par
 * `setHovered`, pour la raison qu'`OpponentHand` donne déjà : désigner une
 * carte comme « carte survolée » la donne pour cible aux raccourcis
 * contextuels. Dans un éditeur de deck, rien ne doit devenir la cible d'une
 * action de jeu — et la plupart de ces cartes n'ont d'ailleurs aucun objet de
 * partie derrière elles.
 *
 * `getState()` plutôt qu'un sélecteur : on ne fait qu'**écrire** dans le store,
 * et s'y abonner ferait re-rendre toute une liste de cartes à chaque survol.
 */
export function previewHoverProps(scryfallId: string | null | undefined): {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
} {
  return {
    onPointerEnter: () => useGame.getState().hoverPreview(scryfallId ?? null),
    onPointerLeave: () => useGame.getState().hoverPreview(null),
  };
}

/**
 * Éteint l'aperçu. À appeler au démontage de ce qui l'a allumé : une modale
 * fermée sous le curseur n'émet aucun `pointerleave`, et l'aperçu resterait
 * seul à l'écran, au-dessus d'une page qui ne montre plus rien de tel.
 */
export function clearCardPreview(): void {
  useGame.getState().hoverPreview(null);
}

/** Les identifiants sont des ULID, mais on ne construit pas un sélecteur à l'aveugle. */
