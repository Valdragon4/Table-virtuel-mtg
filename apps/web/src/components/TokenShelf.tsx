/**
 * Étagère à jetons : une palette d'impressions, pas une zone de jeu.
 *
 * Cliquer un jeton en pose un sur son propre champ de bataille ; le glisser
 * permet de choisir l'endroit. Dans les deux cas, un seul intent part :
 * `CREATE_TOKEN`. L'étagère elle-même ne contient aucun objet de partie, et le
 * serveur ignore jusqu'à son existence.
 */
import { useEffect, useState } from 'react';
import { useGame } from '../store/game.js';
import { scryfallImage } from '../lib/cards.js';
import { localizedCard, localizedCardName, useLocalizationTick } from '../lib/cardLocalization.js';
import { resolveCardImage, tokenName } from '../lib/i18n/index.js';
import { useLanguage } from '../store/prefs.js';
import { findDropTarget } from '../lib/drag.js';
import { loadShelf, saveShelf, type ShelfToken } from '../lib/shelf.js';
import { TokenNameBand } from './TokenNameBand.js';

/** Position de repli quand on clique sans viser. */
const DEFAULT_DROP = { x: 60, y: 60 };

let refresh: (() => void) | null = null;

/**
 * Ajoute un jeton à l'étagère depuis ailleurs (le menu contextuel d'un jeton).
 * Renvoie `false` si l'impression y était déjà.
 */
export async function shelveToken(token: ShelfToken): Promise<boolean> {
  const items = await loadShelf();
  if (items.some((item) => item.scryfallId === token.scryfallId)) return false;
  await saveShelf([...items, token]);
  refresh?.();
  return true;
}

