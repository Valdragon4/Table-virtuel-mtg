/**
 * Cascade et Découvrir — la **séquence**, jamais l'arbitrage.
 *
 * Ce module est un assistant, pas un arbitre, et la distinction décide de tout
 * ce qui est écrit ici. L'invariant fondateur du serveur (docs/protocol.md
 * §1.5) est qu'il n'applique **aucune** règle de Magic : il ne refuse jamais un
 * geste au motif qu'il serait illégal. Ce que ce module fait n'est pas
 * d'arbitrer, c'est d'**exécuter à la demande** une suite de gestes que le
 * joueur ferait sinon un par un : exiler du dessus, carte après carte, comparer
 * une valeur de mana, et remettre le reste dessous au hasard. Fastidieux,
 * mécanique, sans jugement.
 *
 * Trois conséquences, et aucune n'est négociable :
 *
 * 1. **Le joueur déclenche, toujours.** Rien ne part parce qu'une carte est
 *    jouée ; l'intent vient d'un clic.
 * 2. **Le seuil est saisi, jamais deviné.** `manaValue` et `compare` arrivent
 *    du client parce que c'est le joueur qui lit sa carte — le serveur n'a pas
 *    le texte de règles (voir `manaValueOf` plus bas), et il n'a donc rien à
 *    interpréter.
 * 3. **La carte trouvée reste à l'exil, face visible, et le joueur en dispose.**
 *    « Jouer sans payer son coût » n'existe pas sur une table sans pile ni
 *    coûts : il n'y a pas de lancement ici, seulement des déplacements. Décider
 *    à sa place où elle atterrit — champ de bataille pour la cascade, main pour
 *    la découverte — serait précisément arbitrer. Elle s'arrête là où toute la
 *    table la voit, et le menu ordinaire fait le reste.
 *
 * Aucun refus n'est ajouté : les seules erreurs levées sont structurelles, et
 * ce sont exactement celles que `MILL` et `EXILE_TOP` lèvent déjà (zone en
 * consultation, bibliothèque vide).
 */
import {
  ALL,
  assertZoneNotLocked,
  moveEmission,
  namedBatch,
  namesForLog,
  objectOf,
  publicName,
  reassignId,
  relocate,
  zoneCount,
  type Emission,
  type IntentResult,
} from './engine.js';
import { IntentError } from './errors.js';
import { getZone, type CardData, type GameObjectState, type GameState } from './state.js';
import type { RandomSource } from './random.js';
import type { Cascade, ObjectId, SeatId, ZoneRef } from '@mtg/shared';

/**
 * Une face, telle que le catalogue la conserve (`compactFaces` à l'ingestion).
 *
 * Volontairement partielle : `CardData.faces` est un `unknown` venu de la base,
 * et on ne lit ici que les deux champs dont la séquence a besoin. Le **texte de
 * règles n'y est pas** — il n'est stocké nulle part, c'est un invariant de
 * droits du projet.
 */
interface CardFace {
  typeLine?: unknown;
  manaCost?: unknown;
}

function facesOf(card: CardData): CardFace[] {
  return Array.isArray(card.faces) ? (card.faces as CardFace[]) : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Valeur d'un symbole de mana isolé, sans les accolades.
 *
 * `X` vaut zéro hors de la pile, un symbole hybride vaut le **plus élevé** de
 * ses composants (`{2/W}` vaut 2, `{W/U}` vaut 1), et phyrexian ne coûte rien
 * de plus (`{W/P}` vaut 1). Tout le reste — couleur, incolore, neige — vaut 1.
 */
function symbolValue(symbol: string): number {
  const upper = symbol.toUpperCase();
  if (/^\d+$/.test(upper)) return Number(upper);
  if (upper === 'X' || upper === 'Y' || upper === 'Z') return 0;
  if (upper.includes('/')) {
    return Math.max(...upper.split('/').map((part) => (part === 'P' ? 0 : symbolValue(part))));
  }
  return 1;
}

/** Valeur de mana d'un coût écrit `{2}{W}{U}`. Une chaîne vide vaut zéro. */
export function manaCostValue(cost: string): number {
  let total = 0;
  for (const match of cost.matchAll(/\{([^}]+)\}/g)) total += symbolValue(match[1]!);
  return total;
}

