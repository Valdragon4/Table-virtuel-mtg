/**
 * Types fondamentaux du protocole. Voir docs/protocol.md §2 et §3.
 *
 * Règle structurante : un identifiant d'objet est opaque. Il ne code jamais
 * l'identité de la carte ni sa position d'origine dans une zone cachée.
 */

/**
 * Version du protocole. **À monter dès que le format d'un message change.**
 *
 * Elle est verifiee au `hello` : un client trop ancien est ferme proprement
 * avec « recharge la page », plutot que de se faire refuser message par
 * message. C'est exactement ce qui est arrive en oubliant de la monter quand la
 * valeur d'un marqueur est passee du nombre au texte : les onglets restes
 * ouverts a travers le deploiement continuaient d'envoyer un nombre, et
 * recevaient « message refuse par le schema » sans savoir pourquoi.
 *
 * 2 : la valeur d'un marqueur (`Label.value`) est du texte, et celle d'un
 *     marqueur de carte (`Counter.value`) est facultative.
 * 3 : révélation permanente du dessus de bibliothèque — l'intent `REVEAL_TOP`,
 *     l'event `TOP_REVEALED` et le champ `Snapshot.topReveals`. Un onglet resté
 *     ouvert n'en sait rien : il ignorerait `TOP_REVEALED` et afficherait donc
 *     en permanence une carte périmée sur la pile. Mieux vaut le fermer.
 *
 * `TAKE_BACK` (rattrapage d'une carte posée par erreur) **ne monte pas** la
 * version, et c'est délibéré. Il ajoute un intent — qu'un onglet ancien
 * n'enverra jamais, faute d'entrée de menu — et n'invente aucun event : le
 * geste s'exprime entièrement avec `CARD_HIDDEN` puis `CARD_MOVED`, tous deux
 * connus depuis la version 1 et traités par le client exactement comme il faut
 * (« oublie cet objet », puis « voici un objet »). Un onglet resté ouvert
 * pendant le déploiement voit donc la carte disparaître et la nouvelle arriver,
 * sans rien afficher de périmé — le critère de la §11. Fermer toutes les tables
 * en cours pour une entrée de menu qu'elles n'auraient pas serait une punition
 * sans motif.
 *
 * L'**ordre des zones republié** et les **noms de cartes dans le journal** ne la
 * montent pas, et il faut le dire parce que le second en a l'air. Aucun des deux
 * ne touche au format :
 *
 * - republier les rangs d'une zone décalée se fait avec `CARDS_MOVED`, connu
 *   depuis la version 1 et déjà utilisé tel quel pour le rangement au sein d'une
 *   zone. Un onglet resté ouvert le traite exactement comme il faut — « voici
 *   ces cartes, à ces rangs » — et cesse justement d'afficher un cimetière dans
 *   le désordre : il gagne le correctif au lieu de le subir ;
 * - nommer les cartes ne change que le **contenu** d'un `LogEntry.text` déjà
 *   existant, que le client affiche tel quel sans rien en analyser, et de
 *   `cardIds`, dont il se sert déjà pour surligner. Rien de neuf à comprendre ;
 *   un onglet ancien lit la nouvelle phrase comme il lisait l'ancienne.
 *
 * Fermer toutes les tables en cours pour une phrase plus précise serait la même
 * punition sans motif qu'au paragraphe précédent.
 *
 * Les **marqueurs calculés** (« effets classiques » : force et endurance égales
 * au nombre de terrains que vous contrôlez, de cartes de créature dans un
 * cimetière…) ne la montent pas non plus, et pour une raison plus forte : ils
 * n'ajoutent **rien** au format. Un marqueur reste `{ kind, value? }` ; la
 * formule tient dans `kind`, qui est du texte libre borné à 32 caractères, et
 * `value` est omis parce qu'un marqueur calculé ne pose aucun marqueur. Le
 * décompte est établi par chaque client à partir de ce qu'il détient déjà de
 * public (`zoneCounts`, cartes des zones énumérables, points de vie), et rien de
 * neuf ne traverse le socket. Un onglet resté ouvert à travers le déploiement
 * reçoit donc un marqueur qu'il sait lire depuis la version 1 : il affichera la
 * formule en clair au lieu de la pastille violette — moins joli, mais jamais
 * faux, et c'est le critère de la §11.
 */
export const PROTOCOL_VERSION = 3;

export type SeatId = string;
export type ObjectId = string;
export type Seq = number;

