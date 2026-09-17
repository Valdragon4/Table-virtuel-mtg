/**
 * Panneau latéral des zones : cimetière, exil, zone de commandement, réserve,
 * et bibliothèque.
 *
 * Il remplace la modale plein écran : on le garde ouvert en jouant, il n'avale
 * pas la table, et l'on tire une carte directement de la liste vers une zone.
 *
 * Trois partis pris :
 *
 * - **Aucun bouton d'action sous les cartes.** La carte est la cible : clic
 *   droit pour son menu, glissement pour la déplacer. Une rangée de boutons par
 *   carte encombrerait la liste sans rien apporter.
 * - **Sélection multiple** — clic, Ctrl+clic, Maj+clic pour une plage — partagée
 *   avec le reste de la table, de sorte que le menu contextuel agisse sur toute
 *   la sélection.
 * - **La bibliothèque n'est pas une pile qu'on parcourt.** Son contenu n'est pas
 *   dans le client, et le serveur ne l'envoie qu'au prix d'une consultation
 *   annoncée à toute la table. L'onglet le dit et propose l'action ; il ne
 *   simule jamais un accès libre.
 * - **La synthèse par type *est* le filtre.** Elle répond d'un coup d'œil à
 *   « qu'y a-t-il dans ce cimetière ? » ; la suite naturelle est « montre-moi
 *   les sept créatures », et c'est la pastille qu'on a envie de cliquer. Les
 *   deux ne se remplacent pas pour autant : un filtre ne montre qu'une famille
 *   à la fois, la synthèse les montre toutes ensemble. Les compteurs restent
 *   donc ceux de **toute la zone**, filtre actif ou non — la synthèse ne se
 *   rétracte pas autour de ce qu'elle a servi à choisir, sans quoi on ne
 *   pourrait plus sauter d'une famille à l'autre.
 * - **Un seul type à la fois.** Le comptage étant multi-familles, cumuler
 *   « artefact » et « créature » voudrait dire deux choses opposées — les
 *   cartes qui sont l'un *ou* l'autre, ou celles qui sont les deux — et rien à
 *   l'écran ne dirait laquelle. Un cumul qu'on ne sait pas lire vaut moins
 *   qu'un choix exclusif, dont la pastille « Tout » est le retour évident. Le
 *   filtre par nom, lui, se cumule sans ambiguïté : il porte sur autre chose.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardView, SeatId, ZoneKind, ZoneRef } from '@mtg/shared';
import { useGame, zoneKey } from '../store/game.js';
import { CardSprite, useCardMetaTick } from './CardSprite.js';
import { cardMeta, cardName } from '../lib/cards.js';
import { startCardDrag } from './DragLayer.js';
import { askNumber } from './Dialog.js';

const TABS: Array<{ kind: ZoneKind; label: string; mineOnly: boolean }> = [
  { kind: 'GRAVEYARD', label: 'Cimetière', mineOnly: false },
  { kind: 'EXILE', label: 'Exil', mineOnly: false },
  { kind: 'COMMAND', label: 'Commandement', mineOnly: false },
  { kind: 'LIBRARY', label: 'Bibliothèque', mineOnly: true },
  { kind: 'SIDEBOARD', label: 'Réserve', mineOnly: true },
];

/** Largeur du panneau, partagée avec la mise en page qui doit lui céder la place. */
export const ZONE_PANEL_WIDTH = 330;

/**
 * Grandes familles de types, dans l'ordre où elles sont essayées.
 *
 * Le mot-clé est en **anglais** parce que la ligne de type vient de Scryfall et
 * n'existe qu'en anglais dans notre index (`CardMeta.typeLine`, du genre
 * `Legendary Creature — Human Wizard`) ; le libellé, lui, est en français,
 * comme tout ce que l'utilisateur lit.
 *
 * **Règle de classement : une carte compte dans *chaque* famille qu'elle
 * porte.** Un `Artifact Creature` **est** un artefact **et** une créature — ce
 * n'est pas une convention d'affichage, c'est la règle du jeu : il est détruit
 * par ce qui détruit les artefacts comme par ce qui détruit les créatures.
 * Une première version n'en comptait qu'une, la « plus significative », pour
 * que la somme des colonnes fasse le compte de la zone. C'était mettre la
 * commodité de l'addition avant l'exactitude, et cela répondait faux à la seule
 * question qu'on pose à cette synthèse : « combien d'artefacts ai-je au
 * cimetière ? »
 *
 * La somme des familles peut donc dépasser le nombre de cartes, et c'est
 * normal. Le total de la zone est affiché à part, pour qu'on ne cherche pas à
 * retrouver l'un en additionnant les autres.
 *
 * **Le filtre suit exactement la même règle**, et ce n'est pas un détail
 * d'implémentation : il consomme le classement déjà calculé pour les pastilles,
 * de sorte que filtrer sur « artefact » montre les créatures-artefacts, et
 * qu'une pastille annonçant 7 ne puisse jamais en afficher 6.
 */
