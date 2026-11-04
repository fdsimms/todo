/**
 * Every `<TouchableOpacity>` in `src/` names its `activeOpacity`.
 *
 * Left out, React Native fades the control to 0.2 on press, a deep flash next
 * to the 0.7 (`interaction.activeOpacity`) the rest of the app dims to, so two
 * rows side by side answered a tap differently. 349 controls had drifted onto
 * the default before this check existed, because nothing about a missing prop
 * shows up in review.
 *
 * Any value counts, so the deliberate `activeOpacity={1}` (a scrim, a tap
 * catcher under a list) passes. A tag that spreads props (`{...rest}`) is
 * skipped, since the value may arrive in the spread.
 *
 * Reads the source as text, the same as `noRawModal.test.ts`: there are no
 * component tests, so a JSX tag is only ever text as far as the suite is
 * concerned.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { sourceFiles } from '../testSupport/sourceFiles';

const SRC = join(__dirname, '..');

/**
 * The opening tags of every `<TouchableOpacity` in `source` that sets no
 * `activeOpacity`, as 1-based line numbers. Braces are counted so an arrow
 * function's `>` inside an attribute doesn't end the tag early. Tags in a
 * comment line are ignored.
 */
function bareTags(source: string): number[] {
  const lines: number[] = [];
  const tag = /<TouchableOpacity\b/g;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(source)) !== null) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const before = source.slice(lineStart, match.index).trim();
    if (before.startsWith('*') || before.startsWith('//')) continue;
    let depth = 0;
    let end = tag.lastIndex;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    const opening = source.slice(match.index, end);
    if (opening.includes('activeOpacity') || opening.includes('{...')) continue;
    lines.push(source.slice(0, match.index).split('\n').length);
  }
  return lines;
}

const files = sourceFiles(SRC)
  .filter(f => f.endsWith('.tsx'))
  .map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

describe('TouchableOpacity press opacity', () => {
  it('scans a realistic number of files', () => {
    // Guards the walk itself: a broken path would make the check below pass
    // against nothing at all.
    expect(files.length).toBeGreaterThan(200);
  });

  it('tells a bare tag from one that sets it', () => {
    expect(bareTags('<TouchableOpacity onPress={() => go()}>')).toEqual([1]);
    expect(bareTags('<TouchableOpacity\n  onPress={() => a > b}\n  activeOpacity={interaction.activeOpacity}\n>')).toEqual([]);
    expect(bareTags('<TouchableOpacity activeOpacity={1} />')).toEqual([]);
    expect(bareTags('<TouchableOpacity {...rest} />')).toEqual([]);
    expect(bareTags(' * `<TouchableOpacity onPress={x} />` in a doc comment')).toEqual([]);
  });

  it('sets activeOpacity on every TouchableOpacity', () => {
    const offenders = files.flatMap(f => bareTags(f.src).map(line => `${f.rel}:${line}`));
    expect(offenders).toEqual([]);
  });
});
