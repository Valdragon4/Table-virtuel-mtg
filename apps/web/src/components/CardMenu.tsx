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
import { cardMeta, cardName } from '../lib/cards.js';
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
  getCardStat,
  isKnownSubtype,
  measureCount,
  ptCounter,
  renderSide,
  resolveSource,
  subtypeOptions,
  subtypesOf,
  typeFamilies,
} from './CardSprite.js';
import { CARD_HEIGHT, CARD_WIDTH } from '../lib/cards.js';
import { PANEL_WIDTH } from './SeatPanel.js';

/** Pas d'alignement : une carte, plus un filet d'air pour qu'on les distingue. */
const ALIGN_STEP_X = CARD_WIDTH + 12;
const ALIGN_STEP_Y = CARD_HEIGHT + 12;
import { freeSpot } from '../lib/drag.js';

export interface CardMenuProps {
  card: CardView;
  x: number;
  y: number;
  onClose: () => void;
}

interface Entry {
  label: string;
  shortcut?: string;
  run: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
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
  const state = useGame.getState();
  const scryfallId = card.faceDown === false ? card.scryfallId : undefined;
  const meta = cardMeta(scryfallId);
  const name = meta?.name ?? 'Carte sélectionnée';
  const typeLine = meta?.typeLine ?? 'Permanent';
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
    formulaDesc = `Ajustement fixe de force / endurance : ${pair}`;
  } else if (forme === 'named') {
    const kind = values['kind'] || 'loyauté';
    const val = values['value'] || '1';
    badgeNode = (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-purple-950/90 text-purple-200 border border-purple-500 shadow-sm">
        🏷️ {kind} {val ? `(${val})` : ''}
      </span>
    );
    formulaDesc = `Marqueur nommé « ${kind} » : ${val || '1'} posé(s)`;
  } else if (forme === 'keyword') {
    const kind = values['kind'] || 'vol';
    badgeNode = (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-teal-950/90 text-teal-200 border border-teal-500 shadow-sm">
        ✨ {kind}
      </span>
    );
    formulaDesc = `Capacité / Mot-clé « ${kind} » conféré sans quantité`;
  } else if (forme === 'calc') {
    const src = values['calcsrc'] ?? 'bat.land';
    const qui = (values['calcqui'] ?? 'vous') as 'vous' | 'adv' | 'tous';
    const mode = values['calcmode'] ?? 'suit';
    const offsetRaw = values['calcoffset'] ?? '0';
    const offset = Number.parseInt(offsetRaw, 10) || 0;
    const excludeOther = values['calcexclude'] === 'other';

    let baseValue = 0;
    if (src.startsWith('self:')) {
      const stat = src.slice(5) as 'power' | 'toughness' | 'counters';
      baseValue = getCardStat(card, stat);
    } else if (src.startsWith('card:')) {
      const match = /^card:([^:]+):(power|toughness|counters)$/.exec(src);
      if (match && match[1]) {
        const fromCard = state.cards.get(match[1]);
        if (fromCard) {
          baseValue = getCardStat(fromCard, match[2] as 'power' | 'toughness' | 'counters');
        }
      }
    } else {
      const spec = computedCounter(`${COMPUTED_SIGIL}+*/+* ${src}@${qui}`);
      if (spec) {
        const measure = measureCount(state, spec, card);
        baseValue = measure ? measure.n : 0;
        if (excludeOther) {
          const res = resolveSource(spec.source);
          if (res && card.zone.kind === res.source.zone) {
            const line = meta?.typeLine ?? '';
            if (res.subtype !== null) {
              if (subtypesOf(line).has(res.subtype)) baseValue = Math.max(0, baseValue - 1);
            } else if (res.source.family !== undefined) {
              if (typeFamilies(line).has(res.source.family)) baseValue = Math.max(0, baseValue - 1);
            } else if (!res.source.distinctTypes) {
              baseValue = Math.max(0, baseValue - 1);
            }
          }
        }
      }
    }

    const finalValue = Math.max(0, baseValue + offset);

    if (mode === 'fige') {
      const figeForm = values['calcfigeform'] ?? 'pt_set';
      const figeName = values['calcfigename'] ?? 'charge';
      let figeText = '';
      if (finalValue <= 0) {
        figeText = '0 (aucun marqueur)';
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
          Figé à la pose
        </span>
      );
      countSummary = `Décompte actuel : ${baseValue} ${
        offset !== 0 ? `(${offset > 0 ? `+${offset}` : offset} décalage)` : ''
      } = ${finalValue}`;
      formulaDesc =
        finalValue <= 0
          ? '⚠️ Le décompte donne 0 : aucun marqueur ne sera posé sur la carte, et le journal indiquera « 0 ».'
          : `Ce marqueur figera la valeur ${finalValue} une fois pour toutes au moment de la pose (ne bougera plus ensuite).`;
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
          Dynamique (en direct)
        </span>
      );
      countSummary = `Décompte actuel : ${baseValue} ${
        offset !== 0 ? `(${offset > 0 ? `+${offset}` : offset} décalage)` : ''
      } → ${previewDisplay}`;
      formulaDesc = spec ? describeComputed(spec) : calcKind;
    }
  }

  return (
    <div className="flex flex-col gap-3.5 h-full" data-test="custom-counter-preview">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Aperçu en direct
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
        <p className="font-semibold text-slate-300">💡 Conseil de jeu</p>
        <p>
          {forme === 'calc'
            ? 'Les marqueurs dynamiques sont recalculés côté client sans solliciter le serveur. Vous pouvez compter n’importe quel sous-type ou zone publique.'
            : 'Vous pourrez ajuster ou retirer ce marqueur à tout moment par double-clic ou via le menu contextuel.'}
        </p>
      </div>
    </div>
  );
}

