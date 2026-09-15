// Integration tests for the `merge=union` policy in .gitattributes, which is
// what keeps the three generated docs from conflicting.
//
// These shell out to real git rather than testing a pure function, a deliberate
// exception to this repo's "only pure logic is tested" rule. The thing under
// test is a git behaviour, and the bug it replaced was invisible to every other
// kind of check: a custom `generated-doc` merge driver resolved these files
// correctly, but had to be registered per clone by npm postinstall, which
// GitHub's servers never run. So every open PR showed a conflict in the
// generated docs after every merge to main while the same merge was clean on a
// developer's machine, and a locally clean merge was not evidence the PR was
// mergeable at all.
//
// The whole point of union here is that it needs no configuration, so these
// tests register no merge driver and unset the inherited config. If a future
// change swaps the attribute back for something needing `merge.<name>.driver`,
// the mergesCleanly cases fail here rather than on somebody's pull request.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.join(__dirname, '..', '..');

let dir: string;

const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    // A driver the repo no longer asks for must not leak in from the developer's
    // own clone, which is where the old one was registered.
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });

function commitAll(message: string) {
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

/**
 * Three-way merges two one-line edits to `file` and reports whether git could
 * do it without help. `base`, `ours` and `theirs` are whole file contents.
 */
function mergeTwoWays(file: string, base: string, ours: string, theirs: string) {
  const abs = path.join(dir, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, base);
  commitAll('base');
  const baseRef = git('rev-parse', 'HEAD').trim();

  git('checkout', '-q', '-b', 'theirs');
  fs.writeFileSync(abs, theirs);
  commitAll('theirs');

  git('checkout', '-q', '-b', 'ours', baseRef);
  fs.writeFileSync(abs, ours);
  commitAll('ours');

  let conflicted = false;
  try {
    git('merge', '--no-edit', 'theirs');
  } catch {
    conflicted = true;
  }
  return { conflicted, merged: fs.readFileSync(abs, 'utf8') };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitattrs-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  // The real file, so these test the policy the repo actually ships rather
  // than a copy of it that can drift.
  fs.copyFileSync(path.join(REPO, '.gitattributes'), path.join(dir, '.gitattributes'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the generated docs merge without a merge driver', () => {
  const MAPS = ['docs/module-map.md', 'docs/screen-map.md', 'docs/repo-stats.md'];

  it.each(MAPS)('%s takes both sides when each adds a line', file => {
    const { conflicted, merged } = mergeTwoWays(
      file,
      'a\nb\n',
      'a\nb\nours\n',
      'a\nb\ntheirs\n',
    );
    expect(conflicted).toBe(false);
    expect(merged).toContain('ours');
    expect(merged).toContain('theirs');
    expect(merged).not.toContain('<<<<<<<');
  });

  it.each(MAPS)('%s keeps both when the same fact is rewritten, rather than conflicting', file => {
    // The case union gets "wrong": two different counts for one line survive as
    // two lines. That is deliberate — a duplicate the post-merge hook
    // regenerates away and CI catches beats a conflict that blocks the PR.
    const { conflicted, merged } = mergeTwoWays(
      file,
      '`db/database.ts` (+122 more)\n',
      '`db/database.ts` (+125 more)\n',
      '`db/database.ts` (+130 more)\n',
    );
    expect(conflicted).toBe(false);
    expect(merged).toContain('+125');
    expect(merged).toContain('+130');
  });
});

describe('CLAUDE.md is deliberately left out of that', () => {
  it('still conflicts when both sides rewrite the same prose', () => {
    // Union on prose duplicates paragraphs instead of facts, which is why the
    // generated numbers were moved out to docs/repo-stats.md rather than the
    // attribute being widened to cover this file.
    const { conflicted } = mergeTwoWays(
      'CLAUDE.md',
      'Some guidance.\n',
      'Some guidance, rewritten one way.\n',
      'Some guidance, rewritten another way.\n',
    );
    expect(conflicted).toBe(true);
  });

  it('does not silently duplicate a paragraph each side added', () => {
    const { merged } = mergeTwoWays(
      'CLAUDE.md',
      'Intro.\n\nTail.\n',
      'Intro.\n\nOurs adds this.\n\nTail.\n',
      'Intro.\n\nTheirs adds this.\n\nTail.\n',
    );
    expect(merged.match(/Intro\./g)).toHaveLength(1);
    expect(merged.match(/Tail\./g)).toHaveLength(1);
  });
});
