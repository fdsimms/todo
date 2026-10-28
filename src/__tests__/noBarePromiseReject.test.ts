/**
 * A native module may not call `promise.reject(code, description)`.
 *
 * That overload builds an Expo `Exception` whose `reason` is the framework's
 * "undefined reason" placeholder, and the message JavaScript receives is made
 * from `reason`, so the description is dropped: a failed photo upload showed
 * "ERR_CLOUDKIT_PUSH: undefined reason" and the iCloud error was lost. Every
 * module rejects through its own `promise.fail`, which carries the message.
 *
 * Reads the Swift as text, like `noRawModal.test.ts`; nothing here compiles it.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MODULES = join(__dirname, '..', '..', 'modules');

function swiftFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'Pods') swiftFiles(full, found);
    } else if (entry.name.endsWith('.swift')) found.push(full);
  }
  return found;
}

describe('native modules reject through promise.fail', () => {
  it('has no promise.reject with a code and a description', () => {
    const offenders = swiftFiles(MODULES).filter(file =>
      /promise\.reject\(\s*"/.test(readFileSync(file, 'utf8'))
    );
    expect(offenders.map(f => f.slice(MODULES.length + 1))).toEqual([]);
  });
});
