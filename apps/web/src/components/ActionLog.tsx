import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store/game.js';

/**
 * Journal d'actions. Chaque ligne vient d'un event : l'acteur porte sa couleur de
 * siège, et survoler une ligne met en évidence les cartes qu'elle mentionne.
 */
export function ActionLog({
  onHighlight,
}: {
  onHighlight: (cardIds: string[]) => void;
}): React.ReactElement {
  const log = useGame((s) => s.log);
  const seats = useGame((s) => s.seats);
  const send = useGame((s) => s.send);
  const bottom = useRef<HTMLDivElement>(null);
  const [chatting, setChatting] = useState(false);
  const [draft, setDraft] = useState('');

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

  function nameOf(actor: string | null): { name: string; color: string } {
    const seat = seats.find((s) => s.id === actor);
    return { name: seat?.displayName ?? 'Table', color: seat?.color ?? '#94a3b8' };
  }

  return (
    <div className="pointer-events-auto w-72 rounded-xl border border-slate-700 bg-slate-900/90 shadow-xl backdrop-blur-md overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-800/90 px-3.5 py-2 text-xs bg-slate-950/40">
        <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">Journal</span>
        <button
          className="text-[11px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
          onClick={() => setChatting((c) => !c)}
          title="Écrire un message (Entrée)"
        >
          Entrée pour parler
        </button>
      </header>

      <div className="scrollbar-thin max-h-56 overflow-y-auto px-3 py-2 text-xs leading-relaxed">
        {log.length === 0 && <p className="text-slate-500 italic py-2 text-center text-xs">Rien pour l'instant.</p>}
        {log.map((entry) => {
          const actor = nameOf(entry.actor);
          return (
            <p
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
            </p>
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
            placeholder="Votre message…"
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
