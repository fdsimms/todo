import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { SETTINGS_ENTRIES } from '../utils/settingsIndex';

/**
 * Every index entry names a row that can actually be scrolled to.
 *
 * Settings search now opens onto the row it matched rather than onto the top of
 * the group holding it, and the link between the two is `SettingsRow`'s
 * `entryId` — a string that has to equal the entry's `id`. Nothing else checks
 * it: a typo, or a new row indexed but never wired, degrades silently back to
 * the old behaviour (you land at the top of the group), which is exactly the
 * kind of failure nobody files a bug about.
 *
 * This reads the JSX as text rather than rendering it, because Jest runs in the
 * `node` environment here with no React renderer (see CLAUDE.md). That makes it
 * a grep with an opinion, and it can only prove the id *appears* in the source
 * — not that it sits on the right row, or that the row renders. Both of those
 * are matched by label in `settingsIndex.test.ts` and by the two derived lists.
 * What this catches is the whole-entry case: an id nothing anywhere mentions.
 */

const SETTINGS_DIR = join(__dirname, '..', 'screens', 'settings');

const source = readdirSync(SETTINGS_DIR)
  .filter(f => f.endsWith('.tsx'))
  .map(f => readFileSync(join(SETTINGS_DIR, f), 'utf8'))
  .join('\n');

/**
 * The rows whose ids are built at runtime, and the shape that builds them.
 *
 * Both derived blocks map over a registry (`AI_FEATURES`,
 * `GENERATED_KIND_LIST`) and interpolate the id, so the literal never appears
 * in the JSX. The template does, and that the two sides agree on the *shape*
 * is what `settingsIndex.test.ts` checks against the registries themselves.
 */
const TEMPLATED = [
  { test: (id: string) => id.startsWith('ai:'), template: 'entryId={`ai:${feature.id}`}' },
  // Day & time's six rows come out of one `segment()` helper keyed by the same
  // strings the index uses, so the id is the loop variable.
  {
    test: (id: string) => ['dayReset', 'afternoon', 'evening', 'night', 'activeStart', 'activeEnd']
      .includes(id),
    template: 'entryId={key}',
  },
  {
    test: (id: string) => id.startsWith('gen:') && id.endsWith(':category'),
    template: 'entryId={`gen:${spec.kind}:category`}',
  },
  { test: (id: string) => id.startsWith('gen:'), template: 'entryId={`gen:${spec.kind}`}' },
];

describe('settings entry wiring', () => {
  it('renders a row carrying every entry id', () => {
    const missing = SETTINGS_ENTRIES.filter(entry => {
      const templated = TEMPLATED.find(t => t.test(entry.id));
      if (templated) return !source.includes(templated.template);
      return !source.includes(`entryId="${entry.id}"`);
    }).map(e => `${e.groupId}/${e.id} (${e.label})`);

    expect(missing).toEqual([]);
  });

  it('has a template in the source for each derived block', () => {
    // Guards the escape hatch above: if a derived block were rewritten to
    // hand-written rows, the check for those ids would pass on a template
    // string that no longer exists rather than on the rows.
    for (const { template } of TEMPLATED) {
      expect(source).toContain(template);
    }
  });

  it('wires no id that is not in the index', () => {
    // The other direction: a row pointing at an entry that has been renamed or
    // deleted is a row that can never be focused, and reads as wired.
    const known = new Set(SETTINGS_ENTRIES.map(e => e.id));
    const wired = [...source.matchAll(/entryId="([^"]+)"/g)].map(m => m[1]);
    expect(wired.filter(id => !known.has(id))).toEqual([]);
  });
});
