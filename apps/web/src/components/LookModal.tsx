/**
 * Consultation et fouille de bibliothèque : scry, surveil, regard, fouille (tuteur).
 *
 * Le contenu affiché ici n'a été envoyé qu'à ce siège, et le serveur verrouille
 * ces cartes tant que la consultation n'est pas résolue.
 *
 * Refonte UX/UI moderne (UI/UX Pro Max) :
 *  - En mode fouille (beaucoup de cartes) :
 *    - Filtres instantanés par famille de types (Tout, Terrains, Créatures, Éphémères, Rituels...)
 *    - Recherche textuelle rapide avec bouton d'effacement automatique
 *    - Tri multicritères : Nom (A-Z), Coût de mana (CMC), Type, Ordre reçu
 *    - Actions rapides directes sur chaque carte en 1 clic (Main, Champ, Cimetière, Exil, Fond)
 *    - Double-clic sur une carte pour la mettre instantanément en main (tuteur rapide)
 *    - Menu contextuel au clic droit sur chaque carte
 *    - Barre d'actions groupées pour les sélections multiples
 *    - Aperçu agrandi de la carte active dans un panneau inspecteur
 *    - Bouton principal proéminent « Valider et mélanger » (geste standard de fouille)
 *  - En mode scry / consultation restreinte :
 *    - Présentation claire avec réorganisation et boutons de destination dédiés
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicCardView } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { CardSprite } from './CardSprite.js';
import { ManaCost } from './ManaCost.js';
import { cardMeta, cardName, scryfallImage } from '../lib/cards.js';
import { localizedCard, localizedCardName, useLocalizationTick } from '../lib/cardLocalization.js';
import { keywordSearchTerms, resolveCardImage, useT, type BoundT } from '../lib/i18n/index.js';
import { useLanguage } from '../store/prefs.js';
import { TYPE_FAMILIES, matchesCardQuery, typeFamilyKey } from './ZonePanel.js';

export type Bucket = 'top' | 'bottom' | 'hand' | 'graveyard' | 'exile' | 'battlefield' | 'sideboard';

export interface BucketDef {
  key: Bucket;
  label: string;
  shortLabel: string;
  icon: string;
  hint: string;
  badgeBg: string;
  ringClass: string;
  beforeGameOnly?: boolean;
}

/*
 * Les destinations sont construites **à chaque rendu**, à partir de `t` : leurs
 * libellés suivent la langue, là où une constante de module aurait gardé celle
 * du premier chargement. La `key` reste la valeur du protocole (`RESOLVE_LOOK`)
 * et ne bouge jamais.
 */
const bucketDefs = (t: BoundT): BucketDef[] => [
  {
    key: 'top',
    label: t('consult.bucketTop'),
    shortLabel: t('consult.bucketTopShort'),
    icon: '⬆️',
    hint: t('consult.bucketTopHint'),
    badgeBg: 'bg-slate-800 text-slate-300 border-slate-700',
    ringClass: 'ring-slate-700/60',
  },
  {
    key: 'hand',
    label: t('consult.bucketHand'),
    shortLabel: t('consult.bucketHandShort'),
    icon: '🖐️',
    hint: t('consult.bucketHandHint'),
    badgeBg: 'bg-sky-950/90 text-sky-200 border-sky-500 shadow-sm shadow-sky-950/80 ring-1 ring-sky-500/50',
    ringClass: 'ring-2 ring-sky-400 bg-sky-950/30 shadow-md shadow-sky-950/40',
  },
  {
    key: 'battlefield',
    label: t('consult.bucketBattlefield'),
    shortLabel: t('consult.bucketBattlefieldShort'),
    icon: '⚔️',
    hint: t('consult.bucketBattlefieldHint'),
    badgeBg: 'bg-emerald-950/90 text-emerald-200 border-emerald-500 shadow-sm shadow-emerald-950/80 ring-1 ring-emerald-500/50',
    ringClass: 'ring-2 ring-emerald-400 bg-emerald-950/30 shadow-md shadow-emerald-950/40',
  },
  {
    key: 'graveyard',
    label: t('card.toGraveyard'),
    shortLabel: t('zone.graveyard'),
    icon: '🪦',
    hint: t('consult.bucketGraveyardHint'),
    badgeBg: 'bg-rose-950/90 text-rose-200 border-rose-500 shadow-sm shadow-rose-950/80 ring-1 ring-rose-500/50',
    ringClass: 'ring-2 ring-rose-400 bg-rose-950/30 shadow-md shadow-rose-950/40',
  },
  {
    key: 'exile',
    label: t('consult.bucketExile'),
    shortLabel: t('zone.exile'),
    icon: '🌌',
    hint: t('consult.bucketExileHint'),
    badgeBg: 'bg-purple-950/90 text-purple-200 border-purple-500 shadow-sm shadow-purple-950/80 ring-1 ring-purple-500/50',
    ringClass: 'ring-2 ring-purple-400 bg-purple-950/30 shadow-md shadow-purple-950/40',
  },
  {
    key: 'bottom',
    label: t('consult.bucketBottom'),
    shortLabel: t('consult.bucketBottomShort'),
    icon: '⬇️',
    hint: t('consult.bucketBottomHint'),
    badgeBg: 'bg-amber-950/90 text-amber-200 border-amber-500 shadow-sm shadow-amber-950/80 ring-1 ring-amber-500/50',
    ringClass: 'ring-2 ring-amber-400 bg-amber-950/30 shadow-md shadow-amber-950/40',
  },
  {
    key: 'sideboard',
    label: t('zone.sideboard'),
    shortLabel: t('zone.sideboard'),
    icon: '📦',
    hint: t('consult.bucketSideboardHint'),
    badgeBg: 'bg-indigo-950/90 text-indigo-200 border-indigo-500 shadow-sm shadow-indigo-950/80 ring-1 ring-indigo-500/50',
    ringClass: 'ring-2 ring-indigo-400 bg-indigo-950/30 shadow-md shadow-indigo-950/40',
    beforeGameOnly: true,
  },
];

