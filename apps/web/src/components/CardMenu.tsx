/**
 * Menu contextuel d'une carte.
 *
 * Les actions dépendent de la zone où se trouve la carte : on ne propose pas
 * « Jouer » depuis le cimetière ni « Défausser » depuis le champ de bataille.
 * Le vocabulaire et les raccourcis suivent ceux de la table de référence.
 */
import { useEffect, useRef, useState } from 'react';
import type { CardView, ZoneKind } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { api } from '../lib/api.js';
import { cardMeta, cardName } from '../lib/cards.js';
import { localizedCard, localizedCardName, useLocalizationTick } from '../lib/cardLocalization.js';
import { useLanguage } from '../store/prefs.js';
import { tokenName, useT } from '../lib/i18n/index.js';
import { PrintingPicker } from './PrintingPicker.js';
import { useMenuPlacement } from '../lib/menu.js';
import { askNumber, openDialog } from './Dialog.js';
import { shelveToken } from './TokenShelf.js';
import { allTapped, tapIntent } from '../lib/tap.js';
import {
  COMPUTED_SIGIL,
  COUNT_SOURCES,
  HIDDEN_REFUSAL,
  computedCounter,
  describeComputed,
  editCounter,
  frozenCount,
  frozenCounterIntents,
  getCardStat,
  isKnownSubtype,
  parseOffset,
  ptCounter,
  renderSide,
  subtypeOptions,
} from './CardSprite.js';
import { CARD_HEIGHT, CARD_WIDTH } from '../lib/cards.js';
import { PANEL_WIDTH } from './SeatPanel.js';

/** Pas d'alignement : une carte, plus un filet d'air pour qu'on les distingue. */
const ALIGN_STEP_X = CARD_WIDTH + 12;
const ALIGN_STEP_Y = CARD_HEIGHT + 12;
import { freeSpot } from '../lib/drag.js';

/**
 * Valeur de mana lue sur le coût, et l'aveu qu'on n'en est pas sûr.
 *
 * Ce n'est qu'une **proposition** : la valeur part au serveur dans l'intent
 * parce que c'est le joueur qui la valide, et le serveur ne la recalcule pas.
 * Un `X` vaut zéro hors de la pile, un symbole hybride vaut le plus élevé de
 * ses composants, phyrexian ne coûte rien de plus.
 *
 * `ambiguous` dit qu'on a trouvé un coût sur **plusieurs faces** — une carte
 * partagée, une aventure, une recto-verso modale. Les règles y tranchent selon
 * la carte et selon la zone ; le dialogue le dit et laisse corriger, plutôt que
 * de faire semblant de savoir. Le serveur tient le même raisonnement de son
 * côté et s'arrête sur une telle carte au lieu de la juger.
 */
function manaValueOfCost(cost: string): number {
  let total = 0;
  for (const match of cost.matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1]!.toUpperCase();
    if (/^\d+$/.test(symbol)) total += Number(symbol);
    else if (symbol === 'X' || symbol === 'Y' || symbol === 'Z') total += 0;
    else if (symbol.includes('/')) {
      total += Math.max(
        ...symbol.split('/').map((p) => (p === 'P' ? 0 : /^\d+$/.test(p) ? Number(p) : 1)),
      );
    } else total += 1;
  }
  return total;
}

export function suggestedManaValue(
  meta: { manaCost: string | null; faces: Array<{ name: string }> | null } | undefined,
): { value: number; ambiguous: boolean } | null {
  if (!meta) return null;
  const faces = (meta.faces ?? []) as Array<{ manaCost?: unknown }>;
  const faceCosts = faces
    .map((f) => (typeof f.manaCost === 'string' ? f.manaCost : ''))
    .filter((c) => c.length > 0);
  if (faceCosts.length > 1) return { value: manaValueOfCost(faceCosts[0]!), ambiguous: true };
  const own = meta.manaCost ?? '';
  if (own.length > 0) return { value: manaValueOfCost(own), ambiguous: false };
  if (faceCosts.length === 1) return { value: manaValueOfCost(faceCosts[0]!), ambiguous: false };
  // Un sort sans coût — un suspendu — vaut bel et bien zéro, et c'est sûr.
  return { value: 0, ambiguous: false };
}

/**
 * Les mots-clés assistés que le catalogue reconnaît sur cette carte.
 *
 * Trois états, et c'est la raison d'être de cette fonction : `keywords` peut
 * **contenir** le mot, être un tableau **vide** — « cette carte n'en a aucun »,
 * un fait —, ou être **absent** — « on ne sait pas », une ligne de catalogue
 * jamais ré-ingérée, une carte face cachée, une fiche pas encore arrivée du
 * serveur. `known` distingue les deux derniers.
 *
 * Aucun des trois ne ferme quoi que ce soit : le tiroir des actions assistées
 * est offert dans tous les cas. La détection ne sert qu'à **remonter** l'action
 * dans le menu principal. Une comparaison insensible à la casse, parce que le
 * libellé de Scryfall est capitalisé (« Cascade ») et qu'on ne veut pas
 * dépendre de sa typographie.
 */
export function assistedKeywords(meta: { keywords?: string[] | null } | undefined): {
  cascade: boolean;
  discover: boolean;
  known: boolean;
} {
  const list = meta?.keywords;
  if (!Array.isArray(list)) return { cascade: false, discover: false, known: false };
  const has = (word: string): boolean => list.some((k) => k.toLowerCase() === word);
  return { cascade: has('cascade'), discover: has('discover'), known: true };
}

/**
 * L'Incubateur, et pourquoi son nom porte deux faces.
 *
 * Le jeton d'« Incuber » est **recto-verso** : le catalogue le nomme
 * « Incubator // Phyrexian » — l'artefact d'un côté, la créature phyrexiane de
 * l'autre — et il n'existe aucune impression nommée « Incubator » tout court.
 * La recherche par nom exact ne pouvait donc pas le trouver, et l'entrée de
 * menu ne rendait que « Jeton introuvable ».
 *
 * Le nom entier est la **clé de catalogue**, pas un libellé : ce que le joueur
 * lit vient de `catalog.*` dans le dialogue, et du glossaire des jetons partout
 * ailleurs — `tokenName('Incubator // Phyrexian', 'fr')` traduit face par face
 * et rend « Incubateur // Phyrexian », le type phyrexian n'étant pas francisé.
 */
const INCUBATOR_TOKEN = 'Incubator // Phyrexian';

/**
 * Les jetons que les raccourcis nommés savent créer, sous leur nom **anglais**.
 *
 * C'est une clé de recherche, pas un libellé : `/api/cards/search` n'interroge
 * que les noms du catalogue anglais (voir `TokenSearch`), et traduire la clé
 * rendrait « Trésor » introuvable. Ce que le joueur lit est traduit à part, par
 * le catalogue d'interface.
 *
 * La liste est **fermée exprès**, et ce n'est pas une limite technique : ces
 * cinq-là sont les jetons génériques qu'on crée dix fois par partie sans avoir
 * à choisir lesquels. Tout le reste passe par la recherche de jetons et
 * l'étagère, qui ne bougent pas.
 *
 * **Chaque nom est celui du catalogue, vérifié contre lui.** Deux d'entre eux
 * avaient été écrits de mémoire et ne désignaient rien : l'entrée était morte
 * et personne ne le savait. Un pas de recette (`scripts/verify-ui.mjs`,
 * « chaque jeton nommé du menu existe au catalogue ») déclenche désormais
 * chacune de ces entrées contre la vraie base et tombe si l'une d'elles rend
 * « Jeton introuvable » — c'est le seul endroit où ce mensonge-là se voit, un
 * test unitaire n'ayant pas de catalogue.
 */
const NAMED_TOKENS = ['Clue', 'Treasure', 'Food', 'Blood', INCUBATOR_TOKEN] as const;

/** Le type de créature d'« Amasser », et la clé qui interroge le catalogue. */
const ARMY_TYPE = 'Army';

/**
 * L'impression d'un jeton nommé, cherchée dans le catalogue local.
 *
 * **Choisir une impression n'est pas arbitrer** : le protocole tient déjà
 * l'impression pour un habillage sans effet de jeu (`SET_PRINTING` « change
 * l'impression sans changer l'identité »). Le classement de la recherche met la
 * mieux notée en tête, et c'est elle qu'on prend — exactement ce que le joueur
 * aurait cliqué au premier résultat.
 *
 * Le nom doit correspondre **exactement**. À défaut, on ne rend rien plutôt que
 * de poser un jeton approchant : « Treasure Map » n'est pas un Trésor, et créer
 * la mauvaise chose est bien pire que de dire qu'on n'a pas trouvé.
 */
async function namedTokenPrinting(name: string): Promise<string | null> {
  try {
    const found = await api.get<{ results: Array<{ scryfallId: string; name: string }> }>(
      `/api/cards/search?q=${encodeURIComponent(name)}&type=token`,
    );
    const exact = found.results.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return exact?.scryfallId ?? null;
  } catch {
    return null;
  }
}

/**
 * « Armée » est un **type de créature**, pas un nom de jeton.
 *
 * C'est toute l'erreur qu'on répare : il n'existe aucun jeton nommé « Army »,
 * parce qu'« Amasser » crée l'armée de la race de la carte — Zombie Army, Orc
 * Army, Goblin Army, Sliver Army, et la prochaine extension en ajoutera une
 * autre. Le nom se lit donc sur la **ligne de type**, après le tiret cadratin,
 * et non en comparant des noms écrits de mémoire.
 *
 * Les deux faces d'un jeton recto-verso sont examinées séparément : il suffit
 * qu'une seule soit une armée.
 */
function isArmyTypeLine(typeLine: string | null | undefined): boolean {
  if (typeof typeLine !== 'string') return false;
  return typeLine.split('//').some((face) => {
    const dash = face.search(/[—–]/);
    return dash >= 0 && /(^|\s)Army(\s|$)/i.test(face.slice(dash + 1));
  });
}

/**
 * Les armées que **le catalogue** connaît, une impression par nom.
 *
 * Rien n'est écrit en dur, et c'est le point : une liste de noms figée ici
 * rouvrirait le même défaut à la première extension qui amasse des elfes. On
 * interroge la même recherche de jetons que l'étagère, sur le type, et l'on
 * garde de chaque nom la **première** impression rendue — la recherche classe
 * la mieux notée en tête, exactement ce que le joueur aurait cliqué au premier
 * résultat.
 *
 * Une liste vide n'est pas une erreur silencieuse : l'appelant le dit.
 */
