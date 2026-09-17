/**
 * Révélation permanente du dessus d'une bibliothèque.
 *
 * *Experimental Frenzy*, *Realmbreaker of the Invasion Tree*, *Vizier of the
 * Menagerie* : la carte du dessus est visible en continu, et **change à chaque
 * pioche, chaque meule, chaque mélange, chaque scry**. C'est toute la
 * difficulté. Poser la carte révélée dans l'intent qui active la révélation
 * donnerait une vue juste une seconde, puis un mensonge affiché en permanence ;
 * et accrocher un rappel à chaque intent qui touche une bibliothèque revient à
 * tenir une liste qu'on finira par ne pas compléter — `MILL`, `EXILE_TOP`,
 * `SCOOP`, `MULLIGAN`, `RESOLVE_LOOK`, `SWAP_SIDEBOARD`, `UNDO_LAST`, le
 * balayage d'une consultation abandonnée, le départ d'un joueur…
 *
 * D'où ce module : **une seule fonction, appelée depuis `Room.commit`**, par où
 * passe *toute* mutation de l'état diffusée aux clients. Elle compare le dessus
 * réel de chaque bibliothèque révélée à ce qui a été publié, et n'émet que la
 * différence. Un intent nouveau n'a donc rien à savoir de cette fonctionnalité
 * pour ne pas la casser.
 *
 * ## Pourquoi publier la vue du dessus ne rouvre pas la brèche de la §2.1
 *
 * La §2.1 interdit de publier l'`ObjectId` d'une carte de bibliothèque, parce
 * que corréler les identifiants avant et après un `SHUFFLE` reconstruirait
 * l'ordre de la zone. Ici, l'identifiant **et** l'identité d'une carte sortent
 * vers les sièges destinataires. Trois raisons pour lesquelles le canal de
 * corrélation reste fermé :
 *
 * 1. **`SHUFFLE` réattribue tous les identifiants et vide `knownTo`**
 *    (`shuffleZone`). L'identifiant connu d'un destinataire est mort avec le
 *    mélange : il ne se retrouve nulle part après, et ne relie donc aucun
 *    « avant » à aucun « après ». C'est exactement la propriété que le critère
 *    §12.4 vérifie déjà, et elle n'est pas affaiblie ici.
 * 2. **Un seul identifiant est publié à la fois, et il est révoqué dès qu'il
 *    cesse d'être le dessus.** Le destinataire ne peut donc jamais tenir deux
 *    identifiants de la même bibliothèque en même temps, ni *a fortiori* les
 *    ordonner. Ce qu'il apprend — « cette carte-ci est sur le dessus, à cet
 *    instant » — est précisément ce que la révélation lui accorde.
 * 3. **Aucun identifiant *de bibliothèque* ne reste connu d'un siège qui n'y a
 *    plus droit** — l'invariant §12.7. Si la carte redescend dans la
 *    bibliothèque (scry, `REORDER_TOP`) ou disparaît dans un mélange, on la fait
 *    oublier par `CARD_HIDDEN` et on reprend la connaissance accordée. Si elle
 *    est **piochée**, en revanche, le destinataire la garde : elle a quitté la
 *    bibliothèque, son identifiant est devenu celui d'une carte de main —
 *    énumérable, donc déjà public — et la monotonie de `knownTo` (voir
 *    `relocate`) veut qu'on n'oublie pas ce qu'on a vu. Ce qui reste fermé,
 *    c'est le canal de corrélation, et il ne porte que sur la bibliothèque.
 *
 * Reste une information résiduelle, et elle est assumée : un destinataire voit
 * qu'une carte a quitté le dessus, et une autre l'a remplacée. C'est
 * exactement ce que voit quelqu'un assis en face d'une carte retournée sur un
 * deck. Le compte de la zone (`ZONE_COUNT`) et les mélanges (`ZONE_SHUFFLED`)
 * sont de toute façon déjà publics.
 */
import type { SeatId } from '@mtg/shared';
import type { Emission } from './engine.js';
import { toPublicView } from './projection.js';
import { canSeeIdentity, getZone, isEnumerableZone, type GameState } from './state.js';

/**
 * Remet les révélations permanentes en accord avec l'état, et rend les events
 * qui en découlent. Rend un tableau vide quand rien n'a changé — c'est le cas
 * courant, et `Room.commit` ne réémet alors rien du tout.
 */
function sameSeats(list: SeatId[], set: Set<SeatId>): boolean {
  return list.length === set.size && list.every((s) => set.has(s));
}

