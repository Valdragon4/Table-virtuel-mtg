/**
 * Changer de point de vue ne doit pas changer d'instant.
 *
 * La bascule n'a d'intérêt que **sur un moment donné** : on avance jusqu'à
 * l'action intéressante, on passe sur la vue de l'adversaire pour comprendre ce
 * qu'il savait à ce moment-là. Repartir du début, c'est perdre exactement ce
 * qu'on était venu voir.
 *
 * Le repère est le `seq`, jamais le rang dans la liste : un rang ne désigne le
 * même instant que si les deux vues ont exactement les mêmes pas. C'est le cas
 * aujourd'hui, mais c'est une propriété du serveur, pas du lecteur — et ce
 * fichier vérifie donc les deux : que l'ancre tient dans le cas nominal, et
 * qu'elle se rabat proprement si les pas venaient à différer.
 */
import { describe, expect, it } from 'vitest';
import { cursorForSeq, currentSeq, type ReplayHead, type ReplayStep } from '../src/store/replay.js';

const step = (seq: number): ReplayStep => ({ seq, at: 0, actor: null, event: { type: 'NOTED' } });

const head = (startSeq: number): ReplayHead =>
  ({ startSeq, views: [], snapshot: {} }) as unknown as ReplayHead;

describe('l’ancre d’un changement de point de vue', () => {
  it('retrouve le même pas quand les deux vues portent les mêmes seq', () => {
    const steps = [70, 71, 72, 73, 74, 75, 76].map(step);
    // On regardait le pas 5, donc le `seq` 74.
    expect(currentSeq({ steps, cursor: 5, head: head(69) })).toBe(74);
    // Dans l'autre vue — mêmes seq — on doit retomber sur le pas 5.
    expect(cursorForSeq(steps, 74)).toBe(5);
  });

  it('se place au pas le plus proche en deçà quand le seq manque', () => {
    /*
     * Le cas que la §5 rend improbable mais que le lecteur ne doit pas
     * supposer : une vue à qui il manquerait des pas. On montre alors l'état
     * de la partie à cet instant **tel que ce siège le connaissait**, ce qui
     * est la question posée — et surtout pas le début de la partie.
     */
    const trouee = [70, 72, 75, 76].map(step);
    expect(cursorForSeq(trouee, 74)).toBe(2); // 70 et 72 appliqués, pas 75
    expect(cursorForSeq(trouee, 75)).toBe(3);
    expect(cursorForSeq(trouee, 1000)).toBe(4); // jamais au-delà de la fin
  });

  it('revient au point zéro, et seulement là, quand il n’y a pas d’ancre', () => {
    const steps = [70, 71, 72].map(step);
    expect(cursorForSeq(steps, null)).toBe(0);
    expect(cursorForSeq(steps, undefined)).toBe(0);
    // Un `seq` antérieur au premier pas, c'est le point zéro : l'état de
    // départ est celui du snapshot d'origine, il n'y a rien à appliquer.
    expect(cursorForSeq(steps, 69)).toBe(0);
  });

  it('rend le seq du point de départ quand rien n’est encore appliqué', () => {
    const steps = [70, 71].map(step);
    expect(currentSeq({ steps, cursor: 0, head: head(69) })).toBe(69);
    // Aller-retour : ce `seq`-là ramène bien au pas zéro dans l'autre vue.
    expect(cursorForSeq(steps, 69)).toBe(0);
  });

  it('ne rend pas d’ancre tant qu’aucun replay n’est chargé', () => {
    expect(currentSeq({ steps: [], cursor: 0, head: null })).toBeNull();
  });
});
