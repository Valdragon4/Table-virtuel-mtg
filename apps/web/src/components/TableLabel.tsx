/**
 * Étiquette posée sur la table, et compteur libre quand elle porte une valeur.
 *
 * C'est le marqueur qu'on pose à côté d'une créature qui pompe (« X/X »), pour
 * un compteur d'orages, un décompte de tours — tout ce que les cartes ne portent
 * pas. Le protocole les traite comme [libre] : n'importe quel siège les ajuste,
 * parce qu'elles appartiennent à la table plus qu'à leur auteur.
 *
 * Une étiquette est soit **flottante** — ses `x`/`y` sont des coordonnées de
 * monde —, soit **accrochée à une carte** (`attachedTo`), et ses `x`/`y` sont
 * alors un décalage relatif à cette carte. Dans le second cas, la table lui
 * passe la position de la carte en `anchor` : l'étiquette la suit sans qu'aucun
 * intent ne soit émis quand la carte bouge.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Label } from '@mtg/shared';
import { useGame } from '../store/game.js';
import { openDialog } from './Dialog.js';

/** Au-delà, on considère que le geste était un déplacement et non un clic. */
const DRAG_THRESHOLD = 4;

/**
 * Espacement minimal entre deux `MOVE_LABEL` émis pendant un glissement.
 *
 * Le geste envoyait auparavant un intent à **chaque** `pointermove`, soit près
 * de soixante par seconde là où le serveur en tolère vingt en régime soutenu
 * (`LIMITS`) : déplacer une étiquette suffisait à déclencher « trop d'actions
 * trop vite ». Le déplacement est donc désormais purement local pendant le
 * geste — écrit dans le `left`/`top` du nœud, hors de React — et seules quelques
 * positions intermédiaires très espacées partent, pour que les autres sièges
 * voient le mouvement plutôt qu'un saut. Six par seconde au maximum, contre
 * soixante, et une dernière au relâchement qui fait foi.
 */
const MOVE_THROTTLE_MS = 160;

/**
 * Ce que porte la valeur d'un marqueur.
 *
 * Trois formes, et l'interface en découle entièrement :
 *
 *  - `none` : **aucune valeur**. C'est le mot-clé qu'on accroche à une carte —
 *    « vol », « menace », « sur la pile ». Longtemps impossible : le marqueur
 *    était soit une note sans rien, soit un compteur qui affichait forcément un
 *    nombre à côté du mot.
 *  - `number` : un compteur classique, avec ses boutons − et +.
 *  - `pair` : une force et une endurance, **chacune réglable de son côté**.
 *    C'est le cas le plus demandé — « 1/1 », « 2/1 » — et il ne se règle pas
 *    avec un seul compteur : pomper la force ne touche pas l'endurance.
 *  - `text` : tout le reste, libre, modifiable au double-clic.
 */
type Shape =
  | { kind: 'none' }
  | { kind: 'number'; n: number }
  | { kind: 'pair'; left: number; right: number }
  | { kind: 'text'; text: string };

/** L'ambre du marqueur ordinaire, quand personne n'a choisi de couleur. */
const DEFAULT_COLOR = '#fbbf24';

/**
 * Teintes offertes à la modale.
 *
 * Toutes se lisent sur le fond ardoise de l'étiquette, et se distinguent entre
 * elles à la taille où elles sont rendues — un marqueur se reconnaît de loin,
 * à la couleur, avant qu'on en lise le texte.
 */
const COLORS = ['#fbbf24', '#f87171', '#34d399', '#38bdf8', '#a78bfa', '#f472b6', '#e2e8f0'];

export function valueShape(value: string | undefined): Shape {
  if (value === undefined || value === '') return { kind: 'none' };
  const pair = /^([+-]?\d{1,4})\s*\/\s*([+-]?\d{1,4})$/.exec(value);
  if (pair) return { kind: 'pair', left: Number(pair[1]), right: Number(pair[2]) };
  if (/^[+-]?\d{1,4}$/.test(value)) return { kind: 'number', n: Number(value) };
  return { kind: 'text', text: value };
}