export function reconcileTopReveals(state: GameState): Emission[] {
  const emissions: Emission[] = [];

  for (const seat of state.seats.values()) {
    // Un siège parti n'est plus destinataire de rien (§12.7).
    for (const id of [...seat.topRevealedTo]) {
      if (!state.seats.has(id)) seat.topRevealedTo.delete(id);
    }

    const recipients = [...seat.topRevealedTo];
    const library = { seat: seat.id, kind: 'LIBRARY' as const };
    const topId = recipients.length > 0 ? (getZone(state, library)[0] ?? null) : null;
    const previousId = seat.topRevealedId;

    // Rien n'a bougé — ni la carte du dessus, ni la liste des destinataires.
    // C'est le cas de l'immense majorité des commits, et il ne coûte rien.
    if (topId === previousId && sameSeats(recipients, seat.topRevealedPublishedTo)) continue;

    /*
     * Faire oublier l'ancien dessus, à qui n'y a plus droit.
     *
     * Perdent le droit : tout le monde si la carte n'est plus le dessus, et
     * sinon les seuls sièges retirés de la liste. On ne retire de `knownTo` que
     * ce que la révélation avait elle-même accordé (`topRevealedGranted`) —
     * purger tout `toSeats` effacerait une connaissance acquise autrement, par
     * un scry par exemple.
     *
     * Deux cas seulement méritent un `CARD_HIDDEN` : l'objet a disparu (un
     * mélange vient de le renommer, un siège s'est levé), ou il est toujours en
     * bibliothèque, zone dont un client ne garde jamais le contenu. S'il est
     * parti en main, au cimetière ou à l'exil, son `CARD_MOVED` a déjà dit aux
     * destinataires ce qu'ils avaient le droit d'en savoir : le leur faire
     * oublier ici les ferait diverger du snapshot (§8.1).
     */
    if (previousId !== null) {
      const stillRevealed = previousId === topId;
      const losing = [...seat.topRevealedGranted].filter(
        (s) => !stillRevealed || !seat.topRevealedTo.has(s),
      );
      const previous = state.objects.get(previousId);
      const mustForget = previous === undefined || !isEnumerableZone(previous.zone.kind);
      for (const s of losing) {
        seat.topRevealedGranted.delete(s);
        /*
         * **On ne reprend la connaissance que si la carte est restée en
         * bibliothèque** (ou a disparu dans un mélange).
         *
         * La monotonie de `knownTo` (voir `relocate`) dit qu'un changement de
         * zone n'efface rien : une carte révélée sur le dessus puis **piochée**
         * reste connue du destinataire, qui l'a vue de ses yeux. L'ancienne
         * version la lui retirait — c'était la seule contradiction entre ce
         * module et la règle, et elle est tranchée ici dans le sens du souvenir.
         *
         * Le cas symétrique — elle redescend dans la bibliothèque après un scry,
         * un `REORDER_TOP` — tombe bien sous l'unique effacement, et le
         * `CARD_HIDDEN` ci-dessous reste indispensable : rien ne doit relier un
         * identifiant de bibliothèque à une identité (§2.1).
         */
        if (mustForget) previous?.knownTo.delete(s);
      }

      const blind = mustForget
        ? losing.filter((s) => previous === undefined || !canSeeIdentity(previous, s))
        : [];
      if (blind.length > 0) {
        emissions.push({
          audience: { kind: 'SEATS', seats: blind },
          build: () => ({ type: 'CARD_HIDDEN', cardId: previousId }),
        });
      }
    }

    const top = topId === null ? null : state.objects.get(topId);
    if (top) {
      // Ce qui est *accordé* ici, et donc ce qu'on révoquera : les sièges qui ne
      // connaissaient pas déjà cette carte autrement.
      for (const s of recipients) {
        if (!top.knownTo.has(s)) seat.topRevealedGranted.add(s);
        top.knownTo.add(s);
      }
    }
    seat.topRevealedId = top ? top.id : null;
    seat.topRevealedPublishedTo = new Set(recipients);

    const owner = seat.id;
    const sees = new Set<SeatId>(recipients);
    emissions.push({
      audience: { kind: 'ALL' },
      // Un seul event pour toute la table, deux variantes : le destinataire
      // reçoit la carte, les autres reçoivent le fait sans la carte. Les mettre
      // hors audience leur ferait sauter un `seq`, donc déclencher une
      // resynchronisation à chaque pioche de l'adversaire.
      build: (viewer) => ({
        type: 'TOP_REVEALED',
        seat: owner,
        toSeats: recipients,
        card: top && sees.has(viewer) ? toPublicView(top) : null,
      }),
    });
  }

  return emissions;
}
