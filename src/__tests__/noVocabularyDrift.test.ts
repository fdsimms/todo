/**
 * The wordings the app has settled on, held as a table of rules so a settled
 * word stays settled.
 *
 * Most of the app's vocabulary drift was left alone on purpose: "Add task" is
 * right on a quick-add button and "Forget" is right for a catalog entry, so a
 * blanket ban on either would be wrong. What this holds is only the outliers
 * that were fixed because one place said it a different way from every
 * neighbor, each scoped to where that outlier was. Adding a settled word is one
 * more row: its banned pattern, the files it covers, and what to write instead.
 *
 * `noHandWrittenButtonLabel.test.ts` is the same idea for Cancel, Delete, Done
 * and Save, through `BUTTON_LABEL` rather than a pattern.
 */
import { readFileSync } from 'fs';
import { relative } from 'path';
import { ROOT, SRC, sourceFiles } from '../testSupport/sourceFiles';

interface Rule {
  /** What was settled, in a line. */
  settled: string;
  /** The wording that must not come back. */
  banned: RegExp;
  /** Which files the rule covers, by path relative to the repo root. */
  covers: (rel: string) => boolean;
  /** What to write instead, for the failure message. */
  use: string;
}

const RULES: readonly Rule[] = [
  {
    settled: 'the home screen shortcut that opens quick add says New Task, as the rest of the app says new task',
    banned: /["']Add Task["']/,
    covers: rel => rel === 'app.json' || rel === 'src/utils/quickActions.ts',
    use: 'New Task',
  },
  {
    settled: 'a project or template category field says which category it is, so it does not read like the task category field beside it',
    banned: /label="Category"/,
    covers: rel => rel === 'src/components/ProjectEditor.tsx' || rel === 'src/components/TemplateEditor.tsx',
    use: 'Project category / Template category',
  },
  {
    settled: 'the vacation switch is called Vacation pause on a template step, a follow-up and a task alike',
    banned: /Pause on vacation/,
    covers: rel => rel.startsWith('src/components/'),
    use: 'Vacation pause',
  },
  {
    settled: 'undoing an added note says Remove this note, like the other undo prompts in Activity',
    banned: /Forget this note/,
    covers: rel => rel.startsWith('src/'),
    use: 'Remove this note?',
  },
];

const rel = (f: string) => relative(ROOT, f);
const files = [
  ...sourceFiles(SRC).map(f => ({ rel: rel(f), src: readFileSync(f, 'utf8') })),
  { rel: 'app.json', src: readFileSync(`${ROOT}/app.json`, 'utf8') },
];

describe('settled vocabulary', () => {
  it('reads a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('matches the wordings it is meant to catch', () => {
    // Guards the patterns themselves, so no rule can go quietly vacuous.
    expect(RULES[0].banned.test('{ "title": "Add Task" }')).toBe(true);
    expect(RULES[0].banned.test("{ id: 'add', title: 'Add Task' }")).toBe(true);
    expect(RULES[0].banned.test('// kept to Add Task: four static actions')).toBe(false);
    expect(RULES[1].banned.test('<EditorRow label="Category" />')).toBe(true);
    expect(RULES[1].banned.test('label="Project category"')).toBe(false);
    expect(RULES[2].banned.test('<Text>Pause on vacation</Text>')).toBe(true);
    expect(RULES[2].banned.test('<Text>Vacation pause</Text>')).toBe(false);
    expect(RULES[3].banned.test("title: 'Forget this note?'")).toBe(true);
    expect(RULES[3].banned.test("title: 'Remove this note?'")).toBe(false);
  });

  it.each(RULES.map(r => [r.settled, r] as const))('%s', (_settled, rule) => {
    const covered = files.filter(f => rule.covers(f.rel));
    // A rename of a covered file must not leave the rule watching nothing.
    expect(covered.length).toBeGreaterThan(0);
    const offenders = covered.filter(f => rule.banned.test(f.src)).map(f => f.rel);
    expect({ offenders, use: rule.use }).toEqual({ offenders: [], use: rule.use });
  });
});
