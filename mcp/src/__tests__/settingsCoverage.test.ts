/**
 * Every synced setting is either something the MCP server reads or writes, or
 * is named here as deliberately not exposed, with the reason.
 *
 * The same shape as `taskFieldCoverage.test.ts`, for settings: a setting added
 * to `SYNCED_SETTING_KEYS` and the settings store alone compiles, passes every
 * test and ships something Claude can neither see nor change, with nothing to
 * say so. A synced setting is the candidate because only a synced one reaches
 * the replica the server reads.
 *
 * A key counts as handled when its name appears in the server's source
 * (`settingsSpec.ts` for update_settings, or a tool of its own such as
 * set_vacation_mode or set_nutrition_targets), or when it is an automation's
 * on switch or "File them under" category, which list_automations and
 * set_automation reach through `GENERATED_KIND_LIST` without naming each key.
 * It is a word match on source, so a comment can satisfy it; what it reliably
 * catches is a setting nobody has looked at.
 *
 * Adding a synced setting fails this suite until you do one of:
 *   - expose it (`SETTINGS_SPEC` in `settingsSpec.ts` for a preference, or the
 *     tool that owns the area);
 *   - add it to a group below, which says "looked at it, and here is why not".
 *     Pick the group that is true. A new group is a real decision: say why.
 * Never add one to `NOT_DECIDED`.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

const NOT_EXPOSED: Record<string, string[]> = {
  // How this phone's screens look and sort. Nothing an agent reads to answer
  // a question or would be asked to change on the person's behalf.
  'appearance and list display': [
    'themeMode', 'appFont', 'appFontRandomize', 'appFontPool', 'use24HourTime', 'hideHelpText',
    'sortOption', 'hideGroceryRecipeNames', 'projectSortOption', 'recipeSortOption', 'recipeLovedOnly',
    'collapsedRecipeSections', 'limitsTodayHidden', 'goalsTodayHidden', 'healthTodayHidden',
    'keepOpenAfterFoodLog',
  ],

  // What the app remembers about prompts it has shown and answers it has had,
  // so it doesn't ask again. State, not a choice the person makes in Settings.
  'machinery the app maintains': [
    'leftoverPromptOptOuts', 'limitWarningDeclined', 'goalTargetDeclined', 'medication_summary_last',
    'medication_milestone_dismissed', 'vacationEndedAt',
  ],
};

/**
 * Synced settings that were already unreachable from the server when this test
 * was added, before anyone decided about them. Each one is owed a decision:
 * expose it, or move it to a group above with the reason. The list only
 * shrinks (`NOT_DECIDED_MAX` below holds it to that).
 */
const NOT_DECIDED: string[] = [
  'autoArchiveProjectsOnComplete', 'generatorEstimates', 'mealSlotStepEstimates', 'mealLogPrompt',
  'travelOriginPlaceId', 'goalsTodayCategory', 'stepGoal', 'journalCustomPrompts', 'moodContextSources',
  'moodEventTags', 'limitWarningAutoSlips', 'catalogAuditDismissed', 'weightUnit', 'foodLogPinnedNutrients',
  'shortNightNoteEnabled', 'shortNightMinutes', 'maxHeartRate', 'sleepGoalMinutes', 'bodyProfile',
  'weightGoal', 'proteinPerWeight', 'activeEnergyBoost', 'waterExerciseBoost', 'tag_registry',
  'grocery_aisle_order', 'grocery_aisle_hidden', 'grocery_aisle_overrides', 'grocery_aisle_nonfood',
  'medication_archived', 'medication_registered', 'medication_settings', 'savedEvents', 'sunLocation',
];
/** Lower it when you take one off `NOT_DECIDED`; never raise it. */
const NOT_DECIDED_MAX = 33;

const ALL_LISTED = [...Object.values(NOT_EXPOSED).flat(), ...NOT_DECIDED];

const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

/** The quoted entries of `SYNCED_SETTING_KEYS`, read from source like `taskFieldCoverage` reads `Task`. */
function syncedKeys(): string[] {
  const src = read('src', 'db', 'syncTracking.ts');
  const start = src.indexOf('export const SYNCED_SETTING_KEYS');
  const body = src.slice(start, src.indexOf('];', start));
  return [...body.matchAll(/^\s+'(\w+)',?/gm)].map(m => m[1]);
}

/** Keys list_automations and set_automation reach through `GENERATED_KIND_LIST`. */
function automationKeys(): Set<string> {
  const keys = new Set([...read('src', 'utils', 'generatedTasks.ts').matchAll(/enabledKey: '(\w+)'/g)].map(m => m[1]));
  const categories = read('src', 'store', 'useCategoryStore.ts');
  const start = categories.indexOf('function generatedCategorySetting');
  for (const m of categories.slice(start, categories.indexOf('\n}\n', start)).matchAll(/key: '(\w+)'/g)) keys.add(m[1]);
  return keys;
}

/** Every non-test source file of the server, joined. */
function serverSource(dir = join(ROOT, 'mcp', 'src')): string {
  return readdirSync(dir, { withFileTypes: true })
    .map(e => {
      if (e.isDirectory()) return e.name === '__tests__' ? '' : serverSource(join(dir, e.name));
      return e.name.endsWith('.ts') ? readFileSync(join(dir, e.name), 'utf8') : '';
    })
    .join('\n');
}

const mentioned = (source: string, key: string) => new RegExp(`\\b${key}\\b`).test(source);

describe('Synced settings and the MCP server', () => {
  const keys = syncedKeys();
  const automations = automationKeys();
  const source = serverSource();
  const handled = (key: string) => mentioned(source, key) || automations.has(key);

  it('finds the synced settings and the automation keys', () => {
    // A parse that quietly found nothing would pass everything below.
    expect(keys.length).toBeGreaterThan(200);
    expect(keys).toContain('dayResetTime');
    expect(automations.has('reachOutTasks')).toBe(true);
    expect(automations.has('mealCookTaskCategory')).toBe(true);
  });

  it('has a decision for every synced setting', () => {
    expect(keys.filter(k => !handled(k) && !ALL_LISTED.includes(k))).toEqual([]);
  });

  it('lists no setting twice', () => {
    expect(ALL_LISTED.filter((k, i) => ALL_LISTED.indexOf(k) !== i)).toEqual([]);
  });

  it('keeps the lists honest', () => {
    const gone = ALL_LISTED.filter(k => !keys.includes(k));
    const nowExposed = ALL_LISTED.filter(handled);
    expect({ gone, nowExposed }).toEqual({ gone: [], nowExposed: [] });
  });

  it('never grows the undecided backlog', () => {
    expect(NOT_DECIDED.length).toBeLessThanOrEqual(NOT_DECIDED_MAX);
  });
});
