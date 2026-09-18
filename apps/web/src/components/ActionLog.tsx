import { useEffect, useMemo, useRef, useState } from 'react';
import { NAMED_LOG_LIMIT, type CardView, type ObjectId } from '@mtg/shared';
import { cardMeta, subscribeCards } from '../lib/cards.js';
import { useGame } from '../store/game.js';
import { useT } from '../lib/i18n/index.js';

/**
 * Périphrase du serveur pour une carte dont l'identité n'est pas publique.
 *
 * Elle **n'est pas traduite**, et ce n'est pas un oubli : c'est mot pour mot ce
 * que le serveur écrit dans la phrase française du journal (`publicName`), et
 * les pastilles du dépliage doivent dire la même chose que la ligne au-dessus.
 * Le jour où le journal se localisera pour de bon, elle suivra — pas avant
 * (docs/i18n.md §7).
 */
const CARTE_ANONYME = 'une carte';

/**
 * Une ligne est dépliable quand elle porte plus de cartes que le serveur n'en
 * nomme. Déduit du **lot**, jamais du texte : l'abréviation est une phrase
 * traduisible, la découper casserait à la première langue ajoutée.
 *
 * Le lot se lit à deux endroits, et `names` passe devant quand il est là.
 * D'ordinaire ce sont les ancres qui le décrivent — vrai pour tous les
 * assembleurs (`UNTAP_ALL`, `TAP`, `MILL`, `EXILE_TOP`, déplacements…). Mais une
 * cascade renvoie ses cartes sous la bibliothèque sous un identifiant neuf : il
 * ne reste qu'une ancre pour neuf cartes, et compter les ancres ferait croire
 * que la ligne n'a rien à déplier alors qu'elle abrège trois noms. Le serveur
 * publie alors la liste, et c'est elle qui dit la taille du lot.
 *
 * Le seuil est celui que le serveur applique, lu dans `@mtg/shared` : les deux
 * côtés ne peuvent plus dériver l'un de l'autre.
 */
export function estAbregee(cardIds: readonly ObjectId[], names?: readonly string[]): boolean {
  return (names ?? cardIds).length > NAMED_LOG_LIMIT;
}

/**
 * Nomme les cartes ancrées par une ligne de journal, dans l'ordre reçu.
 *
 * **Invariant de visibilité.** La seule source d'identité autorisée est le
 * store : il ne contient que ce que le serveur a décidé de nous envoyer. Un
 * identifiant absent, ou présent en `HiddenCardView`, retombe sur la même
 * périphrase que celle du serveur — on ne va la chercher nulle part ailleurs
 * (pas de prédiction locale, pas de carte homonyme, pas de contournement par le
 * cache d'images, qui est de toute façon indexé par un `scryfallId` qu'une vue
 * cachée ne porte pas). Filtrer ou compléter ici serait une triche, pas un
 * détail d'affichage.
 *
 * Le nom lui-même vit dans le cache de métadonnées, comme partout ailleurs dans
 * l'interface ; tant qu'il n'est pas arrivé, la ligne dit « une carte » plutôt
 * que d'inventer. `nomDeMeta` est injectable pour que le test n'ait pas besoin
 * du réseau.
 *
 * **Pourquoi ces noms restent ceux du catalogue, alors que toute la table est
 * passée au français.** Le `text` d'une `LogEntry` est une phrase française
 * fabriquée **par le serveur**, et les noms de cartes y sont déjà cuits dedans,
 * en anglais (`cardName(obj)` dans `engine.ts`). Or une ligne n'est dépliable
 * que lorsqu'elle porte plus de `NAMED_LOG_LIMIT` cartes — c'est-à-dire
 * précisément quand le serveur en a déjà nommé six dans la phrase. Traduire le
 * dépliage ferait donc apparaître la même carte deux fois, sous deux noms, à
 * deux lignes d'écart : « déplace Sol Ring, … et 4 autres cartes » au-dessus
 * d'une pastille « Anneau solaire ». Ce n'est pas un repli invisible, c'est une
 * contradiction visible.
 *
 * Le jour où le journal se localisera pour de bon, ce ne sera pas ici : il
 * faudra que le serveur cesse de cuire les noms dans sa phrase et les publie
 * comme des ancres — la mécanique de `cardIds` existe déjà pour ça. Ce fichier
 * suivra alors d'une ligne. En attendant, il vaut mieux tout en anglais que la
 * moitié.
 */