async function armyPrintings(): Promise<Array<{ name: string; scryfallId: string }>> {
  try {
    const found = await api.get<{
      results: Array<{ scryfallId: string; name: string; typeLine: string }>;
    }>(`/api/cards/search?q=${encodeURIComponent(ARMY_TYPE)}&type=token`);
    const best = new Map<string, string>();
    for (const hit of found.results) {
      if (!isArmyTypeLine(hit.typeLine)) continue;
      if (!best.has(hit.name)) best.set(hit.name, hit.scryfallId);
    }
    return [...best].map(([name, scryfallId]) => ({ name, scryfallId }));
  } catch {
    return [];
  }
}

export interface CardMenuProps {
  card: CardView;
  x: number;
  y: number;
  onClose: () => void;
}

interface Entry {
  label: string;
  shortcut?: string;
  /** Absent sur une **catégorie** : elle ouvre son sous-menu au lieu d'agir. */
  run?: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
  /**
   * Second niveau, ouvert au survol **et au clic**.
   *
   * C'est le tiroir des actions assistées : elles ne concernent qu'une carte
   * sur cent, et leur place n'est pas dans le menu principal de toutes les
   * autres. Quand le catalogue sait que la carte porte le mot-clé, l'action
   * **remonte** dans le menu principal — la détection sert à raccourcir le
   * chemin, jamais à l'ouvrir ni à le fermer : le tiroir reste là dans tous
   * les cas.
   */
  submenu?: Entry[];
}

/**
 * Largeur du sous-menu, en pixels. **Doit suivre la classe `w-64`** posée sur
 * le panneau : c'est elle qui décide de la bascule à gauche, avant tout rendu,
 * donc avant qu'on puisse mesurer quoi que ce soit.
 */
const SUBMENU_WIDTH = 256;

/** L'habillage d'une ligne de menu, partagé par les deux niveaux. */
const ENTRY_CLASS =
  'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium transition-colors hover:bg-slate-800/90 active:bg-slate-700/80';

function EntryButton({
  entry,
  openSub,
  setOpenSub,
}: {
  entry: Entry;
  openSub: string | null;
  setOpenSub: (next: { label: string; rect: DOMRect } | null) => void;
}): React.ReactElement {
  const ref = useRef<HTMLButtonElement | null>(null);
  const isOpen = openSub === entry.label;

  const open = (): void => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setOpenSub({ label: entry.label, rect });
  };

  return (
    <button
      ref={ref}
      className={`${ENTRY_CLASS} ${
        entry.danger ? 'text-rose-300 hover:text-rose-200 hover:bg-rose-950/40' : 'text-slate-200 hover:text-white'
      } ${entry.separatorBefore ? 'mt-1 border-t border-slate-800/80 pt-1.5' : ''} ${
        isOpen ? 'bg-slate-800/90 text-white' : ''
      }`}
      /*
       * Survol **et** clic, et le clic n'est pas un supplément d'âme : la table
       * est une PWA qui se joue au doigt, et un tiroir qui ne s'ouvre qu'au
       * survol serait inatteignable sans souris. Le clic bascule, pour qu'un
       * second appui referme au lieu de piéger le doigt.
       */
      onPointerEnter={() => (entry.submenu ? open() : setOpenSub(null))}
      onClick={() => {
        if (!entry.submenu) return entry.run?.();
        if (isOpen) setOpenSub(null);
        else open();
      }}
    >
      <span className="truncate">{entry.label}</span>
      {entry.submenu ? (
        <span className="ml-2 shrink-0 text-slate-400" aria-hidden>
          ›
        </span>
      ) : (
        entry.shortcut && (
          <kbd className="ml-2 rounded border border-slate-700 bg-slate-800/90 px-1.5 py-0.5 text-[10px] font-mono font-medium text-slate-400">
            {entry.shortcut}
          </kbd>
        )
      )}
    </button>
  );
}

/**
 * Le second niveau.
 *
 * Le placement **réutilise `useMenuPlacement`** plutôt que d'ouvrir un second
 * calcul : la bascule vers le haut, le rognage dans la fenêtre et le
 * défilement interne d'un menu plus haut que l'écran y sont déjà, et les
 * réécrire ici les aurait fait diverger au premier correctif. La seule chose
 * que ce composant ajoute, c'est le **côté** : à droite de la catégorie si le
 * sous-menu y tient, à gauche sinon. Sur une fenêtre trop étroite pour l'un
 * comme pour l'autre, le rognage le pose par-dessus le menu parent — c'est la
 * réponse des menus tactiles, et `Échap` ramène au parent.
 */
