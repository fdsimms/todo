/**
 * Nothing in `src/` calls `Linking.openURL` or `Share.share` directly, so a
 * failed open or share can't be swallowed again.
 *
 * Twenty-two link, call, email and directions handlers ended in
 * `catch { // silently ignore }` or `.catch(() => {})`, and six `Share.share`
 * calls did the same, so a tap on something nothing could open looked
 * identical to a button that did nothing. `openExternalUrl` and `shareContent`
 * are the one place each of those calls lives, and each says so when it fails.
 * That is what this holds: a new row that wants to open a link goes through the
 * helper, and gets the alert for free.
 *
 * The one other file allowed a direct call is `healthBridge.ts`, whose
 * `openHealthApp` already handles the failure by opening this app's own
 * Settings page instead (see its doc comment). A new exception goes in
 * `ALLOWED` with its reason, not as a quiet `.catch`.
 *
 * Matches on the `(` so a comment naming the function, as several do, passes.
 */
import { readFileSync } from 'fs';
import { sourceFiles, SRC } from '../testSupport/sourceFiles';

const DIRECT_CALL = /\b(?:Linking\.openURL|Share\.share)\s*\(/;

/** Files allowed the direct call, by name. */
const ALLOWED: readonly string[] = [
  'openExternalUrl.ts',
  'shareContent.ts',
  'healthBridge.ts',
];

const read = (f: string) => ({ file: f, rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') });
const files = sourceFiles(SRC).map(read);

describe('Linking.openURL and Share.share', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('matches the calls it is meant to catch', () => {
    // Guards the pattern itself, so the check can't go quietly vacuous.
    expect(DIRECT_CALL.test('await Linking.openURL(url);')).toBe(true);
    expect(DIRECT_CALL.test('Linking.openURL (url).catch(() => {})')).toBe(true);
    expect(DIRECT_CALL.test('Share.share({ message })')).toBe(true);
    expect(DIRECT_CALL.test('// fell through to Linking.openURL: a round trip')).toBe(false);
    expect(DIRECT_CALL.test('openExternalUrl(url)')).toBe(false);
  });

  it('is only called by the helpers that say when it fails (use openExternalUrl or shareContent)', () => {
    const offenders = files
      .filter(f => !ALLOWED.some(name => f.file.endsWith(`/${name}`)) && DIRECT_CALL.test(f.src))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('keeps every allowed file real, so a rename can not leave a stale exemption', () => {
    for (const name of ALLOWED) {
      expect(files.some(f => f.file.endsWith(`/${name}`))).toBe(true);
    }
  });
});