/**
 * Valeur de mana d'une carte, **et l'aveu qu'on n'en est pas sûr**.
 *
 * Le catalogue ne stocke ni oracle ni texte imprimé : tout ce qu'on a est
 * `manaCost` — le coût du premier niveau — et le `manaCost` de chaque face.
 * Pour l'immense majorité des cartes, les deux disent la même chose et la
 * réponse est certaine.
 *
 * Elle ne l'est pas quand **plusieurs faces portent un coût** : une carte
 * partagée (`Fire // Ice`), une aventure, une recto-verso modale dont le verso
 * a son propre coût. Les règles tranchent, mais elles tranchent différemment
 * selon la carte et selon la zone, et deviner ici reviendrait à appliquer une
 * règle de Magic sur une information qu'on n'a pas. On rend donc la valeur du
 * **recto** — la plus probable, celle qu'on affiche — assortie de
 * `ambiguous: true`, et l'appelant s'arrête pour laisser la table trancher.
 *
 * `ambiguous` n'est jamais une erreur : une carte sans coût du tout (un sort
 * suspendu comme *Ancestral Vision*) a bel et bien une valeur de mana de zéro,
 * et c'est une réponse certaine.
 */
export function manaValueOf(card: CardData): { value: number; ambiguous: boolean } {
  const faces = facesOf(card);
  const faceCosts = faces.map((f) => str(f.manaCost)).filter((c) => c.length > 0);

  if (faceCosts.length > 1) {
    return { value: manaCostValue(faceCosts[0]!), ambiguous: true };
  }
  const own = card.manaCost ?? '';
  if (own.length > 0) return { value: manaCostValue(own), ambiguous: false };
  if (faceCosts.length === 1) return { value: manaCostValue(faceCosts[0]!), ambiguous: false };
  return { value: 0, ambiguous: false };
}

/**
 * La carte est-elle un terrain ?
 *
 * Lu sur la **ligne de type du recto**, qui est en anglais dans le catalogue —
 * c'est déjà l'hypothèse de `typeFamilies` côté client. Une recto-verso
 * annonce ses deux faces d'un trait (`Sorcery // Land`) : prendre la ligne
 * entière ferait passer pour un terrain un rituel dont seul le verso en est un,
 * ce qui est exactement la carte que la cascade doit pouvoir trouver.
 *
 * Le mot est cherché en **mot entier** : sans cela, un jour, un type ou un
 * sous-type qui le contient ferait disparaître une carte de la séquence sans
 * que personne comprenne pourquoi.
 */
export function isLandCard(card: CardData): boolean {
  const faces = facesOf(card);
  const front = str(faces[0]?.typeLine) || (card.typeLine ?? '').split('//')[0] || '';
  return /\bland\b/i.test(front);
}

/** Ce que la séquence fait d'une carte qu'elle vient d'exiler. */
export type Verdict =
  /** Terrain, ou valeur de mana trop haute : on continue de creuser. */
  | 'CONTINUE'
  /** Elle satisfait le critère : on s'arrête, c'est la trouvaille. */
  | 'FOUND'
  /** Sa valeur de mana n'est pas lisible à coup sûr : on s'arrête et on demande. */
  | 'ASK';

export function verdictFor(
  card: CardData,
  threshold: number,
  compare: Cascade['compare'],
): Verdict {
  if (isLandCard(card)) return 'CONTINUE';
  const { value, ambiguous } = manaValueOf(card);
  /*
   * L'aveu passe **avant** la comparaison, et non après : si la valeur n'est
   * pas sûre, le résultat de la comparaison ne l'est pas davantage, qu'il
   * tombe d'un côté ou de l'autre du seuil. S'arrêter tôt ne dévoile jamais
   * plus de cartes que nécessaire, et c'est le sens sûr de l'écart.
   */
  if (ambiguous) return 'ASK';
  return (compare === 'BELOW' ? value < threshold : value <= threshold) ? 'FOUND' : 'CONTINUE';
}

