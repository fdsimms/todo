/**
 * A `//` line directly inside JSX children is text, not a comment.
 *
 * Between two tags a line reading `// explains the list below` is a string
 * child, so a parent `View` renders it and React Native throws "Text strings
 * must be rendered within a <Text> component". It shipped once already: a
 * refactor wrapped `) : ( // comment <SortableList` in a fragment, which moved
 * the comment from a JS expression (where `//` is legal) into the fragment's
 * children, and every project page with a section crashed. It looked right,
 * typechecked, and passed every test, because nothing here renders a screen.
 *
 * So this reads the source: a line starting `//` whose previous non-blank line
 * ends in an opening or closing tag is inside JSX children. Write those as
 * `{/* … *\/}`, or move the comment above the element that opens the children.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') tsxFiles(full, found);
    else if (entry.isFile() && entry.name.endsWith('.tsx')) found.push(full);
  }
  return found;
}

/** A line that ends by opening or closing a tag: `<>`, `<View style={…}>`, `</View>`. */
const ENDS_IN_TAG = /(<>|<\/>|<[A-Za-z][^<>]*[^=]>|<\/[A-Za-z.]+>)$/;

export function commentTextNodes(source: string): number[] {
  const hits: number[] = [];
  let prev = '';
  source.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') && ENDS_IN_TAG.test(prev)) hits.push(i + 1);
    if (trimmed) prev = trimmed;
  });
  return hits;
}

describe('no // comment as JSX text', () => {
  it('finds the shape it guards against', () => {
    expect(commentTextNodes('<>\n  // explains\n  <List />')).toEqual([2]);
    expect(commentTextNodes('</View>\n// after a sibling')).toEqual([2]);
  });

  it('leaves a comment in an expression alone', () => {
    expect(commentTextNodes(') : (\n  // explains\n  <List />')).toEqual([]);
    expect(commentTextNodes('const f = () =>\n  // body')).toEqual([]);
    expect(commentTextNodes('<>\n  {/* explains */}\n  <List />')).toEqual([]);
  });

  it('holds across src/', () => {
    const offenders = tsxFiles(SRC).flatMap(file =>
      commentTextNodes(readFileSync(file, 'utf8')).map(line => `${file.replace(SRC, 'src')}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
