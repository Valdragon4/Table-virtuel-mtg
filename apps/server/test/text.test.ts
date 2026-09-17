import { describe, expect, it } from 'vitest';
import { parseDeckText } from '../src/import/text.js';

/** Raccourci de lecture : `quantité×nom` pour comparer une liste d'un coup d'œil. */
function shape(input: string) {
  const parsed = parseDeckText(input);
  return parsed.lines.map((l) => `${l.quantity}x${l.name}${l.isFoil ? ' *F*' : ''}@${l.zone}`);
}

describe('formes de quantité et de nom', () => {
  it('lit les variantes usuelles de quantité', () => {
    expect(shape('1 Sol Ring')).toEqual(['1xSol Ring@MAIN']);
    expect(shape('1x Sol Ring')).toEqual(['1xSol Ring@MAIN']);
    expect(shape('x4 Lightning Bolt')).toEqual(['4xLightning Bolt@MAIN']);
    expect(shape('12 Forest')).toEqual(['12xForest@MAIN']);
  });

  it('accepte une ligne sans quantité', () => {
    expect(shape('Sol Ring')).toEqual(['1xSol Ring@MAIN']);
  });

  it('retient édition et numéro de collection', () => {
    const [line] = parseDeckText('1 Sol Ring (C21) 263').lines;
    expect(line).toMatchObject({ name: 'Sol Ring', setCode: 'c21', collectorNumber: '263', quantity: 1 });
  });

  it('retient le marqueur foil, avant ou après l’édition', () => {
    expect(shape('1 Sol Ring (C21) 263 *F*')).toEqual(['1xSol Ring *F*@MAIN']);
    expect(shape('1 Sol Ring *F*')).toEqual(['1xSol Ring *F*@MAIN']);
    expect(shape('1 Sol Ring (foil)')).toEqual(['1xSol Ring *F*@MAIN']);
  });

  it('ne prend pas un // interne pour un commentaire', () => {
    const [line] = parseDeckText('1 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki').lines;
    expect(line?.name).toBe('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki');
  });

  it('préserve accents et apostrophes typographiques dans le nom d’origine', () => {
    const [a, b] = parseDeckText("1 Juzám Djinn\n1 Gaea’s Cradle").lines;
    expect(a?.name).toBe('Juzám Djinn');
    expect(b?.name).toBe('Gaea’s Cradle');
  });
});

describe('sections', () => {
  it('bascule de zone sur un en-tête commenté', () => {
    const input = ['// Commander', '1 Selenia, the Cursed Heart', '', '// Deck', '1 Sol Ring'].join('\n');
    expect(shape(input)).toEqual(['1xSelenia, the Cursed Heart@COMMANDER', '1xSol Ring@MAIN']);
  });

  it('accepte un en-tête avec un compte entre parenthèses', () => {
    const input = ['Commander (1)', '1 Selenia, the Cursed Heart', 'Deck (2)', '2 Forest'].join('\n');
    expect(shape(input)).toEqual(['1xSelenia, the Cursed Heart@COMMANDER', '2xForest@MAIN']);
  });

  it('lit le préfixe SB: de MTGO', () => {
    expect(shape('4 Duress\nSB: 2 Duress')).toEqual(['4xDuress@MAIN', '2xDuress@SIDEBOARD']);
  });

  it('lit le marqueur *CMDR* de TappedOut', () => {
    expect(shape('1 Selenia, the Cursed Heart *CMDR*')).toEqual(['1xSelenia, the Cursed Heart@COMMANDER']);
  });

  it('ignore le maybeboard', () => {
    const input = ['Deck', '1 Sol Ring', 'Maybeboard', '1 Mana Crypt'].join('\n');
    expect(shape(input)).toEqual(['1xSol Ring@MAIN']);
  });

  it('traite la ligne vide de MTGO comme une séparation de réserve', () => {
    expect(shape('4 Lightning Bolt\n\n2 Duress')).toEqual(['4xLightning Bolt@MAIN', '2xDuress@SIDEBOARD']);
  });

  it('ne déclenche pas cette heuristique quand le document a des en-têtes', () => {
    const input = ['Deck', '4 Lightning Bolt', '', '2 Duress', '', 'Sideboard', '1 Duress'].join('\n');
    expect(shape(input)).toEqual(['4xLightning Bolt@MAIN', '2xDuress@MAIN', '1xDuress@SIDEBOARD']);
  });
});

