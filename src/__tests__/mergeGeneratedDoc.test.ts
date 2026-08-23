// Integration tests for scripts/merge-generated-doc.js, the merge driver that
// keeps generated content out of a line merge.
//
// These shell out to real git rather than testing a pure function, which is a
// deliberate exception to this repo's "only pure logic is tested" rule. The
// driver's whole job is to hand a resolution to git, and its first version
// passed `git merge-file` its arguments in the wrong order — that call takes
// <current> <base> <other> and applies base->other onto current, so a swap
// does not fail, it silently reverses one side's edits. It deleted a paragraph
// this branch had added to CLAUDE.md, because "ours added it, base and theirs
// lack it" read as "theirs deleted it". Nothing short of a real merge catches
// that, and silent deletion of hand-written docs is worth a slow test.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.join(__dirname, '..', '..');
const DRIVER = path.join(REPO, 'scripts', 'merge-generated-doc.js');
const BEGIN = '<!-- BEGIN GENERATED: repo-stats -->';
const END = '<!-- END GENERATED: repo-stats -->';

let dir: string;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

/** A CLAUDE.md-shaped file: prose, a generated block, more prose. */
const doc = (prose: string, generated: string, tail = 'Tail prose.\n') =>
  `${prose}\n${BEGIN}\n${generated}\n${END}\n\n${tail}`;

function commitAll(message: string) {
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

/**
 * Runs a real three-way merge of `theirs` into `ours` with the driver wired
 * up, and returns the merged CLAUDE.md plus whether git reported a conflict.
 */
function merge(base: string, ours: string, theirs: string) {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), base);
  commitAll('base');
  const baseRef = git('rev-parse', 'HEAD').trim();

  git('checkout', '-q', '-b', 'theirs');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), theirs);
  commitAll('theirs');

  git('checkout', '-q', '-b', 'ours', baseRef);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), ours);
  commitAll('ours');

  let conflicted = false;
  try {
    git('merge', '--no-edit', 'theirs');
  } catch {
    conflicted = true;
  }
  return { text: fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), conflicted };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-generated-doc-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'merge.generated-doc.name', 'test driver');
  git('config', 'merge.generated-doc.driver', `node ${DRIVER} %O %A %B`);
  fs.writeFileSync(path.join(dir, '.gitattributes'), 'CLAUDE.md merge=generated-doc\n');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('merge-generated-doc', () => {
  it('keeps prose only our side added', () => {
    const { text, conflicted } = merge(
      doc('Shared prose.', 'base stats'),
      doc('Shared prose.\n\nA paragraph only we added.', 'our stats'),
      doc('Shared prose.', 'their stats')
    );

    expect(conflicted).toBe(false);
    expect(text).toContain('A paragraph only we added.');
  });

  it('keeps prose only their side added', () => {
    const { text, conflicted } = merge(
      doc('Shared prose.', 'base stats'),
      doc('Shared prose.', 'our stats'),
      doc('Shared prose.\n\nA paragraph only they added.', 'their stats')
    );

    expect(conflicted).toBe(false);
    expect(text).toContain('A paragraph only they added.');
  });

  it('keeps prose both sides added in different places', () => {
    const { text, conflicted } = merge(
      doc('Opening.\n\nMiddle.\n\nClosing.', 'base stats'),
      doc('Opening.\n\nOurs here.\n\nMiddle.\n\nClosing.', 'our stats'),
      doc('Opening.\n\nMiddle.\n\nTheirs here.\n\nClosing.', 'their stats')
    );

    expect(conflicted).toBe(false);
    expect(text).toContain('Ours here.');
    expect(text).toContain('Theirs here.');
  });

  it('merges cleanly when only the generated block differs', () => {
    const { text, conflicted } = merge(
      doc('Shared prose.', 'base stats'),
      doc('Shared prose.', 'our stats'),
      doc('Shared prose.', 'their stats')
    );

    expect(conflicted).toBe(false);
    expect(text).not.toContain('<<<<<<<');
    // Whichever side's block survives is arbitrary and irrelevant: the
    // post-merge hook regenerates it. What matters is that it never conflicts
    // and never leaves markers inside the block.
    expect(text).toContain(BEGIN);
    expect(text).toContain(END);
  });

  it('still conflicts when both sides edit the same prose', () => {
    const { text, conflicted } = merge(
      doc('The original sentence.', 'base stats'),
      doc('Our rewrite of the sentence.', 'our stats'),
      doc('Their rewrite of the sentence.', 'their stats')
    );

    expect(conflicted).toBe(true);
    expect(text).toContain('<<<<<<<');
  });

  it('treats a file with no markers as generated end to end', () => {
    fs.writeFileSync(path.join(dir, '.gitattributes'), 'map.md merge=generated-doc\n');
    const write = (t: string) => fs.writeFileSync(path.join(dir, 'map.md'), t);

    write('- a\n- b\n');
    commitAll('base');
    const baseRef = git('rev-parse', 'HEAD').trim();

    git('checkout', '-q', '-b', 'theirs');
    write('- a\n- b\n- their-module\n');
    commitAll('theirs');

    git('checkout', '-q', '-b', 'ours', baseRef);
    write('- a\n- b\n- our-module\n');
    commitAll('ours');

    git('merge', '--no-edit', 'theirs');

    // No conflict, no markers. The content is our side verbatim, which is a
    // placeholder the post-merge hook overwrites by regenerating.
    const text = fs.readFileSync(path.join(dir, 'map.md'), 'utf8');
    expect(text).not.toContain('<<<<<<<');
    expect(text).toBe('- a\n- b\n- our-module\n');
  });
});
