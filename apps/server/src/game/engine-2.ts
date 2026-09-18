/**
 * Suite du moteur : bibliothèque, regards, révélations, vie, tour, social.
 * Même commutateur que `engine.ts`, séparé pour garder des fichiers lisibles.
 */
import { ulid } from 'ulid';
import type { Counter, Intent, LookSummary, ObjectId, PublicCardView, SeatId, ZoneRef } from '@mtg/shared';
import { IntentError } from './errors.js';
import { projectCard, toLookView, toPublicView } from './projection.js';
import {
  canSeeIdentity,
  getZone,
  reindexZone,
  removeFromZone,
  type CardData,
  type GameObjectState,
  type GameState,
  type SeatState,
} from './state.js';
import type { RandomSource } from './random.js';
import {
  ALL,
  assertNotLocked,
  assertZoneNotLocked,
  cardUpdate,
  detachDependents,
  moveEmission,
  namedBatch,
  objectOf,
  publicName,
  relocate,
  shuffleZone,
  zoneCount,
  zoneLabel,
  type Emission,
  type EngineDeps,
  type IntentResult,
} from './engine.js';

/**
 * Résout une liste de sièges destinataires.
 *
 * Nommer un siège qui n'existe pas n'est pas anodin : le droit accordé survit
 * dans `knownTo` ou `handRevealedTo`, et le prochain joueur qui s'assoit à cet
 * index en hérite. Une révélation à un fantôme est donc refusée.
 */
function resolveSeats(state: GameState, toSeats: SeatId[] | 'ALL'): SeatId[] {
  if (toSeats === 'ALL') return [...state.seats.keys()];
  for (const id of toSeats) {
    if (!state.seats.has(id)) {
      throw new IntentError('ERR_NOT_SEATED', `Le siège ${id} n'est pas à la table.`);
    }
  }
  return [...new Set(toSeats)];
}

function requireOwnZone(zone: ZoneRef, seatId: SeatId): void {
  if (zone.seat !== seatId) {
    throw new IntentError('ERR_NOT_YOURS', "Cette zone n'est pas la tienne.");
  }
}

function makeObject(
  state: GameState,
  seatId: SeatId,
  card: CardData,
  opts: { x?: number; y?: number; tapped?: boolean; counters?: Counter[]; copyOf?: ObjectId },
): GameObjectState {
  const obj: GameObjectState = {
    id: ulid(),
    kind: 'TOKEN',
    owner: seatId,
    controller: seatId,
    zone: { seat: seatId, kind: 'BATTLEFIELD' },
    card,
    faceDown: false,
    flipped: false,
    tapped: opts.tapped ?? false,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    rotation: 0,
    counters: (opts.counters ?? []).map((c) => ({ ...c })),
    isFoil: false,
    sortIndex: 0,
    knownTo: new Set(state.seats.keys()),
  };
  if (opts.copyOf) obj.copyOf = opts.copyOf;
  state.objects.set(obj.id, obj);
  const list = getZone(state, obj.zone);
  // Le rang dans la zone, sinon tous les jetons créés naissent avec sortIndex 0
  // et le rang publié ne correspond plus à la zone.
  obj.sortIndex = list.length;
  list.push(obj.id);
  return obj;
}

/** Décalage entre deux objets posés d'un même geste, en unités de monde. */
const FAN_STEP_X = 26;
const FAN_STEP_Y = 18;

/**
 * Première place libre à partir d'un point, en cascade.
 *
 * « Libre » veut dire : aucun objet du champ de bataille de ce siège à moins
 * d'un demi-pas. On borne la recherche — au-delà, mieux vaut empiler que
 * projeter un jeton à l'autre bout de la zone.
 */
function freeSpot(state: GameState, seatId: SeatId, x: number, y: number): { x: number; y: number } {
  const occupied = [...state.objects.values()].filter(
    (o) => o.zone.kind === 'BATTLEFIELD' && o.zone.seat === seatId,
  );
  const taken = (px: number, py: number): boolean =>
    occupied.some((o) => Math.abs(o.x - px) < FAN_STEP_X / 2 && Math.abs(o.y - py) < FAN_STEP_Y / 2);

  let spot = { x, y };
  for (let step = 0; step < 24 && taken(spot.x, spot.y); step++) {
    spot = { x: x + (step + 1) * FAN_STEP_X, y: y + (step + 1) * FAN_STEP_Y };
  }
  return spot;
}