/**
 * Exécute la séquence sur la bibliothèque de l'auteur.
 *
 * Trois phases, et leur ordre porte tout le raisonnement de confidentialité :
 *
 * 1. **Exil, carte par carte, face visible.** Chacune passe par `relocate` puis
 *    `moveEmission`, le chemin d'émission ordinaire : la révélation est
 *    publique parce que la carte arrive dans une zone publique face visible, et
 *    non parce qu'un raccourci l'aurait décidé. La monotonie de la connaissance
 *    (§5.2) s'applique d'elle-même — qui a vu ces cartes les connaît ensuite
 *    partout.
 * 2. **Les noms sont relevés tant que les cartes sont à l'exil.** `namedBatch`
 *    juge sur la zone d'arrivée : après la remise en bibliothèque il refuserait
 *    de nommer, et il aurait raison. Le journal, lui, a le droit de dire ce que
 *    toute la table vient de voir.
 * 3. **Le reste repart sous la bibliothèque, au hasard et sous un identifiant
 *    neuf.** Les deux vont ensemble et c'est le point qui décide de tout : ces
 *    cartes ont été publiées, chaque client en tient la vue indexée par son
 *    `ObjectId`. Les renvoyer en purgeant `knownTo` sans changer l'identifiant
 *    laisserait cette vue en place, et le secret du fond de bibliothèque serait
 *    un mensonge poli — il suffirait de lire la position des identifiants
 *    connus. `reassignId` coupe le lien comme `SHUFFLE` le fait depuis toujours
 *    (§2.1), un `CARD_HIDDEN` fait tomber l'ancienne vue chez **tout le monde,
 *    propriétaire compris**, et le nouvel identifiant ne sort jamais du
 *    serveur : aucun event ne parle de ces objets une fois en bibliothèque.
 */
