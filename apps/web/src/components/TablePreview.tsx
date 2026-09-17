/**
 * La preuve du premier écran : la table elle-même, en miniature.
 *
 * Ce n'est pas une capture. C'est le même vocabulaire que la vraie table —
 * panneau de siège liseré à la couleur du joueur, bandeau d'identité, colonne
 * de zones, journal d'actions — rendu en DOM, aux couleurs relevées dans
 * `docs/ui-reference.md`. Les cartes visibles sont de vraies cartes : leurs
 * noms viennent de notre index (`GET /api/cards/search`) et leurs images sont
 * allées les chercher **chez Scryfall depuis le navigateur du visiteur**, comme
 * partout ailleurs dans ce projet. Rien n'est hébergé ni proxifié ici.
 *
 * Les joueurs de la scène sont **anonymes** — « Joueur 1 », « Joueur 2 ». Cette
 * table est une vitrine publique : aucun pseudo réel n'y a sa place.
 *
 * Le moment montré est cohérent avec le journal affiché à côté : Fabled Passage
 * est tapé, une Forest vient d'arriver de la bibliothèque, un token Pest est né.
 * Si l'index ne répond pas, la table se rend quand même, avec des dos de carte
 * que nous dessinons nous-mêmes.
 *
 * Elle ne rétrécit pas en étroit, elle se recadre : le cadre devient portrait
 * et les trois panneaux se posent l'un sous l'autre.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { scryfallImage } from '../lib/cards.js';

interface Hit {
  scryfallId: string;
  name: string;
}

/**
 * La scène. Rangée haute : ce qui attaque et ce qui produit. Rangée basse : les
 * terrains, comme le veut la convention de table.
 */
const TOP = [
  { query: 'Llanowar Elves', tapped: false },
  { query: 'Solemn Simulacrum', tapped: false },
] as const;

const BOTTOM = [
  { query: 'Fabled Passage', tapped: true },
  { query: 'Forest', tapped: false },
  { query: 'Command Tower', tapped: false },
] as const;

const SCENE = [...TOP, ...BOTTOM];

async function lookup(query: string): Promise<Hit | null> {
  const res = await api.get<{ results: Hit[] }>(
    `/api/cards/search?q=${encodeURIComponent(query)}&type=card&limit=1`,
  );
  return res.results[0] ?? null;
}