export function TokenShelf({ onSearch }: { onSearch: () => void }): React.ReactElement | null {
  const send = useGame((s) => s.send);
  const hoverPreview = useGame((s) => s.hoverPreview);
  const mySeat = useGame((s) => s.mySeat);
  const viewScale = useGame((s) => s.viewScale);
  const [items, setItems] = useState<ShelfToken[] | null>(null);
  const [open, setOpen] = useState(true);
  /*
   * L'étagère ne garde qu'un identifiant et le nom du catalogue — c'est lui qui
   * distingue deux impressions dans le stockage, et il n'a pas à bouger avec la
   * langue. Seuls la vignette et l'infobulle passent au français.
   *
   * C'est exactement pourquoi le glossaire des jetons ne s'applique qu'au
   * **rendu** : `token.name`, tel que `saveShelf` l'écrit, reste anglais. Y
   * figer « Soldat » rendrait l'étagère illisible au premier passage en anglais,
   * et un doublon invisible au suivant.
   */
  useLocalizationTick();
  const language = useLanguage();

  useEffect(() => {
    let alive = true;
    const reload = (): void => {
      void loadShelf().then((loaded) => {
        if (alive) setItems(loaded);
      });
    };
    refresh = reload;
    reload();
    return () => {
      alive = false;
      if (refresh === reload) refresh = null;
    };
  }, []);

  // L'étagère peut disparaître sous le curseur (on quitte la table) : l'aperçu
  // qu'elle a armé ne doit pas lui survivre.
  useEffect(() => () => hoverPreview(null), [hoverPreview]);

  if (!mySeat || items === null) return null;

  function create(token: ShelfToken, at: { x: number; y: number }): void {
    send({ type: 'CREATE_TOKEN', scryfallId: token.scryfallId, x: at.x, y: at.y });
  }

  /**
   * Glissement depuis l'étagère. On ne passe pas par la couche de glissement de
   * la table : il n'y a pas d'objet de jeu à traîner, seulement une intention de
   * création. On ne crée que sur **son propre** champ de bataille, puisque les
   * coordonnées d'un `CREATE_TOKEN` sont celles du siège qui le demande.
   */
  function onItemPointerDown(token: ShelfToken, event: React.PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY };

    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);

      const moved = Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 4;
      if (!moved) return create(token, DEFAULT_DROP);

      const target = findDropTarget(e.clientX, e.clientY, viewScale);
      if (!target || target.zone.kind !== 'BATTLEFIELD' || target.zone.seat !== mySeat) return;
      create(token, { x: target.x, y: target.y });
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /**
   * Déplace un jeton d'un cran dans l'étagère.
   *
   * Deux flèches, et non un glisser-déposer : **le glissement est déjà pris**
   * — il sert à poser le jeton sur la table, ce qui est le geste courant. Lui
   * superposer un réordonnancement obligerait à distinguer les deux à la
   * distance ou à la direction, et l'on se tromperait une fois sur deux. Les
   * flèches n'apparaissent qu'au survol, comme la croix de retrait.
   */
  async function move(scryfallId: string, direction: -1 | 1): Promise<void> {
    const list = [...items!];
    const from = list.findIndex((item) => item.scryfallId === scryfallId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to]!, list[from]!];
    setItems(list);
    await saveShelf(list);
  }

  async function remove(scryfallId: string): Promise<void> {
    const next = items!.filter((item) => item.scryfallId !== scryfallId);
    setItems(next);
    await saveShelf(next);
  }

  return (
    <div
      className="pointer-events-auto w-60 rounded-xl border border-slate-700 bg-slate-900/90 text-sm shadow-xl backdrop-blur-md overflow-hidden"
      data-test="token-shelf"
    >
      <header className="flex items-center justify-between border-b border-slate-800/90 px-3.5 py-2 text-xs bg-slate-950/40">
        <button className="font-bold uppercase tracking-wider text-slate-300 text-[10px] hover:text-white transition-colors flex items-center gap-1.5" onClick={() => setOpen((v) => !v)}>
          <span>Étagère à jetons</span>
          <span className="text-slate-400 text-xs">{open ? '▾' : '▸'}</span>
        </button>
        <button
          className="rounded-md bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-white px-2 py-0.5 text-xs font-bold border border-slate-700 transition-colors"
          onClick={onSearch}
          data-test="token-search"
          title="Chercher un jeton (+)"
        >
          +
        </button>
      </header>

      {open && (
        <div className="grid grid-cols-3 gap-2 p-2.5">
          {items.length === 0 && (
            <p className="col-span-3 py-2 text-center text-[11px] text-slate-500">
              Vide. Clic droit sur un jeton en jeu pour l'y ranger.
            </p>
          )}
          {items.map((token, index) => {
            const localized = localizedCard(token.scryfallId, language);
            const src =
              resolveCardImage({
                card: { scryfallId: token.scryfallId },
                localized,
                language,
                version: 'normal',
              }).url ?? scryfallImage(token.scryfallId, 'normal');
            const shownName =
              tokenName(localizedCardName(localized, token.name), language) ?? token.name;
            return (
            <div key={token.scryfallId} className="group relative">
              <button
                /* `relative` : le bandeau de nom se colle au bord bas de la
                   vignette, et `overflow-hidden` lui rend l'arrondi du cadre. */
                className="relative block w-full overflow-hidden rounded-lg ring-1 ring-white/10 hover:ring-2 hover:ring-sky-400 shadow-md transition-all active:scale-95"
                data-test="shelf-token"
                data-token={token.scryfallId}
                /* Une vignette d'étagère est une impression, pas un objet de
                   partie : l'aperçu passe par le chemin `scryfallId`. */
                onPointerEnter={() => hoverPreview(token.scryfallId)}
                onPointerLeave={() => hoverPreview(null)}
                onPointerDown={(event) => onItemPointerDown(token, event)}
                title={`${shownName} — cliquer pour en créer un, glisser pour le placer`}
                type="button"
              >
                <img
                  alt={shownName}
                  className="block w-full object-cover"
                  draggable={false}
                  /* URL Scryfall, comme partout : jamais via notre serveur, et
                     rien n'est préchargé ni mis en cache ici. */
                  src={src}
                />
                {/*
                  Le nom français, écrit par-dessus l'illustration — qui, elle,
                  restera anglaise : Scryfall ne publie aucun jeton traduit. Il
                  était jusqu'ici calculé pour n'aller que dans `title` et
                  `alt`, c'est-à-dire nulle part pour qui regarde l'étagère.
                  Une vignette d'étagère est **par construction** un jeton dont
                  on connaît l'impression : il n'y a pas de face cachée ici, et
                  rien à protéger.
                */}
                <TokenNameBand fontSize={9} name={shownName} />
              </button>
              <button
                className="absolute -right-1 -top-1 hidden h-4 w-4 rounded-full bg-slate-900 text-[10px] leading-4 text-slate-300 ring-1 ring-white/20 group-hover:block"
                data-test="shelf-remove"
                onClick={() => void remove(token.scryfallId)}
                title="Retirer de l'étagère"
                type="button"
              >
                ×
              </button>
              {/* Ranger l'étagère : un cran à gauche, un cran à droite. */}
              <div className="absolute inset-x-0 bottom-0 hidden justify-between group-hover:flex">
                <button
                  className="h-4 w-4 rounded-tr bg-slate-900/90 text-[10px] leading-4 text-slate-300 ring-1 ring-white/20 disabled:opacity-30"
                  data-test="shelf-left"
                  disabled={index === 0}
                  onClick={() => void move(token.scryfallId, -1)}
                  title="Déplacer vers la gauche"
                  type="button"
                >
                  &lsaquo;
                </button>
                <button
                  className="h-4 w-4 rounded-tl bg-slate-900/90 text-[10px] leading-4 text-slate-300 ring-1 ring-white/20 disabled:opacity-30"
                  data-test="shelf-right"
                  disabled={index === items.length - 1}
                  onClick={() => void move(token.scryfallId, 1)}
                  title="Déplacer vers la droite"
                  type="button"
                >
                  &rsaquo;
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
