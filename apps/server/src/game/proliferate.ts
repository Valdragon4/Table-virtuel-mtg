/**
 * Proliférer — « un de plus de chaque », et rien d'autre.
 *
 * Même esprit que `cascade.ts`, et la même ligne à ne pas franchir : le serveur
 * n'applique aucune règle de Magic (docs/protocol.md §1.5). Ce module n'arbitre
 * rien, il **exécute à la demande** un geste que le joueur ferait sinon un
 * marqueur à la fois — et proliférer est, à la main, le plus fastidieux du jeu :
 * huit permanents, trois sortes de marqueurs, vingt-quatre clics.
 *
 * Trois choses que ce module ne fait **pas**, et qui décident de tout :
 *
 * 1. **Il ne choisit aucune cible.** `targetIds` vient du joueur, et le serveur
 *    ne cherche jamais « qui porte déjà un marqueur » pour compléter la liste.
 *    C'est lui qui montre, nous qui appliquons.
 * 2. **Il ne choisit aucune sorte de marqueur.** Il n'y a pas de table des
 *    marqueurs connus, pas de « poison oui, loyauté non ». Il lit ce qui est
 *    posé sur l'objet désigné et en ajoute un de chaque.
 * 3. **Il ne refuse rien de ce que le chemin manuel accepte.** Les seules
 *    erreurs levées sont celles qu'`ADD_COUNTER` lève déjà, par le même
 *    `assertMayTouch` : objet inconnu, zone cachée d'autrui. Un objet sans
 *    marqueur n'est pas une erreur, c'est simplement un objet que rien ne
 *    change.
 *
 * **Le cas qui demandait un arbitrage, et comment il est tranché sans en
 * rendre un.** Un marqueur de ce projet peut n'avoir **aucune valeur** : c'est
 * alors un mot-clé — « vol », « ne se dégage pas », « monarque » — affiché seul
 * (§3). « Un de plus » n'a pas de sens sur un mot, et lui inventer la valeur 1
 * écrirait « vol 2 » sur la carte, ce que la v2 du protocole a justement cessé
 * de faire. Les mot-clés sont donc laissés **intacts** : on incrémente des
 * nombres, on ne juge pas des mots. Ce n'est pas une règle de Magic appliquée,
 * c'est l'absence de nombre à augmenter.
 *
 * Aucun event nouveau : les marqueurs voyagent en `CARD_UPDATED`, comme pour
 * `ADD_COUNTER`. `PROTOCOL_VERSION` ne bouge pas.
 */
import {
  assertMayTouch,
  cardUpdate,
  namedBatch,
  objectOf,
  setCounter,
  type Emission,
  type IntentResult,
} from './engine.js';
import type { GameObjectState, GameState } from './state.js';
import type { Counter, ObjectId, Proliferate, SeatId } from '@mtg/shared';

/** Copie des marqueurs, pour que l'annulation retrouve l'état d'avant. */
function snapshotCounters(obj: GameObjectState): Counter[] {
  return obj.counters.map((c) => ({ ...c }));
}

export function resolveProliferate(
  state: GameState,
  seatId: SeatId,
  who: string,
  intent: Proliferate,
): IntentResult {
  /*
   * Les doublons sont repliés **avant** d'appliquer quoi que ce soit : une
   * sélection peut citer deux fois le même objet, et proliférer deux fois sur
   * lui donnerait « deux de plus de chaque » sans que personne l'ait demandé.
   */
  const seen = new Set<ObjectId>();
  const targets: GameObjectState[] = [];
  for (const id of intent.targetIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const obj = objectOf(state, id);
    // Exactement la garde d'`ADD_COUNTER`, et pas une de plus : l'assistance
    // n'ouvre aucune porte que le chemin manuel n'ouvrait déjà.
    assertMayTouch(obj, seatId, intent);
    targets.push(obj);
  }

  const emissions: Emission[] = [];
  const before = new Map<ObjectId, Counter[]>();
  const touched: GameObjectState[] = [];

  for (const obj of targets) {
    // Les sortes sont relevées d'abord : `setCounter` peut retirer une entrée
    // — un marqueur qui atteint zéro s'en va —, et muter la liste pendant
    // qu'on la parcourt sauterait la sorte suivante.
    const kinds = obj.counters.filter((c) => c.value !== undefined).map((c) => c.kind);
    if (kinds.length === 0) continue;

    before.set(obj.id, snapshotCounters(obj));
    for (const kind of kinds) {
      const current = obj.counters.find((c) => c.kind === kind)?.value ?? 0;
      setCounter(obj, kind, current + 1);
    }
    touched.push(obj);
    emissions.push(cardUpdate(obj));
  }

  /*
   * Rien n'a changé : aucune émission, donc aucun `seq`, et l'ack porte
   * `seq: null` — « intent sans effet » (§4.2). Journaliser « X prolifère sur
   * rien » remplirait le journal d'un geste qui n'a rien fait.
   */
  if (touched.length === 0) return { emissions: [] };

  /*
   * Le journal, et sa seule difficulté : il est **public pour toute la table**
   * quelle que soit l'audience des events (§5.4).
   *
   * `namedBatch` est la règle, et on ne la réécrit pas : zone d'arrivée
   * publique, et nom refusé à toute carte qu'un siège ne peut pas identifier.
   * Il ne juge en revanche que d'**une** zone à la fois ; on ne lui soumet donc
   * que le champ de bataille, seul endroit où proliférer se pratique. Dès qu'un
   * objet touché est ailleurs, la ligne retombe sur un simple compte — le sens
   * sûr de l'écart, et jamais un nom de trop.
   */
  const onField = touched.filter((o) => o.zone.kind === 'BATTLEFIELD');
  const named = onField.length === touched.length ? namedBatch(onField, state, 'BATTLEFIELD') : null;
  const where = named ? named.names : `${touched.length} permanent(s)`;

  const first = emissions[0]!;
  first.log = {
    text: `${who} prolifère sur ${where} : un marqueur de plus de chaque sorte déjà posée`,
    cardIds: named ? named.cardIds : [],
  };

  return {
    emissions,
    undo: {
      at: Date.now(),
      run: () => {
        const out: Emission[] = [];
        for (const [id, counters] of before) {
          const obj = state.objects.get(id);
          if (!obj) continue;
          obj.counters = counters.map((c) => ({ ...c }));
          out.push(cardUpdate(obj));
        }
        return out;
      },
    },
  };
}