export function CardMenu({ card, x, y, onClose }: CardMenuProps): React.ReactElement {
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
      { label: 'Jouer', shortcut: 'P', run: () => move('BATTLEFIELD', landing()) },
      { label: 'Jouer face cachée', shortcut: 'M', run: () => move('BATTLEFIELD', { ...landing(), faceDown: true }) },
      { label: 'Mettre sur la pile', shortcut: 'S', run: () => move('STACK_NOTE') },
      { label: 'Révéler à tous', run: () => { send({ type: 'REVEAL', cardIds: targets, toSeats: 'ALL' }); onClose(); } },
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
              label: 'Révéler à…',
              run: () => {
                onClose();
                void openDialog({
                  title: targets.length > 1 ? `Révéler ${targets.length} cartes à…` : 'Révéler cette carte à…',
                  description: 'Seules les personnes cochées verront la carte.',
                  choicesLabel: 'Destinataires',
                  choices: others.map((s) => ({ id: s.id, label: s.displayName, color: s.color })),
                  requireChoice: true,
                  submitLabel: 'Révéler',
                }).then((result) => {
                  if (result) send({ type: 'REVEAL', cardIds: targets, toSeats: result.chosen });
                });
              },
            },
          ]
        : []),
      { label: 'Défausser', shortcut: 'G', run: () => move('GRAVEYARD'), separatorBefore: true },
      { label: 'Exiler', shortcut: 'E', run: () => move('EXILE') },
      { label: 'Dessus de la bibliothèque', shortcut: 'L', run: () => move('LIBRARY', { index: 'TOP' }) },
      { label: 'Dessous de la bibliothèque', shortcut: 'B', run: () => move('LIBRARY', { index: 'BOTTOM' }) },
      {
        label: 'Nième depuis le dessus…',
        run: () => {
          /*
           * Le dialogue vit dans sa propre racine : on referme le menu tout de
           * suite, et le déplacement part quand la promesse se dénoue. Un
           * `move()` tardif rappelle `onClose()`, sans effet — le menu n'est
           * déjà plus là.
           */
          onClose();
          void askNumber({
            title: 'Placer dans la bibliothèque',
            label: 'Position depuis le dessus (1 = dessus)',
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
        label: 'Mettre dans la réserve',
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
        label: `Aligner les ${targets.length} cartes`,
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
        label: everyTapped ? 'Dégager' : 'Engager',
        shortcut: 'T',
        run: () => {
          send(tapIntent(targets));
          onClose();
        },
      },
      {
        label: 'Ajouter un marqueur +1/+1',
        shortcut: '+',
        run: () => {
          for (const id of targets) send({ type: 'ADD_COUNTER', targetId: id, kind: '+1/+1', delta: 1 });
          onClose();
        },
      },
      {
        label: 'Retirer un marqueur +1/+1',
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
        label: 'Marqueur personnalisé…',
        run: () => {
          onClose();
          const state = useGame.getState();
          const battlefieldCards = [...state.cards.values()].filter(
            (c) => c.zone.kind === 'BATTLEFIELD' && c.faceDown === false,
          );
          const cardTargetOptions = battlefieldCards.flatMap((c) => {
            const scryfallId = c.faceDown === false ? c.scryfallId : undefined;
            const meta = cardMeta(scryfallId);
            const name = meta?.name ?? 'Carte';
            const isCreature =
              (meta?.typeLine ?? '').toLowerCase().includes('creature') || meta?.power !== undefined;
            const isMe = c.id === card.id;
            const prefix = isMe ? 'Cette carte : ' : `« ${name} » : `;
            const grp = isMe ? 'Cette carte' : 'Cartes sur le champ de bataille';
            const opts = [];
            if (isCreature) {
              const p = getCardStat(c, 'power');
              const t = getCardStat(c, 'toughness');
              opts.push({
                value: isMe ? 'self:power' : `card:${c.id}:power`,
                label: `${prefix}force (${p})`,
                group: grp,
                keywords: `${name} force power attaque`,
              });
              opts.push({
                value: isMe ? 'self:toughness' : `card:${c.id}:toughness`,
                label: `${prefix}endurance (${t})`,
                group: grp,
                keywords: `${name} endurance toughness defense`,
              });
            }
            const cnt = getCardStat(c, 'counters');
            if (cnt > 0 || (c.counters ?? []).length > 0) {
              opts.push({
                value: isMe ? 'self:counters' : `card:${c.id}:counters`,
                label: `${prefix}marqueurs (${cnt})`,
                group: grp,
                keywords: `${name} marqueurs counters`,
              });
            }
            return opts;
          });

          void openDialog({
            title: targets.length > 1 ? `Marqueur sur ${targets.length} cartes` : 'Poser un marqueur',
            submitLabel: 'Poser',
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
                label: 'Forme',
                initial: 'pt',
                options: [
                  { value: 'pt', label: 'Force / endurance' },
                  { value: 'named', label: 'Nommé' },
                  { value: 'keyword', label: 'Mot-clé' },
                  // La quatrième forme n'en est pas vraiment une : c'est une
                  // **catégorie** à part, celle des caractéristiques variables,
                  // où l'on ne saisit pas un nombre mais où l'on déclare ce
                  // qu'il faut compter.
                  { value: 'calc', label: 'Effets classiques' },
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
                label: 'Comportement',
                initial: 'suit',
                hidden: (values) => values['forme'] !== 'calc',
                options: [
                  { value: 'suit', label: 'Force/endurance égales au décompte' },
                  { value: 'ajout', label: 'Bonus par unité comptée' },
                  { value: 'fige', label: 'Marqueurs posés une fois, figés' },
                ],
                hint: 'Les deux premiers suivent la zone comptée ; le troisième compte maintenant, puis ne bouge plus.',
              },
              {
                name: 'calcfigeform',
                label: 'Forme du marqueur figé',
                initial: 'pt_set',
                hidden: (values) => values['forme'] !== 'calc' || values['calcmode'] !== 'fige',
                options: [
                  { value: 'pt_set', label: 'X/X — force et endurance fixées' },
                  { value: 'pt_add', label: '+X/+X — bonus global' },
                  { value: 'pt_counters', label: '+1/+1 — X marqueurs individuels' },
                  { value: 'named', label: 'Nommé (X marqueurs)' },
                ],
                hint: '« X/X » pose un marqueur fixant la force/endurance (ex. 3/3). « +1/+1 » pose autant de marqueurs +1/+1.',
              },
              {
                name: 'calcfigename',
                label: 'Nom du marqueur',
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
                label: 'Gabarit',
                initial: '*/*',
                hidden: (values) => values['forme'] !== 'calc' || values['calcmode'] !== 'suit',
                options: [
                  { value: '*/*', label: '*/* — les deux' },
                  // Le Lhurgoyf d'Urborg et le Tarmogoyf sont des `*/1+*` :
                  // endurance = le même décompte, plus un.
                  { value: '*/*+1', label: '*/1+* — endurance +1' },
                  { value: '*+1/*', label: '1+*/* — force +1' },
                  { value: '*-1/*-1', label: '*-1/*-1 — les deux -1' },
                  { value: '*/*-1', label: '*/-1+* — endurance -1' },
                  { value: '*-1/*', label: '-1+*/* — force -1' },
                ],
              },
              {
                name: 'calcpt2',
                label: 'Gabarit',
                initial: '+*/+*',
                hidden: (values) => values['forme'] !== 'calc' || values['calcmode'] !== 'ajout',
                options: [
                  { value: '+*/+*', label: '+1/+1 par unité' },
                  { value: '+*/+0', label: '+1/+0 par unité' },
                  { value: '+0/+*', label: '+0/+1 par unité' },
                  { value: '+*-1/+*-1', label: '+1/+1 (-1 au total)' },
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
                label: 'Ce qu’on compte / Valeur à prendre',
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
                  placeholder: 'Chercher une zone, une carte, un type… ou taper « ange »',
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
                      return (
                        `Rien ne correspond à « ${query.trim()} » dans le catalogue : il vous est proposé ` +
                        `comme sous-type, et le décompte restera à zéro si ce n’en est pas un. ${HIDDEN_REFUSAL}`
                      );
                    }
                    return null;
                  },
                },
                hint: 'Sous-types (ange, humain…), décomptes de zone, ou caractéristiques de cartes en jeu.',
              },
              {
                name: 'calcqui',
                label: 'Chez qui',
                initial: 'vous',
                hidden: (values) =>
                  values['forme'] !== 'calc' ||
                  (values['calcsrc'] ?? '').startsWith('card:') ||
                  (values['calcsrc'] ?? '').startsWith('self:'),
                options: [
                  { value: 'vous', label: 'Le contrôleur de la carte' },
                  { value: 'adv', label: 'Ses adversaires' },
                  { value: 'tous', label: 'Toute la table' },
                ],
                hint: 'Compter le cimetière d’en face est licite : il est public, et chacun le voit déjà.',
              },
              {
                name: 'calcexclude',
                label: 'Périmètre',
                initial: 'all',
                hidden: (values) =>
                  values['forme'] !== 'calc' ||
                  (values['calcsrc'] ?? '').startsWith('card:') ||
                  (values['calcsrc'] ?? '').startsWith('self:') ||
                  (values['calcsrc'] ?? '') === 'main' ||
                  (values['calcsrc'] ?? '') === 'biblio' ||
                  (values['calcsrc'] ?? '') === 'vie',
                options: [
                  { value: 'all', label: 'Toutes les cartes' },
                  { value: 'other', label: 'Autres cartes uniquement (exclure cette carte)' },
                ],
                hint: '« Autres cartes » ne compte pas cette carte si elle a le type/sous-type (ex. « pour chaque autre ange »).',
              },
              {
                name: 'calcoffset',
                label: 'Ajustement (décalage de départ)',
                initial: '0',
                maxLength: 5,
                hidden: (values) => values['forme'] !== 'calc',
                quick: [
                  { label: '-2', value: '-2' },
                  { label: '-1', value: '-1' },
                  { label: '0 (aucun)', value: '0' },
                  { label: '+1', value: '+1' },
                  { label: '+2', value: '+2' },
                ],
                hint: 'Modificateur appliqué au décompte (ex. -1 pour « nombre d’anges - 1 »). 0 par défaut.',
              },
              {
                name: 'pair',
                label: 'Modification de force / endurance',
                initial: '+1/+1',
                maxLength: 11,
                hidden: (values) => values['forme'] !== 'pt',
                quick: ['+1/+1', '-1/-1', '+2/+0', '+0/+2', '+2/+2', 'X/X'].map((v) => ({
                  label: v,
                  value: v,
                })),
                hint: 'Deux nombres séparés d’une barre, X compris : +1/+1, -1/-1, +2/+0, X/X.',
              },
              {
                name: 'kind',
                label: 'Nom du marqueur',
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
                label: 'Nombre de marqueurs',
                numeric: true,
                optional: true,
                initial: '1',
                placeholder: 'un nombre, ou rien',
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
                  { label: 'aucun', value: '' },
                ],
                hint: 'Trois marqueurs +1/+1, et non « +3/+3 » : c’est la règle du jeu.',
              },
            ],
          }).then((result) => {
            if (!result) return;
            const forme = result.values['forme'] ?? 'named';

            if (forme === 'calc') {
              const src = result.values['calcsrc'] ?? 'bat.land';
              const qui = (result.values['calcqui'] ?? 'vous') as 'vous' | 'adv' | 'tous';
              const mode = result.values['calcmode'] ?? 'suit';
              const offsetRaw = result.values['calcoffset'] ?? '0';
              const offset = Number.parseInt(offsetRaw, 10) || 0;
              const excludeOther = result.values['calcexclude'] === 'other';
              const state = useGame.getState();

              if (mode === 'fige') {
                /*
                 * Le décompte figé se résout **ici**, et ne laisse derrière lui
                 * qu'un marqueur +1/+1 ordinaire. C'est exactement ce que fait
                 * une carte qui « arrive avec un marqueur +1/+1 pour chaque… » :
                 * elle compte une fois, pose des cubes, et les cubes ne savent
                 * plus d'où ils viennent. Le compte est fait par carte cible,
                 * parce que « chez vous » dépend du contrôleur de chacune.
                 * qu'un marqueur ordinaire (+1/+1, X/X, +X/+X, ou nommé). C'est
                 * exactement ce que fait une carte qui « arrive avec un marqueur
                 * +1/+1 pour chaque… » ou « avec X marqueurs où X est le nombre
                 * d'anges - 1 » : elle compte une fois au moment de la pose,
                 * applique le décalage choisi, et les marqueurs ne bougent plus.
                 * Si le décompte final est nul ou négatif, aucun marqueur n'est posé.
                 */
                const spec = computedCounter(`${COMPUTED_SIGIL}+*/+* ${src}@${qui}`);
                if (!spec) return;
                const figeForm = result.values['calcfigeform'] ?? 'pt_set';
                const figeName = result.values['calcfigename'] ?? 'charge';

                for (const id of targets) {
                  const target = state.cards.get(id);
                  if (!target) continue;
                  const measure = measureCount(state, spec, target);
                  if (!measure || measure.n <= 0) continue;
                  send({ type: 'SET_COUNTER', targetId: id, kind: '+1/+1', value: measure.n });
                  const targetMeta = cardMeta(target.faceDown === false ? target.scryfallId : undefined);
                  const name = targetMeta?.name ?? 'Carte';

                  let baseValue = 0;
                  if (src.startsWith('self:')) {
                    const stat = src.slice(5) as 'power' | 'toughness' | 'counters';
                    baseValue = getCardStat(target, stat);
                  } else if (src.startsWith('card:')) {
                    const match = /^card:([^:]+):(power|toughness|counters)$/.exec(src);
                    if (match && match[1]) {
                      const fromCard = state.cards.get(match[1]);
                      if (fromCard) {
                        baseValue = getCardStat(fromCard, match[2] as 'power' | 'toughness' | 'counters');
                      }
                    }
                  } else {
                    const spec = computedCounter(`${COMPUTED_SIGIL}+*/+* ${src}@${qui}`);
                    if (!spec) continue;
                    const measure = measureCount(state, spec, target);
                    baseValue = measure ? measure.n : 0;
                    if (excludeOther) {
                      const res = resolveSource(spec.source);
                      if (res && target.zone.kind === res.source.zone) {
                        const targetScryfall = target.faceDown === false ? target.scryfallId : undefined;
                        const line = (targetScryfall ? cardMeta(targetScryfall)?.typeLine : undefined) ?? '';
                        if (res.subtype !== null) {
                          if (subtypesOf(line).has(res.subtype)) baseValue = Math.max(0, baseValue - 1);
                        } else if (res.source.family !== undefined) {
                          if (typeFamilies(line).has(res.source.family)) baseValue = Math.max(0, baseValue - 1);
                        } else if (!res.source.distinctTypes) {
                          baseValue = Math.max(0, baseValue - 1);
                        }
                      }
                    }
                  }

                  const finalValue = Math.max(0, baseValue + offset);
                  // Si le décompte final est nul ou négatif, aucun marqueur n'est posé
                  // (ex: 1 ange sur le terrain avec un décalage de -1 => 0 marqueur).
                  if (finalValue <= 0) continue;
                  // Le journal annonce que le décompte est égal à 0.
                  // Si le décompte final est nul ou négatif : aucun marqueur n'est posé.
                  // On annonce dans le journal que le décompte est égal à 0.
                  if (finalValue <= 0) {
                    send({ type: 'CHAT_BUBBLE', text: `Décompte figé sur ${name} = 0 (aucun marqueur)` });
                    continue;
                  }

                  if (figeForm === 'pt_set') {
                    send({ type: 'SET_COUNTER', targetId: id, kind: `${finalValue}/${finalValue}` });
                  } else if (figeForm === 'pt_add') {
                    send({ type: 'SET_COUNTER', targetId: id, kind: `+${finalValue}/+${finalValue}` });
                  } else if (figeForm === 'pt_counters') {
                    if (finalValue > 0) {
                      send({ type: 'SET_COUNTER', targetId: id, kind: '+1/+1', value: finalValue });
                    }
                    send({ type: 'SET_COUNTER', targetId: id, kind: '+1/+1', value: finalValue });
                  } else if (figeForm === 'named') {
                    const kind = figeName.trim() || 'charge';
                    send({ type: 'SET_COUNTER', targetId: id, kind, value: finalValue });
                  }
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
        label: facedown ? 'Retourner face visible' : 'Retourner face cachée',
        shortcut: 'M',
        separatorBefore: true,
        run: () => {
          send({ type: facedown ? 'TURN_FACE_UP' : 'TURN_FACE_DOWN', cardId: card.id });
          onClose();
        },
      },
      { label: 'Transformer (recto-verso)', shortcut: 'F', run: () => { send({ type: 'FLIP_FACE', cardId: card.id }); onClose(); } },
      {
        label: 'Copier en jeton',
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
        label: 'Attacher à… (cliquer la cible)',
        run: () => {
          beginAttach({ kind: 'CARD', sourceId: card.id });
          onClose();
        },
      },
      ...(card.attachedTo
        ? [{ label: 'Détacher', run: () => { send({ type: 'DETACH', sourceId: card.id }); onClose(); } }]
        : []),
      { label: 'Vers la main', shortcut: 'H', separatorBefore: true, run: () => move('HAND') },
      { label: 'Au cimetière', shortcut: 'G', run: () => move('GRAVEYARD') },
      { label: 'Exiler', shortcut: 'E', run: () => move('EXILE') },
      { label: 'Dessus de la bibliothèque', shortcut: 'L', run: () => move('LIBRARY', { index: 'TOP' }) },
      { label: 'Dessous de la bibliothèque', shortcut: 'B', run: () => move('LIBRARY', { index: 'BOTTOM' }) },
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
      { label: 'Dessus de la bibliothèque', shortcut: 'L', run: () => move('LIBRARY', { index: 'TOP' }) },
      { label: 'Mélanger dans la bibliothèque', run: () => move('LIBRARY', { index: 'RANDOM' }) },
      { label: 'Vers la main', shortcut: 'H', run: () => move('HAND') },
      { label: 'Sur le champ de bataille', shortcut: 'P', run: () => move('BATTLEFIELD', landing()) },
    );
  }

  if (inZone === 'GRAVEYARD' || inZone === 'EXILE' || inZone === 'COMMAND' || inZone === 'STACK_NOTE') {
    entries.push(
      { label: 'Sur le champ de bataille', shortcut: 'P', run: () => move('BATTLEFIELD', landing()) },
      { label: 'Vers la main', shortcut: 'H', run: () => move('HAND') },
      { label: 'Dessus de la bibliothèque', shortcut: 'L', run: () => move('LIBRARY', { index: 'TOP' }) },
      { label: 'Dessous de la bibliothèque', shortcut: 'B', run: () => move('LIBRARY', { index: 'BOTTOM' }) },
    );
    if (inZone !== 'EXILE') entries.push({ label: 'Exiler', shortcut: 'E', run: () => move('EXILE') });
    if (inZone !== 'GRAVEYARD') entries.push({ label: 'Au cimetière', shortcut: 'G', run: () => move('GRAVEYARD') });
    if (inZone === 'COMMAND') {
      entries.push({
        label: 'Lancer depuis la zone de commandement',
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
        label: 'Posée par erreur : reprendre en main',
        separatorBefore: true,
        run: () => {
          send({ type: 'TAKE_BACK', cardId: card.id, to: 'HAND' });
          onClose();
        },
      },
      {
        label: 'Posée par erreur : masquer à tout le monde',
        run: () => {
          send({ type: 'TAKE_BACK', cardId: card.id, to: 'FACE_DOWN' });
          onClose();
        },
      },
    );
  }

  if (card.faceDown && card.owner === seat) {
    entries.push({
      label: 'Regarder (annoncé publiquement)',
      separatorBefore: true,
      run: () => {
        send({ type: 'PEEK_FACE_DOWN', cardId: card.id });
        onClose();
      },
    });
  }
  if (card.faceDown === false && card.owner === seat) {
    entries.push({
      label: 'Changer d’impression…',
      separatorBefore: true,
      run: () => setPicking(true),
    });
  }
  if (card.kind === 'TOKEN' && card.faceDown === false) {
    entries.push({
      label: 'Ranger ce jeton sur l’étagère',
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
      label: confirming ? 'Confirmer la destruction ?' : 'Détruire le jeton',
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
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
      >
        <div className="border-b border-slate-800 px-3 py-1.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs font-semibold text-slate-100">
            {card.faceDown === false ? cardName(card.scryfallId) : 'Carte face cachée'}
          </p>
          {targets.length > 1 && (
            <span className="shrink-0 rounded bg-sky-950/80 border border-sky-800/60 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
              {targets.length} sél.
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
              Marqueurs sur cette carte
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
                        ? `${describeComputed(calc)} — recalculé tout seul`
                        : 'Régler ce marqueur, le renommer ou le retirer'
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
                        title="Un marqueur de moins"
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
                        title="Un marqueur de plus"
                      >
                        +
                      </button>
                    </>
                  )}
                  <button
                    className="ml-0.5 h-6 shrink-0 rounded px-1.5 text-xs text-rose-300 hover:bg-rose-950/60 transition-colors"
                    data-test="counter-remove"
                    onClick={() => send({ type: 'SET_COUNTER', targetId: card.id, kind: counter.kind, value: null })}
                    title="Retirer ce marqueur"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {entries.map((entry) => (
          <button
            key={entry.label}
            className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium transition-colors hover:bg-slate-800/90 active:bg-slate-700/80 ${
              entry.danger ? 'text-rose-300 hover:text-rose-200 hover:bg-rose-950/40' : 'text-slate-200 hover:text-white'
            } ${entry.separatorBefore ? 'mt-1 border-t border-slate-800/80 pt-1.5' : ''}`}
            onClick={entry.run}
          >
            <span className="truncate">{entry.label}</span>
            {entry.shortcut && (
              <kbd className="ml-2 rounded border border-slate-700 bg-slate-800/90 px-1.5 py-0.5 text-[10px] font-mono font-medium text-slate-400">
                {entry.shortcut}
              </kbd>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
