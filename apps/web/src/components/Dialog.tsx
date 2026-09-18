/**
 * Dialogue de saisie réutilisable, en remplacement de `window.prompt`.
 *
 * Pourquoi un composant plutôt que la modale native :
 *
 * - `prompt` **bloque le fil d'exécution** et gèle la page entière — les
 *   events du serveur continuent d'arriver mais rien ne se repeint ;
 * - il ne se style pas : il ne porte ni la bordure `border-edge`, ni le
 *   `bg-panel`, ni les gris `text-slate-*` du reste de la table ;
 * - il ne garde **aucune mémoire** d'une fois sur l'autre, alors qu'on repose
 *   presque toujours le même marqueur ou qu'on pioche le même nombre ;
 * - il n'offre aucune valeur usuelle à portée de clic ;
 * - et il ne se teste qu'en le détournant, ce qui ne prouve rien du produit.
 *
 * Le modèle est la saisie en place de `TableMenu` : même habillage, même
 * mémoire de la dernière entrée. Ce qui change ici, c'est l'**appel** : une
 * fonction `openDialog()` qui rend une promesse, pour qu'un gestionnaire
 * d'événement s'écrive sans être retourné en composant à état.
 *
 * Le dialogue vit dans sa **propre racine React**, accrochée au `body`. C'est
 * ce qui permet de l'appeler depuis un menu contextuel qui se referme aussitôt
 * après : le dialogue survit à la disparition de son appelant.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Une valeur usuelle, offerte au clic à côté du champ. */
export interface DialogQuick {
  label: string;
  value: string;
}

/** Une des formes possibles d'un champ à choix unique. */
export interface DialogOption {
  value: string;
  label: string;
  /**
   * Intitulé du groupe sous lequel l'option se range. Les groupes s'affichent
   * dans l'ordre où ils apparaissent, chacun sous son nom ; sans `group`, les
   * options restent en un seul bandeau, comme avant.
   */
  group?: string;
  /** Mots par lesquels la recherche doit aussi trouver l'option, sans les afficher. */
  keywords?: string;
}

/**
 * Le bandeau d'options devient une **liste cherchable**.
 *
 * Au-delà d'une douzaine d'entrées, le bandeau cesse de rendre le service qu'on
 * lui demandait : « les options sont peu nombreuses et toutes lisibles d'un coup
 * d'œil » n'est plus vrai, et le dialogue déborde de la fenêtre — mesuré à
 * 916 px de haut pour 800 px de fenêtre, le bouton « Valider » hors d'atteinte.
 * La recherche rend la lisibilité sans renoncer au reste : ce qui est retenu
 * reste visible, et les groupes nomment ce que l'œil devinait.
 */
export interface DialogSearch {
  placeholder?: string;
  /**
   * Ce que la saisie devient quand elle ne désigne aucune entrée du catalogue :
   * des options composées à la volée. C'est ce qui permet d'avoir **un seul
   * geste** pour « filtrer » et pour « saisir une valeur qui n'est dans aucune
   * liste » — un sous-type de créature, par exemple, dont il existe des
   * centaines et dont la liste bouge à chaque extension.
   *
   * `matches` est le nombre d'entrées du **catalogue** que la saisie retient :
   * proposer une valeur composée alors que la recherche vient de trouver ce
   * qu'on cherchait n'ajoute que du bruit, et l'appelant est seul juge.
   */
  freeform?: (query: string, matches: number) => DialogOption[];
  /**
   * Phrase affichée sous la liste, calculée depuis la saisie et le nombre
   * d'entrées **du catalogue** retenues. C'est là qu'on dit « rien ne
   * correspond », et là qu'on dit pourquoi une recherche est **refusée** — au
   * moment où l'on bute dessus, plutôt qu'en permanence au-dessus de tout le
   * monde.
   */
  note?: (query: string, matches: number) => string | null;
}

