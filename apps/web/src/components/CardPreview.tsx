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
import {
  cardLanguageMark,
  isTokenForNaming,
  keywordName,
  resolveCardImage,
  tokenName,
} from '../lib/i18n/index.js';
import { useForceLocalizedPrinting, useLanguage } from '../store/prefs.js';
import { CardLanguageBadge } from './CardSprite.js';
import { ManaCost } from './ManaCost.js';
import { lastPointer } from '../lib/hover.js';
import {
  DEFAULT_PREVIEW_CORNER,
  choosePreviewCorner,
  hoveredCardRects,
  previewBox,
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
   * La hauteur du panneau : imposée pour l'illustration, mesurée pour le reste.
   *
   * L'ancienne version mesurait le panneau **entier**, une seule fois, dans un
   * effet dont les dépendances ne couvraient que le changement de carte. Deux
   * choses arrivent pourtant après cette mesure, et les deux le font grandir :
   * l'image, qui n'a aucune dimension tant qu'elle n'est pas chargée — une
   * `<img>` vide mesure zéro —, et la fiche de la carte, qui rentre par lots et
   * fait alors apparaître le bandeau de nom puis la rangée de mécaniques. Le
   * sommet avait été posé pour un panneau court ; il restait là pendant que le
   * panneau s'allongeait vers le bas, hors de l'écran. D'où le « parfois » : au
   * premier survol l'image n'est pas encore là, aux suivants l'élément garde
   * les dimensions de la précédente et le défaut se cache.
   *
   * On renverse donc la charge. L'illustration reçoit une hauteur **explicite**
   * — elle est déjà connue, c'est `size.height` —, si bien que le panneau a sa
   * taille définitive dès le premier rendu, chargé ou non. Seul ce qui est peint
   * dessous se mesure, et un `ResizeObserver` s'en charge : c'est la seule
   * manière d'apprendre qu'un lot de fiches vient d'ajouter une rangée.
   *
   * Cette mesure ne sert toutefois que de garde-fou. Le panneau étant ancré par
   * le bas, s'y fier directement le ferait **remonter** sous les yeux du joueur
   * à chaque fiche qui rentre ; `previewBox` réserve donc la place des bandeaux
   * d'avance et ne consulte la mesure que lorsqu'elle la dépasse.
   */
  const bandsRef = useRef<HTMLDivElement>(null);
  const [bandsHeight, setBandsHeight] = useState(0);
  const {
    width: boxWidth,
    height: boxHeight,
    imageHeight,
  } = previewBox({
    imageHeight: size.height,
    ratio: CARD_WIDTH / CARD_HEIGHT,
    bandsHeight,
    viewport,
    margin: MARGIN,
  });

  useLayoutEffect(() => {
    const node = bandsRef.current;
    if (!node) {
      setBandsHeight((current) => (current === 0 ? current : 0));
      return;
    }
    const mesurer = (): void => {
      const hauteur = node.getBoundingClientRect().height;
      setBandsHeight((current) => (Math.abs(current - hauteur) < 0.5 ? current : hauteur));
    };
    mesurer();
    // `ResizeObserver` manque à l'environnement de test, qui n'a pas de mise en
    // page : l'absence d'observateur n'y change rien, la mesure initiale suffit.
    if (typeof ResizeObserver === 'undefined') return;
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(node);
    return () => observateur.disconnect();
  }, [shown]);

  const previewKey = preview?.scryfallId ?? null;
  useLayoutEffect(() => {
    const next = shown
      ? choosePreviewCorner({
          size: { width: boxWidth, height: boxHeight },
          viewport,
          margin: MARGIN,
          hovered: hoveredCardRects(hoveredId, lastPointer()),
        })
      : DEFAULT_PREVIEW_CORNER;
    setCorner((current) => (current === next ? current : next));
  }, [shown, hoveredId, previewKey, boxWidth, boxHeight, viewport]);

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
  /*
   * Le nom affiché — et l'`alt` de l'illustration, qui est le même.
   *
   * **Un jeton passe en plus par le glossaire**, exactement comme sur la table
   * (`CardSprite`) et dans la recherche (`TokenSearch`) : Scryfall ne publie
   * aucune impression traduite de jeton, `localizedCardName` rend donc l'anglais
   * quoi qu'il arrive, et le français est le nôtre. Un aperçu qui dirait
   * « Angel » sous un jeton dont le bandeau dit « Ange » ferait douter le joueur
   * de l'un des deux.
   *
   * Ce qui décide vit dans `isTokenForNaming`, et pas ici : l'aperçu s'ouvre
   * aussi bien sur un objet de partie — qui porte un `kind`, le signal du
   * protocole — que sur une simple impression d'étagère ou de recherche, qui
   * n'en a pas et n'a que sa ligne de type. Les deux cas se lisent au même
   * endroit plutôt qu'en deux heuristiques jumelles.
   */
  const estJeton = isTokenForNaming({ kind: card?.kind, typeLine: meta?.typeLine });
  const nomCatalogue = localizedCardName(localized, meta?.name, faceIndex);
  const shownName = (estJeton ? tokenName(nomCatalogue, language) : nomCatalogue) ?? 'Carte';
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

  // La boîte porte la hauteur du panneau **entier**, bandeaux compris ; `size`
  // ne décrit que l'illustration et servirait à poser le sommet trop bas.
  const rect = previewRect(corner, { width: boxWidth, height: boxHeight }, viewport, MARGIN);

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
      style={{ left: rect.left, top: rect.top, width: rect.width }}
    >
      {/* Hauteur imposée au cadre : c'est elle qui rend la géométrie du panneau
          indépendante du chargement de l'image. */}
      <div
        className="relative overflow-hidden rounded-[14px] bg-slate-950 shadow-2xl shadow-black/90 ring-1 ring-white/20 transition-all"
        style={{ height: imageHeight }}
      >
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
          className="h-full w-full object-cover rounded-[14px]"
          /*
           * Ancre explicite : le panneau contient aussi les symboles de mana,
           * qui sont des `<img>`. Un sélecteur « l'image de l'aperçu » en
           * attrapait donc deux dès que la fiche arrivait à temps — et une
           * seule quand elle tardait, ce qui rendait la recette intermittente.
           */
          data-test="card-preview-image"
          draggable={false}
          /* CDN Scryfall, directement : rien n'est hébergé ni proxifié chez nous. */
          src={imageSrc}
        />
      </div>
      {/*
        Tout ce qui est peint sous l'illustration, dans un seul cadre mesuré.

        `flex flex-col` n'est pas décoratif : dans un bloc ordinaire, la marge
        haute du premier enfant s'échapperait du parent — les marges se fondent —
        et la mesure perdrait les six pixels qui séparent le bandeau de l'image.
        Un conteneur flex ne fond aucune marge.
      */}
      <div className="flex flex-col" ref={bandsRef}>
        {meta && (
          <div className="mt-1.5 flex items-center justify-between gap-1.5 rounded-lg border border-slate-700/90 bg-slate-950/95 px-2.5 py-1 shadow-lg backdrop-blur-md">
            <span className="truncate text-xs font-semibold text-slate-100">
              {shownName}
            </span>
            {meta.manaCost && <ManaCost cost={meta.manaCost} size="md" />}
          </div>
        )}
        {/*
          Les mécaniques en toutes lettres, et **ici seulement**.

          Sur une vignette, la carte ne porte qu'une pastille de compte : les
          cartes du rail de main se recouvrent, seule leur bande gauche reste
          visible, et un mot français coupé en deux a l'air d'un autre mot. Un
          chiffre supporte d'être lu de biais, pas « Piétinem… ».

          L'aperçu agrandi, lui, a toute la largeur qu'il faut, et c'est
          précisément l'écran qu'on ouvre pour lire la carte. Les noms non traduits
          ressortent en anglais plutôt que d'être escamotés : un mot-clé absent du
          glossaire doit se voir, pas disparaître.
        */}
        {meta?.keywords && meta.keywords.length > 0 && (
          <div
            className="mt-1 flex flex-wrap gap-1 rounded-lg border border-slate-700/70 bg-slate-950/90 px-2 py-1 text-[10px] text-slate-300 shadow-lg backdrop-blur-md"
            data-test="preview-keywords"
          >
            {meta.keywords.map((kw) => (
              <span className="rounded bg-slate-800/80 px-1.5 py-0.5" key={kw}>
                {keywordName(kw, language) ?? kw}
              </span>
            ))}
          </div>
        )}
      </div>
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
