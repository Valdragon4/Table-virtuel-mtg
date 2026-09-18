/**
 * Schémas Zod de validation des messages entrants. Mode strict partout :
 * un champ inconnu est rejeté, jamais ignoré (docs/protocol.md §11).
 */
import { z } from 'zod';
import { LIMITS } from './messages.js';
import { PHASES, ZONE_KINDS } from './core.js';

const seatId = z.string().min(1).max(64);
const objectId = z.string().min(1).max(64);
const scryfallId = z.string().uuid();

export const zoneRefSchema = z
  .object({ seat: seatId, kind: z.enum(ZONE_KINDS) })
  .strict();

const counterSchema = z
  .object({
    kind: z.string().min(1).max(32),
    /*
     * Facultative, comme `Counter.value` l'est depuis la v2 : un marqueur sans
     * valeur est un mot-clé affiché seul (« vol », « monarque »), par
     * opposition à un marqueur compté (« 3 × +1/+1 »). Le schéma l'exigeait, et
     * l'on pouvait donc poser un mot-clé sur un permanent existant
     * (`SET_COUNTER`) sans pouvoir créer un jeton qui en porte un d'emblée.
     *
     * Pas de `null` ici, contrairement à `SET_COUNTER` : « retirer le marqueur »
     * n'a aucun sens dans la liste des marqueurs d'un jeton qu'on crée — on ne
     * le met simplement pas.
     */
    value: z.number().int().min(-9999).max(9999).optional(),
  })
  .strict();

const coord = z.number().finite().min(-100_000).max(100_000);
const rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const cardIdList = z.array(objectId).min(1).max(256);
const seatList = z.union([z.array(seatId).max(LIMITS.maxSeats), z.literal('ALL')]);

/**
 * Union discriminée brute. Les contraintes croisées (« l'un ou l'autre ») ne
 * peuvent pas vivre ici : Zod n'accepte qu'un objet par branche. Elles sont
 * appliquées dans `intentSchema`, juste en dessous.
 */