export function nomsDesCartes(
  cardIds: readonly ObjectId[],
  cards: ReadonlyMap<ObjectId, CardView>,
  nomDeMeta: (scryfallId: string) => string | undefined = (id) => cardMeta(id)?.name,
): string[] {
  return cardIds.map((id) => {
    const vue = cards.get(id);
    if (!vue || vue.faceDown) return CARTE_ANONYME;
    return nomDeMeta(vue.scryfallId) ?? CARTE_ANONYME;
  });
}

/**
 * Ce qu'une ligne dépliée affiche, quelle que soit la façon dont le serveur l'a
 * décrite.
 *
 * **Déplier, c'est lire des noms — pas survoler des cartes.** Les ancres restent
 * le chemin normal, et le survol de la ligne continue de surligner sur la table
 * ce qui en a encore une ; mais elles ne peuvent pas être la *condition* pour
 * savoir ce qui est passé. Une cascade réattribue l'identifiant de tout ce
 * qu'elle renvoie sous la bibliothèque (§2.1) : ces cartes n'existent plus dans
 * le store, et les résoudre par ancre ne rendrait que des « une carte ». Le
 * serveur publie donc la liste dépliée pour ces lignes-là (`LogEntry.names`), et
 * c'est elle qui fait foi quand elle est présente.
 *
 * **Ce n'est pas un contournement de l'invariant de visibilité.** La règle est
 * que le client n'invente jamais une identité : il n'a le droit d'afficher que
 * ce que le serveur lui a envoyé. `names` est envoyé par le serveur, filtré par
 * le même `publicName` que le texte de la ligne, et une carte que la table ne
 * pouvait pas identifier y figure déjà comme « une carte ». Lire cette liste,
 * c'est relire la phrase du dessus sans son abréviation — on ne va toujours rien
 * chercher ailleurs (pas de prédiction locale, pas d'homonyme, pas de cache
 * d'images).
 */
export function nomsDeplies(
  entry: { cardIds: readonly ObjectId[]; names?: readonly string[] },
  cards: ReadonlyMap<ObjectId, CardView>,
  nomDeMeta?: (scryfallId: string) => string | undefined,
): string[] {
  if (entry.names) return [...entry.names];
  return nomsDesCartes(entry.cardIds, cards, nomDeMeta);
}

/**
 * Journal d'actions. Chaque ligne vient d'un event : l'acteur porte sa couleur de
 * siège, et survoler une ligne met en évidence les cartes qu'elle mentionne.
 *
 * Au-delà de six cartes le serveur abrège son texte ; le bouton « Voir les N
 * cartes » rouvre le lot complet à partir des ancres. C'est un vrai bouton, pas
 * un survol : cette PWA se joue au doigt, et le survol de la ligne est déjà pris
 * par la mise en évidence sur la table.
 */
