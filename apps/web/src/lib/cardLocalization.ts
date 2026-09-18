/**
 * Cache client des cartes localisées, indexé par `(scryfallId, langue)`.
 *
 * **Ce qu'il garde, et ce qu'il ne gardera jamais.** Des URL et des noms. Rien
 * d'autre. Aucune image de Wizards of the Coast n'est hébergée, proxifiée ni
 * mise en cache par ce projet — un cache est une copie. Il n'y a donc ici ni
 * `new Image()`, ni préchargement, ni entrée ajoutée au service worker : c'est
 * le navigateur du joueur qui va chercher la face chez Scryfall, directement,
 * comme il le fait déjà pour le catalogue anglais.
 *
 * **Pourquoi il ressemble à `lib/cards.ts`.** Le cache de métadonnées a déjà
 * résolu les trois mêmes problèmes : regrouper en lots ce que la frame demande,
 * prévenir les composants quand la réponse tombe, et ne pas redemander ce qui
 * est déjà en vol. On reprend la même forme — une Map de module, un
 * `setTimeout` de regroupement, un jeu d'abonnés — plutôt qu'un store zustand.
 * Ce n'est pas un choix esthétique : un sélecteur zustand qui *construit* la
 * liste des identifiants à demander rendrait un tableau neuf à chaque rendu,
 * React boucle, lève le #185, et la page meurt avant d'ouvrir son socket.
 * Ici il n'y a pas de sélecteur du tout.
 *
 * **La clé est `(scryfallId, langue)`**, exactement comme la table serveur.
 * Changer de langue n'invalide donc rien : ce qui a été appris en français
 * reste su, et repasser en français après un aller-retour en anglais ne coûte
 * pas un octet de réseau.
 */
import { useEffect, useState } from 'react';
import type { Language } from '@mtg/shared';
import { api } from './api.js';
import { pendingLocalizations, type FaceLike, type LocalizedPrinting } from './i18n/index.js';

/**
 * Une entrée de `POST /api/cards/localized`, telle que l'affichage la lit.
 *
 * `LocalizedPrinting` couvre déjà ce dont `resolveCardImage` a besoin ; on y
 * ajoute les deux noms, qui ne servent qu'ici. La distinction est importante :
 * `name` est le nom du **catalogue**, anglais, qui reste la clé de recherche et
 * de deck ; `printedName` est le nom **à afficher**.
 */
export interface LocalizedCard extends LocalizedPrinting {
  name?: string;
  printedName?: string | null;
}

/*
 * `substitute` arrive par `LocalizedPrinting` et n'ouvre **aucun second chemin
 * de résolution** : c'est le même appel, la même réponse, la même entrée de
 * cache. Rien ici ne change — pas un `setTimeout` de plus, pas une relance de
 * plus — et la boucle de demande fermée par `cooling` reste fermée. Basculer
 * l'option d'affichage n'invalide donc rien et ne déclenche aucune requête :
 * la substitution était déjà là, on se contente de la regarder.
 */

interface LocalizedResponse {
  language: Language;
  cards: LocalizedCard[];
}

/**
 * La langue du catalogue que nous ingérons.
 *
 * Demander l'anglais ne coûterait au serveur ni base ni réseau — il rendrait le
 * catalogue tel quel — mais cela reste un aller-retour HTTP pour apprendre ce
 * que nous avons déjà. `resolveCardImage` sans résolution rend exactement la
 * même image pour un joueur anglophone, sans repli ni `pending`. On s'abstient
 * donc, et c'est la seule optimisation de ce fichier.
 */
const CATALOG_LANGUAGE: Language = 'en';

/** Le plafond de la route : 1 à 500 identifiants par requête. */
const BATCH_MAX = 500;
/** Le délai de regroupement, calqué sur `lib/cards.ts` : une frame de rendu. */
const FLUSH_DELAY = 30;
/**
 * Les délais des relances successives d'un `pending`, en millisecondes.
 *
 * **Pourquoi plusieurs, alors qu'il n'y en avait qu'une.** Le serveur plafonne
 * ses appels vivants à Scryfall par requête. Mesuré sur un deck de 84 cartes
 * jamais résolues : 20 revenaient en français au premier passage, 20 de plus à
 * l'unique relance, et **44 restaient anglaises** jusqu'au rechargement de la
 * page — sans qu'aucune ne soit un vrai 404. Une seule relance ne pouvait
 * mécaniquement pas suffire.
 *
 * Le serveur reprend désormais le reste en tâche de fond, à son rythme ; ces
 * relances-là ne font que **relire** ce qu'il a écrit entre-temps, et ne coûtent
 * donc rien à Scryfall. Elles restent néanmoins **comptées et espacées** : cinq
 * tentatives, de plus en plus lointaines, puis plus rien. Ce n'est pas une
 * boucle — une carte que Scryfall ne rend pas attendra le prochain chargement.
 */