const intentUnion = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('MOVE_CARD'),
    cardId: objectId,
    to: zoneRefSchema,
    index: z.union([z.number().int().min(0).max(1000), z.enum(['TOP', 'BOTTOM', 'RANDOM'])]).optional(),
    x: coord.optional(),
    y: coord.optional(),
    faceDown: z.boolean().optional(),
    tapped: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('MOVE_CARDS'),
    cardIds: cardIdList,
    to: zoneRefSchema,
    index: z.union([z.number().int().min(0).max(1000), z.enum(['TOP', 'BOTTOM'])]).optional(),
    faceDown: z.boolean().optional(),
  }).strict(),
  z.object({ type: z.literal('TAP'), cardIds: cardIdList }).strict(),
  z.object({ type: z.literal('UNTAP'), cardIds: cardIdList }).strict(),
  z.object({ type: z.literal('UNTAP_ALL'), seat: seatId.optional() }).strict(),
  z.object({ type: z.literal('SET_ROTATION'), cardId: objectId, rotation }).strict(),
  z.object({ type: z.literal('FLIP_FACE'), cardId: objectId }).strict(),
  z.object({ type: z.literal('TURN_FACE_DOWN'), cardId: objectId }).strict(),
  z.object({ type: z.literal('TURN_FACE_UP'), cardId: objectId }).strict(),
  z.object({ type: z.literal('PEEK_FACE_DOWN'), cardId: objectId }).strict(),

  z.object({
    type: z.literal('SET_COUNTER'),
    targetId: objectId,
    kind: z.string().min(1).max(32),
    // Un nombre le compte ; `null` le retire ; absent en fait un mot-cle,
    // affiche seul sans quantite.
    value: z.number().int().min(-9999).max(9999).nullable().optional(),
  }).strict(),
  z.object({ type: z.literal('ADD_COUNTER'), targetId: objectId, kind: z.string().min(1).max(32), delta: z.number().int().min(-999).max(999) }).strict(),
  z.object({ type: z.literal('REMOVE_COUNTER'), targetId: objectId, kind: z.string().min(1).max(32) }).strict(),

  z.object({ type: z.literal('ATTACH'), sourceId: objectId, targetId: objectId }).strict(),
  z.object({ type: z.literal('DETACH'), sourceId: objectId }).strict(),

  z.object({
    type: z.literal('ADD_LABEL'),
    // Le texte peut etre vide : un marqueur « 1/1 » se suffit a sa valeur. Le
    // moteur refuse en revanche l'etiquette sans texte **ni** valeur, qui ne
    // s'afficherait pas.
    text: z.string().max(LIMITS.labelMaxChars),
    x: coord,
    y: coord,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    // Texte libre, et court : une valeur de marqueur se lit d'un coup d'oeil.
    value: z.string().max(24).optional(),
    attachedTo: objectId.optional(),
  }).strict(),
  z.object({ type: z.literal('MOVE_LABEL'), labelId: objectId, x: coord, y: coord }).strict(),
  z.object({ type: z.literal('REMOVE_LABEL'), labelId: objectId }).strict(),
  z.object({
    type: z.literal('SET_LABEL'),
    labelId: objectId,
    text: z.string().min(1).max(LIMITS.labelMaxChars).optional(),
    // `null` retire la valeur : l'étiquette redevient une simple note.
    value: z.string().max(24).nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    // `null` décroche l'étiquette : elle redevient flottante.
    attachedTo: objectId.nullable().optional(),
  }).strict(),

  z.object({
    type: z.literal('CREATE_TOKEN'),
    scryfallId: scryfallId.optional(),
    copyOf: objectId.optional(),
    count: z.number().int().min(1).max(64).optional(),
    x: coord.optional(),
    y: coord.optional(),
    tapped: z.boolean().optional(),
    counters: z.array(counterSchema).max(16).optional(),
  }).strict(),
  z.object({ type: z.literal('DESTROY_TOKEN'), cardIds: cardIdList }).strict(),

  z.object({ type: z.literal('SHUFFLE'), zone: zoneRefSchema }).strict(),
  z.object({
    type: z.literal('LOOK'),
    zone: zoneRefSchema,
    count: z.union([z.number().int().min(1).max(500), z.literal('ALL')]),
    mode: z.enum(['SCRY', 'SURVEIL', 'SEARCH', 'PEEK', 'REVEAL']),
  }).strict(),
  z.object({
    type: z.literal('RESOLVE_LOOK'),
    lookId: z.string().min(1).max(64),
    top: z.array(objectId).max(500),
    bottom: z.array(objectId).max(500),
    toHand: z.array(objectId).max(500).optional(),
    toGraveyard: z.array(objectId).max(500).optional(),
    toExile: z.array(objectId).max(500).optional(),
    toBattlefield: z.array(objectId).max(500).optional(),
    toSideboard: z.array(objectId).max(500).optional(),
    exileFaceDown: z.boolean().optional(),
    shuffleAfter: z.boolean().optional(),
  }).strict(),
  z.object({ type: z.literal('REORDER_TOP'), zone: zoneRefSchema, order: z.array(objectId).max(500) }).strict(),
  z.object({ type: z.literal('DRAW'), count: z.number().int().min(1).max(100) }).strict(),
  z.object({ type: z.literal('MULLIGAN'), keep: z.number().int().min(0).max(7).optional() }).strict(),
  z.object({ type: z.literal('MILL'), count: z.number().int().min(1).max(200) }).strict(),
  z.object({ type: z.literal('EXILE_TOP'), count: z.number().int().min(1).max(200), faceDown: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('RANDOM_DISCARD'), count: z.number().int().min(1).max(20) }).strict(),
  z.object({ type: z.literal('SCOOP') }).strict(),
  z.object({
    type: z.literal('SET_PRINTING'),
    cardId: objectId,
    scryfallId,
    isFoil: z.boolean().optional(),
  }).strict(),

  // Rattrapage d'une maladresse : la carte est oubliée de toute la table, et
  // reçoit un identifiant neuf. Réservé au propriétaire, vérifié par le moteur.
  z.object({ type: z.literal('TAKE_BACK'), cardId: objectId, to: z.enum(['HAND', 'FACE_DOWN']) }).strict(),

  /*
   * Cascade / Découvrir. Le seuil vient du joueur, pas du serveur : celui-ci
   * n'a pas le texte de règles, et il n'a donc rien à deviner. La borne haute
   * est large exprès — elle empêche une saisie absurde, pas un choix de jeu.
   */
  z.object({
    type: z.literal('CASCADE'),
    sourceId: objectId.optional(),
    manaValue: z.number().int().min(0).max(99),
    compare: z.enum(['BELOW', 'AT_MOST']),
  }).strict(),

  /*
   * Proliférer. Aucune sorte de marqueur n'est nommée ici, et c'est délibéré :
   * le serveur lit ce qui est posé sur les objets désignés, il ne reçoit ni ne
   * tient de liste de marqueurs reconnus. `cardIdList` borne la sélection comme
   * pour `TAP` ou `MOVE_CARDS` — un lot, pas un balayage de la table.
   */
  z.object({ type: z.literal('PROLIFERATE'), targetIds: cardIdList }).strict(),

  z.object({ type: z.literal('REVEAL'), cardIds: cardIdList, toSeats: seatList, durationMs: z.number().int().min(0).max(600_000).optional() }).strict(),
  // `toSeats: []` arrête la révélation permanente : la liste vide est donc une
  // valeur légitime, et non une saisie incomplète.
  z.object({ type: z.literal('REVEAL_TOP'), toSeats: seatList }).strict(),
  z.object({ type: z.literal('REVEAL_HAND'), toSeats: seatList }).strict(),
  z.object({ type: z.literal('UNREVEAL_HAND') }).strict(),

  z.object({ type: z.literal('SET_LIFE'), seat: seatId, value: z.number().int().min(-999).max(9999) }).strict(),
  z.object({ type: z.literal('ADJUST_LIFE'), seat: seatId, delta: z.number().int().min(-999).max(999) }).strict(),
  z.object({
    type: z.literal('SET_COMMANDER_DAMAGE'),
    from: seatId,
    to: seatId,
    commanderId: objectId,
    value: z.number().int().min(0).max(999),
  }).strict(),
  z.object({ type: z.literal('SET_PLAYER_COUNTER'), seat: seatId, kind: z.string().min(1).max(64), value: z.number().int().min(-999).max(9999) }).strict(),

  z.object({ type: z.literal('ROLL_DIE'), sides: z.number().int().min(2).max(1000), count: z.number().int().min(1).max(20).optional() }).strict(),
  z.object({ type: z.literal('FLIP_COIN'), count: z.number().int().min(1).max(20).optional() }).strict(),
  z.object({ type: z.literal('END_TURN') }).strict(),
  z.object({ type: z.literal('SET_PHASE'), phase: z.enum(PHASES) }).strict(),
  z.object({ type: z.literal('CONCEDE') }).strict(),
  z.object({ type: z.literal('CHAT_BUBBLE'), text: z.string().min(1).max(LIMITS.chatMaxChars) }).strict(),
  z.object({ type: z.literal('CURSOR'), x: coord, y: coord, holding: objectId.optional() }).strict(),
  z.object({ type: z.literal('UNDO_LAST') }).strict(),

  z.object({
    type: z.literal('SIT_DOWN'),
    seatIndex: z.number().int().min(0).max(LIMITS.maxSeats - 1),
    displayName: z.string().min(1).max(32).optional(),
    deckId: z.string().min(1).max(64).optional(),
    deckText: z.string().max(100_000).optional(),
  }).strict(),
  z.object({ type: z.literal('STAND_UP'), force: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('CLOSE_ROOM') }).strict(),
  z.object({ type: z.literal('LOAD_DECK'), deckId: z.string().min(1).max(64).optional(), deckText: z.string().max(100_000).optional() }).strict(),
  z.object({ type: z.literal('START_GAME') }).strict(),
  z.object({ type: z.literal('RESTART_GAME'), keepDecks: z.boolean() }).strict(),
  z.object({ type: z.literal('SWAP_SIDEBOARD'), in: z.array(objectId).max(100), out: z.array(objectId).max(100) }).strict(),
  z.object({
    type: z.literal('SET_SEAT_COSMETICS'),
    playmatUrl: z.string().url().max(2048).nullable().optional(),
    cardBackUrl: z.string().url().max(2048).nullable().optional(),
    displayName: z.string().min(1).max(32).optional(),
  }).strict(),
]);

