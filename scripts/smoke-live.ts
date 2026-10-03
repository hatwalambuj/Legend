/**
 * `npm run smoke:live -- --url https://<deploy> [playwright args…]` → e2e-live/ against that deploy
 * (C-14, FOUNDER_INPUTS F6). Creates and deletes one throwaway account. Evidence: test-results-live/evidence/.
 * Reads TMDB_READ_TOKEN / TMDB_API_KEY / SMOKE_EMAIL / SMOKE_TITLE from the environment (see e2e-live/smoke.spec.ts).
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const i = args.findIndex((a) => a === '--url' || a.startsWith('--url='));
const url =
  i < 0 ? process.env.SMOKE_URL : args[i]!.includes('=') ? args[i]!.split('=')[1] : args[i + 1];
const rest =
  i < 0 ? args : args.filter((_, j) => j !== i && (args[i]!.includes('=') || j !== i + 1));

let ok = false;
try {
  const u = new URL(url!);
  // https for a deploy; plain http only for a local `next start` with live keys.
  ok =
    u.protocol === 'https:' ||
    (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
} catch {
  ok = false;
}
if (!ok) {
  console.error(
    'Usage: npm run smoke:live -- --url https://<your deploy>   (https://, or http://localhost)',
  );
  process.exit(2);
}

const r = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.live.config.ts', ...rest], {
  stdio: 'inherit',
  env: { ...process.env, SMOKE_URL: url!.replace(/\/+$/, '') },
});
process.exit(r.status ?? 1);
