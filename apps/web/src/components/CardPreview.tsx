/**
 * Aperçu agrandi de la carte survolée.
 *
 * Trois règles, et elles ne sont pas décoratives :
 *
 * - **Il ne capte jamais le pointeur** (`pointer-events: none`). Un aperçu
 *   cliquable se placerait sous le curseur, tuerait le `pointerleave` de la
 *   carte, et se figerait — il casserait le survol dont il dépend.
 * - **Il se place toujours à gauche de l'écran**, à un emplacement fixe. Un
 *   aperçu qui change de bord selon la carte survolée oblige l'œil à le
 *   rechercher ; au même endroit, on le lit sans y penser.
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
import { useEffect, useState } from 'react';
import { useGame } from '../store/game.js';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardMeta,
  isDoubleFaced,
  scryfallImage,
  subscribeCards,
} from '../lib/cards.js';

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
  const [, setTick] = useState(0);
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

  const card = hoveredId ? cards.get(hoveredId) : undefined;

  // Pendant un glissement, la carte fantôme suffit : un second grand visuel
  // encombrerait le geste.
  if (dragging) return null;

  /*
   * Ce qu'on montre, et d'où ça vient.
   *
   * L'objet de partie l'emporte : il porte l'état. Survoler un objet dont
   * l'identité nous est cachée n'affiche rien — et ne se rabat pas sur
   * l'impression survolée ailleurs, qui n'a rien à voir avec lui.
   */
  const source = card ? 'card' : preview ? 'printing' : null;
  if (card && card.faceDown !== false) return null;
  const scryfallId = card ? card.scryfallId : preview?.scryfallId;
  if (!scryfallId || !source) return null;

  const meta = cardMeta(scryfallId);
  const face = card?.flipped && isDoubleFaced(meta) ? 'back' : 'front';

  // Place fixe, à gauche : un aperçu qui saute d'un bord à l'autre selon la carte
  // survolée oblige l'œil à le rechercher à chaque fois. Toujours au même
  // endroit, on le lit sans y penser — et la colonne de gauche est la seule qui
  // ne porte pas de zone de jeu.
  // Ancré en bas de la colonne : le journal d'actions occupe le haut du même
  // bord, et deux panneaux qui se recouvrent valent moins que deux panneaux
  // lisibles. Sur une fenêtre basse, on remonte jusqu'à la marge.
  const size = previewSize(viewport.width, viewport.height);
  const top = Math.max(MARGIN, viewport.height - size.height - MARGIN);

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
      data-preview-side="left"
      data-preview-source={source}
      style={{ left: MARGIN, top, width: size.width }}
    >
      <div className="overflow-hidden rounded-[14px] bg-slate-950 shadow-2xl shadow-black/90 ring-1 ring-white/20 transition-all">
        <img
          alt={meta?.name ?? 'Carte'}
          className="w-full object-cover rounded-[14px]"
          draggable={false}
          /* CDN Scryfall, directement : rien n'est hébergé ni proxifié chez nous. */
          src={scryfallImage(scryfallId, 'large', face)}
        />
      </div>
      {meta && (
        <div className="mt-1.5 flex items-center justify-between gap-1.5 rounded-lg border border-slate-700/90 bg-slate-950/95 px-2.5 py-1 shadow-lg backdrop-blur-md">
          <span className="truncate text-xs font-semibold text-slate-100">
            {meta.name}
          </span>
          {meta.manaCost && (
            <span className="shrink-0 font-mono text-[11px] font-bold text-amber-300">
              {meta.manaCost}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Les identifiants sont des ULID, mais on ne construit pas un sélecteur à l'aveugle. */