export const intentSchema = intentUnion.superRefine((intent, ctx) => {
  if (intent.type === 'CREATE_TOKEN' && (intent.scryfallId == null) === (intent.copyOf == null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'CREATE_TOKEN attend scryfallId ou copyOf, pas les deux ni aucun des deux.',
    });
  }
  if (intent.type === 'RESOLVE_LOOK') {
    const all = [
      ...intent.top,
      ...intent.bottom,
      ...(intent.toHand ?? []),
      ...(intent.toGraveyard ?? []),
      ...(intent.toExile ?? []),
      ...(intent.toBattlefield ?? []),
      // `toSideboard` a été ajouté au type après coup et manquait ici. Une carte
      // citée à la fois vers la réserve et vers la bibliothèque passait la
      // garde : le moteur la déplaçait en réserve puis la réinsérait dans la
      // liste de la bibliothèque, laissant l'objet présent dans deux zones — et
      // le remélange qui suit une fouille lui donnait un identifiant neuf, si
      // bien que la réserve gardait un identifiant qui ne désigne plus rien.
      ...(intent.toSideboard ?? []),
    ];
    // Une même carte ne peut pas partir dans deux destinations à la fois.
    if (new Set(all).size !== all.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RESOLVE_LOOK place la même carte dans plusieurs destinations.',
      });
    }
  }
});

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    protocol: z.number().int(),
    sessionToken: z.string().max(512).optional(),
    seatToken: z.string().max(512).optional(),
    sinceSeq: z.number().int().min(0).optional(),
    roomPassword: z.string().max(200).optional(),
  }).strict(),
  z.object({
    t: z.literal('intent'),
    cid: z.string().min(1).max(64),
    ackSeq: z.number().int().min(0),
    intent: intentSchema,
  }).strict(),
  z.object({ t: z.literal('ping'), ts: z.number() }).strict(),
  z.object({ t: z.literal('resync'), sinceSeq: z.number().int().min(0) }).strict(),
]);

export type ValidatedClientMessage = z.infer<typeof clientMessageSchema>;
