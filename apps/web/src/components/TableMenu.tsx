/**
 * Menu contextuel du fond de table.
 *
 * Il ne s'ouvre que si rien de plus spécifique n'a intercepté le clic droit :
 * une carte ouvre son menu, une pile le sien, et tous deux arrêtent la
 * propagation. Ce menu-ci est le dernier recours, celui des gestes qui n'ont pas
 * de cible.
 *
 * Il retient **le point cliqué**. Une étiquette se pose là où on a cliqué, et un
 * jeton aussi — à ceci près qu'un jeton naît toujours sur le champ de bataille
 * de son créateur : si le clic tombe ailleurs, on le place à un endroit
 * raisonnable de son propre terrain plutôt que hors cadre.
 */
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store/game.js';
import { useMenuPlacement } from '../lib/menu.js';

/**
 * Dernières saisies, gardées le temps de la session.
 *
 * Une étiquette et un compteur se reposent souvent à l'identique — « bloqué »,
 * « X/X », « orages ». `window.prompt` ne garde rien, et il faut retaper à
 * chaque fois ; un champ que l'on préremplit avec la dernière valeur coûte
 * alors une frappe : Entrée.
 */
const lastEntry = { label: '', counter: '', value: '1/1' };

export interface TableMenuTarget {
  /** Point cliqué, en pixels écran. */
  x: number;
  y: number;
  /** Le même point dans le repère du monde partagé, pour une étiquette. */
  worldX: number;
  worldY: number;
  /**
   * Le même point dans le repère du champ de bataille local, quand le clic y
   * est tombé. `null` sinon — un jeton ira alors à sa place par défaut.
   */
  local: { x: number; y: number } | null;
}

/** Repli quand le clic n'est pas sur son propre terrain. */
const DEFAULT_TOKEN_SPOT = { x: 60, y: 60 };