function Submenu({ anchor, entries }: { anchor: DOMRect; entries: Entry[] }): React.ReactElement {
  const fitsRight = anchor.right + SUBMENU_WIDTH + 8 <= window.innerWidth;
  const { ref, style } = useMenuPlacement(
    fitsRight ? anchor.right + 2 : anchor.left - SUBMENU_WIDTH - 2,
    anchor.top,
  );

  return (
    <div
      ref={ref}
      className="scrollbar-thin fixed z-[60] w-64 rounded-xl border border-slate-700/80 bg-slate-900/95 py-1.5 shadow-2xl shadow-black/80 backdrop-blur-xl"
      data-test="card-submenu"
      style={style}
      /*
       * Rien n'est nécessaire pour **garder** le tiroir ouvert quand le pointeur
       * y entre : il est au-dessus du menu parent, les events de pointeur vont
       * au plus haut, et aucune ligne du parent ne reçoit donc de survol. Le
       * chemin entre les deux ne traverse pas non plus le parent — le tiroir
       * s'ouvre à deux pixels de son bord, hors du panneau.
       */
    >
      {entries.map((entry) => (
        <button
          key={entry.label}
          className={`${ENTRY_CLASS} text-slate-200 hover:text-white ${
            entry.separatorBefore ? 'mt-1 border-t border-slate-800/80 pt-1.5' : ''
          }`}
          onClick={entry.run}
        >
          <span className="truncate">{entry.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Aperçu dynamique et ergonomique du marqueur en cours de configuration.
 * Calcule en direct l'impact et la valeur selon les choix du joueur.
 */
function CustomCounterPreview({
  card,
  values,
}: {
  card: CardView;
  values: Record<string, string>;
}): React.ReactElement {
  const t = useT();
  const state = useGame.getState();
  const scryfallId = card.faceDown === false ? card.scryfallId : undefined;
  const meta = cardMeta(scryfallId);
  const name = meta?.name ?? t('card.selectedCard');
  const typeLine = meta?.typeLine ?? t('card.genericPermanent');
  const forme = values['forme'] ?? 'pt';

  let badgeNode: React.ReactNode = null;
  let formulaDesc: string = '';
  let countSummary: string = '';
  let modeBadge = null;

  if (forme === 'pt') {
    const pair = values['pair'] || '+1/+1';
    badgeNode = (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-sky-950/90 text-sky-200 border border-sky-500 shadow-sm">
        ⚔️ {pair}
      </span>
    );
    formulaDesc = t('counter.ptAdjust', { pair });
  } else if (forme === 'named') {
    const kind = values['kind'] || 'loyauté';
    const val = values['value'] || '1';
    badgeNode = (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-purple-950/90 text-purple-200 border border-purple-500 shadow-sm">
        🏷️ {kind} {val ? `(${val})` : ''}
      </span>
    );
    formulaDesc = t('counter.namedDesc', { kind, value: val || '1' });
  } else if (forme === 'keyword') {
    const kind = values['kind'] || 'vol';
    badgeNode = (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-teal-950/90 text-teal-200 border border-teal-500 shadow-sm">
        ✨ {kind}
      </span>
    );
    formulaDesc = t('counter.keywordDesc', { kind });
  } else if (forme === 'calc') {
    const src = values['calcsrc'] ?? 'bat.land';
    const qui = (values['calcqui'] ?? 'vous') as 'vous' | 'adv' | 'tous';
    const mode = values['calcmode'] ?? 'suit';
    const offset = parseOffset(values['calcoffset']);
    // Le réglage ne vaut qu'en mode figé : ailleurs il n'a nulle part où aller
    // dans le `kind`, et l'aperçu ne doit donc pas faire semblant.
    const excludeOther = mode === 'fige' && values['calcexclude'] === 'other';

    /* L'aperçu et la pose lisent la **même** fonction : c'est la seule façon de
       garantir que ce qu'on montre est ce qui sera posé. */
    const count = frozenCount(state, card, { src, qui, offset, excludeOther });
    const baseValue = count?.base ?? 0;
    const finalValue = count?.final ?? 0;

    if (mode === 'fige') {
      const figeForm = values['calcfigeform'] ?? 'pt_set';
      const figeName = values['calcfigename'] ?? 'charge';
      let figeText = '';
      if (finalValue <= 0) {
        figeText = t('counter.noneZero');
      } else if (figeForm === 'pt_set') {
        figeText = `${finalValue}/${finalValue}`;
      } else if (figeForm === 'pt_add') {
        figeText = `+${finalValue}/+${finalValue}`;
      } else if (figeForm === 'pt_counters') {
        figeText = `+1/+1 (×${finalValue})`;
      } else {
        figeText = `${figeName} (×${finalValue})`;
      }

      badgeNode = (
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
            finalValue <= 0
              ? 'bg-amber-950/80 text-amber-200 border-amber-500/80'
              : 'bg-indigo-950/90 text-indigo-200 border-indigo-500 shadow-sm'
          }`}
        >
          🧊 {figeText}
        </span>
      );
      modeBadge = (
        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
          {t('counter.modeFrozen')}
        </span>
      );
      countSummary = t('counter.countFrozen', {
        base: baseValue,
        offset:
          offset !== 0
            ? t('counter.offsetSuffix', { offset: offset > 0 ? `+${offset}` : offset })
            : '',
        final: finalValue,
      });
      formulaDesc =
        finalValue <= 0
          ? t('counter.zeroWarning')
          : t('counter.willFreeze', { value: finalValue });
    } else {
      let gabarit =
        mode === 'ajout' ? (values['calcpt2'] ?? '+*/+*') : (values['calcpt'] ?? '*/*');
      if (offset !== 0) {
        const sign = offset > 0 ? `+${offset}` : `${offset}`;
        if (mode === 'suit') {
          if (gabarit === '*/*') gabarit = `*${sign}/*${sign}`;
          else if (gabarit === '*/*+1') gabarit = `*${sign}/*${offset + 1 >= 0 ? `+${offset + 1}` : offset + 1}`;
          else if (gabarit === '*+1/*') gabarit = `*${offset + 1 >= 0 ? `+${offset + 1}` : offset + 1}/*${sign}`;
        } else if (mode === 'ajout') {
          if (gabarit === '+*/+*') gabarit = `+*${sign}/+*${sign}`;
          else if (gabarit === '+*/+0') gabarit = `+*${sign}/+0`;
          else if (gabarit === '+0/+*') gabarit = `+0/+*${sign}`;
        }
      }
      const calcKind = `${COMPUTED_SIGIL}${gabarit} ${src}@${qui}`;
      const spec = computedCounter(calcKind);
      let previewDisplay = '?/?';
      if (spec) {
        previewDisplay = `${renderSide(spec.left, baseValue)}/${renderSide(spec.right, baseValue)}`;
      }

      badgeNode = (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-violet-950/90 text-violet-200 border border-dashed border-violet-400 shadow-sm">
          {COMPUTED_SIGIL} {previewDisplay}
        </span>
      );
      modeBadge = (
        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
          {t('counter.modeDynamic')}
        </span>
      );
      countSummary = t('counter.countDynamic', {
        base: baseValue,
        offset:
          offset !== 0
            ? t('counter.offsetSuffix', { offset: offset > 0 ? `+${offset}` : offset })
            : '',
        preview: previewDisplay,
      });
      formulaDesc = spec ? describeComputed(spec) : calcKind;
    }
  }

  return (
    <div className="flex flex-col gap-3.5 h-full" data-test="custom-counter-preview">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {t('counter.preview')}
        </h3>
        {modeBadge}
      </div>

      <div className="rounded-xl border border-slate-700/80 bg-slate-900/80 p-3.5 shadow-inner flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-100 truncate">{name}</p>
            <p className="text-[11px] text-slate-400 italic truncate">{typeLine}</p>
          </div>
          <div className="shrink-0">{badgeNode}</div>
        </div>

        {countSummary && (
          <div className="rounded-lg bg-slate-800/80 border border-slate-700/60 p-2 text-xs text-slate-200 font-medium">
            {countSummary}
          </div>
        )}

        <p className="text-xs leading-relaxed text-slate-300">
          {formulaDesc}
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-[11px] text-slate-400 leading-snug space-y-1.5 mt-auto">
        <p className="font-semibold text-slate-300">{t('counter.tipTitle')}</p>
        <p>{forme === 'calc' ? t('counter.tipCalc') : t('counter.tipPlain')}</p>
      </div>
    </div>
  );
}

export function CardMenu({ card, x, y, onClose }: CardMenuProps): React.ReactElement {
  // Le titre du menu est le seul nom de carte **affiché** par ce fichier ; tous
  // les autres servent de clé (étiquette de l'étagère, mots-clés de recherche du
  // dialogue) et restent donc ceux du catalogue.
  useLocalizationTick();
  const t = useT();
  const language = useLanguage();
  const send = useGame((s) => s.send);
  const mySeat = useGame((s) => s.mySeat);
  /** Sideboarder n'a de sens qu'avant le lancement. */
  const started = useGame((s) => s.room?.status === 'PLAYING');
  const selection = useGame((s) => s.selection);
  /** Les sièges, pour choisir à qui l'on montre une carte de sa main. */
  const seats = useGame((s) => s.seats);
  const beginAttach = useGame((s) => s.beginAttach);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** La catégorie dont le tiroir est ouvert, et l'ancre qui le positionne. */
  const [openSub, setOpenSub] = useState<{ label: string; rect: DOMRect } | null>(null);
  const { ref, style } = useMenuPlacement(x, y);
  /*
   * La carte **vivante** du store, et non celle que l'ouvreur nous a passée :
   * les boutons − et + du bloc des marqueurs agissent sans refermer le menu, il
   * faut donc que le nombre affiché suive l'écho du serveur. Le sélecteur rend
   * l'objet de la Map tel quel — aucun tableau ni objet neuf, donc aucune
   * boucle de rendu.
   */
  const live = useGame((s) => s.cards.get(card.id)) ?? card;

  useEffect(() => {
    useGame.getState().setHovered(null);
    useGame.getState().hoverPreview(null);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const seat = mySeat ?? card.owner;
  const zone = (kind: ZoneKind) => ({ seat: card.owner, kind });
  /**
   * Première place libre du terrain d'accueil, plutôt que le coin (60, 60) où
   * chaque carte jouée se posait sur la précédente.
   */
  const landing = (): { x: number; y: number } =>
    freeSpot(
      [...useGame.getState().cards.values()]
        .filter((c) => c.zone.kind === 'BATTLEFIELD' && c.zone.seat === card.owner)
        .map((c) => ({ x: c.x, y: c.y })),
    );
  // Une action groupée s'applique à la sélection si la carte en fait partie.
  const targets = selection.has(card.id) ? [...selection] : [card.id];
  /** Les autres sièges : les destinataires possibles d'une révélation. */
  const others = seats.filter((s) => s.id !== seat);

  /**
   * Déplacement, à l'unité ou en groupe.
   *
   * Un groupe part en un seul `MOVE_CARDS` : le serveur le traite comme un tout,
   * et la table n'y voit qu'un event au lieu de N. L'exception est le champ de
   * bataille, où chaque carte a ses propres coordonnées, que `MOVE_CARDS` ne
   * transporte pas — on retombe alors sur des `MOVE_CARD`, légèrement décalés
   * pour que la pile reste lisible.
   */
  const move = (kind: ZoneKind, extra: Record<string, unknown> = {}): void => {
    const toBattlefield = kind === 'BATTLEFIELD';
    if (targets.length > 1 && !toBattlefield) {
      const { index, faceDown } = extra as { index?: unknown; faceDown?: unknown };
      send({
        type: 'MOVE_CARDS',
        cardIds: targets,
        to: zone(kind),
        ...(index !== undefined ? { index } : {}),
        ...(faceDown !== undefined ? { faceDown } : {}),
      } as never);
      onClose();
      return;
    }
    targets.forEach((id, i) => {
      const spread = toBattlefield ? { x: Number(extra['x'] ?? 60) + i * 24, y: Number(extra['y'] ?? 60) + i * 24 } : {};
      send({ type: 'MOVE_CARD', cardId: id, to: zone(kind), ...extra, ...spread } as never);
    });
    onClose();
  };

  const entries: Entry[] = [];
  const inZone = card.zone.kind;
  /** Posée face cachée sur la table, que j'en connaisse ou non l'identité. */
  const facedown = card.faceDown === true || card.facedownOnTable === true;
  const everyTapped = allTapped(targets);

  if (inZone === 'HAND') {
    entries.push(
      { label: t('card.play'), shortcut: 'P', run: () => move('BATTLEFIELD', landing()) },
      { label: t('card.playFaceDown'), shortcut: 'M', run: () => move('BATTLEFIELD', { ...landing(), faceDown: true }) },
      { label: t('card.toStack'), shortcut: 'S', run: () => move('STACK_NOTE') },
      { label: t('card.revealAll'), run: () => { send({ type: 'REVEAL', cardIds: targets, toSeats: 'ALL' }); onClose(); } },
      /*
       * Révéler à une ou plusieurs personnes.
       *
       * `REVEAL` accepte depuis toujours une liste de sièges, mais le menu ne
       * savait dire que « à tous » : montrer sa main à un seul adversaire — le
       * geste d'un pacte, d'un effet qui ne regarde qu'une personne — était
       * impossible. L'entrée n'apparaît qu'à partir d'un autre siège : à une
       * table d'un joueur, « à qui ? » n'a pas de réponse.
       */
      ...(others.length > 0
        ? [
            {
              label: t('card.revealTo'),
              run: () => {
                onClose();
                void openDialog({
                  title: t('card.revealDialogTitle', { count: targets.length }),
                  description: t('card.revealDialogDescription'),
                  choicesLabel: t('card.revealDialogRecipients'),
                  choices: others.map((s) => ({ id: s.id, label: s.displayName, color: s.color })),
                  requireChoice: true,
                  submitLabel: t('common.reveal'),
                }).then((result) => {
                  if (result) send({ type: 'REVEAL', cardIds: targets, toSeats: result.chosen });
                });
              },
            },
          ]
        : []),
      { label: t('card.discard'), shortcut: 'G', run: () => move('GRAVEYARD'), separatorBefore: true },
      { label: t('card.exile'), shortcut: 'E', run: () => move('EXILE') },
      { label: t('zone.libraryTop'), shortcut: 'L', run: () => move('LIBRARY', { index: 'TOP' }) },
      { label: t('zone.libraryBottom'), shortcut: 'B', run: () => move('LIBRARY', { index: 'BOTTOM' }) },
      {
        label: t('card.nthFromTop'),
        run: () => {
          /*
           * Le dialogue vit dans sa propre racine : on referme le menu tout de
           * suite, et le déplacement part quand la promesse se dénoue. Un
           * `move()` tardif rappelle `onClose()`, sans effet — le menu n'est
           * déjà plus là.
           */
          onClose();
          void askNumber({
            title: t('card.libraryPlaceTitle'),
            label: t('card.libraryPlaceLabel'),
            initial: 3,
            quick: [1, 2, 3, 5, 10],
            memory: 'library-nth',
          }).then((n) => {
            if (n !== null) move('LIBRARY', { index: n - 1 });
          });
        },
      },
    );
    if (!started) {
      entries.push({
        label: t('card.toSideboard'),
        separatorBefore: true,
        run: () => move('SIDEBOARD'),
      });
    }
  }

  if (inZone === 'BATTLEFIELD') {
    /*
     * Aligner la prise du lasso.
     *
     * C'est le geste qui suit naturellement une sélection au lasso : on vient
     * d'attraper huit terrains éparpillés, on veut les ranger en ligne. Chaque
     * carte part dans son propre `MOVE_CARD` — `MOVE_CARDS` n'emporte pas de
     * coordonnées par carte —, ce qui ne coûte rien au journal : un
     * déplacement au sein d'une même zone n'y écrit pas de ligne.
     *
     * L'ancre est le coin haut-gauche de ce qui est sélectionné : le groupe se
     * range là où il est, il ne saute pas à l'autre bout du terrain.
     */
    if (targets.length > 1) {
      entries.push({
        label: t('card.alignSelection', { count: targets.length }),
        run: () => {
          const state = useGame.getState();
          const chosen = targets
            .map((id) => state.cards.get(id))
            .filter((c): c is CardView => c !== undefined && c.zone.kind === 'BATTLEFIELD')
            .sort((a, b) => a.x - b.x || a.y - b.y);
          if (chosen.length === 0) return onClose();

          const left = Math.min(...chosen.map((c) => c.x));
          const top = Math.min(...chosen.map((c) => c.y));
          // Au-delà, la rangée sortirait du panneau : on passe à la suivante.
          const perRow = Math.max(1, Math.floor((PANEL_WIDTH - left - 16) / ALIGN_STEP_X));

          chosen.forEach((moved, rank) => {
            state.send({
              type: 'MOVE_CARD',
              cardId: moved.id,
              to: moved.zone,
              x: Math.round(left + (rank % perRow) * ALIGN_STEP_X),
              y: Math.round(top + Math.floor(rank / perRow) * ALIGN_STEP_Y),
            });
          });
          onClose();
        },
      });
    }

    entries.push(
      {
        // Sur une sélection, on ne dégage que si tout est déjà engagé : sinon
        // « engager » laisserait la moitié du groupe dans l'état inverse.
        label: everyTapped ? t('card.untap') : t('card.tap'),
        shortcut: 'T',
        run: () => {
          send(tapIntent(targets));
          onClose();
        },
      },
      {
        label: t('card.addPlusCounter'),
        shortcut: '+',
        run: () => {
          for (const id of targets) send({ type: 'ADD_COUNTER', targetId: id, kind: '+1/+1', delta: 1 });
          onClose();
        },
      },
      {
        label: t('card.removePlusCounter'),
        shortcut: '−',
        run: () => {
          for (const id of targets) send({ type: 'ADD_COUNTER', targetId: id, kind: '+1/+1', delta: -1 });
          onClose();
        },
      },
      {
        /*
         * Marqueur personnalisé : **un seul** dialogue, là où il en fallait
         * deux enchaînés (« Type de marqueur », puis « Valeur »).
         *
         * Les trois formes sont celles des marqueurs de table, et elles
         * tiennent toutes dans « un nom, une valeur facultative » :
         *   - valeur vide   → un mot-clé affiché seul (« vol »). Le protocole
         *     l'écrit en omettant `value` : ce n'est pas zéro, c'est **pas de
         *     nombre** ;
         *   - valeur 1, 2, 3… → un compteur ;
         *   - valeur 0       → le marqueur est retiré.
         * Les valeurs usuelles sont à portée de clic, les noms courants aussi.
         */
        label: t('card.customCounter'),
        run: () => {
          onClose();
          const state = useGame.getState();
          const battlefieldCards = [...state.cards.values()].filter(
            (c) => c.zone.kind === 'BATTLEFIELD' && c.faceDown === false,
          );
          const cardTargetOptions = battlefieldCards.flatMap((c) => {
            const scryfallId = c.faceDown === false ? c.scryfallId : undefined;
            const meta = cardMeta(scryfallId);
            const name = meta?.name ?? t('card.generic');
            const isCreature =
              (meta?.typeLine ?? '').toLowerCase().includes('creature') || meta?.power !== undefined;
            const isMe = c.id === card.id;
            const prefix = isMe ? t('counter.prefixSelf') : t('counter.prefixNamed', { name });
            const grp = isMe ? t('counter.groupThisCard') : t('counter.groupBattlefield');
            const opts = [];
            if (isCreature) {
              const p = getCardStat(c, 'power');
              const tough = getCardStat(c, 'toughness');
              opts.push({
                value: isMe ? 'self:power' : `card:${c.id}:power`,
                label: t('counter.optPower', { prefix, value: p }),
                group: grp,
                // Les mots-clés sont une **clé de recherche**, pas un libellé :
                // ils restent tels quels, en français et en anglais à la fois,
                // pour que la saisie du joueur trouve l'entrée dans les deux.
                keywords: `${name} force power attaque`,
              });
              opts.push({
                value: isMe ? 'self:toughness' : `card:${c.id}:toughness`,
                label: t('counter.optToughness', { prefix, value: tough }),
                group: grp,
                keywords: `${name} endurance toughness defense`,
              });
            }
            const cnt = getCardStat(c, 'counters');
            if (cnt > 0 || (c.counters ?? []).length > 0) {
              opts.push({
                value: isMe ? 'self:counters' : `card:${c.id}:counters`,
                label: t('counter.optCounters', { prefix, value: cnt }),
                group: grp,
                keywords: `${name} marqueurs counters`,
              });
            }
            return opts;
          });

          void openDialog({
            title: t('card.counterDialogTitle', { count: targets.length }),
            submitLabel: t('common.place'),
            memory: 'card-counter',
            size: '2xl',
            preview: (vals) => <CustomCounterPreview card={card} values={vals} />,
            fields: [
              {
                /*
                 * La **forme** du marqueur, choisie avant son nom.
                 *
                 * Un « +1/+1 » n'est pas un marqueur nommé qui vaudrait 1 : sa
                 * valeur compte des marqueurs, pas des points, et la table le
                 * lit à sa pastille ronde. La forme n'est pourtant **pas
                 * stockée** — elle se relit dans le `kind`, comme
                 * `valueShape()` relit celle d'une étiquette de table. Le
                 * bandeau ne fait donc que choisir les valeurs usuelles et le
                 * champ qu'on remplit ; le protocole ne change pas d'un iota.
                 */
                name: 'forme',
                label: t('counter.fieldShape'),
                initial: 'pt',
                options: [
                  { value: 'pt', label: t('counter.shapePt') },
                  { value: 'named', label: t('counter.shapeNamed') },
                  { value: 'keyword', label: t('counter.shapeKeyword') },
                  // La quatrième forme n'en est pas vraiment une : c'est une
                  // **catégorie** à part, celle des caractéristiques variables,
                  // où l'on ne saisit pas un nombre mais où l'on déclare ce
                  // qu'il faut compter.
                  { value: 'calc', label: t('counter.shapeCalc') },
                ],
              },
              /*
               * Les trois comportements des « effets classiques », et pourquoi
               * ils sont trois et non un.
               *
               * On les confondrait volontiers sous « +X/+X », mais les cartes
               * ne les confondent pas, et les afficher pareil donnerait un
               * nombre faux :
               *
               *  - **Lumra**, **Old Stickfingers**, un Maro : « force et
               *    endurance *égales* au nombre de… ». La créature n'a pas de
               *    force imprimée à laquelle ajouter — elle *vaut* le décompte.
               *    On affiche `4/4`, pas `+4/+4`.
               *  - **Le Seigneur de l'Extinction** et sa famille : « gagne
               *    +1/+1 *pour chaque*… ». Là il s'agit bien d'une
               *    modification, qui s'ajoute au reste. On affiche `+4/+4`.
               *  - **Figé** : une créature qui « arrive avec un marqueur +1/+1
               *    pour chaque… ». Le décompte n'a lieu **qu'une fois**, à
               *    l'arrivée ; ensuite les marqueurs restent, même si la zone
               *    se vide. Ce n'est donc **pas** un marqueur calculé : c'est un
               *    marqueur +1/+1 ordinaire dont on aide simplement à compter la
               *    quantité au moment de le poser. Rien de spécial n'est
               *    stocké, et les boutons − et + du menu le reprennent ensuite
               *    normalement.
               *    pour chaque… », ou « avec X marqueurs où X est le nombre
               *    d'anges - 1 ». Le décompte a lieu une fois et ne bouge plus.
               *
               * Le joueur tranche, pas nous : le serveur n'interprète aucun
               * texte de carte, et lui seul sait ce que la sienne fait.
               */
              {
                name: 'calcmode',
                label: t('counter.fieldBehaviour'),
                initial: 'suit',
                hidden: (values) => values['forme'] !== 'calc',
                options: [
                  { value: 'suit', label: t('counter.behaviourFollow') },
                  { value: 'ajout', label: t('counter.behaviourAdd') },
                  { value: 'fige', label: t('counter.behaviourFrozen') },
                ],
                hint: t('counter.behaviourHint'),
              },
              {
                name: 'calcfigeform',
                label: t('counter.fieldFrozenShape'),
                initial: 'pt_set',
                hidden: (values) => values['forme'] !== 'calc' || values['calcmode'] !== 'fige',
                options: [
                  { value: 'pt_set', label: t('counter.frozenShapeSet') },
                  { value: 'pt_add', label: t('counter.frozenShapeAdd') },
                  { value: 'pt_counters', label: t('counter.frozenShapeCounters') },
                  { value: 'named', label: t('counter.frozenShapeNamed') },
                ],
                hint: t('counter.frozenShapeHint'),
              },
              {
                name: 'calcfigename',
                label: t('counter.fieldName'),
                initial: 'charge',
                maxLength: 32,
                hidden: (values) =>
                  values['forme'] !== 'calc' ||
                  values['calcmode'] !== 'fige' ||
                  values['calcfigeform'] !== 'named',
                quick: ['charge', 'loyauté', 'temps', 'poison', 'bouclier'].map((v) => ({
                  label: v,
                  value: v,
                })),
              },
              {
                name: 'calcpt',
                label: t('counter.fieldTemplate'),
                initial: '*/*',
                hidden: (values) => values['forme'] !== 'calc' || values['calcmode'] !== 'suit',
                options: [
                  { value: '*/*', label: t('counter.tplBoth') },
                  // Le Lhurgoyf d'Urborg et le Tarmogoyf sont des `*/1+*` :
                  // endurance = le même décompte, plus un.
                  { value: '*/*+1', label: t('counter.tplToughPlus1') },
                  { value: '*+1/*', label: t('counter.tplPowerPlus1') },
                  { value: '*-1/*-1', label: t('counter.tplBothMinus1') },
                  { value: '*/*-1', label: t('counter.tplToughMinus1') },
                  { value: '*-1/*', label: t('counter.tplPowerMinus1') },
                ],
              },
              {
                name: 'calcpt2',
                label: t('counter.fieldTemplate'),
                initial: '+*/+*',
                hidden: (values) => values['forme'] !== 'calc' || values['calcmode'] !== 'ajout',
                options: [
                  { value: '+*/+*', label: t('counter.tplAddBoth') },
                  { value: '+*/+0', label: t('counter.tplAddPower') },
                  { value: '+0/+*', label: t('counter.tplAddTough') },
                  { value: '+*-1/+*-1', label: t('counter.tplAddBothMinus') },
                ],
              },
              {
                /*
                 * **Une liste cherchable, et non dix-neuf pastilles.**
                 *
                 * Le bandeau mesurait neuf lignes à lui seul ; avec les cinq
                 * autres sections, le dialogue faisait 916 px dans une fenêtre
                 * de 800 et le bouton « Valider » n'était plus atteignable —
                 * mesuré, pas supposé. Et les centaines de sous-types de
                 * créature qu'on veut désormais compter n'y seraient jamais
                 * entrés.
                 *
                 * La recherche fait **les deux gestes à la fois** : elle filtre
                 * le catalogue, et ce qu'on tape et qui ne désigne aucune entrée
                 * devient un sous-type à compter. Taper « humain » propose donc
                 * « Humains sur le champ de bataille », « …au cimetière »,
                 * « …en exil » — les trois zones publiques, et elles seules.
                 * La recherche filtre le catalogue (zones, types, cartes du plateau)
                 * et propose les sous-types à la volée quand on tape « ange », « humain »...
                 */
                name: 'calcsrc',
                label: t('counter.fieldSource'),
                initial: 'bat.land',
                hidden: (values) => values['forme'] !== 'calc',
                options: [
                  ...cardTargetOptions,
                  ...COUNT_SOURCES.map((s) => ({ value: s.code, label: s.label, group: s.group })),
                  ...subtypeOptions(''),
                ],
                search: {
                  /*
                   * On ne propose un sous-type que lorsque la recherche **n'a
                   * rien trouvé** dans le catalogue, ou que le mot est un
                   * sous-type connu du lexique. Sans cette retenue, taper
                   * « cimet » ajoutait « Cimets sur le champ de bataille » aux
                   * huit entrées justes — du bruit exactement là où l'on venait
                   * de gagner en lisibilité.
                   */
                  placeholder: t('search.placeholder'),
                  freeform: (query, matches) =>
                    query.trim().length >= 3 && (matches === 0 || isKnownSubtype(query))
                      ? subtypeOptions(query)
                      : [],
                  /*
                   * Le refus de confidentialité **n'a pas disparu** : il était
                   * un paragraphe permanent au-dessus de tout le monde, il est
                   * maintenant dit à l'endroit où l'on bute dessus. Quiconque
                   * cherche « créatures en main » le lit ; quiconque cherche
                   * « terrains » ne le lit plus, et n'en avait pas besoin.
                   */
                  note: (query, matches) => {
                    const mot = query
                      .normalize('NFD')
                      .replace(/[̀-ͯ]/g, '')
                      .toLowerCase();
                    const cachee = /(main|biblio|deck|reserve|sideboard)/.test(mot);
                    const type = /(creature|terrain|artefact|enchant|type|ephemere|rituel|sous)/.test(mot);
                    if (cachee && type) return HIDDEN_REFUSAL;
                    if (query.trim() !== '' && matches === 0) {
                      // `HIDDEN_REFUSAL` vient de `CardSprite.tsx` : ce fichier
                      // ne l'écrit pas, il le recopie tel quel.
                      return t('counter.freeformNote', {
                        query: query.trim(),
                        refusal: HIDDEN_REFUSAL,
                      });
                    }
                    return null;
                  },
                },
                hint: t('counter.sourceHint'),
              },
              {
                name: 'calcqui',
                label: t('counter.fieldWho'),
                initial: 'vous',
                hidden: (values) =>
                  values['forme'] !== 'calc' ||
                  (values['calcsrc'] ?? '').startsWith('card:') ||
                  (values['calcsrc'] ?? '').startsWith('self:'),
                options: [
                  { value: 'vous', label: t('counter.whoController') },
                  { value: 'adv', label: t('counter.whoOpponents') },
                  { value: 'tous', label: t('counter.whoAll') },
                ],
                hint: t('counter.whoHint'),
              },
              {
                name: 'calcexclude',
                label: t('counter.fieldScope'),
                initial: 'all',
                // **Seul le mode figé sait exclure la porteuse.** Un marqueur
                // dynamique n'est qu'un `kind` de 32 caractères relu à chaque
                // rendu, de la forme « sigle, gabarit, source, arobase, chez
                // qui » — et rien dans cette grammaire ne dit « sauf moi ».
                // Proposer le réglage dans les deux autres modes, c'était
                // promettre un filtre que la pastille n'appliquait pas, tandis
                // que l'aperçu, lui, l'appliquait : deux nombres différents
                // pour un seul et même marqueur.
                hidden: (values) =>
                  values['forme'] !== 'calc' ||
                  values['calcmode'] !== 'fige' ||
                  (values['calcsrc'] ?? '').startsWith('card:') ||
                  (values['calcsrc'] ?? '').startsWith('self:') ||
                  (values['calcsrc'] ?? '') === 'main' ||
                  (values['calcsrc'] ?? '') === 'biblio' ||
                  (values['calcsrc'] ?? '') === 'vie',
                options: [
                  { value: 'all', label: t('counter.scopeAll') },
                  { value: 'other', label: t('counter.scopeOther') },
                ],
                hint: t('counter.scopeHint'),
              },
              {
                name: 'calcoffset',
                label: t('counter.fieldOffset'),
                initial: '0',
                maxLength: 5,
                hidden: (values) => values['forme'] !== 'calc',
                quick: [
                  { label: '-2', value: '-2' },
                  { label: '-1', value: '-1' },
                  { label: t('counter.offsetNone'), value: '0' },
                  { label: '+1', value: '+1' },
                  { label: '+2', value: '+2' },
                ],
                hint: t('counter.offsetHint'),
              },
              {
                name: 'pair',
                label: t('counter.fieldPair'),
                initial: '+1/+1',
                maxLength: 11,
                hidden: (values) => values['forme'] !== 'pt',
                quick: ['+1/+1', '-1/-1', '+2/+0', '+0/+2', '+2/+2', 'X/X'].map((v) => ({
                  label: v,
                  value: v,
                })),
                hint: t('counter.pairHint'),
              },
              {
                name: 'kind',
                label: t('counter.fieldName'),
                initial: 'loyauté',
                // Le protocole plafonne `kind` à 32 caractères ; au-delà, le
                // serveur rejetait l'intent sans que rien ne le dise.
                maxLength: 32,
                // Ni la forme « force/endurance », ni la catégorie calculée
                // n'ont de nom à saisir : l'une se lit dans la paire, l'autre
                // dans la formule.
                hidden: (values) => values['forme'] === 'pt' || values['forme'] === 'calc',
                quick: ['loyauté', 'vol', 'ne se dégage pas', 'bouclier', 'charge', 'lévitation'].map(
                  (v) => ({ label: v, value: v }),
                ),
              },
              {
                name: 'value',
                label: t('counter.fieldCount'),
                numeric: true,
                optional: true,
                initial: '1',
                placeholder: t('counter.countPlaceholder'),
                // Un mot-clé n'a par définition pas de nombre : lui en demander
                // un, fût-ce facultatif, ne peut que semer le doute. Un
                // marqueur calculé non plus — son nombre est compté, pas saisi.
                hidden: (values) => values['forme'] === 'keyword' || values['forme'] === 'calc',
                quick: [
                  { label: '1', value: '1' },
                  { label: '2', value: '2' },
                  { label: '3', value: '3' },
                  { label: '4', value: '4' },
                  { label: '5', value: '5' },
                  { label: '10', value: '10' },
                  { label: t('counter.countNone'), value: '' },
                ],
                hint: t('counter.countHint'),
              },
            ],
          }).then((result) => {
            if (!result) return;
            const forme = result.values['forme'] ?? 'named';

            if (forme === 'calc') {
              const src = result.values['calcsrc'] ?? 'bat.land';
              const qui = (result.values['calcqui'] ?? 'vous') as 'vous' | 'adv' | 'tous';
              const mode = result.values['calcmode'] ?? 'suit';
              const offset = parseOffset(result.values['calcoffset']);
              // Voir le champ « Périmètre » : seul le mode figé sait l'appliquer.
              const excludeOther = mode === 'fige' && result.values['calcexclude'] === 'other';
              const state = useGame.getState();

              if (mode === 'fige') {
                /*
                 * Le décompte figé se résout **ici**, et ne laisse derrière lui
                 * qu'un marqueur ordinaire (X/X, +X/+X, +1/+1, ou nommé). C'est
                 * exactement ce que fait une carte qui « arrive avec un marqueur
                 * +1/+1 pour chaque… » ou « avec X marqueurs où X est le nombre
                 * d'anges - 1 » : elle compte une fois au moment de la pose,
                 * applique le décalage choisi, et les cubes ne savent plus d'où
                 * ils viennent. Le compte est refait par carte cible, parce que
                 * « chez vous » dépend du contrôleur de chacune.
                 */
                const figeForm = (result.values['calcfigeform'] ??
                  'pt_set') as Parameters<typeof frozenCounterIntents>[3];
                const figeName = result.values['calcfigename'] ?? 'charge';

                for (const id of targets) {
                  const target = state.cards.get(id);
                  if (!target) continue;
                  const targetMeta = cardMeta(target.faceDown === false ? target.scryfallId : undefined);
                  // Non traduit : ce nom ne sert qu'à la bulle ci-dessous, qui
                  // part au serveur et reste française pour toute la table.
                  const name = targetMeta?.name ?? 'Carte';
                  /*
                   * **Un seul calcul, donc un seul marqueur.** La version
                   * précédente émettait ici un « +1/+1 ×décompte » avant même
                   * d'avoir appliqué « autres cartes uniquement » et le
                   * décalage, puis émettait le bon marqueur juste après : la
                   * carte portait les deux, et l'on voyait « +3/+3 » sous
                   * « +2/+2 » sans comprendre d'où venait le premier.
                   */
                  const intents = frozenCounterIntents(
                    state,
                    target,
                    { src, qui, offset, excludeOther },
                    figeForm,
                    figeName,
                  );
                  if (intents.length === 0) {
                    // Le décompte donne zéro : on le dit, plutôt que de laisser
                    // le geste paraître sans effet.
                    //
                    // **Non traduit, volontairement.** Ce texte part au serveur
                    // et s'affiche chez *tous* les joueurs : le traduire dans la
                    // langue de l'émetteur donnerait une bulle anglaise à une
                    // table française. C'est la même règle que le journal
                    // (docs/i18n.md §7), et elle se réglera au même endroit.
                    send({ type: 'CHAT_BUBBLE', text: `Décompte figé sur ${name} = 0 (aucun marqueur)` });
                    continue;
                  }
                  for (const intent of intents) send({ type: 'SET_COUNTER', targetId: id, ...intent });
                }
                return;
              }

              let gabarit =
                mode === 'ajout' ? (result.values['calcpt2'] ?? '+*/+*') : (result.values['calcpt'] ?? '*/*');

              if (offset !== 0) {
                const sign = offset > 0 ? `+${offset}` : `${offset}`;
                if (mode === 'suit') {
                  if (gabarit === '*/*') gabarit = `*${sign}/*${sign}`;
                  else if (gabarit === '*/*+1') gabarit = `*${sign}/*${offset + 1 >= 0 ? `+${offset + 1}` : offset + 1}`;
                  else if (gabarit === '*+1/*') gabarit = `*${offset + 1 >= 0 ? `+${offset + 1}` : offset + 1}/*${sign}`;
                } else if (mode === 'ajout') {
                  if (gabarit === '+*/+*') gabarit = `+*${sign}/+*${sign}`;
                  else if (gabarit === '+*/+0') gabarit = `+*${sign}/+0`;
                  else if (gabarit === '+0/+*') gabarit = `+0/+*${sign}`;
                }
              }

              const calcKind = `${COMPUTED_SIGIL}${gabarit} ${src}@${qui}`;
              // Garde-fou : la formule doit se relire, sinon la pastille
              // afficherait « ?/? » et personne ne saurait pourquoi.
              if (computedCounter(calcKind) === null || calcKind.length > 32) return;
              // `value` est omis : un marqueur calculé ne pose aucun marqueur,
              // et le nombre affiché est compté, jamais stocké.
              for (const id of targets) send({ type: 'SET_COUNTER', targetId: id, kind: calcKind });
              return;
            }

            const kind = (forme === 'pt' ? result.values['pair'] : result.values['kind'])?.trim() ?? '';
            if (!kind) return;
            const raw = forme === 'keyword' ? '' : (result.values['value'] ?? '');
            // `value` absent pose un mot-clé : l'omission est le message.
            const payload = raw === '' ? {} : { value: Number.parseInt(raw, 10) };
            for (const id of targets) send({ type: 'SET_COUNTER', targetId: id, kind, ...payload });
          });
        },
      },
      // Une seule bascule, et non deux entrées. Le champ qui manquait au
      // protocole existe désormais : `facedownOnTable` dit « posée face cachée
      // sur la table » là où `faceDown` ne disait que « cachée pour moi », et
      // vaut donc toujours `false` chez le propriétaire d'un morph. Sans lui,
      // on proposait « Retourner face cachée » sur une carte déjà retournée,
      // et deux M de suite laissaient la carte cachée en écrivant deux fois la
      // même ligne de journal.
      {
        label: facedown ? t('card.turnFaceUp') : t('card.turnFaceDown'),
        shortcut: 'M',
        separatorBefore: true,
        run: () => {
          send({ type: facedown ? 'TURN_FACE_UP' : 'TURN_FACE_DOWN', cardId: card.id });
          onClose();
        },
      },
      { label: t('card.transform'), shortcut: 'F', run: () => { send({ type: 'FLIP_FACE', cardId: card.id }); onClose(); } },
      {
        label: t('card.copyAsToken'),
        shortcut: 'C',
        run: () => {
          send({ type: 'CREATE_TOKEN', copyOf: card.id, x: card.x + 24, y: card.y + 24 });
          onClose();
        },
      },
      {
        // Attacher demande deux objets ; un menu contextuel n'en connaît qu'un.
        // On désigne donc la source ici, et la cible au clic suivant — comme on
        // pose un équipement sur la créature qu'on vise. L'ancienne version
        // cherchait la cible dans la sélection courante et, faute de
        // sélection, ne partait jamais : c'est la raison pour laquelle
        // « l'attachement ne fonctionne pas ».
        label: t('card.attachTo'),
        run: () => {
          beginAttach({ kind: 'CARD', sourceId: card.id });
          onClose();
        },
      },
      ...(card.attachedTo
        ? [{ label: t('card.detach'), run: () => { send({ type: 'DETACH', sourceId: card.id }); onClose(); } }]
        : []),
      { label: t('card.toHand'), shortcut: 'H', separatorBefore: true, run: () => move('HAND') },
      { label: t('card.toGraveyard'), shortcut: 'G', run: () => move('GRAVEYARD') },
      { label: t('card.exile'), shortcut: 'E', run: () => move('EXILE') },
      { label: t('zone.libraryTop'), shortcut: 'L', run: () => move('LIBRARY', { index: 'TOP' }) },
      { label: t('zone.libraryBottom'), shortcut: 'B', run: () => move('LIBRARY', { index: 'BOTTOM' }) },
    );
  }

  /*
   * La réserve, dans les deux sens, et **seulement avant le lancement**.
   * Sideboarder, c'est composer son deck : cela se fait avant de jouer, et le
   * serveur refuse de toute façon `SWAP_SIDEBOARD` une fois la partie lancée.
   * Une carte de réserve n'avait jusqu'ici aucune entrée de menu du tout : on
   * la voyait dans le panneau des zones sans pouvoir rien en faire.
   */
  if (inZone === 'SIDEBOARD') {
    entries.push(
      { label: t('zone.libraryTop'), shortcut: 'L', run: () => move('LIBRARY', { index: 'TOP' }) },
      { label: t('card.shuffleIntoLibrary'), run: () => move('LIBRARY', { index: 'RANDOM' }) },
      { label: t('card.toHand'), shortcut: 'H', run: () => move('HAND') },
      { label: t('card.toBattlefield'), shortcut: 'P', run: () => move('BATTLEFIELD', landing()) },
    );
  }

  if (inZone === 'GRAVEYARD' || inZone === 'EXILE' || inZone === 'COMMAND' || inZone === 'STACK_NOTE') {
    entries.push(
      { label: t('card.toBattlefield'), shortcut: 'P', run: () => move('BATTLEFIELD', landing()) },
      { label: t('card.toHand'), shortcut: 'H', run: () => move('HAND') },
      { label: t('zone.libraryTop'), shortcut: 'L', run: () => move('LIBRARY', { index: 'TOP' }) },
      { label: t('zone.libraryBottom'), shortcut: 'B', run: () => move('LIBRARY', { index: 'BOTTOM' }) },
    );
    if (inZone !== 'EXILE') entries.push({ label: t('card.exile'), shortcut: 'E', run: () => move('EXILE') });
    if (inZone !== 'GRAVEYARD') entries.push({ label: t('card.toGraveyard'), shortcut: 'G', run: () => move('GRAVEYARD') });
    if (inZone === 'COMMAND') {
      entries.push({
        label: t('card.castFromCommand'),
        separatorBefore: true,
        run: () => {
          send({ type: 'MOVE_CARD', cardId: card.id, to: zone('BATTLEFIELD'), ...landing() });
          onClose();
        },
      });
    }
  }

  // Actions communes, quelle que soit la zone.

  /*
   * Cascade et Découvrir — **la détection raccourcit le chemin, elle ne
   * l'ouvre ni ne le ferme.**
   *
   * Le catalogue sait désormais qu'une carte porte le mot-clé : Scryfall publie
   * `keywords` à côté du texte de règles, et l'ingestion le conserve. Mais
   * savoir sert ici à une seule chose — **remonter l'action dans le menu
   * principal**, prête à cliquer. Ce que la détection ne fait jamais, c'est
   * refuser : le tiroir « actions assistées » est là sur toutes les cartes, et
   * la même action s'y trouve à un survol. Une ligne de catalogue jamais
   * ré-ingérée (`keywords` absent), une carte que Scryfall n'étiquette pas, une
   * fiche pas encore arrivée du serveur : aucun de ces cas ne laisse le joueur
   * sans recours. Ne pas savoir n'est pas une raison de dire non.
   *
   * Ce que le serveur décide, lui, n'a pas bougé d'un pouce : rien. Le mot-clé
   * ne voyage pas jusqu'au moteur, le seuil part du client, et la carte trouvée
   * s'arrête à l'exil — sur une table sans pile ni coûts, « jouer sans payer
   * son coût » n'est qu'un déplacement de plus, et il appartient au joueur.
   */
  const meta = card.faceDown === false ? cardMeta(card.scryfallId) : undefined;
  const suggested = suggestedManaValue(meta);
  const detected = assistedKeywords(meta);

  /** Le dialogue complet : mot-clé et seuil, l'un et l'autre corrigeables. */
  const askCascade = (mode: 'BELOW' | 'AT_MOST'): void => {
    // Le dialogue vit dans sa propre racine : on referme le menu tout de suite,
    // et l'intent part quand la promesse se dénoue.
    onClose();
    const hint =
      suggested === null
        ? t('cascade.unknownCost')
        : suggested.ambiguous
          ? t('cascade.ambiguous')
          : t('cascade.suggested', { name: meta?.name ?? t('card.generic'), value: suggested.value });
    void openDialog({
      title: t('cascade.title'),
      description: t('cascade.description'),
      submitLabel: t('cascade.submit'),
      fields: [
        {
          name: 'mode',
          label: t('cascade.modeLabel'),
          initial: mode,
          hint: t('cascade.modeHint'),
          options: [
            { value: 'BELOW', label: t('cascade.modeBelow') },
            { value: 'AT_MOST', label: t('cascade.modeAtMost') },
          ],
        },
        {
          name: 'value',
          label: t('cascade.valueLabel'),
          numeric: true,
          /*
           * Cascade se pré-remplit avec la valeur de mana de la carte : c'est
           * exactement ce que la règle demande, et la retaper serait du travail
           * rendu au joueur pour rien. « Découvrir N » ne le peut pas —
           * `keywords` dit « Discover », jamais « Discover 4 », le nombre n'est
           * que dans le texte de règles, que l'on ne stocke pas.
           */
          initial: mode === 'BELOW' ? String(suggested?.value ?? 3) : '3',
          quick: [1, 2, 3, 4, 5, 6].map((n) => ({ label: String(n), value: String(n) })),
          hint,
        },
      ],
    }).then((result) => {
      if (!result) return;
      const value = Number.parseInt(result.values['value'] ?? '', 10);
      if (!Number.isFinite(value) || value < 0) return;
      send({
        type: 'CASCADE',
        sourceId: card.id,
        manaValue: value,
        compare: result.values['mode'] === 'AT_MOST' ? 'AT_MOST' : 'BELOW',
      });
    });
  };

  /*
   * Le raccourci, et sa seule exception.
   *
   * Mot-clé détecté **et** valeur de mana certaine : un clic suffit, et le
   * libellé annonce le nombre pour qu'il n'y ait pas de surprise. Valeur
   * **ambiguë** — plusieurs faces portent un coût —, le dialogue s'ouvre
   * pré-rempli : on demande plutôt que de décider, ici comme sur le serveur.
   */
  if (detected.cascade) {
    entries.push({
      label:
        suggested && !suggested.ambiguous
          ? t('card.cascadeWithValue', { value: suggested.value })
          : t('card.cascadeEntry'),
      separatorBefore: true,
      run: () => {
        if (!suggested || suggested.ambiguous) return askCascade('BELOW');
        onClose();
        send({ type: 'CASCADE', sourceId: card.id, manaValue: suggested.value, compare: 'BELOW' });
      },
    });
  }
  if (detected.discover) {
    entries.push({
      label: t('card.discoverEntry'),
      separatorBefore: !detected.cascade,
      run: () => askCascade('AT_MOST'),
    });
  }

  /*
   * Où poser ce que l'on crée.
   *
   * Sur le champ de bataille, à côté de la carte qui l'a déclenché — c'est déjà
   * ce que fait « Copier en jeton ». Ailleurs (une carte en main qui dit
   * « créez un Trésor »), `x`/`y` ne veulent rien dire : on retombe sur la
   * première place libre, comme pour jouer une carte.
   */
  const spawnAt = (): { x: number; y: number } =>
    inZone === 'BATTLEFIELD' ? { x: card.x + 24, y: card.y + 24 } : landing();

  /** Le catalogue n'a pas ce jeton : on le dit, on n'en pose pas un autre. */
  const sayMissing = (name: string): void => {
    void openDialog({
      title: t('assist.tokenMissingTitle'),
      description: t('assist.tokenMissing', { name }),
      submitLabel: t('common.close'),
    });
  };

  /**
   * Aucune armée au catalogue — un cas qui ne devrait pas arriver, et qui se
   * dit donc à part : « Army » n'est le nom d'aucun jeton, et le message
   * générique ci-dessus mentirait en prétendant l'avoir cherché comme un nom.
   */
  const sayNoArmy = (): void => {
    void openDialog({
      title: t('assist.tokenMissingTitle'),
      description: t('assist.armyMissing'),
      submitLabel: t('common.close'),
    });
  };

  /*
   * Jetons nommés — **aucun jugement**, le mot-clé ne fait que nommer.
   *
   * Rien n'est réimplémenté ici : la création passe par le `CREATE_TOKEN` que
   * l'étagère et la recherche de jetons utilisent déjà, et l'impression vient
   * de la même recherche de catalogue. Ce que ce raccourci ajoute, c'est
   * d'éviter de retaper « Treasure » pour la dixième fois.
   *
   * « Incuber » a un champ de plus, et c'est le seul endroit où les cinq ne se
   * ressemblent pas : le jeton Incubateur naît avec des marqueurs +1/+1, dont
   * le nombre est dans le texte de la carte — que nous ne stockons pas. On le
   * **demande** donc, comme le seuil de cascade.
   */
  const askNamedToken = (): void => {
    onClose();
    void openDialog({
      title: t('assist.tokensTitle'),
      description: t('assist.tokensDescription'),
      submitLabel: t('assist.tokensSubmit'),
      memory: 'assist-named-token',
      fields: [
        {
          name: 'token',
          label: t('assist.tokenLabel'),
          initial: 'Treasure',
          options: [
            { value: 'Clue', label: t('assist.tokenClue') },
            { value: 'Treasure', label: t('assist.tokenTreasure') },
            { value: 'Food', label: t('assist.tokenFood') },
            { value: 'Blood', label: t('assist.tokenBlood') },
            { value: INCUBATOR_TOKEN, label: t('assist.tokenIncubator') },
          ],
        },
        {
          name: 'count',
          label: t('assist.tokenCountLabel'),
          numeric: true,
          initial: '1',
          quick: [1, 2, 3, 5].map((n) => ({ label: String(n), value: String(n) })),
        },
        {
          name: 'marks',
          label: t('assist.tokenIncubateLabel'),
          hint: t('assist.tokenIncubateHint'),
          numeric: true,
          initial: '1',
          quick: [1, 2, 3, 4].map((n) => ({ label: String(n), value: String(n) })),
          hidden: (values) => values['token'] !== INCUBATOR_TOKEN,
        },
      ],
    }).then(async (result) => {
      if (!result) return;
      const which = result.values['token'] ?? '';
      if (!(NAMED_TOKENS as readonly string[]).includes(which)) return;
      const count = Math.min(64, Math.max(1, Number.parseInt(result.values['count'] ?? '1', 10) || 1));
      const printing = await namedTokenPrinting(which);
      if (printing === null) return sayMissing(which);
      const marks =
        which === INCUBATOR_TOKEN ? Number.parseInt(result.values['marks'] ?? '', 10) : Number.NaN;
      send({
        type: 'CREATE_TOKEN',
        scryfallId: printing,
        count,
        ...spawnAt(),
        ...(Number.isFinite(marks) && marks > 0 ? { counters: [{ kind: '+1/+1', value: marks }] } : {}),
      });
    });
  };

  /*
   * Amasser N — **deux cas, donc on demande**, et c'est le clic qui répond.
   *
   * « Mettez N marqueurs +1/+1 sur une Armée que vous contrôlez ; si vous n'en
   * contrôlez pas, créez d'abord un jeton Armée 0/0. » Savoir si ce permanent
   * est une Armée, ou si le joueur en contrôle une, serait au serveur de lire
   * une ligne de type et de trancher — exactement ce qu'on ne fait pas. Le
   * joueur désigne à la place : il ouvre ce menu **sur son Armée** pour la
   * grossir, ou prend l'autre entrée pour en créer une.
   *
   * Les deux chemins n'inventent aucun intent : `ADD_COUNTER` d'un côté,
   * `CREATE_TOKEN` avec ses marqueurs de l'autre — le protocole porte déjà
   * `counters` sur la création, précisément pour qu'un jeton naisse marqué.
   */
  const askAmassOnThisCard = (): void => {
    onClose();
    void askNumber({
      title: t('assist.amassTitle'),
      label: t('assist.amassLabel'),
      initial: 1,
      quick: [1, 2, 3, 5],
      memory: 'assist-amass',
      submitLabel: t('assist.amassSubmit'),
    }).then((n) => {
      if (n === null) return;
      send({ type: 'ADD_COUNTER', targetId: card.id, kind: '+1/+1', delta: n });
    });
  };

  /*
   * Créer l'armée : **on propose, le joueur tranche**, et aucune des deux
   * moitiés de cette phrase n'est négociable.
   *
   * Prendre « Zombie Army » parce que c'est la plus imprimée **conclurait** à
   * la place du joueur : la carte qu'il tient dit peut-être « amassez des
   * orques », et nous ne pouvons pas le savoir — nous ne stockons ni
   * `oracle_text` ni `flavor_text`, c'est un invariant de droits. Refuser de
   * créer quoi que ce soit, à l'inverse, serait le défaut qu'on répare.
   *
   * La forme retenue tient dans les trois critères de l'action assistée :
   *   - elle **n'interdit rien** — la recherche de jetons et l'étagère
   *     restent le chemin ouvert, et le dialogue le rappelle ;
   *   - elle **n'impose rien** — aucune armée n'est présélectionnée, le
   *     dialogue refuse simplement de se valider tant que personne n'a
   *     désigné ; l'ordre d'affichage est alphabétique, pas un classement ;
   *   - elle **ne conclut rien** — la liste est ce que le catalogue contient,
   *     pas ce que nous croyons que la carte dit.
   */
  const askAmassNewArmy = (): void => {
    onClose();
    void armyPrintings().then(async (armies) => {
      if (armies.length === 0) return sayNoArmy();
      const options = armies
        .map((army) => ({ value: army.scryfallId, label: tokenName(army.name, language) ?? army.name }))
        .sort((a, b) => a.label.localeCompare(b.label, language));

      const result = await openDialog({
        title: t('assist.amassTitle'),
        description: t('assist.amassArmyDescription'),
        submitLabel: t('assist.amassSubmit'),
        memory: 'assist-amass-army',
        fields: [
          {
            name: 'army',
            label: t('assist.amassArmyLabel'),
            hint: t('assist.amassArmyHint'),
            // **Pas d'`initial`** : un champ vide n'est pas validable, donc le
            // dialogue attend une désignation au lieu d'en souffler une.
            options,
          },
          {
            name: 'count',
            label: t('assist.amassLabel'),
            numeric: true,
            initial: '1',
            quick: [1, 2, 3, 5].map((n) => ({ label: String(n), value: String(n) })),
          },
        ],
      });
      if (!result) return;
      const scryfallId = result.values['army'] ?? '';
      if (!armies.some((army) => army.scryfallId === scryfallId)) return;
      const n = Number.parseInt(result.values['count'] ?? '1', 10);
      if (!Number.isFinite(n) || n < 1) return;
      send({
        type: 'CREATE_TOKEN',
        scryfallId,
        counters: [{ kind: '+1/+1', value: n }],
        ...spawnAt(),
      });
    });
  };

  /*
   * Le tiroir, toujours présent.
   *
   * Il est conçu pour qu'on y ajoute une action **sans rien restructurer** :
   * une entrée de plus dans ce tableau, et rien d'autre à toucher. Vérifié en
   * y ajoutant quatre actions : aucune autre ligne de ce fichier n'a bougé, et
   * `Submenu` rend ce tableau tel quel. On n'y met que ce qui existe — aucune
   * ligne grisée, aucun « bientôt disponible » : une promesse d'interface non
   * tenue vieillit mal. C'est aussi pourquoi les entrées qui n'ont pas de sens
   * ici — « peupler » sans jeton sous le curseur — ne sont pas offertes plutôt
   * que désactivées ; le chemin manuel, lui, reste ouvert dans tous les cas.
   */
  entries.push({
    label: t('card.assistedActions'),
    separatorBefore: !detected.cascade && !detected.discover,
    submenu: [
      { label: t('card.cascadeEntry'), run: () => askCascade('BELOW') },
      { label: t('card.discoverEntry'), run: () => askCascade('AT_MOST') },
      { label: t('assist.namedTokens'), separatorBefore: true, run: askNamedToken },
      { label: t('assist.amassNew'), run: askAmassNewArmy },
      ...(inZone === 'BATTLEFIELD'
        ? [{ label: t('assist.amassThis'), run: askAmassOnThisCard }]
        : []),
      /*
       * Peupler : « copiez un jeton de créature que vous contrôlez ». Le jeton
       * copié est **celui sous le curseur** — le joueur l'a désigné en ouvrant
       * ce menu dessus, et le serveur n'en choisit aucun. C'est le
       * `CREATE_TOKEN{copyOf}` de « Copier en jeton », sous le nom du mot-clé ;
       * l'entrée n'apparaît que sur un jeton visible du champ de bataille,
       * parce que « peupler » ne veut rien dire ailleurs et que le chemin
       * ordinaire couvre le reste.
       */
      ...(card.kind === 'TOKEN' && inZone === 'BATTLEFIELD' && card.faceDown === false
        ? [
            {
              label: t('assist.populate'),
              run: () => {
                send({ type: 'CREATE_TOKEN', copyOf: card.id, x: card.x + 24, y: card.y + 24 });
                onClose();
              },
            },
          ]
        : []),
      /*
       * Proliférer : un marqueur de plus de chaque sorte, sur ce que le joueur
       * montre. La désignation est la **sélection** — le lasso, déjà là, sert
       * de « choisissez n'importe quel nombre de permanents » — ou cette carte
       * seule. Le serveur ne cherche jamais les cibles lui-même.
       */
      {
        label:
          targets.length > 1
            ? t('assist.proliferateMany', { count: targets.length })
            : t('assist.proliferateOne'),
        separatorBefore: true,
        run: () => {
          send({ type: 'PROLIFERATE', targetIds: targets });
          onClose();
        },
      },
    ],
  });

  /*
   * Rattraper une maladresse : la table convient d'oublier la carte.
   *
   * C'est l'exception assumée à la monotonie de la connaissance (protocole
   * §5.3) — partout ailleurs, ce qu'un siège a vu lui reste acquis. Elle n'est
   * proposée qu'au **propriétaire** : c'est sa maladresse, et il est le seul à
   * y perdre. Le serveur l'annonce au journal, nommément ; effacer en silence
   * la mémoire des autres serait une tricherie, annoncé c'est une convention.
   *
   * Deux entrées plutôt qu'une, parce que « masquer » recouvre deux
   * maladresses différentes : la carte n'aurait jamais dû quitter la main, ou
   * elle devait être posée face cachée. Le joueur sait laquelle, pas nous.
   *
   * Jamais sur la sélection : c'est un geste correctif, on ne « reprend pas
   * par erreur » huit cartes d'un coup. La zone de commandement est exclue, un
   * commandant étant public dès le chargement du deck — le serveur refuse.
   */
  if (
    card.owner === seat &&
    card.kind === 'CARD' &&
    (inZone === 'BATTLEFIELD' || inZone === 'GRAVEYARD' || inZone === 'EXILE' || inZone === 'STACK_NOTE')
  ) {
    entries.push(
      {
        label: t('card.takeBackHand'),
        separatorBefore: true,
        run: () => {
          send({ type: 'TAKE_BACK', cardId: card.id, to: 'HAND' });
          onClose();
        },
      },
      {
        label: t('card.takeBackHide'),
        run: () => {
          send({ type: 'TAKE_BACK', cardId: card.id, to: 'FACE_DOWN' });
          onClose();
        },
      },
    );
  }

  if (card.faceDown && card.owner === seat) {
    entries.push({
      label: t('card.peekFaceDown'),
      separatorBefore: true,
      run: () => {
        send({ type: 'PEEK_FACE_DOWN', cardId: card.id });
        onClose();
      },
    });
  }
  if (card.faceDown === false && card.owner === seat) {
    entries.push({
      label: t('card.changePrinting'),
      separatorBefore: true,
      run: () => setPicking(true),
    });
  }
  if (card.kind === 'TOKEN' && card.faceDown === false) {
    entries.push({
      label: t('card.shelveToken'),
      separatorBefore: true,
      run: () => {
        // L'étagère ne retient qu'une impression : aucun objet de partie n'y
        // passe, et le serveur n'a rien à en savoir.
        void shelveToken({ scryfallId: card.scryfallId, name: cardName(card.scryfallId) });
        onClose();
      },
    });
  }
  if (card.kind === 'TOKEN') {
    // Destruction irréversible, et l'entrée voisine est « ranger sur
    // l'étagère » : on demande une confirmation, dans le menu lui-même plutôt
    // que par une modale native.
    entries.push({
      label: confirming ? t('card.confirmDestroyToken') : t('card.destroyToken'),
      danger: true,
      separatorBefore: true,
      run: () => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        send({ type: 'DESTROY_TOKEN', cardIds: targets });
        onClose();
      },
    });
  }

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Lu par l'écouteur `Échap`, dont les dépendances sont vides : sans ce relais,
  // il verrait éternellement l'état du premier rendu.
  const openSubRef = useRef(openSub);
  openSubRef.current = openSub;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      /*
       * **`Échap` referme le tiroir avant le menu**, jamais les deux d'un coup :
       * un second niveau qui emporte son parent oblige à tout rouvrir pour
       * corriger un survol.
       *
       * L'écoute est en **capture**, comme partout dans ce projet — un écouteur
       * en bouillonnement ne recevrait jamais la touche. Et il y a un second
       * écouteur `Échap` sur `window`, posé plus haut dans ce composant, qui
       * ferme le menu entier : `stopImmediatePropagation` est donc nécessaire,
       * `stopPropagation` seul ne retient pas un écouteur voisin sur la **même**
       * cible et le menu se refermerait quand même.
       */
      if (openSubRef.current) {
        event.stopPropagation();
        event.stopImmediatePropagation();
        setOpenSub(null);
        return;
      }
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (picking && card.faceDown === false) {
    return <PrintingPicker card={card} onClose={onClose} />;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="scrollbar-thin fixed z-50 w-60 sm:w-64 rounded-xl border border-slate-700/80 bg-slate-900/95 py-1.5 shadow-2xl shadow-black/80 backdrop-blur-xl"
        data-test="card-menu"
        style={style}
        // Le tiroir est positionné sur l'ancre relevée à son ouverture : un menu
        // assez haut pour défiler la ferait mentir, et le tiroir flotterait à
        // côté d'une ligne qui n'est plus là. On le referme plutôt.
        onScroll={() => setOpenSub(null)}
      >
        <div className="border-b border-slate-800 px-3 py-1.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs font-semibold text-slate-100">
            {card.faceDown === false
              ? (localizedCardName(
                  localizedCard(card.scryfallId, language),
                  cardName(card.scryfallId),
                ) ?? cardName(card.scryfallId))
              : t('card.faceDown')}
          </p>
          {targets.length > 1 && (
            <span
              data-test="card-menu-count"
              data-count={targets.length}
              className="shrink-0 rounded bg-sky-950/80 border border-sky-800/60 px-1.5 py-0.5 text-[10px] font-medium text-sky-300"
            >
              {t('card.selectedCount', { count: targets.length })}
            </span>
          )}
        </div>

        {/*
          Les marqueurs déjà posés, un par un, avec leur nom.

          C'est le manque que signalait l'utilisateur : le menu ne savait que
          *poser*, jamais atteindre ce qui était là. Un mot-clé n'avait même pas
          de − à décrémenter, et restait sur le permanent pour la partie.

          Chaque ligne agit sur **cette carte seule**, jamais sur la sélection :
          « retirer loyauté » n'a aucun sens sur les huit terrains qu'on venait
          d'attraper au lasso, et la liste affichée est celle de cette carte-ci.
          Le menu ne se referme pas sur − et + : on ajuste souvent de plusieurs
          crans d'affilée, et le nombre suit l'écho du serveur.
        */}
        {live.counters.length > 0 && (
          <div className="border-b border-slate-800 px-2 py-1.5" data-test="card-counters">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {t('card.countersOnThis')}
            </p>
            {live.counters.map((counter) => {
              const pt = ptCounter(counter.kind);
              // Un marqueur calculé s'affiche par sa **phrase**, pas par sa
              // formule : « ∑*/* bat.land@vous » ne se lit pas, et c'est ici
              // qu'on a la place de l'écrire en clair.
              const calc = computedCounter(counter.kind);
              return (
                <div
                  key={counter.kind}
                  className="flex items-center gap-1 my-0.5"
                  data-test="card-counter-row"
                  data-counter={counter.kind}
                >
                  <button
                    className={`flex-1 truncate rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-slate-800 ${
                      calc
                        ? 'font-semibold text-violet-300'
                        : pt
                          ? 'font-semibold text-emerald-300'
                          : counter.value === undefined
                            ? 'italic text-amber-200'
                            : 'text-sky-200'
                    }`}
                    data-test="counter-edit"
                    onClick={() => {
                      onClose();
                      void editCounter(card.id, counter);
                    }}
                    title={
                      calc
                        ? t('card.counterComputedHint', { formula: describeComputed(calc) })
                        : t('card.counterEditHint')
                    }
                  >
                    {calc ? `${COMPUTED_SIGIL} ${describeComputed(calc)}` : counter.kind}
                  </button>
                  {counter.value !== undefined && (
                    <>
                      <button
                        className="h-6 w-6 shrink-0 rounded bg-slate-800 border border-slate-700 text-sm font-bold leading-none text-slate-200 hover:bg-slate-700 active:scale-95 transition-all"
                        data-test="counter-minus"
                        onClick={() => send({ type: 'ADD_COUNTER', targetId: card.id, kind: counter.kind, delta: -1 })}
                        title={t('card.counterOneLess')}
                      >
                        −
                      </button>
                      <span className="w-6 shrink-0 text-center text-xs font-bold tabular-nums text-slate-100">
                        {counter.value}
                      </span>
                      <button
                        className="h-6 w-6 shrink-0 rounded bg-slate-800 border border-slate-700 text-sm font-bold leading-none text-slate-200 hover:bg-slate-700 active:scale-95 transition-all"
                        data-test="counter-plus"
                        onClick={() => send({ type: 'ADD_COUNTER', targetId: card.id, kind: counter.kind, delta: 1 })}
                        title={t('card.counterOneMore')}
                      >
                        +
                      </button>
                    </>
                  )}
                  <button
                    className="ml-0.5 h-6 shrink-0 rounded px-1.5 text-xs text-rose-300 hover:bg-rose-950/60 transition-colors"
                    data-test="counter-remove"
                    onClick={() => send({ type: 'SET_COUNTER', targetId: card.id, kind: counter.kind, value: null })}
                    title={t('card.counterRemove')}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {entries.map((entry) => (
          <EntryButton
            key={entry.label}
            entry={entry}
            openSub={openSub?.label ?? null}
            setOpenSub={setOpenSub}
          />
        ))}
      </div>
      {openSub && (
        <Submenu
          anchor={openSub.rect}
          entries={entries.find((e) => e.label === openSub.label)?.submenu ?? []}
        />
      )}
    </>
  );
}
