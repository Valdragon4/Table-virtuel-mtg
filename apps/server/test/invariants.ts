/**
 * Audit des invariants d'état, destiné à tourner après *chaque* intent.
 *
 * Ce n'est pas un test : c'est l'oracle des tests. Il dit ce que l'état
 * canonique doit vérifier en permanence, quoi qu'ait fait le joueur.
 */
import type { GameState } from '../src/game/state.js';
import { zoneKey } from '../src/game/state.js';

export function auditInvariants(state: GameState, context = ''): void {
  const problems: string[] = [];
  const where = context ? ` [${context}]` : '';

  // 1. Tout objet connu est listé une fois, et une seule, dans sa propre zone.
  for (const [id, obj] of state.objects) {
    if (obj.id !== id) problems.push(`objet ${id} indexé sous une autre clé (${obj.id})`);
    const list = state.zones.get(zoneKey(obj.zone));
    if (!list) {
      problems.push(`objet ${id} dans une zone inexistante ${zoneKey(obj.zone)}`);
      continue;
    }
    const occurrences = list.filter((x) => x === id).length;
    if (occurrences !== 1) {
      problems.push(`objet ${id} présent ${occurrences} fois dans ${zoneKey(obj.zone)}`);
    }
  }

  // 2. Aucun identifiant fantôme dans une zone, et pas de carte égarée dans
  //    la liste d'une zone à laquelle elle n'appartient pas.
  for (const [key, list] of state.zones) {
    const seen = new Set<string>();
    list.forEach((id, index) => {
      if (seen.has(id)) problems.push(`doublon ${id} dans ${key}`);
      seen.add(id);
      const obj = state.objects.get(id);
      if (!obj) {
        problems.push(`identifiant fantôme ${id} dans ${key}`);
        return;
      }
      if (zoneKey(obj.zone) !== key) {
        problems.push(`objet ${id} listé dans ${key} mais situé en ${zoneKey(obj.zone)}`);
      }
      // 3. `sortIndex` contigu : c'est le rang dans la zone, pas un souvenir.
      if (obj.sortIndex !== index) {
        problems.push(`sortIndex ${obj.sortIndex} ≠ rang ${index} pour ${id} dans ${key}`);
      }
    });
  }

  // 4. Une zone appartient toujours à un siège existant.
  for (const key of state.zones.keys()) {
    const [seat = ''] = key.split('|');
    if (!state.seats.has(seat) && (state.zones.get(key)?.length ?? 0) > 0) {
      problems.push(`zone non vide ${key} sans siège correspondant`);
    }
  }

  for (const obj of state.objects.values()) {
    // 5. Un attachement pointe sur un permanent réel du champ de bataille.
    if (obj.attachedTo !== undefined) {
      const target = state.objects.get(obj.attachedTo);
      if (!target) problems.push(`${obj.id} attaché à l'objet disparu ${obj.attachedTo}`);
      else if (target.zone.kind !== 'BATTLEFIELD') {
        problems.push(`${obj.id} attaché à ${target.id}, hors du champ de bataille`);
      }
      if (obj.zone.kind !== 'BATTLEFIELD') {
        problems.push(`${obj.id} porte un attachement hors du champ de bataille`);
      }
    }

    // 6. Une carte de bibliothèque n'est jamais connue d'un autre siège que son
    //    propriétaire — lui peut la connaître (scry, recherche), personne d'autre.
    if (obj.zone.kind === 'LIBRARY') {
      for (const seat of obj.knownTo) {
        if (seat !== obj.zone.seat) {
          problems.push(`${obj.id} en bibliothèque de ${obj.zone.seat} mais connu de ${seat}`);
        }
      }
    }

    // 7. `knownTo` ne référence que des sièges de la table.
    for (const seat of obj.knownTo) {
      if (!state.seats.has(seat)) problems.push(`${obj.id} connu d'un siège inexistant ${seat}`);
    }

    // 8. Un marqueur à zéro n'existe pas : il est retiré.
    for (const counter of obj.counters) {
      if (counter.value === 0) problems.push(`${obj.id} porte un marqueur ${counter.kind} à 0`);
    }
  }

  // 9. Un siège ne référence que des sièges et des objets existants.
  for (const seat of state.seats.values()) {
    for (const other of seat.handRevealedTo) {
      if (!state.seats.has(other)) {
        problems.push(`${seat.id} révèle sa main à un siège inexistant ${other}`);
      }
    }
    for (const from of seat.commanderDamage.keys()) {
      if (!state.seats.has(from)) {
        problems.push(`${seat.id} garde des dégâts d'un siège inexistant ${from}`);
      }
    }
  }

  // 10. Une consultation en cours porte sur des cartes réelles, encore dans la zone.
  for (const look of state.pendingLooks.values()) {
    if (!state.seats.has(look.seat)) problems.push(`consultation ${look.id} d'un siège disparu`);
    const list = state.zones.get(zoneKey(look.zone)) ?? [];
    for (const id of look.cardIds) {
      if (!state.objects.get(id)) problems.push(`consultation ${look.id} sur l'objet disparu ${id}`);
      else if (!list.includes(id)) problems.push(`consultation ${look.id} sur ${id}, sorti de sa zone`);
    }
    if ([...look.shownIds].sort().join() !== [...look.cardIds].sort().join()) {
      problems.push(`consultation ${look.id} : shownIds et cardIds divergent`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invariants violés${where} :\n  - ${problems.join('\n  - ')}`);
  }
}