export function ActionLog({
  onHighlight,
}: {
  onHighlight: (cardIds: string[]) => void;
}): React.ReactElement {
  const t = useT();
  const log = useGame((s) => s.log);
  const seats = useGame((s) => s.seats);
  const cards = useGame((s) => s.cards);
  const send = useGame((s) => s.send);
  const bottom = useRef<HTMLDivElement>(null);
  const [chatting, setChatting] = useState(false);
  const [draft, setDraft] = useState('');
  /**
   * Lignes dépliées, par `seq`. Volontairement indexé sur l'entrée et non sur sa
   * position : une ligne ouverte doit le rester quand la partie continue de
   * parler au-dessus d'elle, sinon elle se refermerait toute seule au premier
   * event venu — exactement au moment où on la lit.
   */
  const [depliees, setDepliees] = useState<ReadonlySet<number>>(() => new Set());

  // Les noms arrivent par lots, après coup : on se re-rend quand le cache bouge.
  const [, setTick] = useState(0);
  useEffect(() => subscribeCards(() => setTick((t) => t + 1)), []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [log.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (event.key === 'Enter' && !typing) {
        event.preventDefault();
        setChatting(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Les noms des seules lignes ouvertes. Le sélecteur zustand rend la `Map`
   * telle quelle et la dérivation vit ici : un sélecteur qui construirait un
   * tableau ne serait jamais égal à lui-même et bouclerait (React #185).
   */
  const noms = useMemo(() => {
    const parSeq = new Map<number, string[]>();
    for (const entry of log) {
      if (depliees.has(entry.seq)) parSeq.set(entry.seq, nomsDeplies(entry, cards));
    }
    return parSeq;
  }, [log, cards, depliees]);

  function nameOf(actor: string | null): { name: string; color: string } {
    const seat = seats.find((s) => s.id === actor);
    return { name: seat?.displayName ?? t('log.tableActor'), color: seat?.color ?? '#94a3b8' };
  }

  function basculer(seq: number): void {
    setDepliees((ouvertes) => {
      const suivant = new Set(ouvertes);
      if (!suivant.delete(seq)) suivant.add(seq);
      return suivant;
    });
  }

  return (
    <div className="pointer-events-auto w-72 rounded-xl border border-slate-700 bg-slate-900/90 shadow-xl backdrop-blur-md overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-800/90 px-3.5 py-2 text-xs bg-slate-950/40">
        <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">
          {t('log.title')}
        </span>
        <button
          className="text-[11px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
          onClick={() => setChatting((c) => !c)}
          title={t('log.chatHint')}
        >
          {t('log.chatButton')}
        </button>
      </header>

      <div className="scrollbar-thin max-h-56 overflow-y-auto px-3 py-2 text-xs leading-relaxed">
        {log.length === 0 && (
          <p className="text-slate-500 italic py-2 text-center text-xs">{t('log.empty')}</p>
        )}
        {log.map((entry) => {
          const actor = nameOf(entry.actor);
          const depliable = estAbregee(entry.cardIds, entry.names);
          // Le compte annoncé par le bouton est celui du lot réel, pas celui
          // des ancres : après une cascade il n'en reste qu'une pour neuf
          // cartes, et « Voir la 1 carte » mentirait sur ce qui va s'ouvrir.
          const taille = entry.names?.length ?? entry.cardIds.length;
          const ouverte = depliees.has(entry.seq);
          return (
            <div
              key={entry.seq}
              className="mb-1.5 cursor-default text-slate-200 hover:text-white transition-colors"
              onMouseEnter={() => onHighlight(entry.cardIds)}
              onMouseLeave={() => onHighlight([])}
            >
              <span
                className="inline-block whitespace-nowrap font-bold mr-1 px-1.5 py-0.5 rounded text-[11px] ring-1 ring-white/10"
                style={{ color: actor.color, background: `${actor.color}18` }}
              >
                {actor.name}
              </span>{' '}
              <span className="text-slate-300">{stripActor(entry.text, actor.name)}</span>
              {depliable && (
                <>
                  {' '}
                  <button
                    type="button"
                    aria-expanded={ouverte}
                    // `after:-inset-2` étend la zone tapable bien au-delà du
                    // dessin : dans une colonne en text-xs on ne peut pas se
                    // permettre un bouton de 44 px de haut, mais on peut lui
                    // donner 44 px de cible.
                    className="relative after:absolute after:-inset-2 after:content-[''] inline-flex min-h-[26px] touch-manipulation items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-0.5 align-middle text-[10px] font-semibold text-sky-300 transition-colors hover:border-sky-600 hover:bg-slate-700/70 hover:text-sky-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
                    onClick={() => basculer(entry.seq)}
                  >
                    <span aria-hidden="true">{ouverte ? '▾' : '▸'}</span>
                    {ouverte
                      ? t('log.collapse')
                      : t('log.expandCards', { count: taille })}
                  </button>
                </>
              )}
              {ouverte && (
                <ul className="mt-1 flex flex-wrap gap-1 border-l border-slate-700/80 pl-2">
                  {(noms.get(entry.seq) ?? []).map((nom, index) => (
                    <li
                      // La position, et non l'ancre : `names` peut être plus
                      // long que `cardIds` (cascade), et un lot contient
                      // couramment deux fois la même carte.
                      key={index}
                      className={`rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] ${
                        nom === CARTE_ANONYME ? 'italic text-slate-500' : 'text-slate-300'
                      }`}
                    >
                      {nom}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {chatting && (
        <form
          className="border-t border-slate-800 p-2 bg-slate-950/80"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (text) send({ type: 'CHAT_BUBBLE', text });
            setDraft('');
            setChatting(false);
          }}
        >
          <input
            autoFocus
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500"
            maxLength={240}
            placeholder={t('log.messagePlaceholder')}
            value={draft}
            onBlur={() => setChatting(false)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setChatting(false);
            }}
          />
        </form>
      )}
    </div>
  );
}

/** Le nom de l'acteur est déjà affiché en gras : on évite de le répéter. */
function stripActor(text: string, name: string): string {
  return text.startsWith(`${name} `) ? text.slice(name.length + 1) : text;
}
