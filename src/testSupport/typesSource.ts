/**
 * Every file in `src/types/` as one string, for the coverage tests that read a
 * model's fields out of its interface (`templateItemParity.test.ts`,
 * `taskFieldCoverage.test.ts` and the rest). The types are split by area, so a
 * test names the interface it wants rather than the file it lives in.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { SRC } from './sourceFiles';

export function typesSource(): string {
  const dir = join(SRC, 'types');
  return readdirSync(dir)
    .filter(name => name.endsWith('.ts'))
    .sort()
    .map(name => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
}