/**
 * La valeur qu'appelle une forme, à partir de celle qu'on avait.
 *
 * La forme n'est pas stockée : elle se **lit** dans la valeur (`valueShape`).
 * Changer de forme dans la modale doit donc réécrire la valeur, sinon le choix
 * serait sans effet — « nombre » resterait affiché « 2/3 ». On garde au passage
 * ce qui peut l'être : un 3 devient « 3/3 », une paire retombe sur sa force.
 */
function valueFor(kind: Shape['kind'], previous: string): string {
  const shape = valueShape(previous);
  if (kind === 'none') return '';
  if (kind === 'number') {
    if (shape.kind === 'number') return String(shape.n);
    if (shape.kind === 'pair') return String(shape.left);
    return '1';
  }
  if (kind === 'pair') {
    if (shape.kind === 'pair') return `${shape.left}/${shape.right}`;
    if (shape.kind === 'number') return `${shape.n}/${shape.n}`;
    return '1/1';
  }
  // Un texte libre ne se devine pas d'un nombre : on laisse le champ vide
  // plutôt que de proposer un « 3 » que la lecture reprendrait pour un compteur.
  return shape.kind === 'text' ? shape.text : '';
}

/** Un chiffre et ses deux boutons, qui n'apparaissent qu'au survol. */
function Step({
  value,
  color,
  onChange,
}: {
  value: number;
  color: string;
  onChange: (next: number) => void;
}): React.ReactElement {
  const button =
    'w-4 shrink-0 text-[11px] font-bold leading-none text-slate-400 opacity-0 transition hover:text-white group-hover:opacity-100';
  return (
    <span className="inline-flex items-center">
      <button
        className={button}
        onClick={() => onChange(value - 1)}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        −
      </button>
      <span className="min-w-[1ch] text-center text-lg font-semibold leading-none" style={{ color }}>
        {value}
      </span>
      <button
        className={button}
        onClick={() => onChange(value + 1)}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        +
      </button>
    </span>
  );
}

function Value({
  shape,
  color,
  onChange,
}: {
  shape: Shape;
  color: string;
  onChange: (value: string) => void;
}): React.ReactElement | null {
  if (shape.kind === 'number') {
    return <Step color={color} onChange={(n) => onChange(String(n))} value={shape.n} />;
  }
  if (shape.kind === 'pair') {
    // Deux compteurs indépendants, séparés par la barre : c'est la force et
    // l'endurance, et les régler ensemble n'aurait aucun sens.
    return (
      <span className="inline-flex items-center">
        <Step color={color} onChange={(n) => onChange(`${n}/${shape.right}`)} value={shape.left} />
        <span className="px-0.5 text-lg font-semibold leading-none" style={{ color }}>
          /
        </span>
        <Step color={color} onChange={(n) => onChange(`${shape.left}/${n}`)} value={shape.right} />
      </span>
    );
  }
  if (shape.kind === 'text') {
    return (
      <span className="text-sm font-semibold leading-none" style={{ color }}>
        {shape.text}
      </span>
    );
  }
  return null;
}

export interface TableLabelProps {
  label: Label;
  scale: number;
  /**
   * Position de monde de la carte à laquelle l'étiquette est accrochée, ou
   * `null` si elle flotte. C'est la table qui la calcule : elle seule connaît
   * la disposition des panneaux.
   */
  anchor?: { x: number; y: number } | null;
  /**
   * Ramene un point du repere **affiche** vers le repere **partage**.
   *
   * Une etiquette flottante est rendue a une position traduite — notre siege
   * est en bas, les cases sont reattribuees — mais `MOVE_LABEL` parle le
   * repere partage. Sans cette conversion au moment d'emettre, on renvoyait au
   * serveur la position deja traduite, qu'il rendait puis retraduisait : a
   * chaque glissement l'etiquette prenait une case d'avance, et semblait aller
   * plus vite que la souris.
   *
   * Absent pour une etiquette accrochee : ses coordonnees sont relatives a sa
   * carte, elles ne traversent aucune traduction.
   */
  toShared?: (point: { x: number; y: number }) => { x: number; y: number };
}