export interface DialogField {
  /** Clé sous laquelle la saisie est rendue dans le résultat. */
  name: string;
  label: string;
  /**
   * Choix unique parmi quelques formes, rendu en bandeau de boutons plutôt
   * qu'en `<select>` : les options sont peu nombreuses et toutes lisibles d'un
   * coup d'œil, et l'on voit alors laquelle est retenue sans rien déplier. Le
   * champ n'a pas de saisie libre ; sa valeur est celle de l'option retenue.
   */
  options?: DialogOption[];
  /** Filtre les `options` à la frappe. Sans effet sur un champ sans options. */
  search?: DialogSearch;
  /**
   * Pastilles de couleur offertes au clic, à côté de la saisie. La valeur
   * reste le code hexadécimal : on peut toujours en écrire un autre à la main.
   */
  colors?: string[];
  /**
   * Le champ disparaît quand la fonction rend vrai. Une valeur « aucune » n'a
   * pas de saisie à proposer, et un champ grisé qu'on ne peut pas remplir
   * demande au lecteur de comprendre pourquoi : mieux vaut qu'il s'efface.
   * Un champ masqué n'est pas validé — il ne peut plus être rempli.
   */
  hidden?: (values: Record<string, string>) => boolean;
  /** Le champ n'accepte qu'un nombre, et le dialogue refuse le reste. */
  numeric?: boolean;
  /** Valeur de départ, sauf si la mémoire du dialogue en a une. */
  initial?: string;
  placeholder?: string;
  /** Phrase d'aide sous le champ : dit ce que chaque forme donne. */
  hint?: string;
  /** Le champ peut rester vide — c'est alors une information en moins, pas une erreur. */
  optional?: boolean;
  quick?: DialogQuick[];
  /** Un clic sur une valeur usuelle valide tout de suite, sans passer par Entrée. */
  quickSubmits?: boolean;
  maxLength?: number;
}

/** Une case à cocher : un siège destinataire, typiquement. */
export interface DialogChoice {
  id: string;
  label: string;
  checked?: boolean;
  /** Pastille de couleur à gauche du libellé — la couleur du siège. */
  color?: string;
}

export interface DialogSpec {
  title: string;
  description?: string;
  submitLabel?: string;
  cancelLabel?: string;
  /*
   * Il a existé ici un `readOnly` qui masquait le bouton secondaire, pour un
   * dialogue qui ne faisait que **montrer**. Il a été retiré avec son unique
   * appelant — le détail des mécaniques d'une carte, devenu un panneau ancré
   * (`KeywordPanel`, dans `CardSprite.tsx`).
   *
   * Le retirer plutôt que de le garder « au cas où » est délibéré : masquer le
   * bouton d'annulation ne réglait que le plus visible des symptômes. Ce
   * composant est un dialogue de **saisie** — il accumule des champs typés et ne
   * rend ses valeurs qu'à la validation —, et un contenu en lecture y garde de
   * toute façon un bouton de validation, la consigne « Entrée pour valider » et
   * une modale voilée. Ce qu'il faut à de la lecture, c'est un autre composant,
   * pas une option de plus sur celui-ci.
   */
  fields?: DialogField[];
  choices?: DialogChoice[];
  choicesLabel?: string;
  /** Il faut cocher au moins une case pour valider. */
  requireChoice?: boolean;
  /**
   * Clé de mémoire. Deux ouvertures successives sous la même clé repartent de
   * la dernière saisie validée — c'est tout l'intérêt sur un geste répété.
   */
  memory?: string;
  /** Action destructrice : le bouton de validation vire au rouge. */
  danger?: boolean;
  /** Taille de la modale pour les dialogues riches ou complexes. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full';
  /** Rendu d'un panneau d'aperçu dynamique à droite des champs. */
  preview?: (values: Record<string, string>) => React.ReactNode;
  /** Icône d'en-tête pour renforcer l'identité visuelle. */
  icon?: React.ReactNode;
  /**
   * Une saisie en gouverne une autre.
   *
   * Appelée après chaque modification, avec l'état complet et le nom du champ
   * qui vient de changer ; ce qu'elle rend remplace l'état. C'est ce qui permet
   * de passer de « nombre » à « force / endurance » sans que l'ancienne valeur
   * reste là, illisible dans sa nouvelle forme.
   */
  normalize?: (values: Record<string, string>, changed: string) => Record<string, string>;
}

export interface DialogResult {
  /** Saisies, par `name` de champ. Toujours rognées de leurs espaces. */
  values: Record<string, string>;
  /** Identifiants des cases cochées. */
  chosen: string[];
}

/** Dernières saisies validées, par clé de mémoire, le temps de la session. */
const memory = new Map<string, Record<string, string>>();

/**
 * Le dialogue ouvert, s'il y en a un.
 *
 * Deux dialogues à l'écran en même temps n'auraient aucun sens : le second
 * annule le premier, qui rend `null` à son appelant comme une annulation.
 */
