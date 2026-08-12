/**
 * Demo mode swaps the whole SQLite data source out from under the stores, so
 * what needs proving here is containment: while it's on, nothing reads or
 * writes the user's real database, and turning it off puts everything back
 * exactly as it was.
 *
 * expo-sqlite is mocked with better-sqlite3 keyed BY DATABASE NAME (unlike
 * database.test.ts, which only ever needs one), so 'todo.db' and 'demo.db'
 * are genuinely separate stores and a leak between them would show up as a
 * real test failure rather than being papered over by a shared handle.
 */
import { useDemoStore } from '../store/useDemoStore';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { extractPlaceholders, declaresRunPlaceholder } from '../utils/templateUtils';
import { pantryEntries } from '../utils/grocerySuggest';
import { taskKindOf } from '../utils/taskKinds';
import { apportionedMinutes, timerSegments } from '../utils/timerSegments';
import { extraTaskRule } from '../utils/extraTask';
import { isDialable } from '../utils/phone';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { shouldNudgePostpone, DEFAULT_POSTPONE_THRESHOLD, driftingTasks } from '../utils/postpone';
import { isUsingDemoDatabase } from '../db/database';
import { RECIPE_MEAL_TYPES } from '../types';
import { freshnessOf, isLiveLeftover } from '../utils/leftovers';
import { planTrip, summarizeTrip, describeTripSuggestion } from '../utils/shoppingTrip';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDbs: Map<string, any>;
// Set by the "survives a failed delete" test to reproduce what the device
// actually does when the file can't be removed — deleteDatabaseSync throws
// if the database is still open, and never removes -wal/-shm sidecars.
let mockDeleteThrows = false;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BS = require('better-sqlite3');
  mockDbs = new Map();

  const handleFor = (name: string) => {
    // Resolved per call, not captured: deleting a database and then using a
    // handle to it again has to come back empty rather than throwing, the
    // same as reopening a deleted file on device would.
    const raw = () => {
      if (!mockDbs.has(name)) mockDbs.set(name, new BS(':memory:'));
      return mockDbs.get(name);
    };
    return {
      execSync(sql: string) {
        raw().exec(sql);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) {
        raw().prepare(sql).run(...params);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAllSync<T>(sql: string, params: any[] = []): T[] {
        return raw().prepare(sql).all(...params) as T[];
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFirstSync<T>(sql: string, params: any[] = []): T | null {
        return (raw().prepare(sql).get(...params) as T) ?? null;
      },
      withTransactionSync(fn: () => void) {
        raw().transaction(fn)();
      },
      closeSync() {
        // Left open on purpose: deleteDatabaseSync below is what discards the
        // demo data, and closing an in-memory better-sqlite3 handle the mock
        // may hand out again would break the next open.
      },
    };
  };

  return {
    openDatabaseSync: (name: string) => handleFor(name),
    deleteDatabaseSync: (name: string) => {
      if (mockDeleteThrows) throw new Error('DeleteDatabaseException');
      mockDbs.delete(name);
    },
  };
});

// Same as useTaskStore.test.ts: stubbed to keep react-native out of the
// module graph. Reminder hygiene across the swap comes free — initialize()
// already reschedules from whichever task list it just loaded.
jest.mock('../utils/notifications', () => ({
  scheduleTaskReminder: jest.fn(),
  cancelTaskReminder: jest.fn(),
  rescheduleAllReminders: jest.fn(),
}));

// ---------------------------------------------------------------------------

function realDbTaskTitles(): string[] {
  return (mockDbs.get('todo.db').prepare('SELECT title FROM tasks').all() as { title: string }[])
    .map(r => r.title);
}

beforeEach(() => {
  mockDeleteThrows = false;
  if (useDemoStore.getState().active) useDemoStore.getState().exitDemoMode();
  mockDbs.clear();
  useTaskStore.getState().initialize();
});

