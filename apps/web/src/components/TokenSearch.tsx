import { useEffect, useState } from 'react';
import { api, type CardMeta } from '../lib/api.js';
import { scryfallImage } from '../lib/cards.js';
import { localizedCard, localizedCardName, useLocalizationTick } from '../lib/cardLocalization.js';
import { isTokenTypeLine, resolveCardImage, tokenName, tokenQueryAliases } from '../lib/i18n/index.js';
import { foldForSearch } from './Dialog.js';
import { useGame } from '../store/game.js';
import { useLanguage } from '../store/prefs.js';
import { useCloseOnEscape } from '../lib/overlay.js';

/**
 * Recherche de jeton ou de carte, servie par la base locale — jamais par Scryfall.
 *
 * **Ce qu'on tape interroge le catalogue anglais.** `/api/cards/search` ne
 * connaît que les noms du bulk que nous ingérons : la saisie part telle quelle,
 * sans être traduite ni repliée. Seul l'**affichage** du résultat passe au nom
 * imprimé — traduire la clé de recherche rendrait « Spirit » introuvable.
 *
 * **Ce qui a été ajouté, et qui ne contredit pas la phrase ci-dessus.** Quand la
 * saisie est un terme français du glossaire des jetons, une ou deux recherches
 * **supplémentaires** partent avec l'équivalent anglais, et leurs résultats sont
 * fusionnés derrière ceux de la saisie brute. « Soldat » trouve alors son jeton,
 * « Soldier » aussi, et la clé de recherche reste le nom du catalogue.
 */
/** Les couleurs d'un jeton, dites en français comme à une table. */
const COLOR_NAMES: Record<string, string> = {
  W: 'blanc',
  U: 'bleu',
  B: 'noir',
  R: 'rouge',
  G: 'vert',
};

function colorLabel(colors: readonly string[]): string {
  if (colors.length === 0) return 'incolore';
  return colors.map((c) => COLOR_NAMES[c] ?? c).join('-');
}