export function TableLabel({
  label,
  scale,
  anchor = null,
  toShared,
}: TableLabelProps): React.ReactElement {
  /** Position a emettre : celle du repere partage, jamais celle qu'on affiche. */
  const emitted = (point: { x: number; y: number }): { x: number; y: number } => {
    const p = toShared && !label.attachedTo ? toShared(point) : point;
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  const send = useGame((s) => s.send);
  const beginAttach = useGame((s) => s.beginAttach);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label.text);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  /**
   * Position tenue par la main, tant que le geste n'a pas été confirmé.
   *
   * Le glissement était rendu par un `transform` **relatif** à la position
   * capturée au début du geste, posé directement sur le nœud. Or les
   * `MOVE_LABEL` intermédiaires partent en cours de route, et le premier
   * `LABEL_MOVED` qui revient re-rend l'étiquette : `left`/`top` valent alors
   * déjà « origine + delta », pendant que le `transform`, toujours en place et
   * toujours compté depuis l'origine, ajoute le même delta une seconde fois.
   * L'étiquette parcourait exactement **le double** de la distance de la
   * souris, et cessait de se tenir sous le curseur — le défaut n'apparaissant
   * qu'après le premier aller-retour serveur, la position finale, elle, était
   * juste, ce qui l'a longtemps rendu invisible à la recette.
   *
   * On tient donc la position en **absolu** : tant que `held` est posée, c'est
   * elle qui commande `left`/`top`, et l'écho du serveur ne peut plus s'ajouter
   * au geste — il converge vers la même valeur au lieu de s'y cumuler. Les
   * autres sièges continuent de voir le marqueur bouger en direct, puisque les
   * intents intermédiaires partent toujours.
   */
  const [held, setHeld] = useState<{ x: number; y: number } | null>(null);
  /** Le pointeur est-il encore enfoncé ? Un rendu ne doit pas relâcher la prise. */
  const holding = useRef(false);

  useEffect(() => {
    setDraft(label.text);
  }, [label.text]);

  /**
   * La prise se relâche quand l'état rattrape le geste — le serveur a confirmé
   * la dernière position —, et au plus tard après un court délai : si l'intent
   * a été refusé, ou si un autre siège a déplacé l'étiquette entre-temps,
   * l'étiquette doit redevenir celle que tout le monde voit plutôt que rester
   * figée sur un geste que la table n'a pas retenu.
   */
  useEffect(() => {
    if (!held || holding.current) return;
    if (label.x === held.x && label.y === held.y) {
      setHeld(null);
      return;
    }
    const timer = setTimeout(() => {
      if (!holding.current) setHeld(null);
    }, 1500);
    return () => clearTimeout(timer);
  }, [held, label.x, label.y]);

  const shape = valueShape(label.value);
  // Une étiquette accrochée se rend à la position de sa carte plus son décalage.
  const left = (anchor?.x ?? 0) + (held?.x ?? label.x);
  const top = (anchor?.y ?? 0) + (held?.y ?? label.y);

  /**
   * Déplacement à la souris. On travaille en coordonnées de monde : le delta
   * écran est divisé par l'échelle de la caméra, sinon l'étiquette dérive dès
   * qu'on a zoomé. Accrochée, ce sont ses décalages qui bougent — le calcul est
   * le même, seul le repère change.
   */
  function onPointerDown(event: React.PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    const origin = { x: held?.x ?? label.x, y: held?.y ?? label.y };
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    let lastSentAt = 0;
    let last = origin;

    const move = (e: PointerEvent): void => {
      const dx = (e.clientX - start.x) / scale;
      const dy = (e.clientY - start.y) / scale;
      if (!moved && Math.hypot(dx * scale, dy * scale) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        holding.current = true;
      }
      last = { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) };
      /*
       * Rendu local immédiat, en **absolu** : aucun rendu React, aucun
       * aller-retour serveur. Un décalage relatif s'ajouterait au `left`/`top`
       * que l'écho du serveur vient de réécrire, et l'étiquette ferait le
       * double du chemin ; une position absolue converge au contraire vers la
       * même valeur que l'écho.
       */
      if (root.current) {
        root.current.style.left = `${(anchor?.x ?? 0) + last.x}px`;
        root.current.style.top = `${(anchor?.y ?? 0) + last.y}px`;
      }
      const now = Date.now();
      if (now - lastSentAt < MOVE_THROTTLE_MS) return;
      lastSentAt = now;
      // La prise couvre le geste entier : sans elle, le rendu déclenché par
      // l'écho de cet intent replacerait le nœud à sa position d'arrivée alors
      // que la main continue de le porter.
      setHeld(last);
      send({ type: 'MOVE_LABEL', labelId: label.id, ...emitted(last) });
    };

    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) return;
      holding.current = false;
      // La position finale fait foi, et la prise la tient jusqu'à ce que le
      // serveur la confirme : sans cela l'étiquette reviendrait une fraction de
      // seconde à sa place de départ, le temps que `LABEL_MOVED` revienne.
      setHeld(last);
      send({ type: 'MOVE_LABEL', labelId: label.id, ...emitted(last) });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function commitText(): void {
    setEditing(false);
    const text = draft.trim();
    if (text && text !== label.text) send({ type: 'SET_LABEL', labelId: label.id, text });
    else setDraft(label.text);
  }

  /**
   * Modification complète, en une seule modale.
   *
   * Le double-clic ne change que le texte et les boutons − / + que la valeur :
   * pour passer un compteur en « 2/3 », ou simplement le recolorer, il fallait
   * le retirer et le reposer. Tout se règle désormais d'un geste — et par un
   * vrai dialogue, jamais par `window.prompt`, qui gèle la table et ne se
   * teste pas.
   */
  async function edit(): Promise<void> {
    const result = await openDialog({
      title: 'Modifier le marqueur',
      description: 'Le texte, la couleur et la forme de la valeur, en un seul geste.',
      submitLabel: 'Enregistrer',
      fields: [
        {
          name: 'text',
          label: 'Texte',
          initial: label.text,
          optional: true,
          maxLength: 200,
          placeholder: 'orages, vol, défausse…',
          hint: 'Laissé vide, le texte actuel est conservé.',
        },
        {
          name: 'shape',
          label: 'Valeur',
          initial: shape.kind,
          options: [
            { value: 'none', label: 'Aucune' },
            { value: 'number', label: 'Nombre' },
            { value: 'pair', label: 'Force / endurance' },
            { value: 'text', label: 'Texte libre' },
          ],
        },
        {
          name: 'value',
          label: 'Contenu de la valeur',
          initial: label.value ?? '',
          optional: true,
          maxLength: 24,
          hidden: (values) => values['shape'] === 'none',
          hint: 'Un nombre se règle ensuite par − et + ; une paire « 2/3 » porte deux compteurs.',
        },
        {
          name: 'color',
          label: 'Couleur',
          initial: label.color ?? DEFAULT_COLOR,
          colors: COLORS,
          maxLength: 7,
          placeholder: DEFAULT_COLOR,
        },
      ],
      normalize: (values, changed) =>
        changed === 'shape'
          ? { ...values, value: valueFor(values['shape'] as Shape['kind'], values['value'] ?? '') }
          : values,
    });
    if (!result) return;

    const text = result.values['text'] ?? '';
    const raw = result.values['shape'] === 'none' ? '' : (result.values['value'] ?? '');
    const color = result.values['color'] ?? '';
    send({
      type: 'SET_LABEL',
      labelId: label.id,
      // Le protocole refuse un texte vide : sans saisie, on garde celui qui est
      // là plutôt que de faire refuser tout le reste du geste.
      ...(text ? { text } : {}),
      // Une couleur mal écrite à la main serait refusée par le schéma : on ne
      // l'envoie que si elle en a la forme.
      ...(/^#[0-9a-fA-F]{6}$/.test(color) ? { color } : {}),
      // `null` retire la valeur : le marqueur redevient un simple mot-clé.
      value: raw === '' ? null : raw,
    });
  }

  /**
   * Décrochage : l'étiquette reprend des coordonnées de monde, là où elle est.
   *
   * C'est **le** moment où le repère change de nature, et c'est exactement là
   * qu'on l'oubliait. Une étiquette accrochée porte un décalage relatif à sa
   * carte, qui ne traverse aucune traduction ; une étiquette flottante porte
   * des coordonnées du monde **partagé**. `left`/`top` sont la position
   * d'**affichage** — ancre plus décalage, les deux dans le repère de vue —,
   * et les envoyer telles quelles revenait à faire lire au serveur une position
   * de vue comme une position partagée. Le rendu la retraduisait ensuite, et
   * l'étiquette sautait d'exactement le décalage entre sa case affichée et sa
   * case partagée : mesuré à deux sièges, 708 px de monde, soit 460 px à
   * l'écran au zoom courant. À un seul siège la réattribution des cases est
   * l'identité — d'où un défaut resté invisible.
   *
   * `emitted()` ne peut pas s'en charger : il ne traduit que pour une étiquette
   * déjà flottante, et celle-ci est encore accrochée à l'instant où l'on émet.
   * La traduction est donc demandée ici, explicitement.
   */
  function detach(): void {
    if (anchor) {
      const world = toShared ? toShared({ x: left, y: top }) : { x: left, y: top };
      send({
        type: 'MOVE_LABEL',
        labelId: label.id,
        x: Math.round(world.x),
        y: Math.round(world.y),
      });
    }
    send({ type: 'SET_LABEL', labelId: label.id, attachedTo: null });
  }

  return (
    <>
      <div
        ref={root}
        className="group absolute flex select-none items-stretch overflow-hidden rounded-md shadow-lg ring-1 ring-white/20"
        data-label={label.id}
        style={{
          left,
          top,
          background: '#0f172ae6',
          // Une étiquette se lit par-dessus les cartes : elle sert justement à
          // annoter ce qui est posé dessous.
          zIndex: 20,
          // Une étiquette accrochée le dit : un liseré de la couleur du lien.
          ...(label.attachedTo ? { boxShadow: '0 0 0 1px #38bdf8aa' } : {}),
        }}
        data-test="table-label"
        onPointerDown={onPointerDown}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        title="Glisser pour déplacer · clic droit pour le menu"
      >
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          {shape.kind !== 'none' && (
            <Value
              color={label.color ?? '#fbbf24'}
              onChange={(value) => send({ type: 'SET_LABEL', labelId: label.id, value })}
              shape={shape}
            />
          )}
          {editing ? (
            <input
              autoFocus
              className="w-24 rounded bg-slate-800 px-1 text-xs text-slate-100 outline-none ring-1 ring-sky-500"
              maxLength={200}
              value={draft}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitText}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitText();
                if (event.key === 'Escape') {
                  setDraft(label.text);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <span
              className="cursor-text whitespace-nowrap text-xs text-slate-200"
              onDoubleClick={(event) => {
                event.stopPropagation();
                setEditing(true);
              }}
            >
              {label.text}
            </span>
          )}
        </div>

      </div>

      {menu && (
        <LabelMenu
          x={menu.x}
          y={menu.y}
          attached={Boolean(label.attachedTo)}
          onClose={() => setMenu(null)}
          onEdit={() => {
            setMenu(null);
            void edit();
          }}
          onAttach={() => {
            beginAttach({ kind: 'LABEL', labelId: label.id });
            setMenu(null);
          }}
          onDetach={() => {
            detach();
            setMenu(null);
          }}
          onRemove={() => {
            send({ type: 'REMOVE_LABEL', labelId: label.id });
            setMenu(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Menu d'une étiquette, rendu par un **portail dans `document.body`**.
 *
 * Il est positionné en `fixed` à partir de `clientX`/`clientY`. Cela n'a de
 * sens que si le bloc contenant est bien la fenêtre — or un ancêtre portant un
 * `transform` devient le bloc contenant de ses descendants `fixed`. L'étiquette
 * vit dans le plan de la table, qui porte précisément le `transform` du zoom et
 * du déplacement de caméra : le menu s'ouvrait donc à des coordonnées d'écran
 * réinterprétées dans le repère du plan, c'est-à-dire très loin du curseur, et
 * d'autant plus loin qu'on avait zoomé. Le portail le sort de cet ancêtre : les
 * autres menus (carte, zone, table) sont rendus depuis la page et n'ont jamais
 * eu le problème.
 *
 * Le clic droit retirait l'étiquette sans rien demander. Cette brutalité
 * passait tant qu'une étiquette n'avait qu'un état ; elle en a désormais deux,
 * flottante ou accrochée, et le geste devait donc offrir le choix.
 */
function LabelMenu({
  x,
  y,
  attached,
  onClose,
  onEdit,
  onAttach,
  onDetach,
  onRemove,
}: {
  x: number;
  y: number;
  attached: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAttach: () => void;
  onDetach: () => void;
  onRemove: () => void;
}): React.ReactElement {
  /*
   * Échap, et le piège qu'il a fallu du temps pour voir.
   *
   * L'abonnement était refait à chaque rendu, parce que `onClose` est une
   * fermeture créée à la volée par l'étiquette et change donc d'identité à
   * chaque fois. Or les raccourcis de la table écoutent eux aussi `keydown` sur
   * la fenêtre, **avant** ce menu, et leur gestionnaire d'Échap écrit dans le
   * magasin ; comme l'état est lu par `useSyncExternalStore`, React re-rend
   * alors de façon **synchrone, au milieu de la distribution de l'événement**.
   * Le nettoyage de l'effet retirait l'écouteur et le réinscrivait aussitôt —
   * et la spécification DOM fige la liste des écouteurs d'une cible avant de
   * les appeler : celui qu'on venait de réinscrire ne serait pas rappelé pour
   * cet événement-là. D'où la contradiction observée : l'écouteur est bien
   * présent avant comme après la frappe, l'événement atteint bien la fenêtre,
   * et pourtant il n'est jamais appelé. Le clic hors du menu, lui, passe par un
   * gestionnaire React et n'a jamais souffert de rien.
   *
   * On inscrit donc **une seule fois**, pour la vie du menu, et l'on va
   * chercher la fermeture à jour dans une référence.
   */
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const entries: Array<{ label: string; run: () => void; danger?: boolean }> = [
    { label: 'Modifier…', run: onEdit },
    { label: attached ? 'Accrocher à une autre carte…' : 'Accrocher à une carte…', run: onAttach },
  ];
  if (attached) entries.push({ label: 'Décrocher', run: onDetach });
  entries.push({ label: 'Retirer l’étiquette', run: onRemove, danger: true });

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 w-56 rounded border border-edge bg-panel py-1 shadow-xl"
        data-test="label-menu"
        style={{
          left: Math.min(x, window.innerWidth - 240),
          // Quatre entrées au plus : la réserve doit suivre, sinon la dernière
          // sort de l'écran quand on clique en bas de la table.
          top: Math.min(y, window.innerHeight - 180),
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {entries.map((entry) => (
          <button
            key={entry.label}
            className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-800 ${
              entry.danger ? 'text-rose-300' : 'text-slate-200'
            }`}
            onClick={entry.run}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