export function applyIntentPart2(
  state: GameState,
  seat: SeatState,
  intent: Intent,
  rng: RandomSource,
  deps: EngineDeps,
): IntentResult {
  const seatId = seat.id;
  const who = seat.displayName;

  switch (intent.type) {
    case 'CREATE_TOKEN': {
      let card = deps.cardData;
      let copyOf: ObjectId | undefined;

      if (intent.copyOf) {
        const source = objectOf(state, intent.copyOf);
        // On ne copie pas ce qu'on n'a pas le droit de voir.
        if (!canSeeIdentity(source, seatId)) {
          throw new IntentError('ERR_NOT_VISIBLE', 'Cette carte ne t’est pas visible.');
        }
        // « copie un permanent visible du champ de bataille » (§6.3) : copier une
        // carte d'une main révélée à soi seul la publierait à toute la table.
        if (source.zone.kind !== 'BATTLEFIELD') {
          throw new IntentError('ERR_BAD_ZONE', 'On ne copie qu’un permanent du champ de bataille.');
        }
        card = source.card;
        copyOf = source.id;
      }
      if (!card) throw new IntentError('ERR_UNKNOWN_OBJECT', 'Carte de jeton introuvable.');

      const count = Math.min(intent.count ?? 1, 64);
      const created: GameObjectState[] = [];

      // Un jeton posé exactement sur un autre disparaît sous lui : on cherche
      // la première place libre en cascade à partir du point demandé. Cela vaut
      // aussi pour des créations successives au même endroit — cliquer trois
      // fois « Treasure » doit donner trois jetons visibles, pas un seul.
      const base = freeSpot(state, seatId, intent.x ?? 0, intent.y ?? 0);

      for (let i = 0; i < count; i++) {
        created.push(
          makeObject(state, seatId, card, {
            // Les exemplaires multiples sont décalés pour rester distinguables.
            // 12 px ne suffisaient pas : une carte fait 83 px de large à
            // l'échelle du champ, ils se recouvraient presque entièrement.
            ...(intent.x !== undefined ? { x: base.x + i * FAN_STEP_X } : {}),
            ...(intent.y !== undefined ? { y: base.y + i * FAN_STEP_Y } : {}),
            ...(intent.tapped !== undefined ? { tapped: intent.tapped } : {}),
            ...(intent.counters ? { counters: intent.counters } : {}),
            ...(copyOf ? { copyOf } : {}),
          }),
        );
      }

      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'TOKENS_CREATED', cards: created.map(toPublicView) }),
            log: {
              text: count > 1 ? `${who} a créé ${count} jetons ${card.name}` : `${who} a créé un jeton ${card.name}`,
              cardIds: created.map((o) => o.id),
            },
          },
        ],
      };
    }

    case 'DESTROY_TOKEN': {
      const doomed: GameObjectState[] = [];
      const seen = new Set<ObjectId>();
      for (const id of intent.cardIds) {
        const obj = state.objects.get(id);
        // Un identifiant répété désignerait deux fois le même jeton : il serait
        // compté deux fois dans la ligne de journal, et nommé deux fois.
        if (!obj || obj.kind !== 'TOKEN' || seen.has(id)) continue;
        seen.add(id);
        doomed.push(obj);
      }
      if (doomed.length === 0) return { emissions: [] };

      /*
       * Dire *quoi*, pas seulement *combien*.
       *
       * « 3 jetons de Valdragon ont été détruits » annonçait une action de masse
       * sans dire sur quoi elle portait, alors que le cas singulier voisin
       * nommait — même incohérence que le « a tout dégagé » corrigé dans
       * `engine.ts`. Ces jetons étaient posés au vu de tous : un jeton qui
       * quitte le champ de bataille cesse d'exister (cf. `MOVE_CARD`), donc ils
       * y étaient tous, et les nommer n'apprend rien que la table n'ait déjà lu.
       * `namedBatch` reste la règle commune — il tait les jetons face cachée et
       * replie les listes au-delà du seuil.
       *
       * **Assemblé avant la suppression** : `namedBatch` interroge l'objet et sa
       * zone, et un objet effacé de `state` n'a plus rien à répondre.
       */
      const named = namedBatch(doomed, state, 'BATTLEFIELD');

      const removed: ObjectId[] = [];
      for (const obj of doomed) {
        removeFromZone(state, obj.zone, obj.id);
        state.objects.delete(obj.id);
        removed.push(obj.id);
      }

      const detached = removed.flatMap((id) => detachDependents(state, id));
      return {
        emissions: [
          ...detached,
          {
            audience: ALL,
            build: () => ({ type: 'TOKENS_DESTROYED', cardIds: removed }),
            log: {
              text: named
                ? removed.length > 1
                  ? `${removed.length} jetons de ${who} ont été détruits : ${named.names}`
                  : `le jeton ${named.names} de ${who} a été détruit`
                : // Hors d'atteinte en pratique — `TOKENS_CREATED` publie le jeton à
                  // toute la table, donc `publicName` le nomme même retourné —, mais
                  // une ligne de journal ne se construit jamais sur une hypothèse de
                  // visibilité. Le compte est ce qui se dit sans mentir.
                  removed.length > 1
                  ? `${removed.length} jetons de ${who} ont été détruits`
                  : `un jeton de ${who} a été détruit`,
              // Volontairement vides, et c'est la seule réponse juste : les objets
              // viennent d'être effacés de `state`. Une ancre de survol pointerait
              // sur un mort, qu'aucun client ne peut plus afficher ni surligner.
              cardIds: [],
            },
          },
        ],
      };
    }

    case 'SHUFFLE': {
      requireOwnZone(intent.zone, seatId);
      assertZoneNotLocked(state, intent.zone);
      shuffleZone(state, intent.zone, rng);
      const count = getZone(state, intent.zone).length;
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'ZONE_SHUFFLED', zone: intent.zone, count }),
            log: { text: `${who} a mélangé sa ${zoneLabel(intent.zone)}`, cardIds: [] },
          },
        ],
      };
    }

    case 'LOOK': {
      requireOwnZone(intent.zone, seatId);
      if ([...state.pendingLooks.values()].some((l) => l.seat === seatId)) {
        throw new IntentError('ERR_LOOK_PENDING', 'Termine d’abord la consultation en cours.');
      }

      const list = getZone(state, intent.zone);
      // Ouvrir une session vide bloquerait toute consultation ultérieure du
      // siège jusqu'à un RESOLVE_LOOK qu'aucune interface ne proposerait.
      if (list.length === 0) throw new IntentError('ERR_BAD_ZONE', 'Cette zone est vide.');

      const wanted = intent.count === 'ALL' ? list.length : Math.min(intent.count, list.length);
      const ids = list.slice(0, wanted);

      // Une recherche voit toute la zone, mais dans un ordre brassé : chercher une
      // carte ne doit pas revenir à connaître l'ordre de sa propre bibliothèque.
      const shown = intent.mode === 'SEARCH' ? rng.shuffle([...ids]) : [...ids];
      const isReveal = intent.mode === 'REVEAL';
      if (isReveal) {
        for (const id of shown) {
          const obj = state.objects.get(id);
          if (obj) {
            for (const s of state.seats.keys()) obj.knownTo.add(s);
          }
        }
      } else {
        for (const id of shown) state.objects.get(id)?.knownTo.add(seatId);
      }

      const lookId = ulid();
      state.pendingLooks.set(lookId, {
        id: lookId,
        seat: seatId,
        zone: intent.zone,
        mode: intent.mode,
        cardIds: [...ids],
        shownIds: shown,
        startedAt: Date.now(),
      });

      // `toLookView` remplace le rang réel par le rang montré : sur un SEARCH le
      // `sortIndex` trahirait l'ordre que le brassage vient justement de masquer.
      const cards: PublicCardView[] = shown
        .map((id) => state.objects.get(id))
        .filter((o): o is GameObjectState => o !== undefined)
        .map((o, rank) => toLookView(o, rank));

      const revealNames = isReveal
        ? shown
            .map((id) => state.objects.get(id)?.card.name)
            .filter((n): n is string => Boolean(n))
        : [];

      const startLogText = isReveal
        ? `${who} a révélé les ${ids.length} carte${ids.length > 1 ? 's' : ''} du dessus de sa ${zoneLabel(intent.zone)} : ${revealNames.join(', ')}`
        : intent.mode === 'SEARCH'
          ? `${who} fouille sa ${zoneLabel(intent.zone)}`
          : `${who} fait un ${intent.mode.toLowerCase()} de ${ids.length}`;

      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({
              type: 'LOOK_STARTED',
              lookId,
              seat: seatId,
              zone: intent.zone,
              count: ids.length,
              mode: intent.mode,
              ...(isReveal ? { cards } : {}),
            }),
            log: {
              text: startLogText,
              cardIds: isReveal ? [...ids] : [],
            },
          },
          {
            audience: { kind: 'SEAT', seat: seatId },
            build: () => ({ type: 'LOOK_RESULT', lookId, mode: intent.mode, cards }),
          },
        ],
      };
    }

    case 'RESOLVE_LOOK': {
      const look = state.pendingLooks.get(intent.lookId);
      if (!look || look.seat !== seatId) {
        throw new IntentError('ERR_LOOK_PENDING', 'Consultation inconnue ou déjà close.');
      }

      const locked = new Set(look.cardIds);
      const destinations: Array<[ObjectId[], ZoneRef | 'TOP' | 'BOTTOM']> = [
        [intent.toHand ?? [], { seat: seatId, kind: 'HAND' }],
        [intent.toGraveyard ?? [], { seat: seatId, kind: 'GRAVEYARD' }],
        [intent.toExile ?? [], { seat: seatId, kind: 'EXILE' }],
        [intent.toBattlefield ?? [], { seat: seatId, kind: 'BATTLEFIELD' }],
        [intent.toSideboard ?? [], { seat: seatId, kind: 'SIDEBOARD' }],
        [intent.top, 'TOP'],
        [intent.bottom, 'BOTTOM'],
      ];

      for (const [ids] of destinations) {
        for (const id of ids) {
          if (!locked.has(id)) throw new IntentError('ERR_UNKNOWN_OBJECT', 'Carte hors de la consultation.');
        }
      }

      // La session est close avant les déplacements, sinon le verrou les refuse.
      state.pendingLooks.delete(intent.lookId);

      const emissions: Emission[] = [];
      const summary: LookSummary = {
        mode: look.mode,
        count: look.cardIds.length,
        toTop: intent.top.length,
        toBottom: intent.bottom.length,
        toHand: intent.toHand?.length ?? 0,
        toGraveyard: intent.toGraveyard?.length ?? 0,
        toExile: intent.toExile?.length ?? 0,
        toBattlefield: intent.toBattlefield?.length ?? 0,
        toSideboard: intent.toSideboard?.length ?? 0,
        shuffled: intent.shuffleAfter === true || look.mode === 'SEARCH',
      };

      /*
       * Ce qu'une consultation dépose ailleurs qu'en bibliothèque, groupé par
       * destination. Le surveil vers le cimetière passe par ici et non par
       * `MILL` : c'est le chemin qu'emprunte réellement l'interface, et le
       * taire aurait laissé le défaut en place là où on le voit le plus.
       * Groupé, parce qu'une liste unique ne dirait pas laquelle va où — et le
       * `(2 dessus, 1 dessous)` de la phrase, lui, reste muet sur les noms des
       * cartes remises en bibliothèque, qui redeviennent secrètes.
       */
      const surfaced = new Map<ZoneRef['kind'], GameObjectState[]>();

      for (const [ids, target] of destinations) {
        if (target === 'TOP' || target === 'BOTTOM') continue;
        for (const id of ids) {
          const obj = state.objects.get(id);
          if (!obj) continue;
          const bucket = surfaced.get(target.kind) ?? [];
          bucket.push(obj);
          surfaced.set(target.kind, bucket);
          // Exiler face cachée depuis une fouille : la carte vient de la
          // bibliothèque, donc elle arriverait face visible par défaut (c'est
          // la règle de `relocate`). `exileFaceDown` est la demande explicite,
          // et elle ne porte que sur l'exil.
          const opts =
            target.kind === 'EXILE' && intent.exileFaceDown === true ? { faceDown: true } : {};
          const from = relocate(state, obj, target, 'TOP', rng, opts);
          emissions.push(moveEmission(state, obj, from));
        }
      }

      // Remise en place : le dessus dans l'ordre choisi, puis le dessous.
      const library = getZone(state, look.zone);
      for (const id of [...intent.top].reverse()) {
        const idx = library.indexOf(id);
        if (idx >= 0) library.splice(idx, 1);
        library.unshift(id);
      }
      for (const id of intent.bottom) {
        const idx = library.indexOf(id);
        if (idx >= 0) library.splice(idx, 1);
        library.push(id);
        // Une carte renvoyée au fond n'est plus connue de personne.
        state.objects.get(id)?.knownTo.clear();
      }

      reindexZone(state, library);
      if (summary.shuffled) shuffleZone(state, look.zone, rng);

      // Les noms sont relevés maintenant : les cartes sont arrivées, et c'est
      // l'arrivée qui décide de ce que la table a le droit de lire. Celles qui
      // sont parties en main ou en réserve n'en sortiront pas — `namedBatch`
      // les écarte, et un lot entièrement caché ne produit aucun fragment.
      const fragments: string[] = [];
      const anchors: ObjectId[] = [];
      for (const [kind, objs] of surfaced) {
        const named = namedBatch(objs, state, kind);
        if (named) {
          fragments.push(`${named.names} vers ${zoneLabel({ seat: seatId, kind })}`);
          anchors.push(...named.cardIds);
        } else if (kind === 'HAND') {
          // Si les cartes étaient révélées publiquement (ex: mode REVEAL), les nommer !
          const allKnown = objs.every((o) => [...state.seats.keys()].every((s) => o.knownTo.has(s)));
          if (look.mode === 'REVEAL' || allKnown) {
            const names = objs.map((o) => o.card.name).join(', ');
            fragments.push(`${names} vers main`);
            anchors.push(...objs.map((o) => o.id));
          } else {
            const count = objs.length;
            fragments.push(`${count} carte${count > 1 ? 's' : ''} vers main`);
          }
        } else if (kind === 'SIDEBOARD') {
          const count = objs.length;
          fragments.push(`${count} carte${count > 1 ? 's' : ''} vers réserve`);
        } else if (kind === 'EXILE' && intent.exileFaceDown) {
          const count = objs.length;
          fragments.push(`${count} carte${count > 1 ? 's' : ''} face cachée vers exil`);
        }
      }

      const actionName =
        look.mode === 'SEARCH'
          ? 'sa fouille de bibliothèque'
          : look.mode === 'REVEAL'
            ? 'sa révélation'
            : look.mode === 'SCRY'
              ? 'son scry'
              : look.mode === 'SURVEIL'
                ? 'son surveil'
                : 'sa consultation';

      const countsPart = `${summary.toTop} dessus, ${summary.toBottom} dessous`;
      const shufflePart = summary.shuffled ? 'bibliothèque mélangée' : 'sans mélanger';

      emissions.push({
        audience: ALL,
        build: () => ({ type: 'LOOK_RESOLVED', lookId: look.id, seat: seatId, summary }),
        log: {
          text:
            fragments.length > 0
              ? `${who} a terminé ${actionName} (${countsPart}, ${shufflePart}) — ${fragments.join(' ; ')}`
              : `${who} a terminé ${actionName} (${countsPart}, ${shufflePart})`,
          cardIds: anchors,
        },
      });
      emissions.push(zoneCount(state, look.zone));
      return { emissions };
    }

    case 'REORDER_TOP': {
      requireOwnZone(intent.zone, seatId);
      assertZoneNotLocked(state, intent.zone);
      const list = getZone(state, intent.zone);
      const wanted = intent.order.filter((id) => list.includes(id));
      for (const id of [...wanted].reverse()) {
        const idx = list.indexOf(id);
        list.splice(idx, 1);
        list.unshift(id);
      }
      reindexZone(state, list);
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'ZONE_COUNT', zone: intent.zone, count: list.length }),
            log: { text: `${who} a réordonné le dessus de sa ${zoneLabel(intent.zone)}`, cardIds: [] },
          },
        ],
      };
    }

    case 'DRAW': {
      const library: ZoneRef = { seat: seatId, kind: 'LIBRARY' };
      const hand: ZoneRef = { seat: seatId, kind: 'HAND' };
      assertZoneNotLocked(state, library);
      const list = getZone(state, library);
      const drawn = list.slice(0, Math.min(intent.count, list.length));
      if (drawn.length === 0) {
        throw new IntentError('ERR_BAD_ZONE', 'Bibliothèque vide.');
      }

      const emissions: Emission[] = [];
      for (const id of drawn) {
        const obj = state.objects.get(id);
        if (!obj) continue;
        const from = relocate(state, obj, hand, 'BOTTOM', rng, {});
        emissions.push(moveEmission(state, obj, from));
      }
      emissions[0]!.log = {
        text: `${who} a pioché ${drawn.length} carte(s)`,
        cardIds: [],
      };
      emissions.push(zoneCount(state, library), zoneCount(state, hand));
      return { emissions };
    }

    case 'MULLIGAN': {
      const library: ZoneRef = { seat: seatId, kind: 'LIBRARY' };
      const hand: ZoneRef = { seat: seatId, kind: 'HAND' };
      assertZoneNotLocked(state, library);
      assertZoneNotLocked(state, hand);

      const emissions: Emission[] = [];
      // Les cartes rendues doivent disparaître de l'écran des autres sièges :
      // sans event, leur main garderait les anciennes cartes indéfiniment.
      for (const id of [...getZone(state, hand)]) {
        const obj = state.objects.get(id);
        if (!obj) continue;
        const from = relocate(state, obj, library, 'TOP', rng, {});
        emissions.push(moveEmission(state, obj, from));
      }
      shuffleZone(state, library, rng);

      const list = getZone(state, library);
      // Compté avant la nouvelle main : `list` est la liste vivante de la zone
      // et se vide au fil des pioches qui suivent.
      const shuffledCount = list.length;
      for (const id of list.slice(0, Math.min(7, list.length))) {
        const obj = state.objects.get(id);
        if (!obj) continue;
        const from = relocate(state, obj, hand, 'BOTTOM', rng, {});
        emissions.push(moveEmission(state, obj, from));
      }

      const counter = (seat.playerCounters.get('mulligans') ?? 0) + 1;
      seat.playerCounters.set('mulligans', counter);
      emissions.unshift({
        audience: ALL,
        build: () => ({ type: 'ZONE_SHUFFLED', zone: library, count: shuffledCount }),
        log: {
          text: `${who} a pris un mulligan (${counter}) — ${counter} carte(s) à remettre dessous`,
          cardIds: [],
        },
      });
      emissions.push(zoneCount(state, library), zoneCount(state, hand), {
        audience: ALL,
        build: () => ({ type: 'PLAYER_COUNTER_CHANGED', seat: seatId, kind: 'mulligans', value: counter }),
      });
      return { emissions };
    }

    case 'MILL':
    case 'EXILE_TOP': {
      const library: ZoneRef = { seat: seatId, kind: 'LIBRARY' };
      const target: ZoneRef = {
        seat: seatId,
        kind: intent.type === 'MILL' ? 'GRAVEYARD' : 'EXILE',
      };
      assertZoneNotLocked(state, library);
      const list = getZone(state, library);
      const taken = list.slice(0, Math.min(intent.count, list.length));
      if (taken.length === 0) throw new IntentError('ERR_BAD_ZONE', 'Bibliothèque vide.');

      const faceDown = intent.type === 'EXILE_TOP' && intent.faceDown === true;
      const emissions: Emission[] = [];
      const landed: GameObjectState[] = [];
      /*
       * **`taken` est déjà dans l'ordre où les cartes quittent la bibliothèque**
       * — `slice(0, n)` depuis le rang 0, qui est le dessus (cf. `ORDERED_ZONES`)
       * — et chacune est posée à son tour sur le dessus de la destination. La
       * dernière meulée finit donc au rang 0 : c'est le geste physique, carte
       * après carte, et non un lot retourné d'un bloc.
       */
      for (const id of taken) {
        const obj = state.objects.get(id);
        if (!obj) continue;
        const from = relocate(state, obj, target, 'TOP', rng, { faceDown });
        emissions.push(moveEmission(state, obj, from));
        landed.push(obj);
      }
      // Une carte meulée tombe au vu de tous : la taire n'informait personne,
      // puisque tout le monde la lit sur la table à l'instant même. Un exil
      // face cachée, lui, retombe sur le compte — `namedBatch` refuse de le
      // nommer, sans que ce cas ait à être écrit ici.
      const named = namedBatch(landed, state, target.kind);
      emissions[0]!.log = named
        ? {
            text:
              intent.type === 'MILL'
                ? `${who} a meulé ${named.names}`
                : `${who} a exilé du dessus ${named.names}`,
            cardIds: named.cardIds,
          }
        : {
            text:
              intent.type === 'MILL'
                ? `${who} met ${taken.length} carte(s) de sa bibliothèque au cimetière`
                : `${who} a exilé ${taken.length} carte(s) du dessus${faceDown ? ' face cachée' : ''}`,
            cardIds: [],
          };
      emissions.push(zoneCount(state, library), zoneCount(state, target));
      return { emissions };
    }

    case 'RANDOM_DISCARD': {
      const hand = getZone(state, { seat: seatId, kind: 'HAND' });
      const graveyard: ZoneRef = { seat: seatId, kind: 'GRAVEYARD' };
      if (hand.length === 0) throw new IntentError('ERR_BAD_ZONE', 'Main vide.');

      // Le tirage est fait ici, pas côté client : personne ne choisit sa défausse.
      const pool = [...hand];
      // Le nombre est figé **avant** la boucle : `pool` rétrécit à chaque tirage,
      // et une borne recalculée à chaque tour la croisait à mi-chemin — « défausse
      // ta main » de sept cartes n'en défaussait que quatre.
      const wanted = Math.min(intent.count, pool.length);
      const picked: ObjectId[] = [];
      for (let i = 0; i < wanted; i++) {
        picked.push(...pool.splice(rng.below(pool.length), 1));
      }

      const emissions: Emission[] = [];
      const landed: GameObjectState[] = [];
      for (const id of picked) {
        const obj = state.objects.get(id);
        if (!obj) continue;
        const from = relocate(state, obj, graveyard, 'TOP', rng, {});
        emissions.push(moveEmission(state, obj, from));
        landed.push(obj);
      }
      // La carte défaussée arrive au cimetière, donc publique : la nommer est
      // correct. Mais la liste était assemblée à la main, sans seuil — « défausse
      // ta main » à sept cartes écrivait sept noms d'affilée et poussait le reste
      // de la partie hors du journal. `namedBatch` est la règle commune : elle
      // replie au-delà du seuil tout en gardant toutes les ancres.
      const named = namedBatch(landed, state, 'GRAVEYARD');
      emissions[0]!.log = named
        ? { text: `${who} a défaussé au hasard ${named.names}`, cardIds: named.cardIds }
        : // Inatteignable en pratique (le cimetière est public), mais une ligne de
          // journal ne se construit jamais sur une hypothèse de visibilité.
          { text: `${who} a défaussé au hasard ${landed.length} carte(s)`, cardIds: [] };
      emissions.push(zoneCount(state, { seat: seatId, kind: 'HAND' }), zoneCount(state, graveyard));
      return { emissions };
    }

    case 'SCOOP': {
      const library: ZoneRef = { seat: seatId, kind: 'LIBRARY' };
      assertZoneNotLocked(state, library);
      const emissions: Emission[] = [];
      const destroyed: ObjectId[] = [];

      for (const obj of [...state.objects.values()]) {
        if (obj.owner !== seatId) continue;
        if (obj.zone.kind === 'LIBRARY' || obj.zone.kind === 'SIDEBOARD') continue;
        // La zone de commandement ne se range pas : le commandant y reste.
        if (obj.zone.kind === 'COMMAND') continue;

        if (obj.kind === 'TOKEN') {
          removeFromZone(state, obj.zone, obj.id);
          state.objects.delete(obj.id);
          destroyed.push(obj.id);
          // Un équipement d'un autre siège attaché au jeton reste sur la table :
          // il faut le détacher, sinon il pointe sur un objet effacé.
          emissions.push(...detachDependents(state, obj.id));
          continue;
        }
        // Un commandant ne se range pas dans la bibliothèque : il retourne en
        // zone de commandement, comme à une vraie table. `origin` a été figé au
        // chargement du deck, donc on le reconnaît même s'il traînait ailleurs.
        const destination: ZoneRef =
          obj.origin === 'COMMAND' ? { seat: seatId, kind: 'COMMAND' } : library;
        // Une carte face cachée garde son état en changeant de zone publique.
        // Un commandant rangé, lui, se repose face visible devant soi : c'est
        // le geste de la vraie table, et sa zone n'est pas un endroit où l'on
        // cache quoi que ce soit.
        const from = relocate(state, obj, destination, 'TOP', rng, { faceDown: false });
        emissions.push(...detachDependents(state, obj.id));
        // Sans CARD_MOVED, les autres tables garderaient à l'écran des cartes
        // qui ne sont plus nulle part.
        emissions.push(moveEmission(state, obj, from));
      }

      shuffleZone(state, library, rng);
      if (destroyed.length > 0) {
        emissions.push({ audience: ALL, build: () => ({ type: 'TOKENS_DESTROYED', cardIds: destroyed }) });
      }
      emissions.push({
        audience: ALL,
        build: () => ({ type: 'ZONE_SHUFFLED', zone: library, count: getZone(state, library).length }),
        log: { text: `${who} a rangé son jeu et mélangé`, cardIds: [] },
      });
      for (const kind of ['HAND', 'GRAVEYARD', 'EXILE', 'BATTLEFIELD', 'LIBRARY'] as const) {
        emissions.push(zoneCount(state, { seat: seatId, kind }));
      }
      return { emissions };
    }

    case 'SET_PRINTING': {
      const obj = objectOf(state, intent.cardId);
      assertNotLocked(state, obj.id);
      if (obj.owner !== seatId) {
        throw new IntentError('ERR_NOT_YOURS', 'On ne change que l’impression de ses cartes.');
      }
      if (!deps.cardData) throw new IntentError('ERR_UNKNOWN_OBJECT', 'Impression introuvable.');

      const previous = obj.card.name;
      // Changer d'impression ne change pas la carte : on refuse un autre nom.
      if (deps.cardData.name !== previous) {
        throw new IntentError('ERR_PAYLOAD', 'Cette impression correspond à une autre carte.');
      }
      obj.card = deps.cardData;
      if (intent.isFoil !== undefined) obj.isFoil = intent.isFoil;

      return {
        emissions: [
          {
            ...cardUpdate(obj),
            log: {
              text: `${who} a changé l’impression de ${publicName(obj, state)} (${deps.cardData.setCode.toUpperCase()})`,
              cardIds: [obj.id],
            },
          },
        ],
      };
    }

    case 'REVEAL': {
      const targets = resolveSeats(state, intent.toSeats);
      const emissions: Emission[] = [];
      const names: string[] = [];

      const publicAnchors: ObjectId[] = [];
      for (const id of intent.cardIds) {
        const obj = objectOf(state, id);
        assertNotLocked(state, id);
        if (obj.owner !== seatId && obj.controller !== seatId) {
          throw new IntentError('ERR_NOT_YOURS', 'On ne révèle que ses propres cartes.');
        }
        for (const s of targets) obj.knownTo.add(s);
        names.push(obj.card.name);
        // Le journal est public : il ne cite que les objets que tout le monde
        // a le droit de connaître, et jamais un objet de bibliothèque.
        //
        // `commit` applique désormais la même condition à **toutes** les lignes
        // (`ancresPubliables`, §5.4) : ce test-ci est donc redondant, et on le
        // garde tel quel. Il dit sur place ce que la révélation à des sièges
        // nommés a de particulier — l'ancre ne suit pas l'audience de l'event —,
        // et une garde de trop ne coûte rien là où une garde manquante fuit.
        if (canSeeIdentity(obj, seatId) && [...state.seats.keys()].every((x) => obj.knownTo.has(x))) {
          publicAnchors.push(id);
        }
        emissions.push({
          audience: { kind: 'SEATS', seats: targets },
          build: () => ({ type: 'CARD_REVEALED', card: toPublicView(obj), toSeats: targets }),
        });
        /*
         * **Le propriétaire doit l'apprendre aussi.**
         *
         * `CARD_REVEALED` ne va qu'aux destinataires : celui qui montre sa
         * carte ne recevait rien, et son client ignorait l'instant d'après
         * qu'un adversaire la connaît. C'est pourtant l'information qui compte
         * pour lui — on joue différemment quand on sait sa main percée. La vue
         * qu'il reçoit porte `revealedTo`, calculé par la projection.
         */
        if (!targets.includes(obj.owner)) {
          emissions.push({
            audience: { kind: 'SEAT', seat: obj.owner },
            build: () => ({ type: 'CARD_UPDATED', card: toPublicView(obj) }),
          });
        }
      }

      const toAll = intent.toSeats === 'ALL';
      // La révélation elle-même est adressée ; seule sa trace est publique.
      emissions.push({
        audience: ALL,
        build: () => ({ type: 'NOTED' }),
        log: {
          text: toAll
            ? `${who} a révélé ${names.join(', ')}`
            : `${who} a révélé ${intent.cardIds.length} carte(s) à ${targets.length} joueur(s)`,
          cardIds: publicAnchors,
        },
      });
      return { emissions };
    }

    /*
     * Révélation permanente du dessus de sa bibliothèque.
     *
     * L'intent ne fait que **poser le droit sur le siège** ; il ne publie
     * aucune carte. C'est `reconcileTopReveals`, appelée depuis `Room.commit`,
     * qui calcule et diffuse le dessus — et qui le recalculera à chaque
     * mutation suivante. Publier la carte ici aurait donné une vue juste une
     * seconde, puis fausse en permanence.
     */
    case 'REVEAL_TOP': {
      const targets = resolveSeats(state, intent.toSeats);
      const before = [...seat.topRevealedTo];
      seat.topRevealedTo = new Set(targets);

      if (targets.length === 0) {
        // Ne rien annoncer quand il n'y avait rien : un clic sur « aucun
        // destinataire » alors que rien n'était révélé n'est pas un fait de jeu.
        if (before.length === 0) return { emissions: [] };
        return {
          emissions: [
            {
              audience: ALL,
              build: () => ({ type: 'NOTED' }),
              log: { text: `${who} ne révèle plus le dessus de sa bibliothèque`, cardIds: [] },
            },
          ],
        };
      }

      const toAll = targets.length === state.seats.size;
      const names = targets
        .map((id) => state.seats.get(id)?.displayName ?? id)
        .join(', ');
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'NOTED' }),
            log: {
              text: toAll
                ? `${who} révèle en permanence le dessus de sa bibliothèque`
                : `${who} révèle en permanence le dessus de sa bibliothèque à ${names}`,
              cardIds: [],
            },
          },
        ],
      };
    }

    case 'REVEAL_HAND': {
      const targets = resolveSeats(state, intent.toSeats);
      seat.handRevealedTo = new Set(targets);
      seat.handRevealedGranted = new Set();

      const cards = getZone(state, { seat: seatId, kind: 'HAND' })
        .map((id) => state.objects.get(id))
        .filter((o): o is GameObjectState => o !== undefined);
      for (const obj of cards) {
        for (const s of targets) {
          // Ce que cette révélation accorde vraiment : le seul dépôt que
          // `UNREVEAL_HAND` aura le droit de reprendre (voir `handRevealedGranted`).
          if (!obj.knownTo.has(s)) seat.handRevealedGranted.add(obj.id);
          obj.knownTo.add(s);
        }
      }

      return {
        emissions: [
          {
            audience: { kind: 'SEATS', seats: targets },
            build: () => ({
              type: 'HAND_REVEALED',
              seat: seatId,
              toSeats: targets,
              cards: cards.map(toPublicView),
            }),
            /*
             * **Ni nom ni ancre, et ce n'est pas un oubli.**
             *
             * L'émission est adressée aux seuls `targets`, donc nommer les
             * cartes ici *semble* sans fuite. Ce serait la pire erreur du
             * fichier : `Room.commit` attache la ligne de journal aussi bien à
             * l'event réel qu'au `NOTED` de remplissage envoyé aux sièges hors
             * audience, et `state.log` — repris tel quel dans le `logTail` de
             * chaque snapshot — est unique pour toute la table. Une ligne de
             * journal n'a pas de version par destinataire : le texte part à
             * tous les sièges quelle que soit l'`audience` de son émission.
             * Nommer la main la publierait donc à ceux à qui on a justement
             * choisi de ne pas la montrer.
             */
            log: { text: `${who} a révélé sa main`, cardIds: [] },
          },
        ],
      };
    }

    case 'UNREVEAL_HAND': {
      const previous = [...seat.handRevealedTo];
      seat.handRevealedTo.clear();
      /*
       * **Le droit cesse ; le souvenir, non.**
       *
       * `REVEAL_HAND` est un droit *continu* sur une zone, et son propriétaire
       * le reprend quand il veut — sans quoi « masquer sa main » serait un
       * bouton qui ne fait rien. Ce retrait n'est pas un changement de zone : la
       * monotonie de `knownTo` n'a rien à dire dessus, et les deux cohabitent
       * par la règle du *dépôt*, la même que `topRevealedGranted` : on ne
       * reprend que ce que cette révélation a elle-même donné, et seulement sur
       * les cartes encore dans la main qu'elle couvrait. Une carte montrée à
       * part par `REVEAL`, ou vue au cimetière avant d'y remonter, reste connue.
       */
      for (const id of getZone(state, { seat: seatId, kind: 'HAND' })) {
        const obj = state.objects.get(id);
        if (!obj || !seat.handRevealedGranted.has(id)) continue;
        for (const s of previous) if (s !== seatId) obj.knownTo.delete(s);
      }
      seat.handRevealedGranted.clear();
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'HAND_UNREVEALED', seat: seatId }),
            log: { text: `${who} a masqué sa main`, cardIds: [] },
          },
        ],
      };
    }

    case 'SET_LIFE':
    case 'ADJUST_LIFE': {
      const target = state.seats.get(intent.seat);
      if (!target) throw new IntentError('ERR_NOT_SEATED', 'Siège inconnu.');
      const previous = target.life;
      target.life = intent.type === 'SET_LIFE' ? intent.value : previous + intent.delta;
      const delta = target.life - previous;

      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'LIFE_CHANGED', seat: target.id, value: target.life, delta }),
            log: {
              text:
                delta === 0
                  ? `${who} a laissé les points de vie de ${target.displayName} à ${target.life}`
                  : `${target.displayName} passe à ${target.life} points de vie (${delta > 0 ? '+' : ''}${delta})`,
              cardIds: [],
            },
          },
        ],
        undo: {
          at: Date.now(),
          run: () => {
            target.life = previous;
            return [
              {
                audience: ALL,
                build: () => ({ type: 'LIFE_CHANGED', seat: target.id, value: previous, delta: -delta }),
              },
            ];
          },
        },
      };
    }

    case 'SET_COMMANDER_DAMAGE': {
      const target = state.seats.get(intent.to);
      if (!target) throw new IntentError('ERR_NOT_SEATED', 'Siège inconnu.');
      // Exception au modèle « vraie table » : chacun tient le compte des dégâts
      // de commandant qu'il *reçoit*, et personne ne tient celui d'un autre.
      // Tout le monde les consulte — ils sont projetés dans chaque SeatSummary —
      // mais seul le receveur les corrige. Sans cette garde, n'importe qui
      // pouvait déclarer un adversaire mort par dégâts de commandant.
      if (intent.to !== seatId) {
        throw new IntentError(
          'ERR_NOT_YOURS',
          'Chaque joueur tient le compte des dégâts de commandant qu’il reçoit.',
        );
      }
      // La source aussi doit exister : sinon la table garde des dégâts venus
      // d'un joueur qui n'est plus là, indélogeables.
      if (!state.seats.has(intent.from)) {
        throw new IntentError('ERR_NOT_SEATED', `Le siège ${intent.from} n'est pas à la table.`);
      }
      const byCommander = target.commanderDamage.get(intent.from) ?? new Map<ObjectId, number>();
      byCommander.set(intent.commanderId, intent.value);
      target.commanderDamage.set(intent.from, byCommander);

      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({
              type: 'COMMANDER_DAMAGE_CHANGED',
              from: intent.from,
              to: intent.to,
              commanderId: intent.commanderId,
              value: intent.value,
            }),
            log: {
              text: `${target.displayName} a subi ${intent.value} dégâts de commandant de ${state.seats.get(intent.from)?.displayName ?? '?'}`,
              cardIds: [intent.commanderId],
            },
          },
        ],
      };
    }

    case 'SET_PLAYER_COUNTER': {
      const target = state.seats.get(intent.seat);
      if (!target) throw new IntentError('ERR_NOT_SEATED', 'Siège inconnu.');

      // §6.6 : la taxe de commandant est dérivée, mais corrigeable à la main par
      // un compteur de joueur nommé `commander_tax:<objectId>`.
      const taxed = /^commander_tax:(.+)$/.exec(intent.kind);
      if (taxed?.[1]) {
        const commanderId = taxed[1];
        target.commanderTax.set(commanderId, intent.value);
        return {
          emissions: [
            {
              audience: ALL,
              build: () => ({
                type: 'COMMANDER_TAX_CHANGED',
                seat: target.id,
                commanderId,
                casts: intent.value,
              }),
              log: { text: `${target.displayName} : taxe de commandant corrigée à ${intent.value}`, cardIds: [] },
            },
          ],
        };
      }

      // Un compteur à zéro disparaît, comme les marqueurs d'une carte : c'est ce
      // qui permet de le retirer, et cela évite d'accumuler des lignes mortes.
      if (intent.value === 0) target.playerCounters.delete(intent.kind);
      else target.playerCounters.set(intent.kind, intent.value);
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({
              type: 'PLAYER_COUNTER_CHANGED',
              seat: target.id,
              kind: intent.kind,
              value: intent.value,
            }),
            log: { text: `${target.displayName} : ${intent.kind} = ${intent.value}`, cardIds: [] },
          },
        ],
      };
    }

    case 'ROLL_DIE': {
      const count = Math.min(intent.count ?? 1, 20);
      const results = Array.from({ length: count }, () => rng.below(intent.sides) + 1);
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'DICE_ROLLED', seat: seatId, sides: intent.sides, results }),
            log: { text: `${who} a lancé 1d${intent.sides} : ${results.join(', ')}`, cardIds: [] },
          },
        ],
      };
    }

    case 'FLIP_COIN': {
      const count = Math.min(intent.count ?? 1, 20);
      const results: Array<'HEADS' | 'TAILS'> = Array.from({ length: count }, () =>
        rng.below(2) === 0 ? 'HEADS' : 'TAILS',
      );
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'COIN_FLIPPED', seat: seatId, results }),
            log: { text: `${who} a lancé une pièce : ${results.join(', ')}`, cardIds: [] },
          },
        ],
      };
    }

    case 'END_TURN': {
      const order = [...state.seats.values()]
        .filter((s) => !s.conceded)
        .sort((a, b) => a.seatIndex - b.seatIndex);
      if (order.length === 0) return { emissions: [] };

      const currentIdx = order.findIndex((s) => s.id === state.activeSeat);
      const next = order[(currentIdx + 1) % order.length]!;
      state.activeSeat = next.id;
      state.turnNumber += 1;
      state.phase = 'UNTAP';

      /*
       * Le compte de mulligans ne survit pas au premier tour.
       *
       * Il dit combien de mains on a rendues : c'est utile pendant qu'on les
       * rend, et pendant le premier tour où l'on ajuste encore. Passé ce
       * moment, il ne décrit plus rien et reste affiché à côté de chaque
       * joueur, où il n'est plus que du bruit.
       */
      const mulligansOublies: Emission[] = [];
      if (state.turnNumber === 2) {
        for (const seat of state.seats.values()) {
          if (!seat.playerCounters.has('mulligans')) continue;
          seat.playerCounters.delete('mulligans');
          const id = seat.id;
          mulligansOublies.push({
            audience: ALL,
            build: () => ({ type: 'PLAYER_COUNTER_CHANGED', seat: id, kind: 'mulligans', value: 0 }),
          });
        }
      }

      return {
        emissions: [
          ...mulligansOublies,
          {
            audience: ALL,
            build: () => ({
              type: 'TURN_ENDED',
              seat: seatId,
              nextSeat: next.id,
              turnNumber: state.turnNumber,
            }),
            log: { text: `${who} a passé le tour à ${next.displayName}`, cardIds: [] },
          },
        ],
      };
    }

    case 'SET_PHASE': {
      state.phase = intent.phase;
      return {
        emissions: [{ audience: ALL, build: () => ({ type: 'PHASE_CHANGED', phase: intent.phase }) }],
      };
    }

    case 'CONCEDE': {
      seat.conceded = true;
      const remaining = [...state.seats.values()].filter((s) => !s.conceded);
      const emissions: Emission[] = [
        {
          audience: ALL,
          build: () => ({ type: 'SEAT_CONCEDED', seatId }),
          log: { text: `${who} a concédé`, cardIds: [] },
        },
      ];
      if (remaining.length === 1) {
        state.status = 'ENDED';
        emissions.push({
          audience: ALL,
          build: () => ({ type: 'GAME_ENDED', reason: 'CONCEDE', winners: [remaining[0]!.id] }),
          log: { text: `${remaining[0]!.displayName} remporte la partie`, cardIds: [] },
        });
      }
      return { emissions };
    }

    case 'SET_SEAT_COSMETICS': {
      // Purement cosmétique, et réservé à son propre siège : on ne repeint pas
      // le tapis d'un autre joueur.
      if (intent.playmatUrl !== undefined) seat.playmatUrl = intent.playmatUrl;
      if (intent.cardBackUrl !== undefined) seat.cardBackUrl = intent.cardBackUrl;

      let renamed: string | null = null;
      if (intent.displayName !== undefined && intent.displayName !== seat.displayName) {
        // Le pseudo se fige au lancement : le journal d'actions déjà écrit nomme
        // les joueurs, et le renommer après coup rendrait ces lignes fausses.
        if (state.status === 'PLAYING') {
          throw new IntentError(
            'ERR_GAME_ALREADY_STARTED',
            'On ne change pas de pseudo une fois la partie lancée.',
          );
        }
        renamed = seat.displayName;
        seat.displayName = intent.displayName;
      }

      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({
              type: 'SEAT_COSMETICS',
              seatId,
              playmatUrl: seat.playmatUrl,
              cardBackUrl: seat.cardBackUrl,
              displayName: seat.displayName,
            }),
            ...(renamed
              ? { log: { text: `${renamed} se fait désormais appeler ${seat.displayName}`, cardIds: [] } }
              : {}),
          },
        ],
      };
    }

    case 'SWAP_SIDEBOARD': {
      // Entre deux manches seulement : on ne sideboarde pas en cours de partie.
      if (state.status === 'PLAYING') {
        throw new IntentError('ERR_GAME_ALREADY_STARTED', 'On ne change de réserve qu’entre deux parties.');
      }
      const library: ZoneRef = { seat: seatId, kind: 'LIBRARY' };
      const sideboard: ZoneRef = { seat: seatId, kind: 'SIDEBOARD' };
      assertZoneNotLocked(state, library);
      assertZoneNotLocked(state, sideboard);

      const entering = intent.in.map((id) => objectOf(state, id));
      const leaving = intent.out.map((id) => objectOf(state, id));
      for (const obj of [...entering, ...leaving]) {
        if (obj.owner !== seatId) {
          throw new IntentError('ERR_NOT_YOURS', 'On ne change que sa propre réserve.');
        }
      }
      for (const obj of entering) {
        if (obj.zone.kind !== 'SIDEBOARD') {
          throw new IntentError('ERR_BAD_ZONE', 'Une carte qui entre doit venir de la réserve.');
        }
      }
      for (const obj of leaving) {
        if (obj.zone.kind !== 'LIBRARY') {
          throw new IntentError('ERR_BAD_ZONE', 'Une carte qui sort doit venir de la bibliothèque.');
        }
      }

      const emissions: Emission[] = [];
      for (const obj of entering) emissions.push(moveEmission(state, obj, relocate(state, obj, library, 'TOP', rng, {})));
      for (const obj of leaving) emissions.push(moveEmission(state, obj, relocate(state, obj, sideboard, 'BOTTOM', rng, {})));

      // Une carte sortie de la bibliothèque emporterait son identifiant dans la
      // réserve, où il est publié : on remélange, ce qui réattribue les
      // identifiants restants et rend la corrélation impossible (§2.1). C'est
      // aussi ce qu'exige une vraie table : on présente un deck mélangé.
      shuffleZone(state, library, rng);
      emissions.push({
        audience: ALL,
        build: () => ({ type: 'ZONE_SHUFFLED', zone: library, count: getZone(state, library).length }),
        log: {
          text: `${who} a échangé ${intent.in.length} carte(s) avec sa réserve`,
          cardIds: [],
        },
      });
      emissions.push(zoneCount(state, library), zoneCount(state, sideboard));
      return { emissions };
    }

    case 'CHAT_BUBBLE': {
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'CHAT', seat: seatId, text: intent.text }),
            log: { text: `${who} : ${intent.text}`, cardIds: [] },
          },
        ],
      };
    }

    default:
      // CURSOR, UNDO_LAST et les intents de gestion de partie sont traités par
      // la room, qui a accès aux sockets et à la base.
      throw new IntentError('ERR_PAYLOAD', `Intent non géré par le moteur : ${(intent as Intent).type}`);
  }
}