const RETRY_DELAYS = [1_500, 3_000, 6_000, 12_000, 24_000] as const;
/**
 * Le repos observé après un lot échoué.
 *
 * Sans lui, la boucle est immédiate et invisible : l'appel échoue, on prévient
 * les abonnés, ils re-rendent, ils redemandent la carte qui n'est toujours pas
 * en cache, et l'on repart — trente millisecondes plus tard, indéfiniment. Une
 * panne de quelques minutes deviendrait un martèlement de notre propre API.
 * Dix secondes suffisent : le joueur voit l'anglais entre-temps, ce qui est
 * exactement ce qu'il verrait de toute façon.
 */
const RETRY_AFTER_ERROR = 10_000;

/**
 * Un identifiant Scryfall est un UUID. Le vérifier n'est pas de la paranoïa :
 * le schéma de la route est strict, et un seul identifiant d'objet (ULID)
 * glissé dans un lot le fait rejeter en bloc — ce sont alors **toutes** les
 * cartes de la frame qui restent en anglais.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cache = new Map<string, LocalizedCard>();
/** Les cartes inconnues du catalogue : la réponse ne les porte pas (voir §3.3). */
const absent = new Set<string>();
/** Combien de fois chaque `pending` a déjà été redemandé. Compté, donc borné. */
const retried = new Map<string, number>();
/** Ce qui vient d'échouer et observe son repos. Rien n'est gravé : on réessaiera. */
const cooling = new Set<string>();
/** Ce qui est en attente de départ ou en vol : on ne demande pas deux fois. */
const queued = new Set<string>();
/** Ce qui partira au prochain lot, rangé par langue — un lot par langue. */
const waiting = new Map<Language, Set<string>>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const keyOf = (scryfallId: string, language: Language): string => `${language}:${scryfallId}`;

/** Prévenu quand un lot est rentré. Rend la fonction de désabonnement. */
export function subscribeLocalizations(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * La résolution localisée d'une carte, si elle est déjà là.
 *
 * Rend `undefined` tant qu'elle ne l'est pas, et déclenche la demande au
 * passage : l'appelant affiche alors l'anglais du catalogue — `resolveCardImage`
 * le fait pour lui — et rien ne clignote, puisque rien ne disparaît. La carte
 * devient française à l'arrivée du lot, sans trou entre les deux.
 */
export function localizedCard(
  scryfallId: string | undefined,
  language: Language,
): LocalizedCard | undefined {
  if (!scryfallId) return undefined;
  const hit = cache.get(keyOf(scryfallId, language));
  if (hit) return hit;
  requestLocalization(scryfallId, language);
  return undefined;
}

/**
 * Demande la résolution d'une carte. Différée : tout ce que la frame courante
 * réclame part dans le même lot.
 *
 * `force` ne sert qu'à la seconde demande d'un `pending` : l'entrée est en
 * cache (elle porte l'anglais provisoire), et sans cela la garde de cache
 * l'arrêterait net.
 */
export function requestLocalization(scryfallId: string, language: Language, force = false): void {
  if (language === CATALOG_LANGUAGE) return;
  if (!UUID.test(scryfallId)) return;

  const key = keyOf(scryfallId, language);
  // Une carte que le catalogue ne connaît pas ne se mettra pas à exister : la
  // redemander à chaque rendu serait du réseau contre une réponse déjà connue.
  if (absent.has(key)) return;
  if (cooling.has(key)) return;
  if (!force && cache.has(key)) return;
  if (queued.has(key)) return;

  queued.add(key);
  let batch = waiting.get(language);
  if (!batch) {
    batch = new Set<string>();
    waiting.set(language, batch);
  }
  batch.add(scryfallId);
  scheduleFlush();
}

function scheduleFlush(): void {
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_DELAY);
}

function flush(): void {
  for (const [language, ids] of waiting) {
    // Au-delà de 500 la route rend 400 : le surplus reste en file et repart au
    // tour suivant, plutôt que de faire échouer le lot entier.
    const batch = [...ids].slice(0, BATCH_MAX);
    for (const id of batch) ids.delete(id);
    if (ids.size === 0) waiting.delete(language);
    if (batch.length > 0) void send(batch, language);
  }
  if (waiting.size > 0) scheduleFlush();
}