let current: { resolve: (result: DialogResult | null) => void } | null = null;
let root: Root | null = null;

function ensureRoot(): Root {
  if (root) return root;
  const host = document.createElement('div');
  host.id = 'mtg-dialog-root';
  document.body.appendChild(host);
  root = createRoot(host);
  return root;
}

function closeDialog(result: DialogResult | null): void {
  const pending = current;
  current = null;
  root?.render(null);
  pending?.resolve(result);
}

/**
 * Ouvre un dialogue et rend une promesse : les saisies, ou `null` si l'on a
 * annulé (Échap, le bouton « Annuler », ou un clic hors du cadre).
 */
export function openDialog(spec: DialogSpec): Promise<DialogResult | null> {
  // Un dialogue déjà ouvert est annulé, jamais empilé.
  if (current) closeDialog(null);
  return new Promise<DialogResult | null>((resolve) => {
    current = { resolve };
    ensureRoot().render(<Dialog spec={spec} onDone={closeDialog} />);
  });
}

/** Saisie d'un nombre entier, avec des valeurs usuelles au clic. */
export async function askNumber(options: {
  title: string;
  label?: string;
  initial?: number;
  min?: number;
  quick?: number[];
  memory?: string;
  submitLabel?: string;
}): Promise<number | null> {
  const min = options.min ?? 1;
  const result = await openDialog({
    title: options.title,
    submitLabel: options.submitLabel ?? 'Valider',
    memory: options.memory,
    fields: [
      {
        name: 'count',
        label: options.label ?? 'Nombre',
        numeric: true,
        initial: String(options.initial ?? min),
        quick: (options.quick ?? [1, 2, 3, 5]).map((n) => ({ label: String(n), value: String(n) })),
        quickSubmits: true,
      },
    ],
  });
  if (!result) return null;
  const n = Number.parseInt(result.values['count'] ?? '', 10);
  return Number.isFinite(n) && n >= min ? n : null;
}

/** Saisie d'une ligne de texte. */
export async function askText(options: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  memory?: string;
  submitLabel?: string;
  maxLength?: number;
}): Promise<string | null> {
  const result = await openDialog({
    title: options.title,
    submitLabel: options.submitLabel ?? 'Valider',
    memory: options.memory,
    fields: [
      {
        name: 'text',
        label: options.label,
        initial: options.initial ?? '',
        ...(options.placeholder === undefined ? {} : { placeholder: options.placeholder }),
        maxLength: options.maxLength ?? 200,
      },
    ],
  });
  return result ? (result.values['text'] ?? '') : null;
}