describe('exports réels', () => {
  it('avale un export Moxfield', () => {
    const input = [
      '1 Selenia, the Cursed Heart (BRC) 3 *F*',
      '1 Sol Ring (C21) 263',
      '1 Arcane Signet (ELD) 331',
      '',
      'SIDEBOARD:',
      '1 Swords to Plowshares (STA) 12',
    ].join('\n');

    expect(shape(input)).toEqual([
      '1xSelenia, the Cursed Heart *F*@MAIN',
      '1xSol Ring@MAIN',
      '1xArcane Signet@MAIN',
      '1xSwords to Plowshares@SIDEBOARD',
    ]);
  });

  it('avale un export Archidekt, catégories entre crochets comprises', () => {
    const input = [
      '1x Selenia, the Cursed Heart (brc) 3 [Commander{top}]',
      '1x Sol Ring (c21) 263 [Ramp]',
      '1x Terramorphic Expanse (mkc) 273 [Land]',
    ].join('\n');

    const parsed = parseDeckText(input);
    expect(parsed.lines.map((l) => l.name)).toEqual([
      'Selenia, the Cursed Heart',
      'Sol Ring',
      'Terramorphic Expanse',
    ]);
    expect(parsed.lines[0]).toMatchObject({ setCode: 'brc', collectorNumber: '3' });
  });

  it('avale un export MTGO', () => {
    const input = ['4 Lightning Bolt', '20 Mountain', '', '3 Smash to Smithereens', '2 Duress'].join('\n');
    expect(shape(input)).toEqual([
      '4xLightning Bolt@MAIN',
      '20xMountain@MAIN',
      '3xSmash to Smithereens@SIDEBOARD',
      '2xDuress@SIDEBOARD',
    ]);
  });

  it('avale un export TappedOut', () => {
    const input = [
      '1x Selenia, the Cursed Heart *CMDR*',
      '1x Sol Ring (C21)',
      '1x Exalted Sunborn',
    ].join('\n');
    expect(shape(input)).toEqual([
      '1xSelenia, the Cursed Heart@COMMANDER',
      '1xSol Ring@MAIN',
      '1xExalted Sunborn@MAIN',
    ]);
  });
});

describe('robustesse', () => {
  it('ignore commentaires, lignes de total et lignes vides', () => {
    const input = [
      '// Deck exporté le 12/03',
      '# note personnelle',
      '',
      '1 Sol Ring',
      'Total: 100',
    ].join('\n');
    expect(shape(input)).toEqual(['1xSol Ring@MAIN']);
  });

  it('remonte une ligne illisible sans perdre les autres', () => {
    const parsed = parseDeckText('1 Sol Ring\n42\n1 Arcane Signet');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.unparsed).toEqual([
      { raw: '42', lineNumber: 2, reason: 'Aucun nom de carte identifiable' },
    ]);
  });

  it('conserve la ligne d’origine pour le rapport d’import', () => {
    const parsed = parseDeckText('  1x   Sol Ring (C21) 263 *F*  ');
    expect(parsed.lines[0]?.raw).toBe('  1x   Sol Ring (C21) 263 *F*  ');
    expect(parsed.lines[0]?.lineNumber).toBe(1);
  });

  it('lit un nom de deck en en-tête', () => {
    const parsed = parseDeckText('Name: Selenia Lifegain\n1 Sol Ring');
    expect(parsed.name).toBe('Selenia Lifegain');
    expect(parsed.lines).toHaveLength(1);
  });

  it('accepte les fins de ligne Windows', () => {
    expect(shape('1 Sol Ring\r\n1 Arcane Signet')).toEqual(['1xSol Ring@MAIN', '1xArcane Signet@MAIN']);
  });

  it('ne casse pas sur une entrée vide', () => {
    expect(parseDeckText('')).toEqual({ lines: [], unparsed: [] });
  });
});