export function TablePreview(): React.ReactElement {
  const [cards, setCards] = useState<Record<string, Hit | null>>({});

  useEffect(() => {
    let alive = true;
    void Promise.all(
      SCENE.map((entry) =>
        lookup(entry.query)
          .catch(() => null)
          .then((hit) => [entry.query, hit] as const),
      ),
    ).then((pairs) => {
      if (alive) setCards(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <figure className="m-0">
      <div
        aria-hidden="true"
        className="table-preview relative w-full overflow-hidden rounded-[10px] border border-edge bg-table shadow-[0_26px_60px_-24px_rgba(0,0,0,0.85)]"
      >
        <Scenery />

        {/* Journal d'actions — colonne gauche, comme sur la table. */}
        <div className="absolute left-[4%] top-[3.5%] w-[54%] rounded border border-edge bg-panel/90 p-[3%] text-[0.63rem] leading-[1.45] text-slate-400 sm:w-[36%] sm:text-[0.68rem]">
          <p className="mb-[4%] border-b border-edge pb-[3%] text-[0.82em] uppercase tracking-wider text-slate-500">
            Journal
          </p>
          <p className="mb-[3%]">
            <span className="font-semibold text-sky-400">Joueur 1</span> tapped{' '}
            <span className="text-amber-300">Fabled Passage</span>
          </p>
          <p className="mb-[3%]">
            <span className="font-semibold text-sky-400">Joueur 1</span> moved{' '}
            <span className="text-amber-300">Forest</span> from library to battlefield
          </p>
          {/* La dernière ligne vient d'arriver : c'est le seul mouvement de la
              page, et il sert la démonstration — la table travaille. */}
          <p className="log-arriving">
            <span className="font-semibold text-emerald-400">Joueur 2</span> created a{' '}
            <span className="text-amber-300">Pest</span> token
          </p>
        </div>

        {/* Panneau joueur — ancré à droite, compteurs seuls : le contenu de la
            bibliothèque n'est jamais transmis, seulement son compte. */}
        <div className="absolute right-[4%] top-[3.5%] w-[36%] rounded border border-edge bg-panel/90 p-[3%] text-[0.63rem] text-slate-400 sm:w-[24%] sm:text-[0.68rem]">
          <div className="mb-[6%] flex items-center justify-between">
            <span className="text-[#dc2626]">−</span>
            <span className="typed text-[1.8em] font-bold leading-none text-slate-100">37</span>
            <span className="text-[#16a34a]">+</span>
          </div>
          <div className="flex justify-between border-t border-edge pt-[5%]">
            <span>Library</span>
            <span className="typed text-slate-300">89</span>
          </div>
          <div className="flex justify-between">
            <span>Graveyard</span>
            <span className="typed text-slate-300">3</span>
          </div>
          <div className="flex justify-between">
            <span>Exile</span>
            <span className="typed text-slate-300">0</span>
          </div>
        </div>

        {/* Le panneau de siège : liseré à la couleur du siège, bandeau
            d'identité, deux rangées de permanents. */}
        <div className="absolute bottom-[4%] left-[6%] right-[6%] rounded-md border-2 border-sky-500/70 bg-[#161d2b]/85 p-[2.4%] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.8)]">
          <div className="mb-[2.5%] flex items-center gap-[1.6%] text-[0.63rem] text-slate-400 sm:text-[0.68rem]">
            <span className="inline-block h-[0.5em] w-[0.5em] rounded-full bg-sky-400" />
            <span className="font-semibold text-slate-200">Joueur 1</span>
            <span className="typed ml-auto text-slate-500">main 7</span>
          </div>

          <div className="flex items-end gap-[2%]">
            {TOP.map((entry) => (
              <MiniCard card={cards[entry.query] ?? null} key={entry.query} tapped={entry.tapped} />
            ))}
            <PestToken />
          </div>

          <div className="mt-[2.5%] flex items-end gap-[2%]">
            {BOTTOM.map((entry) => (
              <MiniCard card={cards[entry.query] ?? null} key={entry.query} tapped={entry.tapped} />
            ))}
          </div>
        </div>
      </div>

      <figcaption className="mt-3 text-[0.8rem] leading-relaxed text-[color:var(--site-floor-dim)]">
        La table, telle qu’elle est. Les images de cartes sont allées les chercher chez Scryfall
        depuis votre navigateur — ce serveur n’en héberge aucune.
      </figcaption>
    </figure>
  );
}

/**
 * Le décor de table, résumé.
 *
 * La vraie table est posée sur un paysage d'aube dessiné (`TableBackground.tsx`,
 * relevé dans `docs/ui-reference.md`) : horizon bas, astre dans un col de la
 * ligne de crête, escalier de terrasses, et un halo d'étouffement sous la
 * grille des sièges pour que les cartes restent lisibles. On en reprend ici la
 * composition et les valeurs exactes, en quelques chemins. Rien n'est emprunté :
 * ces crêtes sont dessinées à la main pour cette vignette.
 */
function Scenery(): React.ReactElement {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      <defs>
        <linearGradient id="tp-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#0b1738" />
          <stop offset="0.62" stopColor="#40406a" />
          <stop offset="1" stopColor="#f7c893" />
        </linearGradient>
        <linearGradient id="tp-terrace" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1d2438" />
          <stop offset="1" stopColor="#181e2f" />
        </linearGradient>
        <radialGradient id="tp-smother">
          <stop offset="0.45" stopColor="#040a18" stopOpacity="0.4" />
          <stop offset="1" stopColor="#040a18" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect fill="url(#tp-sky)" height="34" width="100" x="0" y="0" />
      {/* L'astre, posé dans le col le plus bas de la crête. */}
      <circle cx="68" cy="30" fill="#ffd9a6" r="2.4" />
      {/* Deux chaînes : la lointaine claire, la proche plus sombre. */}
      <path d="M0 34 L9 27 L17 31 L26 22 L38 30 L47 26 L58 32 L65 28 L74 33 L84 25 L93 31 L100 27 L100 40 L0 40 Z" fill="#454f70" />
      <path d="M0 40 L12 33 L22 37 L33 31 L44 36 L55 33 L68 38 L79 34 L90 38 L100 34 L100 48 L0 48 Z" fill="#28304f" />
      {/* L'escalier de terrasses sur lequel la table est posée. */}
      <rect fill="url(#tp-terrace)" height="56" width="100" x="0" y="44" />
      <path d="M0 55 L38 52 L72 56 L100 53 L100 57 L0 59 Z" fill="#232b42" opacity="0.8" />
      <path d="M0 70 L44 66 L100 71 L100 75 L0 74 Z" fill="#1a2133" opacity="0.9" />
      {/* La masse du premier plan ferme la composition par le bas. */}
      <path d="M0 92 L30 88 L66 93 L100 89 L100 100 L0 100 Z" fill="#080c15" />
      {/* Le halo d'étouffement, sous la grille des sièges. */}
      <ellipse cx="50" cy="74" fill="url(#tp-smother)" rx="52" ry="30" />
    </svg>
  );
}

/**
 * Un permanent. Tapé, il pivote de 90° — et sa boîte s'élargit d'autant, sinon
 * il déborderait sur son voisin au lieu d'occuper sa propre place.
 */
function MiniCard({ card, tapped }: { card: Hit | null; tapped: boolean }): React.ReactElement {
  return (
    <div className="flex w-[15%] shrink-0 items-center justify-center" style={{ aspectRatio: '63 / 88' }}>
      <div
        className="overflow-hidden rounded-[4px] bg-[#0d1117] ring-1 ring-black/60"
        style={
          tapped
            ? { width: '72%', aspectRatio: '63 / 88', transform: 'rotate(90deg)' }
            : { width: '100%', aspectRatio: '63 / 88' }
        }
      >
        {card ? (
          <img
            alt=""
            className="h-full w-full object-cover"
            decoding="async"
            loading="lazy"
            src={scryfallImage(card.scryfallId, 'small')}
          />
        ) : (
          <CardBack />
        )}
      </div>
    </div>
  );
}

/**
 * Le dos de carte de repli, quand l'index ne répond pas. Il est dessiné ici, à
 * l'encre du site : pas question d'aller chercher le dos officiel pour décorer
 * une page d'accueil.
 */
function CardBack(): React.ReactElement {
  return (
    <div
      className="h-full w-full"
      style={{
        background: 'repeating-linear-gradient(135deg, #241a3d 0 5px, #1b1430 5px 10px)',
        boxShadow: 'inset 0 0 0 2px rgba(189,166,255,0.22)',
      }}
    />
  );
}

/** Le token Pest du journal, posé sur le champ de bataille. */
function PestToken(): React.ReactElement {
  return (
    <div className="w-[15%] shrink-0" style={{ aspectRatio: '63 / 88' }}>
      <div className="flex h-full w-full flex-col justify-between rounded-[4px] border border-dashed border-amber-300/50 bg-amber-300/10 p-[7%] text-[0.5rem] leading-tight text-amber-200/90 sm:text-[0.56rem]">
        <span>Pest</span>
        <span className="typed self-end">1/1</span>
      </div>
    </div>
  );
}
