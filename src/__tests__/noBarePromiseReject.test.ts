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
import { readFileSync } from 'fs';
import { join } from 'path';
import { sourceFiles } from '../testSupport/sourceFiles';

const MODULES = join(__dirname, '..', '..', 'modules');
const SWIFT = { match: /\.swift$/, skipDirs: ['node_modules', 'Pods'] };

describe('native modules reject through promise.fail', () => {
  it('has no promise.reject with a code and a description', () => {
    const offenders = sourceFiles(MODULES, SWIFT).filter(file =>
      /promise\.reject\(\s*"/.test(readFileSync(file, 'utf8'))
    );
    expect(offenders.map(f => f.slice(MODULES.length + 1))).toEqual([]);
  });
});
