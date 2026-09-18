/**
 * Le rendu des coûts de mana.
 *
 * Ce qui est vérifié ici n'est pas « ça affiche quelque chose » mais les trois
 * endroits où ce composant peut mentir :
 *
 * 1. **L'invariant de droits.** Toute URL produite doit pointer chez Scryfall,
 *    jamais chez nous. C'est la propriété qui compte le plus de ce fichier :
 *    le jour où quelqu'un « optimise » en copiant les SVG dans `public/`, ce
 *    test casse.
 * 2. **Rien ne se perd.** Un symbole inconnu doit ressortir en texte, accolades
 *    comprises, et la chaîne d'origine doit se reconstituer morceau par
 *    morceau. Un coût amputé en silence est pire qu'un coût illisible.
 * 3. **L'énoncé au lecteur d'écran.** Une suite d'images muettes n'est rien ;
 *    on vérifie que le coût complet reste dicible, dans les deux langues.
 */
import { describe, expect, it } from 'vitest';
import {
  manaCostLabel,
  manaSymbolUrl,
  parseManaCost,
} from '../src/components/ManaCost.js';
import { translator } from '../src/lib/i18n/translate.js';

const fr = translator('fr');
const en = translator('en');

describe('URL des symboles', () => {
  it('ne rend que des URL du CDN Scryfall', () => {
    // L'invariant de `docs/i18n.md` §5 : rien n'est hébergé ni copié chez nous.
    const costs = '{2}{W}{W}{X}{C}{S}{W/U}{2/W}{W/P}{G/U/P}{T}{½}{∞}';
    const urls = parseManaCost(costs)
      .filter((token) => token.kind === 'symbol')
      .map((token) => token.url);
    expect(urls.length).toBe(13);
    for (const url of urls) {
      expect(url.startsWith('https://svgs.scryfall.io/card-symbols/')).toBe(true);
    }
  });

  it('suit les noms de fichier relevés chez Scryfall, exceptions comprises', () => {
    // Relevés sur `https://api.scryfall.com/symbology`. Les deux dernières sont
    // précisément celles qu'un motif calculé raterait.
    expect(manaSymbolUrl('W')).toBe('https://svgs.scryfall.io/card-symbols/W.svg');
    expect(manaSymbolUrl('10')).toBe('https://svgs.scryfall.io/card-symbols/10.svg');
    expect(manaSymbolUrl('W/U')).toBe('https://svgs.scryfall.io/card-symbols/WU.svg');
    expect(manaSymbolUrl('2/W')).toBe('https://svgs.scryfall.io/card-symbols/2W.svg');
    expect(manaSymbolUrl('W/P')).toBe('https://svgs.scryfall.io/card-symbols/WP.svg');
    expect(manaSymbolUrl('S')).toBe('https://svgs.scryfall.io/card-symbols/S.svg');
    expect(manaSymbolUrl('½')).toBe('https://svgs.scryfall.io/card-symbols/HALF.svg');
    expect(manaSymbolUrl('∞')).toBe('https://svgs.scryfall.io/card-symbols/INFINITY.svg');
  });

  it('accepte la minuscule sans inventer une seconde URL', () => {
    // Le catalogue écrit `{W}`, mais une saisie humaine écrit `{w}` — et c'est
    // d'ailleurs la forme que l'utilisateur a employée en signalant le défaut.
    expect(manaSymbolUrl('w')).toBe(manaSymbolUrl('W'));
  });

  it('ne connaît pas un symbole inventé', () => {
    expect(manaSymbolUrl('FOO')).toBeUndefined();
  });
});

describe('découpage', () => {
  it('sépare chaque symbole d’un coût courant', () => {
    const tokens = parseManaCost('{2}{W}{W}');
    expect(tokens.map((token) => token.kind)).toEqual(['symbol', 'symbol', 'symbol']);
    expect(tokens.map((token) => token.raw)).toEqual(['{2}', '{W}', '{W}']);
  });

  it('laisse un symbole inconnu en texte plutôt que de l’escamoter', () => {
    const tokens = parseManaCost('{W}{FOO}{U}');
    expect(tokens.map((token) => token.kind)).toEqual(['symbol', 'text', 'symbol']);
    expect(tokens[1]?.raw).toBe('{FOO}');
  });

  it('ne perd jamais un caractère', () => {
    // La concaténation des morceaux doit rendre la chaîne d'origine, y compris
    // le `//` des cartes à deux faces et les accolades inconnues.
    for (const cost of ['{2}{W}{W}', '{3}{G} // {1}{U}', '{W}{FOO}', 'texte libre', '{']) {
      expect(parseManaCost(cost).map((token) => token.raw).join('')).toBe(cost);
    }
  });

  it('ne rend rien pour une carte sans coût', () => {
    // Une terre. Pas de cadre vide, pas de puce orpheline.
    expect(parseManaCost('')).toEqual([]);
  });
});

describe('énoncé au lecteur d’écran', () => {
  it('dit le coût entier, pas une suite d’images muettes', () => {
    expect(manaCostLabel('{2}{W}{W}', fr)).toBe('Coût de mana : 2 générique, blanc, blanc');
    expect(manaCostLabel('{2}{W}{W}', en)).toBe('Mana cost: 2 generic, white, white');
  });

  it('dit l’hybride comme un choix, et le phyrexian comme un qualificatif', () => {
    expect(manaCostLabel('{W/U}', fr)).toBe('Coût de mana : blanc ou bleu');
    expect(manaCostLabel('{2/W}', fr)).toBe('Coût de mana : 2 générique ou blanc');
    expect(manaCostLabel('{W/P}', fr)).toBe('Coût de mana : blanc phyrexian');
    expect(manaCostLabel('{G/U/P}', en)).toBe('Mana cost: Phyrexian green or blue');
  });

  it('dit X, l’incolore et la neige', () => {
    expect(manaCostLabel('{X}{C}{S}', fr)).toBe('Coût de mana : X générique, incolore, neige');
  });

  it('dicte un symbole inconnu tel quel plutôt que de le taire', () => {
    expect(manaCostLabel('{FOO}', fr)).toBe('Coût de mana : {FOO}');
  });
});
