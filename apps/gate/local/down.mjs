// Stop what local/up.mjs started. MinIO's data stays where it is.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PIDS = join(import.meta.dirname, 'run', 'pids.json');

if (!existsSync(PIDS)) {
  process.stdout.write('nothing recorded as running\n');
} else {
  for (const [name, pid] of Object.entries(JSON.parse(readFileSync(PIDS, 'utf8')))) {
    try {
      process.kill(pid);
      process.stdout.write(`stopped ${name} (${pid})\n`);
    } catch {
      process.stdout.write(`${name} (${pid}) was not running\n`);
    }
  }
  rmSync(PIDS);
}
