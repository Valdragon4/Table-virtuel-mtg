/**
 * Les **types de carte**, tels qu'une ligne de type les écrit — et rien de plus.
 *
 * Ce petit catalogue existe parce que « Découvrir par type » a besoin du même
 * mot aux deux bouts : le client le propose dans un dialogue, le serveur le
 * cherche dans une ligne de type. Le faire vivre dans `@mtg/shared` est la
 * seule façon d'être sûr qu'ils parlent du même « enchantment » ; écrit deux
 * fois, il aurait divergé à la première extension.
 *
 * **La liste n'est pas inventée ici, elle est reprise.** Le dépôt la porte déjà
 * à deux endroits, pour d'autres usages :
 *  - `TYPE_FAMILIES` (`ZonePanel.tsx`), qui classe une zone en sept familles et
 *    porte déjà les clés de traduction `type.*` ;
 *  - `TYPE_KEYWORDS` (`CardSprite.tsx`), qui compte les types d'un permanent
 *    pour les marqueurs calculés, et qui ajoute `battle`, `kindred` et son
 *    synonyme historique `tribal`.
 *
 * Celle-ci est leur **réunion**, moins les deux mots qui ne sont pas des types
 * de carte offrables : `tribal` n'est qu'un ancien nom de `kindred`, et
 * `kindred` lui-même n'existe jamais seul — il se lit « Kindred Instant »,
 * « Kindred Enchantment », et le joueur qui cherche l'un ou l'autre demande en
 * réalité le second mot. Les deux restent atteignables : le champ de critère du
 * protocole est une chaîne libre, et rien n'interdit à un client d'y mettre un
 * mot que cette liste ne propose pas. **On ne propose pas tout ; on n'interdit
 * rien.**
 *
 * Les deux listes voisines ne sont **pas** réécrites pour importer celle-ci, et
 * c'est délibéré : elles répondent à d'autres questions (classer une zone,
 * compter des familles), leur ordre est un ordre d'affichage éprouvé, et y
 * injecter `battle` changerait des pastilles et des filtres qui n'ont rien
 * demandé. Le jour où une troisième question se pose, c'est ce fichier-ci qui
 * devra les absorber, pas l'inverse.
 *
 * Le mot est **anglais**, parce que les lignes de type du catalogue le sont
 * (voir `canonSubtype` côté client : le canon stocké et transmis est anglais,
 * le français est un vernis d'affichage). Le libellé français vit dans les
 * catalogues d'interface, sous les clés `discoverType.*`.
 */

/** Un type de carte : le mot qu'une ligne de type porte, et sa permanence. */
export interface CardTypeSpec {
  /** Le mot, tel qu'il s'écrit en anglais sur une ligne de type, en minuscules. */
  readonly key: string;
  /**
   * Ce type fait-il un **permanent** ?
   *
   * C'est la seule connaissance de règles portée par ce fichier, et elle est
   * assumée : « permanent » est une catégorie que les cartes nomment, pas un
   * jugement que l'on invente. Elle ne sert qu'à **composer une union de types**
   * quand le joueur demande « un permanent » — jamais à refuser quoi que ce
   * soit, jamais à décider à sa place.
   */
  readonly permanent: boolean;
}

export const CARD_TYPES: readonly CardTypeSpec[] = [
  { key: 'creature', permanent: true },
  { key: 'planeswalker', permanent: true },
  { key: 'land', permanent: true },
  { key: 'artifact', permanent: true },
  { key: 'enchantment', permanent: true },
  { key: 'battle', permanent: true },
  { key: 'instant', permanent: false },
  { key: 'sorcery', permanent: false },
];

/** Les seuls types qui font un permanent — l'union que « Permanent » désigne. */
export const PERMANENT_TYPES: readonly string[] = CARD_TYPES.filter((t) => t.permanent).map(
  (t) => t.key,
);