export const TYPE_FAMILIES: ReadonlyArray<{ key: string; label: string; keyword: string }> = [
  { key: 'creature', label: 'Créatures', keyword: 'creature' },
  { key: 'planeswalker', label: 'Planeswalkers', keyword: 'planeswalker' },
  { key: 'land', label: 'Terrains', keyword: 'land' },
  { key: 'artifact', label: 'Artefacts', keyword: 'artifact' },
  { key: 'enchantment', label: 'Enchantements', keyword: 'enchantment' },
  { key: 'instant', label: 'Éphémères', keyword: 'instant' },
  { key: 'sorcery', label: 'Rituels', keyword: 'sorcery' },
];

/** Familles d'une ligne de type Scryfall, ou `null` si elle n'en porte aucune. */
export function typeFamilyKey(typeLine: string): string[] | null {
  // Seuls les **types** comptent, jamais les sous-types : ils vivent après le
  // tiret cadratin, et les y laisser ferait d'un « Basic Land — Island » un
  // terrain par « Island » autant que par « Land », mais surtout d'un
  // « Enchantment — Aura » posé sur un highlander n'importe quoi. Une carte
  // recto-verso ou coupée en deux (`//`) donne plusieurs faces : on les réunit,
  // et la priorité ci-dessus tranche.
  const types = typeLine
    .split('//')
    .map((face) => face.split('—')[0] ?? '')
    .join(' ')
    .toLowerCase();
  const found = TYPE_FAMILIES.filter((family) => types.includes(family.keyword)).map((f) => f.key);
  return found.length > 0 ? found : null;
}

/**
 * Seaux hors familles. Ils ne sont pas des familles au rabais : ensemble avec
 * `TYPE_FAMILIES`, ils forment une partition **complète** de la zone — toute
 * carte tombe dans au moins un seau, et tout seau non vide porte sa pastille,
 * donc son filtre. Sans cette complétude, filtrer ferait disparaître des cartes
 * qu'aucune pastille ne réclamerait, et le panneau mentirait par omission.
 */
/** Carte dont on ne voit pas l'identité : son type ne nous regarde pas. */
const HIDDEN = 'hidden';
/** Fiche pas encore arrivée de l'API : on l'annonce, on ne la devine pas. */
const UNKNOWN = 'unknown';
/** Type connu mais hors familles (Battle, Dungeon, Plane…). */
const OTHER = 'other';

interface ZoneChip {
  key: string;
  label: string;
  count: number;
  /** Ce que la pastille apprend, indépendamment du geste qu'on peut y faire. */
  hint: string;
}

/**
 * Classe une zone : à quel(s) seau(x) appartient chaque carte, et combien de
 * cartes par seau.
 *
 * Le classement et le comptage sortent du **même passage** : la pastille et la
 * liste filtrée ne peuvent donc pas diverger, ce qui serait le premier bug
 * qu'on écrirait en recalculant l'appartenance au moment de filtrer.
 */