export const ZONE_KINDS = [
  'LIBRARY',
  'HAND',
  'BATTLEFIELD',
  'GRAVEYARD',
  'EXILE',
  'COMMAND',
  'SIDEBOARD',
  'FACEDOWN_TEMP',
  'STACK_NOTE',
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export interface ZoneRef {
  seat: SeatId;
  kind: ZoneKind;
}

/** Zones dont le contenu ne doit jamais quitter le serveur vers un autre siège. */
export const HIDDEN_ZONES: ReadonlySet<ZoneKind> = new Set<ZoneKind>([
  'LIBRARY',
  'HAND',
  'SIDEBOARD',
  'FACEDOWN_TEMP',
]);

/** Zones dont l'ordre est lui-même une information confidentielle. */
export const ORDERED_SECRET_ZONES: ReadonlySet<ZoneKind> = new Set<ZoneKind>([
  'LIBRARY',
  'FACEDOWN_TEMP',
]);

/**
 * Zones ordonnées, où `index` a un sens.
 *
 * **Convention d'ordre, valable pour toutes les zones de cette liste : le rang
 * 0 est le *dessus* de la pile.**
 *
 * Rien ne l'énonçait, et tout en dépendait : `insertIntoZone` empile par
 * `unshift` quand on ne lui donne pas de position, `TOP` vaut 0 et `BOTTOM` vaut
 * la fin, `ZonePanel` trie par `sortIndex` croissant et affiche donc le dessus
 * en premier. Trois endroits d'accord entre eux par hasard, qu'un quatrième
 * pouvait contredire sans que personne ne le voie.
 *
 * Elle est choisie pour la bibliothèque, où « le dessus » est la seule position
 * qui compte : le dessus doit être à un rang stable, et 0 est le seul rang qui
 * ne bouge pas quand la pile grandit par le bas. Le cimetière et l'exil en
 * héritent, et c'est cohérent avec la table physique — on meule cinq cartes,
 * elles tombent l'une après l'autre, la dernière arrivée se retrouve sur le
 * dessus, donc au rang 0, et c'est elle que le panneau montre en premier.
 */
export const ORDERED_ZONES: ReadonlySet<ZoneKind> = new Set<ZoneKind>([
  'LIBRARY',
  'HAND',
  'GRAVEYARD',
  'EXILE',
  'SIDEBOARD',
  'FACEDOWN_TEMP',
  'STACK_NOTE',
]);

export interface Counter {
  kind: string;
  /**
   * Le nombre de marqueurs, **ou rien du tout**.
   *
   * Sur une vraie table, deux choses différentes se posent sur un permanent :
   * des marqueurs qui se comptent (+1/+1, loyauté, poison) et des mots qui ne
   * se comptent pas (« vol », « ne se dégage pas », « monarque »). La valeur
   * était obligatoire, et l'on écrivait donc « vol 1 » — un nombre qui ne veut
   * rien dire et qu'on lisait comme une quantité.
   *
   * `undefined` : un mot-clé, affiché seul.
   */
  value?: number;
}

export type Rotation = 0 | 90 | 180 | 270;

interface CardViewBase {
  id: ObjectId;
  kind: 'CARD' | 'TOKEN';
  owner: SeatId;
  controller: SeatId;
  zone: ZoneRef;
  tapped: boolean;
  x: number;
  y: number;
  rotation: Rotation;
  counters: Counter[];
  attachedTo?: ObjectId;
  sortIndex: number;
}

/**
 * Objet dont l'identité est visible par le destinataire.
 *
 * `faceDown: false` signifie « ce destinataire voit l'identité », et non « la
 * carte est face visible sur la table ». Les deux diffèrent pour le
 * propriétaire d'une carte posée face cachée : il la voit, les autres non.
 * `facedownOnTable` porte cette seconde information — sans elle, un joueur
 * ignore que sa propre carte est cachée aux autres, et croit avoir révélé ce
 * qu'il vient de dissimuler.
 */
export interface PublicCardView extends CardViewBase {
  faceDown: false;
  /** La carte est physiquement face cachée, même si vous en voyez l'identité. */
  facedownOnTable?: boolean;
  scryfallId: string;
  flipped: boolean;
  isFoil: boolean;
  /** Renseigné uniquement pour les tokens créés par copie d'un permanent. */
  copyOf?: ObjectId;
  /**
   * Sièges à qui cette carte a été **montrée** et qui ne la verraient pas
   * autrement.
   *
   * Sans ce champ, un joueur qui révèle une carte de sa main ne le sait plus
   * l'instant d'après : `REVEAL` ne prévient que les destinataires. C'est
   * pourtant l'information qui compte pour lui — on joue différemment quand un
   * adversaire connaît une de ses cartes.
   *
   * Il n'apprend rien de neuf : il n'est posé que sur une vue **déjà publique**
   * pour son destinataire, jamais sur un `HiddenCardView`. Montrer une carte à
   * quelqu'un est de toute façon un geste public à une vraie table — on le dit
   * à voix haute.
   */
  revealedTo?: SeatId[];
}

/**
 * Objet présent mais dont l'identité est cachée au destinataire.
 *
 * Aucun champ dérivé de l'identité de la carte n'a le droit d'exister ici —
 * `isFoil` compris, qui est corrélable. La liste blanche ci-dessous est
 * vérifiée par le test d'étanchéité (docs/protocol.md §12.2).
 */
export interface HiddenCardView extends CardViewBase {
  faceDown: true;
}

export type CardView = PublicCardView | HiddenCardView;

/** Champs autorisés dans une vue cachée. Toute clé hors de cette liste est une fuite. */
export const HIDDEN_VIEW_ALLOWED_KEYS: readonly string[] = [
  'id',
  'kind',
  'owner',
  'controller',
  'zone',
  'faceDown',
  'tapped',
  'x',
  'y',
  'rotation',
  'counters',
  'attachedTo',
  'sortIndex',
];

export function isPublicCardView(v: CardView): v is PublicCardView {
  return v.faceDown === false;
}

/** Zone cachée non énumérable : on n'expose qu'un compte. */
export interface OpaqueZoneView {
  zone: ZoneRef;
  count: number;
}

/**
 * Étiquette posée sur la table. Avec `value`, elle devient un **compteur libre** :
 * un marqueur numérique posable n'importe où, pour ce que les cartes ne portent
 * pas — un « 2/2 » qui pompe, un compteur d'orages, un décompte de tour.
 * Sans `value`, c'est une simple note de texte.
 */
export interface Label {
  id: ObjectId;
  text: string;
  x: number;
  y: number;
  color?: string;
  owner: SeatId;
  /**
   * La valeur portée par le marqueur, **en texte libre**.
   *
   * Elle a longtemps été un entier, et c'était trop étroit : on veut poser
   * « X/X », « +2/+0 », « monarque » ou « sur la pile » aussi bien que « 3 ».
   * L'interface reste une interface de compteur quand la valeur se lit comme un
   * nombre — les boutons − et + apparaissent alors — et devient un simple
   * champ de texte sinon. Le marqueur reste accrochable dans les deux cas :
   * c'est la même chose, avec une valeur différente.
   *
   * `undefined` : pas de valeur du tout, l'étiquette est une simple note.
   */
  value?: string;
  /**
   * Étiquette accrochée à une carte : elle la suit au lieu de rester à des
   * coordonnées fixes. `x`/`y` deviennent alors un décalage relatif à la carte.
   */
  attachedTo?: ObjectId;
}

export const PHASES = [
  'UNTAP',
  'UPKEEP',
  'DRAW',
  'MAIN1',
  'COMBAT',
  'MAIN2',
  'END',
] as const;
export type PhaseName = (typeof PHASES)[number];

/**
 * Modes proposés. Planechase a été retiré (15 septembre 2026) : il n'avait pas
 * d'implémentation et offrait une promesse que la table ne tenait pas.
 * La valeur reste dans l'enum Prisma, pour ne pas casser les parties déjà
 * enregistrées ; le serveur les ramène à COMMANDER au chargement.
 */
export const GAME_MODES = ['COMMANDER', 'DUEL', 'DRAFT'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const ROOM_STATUSES = ['LOBBY', 'PLAYING', 'ENDED'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export type LookMode = 'SCRY' | 'SURVEIL' | 'SEARCH' | 'PEEK' | 'REVEAL';

export interface SeatSummary {
  id: SeatId;
  seatIndex: number;
  displayName: string;
  userId: string | null;
  connected: boolean;
  conceded: boolean;
  life: number;
  handCount: number;
  playerCounters: Counter[];
  /** Dégâts de commandant reçus, indexés par siège source puis par commandant. */
  commanderDamage: Record<SeatId, Record<ObjectId, number>>;
  commanderTax: Record<ObjectId, number>;
  playmatUrl: string | null;
  cardBackUrl: string | null;
  color: string;
  deckName: string | null;
}

export interface LogEntry {
  seq: Seq;
  at: number;
  actor: SeatId | null;
  /** Texte déjà construit côté serveur, avec ses ancres de carte. */
  text: string;
  cardIds: ObjectId[];
}

/**
 * Nombre de cartes qu'une ligne de journal nomme avant de replier le reste
 * dans « … et N autres cartes ».
 *
 * La valeur est calibrée sur la colonne de journal — 288 pixels de large, six
 * ou sept lignes visibles : six noms tiennent en deux lignes, et c'est l'ordre
 * de grandeur des lots réels. Au-delà, ce que le journal a d'utile à dire est
 * le **compte** ; le détail est dans le cimetière, juste à côté.
 *
 * Elle vit ici parce que les deux côtés doivent la lire **pareil**. Le serveur
 * s'en sert pour couper l'énumération ; le client, pour savoir si une ligne
 * est dépliable et offrir « Voir les N cartes ». Il le déduit des seuls
 * `cardIds` et jamais du texte — l'abréviation est une phrase traduisible, la
 * découper casserait à la première langue ajoutée. Deux copies qui dérivent
 * donnent donc un bouton en trop ou un bouton manquant : jamais une
 * divulgation, mais un défaut visible que rien ne rattrape.
 */
export const NAMED_LOG_LIMIT = 6;

export interface LookSummary {
  mode: LookMode;
  count: number;
  toTop: number;
  toBottom: number;
  toHand: number;
  toGraveyard: number;
  toExile: number;
  toBattlefield: number;
  toSideboard: number;
  shuffled: boolean;
}
