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
 * **Ce qu'il dit.** Une place par carte, sans exception : un dos pour ce qu'on
 * ignore, la carte elle-même pour ce qu'on nous a montré. C'est ce qu'il se
 * passe à une vraie table — on retourne une carte, elle reste dans la main, et
 * tout le monde la voit jusqu'à ce qu'elle reparte.
 *
 * **Toutes** les cartes, donc, et non un échantillon suivi d'un compte : une
 * main épaisse *se voit*, c'est la première chose qu'on lit chez un adversaire,
 * et dix dos immuables ne distinguaient pas une main de onze d'une main de
 * trente. Ce qui s'adapte, ce n'est pas le nombre de places, c'est le
 * recouvrement — exactement comme une vraie main, qu'on serre à mesure qu'elle
 * grossit plutôt que de l'étaler sur trois fois la largeur. Voir `handFanStep`
 * pour la règle et ses bornes.
 */
import { useMemo } from 'react';
import type { PublicCardView, SeatSummary } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { CardBack } from './CardBack.js';
import { scryfallImage } from '../lib/cards.js';
import { localizedCard, useLocalizationTick } from '../lib/cardLocalization.js';
import { resolveCardImage } from '../lib/i18n/index.js';
import { useLanguage } from '../store/prefs.js';
import { PANEL_WIDTH } from './SeatPanel.js';

/** Une carte de l'éventail, en pixels de monde. */
const CARD_W = 48;
const CARD_H = 67;
/**
 * Pas nominal : l'écart entre deux cartes voisines tant que la main tient dans
 * la largeur disponible. On ne voit alors que 18 px de chaque carte, sauf la
 * dernière — la proportion d'un éventail tenu en main.
 */
export const FAN_STEP = 18;
/**
 * Pas minimal. En dessous, les tranches sont si fines que les dos se fondent en
 * un aplat uni : l'éventail ne dit plus qu'une couleur, et l'œil n'y compte
 * plus rien. On préfère déborder de quelques pixels que mentir sur la densité.
 */
export const FAN_STEP_MIN = 6;
/** Décalage de l'éventail par rapport au bord gauche du panneau. */
const FAN_LEFT = 8;
/** Place réservée à la pastille du compte, gouttière comprise. */
const BADGE_ROOM = 60;
/**
 * Largeur maximale de l'éventail : ce que le panneau laisse une fois retirés le
 * décalage de gauche et la pastille. C'est le panneau qui borne l'éventail, et
 * non l'inverse — sans cela une main de trente cartes irait recouvrir le siège
 * voisin, le décor, ou l'interface qui traîne à côté.
 */
export const FAN_MAX_W = PANEL_WIDTH - FAN_LEFT - BADGE_ROOM;

/** Ce que l'éventail occupe au-dessus du panneau, marge comprise. */
export const OPPONENT_HAND_HEIGHT = CARD_H + 10;

/**
 * Le pas entre deux cartes de l'éventail, pour une main de `count` cartes.
 *
 * Tant que la main tient dans `FAN_MAX_W` au pas nominal — jusqu'à 64 cartes —
 * rien ne bouge : une main ordinaire garde exactement l'allure qu'elle avait.
 * Au-delà, le pas se resserre juste assez pour rentrer, et se plante à
 * `FAN_STEP_MIN`.
 *
 * **Le cas extrême assumé.** Le pas minimal est atteint à 192 cartes ; passé ce
 * seuil l'éventail déborde, de deux pixels d'abord, puis de six par carte. On
 * l'accepte : une main de 192 cartes n'existe pas — un deck de Commander en
 * compte 100 en tout, et cette main-là rentre encore pile (pas de 11,6 px). Le
 * jour où cela arriverait, la pastille donnerait toujours le compte exact.
 */
export function handFanStep(count: number): number {
  /* Une carte seule n'a pas de voisine : le pas ne veut rien dire, et la
     division par `count - 1` serait un infini. */
  if (count <= 1) return FAN_STEP;
  const room = (FAN_MAX_W - CARD_W) / (count - 1);
  return Math.max(FAN_STEP_MIN, Math.min(FAN_STEP, room));
}

/** La largeur totale qu'occupe un éventail de `count` cartes, en px de monde. */
export function handFanWidth(count: number): number {
  if (count <= 0) return 0;
  return CARD_W + (count - 1) * handFanStep(count);
}

/**
 * Les places de l'éventail : une par carte annoncée.
 *
 * Les cartes connues viennent en premier, le reste est complété par des dos.
 * Si le client connaît plus de cartes que le compte n'en annonce — un décalage
 * transitoire entre deux messages — on rend toutes les connues quand même :
 * montrer un dos à la place d'une carte révélée serait un mensonge.
 */
export function handFanSlots<T>(known: readonly T[], handCount: number): (T | null)[] {
  const total = Math.max(known.length, handCount);
  return Array.from({ length: total }, (_, i) => known[i] ?? null);
}

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
  /*
   * Seules les cartes **montrées** ont une illustration à résoudre : un dos
   * n'a pas d'identité connue de ce client, et rien ne part le concernant.
   */
  useLocalizationTick();
  const language = useLanguage();

  const slots = useMemo(() => {
    const known = [...cards.values()]
      .filter(
        (c): c is PublicCardView =>
          c.zone.seat === seat.id && c.zone.kind === 'HAND' && c.faceDown === false,
      )
      .sort((a, b) => a.sortIndex - b.sortIndex);
    return handFanSlots(known, handCount);
  }, [cards, seat.id, handCount]);

  if (handCount <= 0 || slots.length === 0) return null;

  /* Le pas se calcule sur le nombre de places réellement rendues, pas sur le
     compte annoncé : c'est la largeur de ce qu'on dessine qui doit tenir. */
  const step = handFanStep(slots.length);

  return (
    <div
      className="pointer-events-none absolute flex items-end gap-2"
      data-test="opponent-hand"
      style={{ left: FAN_LEFT, top: -OPPONENT_HAND_HEIGHT }}
      /* Sous fort recouvrement, la tranche visible ne se compte plus à l'œil :
         l'infobulle reste la seule façon d'obtenir le nombre exact sans lire la
         pastille. On la garde pour cela. */
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
            className={`block shrink-0 overflow-hidden rounded-[3px] ring-1 ${
              known ? 'pointer-events-auto ring-violet-400/80' : 'ring-black/40'
            }`}
            style={{ width: CARD_W, height: CARD_H, marginLeft: i === 0 ? 0 : step - CARD_W }}
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
                /* URL Scryfall, comme partout : jamais via notre serveur. Sans
                   résolution française, le motif du CDN reprend la main et
                   l'éventail montre exactement ce qu'il montrait avant. */
                src={
                  resolveCardImage({
                    card: { scryfallId: known.scryfallId },
                    localized: localizedCard(known.scryfallId, language),
                    language,
                    version: 'small',
                  }).url ?? scryfallImage(known.scryfallId, 'small')
                }
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
