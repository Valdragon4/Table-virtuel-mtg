import type { ImportReport } from '@mtg/shared';

/**
 * Rapport d'import. Un import ne s'effondre jamais sur une ligne : il importe le
 * reste et montre ici ce qui a résisté, avec la ligne d'origine et des
 * suggestions.
 *
 * C'est un relevé, pas un panneau d'état : il est donc imprimé sur papier, chaque
 * ligne refusée citée telle qu'elle a été tapée, en Courier, avec son numéro de
 * ligne dans la marge. Les corrections proposées se prennent en un clic.
 */
/**
 * Une même carte revient une fois par impression. Ce qu'on corrige ici est un
 * **nom**, pas une édition : cinq boutons identiques ne proposent pas cinq
 * choix, ils proposent le même cinq fois. On ne garde donc que le premier de
 * chaque nom — l'impression retenue par le serveur.
 */
/** Pluriels écrits. « 2 ligne(s) » est une note de développeur, pas du français. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

function dedupe<T extends { name: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  return list.filter((entry) => (seen.has(entry.name) ? false : (seen.add(entry.name), true)));
}

export function ImportReportView({
  report,
  onPick,
}: {
  report: ImportReport;
  onPick?: (lineNumber: number, scryfallId: string, name: string) => void;
}): React.ReactElement {
  const { stats, issues } = report;

  return (
    <div className="cut-shadow">
      <div className="paper paper-cut p-6">
        <h3 className="sign text-[1.3rem] leading-none text-[color:var(--site-ink)]">
          {report.deckName}
        </h3>

        <div className="rule-ink mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 pt-4 text-[0.85rem]">
          <span className="paper-dim">
            <span className="typed text-[color:var(--site-ink)]">{stats.cardsTotal}</span> cartes ·{' '}
            <span className="typed text-[color:var(--site-ink)]">{stats.cardsResolved}</span> lignes
            résolues
          </span>
          {stats.editionFallbacks > 0 && (
            <span className="paper-dim">
              <span className="typed text-[color:var(--site-ink)]">{stats.editionFallbacks}</span>{' '}
              {stats.editionFallbacks > 1
                ? 'éditions introuvables, remplacées'
                : 'édition introuvable, remplacée'}
            </span>
          )}
          {issues.length === 0 ? (
            <span className="stamped">Tout est passé</span>
          ) : (
            <span className="stamped" style={{ borderColor: 'var(--site-alarm)', color: 'var(--site-alarm)' }}>
              {plural(issues.length, 'ligne à revoir', 'lignes à revoir')}
            </span>
          )}
        </div>

        {issues.length > 0 && (
          <ul className="scrollbar-thin mt-5 max-h-80 overflow-y-auto pr-1">
            {issues.map((issue) => (
              <li
                className="border-t border-[color:var(--site-paper-edge)] py-3 first:border-t-0 first:pt-0"
                key={`${issue.lineNumber}-${issue.raw}`}
              >
                <div className="flex items-baseline gap-3">
                  <span className="typed shrink-0 text-[0.78rem] text-[color:var(--site-ink-soft)]">
                    L{issue.lineNumber}
                  </span>
                  <code className="typed min-w-0 flex-1 truncate text-[0.88rem] text-[color:var(--site-ink)]">
                    {issue.raw.trim() || '(ligne vide)'}
                  </code>
                </div>
                <p className="mt-1 pl-[2.6rem] text-[0.8rem] text-[color:var(--site-alarm)]">{issue.message}</p>

                {issue.suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-[2.6rem]">
                    <span className="sign-sm text-[0.64rem] text-[color:var(--site-ink-soft)]">
                      Vouliez-vous dire
                    </span>
                    {dedupe(issue.suggestions).map((s) => (
                      <button
                        className="printed-choice px-2.5 py-1 text-[0.72rem]"
                        key={s.scryfallId}
                        onClick={() => onPick?.(issue.lineNumber, s.scryfallId, s.name)}
                        title={`${s.setCode.toUpperCase()} · distance ${s.distance}`}
                        type="button"
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