export function TableMenu({
  target,
  onClose,
  onCreateToken,
  onOpenCounters,
}: {
  target: TableMenuTarget;
  onClose: () => void;
  onCreateToken: (at: { x: number; y: number }) => void;
  onOpenCounters: () => void;
}): React.ReactElement | null {
  const send = useGame((s) => s.send);
  const mySeat = useGame((s) => s.mySeat);
  const { ref, style } = useMenuPlacement(target.x, target.y);
  /**
   * Saisie en place, plutôt qu'un `window.prompt`. La modale native bloque la
   * page, ne garde aucune mémoire, ne se style pas et ne se teste qu'en
   * détournant `window.prompt` — trois raisons de ne pas s'en servir pour le
   * geste le plus courant du menu.
   */
  const [form, setForm] = useState<'LABEL' | 'COUNTER' | null>(null);
  const [draft, setDraft] = useState('');
  /**
   * La valeur du marqueur, en texte libre.
   *
   * Vide, le marqueur est un **mot-clé** : « vol », « menace » — juste le mot,
   * sans nombre à côté. C'est ce qui manquait le plus : un compteur affichait
   * forcément un « 1 » ou un « 2 » qui ne voulait rien dire.
   * « 3 » en fait un compteur à un chiffre ; « 1/1 » une force et une
   * endurance, chacune réglable de son côté.
   */
  const [value, setValue] = useState('');

  if (!mySeat) return null;

  const spot = target.local ?? DEFAULT_TOKEN_SPOT;

  const entries: Array<{ label: string; run: () => void; separatorBefore?: boolean; keepOpen?: boolean }> = [
    {
      label: 'Créer un jeton…',
      run: () => onCreateToken(spot),
    },
    {
      label: 'Poser une étiquette ici…',
      keepOpen: true,
      run: () => {
        setDraft(lastEntry.label);
        setForm('LABEL');
      },
    },
    {
      /*
       * Marqueur libre : une étiquette portant une valeur. Il se pose là où on
       * a cliqué, se déplace, s'accroche à une carte — et sa valeur décide de
       * ce qu'il est : rien du tout pour un mot-clé, un nombre pour un
       * compteur, « 1/1 » pour une force et une endurance réglables chacune de
       * son côté.
       */
      label: 'Poser un marqueur ici…',
      keepOpen: true,
      run: () => {
        setDraft(lastEntry.counter);
        setValue(lastEntry.value);
        setForm('COUNTER');
      },
    },
    {
      label: 'Compteurs de joueur…',
      run: () => onOpenCounters(),
    },
    { label: 'Piocher une carte', separatorBefore: true, run: () => send({ type: 'DRAW', count: 1 }) },
    { label: 'Tout dégager', run: () => send({ type: 'UNTAP_ALL' }) },
    {
      label: 'Mélanger la bibliothèque',
      run: () => send({ type: 'SHUFFLE', zone: { seat: mySeat, kind: 'LIBRARY' } }),
    },
    { label: 'Passer le tour', run: () => send({ type: 'END_TURN' }) },
  ];

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
        className="scrollbar-thin fixed z-50 w-60 rounded border border-edge bg-panel py-1 shadow-xl"
        data-test="table-menu"
        style={style}
      >
        {form ? (
          <form
            className="flex flex-col gap-2 px-3 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              const marker = value.trim();
              // Un marqueur « 1/1 » se suffit : lui imposer un nom obligerait à
              // écrire deux fois la même chose. Ce qu'on refuse, c'est le vide
              // complet — une étiquette sans texte ni valeur ne s'affiche pas.
              if (!text && !(form === 'COUNTER' && marker)) return onClose();
              // L'étiquette vit dans le monde partagé : ce sont bien les
              // coordonnées de monde qu'on envoie, pas des pixels d'écran.
              send({
                type: 'ADD_LABEL',
                text,
                x: target.worldX,
                y: target.worldY,
                // Une valeur vide n'est pas « zéro » : c'est **pas de valeur**,
                // donc un mot-clé sans nombre à côté.
                ...(form === 'COUNTER' && marker ? { value: marker } : {}),
              });
              if (form === 'COUNTER') {
                lastEntry.counter = text;
                lastEntry.value = marker;
              } else lastEntry.label = text;
              onClose();
            }}
          >
            <label className="text-[11px] uppercase tracking-wide text-slate-500" htmlFor="table-menu-entry">
              {form === 'COUNTER' ? 'Nom du marqueur (facultatif)' : 'Texte de l’étiquette'}
            </label>
            <input
              autoFocus
              className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none ring-1 ring-sky-600"
              data-test="table-menu-input"
              id="table-menu-entry"
              maxLength={200}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onClose();
              }}
              value={draft}
            />
            {form === 'COUNTER' && (
              <>
                <label
                  className="text-[11px] uppercase tracking-wide text-slate-500"
                  htmlFor="table-menu-value"
                >
                  Valeur
                </label>
                <input
                  className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none ring-1 ring-slate-600 focus:ring-sky-600"
                  data-test="table-menu-value"
                  id="table-menu-value"
                  maxLength={24}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') onClose();
                  }}
                  placeholder="1/1, 3, ou rien"
                  value={value}
                />
                {/* On dit ce que chaque forme donne : sans cela, « laisser vide »
                    ne vient à l'idée de personne. */}
                <p className="text-[11px] leading-snug text-slate-500">
                  <strong className="text-slate-400">1/1</strong> : force et endurance, chacune
                  réglable de son côté. <strong className="text-slate-400">3</strong> : un compteur
                  à un chiffre. <strong className="text-slate-400">Vide</strong> : un mot-clé, sans
                  nombre à côté.
                </p>
              </>
            )}

            <div className="flex justify-end gap-2">
              <button
                className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                onClick={onClose}
                type="button"
              >
                Annuler
              </button>
              <button className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white" type="submit">
                Poser
              </button>
            </div>
          </form>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.label}
              className={`block w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800 ${
                entry.separatorBefore ? 'mt-1 border-t border-edge/60 pt-2' : ''
              }`}
              onClick={() => {
                entry.run();
                if (!entry.keepOpen) onClose();
              }}
            >
              {entry.label}
            </button>
          ))
        )}
      </div>
    </>
  );
}
