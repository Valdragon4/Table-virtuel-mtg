/**
 * Les garanties de typage, vérifiées **par la compilation elle-même**.
 *
 * Ce fichier n'est importé par personne : il ne finit pas dans le bundle. Il
 * est là parce que `npx tsc -b` le compile, et que chaque `@ts-expect-error`
 * ci-dessous **échoue si l'erreur attendue n'a pas lieu**. C'est un test à
 * l'envers : le jour où quelqu'un assouplit les types de `types.ts`, la
 * compilation casse ici, et pas en silence dans 39 composants.
 *
 * Vitest ne peut pas couvrir ces cas — un appel qui ne compile pas n'est pas un
 * appel qui lève à l'exécution. D'où ce fichier plutôt qu'un `.test.ts`.
 */
import { t } from './translate.js';
import type { ArgsFor, ParamsIn, ParamsOf, SameParams } from './types.js';

/* — Ce qui doit compiler ————————————————————————————————— */

const _sansParametre: string = t('fr', 'common.cancel');
const _avecParametres: string = t('fr', 'counter.badge', { value: 3, kind: '+1/+1' });
const _pluriel: string = t('en', 'card.count', { count: 2 });
const _plurielRiche: string = t('fr', 'log.revealedTop', {
  who: 'Invité',
  count: 2,
  zone: 'bibliothèque',
  names: 'Sol Ring',
});

/* — Ce qui doit être refusé ——————————————————————————————— */

// @ts-expect-error — une clé absente du catalogue n'existe pas pour `t`
t('fr', 'clé.qui.nexiste.pas');

// @ts-expect-error — `kind` manque : une interpolation incomplète ne compile pas
t('fr', 'counter.badge', { value: 3 });

// @ts-expect-error — une entrée au pluriel exige `count`, même quand elle ne l'affiche pas
t('fr', 'log.drew', { who: 'Invité' });

// @ts-expect-error — les paramètres sont obligatoires, pas optionnels
t('fr', 'card.count');

// @ts-expect-error — une entrée sans accolade n'accepte pas d'argument
t('fr', 'common.cancel', { value: 1 });

/* — Les briques de types, isolément ——————————————————————— */

type _Lit = ParamsIn<'{who} a révélé {count} cartes'>;
const _lus: _Lit[] = ['who', 'count'];

type _Aucun = ParamsIn<'Annuler'>;
const _vide: ArgsFor<'Annuler'> = [];

// Une entrée au pluriel ajoute toujours `count` à ses paramètres lus.
const _compteAjoute: ParamsOf<{ one: 'une carte'; other: '{n} cartes' }>[] = ['count', 'n'];

/**
 * `SameParams` vaut `unknown` quand les deux entrées attendent la même chose, et
 * `never` sinon — c'est ce qui interdit à un catalogue traduit de perdre une
 * accolade. `undefined` est assignable à `unknown`, jamais à `never`.
 */
const _paritéOk: SameParams<'{a} et {b}', '{b} and {a}'> = undefined;

// @ts-expect-error — l'anglais a perdu `{b}` : la traduction doit être refusée
const _paritéCassée: SameParams<'{a} et {b}', 'only {a}'> = undefined;