export function TokenSearch({
  onClose,
  at,
}: {
  onClose: () => void;
  /**
   * Où poser le jeton, en coordonnées du champ de bataille du créateur. Fourni
   * quand la recherche a été ouverte depuis un point précis de la table ;
   * sinon, place par défaut.
   */
  at?: { x: number; y: number } | null;
}): React.ReactElement {
  const send = useGame((s) => s.send);
  const hoverPreview = useGame((s) => s.hoverPreview);
  useCloseOnEscape(onClose);
  useLocalizationTick();
  const language = useLanguage();
  const [query, setQuery] = useState('');
  const [tokensOnly, setTokensOnly] = useState(true);
  const [results, setResults] = useState<CardMeta[]>([]);
  const [count, setCount] = useState(1);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let annule = false;
    const timer = window.setTimeout(() => {
      const chercher = (url: string): Promise<CardMeta[]> =>
        api
          .get<{ results: CardMeta[] }>(url)
          .then((r) => r.results)
          .catch(() => []);

      /*
       * **La saisie brute part la première, et telle quelle.** C'est le chemin
       * historique et il ne bouge pas : `/api/cards/search` ne connaît que les
       * noms du catalogue anglais, donc traduire la requête rendrait « Spirit »
       * introuvable — or les listes de deck et les cartes physiques sont en
       * anglais.
       *
       * Les requêtes qui suivent viennent **en plus**, et seulement quand la
       * saisie ressemble à un terme français du glossaire : « Soldat » doit
       * trouver son jeton comme « Soldier ». Elles sont peu nombreuses par
       * construction (`tokenQueryAliases` en borne le nombre), et ne partent
       * que pour les jetons — le glossaire ne dit rien des cartes.
       */
      const brute = chercher(
        `/api/cards/search?q=${encodeURIComponent(query)}&type=${tokensOnly ? 'token' : 'card'}`,
      );
      const alias = tokensOnly ? tokenQueryAliases(query, foldForSearch) : [];
      const supplements = alias.map((nom) =>
        chercher(`/api/cards/search?q=${encodeURIComponent(nom)}&type=token`),
      );
      void Promise.all([brute, ...supplements]).then((lots) => {
        if (annule) return;
        /*
         * Fusion par identifiant, dans l'ordre d'arrivée des lots : ce que la
         * saisie brute a trouvé reste en tête. Un jeton peut répondre aux deux
         * recherches — « Elf » et « Elfe » — et ne doit apparaître qu'une fois.
         */
        const vus = new Set<string>();
        const fusion: CardMeta[] = [];
        for (const lot of lots) {
          for (const card of lot) {
            if (vus.has(card.scryfallId)) continue;
            vus.add(card.scryfallId);
            fusion.push(card);
          }
        }
        setResults(fusion);
      });
    }, 180);
    return () => {
      annule = true;
      window.clearTimeout(timer);
    };
  }, [query, tokensOnly]);

  /*
   * La fermeture emporte l'aperçu. Sans cela, il survivrait à la modale : la
   * souris quitte la vignette au moment même où celle-ci disparaît, donc aucun
   * `pointerleave` ne part, et l'on garderait à l'écran l'agrandissement d'un
   * jeton qu'on ne voit plus nulle part.
   */
  useEffect(() => () => hoverPreview(null), [hoverPreview]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/70 p-10" onClick={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-lg border border-edge bg-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-edge p-3">
          <input
            autoFocus
            className="flex-1 rounded border border-edge bg-table px-3 py-2 text-sm"
            placeholder="Nom du jeton ou de la carte…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input checked={tokensOnly} type="checkbox" onChange={(e) => setTokensOnly(e.target.checked)} />
            Jetons seuls
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-400">
            ×
            <input
              className="w-12 rounded border border-edge bg-table px-1 py-1"
              max={64}
              min={1}
              type="number"
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(64, Number(e.target.value))))}
            />
          </label>
        </div>

        <div className="scrollbar-thin grid max-h-[55vh] grid-cols-4 gap-3 overflow-y-auto p-3 sm:grid-cols-5">
          {results.map((card) => {
            const localized = localizedCard(card.scryfallId, language);
            const src =
              resolveCardImage({ card, localized, language, version: 'small' }).url ??
              scryfallImage(card.scryfallId, 'small');
            /*
             * Le glossaire ne s'applique qu'à ce qui est **certainement** un
             * jeton : la case décochée rend des cartes ordinaires, dont le nom
             * vient de la résolution localisée et ne nous appartient pas. Dans
             * le doute — ligne de type pas encore lue —, l'anglais.
             */
            const estJeton = tokensOnly || isTokenTypeLine(card.typeLine);
            const localise = localizedCardName(localized, card.name);
            const shownName =
              (estJeton ? tokenName(localise, language) : localise) ?? card.name;
            return (
            <button
              key={card.scryfallId}
              className="group text-left"
              data-test="token-result"
              data-token={card.scryfallId}
              /*
                Un résultat de recherche n'est pas un objet de partie : il n'a
                qu'un `scryfallId`. C'est exactement ce que demande l'aperçu
                d'impression — on ne lui invente pas d'identité de jeu.
              */
              onPointerEnter={() => hoverPreview(card.scryfallId)}
              onPointerLeave={() => hoverPreview(null)}
              onClick={() => {
                hoverPreview(null);
                send({
                  type: 'CREATE_TOKEN',
                  scryfallId: card.scryfallId,
                  count,
                  x: at?.x ?? 40,
                  y: at?.y ?? 40,
                });
                onClose();
              }}
            >
              <img
                alt={shownName}
                className="w-full rounded ring-1 ring-transparent transition group-hover:ring-sky-500"
                loading="lazy"
                src={src}
              />
              {/*
                Le nom seul ne suffit pas à choisir : il existe seize « Spirit »
                différents. On affiche donc ce qui les sépare — la taille et la
                couleur — sans quoi l'utilisateur doit deviner à la vignette.
              */}
              <p className="mt-1 truncate text-[11px] text-slate-300">{shownName}</p>
              <p className="truncate text-[10px] text-slate-500">
                {[
                  card.power !== null && card.toughness !== null
                    ? `${card.power}/${card.toughness}`
                    : null,
                  colorLabel(card.colors ?? []),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </button>
            );
          })}
          {query.trim().length >= 2 && results.length === 0 && (
            <p className="col-span-full py-6 text-center text-sm text-slate-500">Aucun résultat.</p>
          )}
        </div>
      </div>
    </div>
  );
}
