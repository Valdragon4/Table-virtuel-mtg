import type { CardView, SeatSummary, ZoneKind } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { BATTLEFIELD_SCALE, CardSprite, CARD_HEIGHT, CARD_WIDTH, PILE_SCALE } from './CardSprite.js';
import { CardBack } from './CardBack.js';
import { zoneAttr } from '../lib/drag.js';
import { dragJustEnded } from './DragLayer.js';

/**
 * Dimensions d'un terrain de joueur.
 *
 * Elles viennent de ce qu'une partie de Commander demande réellement, et non
 * d'un nombre rond. Un permanent fait 83 × 115 (166 × 230 à l'échelle 0,5).
 * Une fois retirées les deux colonnes de piles (92 de chaque côté) et le
 * bandeau d'identité, il reste 1076 × 612 de terrain utile, soit :
 *
 * - une rangée basse de **douze terrains** — un deck de Commander en pose
 *   couramment dix à douze en fin de partie, et les ranger en deux rangées
 *   mangeait la place des créatures ;
 * - **trois rangées** au-dessus pour les créatures, artefacts et enchantements ;
 * - soit **48 permanents** sans chevauchement, ce qui absorbe un plateau à
 *   jetons sans qu'on ait à les empiler.
 *
 * L'ancien 900 × 480 n'en tenait que 21, et l'on saturait dès qu'un deck partait
 * en largeur.
 */
/**
 * Ecart entre deux panneaux.
 *
 * Il vit ici, avec les dimensions du panneau, et non dans `Table` : `seatView`
 * en a besoin, et `Table` importe `seatView` — l'y laisser fermait un cycle
 * d'imports.
 */
export const GAP = 48;

export const PANEL_WIDTH = 1260;
export const PANEL_HEIGHT = 660;
/** Largeur de la colonne des piles, à droite du panneau. */
export const PILE_COLUMN = 92;
/** Largeur de la colonne de commandement, à gauche du panneau. */
export const COMMAND_COLUMN = 92;

/** Piles qui ont un menu contextuel et une vignette dans le panneau. */
export type PileKind = 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'COMMAND';

export interface SeatPanelProps {
  seat: SeatSummary;
  isMe: boolean;
  isActive: boolean;
  battlefield: CardView[];
  /**
   * Carte en cours de glissement, à ne pas peindre — elle est déjà sous le
   * curseur, en fantôme.
   *
   * Elle reste **dans** `battlefield`, et c'est tout l'intérêt : le placement
   * des attachements se calcule à partir de sa position, et l'en retirer
   * larguait l'ancre de ce qui lui est attaché pendant toute la durée du geste.
   */
  draggedAwayId?: string | null;
  /** Zone de commandement : publique, donc rendue avec son contenu. */
  command: CardView[];
  counts: { library: number; graveyard: number; exile: number; command: number; hand: number };
  topGraveyard: CardView | undefined;
  selection: Set<string>;
  highlight: Set<string>;
  /** Carte désignée comme source d'un accrochage en attente, s'il y en a une. */
  attachPendingId?: string | null;
  /** Numéro du tour courant, affiché sur le siège actif. */
  turnNumber?: number;
  /**
   * Main de ce siège telle que je la connais. Vide pour les autres, sauf
   * quand ils ont révélé leur main : on la montre alors, faute de quoi
   * « révéler sa main » n'a aucune sortie visible.
   */
  onCardPointerDown: (card: CardView, event: React.PointerEvent) => void;
  onCardDoubleClick: (card: CardView) => void;
  onCardContextMenu: (card: CardView, event: React.MouseEvent) => void;
  onZoneClick: (kind: PileKind) => void;
  onZoneContextMenu: (kind: PileKind, event: React.MouseEvent) => void;
}

/**
 * Une zone de jeu : le playmat du joueur, son champ de bataille en placement
 * libre, ses piles sur les bords et son bandeau d'identité.
 */
