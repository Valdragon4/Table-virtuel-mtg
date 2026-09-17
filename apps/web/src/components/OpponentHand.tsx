/**
 * La main d'un adversaire, montrée **hors de son terrain**.
 *
 * Deux raisons de la sortir du panneau.
 *
 * D'abord, une main n'est pas sur la table : elle est tenue devant soi. La
 * poser sur le terrain lui donnait un statut qu'elle n'a pas, et la main
 * révélée d'un joueur recouvrait ses propres permanents — à l'endroit précis où
 * l'on joue — pour une information qui relève de la lecture, pas du jeu.
 *
 * Ensuite, techniquement : le panneau de siège est `overflow-hidden`, pour que
 * le playmat ne déborde pas de ses coins arrondis. Rien de ce qui vit à
 * l'intérieur ne peut donc en sortir. L'éventail est rendu par la table,
 * au-dessus du panneau, dans l'écart qui le sépare du voisin.
 *
 * **Ce qu'il dit.** Une place par carte : un dos pour ce qu'on ignore, la carte
 * elle-même pour ce qu'on nous a montré. C'est ce qu'il se passe à une vraie
 * table — on retourne une carte, elle reste dans la main, et tout le monde la
 * voit jusqu'à ce qu'elle reparte. Dix places au maximum : au-delà, c'est le
 * nombre qui renseigne, pas la longueur de l'éventail. Mais **toutes** les
 * cartes connues passent, quitte à réduire le nombre de dos — montrer un dos à
 * la place d'une carte révélée serait un mensonge.
 */
import { useMemo } from 'react';
import type { PublicCardView, SeatSummary } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { CardBack } from './CardBack.js';
import { scryfallImage } from '../lib/cards.js';

/** Une carte de l'éventail, en pixels de monde. */
const CARD_W = 48;
const CARD_H = 67;
/** Recouvrement : on ne voit que la tranche gauche, sauf la dernière. */
const OVERLAP = 30;
/** Au-delà, l'éventail dirait la longueur plutôt que le compte. */
const MAX_SLOTS = 10;

/** Ce que l'éventail occupe au-dessus du panneau, marge comprise. */
export const OPPONENT_HAND_HEIGHT = CARD_H + 10;

export function OpponentHand({ seat }: { seat: SeatSummary }): React.ReactElement | null {
  /*
   * Le compte vient de **`zoneCounts`**, pas de `seat.handCount`.
   *
   * Le second vit dans le resume du siege, qui n'est reemis qu'a certains
   * moments : une pioche ne le met pas a jour. On a vu le cas exact — cinq
   * cartes connues dans la main d'un adversaire et un `handCount` a zero, donc
   * aucun eventail rendu. `zoneCounts` est tenu a jour par `ZONE_COUNT`, a
   * chaque mouvement.
   */
  const handCount = useGame((s) => s.zoneCounts.get(`${seat.id}|HAND`) ?? 0);
  /*
   * Le sélecteur rend la Map, pas un tableau dérivé. Un sélecteur zustand qui
   * construit un nouveau tableau à chaque appel n'est jamais égal à lui-même :
   * le composant se re-rend, le sélecteur reconstruit, et React coupe au bout
   * de cinquante passes (erreur #185) — la page meurt avant même d'avoir ouvert
   * son socket. La dérivation se fait donc après, figée par `useMemo`.
   */
  const cards = useGame((s) => s.cards);
  const hoverPreview = useGame((s) => s.hoverPreview);

  const slots = useMemo(() => {
    const known = [...cards.values()]
      .filter(
        (c): c is PublicCardView =>
          c.zone.seat === seat.id && c.zone.kind === 'HAND' && c.faceDown === false,
      )
      .sort((a, b) => a.sortIndex - b.sortIndex);
    const total = Math.max(known.length, Math.min(MAX_SLOTS, handCount));
    return Array.from({ length: total }, (_, i) => known[i] ?? null);
  }, [cards, seat.id, handCount]);

  if (handCount <= 0 || slots.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute flex items-end gap-2"
      data-test="opponent-hand"
      style={{ left: 8, top: -OPPONENT_HAND_HEIGHT }}
      title={`${handCount} carte(s) en main`}
    >
      <span className="flex">
        {slots.map((known, i) => (
          <span
            key={known?.id ?? `dos-${i}`}
            /*
              Seules les cartes **montrées** captent le pointeur : l'éventail
              est autrement transparent aux gestes, et un dos n'a rien à
              prévisualiser — le client n'en connaît pas l'identité, il n'y a
              rien à agrandir.
            */
            className={`block overflow-hidden rounded-[3px] ring-1 ${
              known ? 'pointer-events-auto ring-violet-400/80' : 'ring-black/40'
            }`}
            style={{ width: CARD_W, height: CARD_H, marginLeft: i === 0 ? 0 : -OVERLAP }}
            title={known ? 'Carte montrée' : undefined}
            data-test={known ? 'revealed-hand-card' : undefined}
            /*
              L'aperçu passe par le chemin « impression », alors même qu'il
              existe ici un objet de partie : désigner la carte d'un adversaire
              comme « carte survolée » la donnerait pour cible aux raccourcis
              contextuels (jouer, engager, envoyer au cimetière). On veut la
              lire, pas la manipuler.
            */
            onPointerEnter={known ? () => hoverPreview(known.scryfallId) : undefined}
            onPointerLeave={known ? () => hoverPreview(null) : undefined}
          >
            {known ? (
              <img
                alt=""
                className="block h-full w-full object-cover"
                /* Image du CDN Scryfall, comme partout : jamais via notre serveur. */
                src={scryfallImage(known.scryfallId, 'small')}
              />
            ) : (
              <CardBack url={seat.cardBackUrl} version="small" />
            )}
          </span>
        ))}
      </span>
      <span className="rounded bg-slate-950/85 px-2 py-1 text-[18px] font-bold leading-none text-slate-100 ring-1 ring-white/20">
        {handCount}
      </span>
    </div>
  );
}
