/**
 * Re-seed the demo-mode JSON store from src/fixtures/seed.json (ADR-006).
 *   npm run demo:reset            # default dir .data/demo
 *   DEMO_DATA_DIR=.data/e2e npm run demo:reset
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from '../src/server/env';

const dir = parseEnv().demo.dataDir;
if (!dir) {
  console.log('DEMO_PERSIST=memory: nothing to reset.');
} else {
  rmSync(join(dir, 'db.json'), { force: true });
  console.log(`Demo store reset: ${join(dir, 'db.json')} removed; it is re-seeded on next boot.`);
}