/** Confirmation d'un geste irréversible, sans `window.confirm`. */
export async function askConfirm(
  title: string,
  options: { description?: string; submitLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  const result = await openDialog({
    title,
    ...(options.description === undefined ? {} : { description: options.description }),
    submitLabel: options.submitLabel ?? 'Confirmer',
    danger: options.danger ?? true,
  });
  return result !== null;
}

/**
 * Repli de comparaison : minuscules, sans accents, sans ponctuation.
 *
 * Chercher « cimetiere » doit trouver « cimetière », et « Éphémères » doit se
 * trouver en tapant « ephemere ». Personne ne tape les accents dans un champ de
 * recherche, et refuser la saisie sans accent reviendrait à cacher l'entrée.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Un bouton d'option, partagé par le bandeau simple et la liste cherchable. */
function OptionButton({
  option,
  field,
  selected,
  onPick,
  innerRef,
}: {
  option: DialogOption;
  field: string;
  selected: boolean;
  onPick: () => void;
  innerRef?: React.Ref<HTMLButtonElement>;
}): React.ReactElement {
  return (
    <button
      ref={innerRef}
      aria-pressed={selected}
      className={`rounded-lg border px-3 py-1.5 text-left text-xs font-medium transition-all ${
        selected
          ? 'border-sky-500 bg-sky-950/80 text-sky-200 shadow-sm ring-1 ring-sky-500/50'
          : 'border-edge/90 bg-slate-800/90 text-slate-300 hover:border-slate-500 hover:bg-slate-700/80 hover:text-slate-100'
      }`}
      data-test="dialog-option"
      data-field={field}
      data-value={option.value}
      onClick={onPick}
      type="button"
    >
      {option.label}
    </button>
  );
}

/**
 * Liste d'options avec recherche et groupes.
 *
 * Trois partis pris :
 *
 * - **Ce qui est retenu reste affiché**, même si le filtre l'exclut : sinon on
 *   ne sait plus ce qu'on a choisi dès qu'on tape une lettre, et l'on rechoisit
 *   par précaution.
 * - **La liste défile en elle-même**, elle ne pousse pas le dialogue hors de
 *   l'écran. C'était exactement le défaut mesuré.
 * - **La saisie libre arrive en tête**, dans son propre groupe : quand on tape
 *   « humain », ce qu'on veut est ce qu'on vient d'écrire, pas la douzième
 *   entrée du catalogue qui contient un « h ».
 */
function SearchableOptions({
  field,
  options,
  search,
  current,
  onPick,
}: {
  field: DialogField;
  options: DialogOption[];
  search: DialogSearch;
  current: string;
  onPick: (value: string) => void;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const selected = useRef<HTMLButtonElement | null>(null);
  const [kept, setKept] = useState<DialogOption[]>([]);

  const needle = foldForSearch(query);
  const pool = [...options, ...kept];
  const matches =
    needle === ''
      ? pool
      : pool.filter((option) =>
          foldForSearch(`${option.label} ${option.group ?? ''} ${option.keywords ?? ''}`).includes(
            needle,
          ),
        );

  const libres = needle === '' ? [] : (search.freeform?.(query, matches.length) ?? []);
  const connus = new Set(pool.map((o) => o.value));
  const propose = libres.filter((o) => !connus.has(o.value));

  const visiblesMap = new Map<string, DialogOption>();
  for (const o of [...propose, ...matches]) {
    if (!visiblesMap.has(o.value)) visiblesMap.set(o.value, o);
  }
  if (current !== '' && !visiblesMap.has(current)) {
    const retenu = pool.find((o) => o.value === current);
    if (retenu) visiblesMap.set(current, retenu);
  }
  const visibles = [...visiblesMap.values()];

  const groupes: Array<{ nom: string; options: DialogOption[] }> = [];
  for (const option of visibles) {
    const nom = option.group ?? '';
    const dernier = groupes.find((g) => g.nom === nom);
    if (dernier) dernier.options.push(option);
    else groupes.push({ nom, options: [option] });
  }

  const note = search.note?.(query, matches.length) ?? null;

  useEffect(() => {
    selected.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <div className="space-y-1.5" id={`dialog-${field.name}`}>
      <div className="relative">
        <input
          className="w-full rounded-lg bg-slate-900/90 px-3 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-slate-700 focus:ring-2 focus:ring-sky-500 placeholder:text-slate-500 transition-all"
          data-test="dialog-search"
          data-field={field.name}
          maxLength={40}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
          placeholder={search.placeholder ?? 'Rechercher…'}
          type="search"
          value={query}
        />
        {query && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs px-1"
            onClick={() => setQuery('')}
            title="Effacer la recherche"
            type="button"
          >
            ✕
          </button>
        )}
      </div>
      <div className="scrollbar-thin max-h-52 space-y-2 overflow-y-auto pr-1" data-test="dialog-option-list">
        {groupes.map((groupe) => (
          <div key={groupe.nom || '—'} className="space-y-1">
            {groupe.nom !== '' && (
              <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400/90 pt-0.5">{groupe.nom}</p>
            )}
            <div className="flex flex-col gap-1">
              {groupe.options.map((option) => (
                <OptionButton
                  key={option.value}
                  field={field.name}
                  innerRef={current === option.value ? selected : undefined}
                  option={option}
                  onPick={() => {
                    if (!connus.has(option.value)) setKept((k) => [...k, option]);
                    onPick(option.value);
                  }}
                  selected={current === option.value}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {note !== null && (
        <p className="rounded-md bg-amber-950/30 border border-amber-800/40 p-2 text-[11px] leading-snug text-amber-300" data-test="dialog-search-note">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * Le dialogue lui-même. Exporté pour pouvoir être monté à la main dans un
 * test ; l'usage normal passe par `openDialog`.
 */
export function Dialog({
  spec,
  onDone,
}: {
  spec: DialogSpec;
  onDone: (result: DialogResult | null) => void;
}): React.ReactElement {
  const fields = spec.fields ?? [];
  const remembered = spec.memory ? memory.get(spec.memory) : undefined;
  const [values, setValues] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    for (const field of fields) start[field.name] = remembered?.[field.name] ?? field.initial ?? '';
    return start;
  });
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set((spec.choices ?? []).filter((c) => c.checked).map((c) => c.id)),
  );
  const [refused, setRefused] = useState(false);
  const firstInput = fields.find((field) => !field.options && !field.hidden?.(values))?.name;
  const first = useRef<HTMLInputElement | null>(null);
  const submitButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const node = first.current ?? submitButton.current;
    node?.focus();
    if (first.current) first.current.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        onDone(null);
        return;
      }
      if (event.key === 'Enter') {
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDone]);

  const trimmed = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const field of fields) out[field.name] = (values[field.name] ?? '').trim();
    return out;
  };

  const invalid = (given: Record<string, string>): boolean => {
    for (const field of fields) {
      if (field.hidden?.(given)) continue;
      const raw = given[field.name] ?? '';
      if (!raw) {
        if (!field.optional) return true;
        continue;
      }
      if (field.numeric && !Number.isFinite(Number.parseInt(raw, 10))) return true;
    }
    return Boolean(spec.requireChoice) && chosen.size === 0;
  };

  const change = (name: string, value: string): void => {
    setRefused(false);
    setValues((previous) => {
      const next = { ...previous, [name]: value };
      return spec.normalize ? spec.normalize(next, name) : next;
    });
  };

  const submit = (override?: Record<string, string>): void => {
    const given = { ...trimmed(), ...(override ?? {}) };
    if (invalid(given)) {
      setRefused(true);
      return;
    }
    if (spec.memory) memory.set(spec.memory, given);
    onDone({ values: given, chosen: [...chosen] });
  };

  const sizeClass =
    spec.size === 'full'
      ? 'max-w-6xl'
      : spec.size === '3xl'
        ? 'max-w-5xl'
        : spec.size === '2xl'
          ? 'max-w-4xl'
          : spec.size === 'xl'
            ? 'max-w-2xl'
            : spec.size === 'lg'
              ? 'max-w-xl'
              : spec.size === 'md'
                ? 'max-w-md'
                : 'max-w-sm';

  const hasPreview = Boolean(spec.preview);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 sm:p-6"
      data-test="dialog-backdrop"
      onClick={() => onDone(null)}
      onContextMenu={(event) => {
        event.preventDefault();
        onDone(null);
      }}
    >
      <form
        className={`flex max-h-[92vh] w-full ${sizeClass} flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl transition-all duration-200`}
        data-test="dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <header className="flex items-center justify-between shrink-0 border-b border-edge/80 px-5 py-3.5 bg-slate-900/40">
          <div className="flex items-center gap-2.5 min-w-0">
            {spec.icon && <div className="text-slate-300 text-base shrink-0">{spec.icon}</div>}
            <div>
              <h2 className="text-sm font-semibold text-slate-100 tracking-tight" data-test="dialog-title">
                {spec.title}
              </h2>
              {spec.description && (
                <p className="mt-0.5 text-xs leading-snug text-slate-400">{spec.description}</p>
              )}
            </div>
          </div>
          <button
            className="text-slate-400 hover:text-slate-200 rounded-lg p-1 hover:bg-slate-800 transition-colors text-xs"
            onClick={() => onDone(null)}
            title="Fermer (Échap)"
            type="button"
          >
            ✕
          </button>
        </header>

        <div
          className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 ${
            hasPreview ? 'grid grid-cols-1 md:grid-cols-12 gap-6' : 'space-y-4'
          }`}
          data-test="dialog-body"
        >
          <div className={hasPreview ? 'md:col-span-7 space-y-4 min-w-0' : 'space-y-4'}>
            {fields.map((field) => {
              if (field.hidden?.(values)) return null;
              const current = values[field.name] ?? '';
              return (
                <div key={field.name} className="space-y-1.5">
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                    htmlFor={`dialog-${field.name}`}
                  >
                    {field.label}
                  </label>

                  {field.options && field.search ? (
                    <SearchableOptions
                      current={current}
                      field={field}
                      onPick={(value) => change(field.name, value)}
                      options={field.options}
                      search={field.search}
                    />
                  ) : field.options ? (
                    <div className="flex flex-wrap gap-1.5" id={`dialog-${field.name}`}>
                      {field.options.map((option) => (
                        <OptionButton
                          key={option.value}
                          field={field.name}
                          onPick={() => change(field.name, option.value)}
                          option={option}
                          selected={current === option.value}
                        />
                      ))}
                    </div>
                  ) : (
                    <input
                      ref={field.name === firstInput ? first : undefined}
                      className="w-full rounded-lg bg-slate-900/90 px-3 py-1.5 text-sm text-slate-100 outline-none ring-1 ring-slate-700 focus:ring-2 focus:ring-sky-500 transition-all placeholder:text-slate-500"
                      data-test={`dialog-field-${field.name}`}
                      id={`dialog-${field.name}`}
                      inputMode={field.numeric ? 'numeric' : undefined}
                      maxLength={field.maxLength ?? (field.numeric ? 6 : 200)}
                      onChange={(event) => change(field.name, event.target.value)}
                      placeholder={field.placeholder ?? ''}
                      value={current}
                    />
                  )}

                  {field.colors && field.colors.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {field.colors.map((color) => (
                        <button
                          key={color}
                          aria-label={color}
                          className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ring-1 ${
                            current.toLowerCase() === color.toLowerCase()
                              ? 'ring-2 ring-white scale-105 shadow-md'
                              : 'ring-white/30 hover:ring-white/70'
                          }`}
                          data-test="dialog-color"
                          data-field={field.name}
                          data-value={color}
                          onClick={() => change(field.name, color)}
                          style={{ background: color }}
                          type="button"
                        />
                      ))}
                    </div>
                  )}

                  {field.quick && field.quick.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {field.quick.map((quick) => (
                        <button
                          key={`${field.name}-${quick.value}-${quick.label}`}
                          className="rounded-md border border-edge/80 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:bg-slate-700 hover:text-slate-100 transition-all"
                          data-test="dialog-quick"
                          data-field={field.name}
                          data-value={quick.value}
                          onClick={() => {
                            change(field.name, quick.value);
                            if (field.quickSubmits) submit({ [field.name]: quick.value });
                          }}
                          type="button"
                        >
                          {quick.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {field.hint && <p className="text-[11px] leading-snug text-slate-400/90 pt-0.5">{field.hint}</p>}
                </div>
              );
            })}

            {spec.choices && spec.choices.length > 0 && (
              <fieldset className="space-y-1.5 pt-1">
                {spec.choicesLabel && (
                  <legend className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {spec.choicesLabel}
                  </legend>
                )}
                <div className="space-y-1">
                  {spec.choices.map((choice) => (
                    <label
                      key={choice.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 hover:bg-slate-800/70 border border-transparent hover:border-edge/60 transition-all"
                    >
                      <input
                        checked={chosen.has(choice.id)}
                        className="h-4 w-4 accent-sky-500 rounded"
                        data-test={`dialog-check-${choice.id}`}
                        onChange={(event) => {
                          setRefused(false);
                          setChosen((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(choice.id);
                            else next.delete(choice.id);
                            return next;
                          });
                        }}
                        type="checkbox"
                      />
                      {choice.color && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/20"
                          style={{ background: choice.color }}
                        />
                      )}
                      <span className="truncate">{choice.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {refused && (
              <p className="rounded-md bg-rose-950/40 border border-rose-800/50 p-2.5 text-xs text-rose-300" data-test="dialog-error">
                {spec.requireChoice && chosen.size === 0
                  ? 'Choisissez au moins un destinataire.'
                  : 'Saisie incomplète.'}
              </p>
            )}
          </div>

          {hasPreview && (
            <aside className="md:col-span-5 border-t md:border-t-0 md:border-l border-edge/60 md:pl-6 pt-4 md:pt-0 min-w-0 flex flex-col gap-3">
              {spec.preview!(values)}
            </aside>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-edge/80 px-5 py-3 bg-slate-900/40">
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            Appuyez sur <kbd className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 border border-slate-700">Entrée</kbd> pour valider ou <kbd className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 border border-slate-700">Échap</kbd> pour fermer
          </span>
          <div className="flex items-center gap-2.5 ml-auto">
            <button
              className="rounded-lg border border-edge/80 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-all"
              data-test="dialog-cancel"
              onClick={() => onDone(null)}
              type="button"
            >
              {spec.cancelLabel ?? 'Annuler'}
            </button>
            <button
              ref={submitButton}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-white shadow-md transition-all active:scale-[0.98] ${
                spec.danger
                  ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-950/40'
                  : 'bg-sky-600 hover:bg-sky-500 shadow-sky-950/40'
              }`}
              data-test="dialog-submit"
              type="submit"
            >
              {spec.submitLabel ?? 'Valider'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