function classifyZone(cards: CardView[]): { buckets: Map<string, string[]>; chips: ZoneChip[] } {
  const buckets = new Map<string, string[]>();
  const counts = new Map<string, number>();

  for (const card of cards) {
    let keys: string[];
    if (card.faceDown !== false) {
      keys = [HIDDEN];
    } else {
      const typeLine = cardMeta(card.scryfallId)?.typeLine;
      keys = typeLine === undefined ? [UNKNOWN] : (typeFamilyKey(typeLine) ?? [OTHER]);
    }
    buckets.set(card.id, keys);
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const chips: ZoneChip[] = [];
  for (const family of TYPE_FAMILIES) {
    const count = counts.get(family.key) ?? 0;
    if (count > 0) {
      chips.push({
        key: family.key,
        label: family.label,
        count,
        hint: `${count} ${family.label.toLowerCase()} dans cette zone`,
      });
    }
  }
  const tail: Array<[string, string, string]> = [
    [OTHER, 'Autres', 'Types hors des grandes familles (bataille, donjon…)'],
    [HIDDEN, 'Face cachée', "Vous n'en voyez pas l'identité : leur type n'est pas compté"],
    [UNKNOWN, 'Type inconnu', 'Fiche pas encore chargée : ces cartes ne sont comptées nulle part ailleurs'],
  ];
  for (const [key, label, hint] of tail) {
    const count = counts.get(key) ?? 0;
    if (count > 0) chips.push({ key, label, count, hint });
  }
  return { buckets, chips };
}

/**
 * Synthèse par type au-dessus de la liste, et filtre du même geste.
 *
 * Les compteurs portent sur **toute la zone**, pas sur ce que laissent passer le
 * filtre par nom ou le filtre par type : c'est une description de la pile, et la
 * ligne de pied dit déjà combien de cartes sont retenues. Une synthèse qui se
 * recalculerait sur son propre résultat afficherait « Créatures 7 » puis, une
 * fois cliquée, « Créatures 7 » seule — on aurait perdu la carte des autres
 * familles, et donc le moyen d'en choisir une autre.
 *
 * Le composant ne décide rien : il reçoit le seau actif et rend le choix. L'état
 * vit dans le panneau, jamais dans le magasin — un geste de lecture ne doit
 * toucher à rien de partagé, et surtout pas provoquer un rendu du plan de table.
 */
function TypeSummary({
  total,
  chips,
  active,
  onPick,
}: {
  total: number;
  chips: ZoneChip[];
  active: string | null;
  onPick: (key: string | null) => void;
}): React.ReactElement | null {
  if (total === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-1 border-b border-edge px-3 py-2"
      data-test="zone-type-summary"
    >
      {/*
        Le total de la zone, en tête et à part. Une carte comptant dans chaque
        famille qu'elle porte, la somme des pastilles peut le dépasser : sans ce
        repère, on chercherait à le retrouver en additionnant, et l'on croirait
        à une erreur.

        C'est aussi le retour à tout. Le faire porter par le total plutôt que par
        une croix ajoutée ailleurs met les états du filtre sur une seule rangée,
        « Tout » compris : on lit une série de boutons dont un seul est allumé, et
        l'on sait sans l'essayer que cliquer ailleurs change de vue et non de
        cumul.
      */}
      <button
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${
          active === null
            ? 'bg-gray-200 text-gray-900 ring-gray-200'
            : 'bg-slate-950/70 text-slate-300 ring-slate-700 hover:ring-slate-500'
        }`}
        data-test="zone-total"
        data-active={active === null}
        onClick={() => onPick(null)}
        title={
          active === null
            ? 'Toute la zone est affichée'
            : 'Retirer le filtre et réafficher toute la zone'
        }
        type="button"
      >
        Tout · {total} carte{total > 1 ? 's' : ''}
      </button>
      {chips.map((chip) => {
        const on = active === chip.key;
        return (
          <button
            key={chip.key}
            aria-pressed={on}
            className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ${
              on
                ? 'bg-gray-200 font-medium text-gray-900 ring-gray-200'
                : chip.key === HIDDEN || chip.key === UNKNOWN
                  ? 'bg-slate-900/60 text-slate-400 ring-slate-700 hover:ring-slate-500'
                  : 'bg-slate-800/70 text-slate-200 ring-slate-600 hover:ring-slate-400'
            }`}
            data-test="zone-type-chip"
            data-active={on}
            data-family={chip.key}
            // Le clic sur la pastille allumée l'éteint : le geste qui a filtré
            // défait le filtre, sans qu'il faille viser « Tout ».
            onClick={() => onPick(on ? null : chip.key)}
            title={`${chip.hint} · ${on ? 'cliquer pour tout réafficher' : "cliquer pour n'afficher que celles-là"}`}
            type="button"
          >
            {chip.label} <span className="font-semibold">{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ZonePanel({
  onOpenChange,
}: {
  /** Prévient la page : les panneaux flottants de droite doivent se décaler. */
  onOpenChange: (open: boolean) => void;
}): React.ReactElement | null {
  const cards = useGame((s) => s.cards);
  const seats = useGame((s) => s.seats);
  const counts = useGame((s) => s.zoneCounts);
  const mySeat = useGame((s) => s.mySeat);
  const selection = useGame((s) => s.selection);
  const setSelection = useGame((s) => s.setSelection);
  const openMenu = useGame((s) => s.openMenu);
  const send = useGame((s) => s.send);

  // Les fiches arrivent par lots, après coup : sans ce réveil, la synthèse
  // resterait sur « 12 types inconnus » jusqu'au prochain rendu venu d'ailleurs,
  // et le filtre porterait sur un classement périmé. Il est ici, et non dans la
  // synthèse, depuis que le classement sert aussi à filtrer la liste.
  useCardMetaTick();

  /**
   * Dos personnalisé de chaque siège, indexé par identifiant.
   *
   * Le panneau montre des cartes **face cachée** — l'exil face cachée en
   * particulier —, et le dos qu'on doit y voir est celui du **propriétaire** de
   * la carte, pas celui du siège dont on ouvre le panneau : une carte exilée
   * reste physiquement la carte de son propriétaire, et son dos est la seule
   * information qu'un adversaire a le droit d'en tirer.
   *
   * La distinction n'est pas théorique : c'est l'**acteur** qui reçoit la zone
   * d'exil, pas le propriétaire. Exiler la carte d'un adversaire la range dans
   * *son propre* exil avec un `owner` étranger, de sorte qu'un même panneau
   * mélange couramment plusieurs propriétaires. Un dos unique pour tout le
   * panneau serait donc faux dès la première carte volée.
   *
   * On passe par une Map mémoïsée plutôt que par un `find` dans la boucle de
   * rendu, et surtout jamais par un sélecteur zustand qui construirait un objet
   * neuf à chaque appel : `seats` est sélectionné tel quel, la dérivation se
   * fait ici.
   */
  const backs = useMemo(() => {
    const map = new Map<SeatId, string | null>();
    for (const s of seats) map.set(s.id, s.cardBackUrl);
    return map;
  }, [seats]);

  const [open, setOpen] = useState<{ seat: string; kind: ZoneKind } | null>(null);
  const [query, setQuery] = useState('');
  /**
   * Filtre par type, **avec la zone qu'il décrit**.
   *
   * Un filtre ne doit pas survivre à son objet : « Créatures » gardé en passant
   * du cimetière à l'exil afficherait une liste vide là où l'onglet annonce
   * cinq cartes, et l'on croirait à une perte. Les deux gestes qui changent de
   * zone — l'onglet, l'ouverture sur une pile cliquée — le remettent donc à
   * `null`.
   *
   * La clef de zone est la ceinture par-dessus les bretelles : elle garantit
   * qu'un filtre ne s'applique **jamais** à une zone autre que celle où il a été
   * choisi, même si l'on ajoutait demain une troisième façon de changer de zone
   * en oubliant la remise à zéro. Le pire cas devient alors « le filtre
   * réapparaît en revenant sur ses pas », jamais « la liste est vide et je ne
   * sais pas pourquoi ».
   */
  const [typeFilter, setTypeFilter] = useState<{ zone: string; key: string } | null>(null);
  /** Ancre de la sélection par plage. */
  const anchor = useRef<string | null>(null);

  useEffect(() => {
    const onBrowse = (event: Event): void => {
      const zone = (event as CustomEvent<ZoneRef>).detail;
      setOpen({ seat: zone.seat, kind: zone.kind });
      setQuery('');
      // Rouvrir la même zone est un geste neuf : on la montre entière, même si
      // la clef de `typeFilter` correspondait encore.
      setTypeFilter(null);
    };
    window.addEventListener('mtg:browse-zone', onBrowse);
    return () => window.removeEventListener('mtg:browse-zone', onBrowse);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape' && target?.tagName !== 'INPUT') setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    onOpenChange(open !== null);
  }, [open, onOpenChange]);

  if (!open || !mySeat) return null;

  const seat = seats.find((s) => s.id === open.seat);
  const mine = open.seat === mySeat;
  const tabs = TABS.filter((tab) => mine || !tab.mineOnly);

  // L'ordre reçu fait foi. Sur une fouille, le serveur brasse volontairement ce
  // qu'il renvoie : le trier autrement, ou le présenter comme l'ordre réel de la
  // zone, redonnerait une information qu'il a pris soin de ne pas donner.
  const contents = [...cards.values()]
    .filter((card) => card.zone.seat === open.seat && card.zone.kind === open.kind)
    .sort((a, b) => a.sortIndex - b.sortIndex);

  const zoneId = zoneKey({ seat: open.seat, kind: open.kind });
  const { buckets, chips } = classifyZone(contents);
  /** Le filtre ne vaut que pour la zone qui l'a vu naître (cf. `typeFilter`). */
  const family = typeFilter?.zone === zoneId ? typeFilter.key : null;

  const visible = contents.filter((card) => {
    // Le type d'abord : c'est le filtre le plus large, et il porte sur un
    // classement déjà fait. Les deux filtres se cumulent — « Créatures » puis
    // « bolt » se lit sans ambiguïté, contrairement à deux types cumulés.
    if (family !== null && !(buckets.get(card.id) ?? []).includes(family)) return false;
    if (!query.trim()) return true;
    if (card.faceDown !== false) return false;
    return cardName(card.scryfallId).toLowerCase().includes(query.trim().toLowerCase());
  });

  /**
   * Cartes qu'aucun filtre de type ne peut atteindre, et qu'il faut donc dire.
   *
   * Une carte face cachée n'a pas de type **pour nous** : le serveur ne nous en
   * envoie aucune identité, et la règle du projet est que la visibilité se
   * décide à l'émission — le client n'a rien à filtrer, il n'a rien reçu. Elle
   * ne peut donc répondre ni « créature » ni « pas créature ». La faire
   * disparaître en silence donnerait un cimetière plus petit qu'il n'est ; on
   * l'annonce sous la liste, et sa pastille reste là pour la montrer. Même
   * traitement pour la fiche pas encore chargée : le trou est temporaire, mais
   * il se voit pareil.
   */
  const unreachable =
    family !== null && family !== HIDDEN && family !== UNKNOWN
      ? chips.filter((chip) => chip.key === HIDDEN || chip.key === UNKNOWN)
      : [];

  function pick(card: CardView, event: React.PointerEvent): void {
    const ids = visible.map((c) => c.id);
    if (event.shiftKey && anchor.current) {
      const from = ids.indexOf(anchor.current);
      const to = ids.indexOf(card.id);
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        // La plage s'ajoute à ce qui est déjà sélectionné : c'est le geste
        // attendu quand on a d'abord pointé quelques cartes à la main.
        setSelection(new Set([...selection, ...ids.slice(lo, hi + 1)]));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selection);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      setSelection(next);
      anchor.current = card.id;
      return;
    }
    setSelection(new Set([card.id]));
    anchor.current = card.id;
  }

  const zoneCount = counts.get(zoneKey({ seat: open.seat, kind: open.kind })) ?? contents.length;

  return (
    <aside
      className="pointer-events-auto fixed bottom-0 right-0 top-0 z-30 flex flex-col border-l border-edge bg-panel/95 backdrop-blur"
      data-test="zone-panel"
      style={{ width: ZONE_PANEL_WIDTH }}
    >
      <header className="border-b border-edge px-3 py-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-200">
            Zones · <span style={{ color: seat?.color }}>{seat?.displayName ?? '?'}</span>
          </span>
          <button
            className="text-slate-500 hover:text-slate-200"
            data-test="zone-panel-close"
            onClick={() => setOpen(null)}
            title="Fermer (Échap)"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.kind}
              className={`rounded px-2 py-1 text-xs ${
                open.kind === tab.kind
                  ? 'bg-gray-200 font-medium text-gray-900'
                  : 'border border-edge text-slate-300 hover:border-slate-500'
              }`}
              data-test="zone-tab"
              data-zone-tab={tab.kind}
              onClick={() => {
                setOpen({ seat: open.seat, kind: tab.kind });
                setSelection(new Set());
                // Le filtre décrit la zone qu'on quitte : il ne revient pas
                // avec elle. Sans cet oubli, revenir sur ses pas rouvrirait le
                // cimetière amputé, sans qu'on se souvienne l'avoir demandé.
                setTypeFilter(null);
                anchor.current = null;
              }}
            >
              {tab.label}{' '}
              <span className="opacity-60">
                {counts.get(zoneKey({ seat: open.seat, kind: tab.kind })) ?? 0}
              </span>
            </button>
          ))}
        </div>

        <input
          className="mt-2 w-full rounded border border-edge bg-table px-2 py-1 text-sm text-slate-200"
          data-test="zone-search"
          placeholder="Filtrer par nom…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>

      {open.kind === 'LIBRARY' ? (
        <LibraryTab count={zoneCount} mine={mine} seat={open.seat} />
      ) : (
        <>
          {/*
            La synthèse coiffe toutes les zones énumérées, et pas seulement les
            trois publiques : la réserve est une liste de cartes comme les
            autres, et savoir d'un coup d'œil combien de terrains elle contient
            y sert exactement autant. La bibliothèque, elle, n'a pas de contenu
            côté client — il n'y a rien à compter.

            Le filtre suit la synthèse partout où elle va, sans exception par
            onglet. L'utilisateur a parlé des cimetières et c'est là qu'il a
            demandé ; la **réserve** est pourtant le cas où il sert le plus —
            soixante cartes à parcourir avant une partie —, l'exil grossit dans
            les mêmes proportions, et le rendre indisponible là serait arbitraire.
            Reste la zone de commandement, ses une ou deux cartes : le filtre n'y
            sert à rien, mais il n'y coûte rien non plus, puisqu'une pastille
            n'apparaît que si son seau est peuplé — une zone d'une carte montre
            une pastille, et cliquer dessus n'enlève rien. Une exception par
            onglet aurait fait une règle à retenir pour une économie nulle.
          */}
          <TypeSummary
            active={family}
            chips={chips}
            onPick={(key) => setTypeFilter(key === null ? null : { zone: zoneId, key })}
            total={contents.length}
          />
          <div className="scrollbar-thin grid flex-1 grid-cols-3 content-start gap-2 overflow-y-auto p-2">
            {visible.length === 0 && (
              <p className="col-span-3 py-4 text-center text-xs text-slate-500">
                {contents.length === 0 ? 'Pile vide.' : 'Aucune carte ne correspond.'}
              </p>
            )}
            {visible.map((card) => (
              <div
                key={card.id}
                className="cursor-pointer"
                data-test="zone-card"
                data-card-in-zone={card.id}
                onPointerDown={(event) => {
                  // Bouton gauche seulement : un clic droit arrive lui aussi par
                  // `pointerdown`, et repartir de zéro à ce moment-là réduisait
                  // la sélection à la carte visée juste avant d'ouvrir son menu.
                  if (event.button !== 0) return;
                  // Sélectionner d'abord, puis laisser le glissement démarrer :
                  // un même appui sert au clic et au tirage vers la table.
                  pick(card, event);
                  startCardDrag(card, event);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!selection.has(card.id)) setSelection(new Set([card.id]));
                  openMenu({ kind: 'CARD', card, x: event.clientX, y: event.clientY });
                }}
              >
                {/*
                  `card.owner` et non `open.seat` : le dos suit la carte, pas le
                  panneau. `backs.get` rend `undefined` pour un siège parti de
                  la table — `CardBack` retombe alors sur le dos officiel, servi
                  par le CDN de Scryfall au navigateur du joueur, jamais par
                  nous.
                */}
                <CardSprite
                  card={card}
                  cardBackUrl={backs.get(card.owner) ?? null}
                  scale={0.58}
                  selected={selection.has(card.id)}
                />
                <p className="mt-0.5 truncate text-[10px] text-slate-500">
                  {card.faceDown === false ? cardName(card.scryfallId) : 'Face cachée'}
                </p>
              </div>
            ))}
            {/*
              Le pied de panneau dit « 3 / 12 carte(s) » et ne ment donc pas sur
              le compte ; il ne dit pas *pourquoi* neuf cartes manquent. Ce
              rappel-là est le seul endroit où l'on apprend qu'une partie de la
              zone ne peut, par construction, répondre à aucun filtre de type.
            */}
            {unreachable.length > 0 && (
              <p
                className="col-span-3 rounded bg-slate-900/70 px-2 py-1 text-[10px] leading-snug text-slate-400"
                data-test="zone-filter-note"
              >
                {unreachable
                  .map(
                    (chip) =>
                      `${chip.count} carte${chip.count > 1 ? 's' : ''} ` +
                      (chip.key === HIDDEN ? 'face cachée' : 'de type inconnu'),
                  )
                  .join(' et ')}{' '}
                hors de ce filtre : vous n'en connaissez pas le type. Leur pastille les affiche.
              </p>
            )}
          </div>

          <footer className="border-t border-edge px-3 py-2 text-[11px] text-slate-500">
            {visible.length} / {contents.length} carte(s)
            {selection.size > 0 && ` · ${selection.size} sélectionnée(s)`}
            <br />
            Clic pour sélectionner, Ctrl+clic pour ajouter, Maj+clic pour une plage.
            Clic droit pour le menu, glisser vers la table pour déplacer.
          </footer>
        </>
      )}
    </aside>
  );
}

