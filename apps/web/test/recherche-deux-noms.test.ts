/**
 * La recherche répond aux deux noms de la carte.
 *
 * Le défaut mesuré : les vignettes affichaient « Anneau solaire » et le filtre
 * interrogeait « Sol Ring ». Un joueur français qui tapait « Anneau » dans son
 * cimetière ne trouvait rien, la carte sous les yeux. Sur un deck réel de 84
 * lignes, les noms imprimés sont passés de 55 à 82 : la recherche n'était plus
 * cassée par exception, elle l'était par règle.
 *
 * Ce que ce fichier garde, et qui ne se voit dans aucune exception :
 *
 * 1. **Les deux noms répondent.** L'anglais parce que c'est ce qui est écrit
 *    sur la carte physique et dans les listes de deck ; le français parce que
 *    c'est ce que l'écran affiche.
 * 2. **Accents et casse ne comptent pas**, et la normalisation est celle de
 *    `Dialog` — une seule dans le projet, pas une variante par écran.
 * 3. **Une traduction pas encore arrivée ne casse rien.** La résolution est
 *    asynchrone : au premier rendu une carte n'a souvent que son nom anglais,
 *    et le filtre doit chercher dans ce qui est disponible.
 * 4. **Le nom anglais reste la clé** partout ailleurs : tri, regroupement,
 *    envoi au serveur. C'est de la lecture de source, parce qu'une
 *    substitution malheureuse ne lèverait rien et ne casserait pas `tsc`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchesCardQuery } from '../src/components/ZonePanel.js';
import { foldForSearch } from '../src/components/Dialog.js';

function source(file: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../src/components/${file}`, import.meta.url)),
    'utf8',
  );
}

/** Le couple que le panneau de zone passe au filtre, dans cet ordre. */
const ANNEAU = ['Sol Ring', 'Anneau solaire'] as const;

describe('le filtre répond aux deux noms', () => {
  it('trouve par le nom imprimé, celui que le joueur a sous les yeux', () => {
    expect(matchesCardQuery('Anneau', ...ANNEAU)).toBe(true);
  });

  it('trouve par le nom du catalogue, celui de la carte physique et des listes', () => {
    expect(matchesCardQuery('Sol Ring', ...ANNEAU)).toBe(true);
  });

  it('trouve par un fragment du milieu, comme toute recherche « contient »', () => {
    expect(matchesCardQuery('solaire', ...ANNEAU)).toBe(true);
  });

  it('ne retient pas une carte qu’aucun des deux noms ne désigne', () => {
    expect(matchesCardQuery('bolt', ...ANNEAU)).toBe(false);
  });

  it('rend toute la zone quand la saisie est vide', () => {
    expect(matchesCardQuery('', ...ANNEAU)).toBe(true);
    expect(matchesCardQuery('   ', ...ANNEAU)).toBe(true);
  });
});

describe('les accents et la casse ne se tapent pas', () => {
  it('trouve « Anneau solaire » en minuscules comme en capitales', () => {
    expect(matchesCardQuery('anneau', ...ANNEAU)).toBe(true);
    expect(matchesCardQuery('ANNEAU', ...ANNEAU)).toBe(true);
  });

  it('trouve un nom accentué sans que l’accent soit tapé', () => {
    // Personne ne tape les accents dans un champ de recherche.
    expect(matchesCardQuery('ephemere', 'Lightning Bolt', 'Éphémère foudroyant')).toBe(true);
    expect(matchesCardQuery('foret', 'Forest', 'Forêt')).toBe(true);
  });

  it('trouve aussi quand c’est la saisie qui porte l’accent', () => {
    expect(matchesCardQuery('Forêt', 'Forest', 'Foret')).toBe(true);
  });

  it('ignore la ponctuation des deux côtés', () => {
    // La virgule recopiée d'une liste de deck ne doit rien empêcher.
    expect(matchesCardQuery('Jace,', 'Jace, the Mind Sculptor', 'Jace, le sculpteur de pensées')).toBe(
      true,
    );
  });

  it('réutilise le repli de `Dialog`, sans seconde variante', () => {
    // La garde qui compte : si quelqu'un écrivait une normalisation locale, ce
    // test continuerait de passer par accident. C'est donc la **source** qui le
    // dit, et le calcul ci-dessous qui vérifie qu'elles coïncident.
    expect(source('ZonePanel.tsx')).toContain("from './Dialog.js'");
    expect(source('ZonePanel.tsx')).toContain('foldForSearch');
    expect(foldForSearch('Éphémère')).toBe('ephemere');
    expect(matchesCardQuery('Éphémère', 'Instant', 'ephemere')).toBe(true);
  });
});

describe('une traduction pas encore arrivée ne casse rien', () => {
  it('cherche dans le seul nom disponible', () => {
    expect(matchesCardQuery('sol', 'Sol Ring', undefined)).toBe(true);
    expect(matchesCardQuery('sol', 'Sol Ring', null)).toBe(true);
  });

  it('ne vide pas la liste quand le nom imprimé vaut encore l’anglais', () => {
    // C'est le cas courant : `localizedCardName` retombe sur le catalogue tant
    // que le lot n'est pas rentré, et les deux noms sont alors identiques.
    expect(matchesCardQuery('ring', 'Sol Ring', 'Sol Ring')).toBe(true);
  });

  it('ne lève pas sur une carte dont la fiche n’est pas chargée', () => {
    // `cardName` rend « … » tant que la métadonnée manque : ce n'est pas une
    // correspondance, et surtout pas une exception.
    expect(() => matchesCardQuery('anneau', '…', undefined)).not.toThrow();
    expect(matchesCardQuery('anneau', '…', undefined)).toBe(false);
  });

  it('accepte une carte sans aucun nom du tout', () => {
    expect(matchesCardQuery('anneau')).toBe(false);
    expect(matchesCardQuery('')).toBe(true);
  });
});

describe('le nom anglais reste la clé partout ailleurs', () => {
  it('le panneau de zone trie sur l’ordre reçu, pas sur un nom', () => {
    const code = source('ZonePanel.tsx');
    expect(code).toContain('.sort((a, b) => a.sortIndex - b.sortIndex)');
  });

  it('la liste d’avant-partie regroupe et ordonne toujours sur le catalogue', () => {
    const code = source('PreGameDeck.tsx');
    expect(code).toContain("cardName(card.scryfallId) : '…'");
    expect(code).toContain("a.name.localeCompare(b.name, 'fr')");
  });

  it('la fouille trie sur le nom du catalogue, et filtre sur les deux', () => {
    const code = source('LookModal.tsx');
    // Le tri lit `meta?.name`, anglais : trier sur le nom imprimé ferait sauter
    // les lignes à mesure que les lots de résolution rentrent.
    expect(code).toContain("if (sort === 'nom') return meta?.name ?? '';");
    expect(code).toContain('matchesCardQuery(filter, meta?.name, printed');
  });

  it('les trois vues passent par le même filtre, et n’en réécrivent pas un', () => {
    for (const file of ['ZonePanel.tsx', 'LookModal.tsx', 'PreGameDeck.tsx']) {
      expect(source(file)).toContain('matchesCardQuery(');
      // Le motif d'origine, celui qui ne regardait qu'un seul nom.
      expect(source(file)).not.toMatch(/toLowerCase\(\)\.includes\(/);
    }
  });
});
