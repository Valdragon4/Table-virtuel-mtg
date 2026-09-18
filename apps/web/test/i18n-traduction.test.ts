/**
 * Le moteur de traduction.
 *
 * Ce qu'on vérifie n'est pas « la chaîne sort » mais les trois endroits où un
 * moteur naïf se trompe : le pluriel qui ne coupe pas au même endroit selon la
 * langue, l'interpolation multiple dans une phrase pluralisée, et la parité des
 * paramètres entre les deux catalogues. Le refus à la compilation d'une clé
 * inconnue, lui, est vérifié par `i18n-typage.test-d.ts`.
 */
import { describe, expect, it } from 'vitest';
import { fr } from '../src/lib/i18n/catalog.fr.js';
import { en } from '../src/lib/i18n/catalog.en.js';
import { interpolate, pluralForm, t, translator } from '../src/lib/i18n/translate.js';

describe('pluriel', () => {
  it('coupe à 2 en français et à 1 en anglais', () => {
    // C'est *la* différence qui rendait faux le `n > 1 ? 's' : ''` recopié
    // partout : « 0 carte » mais « 0 cards ».
    expect(t('fr', 'card.count', { count: 0 })).toBe('0 carte');
    expect(t('en', 'card.count', { count: 0 })).toBe('0 cards');
    expect(t('fr', 'card.count', { count: 1 })).toBe('1 carte');
    expect(t('en', 'card.count', { count: 1 })).toBe('1 card');
    expect(t('fr', 'card.count', { count: 3 })).toBe('3 cartes');
    expect(t('en', 'card.count', { count: 3 })).toBe('3 cards');
  });

  it('traite les valeurs négatives comme leur valeur absolue', () => {
    expect(pluralForm('fr', -1)).toBe('one');
    expect(pluralForm('en', -1)).toBe('one');
    expect(pluralForm('en', -3)).toBe('other');
  });

  it('choisit une forme qui n’affiche pas forcément le compte', () => {
    // La forme « one » du français ne contient pas `{count}` : le paramètre sert
    // uniquement à choisir, et ne doit laisser aucune trace.
    expect(t('fr', 'log.drew', { who: 'Invité', count: 1 })).toBe('Invité a pioché une carte');
    expect(t('fr', 'log.drew', { who: 'Invité', count: 3 })).toBe('Invité a pioché 3 cartes');
  });
});

describe('interpolation', () => {
  it('remplit plusieurs paramètres dans une phrase pluralisée', () => {
    expect(
      t('fr', 'log.revealedTop', {
        who: 'Invité',
        count: 2,
        zone: 'bibliothèque',
        names: 'Sol Ring, Mox Diamond',
      }),
    ).toBe('Invité a révélé les 2 cartes du dessus de sa bibliothèque : Sol Ring, Mox Diamond');

    expect(
      t('en', 'log.revealedTop', {
        who: 'Guest',
        count: 1,
        zone: 'library',
        names: 'Sol Ring',
      }),
    ).toBe('Guest revealed the top card of their library: Sol Ring');
  });

  it('accepte des nombres comme des chaînes', () => {
    expect(t('fr', 'counter.badge', { value: 3, kind: '+1/+1' })).toBe('3 × +1/+1');
  });

  it('laisse l’accolade visible plutôt que d’écrire « undefined »', () => {
    // Impossible depuis du TypeScript typé ; on veut le voir si ça arrive quand même.
    expect(interpolate('{a} et {b}', { a: 'x' })).toBe('x et {b}');
  });

  it('n’altère pas une chaîne sans accolade', () => {
    expect(t('fr', 'common.cancel')).toBe('Annuler');
    expect(t('en', 'common.cancel')).toBe('Cancel');
  });
});

describe('catalogues', () => {
  it('le français est bien la source, mot pour mot', () => {
    // Ces chaînes existent telles quelles dans les composants : les « améliorer »
    // en les extrayant changerait l'interface sans que personne ne le voie.
    expect(fr['toolbar.passTurn']).toBe('Passer le tour');
    expect(fr['card.changePrinting']).toBe('Changer d’impression…');
    expect(fr['card.handRevealed']).toBe(
      'Carte révélée : votre main est visible par toute la table',
    );
  });

  it('les deux catalogues ont exactement les mêmes clés', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });

  /**
   * `defineTranslation` refuse déjà, à la compilation, une accolade perdue —
   * sauf `{count}` dans une entrée au pluriel : le type ajoute toujours `count`
   * aux paramètres d'un pluriel, qu'il soit affiché ou non. C'est précisément
   * ce trou-là que ce test bouche.
   */
  it('chaque traduction attend exactement les mêmes paramètres que la source', () => {
    const params = (entry: unknown): string[] => {
      const texts =
        typeof entry === 'string'
          ? [entry]
          : Object.values(entry as Record<string, string>).filter((v) => typeof v === 'string');
      const found = new Set<string>();
      for (const text of texts) {
        for (const match of text.matchAll(/\{(\w+)\}/g)) found.add(match[1]!);
      }
      return [...found].sort();
    };

    for (const key of Object.keys(fr) as Array<keyof typeof fr>) {
      expect({ key, params: params(en[key]) }).toEqual({ key, params: params(fr[key]) });
    }
  });

  it('une entrée au pluriel l’est dans les deux langues', () => {
    for (const key of Object.keys(fr) as Array<keyof typeof fr>) {
      expect(typeof en[key]).toBe(typeof fr[key]);
    }
  });
});

describe('robustesse', () => {
  it('retombe sur le français si la langue est inconnue', () => {
    // `asLanguage` garde normalement ce cas à la frontière ; le moteur ne doit
    // pas pour autant rendre « undefined » si quelque chose passe au travers.
    expect(t('de' as 'fr', 'common.cancel')).toBe('Annuler');
  });

  it('translator lie la langue une fois pour toutes', () => {
    const te = translator('en');
    expect(te('zone.library')).toBe('Library');
    expect(te('card.count', { count: 2 })).toBe('2 cards');
  });
});
