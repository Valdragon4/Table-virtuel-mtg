/**
 * Le coût de mana, rendu en symboles.
 *
 * Un joueur lit `{2}{W}{W}` en le déchiffrant ; il lit deux ronds blancs et un
 * « 2 » d'un coup d'œil. La fouille de bibliothèque est justement le moment où
 * l'on parcourt vingt vignettes en quelques secondes : c'est là que le texte
 * brut coûte le plus cher.
 *
 * **L'invariant de droits d'abord** (`docs/i18n.md`, §5). Les symboles de mana
 * sont la propriété de Wizards of the Coast, au même titre que les
 * illustrations, et la règle est la même : *rien n'est hébergé, proxifié ni mis
 * en cache par nous*. Ce fichier ne contient donc **aucun dessin** — ni SVG
 * inliné, ni copie dans `public/`, ni préchargement. Il ne contient que des
 * **URL**, que le navigateur du joueur va chercher lui-même chez Scryfall,
 * exactement comme il va chercher les faces de cartes. Le service worker laisse
 * passer tout ce qui n'est pas notre origine, ces requêtes ne sont donc jamais
 * mises en cache par notre code non plus — un cache est une copie.
 *
 * **D'où vient la table ci-dessous.** Elle n'est pas devinée : elle est relevée
 * sur `https://api.scryfall.com/symbology`, qui publie pour chaque symbole son
 * `symbol` et son `svg_uri`. Les 84 symboles connus y vivent tous sous le même
 * préfixe, et le nom de fichier est presque toujours le symbole sans ses
 * accolades ni ses barres obliques — **presque**, et c'est pour ces exceptions
 * (`{½}` → `HALF.svg`, `{∞}` → `INFINITY.svg`) que la table est explicite
 * plutôt que calculée. Une URL fabriquée à la main donnerait une image absente
 * en silence, c'est-à-dire un coût de mana amputé sans que rien ne le signale.
 *
 * **Le texte reste la source.** Le coût arrive tel que le catalogue le donne, et
 * ce composant ne le réécrit pas : il le découpe et le rend. Un symbole qui
 * n'est pas dans la table est affiché **en toutes lettres**, accolades
 * comprises. C'est délibéré : un symbole manquant doit se voir, pas disparaître.
 */
import { useT, type BoundT } from '../lib/i18n/index.js';

/**
 * Le préfixe relevé chez Scryfall. Les 84 symboles publiés le partagent, sans
 * exception ; ce qui varie est uniquement le nom de fichier, d'où la table.
 */
const SYMBOL_BASE = 'https://svgs.scryfall.io/card-symbols/';

/**
 * Symbole (sans accolades) → nom de fichier de son SVG chez Scryfall.
 *
 * Relevé tel quel sur `/symbology`. Ajouter un symbole, c'est ajouter une ligne
 * ici après avoir vérifié son `svg_uri` — jamais extrapoler un motif.
 */
const SYMBOL_FILES: Readonly<Record<string, string>> = {
  T: 'T',
  Q: 'Q',
  E: 'E',
  P: 'P',
  PW: 'PW',
  CHAOS: 'CHAOS',
  A: 'A',
  TK: 'TK',
  X: 'X',
  Y: 'Y',
  Z: 'Z',
  '0': '0',
  '½': 'HALF',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  '11': '11',
  '12': '12',
  '13': '13',
  '14': '14',
  '15': '15',
  '16': '16',
  '17': '17',
  '18': '18',
  '19': '19',
  '20': '20',
  '100': '100',
  '1000000': '1000000',
  '∞': 'INFINITY',
  'W/U': 'WU',
  'W/B': 'WB',
  'B/R': 'BR',
  'B/G': 'BG',
  'U/B': 'UB',
  'U/R': 'UR',
  'R/G': 'RG',
  'R/W': 'RW',
  'G/W': 'GW',
  'G/U': 'GU',
  'B/G/P': 'BGP',
  'B/R/P': 'BRP',
  'G/U/P': 'GUP',
  'G/W/P': 'GWP',
  'R/G/P': 'RGP',
  'R/W/P': 'RWP',
  'U/B/P': 'UBP',
  'U/R/P': 'URP',
  'W/B/P': 'WBP',
  'W/U/P': 'WUP',
  'C/W': 'CW',
  'C/U': 'CU',
  'C/B': 'CB',
  'C/R': 'CR',
  'C/G': 'CG',
  '2/W': '2W',
  '2/U': '2U',
  '2/B': '2B',
  '2/R': '2R',
  '2/G': '2G',
  H: 'H',
  'W/P': 'WP',
  'U/P': 'UP',
  'B/P': 'BP',
  'R/P': 'RP',
  'G/P': 'GP',
  'C/P': 'CP',
  HW: 'HW',
  HR: 'HR',
  W: 'W',
  U: 'U',
  B: 'B',
  R: 'R',
  G: 'G',
  C: 'C',
  S: 'S',
  L: 'L',
  D: 'D',
};

/** Le contenu d'accolades, normalisé comme Scryfall l'écrit : majuscules. */
function normalize(inner: string): string {
  return inner.trim().toUpperCase();
}

/**
 * L'URL du SVG d'un symbole chez Scryfall, ou `undefined` s'il nous est inconnu.
 *
 * Exportée pour les tests : c'est la seule chose que ce composant produit qui
 * puisse être vérifiée sans DOM, et c'est celle qui porte l'invariant de droits.
 */
export function manaSymbolUrl(inner: string): string | undefined {
  const file = SYMBOL_FILES[normalize(inner)];
  return file === undefined ? undefined : `${SYMBOL_BASE}${file}.svg`;
}