describe('demo mode', () => {
  it('replaces the real task list and restores it on exit', () => {
    useTaskStore.getState().addTask({ title: 'Real private task', category: 'Finance' });
    const realTasks = useTaskStore.getState().tasks.map(t => t.title);
    expect(realTasks).toEqual(['Real private task']);

    useDemoStore.getState().enterDemoMode();

    const demoTitles = useTaskStore.getState().tasks.map(t => t.title);
    expect(useDemoStore.getState().active).toBe(true);
    expect(isUsingDemoDatabase()).toBe(true);
    expect(demoTitles.length).toBeGreaterThan(10);
    expect(demoTitles).not.toContain('Real private task');

    useDemoStore.getState().exitDemoMode();

    expect(useDemoStore.getState().active).toBe(false);
    expect(isUsingDemoDatabase()).toBe(false);
    expect(useTaskStore.getState().tasks.map(t => t.title)).toEqual(realTasks);
  });

  it('hides real categories, tags, projects and stacks too, not just tasks', () => {
    useTaskStore.getState().addCategory('Therapy');
    useTaskStore.getState().addTag('confidential');
    useProjectStore.getState().createProject('Divorce paperwork', null, null);
    useTaskGroupStore.getState().createGroup('Medications', null);

    useDemoStore.getState().enterDemoMode();

    expect(useCategoryStore.getState().categories.map(c => c.name)).not.toContain('Therapy');
    expect(useTaskStore.getState().tagRegistry).not.toContain('confidential');
    expect(useProjectStore.getState().projects.map(p => p.title)).not.toContain('Divorce paperwork');
    expect(useTaskGroupStore.getState().groups.map(g => g.title)).not.toContain('Medications');

    // ...and they're all still there afterwards.
    useDemoStore.getState().exitDemoMode();
    expect(useCategoryStore.getState().categories.map(c => c.name)).toContain('Therapy');
    expect(useTaskStore.getState().tagRegistry).toContain('confidential');
    expect(useProjectStore.getState().projects.map(p => p.title)).toContain('Divorce paperwork');
    expect(useTaskGroupStore.getState().groups.map(g => g.title)).toContain('Medications');
  });

  it('writes nothing to the real database while demo mode is on', () => {
    useTaskStore.getState().addTask({ title: 'Real private task' });
    const before = realDbTaskTitles();

    useDemoStore.getState().enterDemoMode();
    // Everything a user might do during a demo, aimed at the real db if the
    // swap were incomplete.
    useTaskStore.getState().addTask({ title: 'Added during the demo' });
    const first = useTaskStore.getState().tasks[0];
    useTaskStore.getState().updateTask(first.id, { title: 'Renamed during the demo' });
    useTaskStore.getState().completeTask(useTaskStore.getState().tasks[1].id);
    useTaskStore.getState().addCategory('Made up in the demo');

    expect(realDbTaskTitles()).toEqual(before);

    useDemoStore.getState().exitDemoMode();
    expect(realDbTaskTitles()).toEqual(before);
    expect(useTaskStore.getState().tasks.map(t => t.title)).toEqual(before);
  });

  it('discards the demo database, so a second demo starts clean', () => {
    useDemoStore.getState().enterDemoMode();
    const seeded = useTaskStore.getState().tasks.length;
    useTaskStore.getState().addTask({ title: 'Scribbled in the first demo' });
    useDemoStore.getState().exitDemoMode();

    useDemoStore.getState().enterDemoMode();
    expect(useTaskStore.getState().tasks.map(t => t.title))
      .not.toContain('Scribbled in the first demo');
    expect(useTaskStore.getState().tasks.length).toBe(seeded);
    useDemoStore.getState().exitDemoMode();
  });

  it('starts clean even when the demo file survives being deleted', () => {
    mockDeleteThrows = true;

    useDemoStore.getState().enterDemoMode();
    const seeded = useTaskStore.getState().tasks.length;
    useTaskStore.getState().addTask({ title: 'Scribbled in the first demo' });
    useDemoStore.getState().exitDemoMode();

    // The file is still sitting there with the first demo's rows in it, so
    // entering again has to wipe it rather than assume it's gone.
    useDemoStore.getState().enterDemoMode();
    expect(useTaskStore.getState().tasks.map(t => t.title))
      .not.toContain('Scribbled in the first demo');
    expect(useTaskStore.getState().tasks.length).toBe(seeded);

    // And a failed delete must never strand the app on the demo database.
    useDemoStore.getState().exitDemoMode();
    expect(isUsingDemoDatabase()).toBe(false);
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it('ignores a repeated enter or exit rather than reseeding or double-swapping', () => {
    useDemoStore.getState().enterDemoMode();
    const seeded = useTaskStore.getState().tasks.length;
    useDemoStore.getState().enterDemoMode();
    expect(useTaskStore.getState().tasks.length).toBe(seeded);

    useDemoStore.getState().exitDemoMode();
    useDemoStore.getState().exitDemoMode();
    expect(isUsingDemoDatabase()).toBe(false);
  });

  it('seeds something into every view the app has', () => {
    useDemoStore.getState().enterDemoMode();
    const s = useTaskStore.getState();

    expect(s.visibleTasks().length).toBeGreaterThan(0);   // Today
    expect(s.deferredTasks().length).toBeGreaterThan(0);  // Later
    expect(s.unscheduledTasks().length).toBeGreaterThan(0);
    expect(s.inboxTasks().length).toBeGreaterThan(0);
    expect(s.completedTasks().length).toBeGreaterThan(0); // Logbook / Stats
    expect(useProjectStore.getState().projects.length).toBeGreaterThan(0);
    expect(useTaskGroupStore.getState().groups.length).toBeGreaterThan(0);
    expect(useCategoryStore.getState().categories.length).toBeGreaterThan(0);
    expect(s.tagRegistry.length).toBeGreaterThan(0);

    useDemoStore.getState().exitDemoMode();
  });

  // The editor's Kind picker offers four shapes; a picker naming a kind demo
  // mode has no example of reads as a feature the app doesn't really have.
  it('seeds one task of every kind the Kind picker offers', () => {
    useDemoStore.getState().enterDemoMode();
    const { tasks } = useTaskStore.getState();

    expect(tasks.map(t => taskKindOf(t)).filter(k => k === 'chain').length).toBeGreaterThan(0);
    expect(tasks.map(t => taskKindOf(t)).filter(k => k === 'timed').length).toBeGreaterThan(0);
    expect(tasks.map(t => taskKindOf(t)).filter(k => k === 'target').length).toBeGreaterThan(0);
    expect(tasks.map(t => taskKindOf(t)).filter(k => k === 'task').length).toBeGreaterThan(0);

    // Part-done, so the row's meter shows a meter rather than an empty bar.
    const target = tasks.find(t => taskKindOf(t) === 'target')!;
    expect(target.progressCount).toBeGreaterThan(0);
    expect(target.progressCount).toBeLessThan(target.targetCount!);
    // A target always repeats — it resets by spawning its next occurrence.
    expect(target.recurrenceType).not.toBe('none');
  });

  // A timed task can hand its countdown out to its subtasks, and one that
  // hasn't reads exactly like every timed task did before that was possible.
  it('seeds a timed task with its countdown split across its subtasks', () => {
    useDemoStore.getState().enterDemoMode();
    const { tasks } = useTaskStore.getState();

    const timed = tasks.filter(t => !t.parentId && taskKindOf(t) === 'timed');
    const apportioned = timed
      .map(t => ({ task: t, subtasks: tasks.filter(s => s.parentId === t.id) }))
      .find(({ subtasks }) => apportionedMinutes(subtasks) !== null)!;

    expect(apportioned).toBeDefined();
    expect(timerSegments(apportioned.subtasks).length).toBeGreaterThan(1);
    // The task's own duration is the sum of the stretches, not a second number.
    expect(apportioned.task.timedMinutes).toBe(apportionedMinutes(apportioned.subtasks));
  });

  // A blank is invisible until a template declares one, so a demo with no
  // `{name}` in it says the app can't do this at all.
  it('seeds a template whose items declare blanks, including the run one', () => {
    useDemoStore.getState().enterDemoMode();
    const templates = useTemplateStore.getState().templates;

    expect(templates.length).toBeGreaterThan(0);
    const withBlanks = templates.filter(t => extractPlaceholders(t.items).length > 0);
    expect(withBlanks.length).toBeGreaterThan(0);
    // One blank asked for once and used by several items is the point of them.
    const shared = extractPlaceholders(withBlanks[0].items)[0];
    expect(withBlanks[0].items.filter(i => i.title.includes(`{${shared}}`)).length).toBeGreaterThan(1);
    expect(templates.some(t => declaresRunPlaceholder(t.items))).toBe(true);
  });

  // A rule nothing has a row for reads as a field that does nothing.
  it('seeds a task that adds an extra task every Nth completion', () => {
    useDemoStore.getState().enterDemoMode();
    const withRule = useTaskStore.getState().tasks.filter(t => extraTaskRule(t) !== null);

    expect(withRule.length).toBeGreaterThan(0);
    // Partway through the cycle, so the editor's caption describes a rule in
    // progress rather than one nobody has started.
    const rule = extraTaskRule(withRule[0])!;
    expect(withRule[0].extraTaskTally).toBeGreaterThan(0);
    expect(withRule[0].extraTaskTally).toBeLessThan(rule.everyN);
    // The tally only advances on a completion that advances the schedule, so a
    // rule on a one-off task could never reach its count.
    expect(withRule[0].recurrenceType).not.toBe('none');
  });

  // No number on any task means no call/text button anywhere in the demo.
  it('seeds a task carrying a phone number', () => {
    useDemoStore.getState().enterDemoMode();
    const withPhone = useTaskStore.getState().tasks.filter(t => isDialable(t.phoneNumber));

    expect(withPhone.length).toBeGreaterThan(0);
  });

  it('seeds a reference-list project excluded from every nudge', () => {
    // A checklist project like Gift ideas has nothing but undated tasks —
    // exactly what would otherwise read as "gone quiet" — so the seed only
    // demonstrates the opt-out (Project.nudgeOptIn) if it's really off here.
    useDemoStore.getState().enterDemoMode();

    const giftIdeas = useProjectStore.getState().projects.find(p => p.title === 'Gift ideas');
    expect(giftIdeas?.nudgeOptIn).toBe(false);

    const members = useTaskStore.getState().tasks.filter(t => t.projectId === giftIdeas?.id);
    expect(members.length).toBeGreaterThan(0);
    expect(members.every(t => !t.dueDate)).toBe(true);
  });

  it('seeds a task that has been pushed enough times to trip the postpone check', () => {
    // Invisible until something has a history: a fresh demo database has none,
    // so without a stamped count the date picker never shows the prompt and the
    // feature reads as one the app doesn't have.
    useDemoStore.getState().enterDemoMode();

    const pushed = useTaskStore.getState().tasks.filter(t => t.postponeCount > 0);
    expect(pushed.length).toBeGreaterThan(0);
    expect(
      pushed.some(t => shouldNudgePostpone(t, true, DEFAULT_POSTPONE_THRESHOLD)),
    ).toBe(true);

    useDemoStore.getState().exitDemoMode();
  });

  it('seeds enough drift for the Drift screen to be a list, dated', () => {
    // Same reasoning one step on: a screen with one row doesn't show that it
    // ranks, and a row with no driftingSince doesn't show the "first put off"
    // line that is half of what the screen adds over the count alone.
    useDemoStore.getState().enterDemoMode();

    const drifting = driftingTasks(
      useTaskStore.getState().tasks,
      DEFAULT_POSTPONE_THRESHOLD,
    );
    expect(drifting.length).toBeGreaterThan(1);
    expect(drifting.every(e => e.since !== null)).toBe(true);
    // Worst first.
    expect(drifting[0].count).toBeGreaterThanOrEqual(drifting[1].count);

    useDemoStore.getState().exitDemoMode();
  });
});

/**
 * The demo is what someone handed the phone actually sees, so a capability
 * with no seeded row reads as one the app doesn't have. These pin the
 * features that are otherwise invisible — a composed recipe, an either/or
 * group, a per-store link, a container in the fridge — rather than re-testing
 * the stores, which have their own suites.
 */
describe('demo seed — groceries, recipes, meals and the fridge', () => {
  beforeEach(() => {
    useDemoStore.getState().enterDemoMode();
  });
  afterEach(() => {
    useDemoStore.getState().exitDemoMode();
  });

  it('seeds a grocery catalog bigger than the list, with a trip in progress', () => {
    const { items } = useGroceryStore.getState();
    const onList = items.filter(i => i.onList);

    expect(onList.length).toBeGreaterThan(5);
    // Bought before but not on the list right now — what Buy again reads.
    expect(items.filter(i => !i.onList && i.inCatalog).length).toBeGreaterThan(0);
    // Mid-trip: something already in the trolley, so the finish sheet has work.
    expect(onList.some(i => i.checked)).toBe(true);
    expect(items.some(i => i.quantity)).toBe(true);
    expect(items.some(i => i.note)).toBe(true);
    // Spread purchase counts, not a flat list of ones — the ranking signal.
    expect(Math.max(...items.map(i => i.purchaseCount))).toBeGreaterThan(1);
    // Attributed to the recipe that put it there.
    expect(items.some(i => i.sourceRecipeId)).toBe(true);
    // The pantry override, both directions.
    const now = Date.now();
    expect(items.some(i => i.onHandUntil && Date.parse(i.onHandUntil) > now)).toBe(true);
    expect(items.some(i => i.onHandUntil && Date.parse(i.onHandUntil) < now)).toBe(true);
    // Salt and pepper — always on hand, grouped away from "Need to buy" when
    // a recipe's ingredients get added to the list.
    expect(items.some(i => i.isStaple)).toBe(true);
    // …and so the Pantry view has a pantry to browse. Every row in it is an
    // assertion (finishing a trip stamps one on what it bought): the cadence
    // guess needs a row older than its purchases, and a seeded row is created
    // this instant, so the guessed half of the list can't be seeded.
    expect(pantryEntries(items, new Date()).length).toBeGreaterThan(5);
  });

  it('seeds stores, per-store links and an edited walk order', () => {
    const { shops, itemShops, aisleOrder, hiddenAisles, items } = useGroceryStore.getState();

    expect(shops.length).toBeGreaterThanOrEqual(3);
    // "It has everything, but don't send me there".
    expect(shops.some(s => s.excludeFromSuggestions)).toBe(true);
    // All three link kinds: observed on a trip, asserted by hand, and the
    // negative claim — "they don't stock it", which is invisible in the app
    // until something carries it.
    expect(itemShops.some(l => l.purchaseCount > 0)).toBe(true);
    expect(itemShops.some(l => l.purchaseCount === 0 && !l.unavailableAt)).toBe(true);
    expect(itemShops.some(l => l.unavailableAt)).toBe(true);
    // A section the user added, one they deleted, and a moved built-in.
    expect(aisleOrder).toContain('Bulk bins');
    expect(hiddenAisles).toContain('Personal Care');
    expect(aisleOrder).not.toContain('Personal Care');
    expect(items.some(i => i.aisle === 'Bulk bins')).toBe(true);
    expect(aisleOrder.indexOf('Frozen')).toBeGreaterThan(aisleOrder.indexOf('Pantry'));

    // …and enough of them on the seeded list for the card at the top of the
    // Groceries screen to have something to say. It renders nothing when the
    // suggestion is empty, so a seed that shopped its whole list clean would
    // read as a feature the app hasn't got.
    const plan = planTrip(items, itemShops, shops);
    expect(plan.coverage.length).toBeGreaterThanOrEqual(2);
    expect(
      describeTripSuggestion(summarizeTrip([], plan).suggestion, plan.itemIds.length)
    ).not.toBeNull();
  });

  it('seeds a recipe of every meal type, with the composed ones composed', () => {
    const { recipes } = useRecipeStore.getState();

    // The box groups by meal type, so a missing type reads as a missing section.
    RECIPE_MEAL_TYPES.forEach(type => {
      expect(recipes.some(r => r.mealType === type)).toBe(true);
    });

    // One recipe used inside two others — the whole point of a reference.
    const componentCounts = new Map<string, number>();
    recipes.forEach(r =>
      r.components.forEach(c => componentCounts.set(c.recipeId, (componentCounts.get(c.recipeId) ?? 0) + 1))
    );
    expect(Math.max(0, ...componentCounts.values())).toBeGreaterThan(1);

    // Either/or at both levels, and never as one line reading "a or b".
    expect(recipes.some(r => r.components.filter(c => c.choiceGroup).length >= 2)).toBe(true);
    expect(recipes.some(r => r.ingredients.filter(i => i.choiceGroup).length >= 2)).toBe(true);
    expect(recipes.every(r => r.ingredients.every(i => !/\bor\b/.test(i.name)))).toBe(true);

    // The ingredient-line detail the parser splits out, and the editor's labels.
    expect(recipes.some(r => r.ingredients.some(i => i.section))).toBe(true);
    expect(recipes.some(r => r.ingredients.some(i => i.prep))).toBe(true);
    expect(recipes.some(r => r.ingredients.some(i => i.purpose))).toBe(true);
  });

  it('seeds recipe duration, cook history, attribution and a live timer', () => {
    const { recipes } = useRecipeStore.getState();

    expect(recipes.some(r => r.favorite)).toBe(true);
    expect(recipes.some(r => r.tags.length > 1)).toBe(true);
    expect(recipes.some(r => r.estimatedMinutes && r.prepMinutes)).toBe(true);
    expect(recipes.some(r => r.servings && r.servingsMax)).toBe(true);
    expect(recipes.some(r => r.recipeYield)).toBe(true);
    expect(recipes.some(r => r.prepTasks.some(p => p.reminderOffsetMinutes !== null))).toBe(true);
    expect(recipes.some(r => r.cookCount > 1 && r.lastCookedAt)).toBe(true);
    expect(recipes.some(r => r.timerStartedAt)).toBe(true);
    // All three attribution shapes — a URL, a byline, and a cookbook page.
    expect(recipes.some(r => r.sourceUrl)).toBe(true);
    expect(recipes.some(r => r.author && r.source)).toBe(true);
    expect(recipes.some(r => r.sourceType === 'cookbook' && r.sourcePage)).toBe(true);
  });

  it('seeds a plan with history, a scaled meal, a picked side and a doubled-up night', () => {
    const { entries } = useMealPlanStore.getState();

    expect(entries.length).toBeGreaterThan(10);
    expect(entries.some(e => e.cookedAt)).toBe(true);
    expect(entries.some(e => !e.cookedAt)).toBe(true);
    // Free text is a first-class answer, so is a recipe, so is a leftover.
    expect(entries.some(e => e.recipeId)).toBe(true);
    expect(entries.some(e => !e.recipeId && !e.leftoverId)).toBe(true);
    expect(entries.some(e => e.leftoverId)).toBe(true);
    expect(entries.some(e => e.recipeScale !== 1)).toBe(true);
    expect(entries.some(e => e.recipeChoices.length > 0)).toBe(true);
    // Every slot, and two things on one of them.
    ['breakfast', 'lunch', 'dinner', 'snack'].forEach(slot => {
      expect(entries.some(e => e.slot === slot)).toBe(true);
    });
    const perSlot = new Map<string, number>();
    entries.forEach(e => {
      const key = `${e.date}|${e.slot}`;
      perSlot.set(key, (perSlot.get(key) ?? 0) + 1);
    });
    expect(Math.max(...perSlot.values())).toBeGreaterThan(1);
    // "Added to list on X" on the week header.
    expect(Object.keys(useMealPlanStore.getState().addedToListAt).length).toBeGreaterThan(0);
  });

  it('seeds cook tasks, and a meal that deliberately has none', () => {
    const { entries } = useMealPlanStore.getState();
    const { tasks } = useTaskStore.getState();

    const cookTasks = tasks.filter(t => t.mealEntryId);
    expect(cookTasks.length).toBeGreaterThan(0);
    // Each points at a meal that really exists, and says what to cook.
    cookTasks.forEach(task => {
      const entry = entries.find(e => e.id === task.mealEntryId);
      expect(entry).toBeDefined();
      expect(task.title).toBe(`Cook ${entry!.title}`);
    });
    // Segmented to its slot — the mechanism that keeps dinner off the morning.
    expect(cookTasks.some(t => t.timeSegments.includes('evening'))).toBe(true);

    // The per-meal opt-out is invisible unless something uses it.
    expect(entries.some(e => e.cookTask === false)).toBe(true);
    expect(entries.some(e => e.cookTask === null)).toBe(true);

    // Nothing spawned for free text or for a leftover night.
    const freeOrLeftover = entries.filter(e => !e.recipeId || e.leftoverId).map(e => e.id);
    expect(cookTasks.every(t => !freeOrLeftover.includes(t.mealEntryId!))).toBe(true);
  });

  it('seeds use-by dates, and one item opted in to a use-up task', () => {
    const { items } = useGroceryStore.getState();
    const { tasks } = useTaskStore.getState();

    // The finished trips date whatever the shelf-life lexicon recognises, and
    // leave the store-cupboard rows alone.
    expect(items.filter(i => i.expiresAt).length).toBeGreaterThan(1);
    expect(items.find(i => i.nameKey === 'rice')!.expiresAt).toBeNull();

    // The per-item opt-in, which is the only thing that can produce a task
    // while the setting is off — as it is by default, demo included.
    const optedIn = items.find(i => i.useUpTask === true)!;
    expect(optedIn).toBeDefined();
    expect(optedIn.expiresAt).not.toBeNull();

    const useUpTasks = tasks.filter(t => t.groceryItemId);
    expect(useUpTasks).toHaveLength(1);
    expect(useUpTasks[0].groceryItemId).toBe(optedIn.id);
    expect(useUpTasks[0].title).toBe(`Use up ${optedIn.name}`);
    // Dated off the use-by day rather than off today, with the day itself
    // carried as the deadline.
    expect(useUpTasks[0].deadline).not.toBeNull();
  });

  it('seeds a fridge covering every freshness state and both endings', () => {
    const { leftovers } = useLeftoverStore.getState();
    const live = leftovers.filter(isLiveLeftover);

    expect(new Set(live.map(l => freshnessOf(l)))).toEqual(
      new Set(['fresh', 'soon', 'due', 'over'])
    );
    // Logged off a cooked meal, and logged by hand with no recipe behind it.
    expect(live.some(l => l.recipeId && l.sourceEntryId)).toBe(true);
    expect(live.some(l => !l.recipeId)).toBe(true);
    // "We ate it" and "it went off" are the two things the feature tells apart.
    expect(leftovers.some(l => l.outcome === 'eaten')).toBe(true);
    expect(leftovers.some(l => l.outcome === 'tossed')).toBe(true);
  });
});

/**
 * The seed follows the setting: someone who has put the groceries/recipes/meal
 * plan area away shouldn't get a demo full of shops and dinners they can't
 * open. It's the one branch in the seed, so it's checked from both sides.
 */
describe('demo seed — with the groceries area turned off', () => {
  beforeEach(() => {
    useSettingsStore.setState({ kitchenEnabled: false });
    useDemoStore.getState().enterDemoMode();
  });
  afterEach(() => {
    useDemoStore.getState().exitDemoMode();
    useSettingsStore.setState({ kitchenEnabled: true });
  });

  it('seeds no groceries, recipes, meals or leftovers', () => {
    expect(useGroceryStore.getState().items).toHaveLength(0);
    expect(useRecipeStore.getState().recipes).toHaveLength(0);
    expect(useMealPlanStore.getState().entries).toHaveLength(0);
    expect(useLeftoverStore.getState().leftovers).toHaveLength(0);
  });

  it('still seeds the tasks, which are the rest of the demo', () => {
    // The gate has to take the kitchen block and nothing else with it — a
    // seed that bailed early would leave an empty app rather than a task app.
    expect(useTaskStore.getState().tasks.length).toBeGreaterThan(0);
  });

  it('spawns no cook tasks, so Today has nothing pointing at a hidden screen', () => {
    expect(useTaskStore.getState().tasks.some(t => t.mealEntryId)).toBe(false);
  });
});