export function SeatPanel({
  seat,
  isMe,
  isActive,
  battlefield,
  draggedAwayId = null,
  command,
  counts,
  topGraveyard,
  selection,
  highlight,
  attachPendingId = null,
  turnNumber = 0,
  onCardPointerDown,
  onCardDoubleClick,
  onCardContextMenu,
  onZoneClick,
  onZoneContextMenu,
}: SeatPanelProps): React.ReactElement {
  const placement = attachmentLayout(battlefield);
  /**
   * Trois retours partagent le bandeau d'identité : la consultation en cours,
   * la main révélée, et la déconnexion. Ils sont lus ici plutôt que passés en
   * cascade : ils changent rarement, et jamais à la fréquence du pointeur.
   */
  const mySeat = useGame((s) => s.mySeat);
  const looking = useGame((s) => s.looksInProgress.get(seat.id));
  const handRevealed = useGame((s) => s.handsRevealed.has(seat.id));
  const hovered = useGame((s) => s.hoveredCardId);
  /**
   * Dessus de bibliothèque révélé en permanence, pour ce siège.
   *
   * Deux lectures, donc deux sélecteurs, parce que ce sont deux choses
   * différentes : le **fait** — public, `TOP_REVEALED` s'adresse à toute la
   * table — et la **carte**, que seul un destinataire possède. Un siège qui
   * n'est pas destinataire a `cardId === null` : il n'y a alors rien à
   * afficher qu'un repère, et surtout aucune carte à deviner.
   *
   * Rien n'est mémorisé ici. Le serveur retire la carte par `CARD_HIDDEN` dès
   * qu'elle cesse d'être le dessus ; la map et `cards` font foi à chaque
   * rendu, et un cache local afficherait une carte déjà partie.
   *
   * Chaque sélecteur rend une référence **qui existe déjà** dans le store. En
   * construire une neuve — un objet, un tableau — rendrait le sélecteur inégal
   * à lui-même et la table se re-rendrait sans fin (React #185).
   */
  const topReveal = useGame((s) => s.topReveals.get(seat.id));
  const revealedTop = useGame((s) => {
    const id = s.topReveals.get(seat.id)?.cardId;
    return id === null || id === undefined ? undefined : s.cards.get(id);
  });
  const seats = useGame((s) => s.seats);

  /**
   * À qui ce dessus est montré, en clair.
   *
   * On le dit à tout le monde, et c'est voulu : la liste des destinataires est
   * publique par construction, et c'est surtout le **propriétaire** qui doit
   * la lire — on ne joue pas de la même façon quand un adversaire voit le
   * dessus de sa bibliothèque.
   */
  const topRevealNote = ((): { own: boolean; names: string } | null => {
    if (!topReveal) return null;
    const own = seat.id === mySeat;
    const names = topReveal.toSeats
      // « vous » ne se dit que sur sa propre pile. Ailleurs, c'est le nom du
      // joueur qui situe — « révélé à vous » sur la bibliothèque d'un autre
      // ne dit pas de qui est la bibliothèque.
      .map((id) => (own && id === mySeat ? 'vous' : (seats.find((s) => s.id === id)?.displayName ?? id)))
      .join(', ');
    return { own, names };
  })();

  /** Nombre d'objets attachés à chaque permanent, pour son badge de lien. */
  const attachedCount = new Map<string, number>();
  for (const card of battlefield) {
    if (!card.attachedTo) continue;
    attachedCount.set(card.attachedTo, (attachedCount.get(card.attachedTo) ?? 0) + 1);
  }
  /**
   * Paire mise en évidence : survoler l'un des deux éclaire l'autre. C'est ce
   * qui remplace la flèche d'attachement — le lien se lit au survol, là où on
   * le cherche, au lieu de traverser le panneau en permanence.
   */
  const linked = new Set<string>();
  if (hovered) {
    const card = battlefield.find((c) => c.id === hovered);
    if (card?.attachedTo) {
      linked.add(card.id);
      linked.add(card.attachedTo);
    }
    for (const other of battlefield) {
      if (other.attachedTo === hovered) {
        linked.add(other.id);
        linked.add(hovered);
      }
    }
  }

  const cardProps = (card: CardView): Record<string, unknown> => ({
    onPointerDown: (event: React.PointerEvent) => onCardPointerDown(card, event),
    onDoubleClick: () => onCardDoubleClick(card),
    onContextMenu: (event: React.MouseEvent) => onCardContextMenu(card, event),
  });

  /**
   * Une vignette par commandant, avec sa taxe. Le surcoût vaut deux fois le
   * nombre de lancements précédents ; c'est ce chiffre-là qu'on lit à la table,
   * pas le nombre de lancements.
   *
   * Sans commandant en zone de commandement, on garde une vignette vide comme
   * cible de dépôt — sinon on ne pourrait plus l'y remettre.
   */
  const commandPiles: Array<{ card: CardView | undefined; tax: number | null; taxTitle: string }> =
    command.length > 0
      ? command.map((card) => {
          const casts = seat.commanderTax[card.id] ?? 0;
          return {
            card,
            tax: casts * 2,
            taxTitle:
              casts === 0
                ? 'Taxe de commandant : aucune, il n’a pas encore été lancé'
                : `Taxe de commandant : +${casts * 2} (lancé ${casts} fois)`,
          };
        })
      : [{ card: undefined, tax: null, taxTitle: 'Zone de commandement' }];

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        outline: `2px solid ${isActive ? seat.color : 'transparent'}`,
        outlineOffset: 2,
        boxShadow: `0 0 0 1px ${seat.color}55`,
        opacity: seat.conceded ? 0.5 : 1,
      }}
    >
      {/*
        Playmat par défaut : **translucide**. Le fond de table est une matière
        dessinée pour être vue ; un rectangle bleu nuit opaque par siège la
        recouvrait entièrement, et à huit joueurs l'écran n'était plus qu'une
        grille de tuiles plates. On garde donc la zone clairement délimitée —
        liseré à la couleur du siège, léger assombrissement pour que les cartes
        restent lisibles par-dessus — et rien de plus. Un joueur qui configure
        son propre playmat voit son image, opaque : c'est son choix.

        L'assombrissement a été divisé par deux le jour où le fond est devenu un
        vrai dallage : à 42 %/55 %, quatre panneaux couvraient la dalle entière
        et l'on ne voyait plus que quatre vitres sombres posées sur rien. Les
        cartes, elles, sont opaques : elles n'ont jamais eu besoin de ce voile,
        seul le liseré de couleur désigne la zone.
      */}
      <div
        className="absolute inset-0"
        data-test="playmat-default"
        style={{
          background: `radial-gradient(120% 90% at 50% 0%, ${seat.color}20, transparent 72%), linear-gradient(160deg, rgb(15 23 42 / 18%), rgb(2 6 23 / 30%))`,
        }}
      />
      {seat.playmatUrl && (
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          src={seat.playmatUrl}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      )}

      {/*
        La main de l'adversaire, montrée pour ce qu'elle est : des dos de carte,
        en bord de terrain.
        Le nombre du bandeau se lit, mais il ne se **voit** pas — on ne sent pas
        la différence entre trois et sept cartes sans aller la chercher. Un
        éventail de dos la donne d'un coup d'œil, comme en face d'un vrai
        joueur. On n'en dessine jamais plus de dix : au-delà, c'est le nombre
        qui renseigne, pas la longueur de l'éventail.
      */}
      {/* Champ de bataille : tout le panneau, sauf les deux colonnes de piles.
          `data-mine` marque le nôtre : une recette de test doit pouvoir viser un
          permanent qui nous appartient, et non celui d'un adversaire — le menu
          s'y ouvre pareil, mais le serveur en refuse les actions. */}
      <div
        className="absolute inset-0"
        data-zone={zoneAttr({ seat: seat.id, kind: 'BATTLEFIELD' })}
        data-mine={seat.id === mySeat ? '1' : undefined}
        style={{ left: COMMAND_COLUMN, right: PILE_COLUMN }}
      >
        {battlefield.map((card) => {
          // Le sprite de la carte tenue n'est pas peint — son fantôme suit le
          // curseur —, mais `placement` l'a bien vue : ce qui lui est attaché
          // garde son ancre pendant tout le geste.
          if (card.id === draggedAwayId) return null;
          const slot = placement.get(card.id) ?? { x: card.x, y: card.y, depth: 0, rank: 0 };
          const pending = attachPendingId === card.id;
          return (
            <div
              key={card.id}
              className="absolute"
              data-attached={card.attachedTo ?? undefined}
              data-card-id={card.id}
              style={{
                left: slot.x,
                top: slot.y,
                // Une carte attachée passe **sous** sa cible, comme un
                // équipement qu'on glisse sous la créature qu'il équipe : plus
                // l'attachement est profond, plus la carte est enfouie.
                /*
                  Une carte attachée passe **sous** sa cible, et deux cartes
                  attachées à la même cible s'empilent dans l'ordre de leur
                  décalage — sans quoi elles partagent le même rang et c'est le
                  DOM qui tranche, au hasard de l'ordre des objets.
                  Une profondeur vaut huit rangs, ce qui laisse la place aux
                  frères sans qu'un niveau déborde sur le suivant.

                  **Le plafond compte autant que l'ordre** : les curseurs des
                  autres joueurs vivent à `z-index: 40` et doivent passer
                  au-dessus des cartes. Une première version partait de 100 et
                  les faisait disparaître dessous ; la recette d'interface l'a
                  vu tout de suite.
                */
                zIndex: 30 - slot.depth * 8 - Math.min(slot.rank, 7),
                ...(pending
                  ? {
                      outline: '2px dashed #38bdf8',
                      outlineOffset: '3px',
                      borderRadius: '8px',
                    }
                  : linked.has(card.id)
                    ? { outline: '2px solid #38bdf8', outlineOffset: '2px', borderRadius: '8px' }
                    : {}),
              }}
            >
              <CardSprite
                card={card}
                cardBackUrl={seat.cardBackUrl}
                scale={BATTLEFIELD_SCALE}
                selected={selection.has(card.id)}
                highlighted={highlight.has(card.id)}
                {...cardProps(card)}
              />
              {/* Ce permanent porte des attachements : on le dit sur lui, et le
                  survol éclaire la paire. */}
              {attachedCount.has(card.id) && (
                <span
                  className="pointer-events-none absolute -right-1 -top-2 rounded bg-sky-600 px-1 text-[10px] font-semibold text-white ring-1 ring-sky-300/50"
                  data-test="attach-badge"
                  title="Objets attachés"
                >
                  🔗 {attachedCount.get(card.id)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Bandeau d'identité, en haut à droite comme sur la table de référence. */}
      <div className="absolute right-2 top-2 flex items-center gap-2 rounded bg-slate-950/80 px-2 py-1 text-xs ring-1 ring-white/10">
        <span className="h-2 w-2 rounded-full" style={{ background: seat.color }} />
        <span className="font-medium text-slate-200">{seat.displayName}</span>
        {!seat.connected && <span className="text-amber-400">déconnecté</span>}
        {/*
          Trois états qui n'avaient aucune sortie visible : à qui est le tour,
          qui consulte sa bibliothèque, qui joue main ouverte. Ils tiennent
          tous dans le bandeau, à côté de « déconnecté ».
        */}
        {isActive && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-950"
            data-test="active-turn"
            style={{ background: seat.color }}
          >
            {isMe ? `Tour ${turnNumber} · à vous` : `Tour ${turnNumber}`}
          </span>
        )}
        {looking && (
          <span
            className="rounded bg-indigo-900/80 px-1.5 py-0.5 text-[10px] text-indigo-200 ring-1 ring-indigo-500/40"
            data-test="looking"
          >
            {looking === 'REVEAL' ? '✨ révèle le dessus' : '👁 consulte sa bibliothèque'}
          </span>
        )}
        {handRevealed && (
          <span
            className="rounded bg-amber-900/70 px-1.5 py-0.5 text-[10px] text-amber-200 ring-1 ring-amber-500/40"
            data-test="hand-revealed"
          >
            main révélée
          </span>
        )}
        <span className="ml-1 text-base font-semibold text-slate-100">{seat.life}</span>
        {/*
          La main d'un adversaire est une information qu'on consulte sans arrêt
          — c'est elle qui dit s'il a de quoi répondre. Écrite « · 7 en main »
          en gris sur gris, il fallait la chercher. Elle devient une pastille,
          avec deux dos de carte dessinés : on la lit d'un coup d'œil, sans pour
          autant qu'elle concurrence le total de points de vie.
        */}
        <span
          className="inline-flex items-center gap-1 rounded bg-slate-800/90 px-1.5 py-0.5 text-[11px] font-semibold text-slate-100 ring-1 ring-white/15"
          data-test="hand-count"
          title={`${counts.hand} carte(s) en main`}
        >
          <svg
            aria-hidden
            className="shrink-0"
            fill="none"
            height="11"
            viewBox="0 0 14 11"
            width="14"
          >
            <rect
              height="8"
              rx="1"
              stroke="currentColor"
              strokeOpacity="0.55"
              width="6"
              x="0.6"
              y="2"
            />
            <rect
              fill="currentColor"
              fillOpacity="0.16"
              height="9"
              rx="1"
              stroke="currentColor"
              strokeOpacity="0.85"
              width="6.4"
              x="6.6"
              y="1"
            />
          </svg>
          {counts.hand}
        </span>
        {/*
          Un compteur à zéro ne dit rien. C'est visible sur les mulligans, que
          le serveur remet à zéro après le premier tour : la ligne restait, avec
          son « 0 », à côté de chaque joueur pour le reste de la partie.
        */}
        {seat.playerCounters
          .filter((counter) => counter.value !== 0)
          .map((counter) => (
          <span key={counter.kind} className="text-slate-400" title={counter.kind}>
            · {counter.kind} {counter.value}
          </span>
        ))}
      </div>

      {/*
        Zone de commandement, sur le bord gauche. Son contenu est public — le
        commandant est connu de toute la table — donc on montre la carte, pas un
        dos. Elle porte son `data-zone` : on y dépose un commandant revenu du
        champ de bataille, et on l'en ressort par glissement.
      */}
      <div className="absolute bottom-2 left-2 top-12 flex flex-col justify-start gap-2" style={{ width: COMMAND_COLUMN - 16 }}>
        {commandPiles.map((pile, index) => (
          <ZonePile
            key={pile.card?.id ?? `vide-${index}`}
            label="Commandement"
            count={counts.command}
            color={seat.color}
            zone={zoneAttr({ seat: seat.id, kind: 'COMMAND' })}
            preview={pile.card}
            cardBackUrl={seat.cardBackUrl}
            // Le compte d'une zone de commandement n'apprend rien : on y voit
            // déjà la carte. Le badge sert donc à ce qu'on cherche vraiment du
            // regard avant de relancer son commandant — la taxe.
            badge={pile.tax === null ? null : `+${pile.tax}`}
            badgeTone="tax"
            badgeTitle={pile.taxTitle}
            {...(pile.card ? { onPreviewPointerDown: (event: React.PointerEvent) => onCardPointerDown(pile.card!, event) } : {})}
            onClick={() => onZoneClick('COMMAND')}
            onContextMenu={(event) => onZoneContextMenu('COMMAND', event)}
          />
        ))}
      </div>

      {/*
        Colonne des piles : bibliothèque, cimetière, exil — un compte, jamais le
        contenu. La bibliothèque fait une exception, et une seule : quand son
        dessus est révélé en permanence et que nous en sommes destinataires, le
        serveur nous a envoyé cette carte-là, et elle remplace le dos. Le compte
        reste lisible par-dessus, dans son badge d'angle.
      */}
      <div
        className="absolute bottom-2 right-2 top-12 flex flex-col justify-start gap-2"
        style={{ width: PILE_COLUMN - 16 }}
      >
        <ZonePile
          label="Bibliothèque"
          count={counts.library}
          color={seat.color}
          showBack
          cardBackUrl={seat.cardBackUrl}
          zone={zoneAttr({ seat: seat.id, kind: 'LIBRARY' })}
          // Le dessus révélé, s'il nous a été envoyé. Aucun `onPreviewPointerDown`
          // ici, contrairement au cimetière : cette carte est en bibliothèque, et
          // on ne tire pas une carte hors d'une bibliothèque par glissement.
          // Elle reste survolable, donc elle a son aperçu agrandi comme les autres.
          preview={revealedTop}
          topReveal={topRevealNote}
          onClick={() => onZoneClick('LIBRARY')}
          onContextMenu={(event) => onZoneContextMenu('LIBRARY', event)}
        />
        <ZonePile
          label="Cimetière"
          count={counts.graveyard}
          color="#64748b"
          zone={zoneAttr({ seat: seat.id, kind: 'GRAVEYARD' })}
          preview={topGraveyard}
          cardBackUrl={seat.cardBackUrl}
          onPreviewPointerDown={topGraveyard ? (event) => onCardPointerDown(topGraveyard, event) : undefined}
          onClick={() => onZoneClick('GRAVEYARD')}
          onContextMenu={(event) => onZoneContextMenu('GRAVEYARD', event)}
        />
        <ZonePile
          label="Exil"
          count={counts.exile}
          color="#1f2937"
          zone={zoneAttr({ seat: seat.id, kind: 'EXILE' })}
          onClick={() => onZoneClick('EXILE')}
          onContextMenu={(event) => onZoneContextMenu('EXILE', event)}
        />
      </div>

      {/*
        La main révélée d'un autre siège **ne se pose plus au milieu de son
        terrain**. Elle y couvrait les permanents, à l'endroit précis où l'on
        joue, pour une information qui n'est pas du jeu mais de la lecture.
        Elle se lit maintenant là où une main se lit : dans l'éventail de dos,
        en bord de terrain, où chaque carte montrée remplace son dos.
      */}

      {isMe && (
        <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-slate-950/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
          Votre zone
        </span>
      )}
    </div>
  );
}

/**
 * Décalage d'une carte attachée par rapport à sa cible, en unités de panneau.
 *
 * Resserré : à 26 × 54 la carte attachée s'éloignait assez pour qu'on ne lise
 * plus un attachement mais deux permanents voisins. Il faut juste de quoi voir
 * le bord et le nom de celle du dessous.
 */
const ATTACH_OFFSET_X = 16;
const ATTACH_OFFSET_Y = 30;
/** Écart supplémentaire entre deux cartes attachées à la même cible. */
const SIBLING_STEP_X = 7;
const SIBLING_STEP_Y = 11;

/**
 * Position de rendu des permanents, attachements compris.
 *
 * Une carte attachée ne se rend pas à ses propres coordonnées : elle se range
 * **sous** sa cible, légèrement décalée, exactement comme on glisse un
 * équipement sous la créature qu'il équipe. Elle la suit donc sans qu'aucun
 * intent ne soit émis quand la cible bouge, et deux équipements posés sur la
 * même créature s'échelonnent au lieu de se superposer.
 *
 * Cela remplace les flèches d'attachement qui traversaient le panneau : entre
 * deux cartes désormais superposées, une flèche n'aurait plus relié que deux
 * points confondus. Le seul cas qu'elles couvraient encore — une cible sur le
 * panneau d'un autre siège — n'était de toute façon pas dessiné, les flèches
 * étant calculées panneau par panneau.
 *
 * `depth` est le nombre d'attachements traversés : il sert de rang
 * d'empilement, pour qu'une aura posée sur un équipement passe sous lui.
 */
interface Slot {
  x: number;
  y: number;
  depth: number;
  /**
   * Rang parmi les cartes attachées à la même cible.
   *
   * Il ne servait qu'au décalage, et c'était un bug : toutes les cartes
   * attachées à une même carte partagent la même `depth`, donc recevaient le
   * **même** `z-index`. Leur ordre d'empilement retombait alors sur l'ordre du
   * DOM, sans rapport avec leur décalage — la deuxième pouvait passer au-dessus
   * de la première, et la pile se lisait de travers.
   */
  rank: number;
}

function attachmentLayout(cards: CardView[]): Map<string, Slot> {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const placement = new Map<string, Slot>();

  /** Rang d'une carte parmi celles attachées à la même cible : ordre stable. */
  const siblings = new Map<string, string[]>();
  for (const card of cards) {
    if (!card.attachedTo || !byId.has(card.attachedTo)) continue;
    const list = siblings.get(card.attachedTo) ?? [];
    list.push(card.id);
    siblings.set(card.attachedTo, list);
  }
  for (const list of siblings.values()) list.sort();

  const resolve = (card: CardView, seen: Set<string>): Slot => {
    const known = placement.get(card.id);
    if (known) return known;

    const target = card.attachedTo ? byId.get(card.attachedTo) : undefined;
    // Cible absente du panneau, ou chaîne d'attachements qui boucle : la carte
    // reste où le serveur la place. On ne devine rien.
    if (!target || seen.has(card.id)) {
      const own: Slot = { x: card.x, y: card.y, depth: 0, rank: 0 };
      placement.set(card.id, own);
      return own;
    }

    seen.add(card.id);
    const base = resolve(target, seen);
    const rank = (siblings.get(target.id) ?? []).indexOf(card.id);
    const slot: Slot = {
      x: base.x + ATTACH_OFFSET_X + Math.max(0, rank) * SIBLING_STEP_X,
      y: base.y + ATTACH_OFFSET_Y + Math.max(0, rank) * SIBLING_STEP_Y,
      depth: base.depth + 1,
      rank: Math.max(0, rank),
    };
    placement.set(card.id, slot);
    return slot;
  };

  for (const card of cards) resolve(card, new Set());
  return placement;
}

function ZonePile({
  label,
  count,
  color,
  zone,
  preview,
  cardBackUrl,
  onPreviewPointerDown,
  showBack,
  onClick,
  onContextMenu,
  badge,
  badgeTone = 'count',
  badgeTitle,
  topReveal = null,
}: {
  label: string;
  count: number;
  color: string;
  zone: string;
  preview?: CardView | undefined;
  cardBackUrl?: string | null;
  onPreviewPointerDown?: ((event: React.PointerEvent) => void) | undefined;
  /** Affiche un dos de carte plutôt qu'un libellé : réservé à la bibliothèque. */
  showBack?: boolean;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  /** Contenu du badge d'angle. `null` pour n'en afficher aucun. */
  badge?: string | number | null;
  badgeTone?: 'count' | 'tax';
  badgeTitle?: string;
  /**
   * Le dessus de cette pile est révélé en permanence : à qui, et est-ce la
   * nôtre. `null` quand il n'y a rien à dire — le cas de toutes les piles sauf
   * une bibliothèque en cours de révélation.
   */
  topReveal?: { own: boolean; names: string } | null;
}): React.ReactElement {
  // Sans badge explicite, on retombe sur le compte : c'est ce que font toutes
  // les piles sauf la zone de commandement, qui affiche la taxe à la place.
  const shownBadge = badge === undefined ? count : badge;

  return (
    <button
      className="relative shrink-0 rounded border border-white/10 bg-slate-950/70"
      data-zone={zone}
      style={{
        width: CARD_WIDTH * PILE_SCALE,
        height: CARD_HEIGHT * PILE_SCALE,
        borderColor: `${color}66`,
      }}
      onClick={() => {
        // Un dépôt vient de se terminer ici : ce clic n'en est pas un.
        if (dragJustEnded()) return;
        onClick();
      }}
      onContextMenu={onContextMenu}
      title={badgeTitle ?? `${label} — ${count}`}
      type="button"
    >
      {preview ? (
        <div className="absolute inset-0 overflow-hidden rounded opacity-90">
          <CardSprite
            card={preview}
            cardBackUrl={cardBackUrl}
            scale={PILE_SCALE}
            {...(onPreviewPointerDown ? { onPointerDown: onPreviewPointerDown } : {})}
          />
        </div>
      ) : showBack && count > 0 ? (
        // La bibliothèque montre un dos de carte : c'est ce qu'on voit sur une
        // vraie table, et c'est aussi ce qui rend le dos personnalisé visible.
        <div className="absolute inset-0 overflow-hidden rounded">
          <CardBack url={cardBackUrl} version="small" />
        </div>
      ) : (
        <span className="absolute inset-x-0 top-2 text-[9px] uppercase tracking-wide text-slate-500">
          {label}
        </span>
      )}
      {/*
        Le dessus est révélé en permanence : un œil, comme partout ailleurs.

        C'est la convention du projet pour « cette carte est montrée » — le même
        œil violet marque déjà une carte révélée dans une main. On le reprend
        tel quel, à la seule différence qu'il est ici posé sur la **pile** et
        non sur une carte : chez un siège qui n'est pas destinataire, il n'y a
        justement pas de carte, et le fait doit tout de même se lire.

        Chez le propriétaire, il est plus gros, pour la même raison que dans la
        main : c'est **lui** qui doit changer de jeu en sachant son dessus vu,
        et le titre nomme qui le voit. En bas à gauche, là où ni le compte — en
        haut à droite — ni le libellé d'une pile vide ne passent.
      */}
      {topReveal && (
        <span
          className={`pointer-events-none absolute bottom-0.5 left-0.5 inline-flex items-center rounded bg-slate-950/90 ring-1 ring-violet-400/60 ${
            topReveal.own ? 'px-1.5 py-1 text-violet-200' : 'px-1 py-0.5 text-violet-300'
          }`}
          data-test="top-revealed"
          data-reveal={topReveal.own ? 'from-me' : 'to-me'}
          title={
            topReveal.own
              ? `Le dessus de votre bibliothèque est révélé à ${topReveal.names}`
              : `Le dessus de cette bibliothèque est révélé à ${topReveal.names}`
          }
        >
          <svg
            aria-hidden
            fill="none"
            height={topReveal.own ? 15 : 9}
            viewBox="0 0 16 10"
            width={topReveal.own ? 22 : 13}
          >
            <path
              d="M1 5c2-2.8 4.4-4.2 7-4.2S13 2.2 15 5c-2 2.8-4.4 4.2-7 4.2S3 7.8 1 5Z"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <circle cx="8" cy="5" fill="currentColor" r="1.9" />
          </svg>
        </span>
      )}
      {shownBadge !== null && (
        <span
          className={`absolute -right-1 -top-1 min-w-5 rounded px-1 text-[11px] font-semibold ring-1 ${
            badgeTone === 'tax'
              ? 'bg-amber-900/90 text-amber-200 ring-amber-500/50'
              : 'bg-slate-900 text-slate-100 ring-white/20'
          }`}
          title={badgeTitle}
        >
          {shownBadge}
        </span>
      )}
    </button>
  );
}

export { CARD_WIDTH };
export type { ZoneKind };