/**
 * Onglet Bibliothèque.
 *
 * Il n'affiche pas de cartes, et c'est volontaire : le client n'en a aucune. Le
 * serveur ne les envoie qu'au terme d'une consultation, qu'il annonce à toute la
 * table — c'est une règle sociale du produit, pas une limite à contourner.
 */
function LibraryTab({ count, mine, seat }: { count: number; mine: boolean; seat: string }): React.ReactElement {
  const send = useGame((s) => s.send);
  const zone: ZoneRef = { seat, kind: 'LIBRARY' };

  const ask = (question: string, fallback: string): number | null => {
    const value = Number.parseInt(window.prompt(question, fallback) ?? '', 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  return (
    <div className="flex-1 space-y-3 p-3 text-sm">
      <p className="text-slate-300">
        <span className="text-2xl font-semibold text-slate-100">{count}</span> carte(s).
      </p>
      {mine ? (
        <>
          <p className="rounded-lg border border-amber-700/50 bg-amber-950/40 p-2.5 text-xs text-amber-200 leading-relaxed">
            Le contenu d'une bibliothèque n'est pas connu du client, pas même du vôtre.
            L'ouvrir démarre une <strong>consultation</strong>, et les autres joueurs en sont
            informés dans le journal. L'ordre qui vous sera montré est brassé : ce n'est pas
            l'ordre réel de votre bibliothèque.
          </p>
          <button
            className="flex items-center justify-center gap-2 w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-500 active:scale-[0.99] transition-all"
            data-test="library-search"
            onClick={() => send({ type: 'LOOK', zone, count: 'ALL', mode: 'SEARCH' })}
            type="button"
          >
            <span>🔍</span>
            <span>Fouiller la bibliothèque</span>
          </button>
          <button
            className="flex items-center justify-center gap-2 w-full rounded-lg border border-edge/90 bg-slate-800/80 px-3 py-2 text-sm text-slate-200 hover:border-slate-500 hover:bg-slate-700/80 transition-all"
            onClick={() => {
              void askNumber({
                title: 'Regarder le dessus de la bibliothèque',
                label: 'Nombre de cartes à regarder',
                initial: 3,
                quick: [1, 2, 3, 5, 7, 10],
              }).then((n) => {
                if (n) send({ type: 'LOOK', zone, count: n, mode: 'PEEK' });
              });
            }}
            type="button"
          >
            <span>👁️</span>
            <span>Regarder le dessus…</span>
          </button>
          <button
            className="flex items-center justify-center gap-2 w-full rounded-lg border border-edge/90 bg-slate-800/80 px-3 py-2 text-sm text-slate-200 hover:border-slate-500 hover:bg-slate-700/80 transition-all"
            onClick={() => send({ type: 'SHUFFLE', zone })}
            type="button"
          >
            <span>🔀</span>
            <span>Mélanger</span>
          </button>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          Seul son propriétaire peut consulter cette bibliothèque, et il ne peut pas le faire
          discrètement.
        </p>
      )}
    </div>
  );
}