export function resolveCascade(
  state: GameState,
  seatId: SeatId,
  who: string,
  intent: Cascade,
  rng: RandomSource,
): IntentResult {
  const library: ZoneRef = { seat: seatId, kind: 'LIBRARY' };
  const exile: ZoneRef = { seat: seatId, kind: 'EXILE' };
  assertZoneNotLocked(state, library);

  const list = getZone(state, library);
  if (list.length === 0) throw new IntentError('ERR_BAD_ZONE', 'Bibliothèque vide.');

  // Le nom de la carte déclenchante n'est qu'un ornement de journal : elle
  // n'est pas touchée, et une carte que la table ne voit pas devient « une
  // carte » comme partout ailleurs.
  const sourceName = intent.sourceId ? publicName(objectOf(state, intent.sourceId), state) : null;

  const emissions: Emission[] = [];
  const exiled: GameObjectState[] = [];
  let stopped: { obj: GameObjectState; verdict: 'FOUND' | 'ASK' } | null = null;

  // `list` est l'ordre réel, du dessus vers le bas ; on en fige une copie parce
  // que `relocate` le mute sous nos pieds à chaque carte retirée.
  for (const id of [...list]) {
    const obj = state.objects.get(id);
    if (!obj) continue;
    const from = relocate(state, obj, exile, 'TOP', rng);
    emissions.push(moveEmission(state, obj, from));
    exiled.push(obj);

    const verdict = verdictFor(obj.card, intent.manaValue, intent.compare);
    if (verdict !== 'CONTINUE') {
      stopped = { obj, verdict };
      break;
    }
  }

  // Phase 2 : tant qu'elles sont à l'exil, face visible, la table les lit.
  const revealed = namedBatch(exiled, state, 'EXILE');
  const stoppedName = stopped ? publicName(stopped.obj, state) : null;

  // Phase 3 : tout sauf la carte sur laquelle on s'est arrêté.
  const rest = stopped ? exiled.filter((o) => o !== stopped!.obj) : exiled;
  for (const obj of rng.shuffle([...rest])) {
    const oldId = obj.id;
    emissions.push({ audience: ALL, build: () => ({ type: 'CARD_HIDDEN', cardId: oldId }) });
    // Dans cet ordre : `reassignId` remplace l'identifiant **dans la zone où
    // l'objet se trouve encore** (l'exil), et `relocate` l'en sort ensuite.
    reassignId(state, obj);
    relocate(state, obj, library, 'BOTTOM', rng);
  }

  /*
   * L'**ancre** ne désigne que la carte restée à l'exil.
   *
   * `namedBatch` rend par contrat toutes les ancres, y compris celles que le
   * seuil a repliées — ici les autres viennent de perdre leur identifiant, et
   * une ancre vers un objet mort ne surligne rien tout en promettant le
   * contraire. Le texte, lui, garde les noms : la table les a vus.
   */
  const anchors: ObjectId[] = stopped ? [stopped.obj.id] : [];

  /*
   * ...et c'est précisément pour cela que la ligne porte la **liste dépliée**.
   *
   * Sans ancres, le client ne peut rien reconstituer : une cascade de neuf
   * cartes affichait six noms, « et 3 autres cartes », et le joueur n'avait
   * aucun moyen de lire les trois dernières. Le dépliage sert à **lire des
   * noms**, pas à survoler des cartes ; les ancres sont le bonus qui permet de
   * surligner sur la table, elles ne peuvent pas être la condition pour savoir
   * ce qui est passé.
   *
   * Ce que l'on publie ici est licite pour une raison précise, et elle ne se
   * généralise pas : ces cartes ont été exilées **face visible** avant de
   * repartir sous la bibliothèque. Toute la table les a vues, la connaissance
   * est monotone (§5.2), et la phrase juste au-dessus les nomme déjà. On ne
   * lit donc jamais une bibliothèque — `revealed` a été relevé en phase 2,
   * pendant que les cartes étaient à l'exil, et `namedBatch` y a jugé sur la
   * zone d'arrivée publique. Après la phase 3 il refuserait de nommer, et il
   * aurait raison.
   */
  const names = revealed ? namesForLog(revealed.all, anchors) : undefined;
  // Le verbe suit le mot-clé choisi : « cascade » et « découvre » ne sont pas
  // la même comparaison, et le journal ne doit pas les confondre.
  const verb = intent.compare === 'BELOW' ? 'cascade' : 'découvre';
  const criterion =
    intent.compare === 'BELOW'
      ? `valeur de mana inférieure à ${intent.manaValue}`
      : `valeur de mana ${intent.manaValue} ou moins`;
  const opening = sourceName
    ? `${who} ${verb} depuis ${sourceName} (${criterion})`
    : `${who} ${verb} (${criterion})`;
  const seen = revealed ? `exile ${revealed.names}` : `exile ${exiled.length} carte(s)`;
  const putBack =
    rest.length > 0
      ? ` ; ${rest.length} carte(s) repartent sous la bibliothèque, au hasard`
      : '';

  let outcome: string;
  if (stopped?.verdict === 'FOUND') {
    outcome = ` et s'arrête sur ${stoppedName}, qui reste à l'exil face visible`;
  } else if (stopped?.verdict === 'ASK') {
    // On ne tranche pas : on le dit, publiquement, et la table décide.
    outcome = ` et s'arrête sur ${stoppedName}, dont la valeur de mana n'est pas évidente — à la table de trancher`;
  } else {
    outcome = ' sans rien trouver : la bibliothèque y est passée entière';
  }

  /*
   * La ligne est accrochée à la **première** émission, comme le font `MILL` et
   * `EXILE_TOP` : le fait est un seul geste, et lui donner un `seq` à lui seul
   * n'ajouterait qu'un event vide à la séquence de tout le monde.
   */
  const first = emissions[0];
  if (first) {
    first.log = { text: `${opening} : ${seen}${outcome}${putBack}`, cardIds: anchors };
    if (names) first.log.names = names;
  }
  emissions.push(zoneCount(state, library), zoneCount(state, exile));

  /*
   * Volontairement **non annulable**, pour la même raison que `TAKE_BACK`
   * (§5.3) : rejouer l'état d'avant republierait, sous leurs anciens
   * identifiants, des cartes que la bibliothèque vient de reprendre. Se
   * raviser se fait à la main, avec le menu.
   */
  return { emissions };
}