/** Un morceau de coût : soit un symbole reconnu, soit du texte laissé tel quel. */
export type ManaToken =
  | { kind: 'symbol'; inner: string; raw: string; url: string }
  | { kind: 'text'; raw: string };

/**
 * Découpe une chaîne de coût en morceaux.
 *
 * Tout ce qui n'est pas une accolade reconnue ressort en texte : les accolades
 * inconnues (`{FOO}`), mais aussi ce qui traîne entre elles, comme le `//` des
 * cartes à deux faces. Rien n'est jeté — la chaîne d'origine se reconstitue en
 * concaténant les `raw`, et un test le vérifie.
 */
export function parseManaCost(cost: string): ManaToken[] {
  const tokens: ManaToken[] = [];
  const pattern = /\{([^{}]*)\}/g;
  let last = 0;

  const pushText = (raw: string): void => {
    if (raw !== '') tokens.push({ kind: 'text', raw });
  };

  for (let match = pattern.exec(cost); match !== null; match = pattern.exec(cost)) {
    pushText(cost.slice(last, match.index));
    const raw = match[0];
    const inner = match[1] ?? '';
    const url = manaSymbolUrl(inner);
    if (url === undefined) pushText(raw);
    else tokens.push({ kind: 'symbol', inner: normalize(inner), raw, url });
    last = match.index + raw.length;
  }
  pushText(cost.slice(last));

  return tokens;
}

/** Les couleurs et les mots isolés, pour l'énoncé au lecteur d'écran. */
const PART_LABELS = {
  W: 'mana.white',
  U: 'mana.blue',
  B: 'mana.black',
  R: 'mana.red',
  G: 'mana.green',
  C: 'mana.colorless',
  S: 'mana.snow',
  T: 'mana.tap',
  Q: 'mana.untap',
  E: 'mana.energy',
} as const;

/** Un morceau de symbole hybride (`W`, `2`, `U`…) dit en toutes lettres. */
function partLabel(part: string, t: BoundT): string {
  const key = PART_LABELS[part as keyof typeof PART_LABELS];
  if (key !== undefined) return t(key);
  // Le générique couvre les chiffres autant que les variables : « 2 générique »,
  // « X générique ». C'est bien ce que dit la carte.
  if (/^(?:\d+|[XYZ])$/.test(part)) return t('mana.generic', { amount: part });
  return part;
}

/** Un symbole entier dit en toutes lettres : hybrides et phyrexians compris. */
function symbolLabel(inner: string, t: BoundT): string {
  const parts = inner.split('/');
  // Le `P` final marque le phyrexian et n'est pas un mana de plus : il qualifie
  // ce qui précède. `{W/P}` se dit « blanc phyrexian », pas « blanc ou P ».
  const phyrexian = parts.length > 1 && parts[parts.length - 1] === 'P';
  const spoken = (phyrexian ? parts.slice(0, -1) : parts)
    .map((part) => partLabel(part, t))
    .join(` ${t('mana.or')} `);
  return phyrexian ? t('mana.phyrexian', { part: spoken }) : spoken;
}

/**
 * Le coût entier dit en toutes lettres.
 *
 * Une suite d'images muettes est illisible au lecteur d'écran, et une suite
 * d'images légendées une par une est pire : elle énonce « blanc blanc blanc »
 * sans dire de quoi il s'agit. Le groupe porte donc **un seul** nom accessible,
 * et les images à l'intérieur sont décoratives.
 */
export function manaCostLabel(cost: string, t: BoundT): string {
  const spoken = parseManaCost(cost)
    .map((token) => (token.kind === 'symbol' ? symbolLabel(token.inner, t) : token.raw.trim()))
    .filter((piece) => piece !== '')
    .join(', ');
  return t('mana.costLabel', { cost: spoken });
}

/**
 * La taille suit le contexte : minuscule sur les vignettes de fouille, lisible
 * dans un panneau d'inspection. Trois pas suffisent — une prop libre en `px`
 * ferait diverger les vues sans que personne ne s'en aperçoive.
 *
 * Ces classes sont **fixes**, et c'est le point : la place est réservée avant
 * que l'image n'arrive. Des symboles qui se posent un par un décaleraient la
 * grille sous les yeux du joueur au moment précis où il la parcourt.
 */
const SIZES = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
} as const;

export type ManaCostSize = keyof typeof SIZES;

export function ManaCost({
  cost,
  size = 'md',
  className = '',
}: {
  cost: string | null | undefined;
  size?: ManaCostSize;
  className?: string;
}): React.ReactElement | null {
  const t = useT();

  // Une terre n'a pas de coût. Ne rien rendre du tout vaut mieux qu'un cadre
  // vide ou une puce orpheline à côté de son nom.
  if (!cost || cost.trim() === '') return null;

  const tokens = parseManaCost(cost);
  if (tokens.length === 0) return null;

  const box = SIZES[size];

  return (
    <span
      aria-label={manaCostLabel(cost, t)}
      className={`inline-flex shrink-0 items-center gap-[2px] align-middle ${className}`}
      data-test="mana-cost"
      role="img"
    >
      {tokens.map((token, index) =>
        token.kind === 'symbol' ? (
          <img
            // Décorative : le groupe entier porte déjà l'énoncé.
            alt=""
            aria-hidden="true"
            className={`${box} shrink-0 rounded-full`}
            draggable={false}
            key={`${token.raw}-${index}`}
            /* CDN Scryfall, directement : rien n'est hébergé ni copié chez nous. */
            src={token.url}
          />
        ) : (
          <span className="font-mono text-[0.9em] leading-none" key={`${token.raw}-${index}`}>
            {token.raw}
          </span>
        ),
      )}
    </span>
  );
}
