/**
 * Requests every allowlisted "Where to watch" home/search URL (src/lib/provider-links.ts) with a sample
 * title and prints the status codes (C-14, FOUNDER_INPUTS F7). Needs network: run it in CI
 * (.github/workflows/smoke-live.yml) or on your machine, never in unit tests.
 *
 *   npm run check:provider-links
 *   npm run check:provider-links -- --json provider-links.json   # also writes the results as JSON
 *
 * Exit 1 only on DNS / TLS / 5xx / non-https; 403/429 bot-blocks are tolerated (scripts/lib/provider-links-check.ts).
 */
import { writeFileSync } from 'node:fs';
import { checkAll, exitCodeFor, formatResults, linkTargets } from './lib/provider-links-check';

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--json');
  const jsonPath = i >= 0 ? args[i + 1] : undefined;
  const targets = linkTargets();
  console.log(`Checking ${targets.length} provider URLs…\n`);
  const results = await checkAll(targets);
  console.log(formatResults(results));
  if (jsonPath)
    writeFileSync(
      jsonPath,
      `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`,
    );
  process.exitCode = exitCodeFor(results);
}

main().catch((e: unknown) => {
  console.error(`check:provider-links crashed: ${e instanceof Error ? e.message : 'error'}`);
  process.exitCode = 2;
});
