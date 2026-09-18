/**
 * Le bandeau de nom d'un jeton, écrit **par-dessus** son illustration.
 *
 * ## Pourquoi il faut peindre le nom sur l'image
 *
 * Le glossaire (`lib/i18n/tokenNames.ts`) sait dire « Gredin », « Shamane »,
 * « Peuple fée ». Le joueur ne le voyait nulle part : les trois endroits où un
 * jeton apparaît — l'étagère, la recherche, la table — ne montrent que son
 * illustration, et l'illustration est anglaise.
 *
 * Et il n'y a rien d'autre à aller chercher. Scryfall ne publie **aucun** jeton
 * dans une autre langue que l'anglais : sur les 2 838 jetons de notre catalogue,
 * les 110 pour lesquels une impression française a été cherchée sont toutes
 * marquées « introuvable ». Le nom peint sur la carte restera anglais quoi qu'on
 * fasse ; la seule issue est d'écrire le nôtre au-dessus.
 *
 * ## La forme, et ce qu'elle coûte
 *
 * Une bande basse, translucide, sur toute la largeur, texte centré et tronqué.
 * Basse parce que le haut de la carte porte déjà son nom imprimé et que le
 * recouvrir serait mentir sur ce qui est écrit ; sur toute la largeur parce
 * qu'un jeton dézoomé fait quelques dizaines de pixels et qu'un bandeau plus
 * étroit ne tiendrait plus un mot ; tronquée parce que « Tortue terrestre »
 * existe et qu'un retour à la ligne mangerait l'illustration.
 *
 * ## Deux choses qu'il ne fait pas, et c'est le cœur du fichier
 *
 * **Il n'est jamais touché par le pointeur.** La table entière repose sur le
 * survol et le glisser-déposer, et un bandeau posé en bas d'une carte se trouve
 * exactement là où l'on attrape un permanent. `pointer-events: none`, comme
 * l'aperçu agrandi.
 *
 * **Il ne lit aucun store.** Le nom lui est passé en argument, déjà calculé par
 * l'appelant, qui l'avait de toute façon pour son `title` et son `alt`. Un
 * abonnement de plus ici re-rendrait le plan de table à chaque survol — la
 * recette mesure ces rendus et exige zéro — et un sélecteur qui fabriquerait un
 * tableau ne serait jamais égal à lui-même (React #185).
 */
import type { Language } from '@mtg/shared';
import { tokenName } from '../lib/i18n/index.js';

/**
 * Le nom à peindre sur un jeton, ou `null` s'il n'y a rien à peindre.
 *
 * **C'est ici que vit l'invariant d'information cachée**, et il vaut mieux qu'il
 * vive à un seul endroit, testable, plutôt que recopié dans trois composants :
 * une carte dont l'identité nous est cachée ne montre **jamais** son nom. Le
 * bandeau serait sinon la pire des fuites — on lirait « Gobelin » sur un dos de
 * carte, et le joueur d'en face saurait que notre client, lui, sait.
 *
 * Deux conditions, toutes deux nécessaires :
 *
 *  - `kind === 'TOKEN'` — c'est le **protocole** qui dit qu'un objet est un
 *    jeton. Pas une heuristique sur la ligne de type : une carte ordinaire dont
 *    le type contient « Token » n'en est pas un, et un jeton copie d'une carte
 *    existante en est un sans que sa ligne de type le dise.
 *  - `identityKnown` — l'appelant a vérifié que l'identité lui est connue. Côté
 *    table cela s'écrit `card.faceDown === false`, et c'est exactement la
 *    condition sous laquelle l'illustration elle-même est affichée : le bandeau
 *    ne peut donc pas apparaître sur un dos, il apparaît ou disparaît avec
 *    l'image qu'il légende.
 *
 * Le nom rendu est celui du glossaire quand il existe, le nom du catalogue
 * sinon — `tokenName` laisse l'anglais intact plutôt que de traduire à moitié.
 */
export function tokenBandName({
  kind,
  identityKnown,
  name,
  language,
}: {
  /** `card.kind` tel que le protocole le publie. */
  kind: string | null | undefined;
  /** L'appelant sait-il de quelle carte il s'agit ? */
  identityKnown: boolean;
  /** Le nom déjà localisé côté catalogue (anglais, pour un jeton). */
  name: string | null | undefined;
  language: Language;
}): string | null {
  if (kind !== 'TOKEN' || !identityKnown) return null;
  const nom = tokenName(name, language) ?? name;
  return nom && nom.length > 0 ? nom : null;
}

/**
 * Le bandeau lui-même.
 *
 * `fontSize` est en pixels et **tout le reste en `em`** : marges, hauteur,
 * arrondi. C'est ce qui permet à un seul composant de servir une vignette
 * d'étagère de 70 px et un permanent de table dont la taille dépend de
 * `scale` — `CardSprite` passe `16 * scale`, ce qui donne les 8 px des autres
 * repères du sprite au champ de bataille (`BATTLEFIELD_SCALE` vaut 0,5), moins
 * sur une vignette de pile, plus dans la consultation agrandie. Un bandeau à
 * taille fixe aurait été illisible d'un côté et énorme de l'autre.
 *
 * Le conteneur doit être positionné (`relative`) : le bandeau se colle à son
 * bord bas.
 */
export function TokenNameBand({
  name,
  fontSize = 10,
}: {
  name: string;
  /** Taille du texte en pixels ; tout le reste en découle. */
  fontSize?: number;
}): React.ReactElement {
  return (
    <span
      /*
        `pointer-events-none` : voir l'en-tête du fichier. C'est la seule classe
        de cette liste dont l'absence casserait autre chose que l'esthétique.
      */
      className="pointer-events-none absolute inset-x-0 bottom-0 block truncate rounded-b-[inherit] bg-slate-950/80 text-center font-semibold text-white"
      data-test="token-name-band"
      style={{
        fontSize,
        // Tout en `em` : le bandeau garde ses proportions à toutes les échelles.
        lineHeight: 1.35,
        paddingLeft: '0.3em',
        paddingRight: '0.3em',
        paddingTop: '0.1em',
        paddingBottom: '0.1em',
        // Le fond translucide ne suffit pas sur une illustration claire ; une
        // ombre portée d'un demi-caractère décolle le texte sans l'épaissir.
        textShadow: '0 0.05em 0.1em rgba(0,0,0,0.9)',
      }}
    >
      {name}
    </span>
  );
}
