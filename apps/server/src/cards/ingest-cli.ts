/**
 * Ingestion manuelle : `npm run ingest -w @mtg/server -- --force`.
 *
 * **Le `-w @mtg/server` n'est pas décoratif.** Depuis la racine, `npm run
 * ingest -- --force` fait avaler le drapeau par npm lui-même — il l'annonce
 * d'ailleurs, « using --force, Recommended protections disabled » — et le
 * script reçoit une ligne de commande vide, donc ne force rien et répond
 * « Bulk déjà ingéré, rien à faire ». Le cas s'est produit en production : la
 * commande semblait passer, et la ré-ingestion n'avait pas lieu. Dans un
 * conteneur, `node apps/server/dist/cards/ingest-cli.js --force` évite la
 * question.
 *
 * `--repair-tokens` est la reprise d'une base déjà peuplée : elle relit les
 * lignes présentes pour corriger leur drapeau « jeton », sans retélécharger le
 * bulk. C'est la commande à passer sur une base existante après un changement
 * de la règle de reconnaissance des jetons.
 */
import { disconnect } from '../db.js';
import { backfillTokenFlags, ingestCards } from './ingest.js';

const force = process.argv.includes('--force');
const repairOnly = process.argv.includes('--repair-tokens');

async function main(): Promise<void> {
  if (repairOnly) {
    const fixed = await backfillTokenFlags();
    console.log(`${fixed} carte(s) reclassée(s) en jeton.`);
    return;
  }

  const result = await ingestCards({ force });
  console.log(
    result.skipped
      ? 'Bulk déjà ingéré, rien à faire. Relancer avec --force pour forcer.'
      : `${result.cardsUpserted} cartes ingérées en ${Math.round(result.durationMs / 1000)} s.`,
  );
  // Même après une ingestion complète, la reprise ne coûte rien et garantit que
  // les lignes plus anciennes que la règle courante ne restent pas mal classées.
  const fixed = await backfillTokenFlags();
  if (fixed > 0) console.log(`${fixed} carte(s) reclassée(s) en jeton.`);
}

main()
  .then(async () => {
    await disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await disconnect();
    process.exit(1);
  });