/** Au-delà de ce nombre, bascule en mode fouille riche avec filtres et grilles. */
const LARGE_LOOK = 8;

export type Sort = 'recu' | 'nom' | 'type' | 'cout';

const sorts = (t: BoundT): Array<{ key: Sort; label: string }> => [
  { key: 'nom', label: t('consult.sortName') },
  { key: 'cout', label: t('consult.sortCost') },
  { key: 'type', label: t('consult.sortType') },
  { key: 'recu', label: t('consult.sortReceived') },
];

/** Valeur numérique grossière d'un coût de mana pour le tri. */
function manaValue(cost: string | null | undefined): number {
  if (!cost) return 0;
  let total = 0;
  for (const symbol of cost.match(/\{[^}]+\}/g) ?? []) {
    const inner = symbol.slice(1, -1);
    const n = Number.parseInt(inner, 10);
    total += Number.isFinite(n) ? n : 1;
  }
  return total;
}

export function LookModal(): React.ReactElement | null {
  const pending = useGame((s) => s.pendingLook);
  const send = useGame((s) => s.send);
  const hoverPreview = useGame((s) => s.hoverPreview);
  const started = useGame((s) => s.room?.status === 'PLAYING');
  const t = useT();
  const language = useLanguage();
  // Le panneau d'inspection lit le cache de façon synchrone : sans ce tic, la
  // carte inspectée resterait en anglais jusqu'au prochain rendu venu d'ailleurs.
  // Il sert aussi de dépendance au filtre, qui interroge désormais le nom
  // imprimé : sans lui, la liste retenue resterait celle du premier rendu,
  // calculée quand aucune traduction n'était encore arrivée.
  const localizationTick = useLocalizationTick();
  const [buckets, setBuckets] = useState<Record<string, Bucket>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [activeType, setActiveType] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('recu');
  const [inspectedCardId, setInspectedCardId] = useState<string | null>(null);
  const [activeMenuCardId, setActiveMenuCardId] = useState<string | null>(null);
  const [cardDensity, setCardDensity] = useState<'comfortable' | 'standard' | 'compact'>('comfortable');
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      hoverPreview(null);
    };
  }, [hoverPreview]);

  useEffect(() => {
    if (!pending) {
      hoverPreview(null);
      setBuckets({});
      setPicked(new Set());
      setFilter('');
      setActiveType(null);
      setInspectedCardId(null);
      setActiveMenuCardId(null);
      return;
    }
    // Par défaut tout reste sur le dessus, dans l'ordre reçu : ne rien faire
    // puis valider doit laisser la bibliothèque telle qu'elle était.
    setBuckets(Object.fromEntries(pending.cards.map((c) => [c.id, 'top' as Bucket])));
    setPicked(new Set());
    setFilter('');
    // Sur une fouille, chercher une carte par son nom est le geste normal :
    // on trie d'emblée. Sur un scry, l'ordre reçu *est* l'information.
    setActiveType(null);
    setActiveMenuCardId(null);
    setSort(pending.mode === 'SEARCH' ? 'nom' : 'recu');
    filterRef.current?.focus();
  }, [pending?.lookId, hoverPreview]);

  // Fermeture au clavier : Échap ferme d'abord le menu ouvert, puis le panneau d'inspection, puis la modale
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        hoverPreview(null);
        if (activeMenuCardId !== null) {
          setActiveMenuCardId(null);
        } else if (inspectedCardId !== null) {
          setInspectedCardId(null);
        } else {
          resolve(false);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, activeMenuCardId, inspectedCardId, hoverPreview]);

  // Dès qu'un menu ou un panneau d'inspection est ouvert, dissiper immédiatement la preview
  useEffect(() => {
    if (activeMenuCardId !== null || inspectedCardId !== null) {
      hoverPreview(null);
    }
  }, [activeMenuCardId, inspectedCardId, hoverPreview]);

  const cards = pending?.cards ?? [];
  const large = cards.length > LARGE_LOOK;
  const isSearch = pending?.mode === 'SEARCH';
  const isReveal = pending?.mode === 'REVEAL';

  // Synthèse des types de cartes présentes
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) {
      const meta = cardMeta(card.scryfallId);
      const families = meta?.typeLine ? typeFamilyKey(meta.typeLine) : null;
      if (families && families.length > 0) {
        for (const fam of families) counts.set(fam, (counts.get(fam) ?? 0) + 1);
      } else {
        counts.set('other', (counts.get('other') ?? 0) + 1);
      }
    }
    return counts;
  }, [cards]);

  const visible = useMemo(() => {
    let kept = cards;

    /*
     * Filtre textuel : les **deux** noms de la carte, plus ce qui était déjà
     * interrogé. Fouiller sa bibliothèque est justement le moment où l'on tape
     * le nom qu'on a sous les yeux — et il est français depuis qu'on affiche le
     * nom imprimé —, autant que celui d'une liste de deck, qui est anglais.
     *
     * Les morceaux restent **séparés** : chacun est comparé pour lui-même,
     * plutôt que recollés en une seule chaîne où une saisie pouvait courir d'un
     * nom à la ligne de type suivante et retenir une carte que personne
     * n'aurait su expliquer.
     */
    if (filter.trim()) {
      kept = kept.filter((card) => {
        const meta = cardMeta(card.scryfallId);
        const printed = localizedCardName(localizedCard(card.scryfallId, language), meta?.name);
        /* Les mécaniques rejoignent les morceaux déjà interrogés, chacune comme
           un terme à part : fouiller sa bibliothèque est justement le moment où
           l'on cherche « toutes mes créatures avec Vol », et le champ qui sert à
           cela est celui qui est déjà là. Anglais **et** français, comme les
           noms. */
        return matchesCardQuery(
          filter,
          meta?.name,
          printed,
          meta?.typeLine,
          meta?.manaCost,
          ...keywordSearchTerms(meta?.keywords, language),
        );
      });
    }

    // Filtre par catégorie de type
    if (activeType !== null) {
      kept = kept.filter((card) => {
        const meta = cardMeta(card.scryfallId);
        if (!meta?.typeLine) return activeType === 'other';
        const families = typeFamilyKey(meta.typeLine);
        if (!families || families.length === 0) return activeType === 'other';
        return families.includes(activeType);
      });
    }

    if (!isSearch || sort === 'recu') return kept;

    // Le tri, lui, reste sur le nom du catalogue : c'est la clé, elle ne bouge
    // pas avec la langue. Ordonner sur le nom imprimé ferait sauter les cartes
    // sous les doigts du joueur à mesure que les lots de résolution rentrent.
    const key = (card: (typeof kept)[number]): string | number => {
      const meta = cardMeta(card.scryfallId);
      if (sort === 'nom') return meta?.name ?? '';
      if (sort === 'type') return `${meta?.typeLine ?? ''} ${meta?.name ?? ''}`;
      return manaValue(meta?.manaCost);
    };

    return [...kept].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (typeof ka === 'number' && typeof kb === 'number') return ka - kb;
      return String(ka).localeCompare(String(kb), 'fr');
    });
    // `localizationTick` n'est pas lu dans le corps : il n'est là que pour
    // refaire le calcul quand un lot de noms imprimés rentre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, filter, activeType, sort, isSearch, language, localizationTick]);

  if (!pending) return null;

  const offered = bucketDefs(t).filter((b) => !b.beforeGameOnly || started === false);

  const assign = (ids: Iterable<string>, bucket: Bucket): void => {
    setBuckets((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = bucket;
      return next;
    });
    setPicked(new Set());
  };

  const toggle = (id: string, additive: boolean): void => {
    setPicked((current) => {
      const next = new Set(additive ? current : []);
      if (current.has(id) && (additive || current.size === 1)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const idsIn = (bucket: Bucket): string[] =>
    cards.filter((c) => buckets[c.id] === bucket).map((c) => c.id);

  function resolve(shuffleAfter: boolean): void {
    hoverPreview(null);
    send({
      type: 'RESOLVE_LOOK',
      lookId: pending!.lookId,
      top: idsIn('top'),
      bottom: idsIn('bottom'),
      toHand: idsIn('hand'),
      toGraveyard: idsIn('graveyard'),
      toExile: idsIn('exile'),
      toBattlefield: idsIn('battlefield'),
      toSideboard: idsIn('sideboard'),
      shuffleAfter,
    });
  }

  const handCount = idsIn('hand').length;
  const bfCount = idsIn('battlefield').length;
  const gyCount = idsIn('graveyard').length;
  const exCount = idsIn('exile').length;
  const botCount = idsIn('bottom').length;
  const topCount = idsIn('top').length;
  const sbCount = idsIn('sideboard').length;

  const inspectedCard = inspectedCardId ? cards.find((c) => c.id === inspectedCardId) : null;
  const inspectedMeta = inspectedCard ? cardMeta(inspectedCard.scryfallId) : null;
  const inspectedLocalized = inspectedCard
    ? localizedCard(inspectedCard.scryfallId, language)
    : undefined;
  /*
   * Le recto suffit ici : l'inspecteur ne retourne pas la carte. Le repli sur
   * le motif du CDN garde le comportement d'avant si la résolution ne rend rien
   * pour cette face — le joueur ne doit jamais voir un cadre vide.
   */
  const inspectedSrc =
    inspectedCard && inspectedMeta
      ? (resolveCardImage({
          card: inspectedMeta,
          localized: inspectedLocalized,
          language,
          face: 0,
        }).url ?? scryfallImage(inspectedCard.scryfallId, 'large'))
      : null;
  const inspectedName = localizedCardName(inspectedLocalized, inspectedMeta?.name) ?? '';

  const cardScale =
    cardDensity === 'comfortable' ? 1.15 : cardDensity === 'standard' ? 0.92 : 0.72;
  const densityConfig = {
    comfortable: { scale: 1.05, minColWidth: '185px' },
    standard: { scale: 0.85, minColWidth: '150px' },
    compact: { scale: 0.68, minColWidth: '120px' },
  }[cardDensity];

  const gridColsClass =
    cardDensity === 'comfortable'
      ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
      : cardDensity === 'standard'
        ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
        : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6"
      onClick={() => resolve(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="flex max-h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl shadow-black transition-all"
        data-test="look-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête de la modale */}
        <header className="flex flex-col gap-2.5 border-b border-white/10 bg-slate-900/60 px-5 py-3.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300 text-base">
                {isReveal ? '✨' : isSearch ? '🔍' : '👁️'}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-100 tracking-tight">
                    {isReveal
                      ? t('consult.titleReveal', { count: cards.length })
                      : isSearch
                        ? t('consult.titleSearch')
                        : t('consult.titleLook', { count: cards.length })}
                  </h2>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-300">
                    {t('card.count', { count: cards.length })}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {isReveal ? t('consult.subtitleReveal') : t('consult.subtitleLook')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {/* Sélecteur de taille / lisibilité des cartes */}
              <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900/90 p-0.5 text-xs shadow-inner">
                <button
                  className={`rounded px-2.5 py-1 font-semibold transition-all ${
                    cardDensity === 'comfortable'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setCardDensity('comfortable')}
                  title={t('consult.densityLargeHint')}
                  type="button"
                >
                  {t('consult.densityLarge')}
                </button>
                <button
                  className={`rounded px-2.5 py-1 font-semibold transition-all ${
                    cardDensity === 'standard'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setCardDensity('standard')}
                  title={t('consult.densityNormalHint')}
                  type="button"
                >
                  {t('consult.densityNormal')}
                </button>
                <button
                  className={`rounded px-2.5 py-1 font-semibold transition-all ${
                    cardDensity === 'compact'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setCardDensity('compact')}
                  title={t('consult.densityCompactHint')}
                  type="button"
                >
                  {t('consult.densityCompact')}
                </button>
              </div>

              {large && (
                <div className="relative min-w-44 sm:min-w-60">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔍</span>
                  <input
                    ref={filterRef}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/90 pl-8 pr-7 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none ring-1 ring-transparent focus:ring-2 focus:ring-sky-500 transition-all"
                    data-test="look-filter"
                    placeholder={t('consult.filterPlaceholder')}
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                  {filter && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
                      onClick={() => setFilter('')}
                      title={t('common.clear')}
                      type="button"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              {isSearch && (
                <div className="flex items-center gap-1.5 text-xs text-slate-300 shrink-0">
                  <span className="text-slate-400 font-medium hidden sm:inline">
                    {t('consult.sortLabel')}
                  </span>
                  <select
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-sky-500"
                    data-test="look-sort"
                    value={sort}
                    onChange={(event) => setSort(event.target.value as Sort)}
                  >
                    {sorts(t).map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 text-sm transition-colors ml-1"
                onClick={() => resolve(false)}
                title={t('common.closeEsc')}
                type="button"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Pastilles de filtres par famille de types */}
          {large && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 overflow-x-auto scrollbar-thin">
              <button
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  activeType === null
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-slate-100'
                }`}
                onClick={() => setActiveType(null)}
                type="button"
              >
                {t('consult.allCount', { count: cards.length })}
              </button>
              {TYPE_FAMILIES.map((family) => {
                const count = typeCounts.get(family.key) ?? 0;
                if (count === 0) return null;
                const active = activeType === family.key;
                return (
                  <button
                    key={family.key}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all flex items-center gap-1 ${
                      active
                        ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-slate-100 border border-slate-700/50'
                    }`}
                    onClick={() => setActiveType(active ? null : family.key)}
                    type="button"
                  >
                    <span>{t(family.labelKey)}</span>
                    <span className="text-[10px] opacity-75 tabular-nums">({count})</span>
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {/* Barre d'actions groupées si des cartes sont sélectionnées */}
        {picked.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-950/30 px-5 py-2 shrink-0 animate-fadeIn">
            <span className="text-xs font-semibold text-amber-200 flex items-center gap-1.5">
              <span>✨</span>
              <span>{t('consult.selectedCount', { count: picked.size })}</span>
            </span>
            <div className="flex flex-wrap gap-1.5 items-center">
              {offered
                .filter((b) => b.key !== 'top')
                .map((bucket) => (
                  <button
                    key={bucket.key}
                    className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-all hover:scale-105 active:scale-95"
                    style={{
                      background:
                        bucket.key === 'hand'
                          ? '#0284c7'
                          : bucket.key === 'battlefield'
                            ? '#059669'
                            : bucket.key === 'graveyard'
                              ? '#be123c'
                              : bucket.key === 'exile'
                                ? '#7e22ce'
                                : '#d97706',
                    }}
                    title={bucket.hint}
                    onClick={() => assign(picked, bucket.key)}
                    type="button"
                  >
                    <span>{bucket.icon}</span>
                    <span>{bucket.label}</span>
                  </button>
                ))}
              <button
                className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                onClick={() => assign(picked, 'top')}
                title={t('consult.backToDeckTitle')}
                type="button"
              >
                ⬆️ {t('consult.backToDeck')}
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                className="text-xs text-slate-400 hover:text-slate-200 underline"
                onClick={() => setPicked(new Set(visible.map((c) => c.id)))}
                type="button"
              >
                {t('consult.selectAll', { count: visible.length })}
              </button>
              <button
                className="text-xs text-slate-400 hover:text-rose-300 ml-2"
                onClick={() => setPicked(new Set())}
                type="button"
              >
                ✕ {t('consult.deselect')}
              </button>
            </div>
          </div>
        )}

        {/* Corps principal : Grille de cartes & Panneau d'inspection optionnel */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="scrollbar-thin flex-1 overflow-y-auto p-4 sm:p-5">
            <div
              className="grid gap-3.5 sm:gap-4"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${densityConfig.minColWidth}, 1fr))`,
              }}
            >
              {visible.map((card) => (
                <LookCardItem
                  key={card.id}
                  bucket={buckets[card.id] ?? 'top'}
                  card={card}
                  compact={large}
                  scale={densityConfig.scale}
                  menuOpen={activeMenuCardId === card.id}
                  hasAnyMenuOpen={activeMenuCardId !== null || inspectedCardId !== null}
                  offered={offered}
                  onAssign={(b) => assign([card.id], b)}
                  onCloseMenu={() => {
                    hoverPreview(null);
                    setActiveMenuCardId(null);
                  }}
                  onInspect={() => {
                    hoverPreview(null);
                    setInspectedCardId(card.id);
                  }}
                  onOpenMenu={() => {
                    hoverPreview(null);
                    setActiveMenuCardId(card.id);
                  }}
                  onPick={(additive) => toggle(card.id, additive)}
                  onToggleMenu={() => {
                    hoverPreview(null);
                    setActiveMenuCardId((curr) => (curr === card.id ? null : card.id));
                  }}
                  picked={picked.has(card.id)}
                />
              ))}
              {visible.length === 0 && (
                <div className="col-span-full py-16 text-center text-slate-400 space-y-2">
                  <p className="text-2xl">🔍</p>
                  <p className="text-sm">{t('consult.noMatch')}</p>
                  <button
                    className="text-xs text-sky-400 hover:underline"
                    onClick={() => {
                      setFilter('');
                      setActiveType(null);
                    }}
                    type="button"
                  >
                    {t('consult.resetFilters')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Panneau latéral d'inspection si une carte est inspectée */}
          {inspectedCard && inspectedMeta && (
            <aside className="hidden lg:flex w-80 sm:w-96 flex-col border-l border-white/10 bg-slate-900/95 p-4 shrink-0 overflow-y-auto scrollbar-thin shadow-2xl">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  {t('consult.details')}
                </span>
                <button
                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 text-xs"
                  onClick={() => setInspectedCardId(null)}
                  type="button"
                >
                  ✕
                </button>
              </div>

              <div className="my-3 rounded-xl overflow-hidden shadow-2xl border border-white/15 bg-slate-950">
                <img
                  alt={inspectedName}
                  className="w-full object-cover"
                  /* Directement depuis le CDN Scryfall : rien n'est copié chez nous. */
                  src={inspectedSrc ?? scryfallImage(inspectedCard.scryfallId, 'large')}
                />
              </div>

              <div className="space-y-2.5 text-xs">
                <div>
                  {/* Le nom imprimé, pas celui du catalogue : une illustration
                      française sous un titre anglais n'a pas de sens. */}
                  <h3 className="font-bold text-sm text-slate-100">
                    {inspectedName || inspectedMeta.name}
                  </h3>
                  <p className="text-sky-300 font-medium text-[11px]">{inspectedMeta.typeLine}</p>
                </div>

                {inspectedMeta.manaCost && (
                  <p className="rounded-lg bg-slate-950/80 px-2.5 py-1.5 text-slate-300 text-[11px] leading-relaxed border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400">{t('consult.manaCost')}</span>
                    <ManaCost cost={inspectedMeta.manaCost} size="md" />
                  </p>
                )}
                {/*
                  `!= null` et non `!== undefined` : le catalogue rend `null`
                  pour une carte qui n'a ni force ni endurance — un artefact, un
                  rituel. L'ancien test les laissait passer, et l'inspecteur
                  affichait une ligne « Force / Endurance » réduite à un `/` nu.
                */}
                {inspectedMeta.power != null && inspectedMeta.toughness != null && (
                  <p className="rounded-lg bg-slate-950/80 px-2.5 py-1.5 text-slate-300 text-[11px] leading-relaxed border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400">{t('consult.powerToughness')}</span>
                    <span className="font-mono font-bold text-slate-200">
                      {inspectedMeta.power}/{inspectedMeta.toughness}
                    </span>
                  </p>
                )}

                <div className="pt-2.5 border-t border-slate-800 space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    {t('consult.quickAction')}
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      className="rounded-lg bg-sky-600 hover:bg-sky-500 py-1.5 px-2 text-xs font-semibold text-white shadow-sm transition-colors"
                      onClick={() => assign([inspectedCard.id], 'hand')}
                      type="button"
                    >
                      🖐️ {t('consult.bucketHand')}
                    </button>
                    <button
                      className="rounded-lg bg-emerald-600 hover:bg-emerald-500 py-1.5 px-2 text-xs font-semibold text-white shadow-sm transition-colors"
                      onClick={() => assign([inspectedCard.id], 'battlefield')}
                      type="button"
                    >
                      ⚔️ {t('consult.bucketBattlefield')}
                    </button>
                    <button
                      className="rounded-lg bg-rose-700 hover:bg-rose-600 py-1.5 px-2 text-xs font-semibold text-white shadow-sm transition-colors"
                      onClick={() => assign([inspectedCard.id], 'graveyard')}
                      type="button"
                    >
                      🪦 {t('zone.graveyard')}
                    </button>
                    <button
                      className="rounded-lg bg-purple-600 hover:bg-purple-500 py-1.5 px-2 text-xs font-semibold text-white shadow-sm transition-colors"
                      onClick={() => assign([inspectedCard.id], 'exile')}
                      type="button"
                    >
                      🌌 {t('zone.exile')}
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>

        {/* Pied de page : Synthèse des choix & Validation */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-slate-900/80 px-5 py-3.5 shrink-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium mr-1">{t('consult.summary')}</span>
            {handCount > 0 && (
              <span className="rounded-full bg-sky-950/90 text-sky-200 border border-sky-600/50 px-2.5 py-0.5 font-semibold">
                🖐️ {t('consult.sumHand', { count: handCount })}
              </span>
            )}
            {bfCount > 0 && (
              <span className="rounded-full bg-emerald-950/90 text-emerald-200 border border-emerald-600/50 px-2.5 py-0.5 font-semibold">
                ⚔️ {t('consult.sumBattlefield', { count: bfCount })}
              </span>
            )}
            {gyCount > 0 && (
              <span className="rounded-full bg-rose-950/90 text-rose-200 border border-rose-600/50 px-2.5 py-0.5 font-semibold">
                🪦 {t('consult.sumGraveyard', { count: gyCount })}
              </span>
            )}
            {exCount > 0 && (
              <span className="rounded-full bg-purple-950/90 text-purple-200 border border-purple-600/50 px-2.5 py-0.5 font-semibold">
                🌌 {t('consult.sumExile', { count: exCount })}
              </span>
            )}
            {botCount > 0 && (
              <span className="rounded-full bg-amber-950/90 text-amber-200 border border-amber-600/50 px-2.5 py-0.5 font-semibold">
                ⬇️ {t('consult.sumBottom', { count: botCount })}
              </span>
            )}
            {sbCount > 0 && (
              <span className="rounded-full bg-indigo-950/90 text-indigo-200 border border-indigo-600/50 px-2.5 py-0.5 font-semibold">
                📦 {t('consult.sumSideboard', { count: sbCount })}
              </span>
            )}
            <span className="rounded-full bg-slate-800 text-slate-400 px-2 py-0.5">
              📚 {t('consult.sumDeck', { count: topCount })}
            </span>
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-all"
              onClick={() => resolve(false)}
              type="button"
            >
              {t('common.cancel')}
            </button>
            {isSearch || isReveal ? (
              <>
                <button
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:border-slate-500 transition-all"
                  data-test="look-submit-no-shuffle"
                  onClick={() => resolve(false)}
                  type="button"
                >
                  {t('consult.submitNoShuffle')}
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-sky-950/50 hover:from-sky-500 hover:to-indigo-500 active:scale-[0.98] transition-all"
                  data-test="look-submit"
                  onClick={() => resolve(true)}
                  type="button"
                >
                  <span>🔀</span>
                  <span>{t('consult.submitShuffle')}</span>
                </button>
              </>
            ) : (
              <button
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-sky-950/50 hover:bg-sky-500 active:scale-[0.98] transition-all"
                data-test="look-submit"
                onClick={() => resolve(false)}
                type="button"
              >
                {t('common.validate')}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

/** Composant carte individuelle avec affordances riches et sélecteurs directs */
function LookCardItem({
  card,
  bucket,
  compact,
  scale,
  picked,
  menuOpen,
  hasAnyMenuOpen,
  offered,
  onPick,
  onAssign,
  onInspect,
  onOpenMenu,
  onToggleMenu,
  onCloseMenu,
}: {
  card: PublicCardView;
  offered: BucketDef[];
  bucket: Bucket;
  compact: boolean;
  scale: number;
  picked: boolean;
  menuOpen: boolean;
  hasAnyMenuOpen: boolean;
  onPick: (additive: boolean) => void;
  onAssign: (bucket: Bucket) => void;
  onInspect: () => void;
  onOpenMenu: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
}): React.ReactElement {
  const hoverPreview = useGame((s) => s.hoverPreview);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const language = useLanguage();
  const t = useT();
  useLocalizationTick();
  const meta = cardMeta(card.scryfallId);
  // Le nom imprimé français quand il existe, sinon celui du catalogue. Le nom
  // anglais reste la clé de recherche et de tri : seul l'affichage change.
  const name =
    localizedCardName(localizedCard(card.scryfallId, language), meta?.name) ??
    cardName(card.scryfallId);
  // `offered` peut ne pas contenir la destination courante (la réserve
  // disparaît une fois la partie lancée) : on relit donc la table complète.
  const allBuckets = bucketDefs(t);
  const bucketDef = allBuckets.find((b) => b.key === bucket) ?? (allBuckets[0] as BucketDef);
  const isAssigned = bucket !== 'top';

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      onCloseMenu();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [menuOpen, onCloseMenu]);

  return (
    <div
      className={`group relative rounded-xl p-1.5 transition-all duration-150 flex flex-col justify-between ${
        menuOpen ? 'z-30' : ''
      } ${
        picked
          ? 'ring-2 ring-amber-400 bg-amber-500/15 shadow-md shadow-amber-950/40'
          : isAssigned
            ? bucketDef.ringClass
            : 'border border-slate-800/80 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80'
      }`}
      data-test="look-card"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        hoverPreview(null);
        onOpenMenu();
      }}
    >
      {/* Badge de destination actuel si assigné */}
      {isAssigned && (
        <div className="absolute -top-2 left-1 right-1 z-10 flex items-center justify-between">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${bucketDef.badgeBg}`}
          >
            <span>{bucketDef.icon}</span>
            <span>{bucketDef.shortLabel}</span>
          </span>
          <button
            className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900/90 text-[10px] font-bold text-slate-300 hover:bg-rose-900 hover:text-white border border-slate-700 transition-colors shadow"
            onClick={(e) => {
              e.stopPropagation();
              onAssign('top');
            }}
            title={t('consult.cancelAssignment')}
            type="button"
          >
            ✕
          </button>
        </div>
      )}

      {/* Visuel de la carte */}
      <div
        className="relative cursor-pointer select-none flex justify-center items-center rounded-lg"
        onClick={(e) => onPick(e.ctrlKey || e.metaKey || e.shiftKey)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          // Raccourci joueur : double-clic bascule directement en main (tuteur habituel)
          onAssign(bucket === 'hand' ? 'top' : 'hand');
        }}
        onMouseEnter={() => {
          if (!menuOpen && !hasAnyMenuOpen) {
            hoverPreview(card.scryfallId ?? null);
          }
        }}
        onMouseLeave={() => hoverPreview(null)}
        title={t('consult.cardTitleHint', { name })}
      >
        <CardSprite card={card} scale={scale} />

        {/* Bouton de loupe / inspection */}
        <button
          className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/80 text-xs text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-sky-600 hover:text-white border border-white/20 transition-all shadow"
          onClick={(e) => {
            e.stopPropagation();
            hoverPreview(null);
            onInspect();
          }}
          title={t('consult.inspect')}
          type="button"
        >
          🔍
        </button>
      </div>

      <div className="flex items-center justify-between gap-1 mt-1.5 px-0.5">
        <label className="flex items-center gap-1.5 cursor-pointer min-w-0 flex-1">
          <input
            type="checkbox"
            checked={picked}
            onChange={(e) => {
              e.stopPropagation();
              onPick(false);
            }}
            className="h-3.5 w-3.5 rounded accent-amber-500 cursor-pointer shrink-0"
            title={t('consult.pickForBulk')}
          />
          <span className="truncate text-xs font-semibold text-slate-100 leading-tight" title={name}>
            {name}
          </span>
        </label>
        {meta?.manaCost && (
          <ManaCost
            className="rounded border border-slate-800 bg-slate-950/80 px-1 py-0.5 text-[10px] font-bold text-amber-300/90"
            cost={meta.manaCost}
            size="sm"
          />
        )}
      </div>

      {/* Barre d'actions rapides sous la carte */}
      <div className="mt-1.5 flex items-center justify-between gap-1 pt-1 border-t border-slate-800/80">
        <button
          className={`flex-1 rounded py-0.5 text-[10px] font-bold transition-all ${
            bucket === 'hand'
              ? 'bg-sky-600 text-white'
              : 'bg-slate-800/80 text-slate-300 hover:bg-sky-950/80 hover:text-sky-200'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onAssign(bucket === 'hand' ? 'top' : 'hand');
          }}
          title={t('consult.quickHand')}
          type="button"
        >
          🖐️ {t('consult.bucketHandShort')}
        </button>
        <button
          className={`flex-1 rounded py-0.5 text-[10px] font-bold transition-all ${
            bucket === 'battlefield'
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-800/80 text-slate-300 hover:bg-emerald-950/80 hover:text-emerald-200'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onAssign(bucket === 'battlefield' ? 'top' : 'battlefield');
          }}
          title={t('consult.quickBattlefield')}
          type="button"
        >
          ⚔️ {t('consult.bucketBattlefieldShort')}
        </button>
        <button
          ref={btnRef}
          className={`rounded px-1.5 py-0.5 text-[10px] transition-all ${
            menuOpen
              ? 'bg-sky-600 text-white ring-1 ring-sky-400'
              : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            hoverPreview(null);
            onToggleMenu();
          }}
          onMouseEnter={() => hoverPreview(null)}
          title={t('consult.moreActions')}
          type="button"
        >
          •••
        </button>
      </div>

      {/* Menu contextuel rapide (clic droit ou bouton •••) */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 bottom-8 z-30 min-w-48 rounded-xl border border-slate-700/90 bg-slate-900/98 p-1.5 shadow-2xl shadow-black/90 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={(e) => {
            e.stopPropagation();
            hoverPreview(null);
          }}
          onPointerEnter={(e) => {
            e.stopPropagation();
            hoverPreview(null);
          }}
          onMouseMove={(e) => {
            e.stopPropagation();
            hoverPreview(null);
          }}
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-2 py-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <span>{t('consult.moveTo')}</span>
            <kbd className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[9px] text-slate-400">
              {t('keys.esc')}
            </kbd>
          </div>
          <div className="pt-1 space-y-0.5">
            {offered.map((b) => (
              <button
                key={b.key}
                data-test={`look-action-${b.key}`}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                  bucket === b.key
                    ? 'bg-sky-950/90 text-sky-200 border border-sky-600/50 font-semibold'
                    : 'text-slate-200 hover:bg-slate-800 hover:text-white'
                }`}
                title={b.hint}
                onClick={(e) => {
                  e.stopPropagation();
                  hoverPreview(null);
                  onAssign(b.key);
                  onCloseMenu();
                }}
                type="button"
              >
                <span className="w-4 text-center text-sm">{b.icon}</span>
                <span className="flex-1">{b.label}</span>
                {bucket === b.key && <span className="text-[10px] text-sky-400 font-bold">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}