async function send(ids: string[], language: Language): Promise<void> {
  try {
    const res = await api.post<LocalizedResponse>('/api/cards/localized', { ids, language });

    const served = new Set<string>();
    for (const card of res.cards) {
      cache.set(keyOf(card.scryfallId, language), card);
      served.add(card.scryfallId);
    }
    /*
     * Le tableau de sortie peut être plus court que l'entrée : une carte
     * inconnue du catalogue n'y figure tout simplement pas, et la route ne rend
     * pas d'erreur pour autant. On constate le manque et on le retient — ce
     * n'est pas un échec, et ce n'est pas non plus à redemander.
     */
    for (const id of ids) {
      if (!served.has(id)) absent.add(keyOf(id, language));
    }

    planRetry(res.cards, language);
  } catch {
    /*
     * Réseau coupé, serveur muet : on ne **retient** rien — graver un repli
     * sur une panne passagère est exactement ce que le serveur se refuse à
     * faire, et le client non plus. On observe seulement un repos, le temps
     * que la panne passe, sinon la prochaine frame relancerait aussitôt.
     */
    for (const id of ids) cooling.add(keyOf(id, language));
    setTimeout(() => {
      for (const id of ids) cooling.delete(keyOf(id, language));
    }, RETRY_AFTER_ERROR);
  } finally {
    for (const id of ids) queued.delete(keyOf(id, language));
    for (const listener of listeners) listener();
  }
}

/**
 * Les relances des cartes revenues `pending`, espacées et comptées.
 *
 * `pending` veut dire « la résolution n'a pas encore eu lieu », pas « il n'y a
 * pas de version française » : c'est le seul cas où redemander apporte quelque
 * chose. Un `fallback` **sans** `pending` est au contraire une réponse
 * définitive, et le redemander serait du réseau gaspillé. Ne pas se fier au
 * seul `fallback` : le serveur le pose aussi sur les `pending`.
 *
 * Chaque carte a droit à `RETRY_DELAYS.length` relances, de plus en plus
 * espacées, et **le compteur ne se remet jamais à zéro** : une carte que le
 * serveur ne résout pas finit par se taire et attendre le prochain chargement
 * de page. C'est la garde qui empêche la boucle.
 */
function planRetry(cards: readonly LocalizedCard[], language: Language): void {
  const parTour = new Map<number, string[]>();
  for (const id of pendingLocalizations(cards)) {
    const tour = retried.get(keyOf(id, language)) ?? 0;
    if (tour >= RETRY_DELAYS.length) continue;
    retried.set(keyOf(id, language), tour + 1);
    const lot = parTour.get(tour) ?? [];
    lot.push(id);
    parTour.set(tour, lot);
  }
  for (const [tour, ids] of parTour) {
    setTimeout(() => {
      for (const id of ids) requestLocalization(id, language, true);
    }, RETRY_DELAYS[tour]);
  }
}

/**
 * Le nom **à afficher**.
 *
 * `printedName` est le nom imprimé de l'impression traduite ; il retombe sur le
 * nom du catalogue quand il n'y a pas de traduction, ce qui est le cas courant.
 * Afficher `name` à un joueur français alors que l'illustration est française
 * donnerait une carte française surmontée d'un titre anglais.
 *
 * **Une entrée `pending` peut malgré tout porter un nom traduit**, et il faut le
 * lire. Le cas n'existait pas quand `pending` voulait seulement dire « pas
 * encore résolue » : l'entrée portait alors l'anglais du catalogue, et s'en
 * détourner ne coûtait rien. Depuis le rattrapage des substitutions, le serveur
 * pose aussi `pending` sur une carte **déjà nommée** en français dont il
 * cherche encore une impression de remplacement. Ignorer le nom ferait alors
 * repasser le titre en anglais le temps du rattrapage, puis revenir : un
 * clignotement, pour rien. `printedName` vaut l'anglais quand il n'y a rien
 * d'autre, donc le lire est sans risque dans les deux cas.
 *
 * `face` suit la convention de `resolveCardImage` : 0 = recto. Au recto d'une
 * carte recto-verso, `printedName` vaut « recto // verso », comme `name` côté
 * catalogue — c'est le même affichage qu'aujourd'hui, dans l'autre langue.
 */
export function localizedCardName(
  localized: LocalizedCard | undefined,
  catalogName: string | undefined,
  face = 0,
): string | undefined {
  if (!localized) return catalogName;
  if (localized.pending) return localized.printedName ?? catalogName;
  if (face > 0) {
    const faces: readonly FaceLike[] | null | undefined = localized.faces;
    const printed = faces?.[face]?.name;
    if (printed) return printed;
  }
  return localized.printedName ?? catalogName;
}

/**
 * Force un rendu quand un lot de résolutions rentre.
 *
 * Même rôle que `useCardMetaTick` pour les métadonnées : les composants lisent
 * le cache de façon synchrone, il faut donc leur dire quand il a changé.
 */
export function useLocalizationTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeLocalizations(() => setTick((t) => t + 1)), []);
  return tick;
}

/** Remise à zéro complète. N'existe que pour les tests. */
export function resetLocalizations(): void {
  cache.clear();
  absent.clear();
  retried.clear();
  cooling.clear();
  queued.clear();
  waiting.clear();
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
}
