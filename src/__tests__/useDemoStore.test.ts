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
import { addDays } from 'date-fns/addDays';
import { useDemoStore } from '../store/useDemoStore';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { usePersonStore } from '../store/usePersonStore';
import { useProjectStore, projectDecisions, projectProgress } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useFocusStore } from '../store/useFocusStore';
import { isFocusRunning } from '../utils/focusPlan';
import { useGroceryStore } from '../store/useGroceryStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { extractPlaceholders, declaresRunPlaceholder } from '../utils/templateUtils';
import { pantryEntries } from '../utils/grocerySuggest';
import { substituteQuantity, substitutesFor } from '../utils/itemSubs';
import { standingSwapMap } from '../utils/standingSwaps';
import { normalizeGtin } from '../utils/gtin';
import { classifyPlanned, plannedIngredientsForRecipe } from '../utils/mealPlanGroceries';
import { flattenRecipeIngredients, recipeMap } from '../utils/recipeComponents';
import { catalogMatchSummary, matchIngredientsToCatalog } from '../utils/ingredientCatalogMatch';
import { cookSteps, stepsFromNotes } from '../utils/cookMode';
import { kitchenEvents, kitchenHistoryDays } from '../utils/kitchenHistory';
import { mealSlotSourceId, parseMealSlotSource } from '../utils/mealSlotTasks';
import type { MealSlot } from '../types';
import {
  countLikelyInPantry,
  describePantryCoverage,
  describeRecipe,
  pantryCoverageForRecipe,
  scoreRecipeAgainstCatalog,
} from '../utils/recipeUtils';
import { taskKindOf } from '../utils/taskKinds';
import { apportionedMinutes, timerSegments } from '../utils/timerSegments';
import { extraTaskDraftIsEmpty, extraTaskRule } from '../utils/extraTask';
import { isDialable } from '../utils/phone';
import { resolveTitleRules, titleRuleBacklog } from '../utils/titleRules';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSharedLinkStore } from '../store/useSharedLinkStore';
import { sharedLinkLabel } from '../utils/sharedRecipeLinks';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { usePersonNoteStore } from '../store/usePersonNoteStore';
import { isStaleNote } from '../utils/personNotes';
import { mealYearRange, taskYearRange, timeTogetherInRange } from '../utils/peopleStats';
import { PERSON_NOTE_KINDS } from '../types';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { shouldNudgePostpone, DEFAULT_POSTPONE_THRESHOLD, driftingTasks } from '../utils/postpone';
import { isUsingDemoDatabase } from '../db/database';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { countPlannedSlots, MEAL_PLAN_NUDGE_SLOT_COUNT } from '../utils/mealPlanNudge';
import { RECIPE_MEAL_TYPES, LEFTOVER_KEEP_DAYS_DEFAULT } from '../types';
import { freshnessOf, isLiveLeftover, needsAttention, suggestableLeftovers } from '../utils/leftovers';
import { liveExpiresAt, openShelfLifeDaysFor } from '../utils/groceryShelfLife';
import {
  cookingWindow,
  hasCookingData,
  leftoverHistoryIn,
  mealCookCounts,
  mostCookedRecipes,
} from '../utils/cookingStats';
import { buildKitchenSections, describeKitchen, FREEZER_SECTION, kitchenInventory, useUpEntries } from '../utils/kitchenInventory';
import { useUpRecipes } from '../utils/useUpRecipes';
import { probablyHaveReason } from '../utils/grocerySuggest';
import { describeDisposalHistory, wantsShelfLifePrompt } from '../utils/itemDisposal';
import { liveGeneratedTask } from '../utils/generatedTasks';
import { projectQuietDays, wantedProjectReviews } from '../utils/projectReviewTasks';
import { wantedPantryChecks } from '../utils/pantryCheckTasks';
import { mealShortfallRows, staleMealShortfallTasks } from '../utils/mealShortfallTasks';
import {
  canHoldSupply,
  describeSupply,
  describeSupplyStock,
  suppliesStockedFrom,
  supplyReorderReason,
  wantedSupplyReorders,
} from '../utils/supply';
import { findProjectStalls } from '../utils/projectPull';
import { kitchenContextRows, plannedUsesToday } from '../utils/dayContextRows';
import { planTrip, summarizeTrip, describeShopCoverage } from '../utils/shoppingTrip';
import {
  cheapestShopFor,
  describePriceStanding,
  describeShopPrices,
  priceStandingFor,
  shopPricesFor,
} from '../utils/groceryPrice';
import { describeRecipeCost, estimateRecipeCost } from '../utils/recipeCost';
import { asksOnCompletion, chainStepDatedByAnswer, formatTaskDeliverable } from '../utils/deliverables';
import { tripMarkerFor, describeTripMarker } from '../utils/activeTrip';
import { buildDayBuckets, canProject } from '../utils/calendarMonth';
import { buildDayLoads, describeDayLoad, weightFor } from '../utils/dayLoad';
import {
  buildLookAhead,
  describeLookAheadLead,
  describeLookAheadLoad,
} from '../utils/lookAhead';
import { buildCalendarGrid } from '../utils/calendarGrid';

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
  // Reached through useTaskStore.initialize, which fans out to useFocusStore.
  scheduleFocusStepAlarm: jest.fn().mockResolvedValue(undefined),
  cancelFocusStepAlarm: jest.fn().mockResolvedValue(undefined),
  // The demo seed starts a trip (demoSeed.ts), which goes through
  // useGroceryStore's real startTrip/endTrip.
  scheduleTripReminder: jest.fn(),
  cancelTripReminder: jest.fn(),
}));

// Same reason: useTaskStore.ts reaches calendarSync.ts (real react-native
// import) both directly (deleteCalendarEvent) and via deadlineCalendarSync.ts
// (syncDeadlineEvent).
jest.mock('../utils/calendarSync', () => ({
  deleteCalendarEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/deadlineCalendarSync', () => ({
  syncDeadlineEvent: jest.fn().mockResolvedValue(null),
}));
// And the same again for the time-block half (#1492), which reaches the
// calendar store for a window of events to fit a block into — that one imports
// AppState directly.
jest.mock('../store/useCalendarStore', () => ({
  useCalendarStore: { getState: () => ({ events: [], loaded: false }) },
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

  // Every other pinned row in the seed is a single task, so nothing else
  // would catch a later edit that dropped the pinGroup call or unpinned a
  // member — the stack editor's pin-all button would read as untested.
  it('seeds a stack pinned as a whole, via pinGroup rather than a lone pinned task', () => {
    useDemoStore.getState().enterDemoMode();
    const { tasks } = useTaskStore.getState();
    const { groups } = useTaskGroupStore.getState();

    const supplements = groups.find(g => g.title === 'Supplements');
    expect(supplements).toBeDefined();
    const members = tasks.filter(t => t.groupId === supplements!.id && !t.completed);
    expect(members.length).toBeGreaterThan(0);
    expect(members.every(t => t.pinned)).toBe(true);

    useDemoStore.getState().exitDemoMode();
  });

  // A focus session shows nothing at all until one is running: the bar on
  // Today, the session screen, splitting a long task across stretches and the
  // breaks between them are every one of them invisible on an idle app. What
  // this asserts is the *shape* the plan builder made of the two seeded tasks,
  // not just that a session exists, since a queue that produced one flat
  // stretch would demo none of it.
  it('seeds a focus session in flight, with a split task and a break in it', () => {
    useDemoStore.getState().enterDemoMode();
    const { session } = useFocusStore.getState();

    expect(session).not.toBeNull();
    expect(isFocusRunning(session!)).toBe(true);
    expect(session!.stepIndex).toBe(0);

    // The long task was cut into more than one stretch...
    const split = session!.steps.filter(s => s.kind === 'work' && s.partCount > 1);
    expect(split.length).toBeGreaterThan(1);
    // ...and the rest rules put a break somewhere in the run.
    expect(session!.steps.some(s => s.kind === 'rest')).toBe(true);
    // Never on the end, whatever the queue was.
    expect(session!.steps[session!.steps.length - 1].kind).toBe('work');

    // Every stretch points at a task that is actually in the seeded list.
    const ids = new Set(useTaskStore.getState().tasks.map(t => t.id));
    for (const step of session!.steps) {
      if (step.kind === 'work') expect(ids.has(step.taskId!)).toBe(true);
    }

    // The session's own task-details display (notes, link) has nothing to
    // show unless the task the plan starts on actually carries one.
    const byId = new Map(useTaskStore.getState().tasks.map(t => [t.id, t]));
    const firstTask = byId.get(session!.steps[0].taskId!);
    expect(firstTask?.notes).not.toBe('');
    expect(firstTask?.linkUrl).not.toBeNull();

    useDemoStore.getState().exitDemoMode();
  });

  // The relationship can now be set from either end, so what has to exist in
  // the seed is a live pair: one task carrying the pointer and one that shows
  // as the thing it's waiting on.
  it('seeds a task held back by another', () => {
    useDemoStore.getState().enterDemoMode();
    const s = useTaskStore.getState();

    const waiter = s.tasks.find(t => t.title === 'Return the router');
    const blocker = s.tasks.find(t => t.title === 'Cancel the internet plan');
    expect(waiter?.blockedById).toBe(blocker!.id);
    expect(s.waitingTasks().map(t => t.id)).toContain(waiter!.id);
    expect(s.blockedTasksOf(blocker!.id).map(t => t.id)).toEqual([waiter!.id]);

    useDemoStore.getState().exitDemoMode();
  });

  // The Archived screen had nothing in it, so the demo showed an empty state
  // for a feature that works. Recurring and backdated, because both are what
  // its row renders — the paused schedule and when it was paused.
  it('seeds an archived recurring task', () => {
    useDemoStore.getState().enterDemoMode();
    const s = useTaskStore.getState();

    const archived = s.archivedTasks();
    expect(archived.map(t => t.title)).toContain('Swim before work');

    const swim = archived.find(t => t.title === 'Swim before work')!;
    expect(swim.recurrenceType).not.toBe('none');
    expect(swim.archivedAt).not.toBeNull();
    // Out of the daily lists entirely — that's what archiving is for.
    expect(s.visibleTasks().map(t => t.id)).not.toContain(swim.id);

    useDemoStore.getState().exitDemoMode();
  });

  // #1255: a task with nothing seeded carrying streakRequiresWindow reads as
  // a feature the app doesn't have, so one recurring habit that already has a
  // window (timeSegments) and an established streak opts in.
  it('seeds a habit whose streak requires on-time completion', () => {
    useDemoStore.getState().enterDemoMode();
    const { tasks } = useTaskStore.getState();

    const standup = tasks.find(t => t.title === 'Morning standup');
    expect(standup?.streakRequiresWindow).toBe(true);
    expect(standup?.timeSegments).toEqual(['morning']);
    expect(standup?.streakCount).toBeGreaterThan(0);

    useDemoStore.getState().exitDemoMode();
  });

  // The month grid's one distinctive mark is a dot for an occurrence that has
  // no row yet, and only a fixed-schedule recurrence with a due date produces
  // one (see canProject). Nothing else in the seed asserts that combination
  // exists, so a later edit that made every repeat complete-anchored would
  // empty the calendar of the only thing it does that a list can't.
  it('seeds a repeat the calendar can project onto days it has no row for', () => {
    useDemoStore.getState().enterDemoMode();
    const { tasks } = useTaskStore.getState();

    const projectable = tasks.filter(t => canProject(t));
    expect(projectable.length).toBeGreaterThan(0);

    const grid = buildCalendarGrid(new Date(), 0);
    const buckets = buildDayBuckets(tasks, { from: grid[0], to: grid[grid.length - 1] });
    expect([...buckets.values()].some(b => b.projectedOnly)).toBe(true);
    // And the three date signals a cell can colour are all represented.
    const kinds = new Set([...buckets.values()].flatMap(b => b.dots.map(d => d.kind)));
    expect([...kinds].sort()).toEqual(['deadline', 'defer', 'due']);

    useDemoStore.getState().exitDemoMode();
  });

  // The cue only ever marks the heavy end, so a seed where no day is heavy
  // shows a calendar that looks exactly like one without the feature.
  it('seeds a day heavy enough for the grid to say so', () => {
    useDemoStore.getState().enterDemoMode();
    const { tasks } = useTaskStore.getState();

    const grid = buildCalendarGrid(new Date(), 0);
    const buckets = buildDayBuckets(tasks, { from: grid[0], to: grid[grid.length - 1] });
    const loads = buildDayLoads(grid, buckets, { taskById: new Map(tasks.map(t => [t.id, t])) });

    const marked = [...loads.values()].filter(l => weightFor(l) !== null);
    expect(marked.length).toBeGreaterThan(0);
    // Ahead of today specifically: the cue is for the day you're about to
    // schedule onto, and a seed where only today is heavy shows half of it.
    const ahead = marked.filter(l => l.key > dayKeyOf(new Date()));
    expect(ahead.length).toBeGreaterThan(0);
    // And one of them can say how much, rather than only shading a cell —
    // the sentence needs rows that carry an estimate between them.
    expect(ahead.some(l => describeDayLoad(l) !== '')).toBe(true);

    useDemoStore.getState().exitDemoMode();
  });

  // Look ahead is a window, so a seed that stops at the edge of one shows a
  // sheet with nothing distinctive in it — no far side, and nothing to judge
  // a deadline against.
  it('seeds a window Look ahead can actually read', () => {
    useDemoStore.getState().enterDemoMode();
    const { tasks } = useTaskStore.getState();

    const today = getCurrentDayStart();
    const la = buildLookAhead(tasks, { cutoff: addDays(today, 14), now: today });

    // The window itself has work in it, priced and unpriced both, so the lead
    // and its "at least" qualifier each have something to say.
    expect(la.totals.taskCount).toBeGreaterThan(0);
    expect(la.totals.minutes).toBeGreaterThan(0);
    expect(describeLookAheadLead(la)).toContain('land');
    expect(describeLookAheadLoad(la)).not.toBe('');
    // Recurrences project into it, so the day captions have a reason to exist.
    expect(la.totals.projected).toBeGreaterThan(0);

    // And something lands past the cutoff, so setting a return date fills the
    // one bucket nothing else in the app can show.
    const away = buildLookAhead(tasks, {
      cutoff: addDays(today, 14),
      awayEnd: addDays(today, 21),
      now: today,
    });
    expect(away.away.length).toBeGreaterThan(0);
    // A deadline among them, which is the half that can actually be missed.
    expect(away.away.some(e => e.kind === 'deadline')).toBe(true);

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

  // A template that applies itself is invisible until one carries a schedule —
  // every other template's Applies itself row reads "Never", which is what a
  // capability nobody switched on looks like (#1781).
  it('seeds a template that applies itself on a schedule', () => {
    useDemoStore.getState().enterDemoMode();
    const templates = useTemplateStore.getState().templates;

    const scheduled = templates.find(t => t.schedule !== null)!;
    expect(scheduled).toBeDefined();
    expect(scheduled.schedule?.frequency).toBe('weekly');
    // It has to have something to create, or the schedule demonstrates nothing.
    expect(scheduled.items.length).toBeGreaterThan(0);
    // And it lands in a container, so a run reads as one thing rather than
    // four loose tasks appearing unattended.
    expect(scheduled.applyContainer).not.toBe('none');
  });

  // A template that asks nothing looks exactly like an app that can't ask, and
  // both kinds of question are invisible until one is declared — so the seed
  // needs a count read off the dates and a choice that decides an item.
  it('seeds a template that asks about the run, and an item conditioned on the answer', () => {
    useDemoStore.getState().enterDemoMode();
    const templates = useTemplateStore.getState().templates;

    const asking = templates.find(t => t.questions.length > 0)!;
    expect(asking).toBeDefined();

    // A number read off the two anchor dates, so a trip's length is answered by
    // picking its dates rather than typed.
    const counted = asking.questions.find(q => q.kind === 'number' && q.fromDates !== 'none')!;
    expect(counted).toBeDefined();
    // Used in a title, and used again through the arithmetic form.
    expect(asking.items.some(i => i.title.includes(`{${counted.name}}`))).toBe(true);
    expect(asking.items.some(i => i.title.includes(`{${counted.name} /`))).toBe(true);

    // And a choice with an item riding on it.
    const choice = asking.questions.find(q => q.kind === 'choice')!;
    expect(choice.options.length).toBeGreaterThan(1);
    const conditioned = asking.items.filter(i => i.conditions.length > 0);
    expect(conditioned.length).toBeGreaterThan(0);
    expect(conditioned[0].conditions[0].questionId).toBe(choice.id);
    expect(choice.options).toEqual(expect.arrayContaining(conditioned[0].conditions[0].values));
  });

  // A decision task is invisible as a *capability* until something asks a
  // question, and the answer only exists on a completed row — so the seed
  // needs both halves for the feature to read as one that exists.
  it('seeds a decision task, live and answered', () => {
    useDemoStore.getState().enterDemoMode();
    const { tasks } = useTaskStore.getState();
    const asking = tasks.filter(t => asksOnCompletion(t));

    expect(asking.length).toBeGreaterThan(0);
    // One still outstanding, so its checkbox carries the "?".
    expect(asking.some(t => !t.completed)).toBe(true);
    // And one already answered, so the Logbook shows what an answer looks like.
    const answered = asking.find(t => t.completed && t.deliverableValue !== null)!;
    expect(answered).toBeDefined();
    expect(formatTaskDeliverable(answered)).toBeTruthy();
  });

  // The one thing only a chain can do with an answer. Invisible from the rows
  // above: a decision task shows the question, not that the answer is about to
  // schedule something.
  it('seeds a chain step whose date answer places the next step', () => {
    useDemoStore.getState().enterDemoMode();
    const { tasks } = useTaskStore.getState();

    const chained = tasks.find(t => t.chainEnabled && t.chainItems.some(c => c.deliverableDatesNextStep))!;
    expect(chained).toBeDefined();
    // Live on the asking step, so the demo tap actually runs the feature.
    expect(chained.completed).toBe(false);
    expect(chainStepDatedByAnswer(chained)).not.toBeNull();
  });

  // A template item can declare the same question (#1471), and that half is
  // invisible on the task rows above — nothing says a template carried it.
  it('seeds a template item that asks on completion', () => {
    useDemoStore.getState().enterDemoMode();
    const items = useTemplateStore.getState().templates.flatMap(t => t.items);

    expect(items.some(i => i.deliverableKind !== null)).toBe(true);
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

  // A rule that only names its extra task reads as a rule that can only name
  // it — the Details row says "just the title" and nothing hints otherwise.
  it('seeds an extra-task rule that says what the added task looks like', () => {
    useDemoStore.getState().enterDemoMode();
    const withDraft = useTaskStore.getState().tasks
      .map(t => extraTaskRule(t))
      .filter((r): r is NonNullable<typeof r> => r !== null && r.draft !== null);

    expect(withDraft.length).toBeGreaterThan(0);
    const draft = withDraft[0].draft!;
    expect(extraTaskDraftIsEmpty(draft)).toBe(false);
    // The two that are invisible until the task exists, so a seed is the only
    // way anyone sees they can be set at all.
    expect(draft.subtasks.length).toBeGreaterThan(0);
    expect(draft.notes).not.toBe('');
  });

  // No number on any task means no call/text button anywhere in the demo.
  it('seeds a task carrying a phone number', () => {
    useDemoStore.getState().enterDemoMode();
    const withPhone = useTaskStore.getState().tasks.filter(t => isDialable(t.phoneNumber));

    expect(withPhone.length).toBeGreaterThan(0);
  });

  it('seeds a reminder that keeps ringing until the task is completed', () => {
    useDemoStore.getState().enterDemoMode();
    const persistent = useTaskStore.getState().tasks.filter(t => t.reminderKind === 'persistent');

    expect(persistent.length).toBeGreaterThan(0);
    // A reminder kind only means anything with a time attached to it.
    expect(persistent.every(t => t.reminderTime !== null)).toBe(true);
  });

  // A title rule is invisible until something has actually been filed by one,
  // so proving the rule exists isn't enough — what this pins is that the
  // seeded task got its category, tag and effort from the rule and not from
  // its own draft, which is the whole of what the feature does.
  it('seeds a title rule, and a task the rule filed', () => {
    useDemoStore.getState().enterDemoMode();

    const rules = useSettingsStore.getState().titleRules;
    expect(rules.length).toBeGreaterThan(0);
    const rule = rules[0];
    expect(rule.enabled).toBe(true);
    expect(rule.keywords).toContain('expense');

    const filed = useTaskStore.getState().tasks.find(t => t.title === 'Expense the client lunch');
    expect(filed).toBeDefined();
    expect(resolveTitleRules(filed!.title, rules)).not.toBeNull();
    expect(filed!.category).toBe(rule.category);
    expect(filed!.tags).toEqual(rule.tags);
    expect(filed!.effort).toBe(rule.effort);
  });

  it('leaves a backlog for a rule written in demo mode to offer to file', () => {
    useDemoStore.getState().enterDemoMode();

    const written = {
      ...useSettingsStore.getState().titleRules[0],
      id: 'demo-rule-invoice',
      keywords: ['invoice'],
      category: 'Work',
    };
    const backlog = titleRuleBacklog(useTaskStore.getState().tasks, written);
    expect(backlog.length).toBeGreaterThan(1);
    expect(backlog.every(e => e.task.title.toLowerCase().startsWith('invoice'))).toBe(true);
  });

  // The Decisions block on a project's screen has nothing to render unless a
  // project actually holds an answered decision, so without this the feature
  // reads as one the app doesn't have.
  it('seeds a project holding answered decisions', () => {
    useDemoStore.getState().enterDemoMode();

    const kitchen = useProjectStore.getState().projects.find(p => p.title === 'Kitchen refresh');
    expect(kitchen).toBeDefined();

    const decisions = projectDecisions(kitchen!.id, useTaskStore.getState().tasks);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every(t => formatTaskDeliverable(t) !== null)).toBe(true);
  });

  // The project screen captions each row with its own date (TaskItem.showDate),
  // which renders nothing at all on a project whose steps are undated.
  it('dates the project steps that are still open', () => {
    useDemoStore.getState().enterDemoMode();

    const kitchen = useProjectStore.getState().projects.find(p => p.title === 'Kitchen refresh');
    const open = useTaskStore.getState().tasks.filter(t => t.projectId === kitchen?.id && !t.completed);

    expect(open.length).toBeGreaterThan(0);
    expect(open.every(t => t.dueDate !== null || t.deferUntil !== null)).toBe(true);
    // One of each, so both readings of the chip are on screen: a due date, and
    // a task that isn't there yet.
    expect(open.some(t => t.dueDate !== null)).toBe(true);
    expect(open.some(t => t.deferUntil !== null)).toBe(true);
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

  it('seeds a completed project, separate from archived', () => {
    useDemoStore.getState().enterDemoMode();

    const hallway = useProjectStore.getState().projects.find(p => p.title === 'Repaint the hallway');
    expect(hallway?.completed).toBe(true);
    expect(hallway?.archived).toBe(false);
  });

  it('seeds a project with every task done but not yet marked complete', () => {
    useDemoStore.getState().enterDemoMode();

    const gate = useProjectStore.getState().projects.find(p => p.title === 'Fix the back gate');
    expect(gate?.completed).toBe(false);
    expect(gate?.archived).toBe(false);

    const progress = projectProgress(gate!.id, useTaskStore.getState().tasks);
    expect(progress.total).toBeGreaterThan(0);
    expect(progress.done).toBe(progress.total);
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
describe('demo seed — people', () => {
  beforeEach(() => {
    useDemoStore.getState().enterDemoMode();
  });
  afterEach(() => {
    useDemoStore.getState().exitDemoMode();
  });

  it('seeds a short, hand-added list rather than an address book', () => {
    const people = usePersonStore.getState().people;
    expect(people.length).toBeGreaterThan(0);
    // Small on purpose: a long list is the cold thing the feature is built to
    // avoid, so this guards the shape rather than an exact count.
    expect(people.length).toBeLessThanOrEqual(6);
  });

  it('seeds somebody with no birthday, which is how most people are added', () => {
    const people = usePersonStore.getState().people;
    expect(people.some(p => p.birthdayMonth === null && p.birthdayDay === null)).toBe(true);
  });

  it('seeds a nickname, which is otherwise invisible', () => {
    expect(usePersonStore.getState().people.some(p => p.nickname !== '')).toBe(true);
  });

  // Off is the default the whole feature rests on, so the seed has to show it
  // as the default rather than as a thing nobody uses: most people carry no
  // cadence at all, and exactly one is opted in so the generator is visible.
  it('leaves almost everybody with no cadence, which is the default', () => {
    const people = usePersonStore.getState().people;
    const optedIn = people.filter(p => p.nudgeOptIn);
    expect(optedIn).toHaveLength(1);
    expect(people.filter(p => !p.nudgeOptIn).every(p => p.cadenceDays === 0)).toBe(true);
  });

  it('an opted-in person has a real cadence behind the opt-in', () => {
    const optedIn = usePersonStore.getState().people.find(p => p.nudgeOptIn)!;
    expect(optedIn.cadenceDays).toBeGreaterThan(0);
  });

  // Rule 7 in one row: the clock decides when to speak, the note decides what
  // it says. Seeding the plain "Catch up with X" would show the generator but
  // not the thing that keeps it warm.
  it('puts a real catch-up task on the list, worded from the note', () => {
    const reachOuts = useTaskStore.getState().tasks.filter(t => t.generatedKind === 'reachOut');
    expect(reachOuts).toHaveLength(1);
    expect(reachOuts[0].title).toMatch(/^Ask /);
    // Same rule the birthday task follows: the app's own row must not enter a
    // history meant to hold what you actually did together.
    expect(reachOuts[0].personIds).toEqual([]);
    // And it carries the number, so the row is one tap from actually doing it.
    expect(reachOuts[0].phoneNumber).not.toBeNull();
  });

  // The generator is invisible until a birthday is close enough to fire, so
  // without a near birthday the seed would show the feature as absent.
  it('puts a real birthday task on the list', () => {
    const birthdayTasks = useTaskStore.getState().tasks.filter(t => t.generatedKind === 'birthday');
    expect(birthdayTasks.length).toBeGreaterThan(0);
    // The birthday itself rides the deadline; the due date is only when to look.
    expect(birthdayTasks[0].deadline).not.toBeNull();
    // And it names nobody, so the app's own row can't enter a history meant to
    // hold what you actually did together.
    expect(birthdayTasks[0].personIds).toEqual([]);
  });

  it('seeds tasks that name people, both planned and already done', () => {
    const tasks = useTaskStore.getState().tasks.filter(t => t.personIds.length > 0 && !t.generatedKind);
    expect(tasks.some(t => !t.completed)).toBe(true);
    expect(tasks.some(t => t.completed)).toBe(true);
  });

  it('seeds a task naming more than one person, which a single field could not hold', () => {
    const tasks = useTaskStore.getState().tasks;
    expect(tasks.some(t => t.personIds.length > 1)).toBe(true);
  });

  // Guests are the tie-in between the kitchen half and the people half, and a
  // meal plan with nobody on it reads as a feature the app doesn't have.
  it('seeds an upcoming meal with guests on it', () => {
    const withGuests = useMealPlanStore.getState().entries.filter(e => e.personIds.length > 0);
    expect(withGuests.length).toBeGreaterThan(0);
    expect(withGuests.some(e => !e.cookedAt)).toBe(true);
  });

  // It hides from Today the way a blocked task does, so the Waiting screen's
  // person sections have something to show.
  it('seeds a task waiting on somebody', () => {
    const waiting = useTaskStore.getState().tasks.filter(t => t.waitingOnPersonId !== null);
    expect(waiting.length).toBeGreaterThan(0);
    const person = usePersonStore.getState().people.find(p => p.id === waiting[0].waitingOnPersonId);
    expect(person).toBeDefined();
    expect(person!.archived).toBe(false);
  });

  // Both facts already fall out of the existing seed with no new rows: the
  // completed "Coffee with Mom" and the cooked, guested salmon dinner. A
  // regression guard rather than new demo content.
  it('has a year in review to show, from the existing seed alone', () => {
    const today = getCurrentDayStart();
    const { startIso, endIso } = taskYearRange(today);
    const timeCount = timeTogetherInRange(useTaskStore.getState().tasks, startIso, endIso);
    expect(timeCount).toBeGreaterThan(0);

    // entries only holds whatever ±14-day window seeding loaded — the real
    // read goes through the same DB-backed action Stats uses, the same call
    // refreshCookingCounts already makes for the same reason.
    const { startKey, endKey } = mealYearRange(today);
    useMealPlanStore.getState().refreshPeopleYearMealCount(startKey, endKey);
    expect(useMealPlanStore.getState().peopleYearMealCount).toBeGreaterThan(0);
  });

  it('seeds a note of every kind, since each one lands somewhere different', () => {
    const notes = usePersonNoteStore.getState().notes;
    for (const kind of PERSON_NOTE_KINDS) {
      expect(notes.some(n => n.kind === kind)).toBe(true);
    }
  });

  // The whole point of having written them down in March.
  it("carries the gift ideas onto the birthday task they were written for", () => {
    const notes = usePersonNoteStore.getState().notes;
    const gift = notes.find(n => n.kind === 'gift')!;
    const task = useTaskStore.getState().tasks
      .find(t => t.generatedKind === 'birthday' && t.generatedSourceId?.startsWith(gift.personId));
    expect(task).toBeDefined();
    expect(task!.notes).toContain(gift.text);
  });

  it('seeds a dated note and one whose day has passed, which render differently', () => {
    const today = getCurrentDayStart();
    const dated = usePersonNoteStore.getState().notes.filter(n => n.relevantOn !== null);
    expect(dated.some(n => !isStaleNote(n, today))).toBe(true);
    expect(dated.some(n => isStaleNote(n, today))).toBe(true);
  });

  it('seeds a food note on somebody who is a guest at a seeded meal', () => {
    const notes = usePersonNoteStore.getState().notes.filter(n => n.kind === 'food');
    const guestIds = new Set(useMealPlanStore.getState().entries.flatMap(e => e.personIds));
    expect(notes.some(n => guestIds.has(n.personId))).toBe(true);
  });

  it("seeds a meal that shows on its guests' own screens", () => {
    const todayKey = dayKeyOf(new Date());
    // Specifically an uncooked meal's guest — a cooked one (the steak night,
    // seeded for the year-in-review stat) has already happened and rightly
    // has nothing upcoming.
    const guest = useMealPlanStore.getState().entries
      .filter(e => !e.cookedAt)
      .flatMap(e => e.personIds)
      .find(Boolean)!;
    expect(useMealPlanStore.getState().guestMealsFor(guest, todayKey, 60).length).toBeGreaterThan(0);
  });
});

describe('demo seed — groceries, recipes, meals and the fridge', () => {
  beforeEach(() => {
    useDemoStore.getState().enterDemoMode();
  });
  afterEach(() => {
    useDemoStore.getState().exitDemoMode();
  });

  it('seeds every catalog-match state a recipe line can be in', () => {
    // The row badge and the "N of M in your groceries" count are invisible
    // until a line is in each state, so without one of each the whole matching
    // feature reads as one the app doesn't have. All three fall out of the
    // seed as written rather than being staged for this: the stir-fry asks for
    // "2 chicken breasts" against a catalog row called Chicken breast (the
    // plural tolerance in matchWeight, and the commonest near-miss there is),
    // its rice and garlic are catalog rows outright, and the salmon's own
    // fillets are the ordinary case of an ingredient nobody has catalogued.
    const recipes = useRecipeStore.getState().recipes;
    const items = useGroceryStore.getState().items;
    const lines = recipes.flatMap(r => r.ingredients.map(i => i.name));
    const matches = matchIngredientsToCatalog(lines, items, new Date());
    const summary = catalogMatchSummary(matches);

    expect(summary.linked).toBeGreaterThan(0);
    expect(summary.suggested).toBeGreaterThan(0);
    expect(summary.unknown).toBeGreaterThan(0);

    // Pinned by name as well as counted, so a reworded seed line can't quietly
    // keep this passing by putting some *other* line into the suggested state.
    const byName = new Map(lines.map((name, i) => [name, matches[i]]));
    expect(byName.get('chicken breasts')?.kind).toBe('suggested');
    expect(byName.get('chicken breasts')?.suggestedName).toBe('Chicken breast');
    expect(byName.get('rice')?.kind).toBe('linked');
    expect(byName.get('salmon fillets')?.kind).toBe('unknown');
    // Lemons is a bare CATALOG name nothing else in the seed ever touches, so
    // without its own quantity fact clearList sweeps it — same mechanism that
    // drops Cheddar and Coriander, documented where the clear itself runs.
    // Pinned here so a future edit that removes that fact fails loudly instead
    // of quietly turning the salmon's own "lemon" line unplaceable.
    expect(byName.get('lemon')?.kind).toBe('suggested');
    expect(byName.get('lemon')?.suggestedName).toBe('Lemons');
  });

  it('seeds a grocery catalog bigger than the list, with a trip in progress', () => {
    const { items, itemShops, itemProducts } = useGroceryStore.getState();
    const onList = items.filter(i => i.onList);

    expect(onList.length).toBeGreaterThan(5);
    // Not on the list right now — which is exactly what the catalog reads.
    expect(items.filter(i => !i.onList).length).toBeGreaterThan(0);
    // Mid-trip: something already in the trolley, so the finish sheet has work.
    expect(onList.some(i => i.checked)).toBe(true);
    expect(items.some(i => i.quantity)).toBe(true);
    expect(items.some(i => i.note)).toBe(true);
    // A product preference — invisible until a row carries one, so without a
    // seeded instance the feature reads as one the app doesn't have. It has to
    // sit beside the name rather than in it: the row is still plain "cottage
    // cheese" to a recipe and to its own purchase history.
    const preferred = items.find(i => i.preferredProductId);
    expect(preferred).toBeDefined();
    const preferredProduct = itemProducts.find(p => p.id === preferred!.preferredProductId)!;
    expect(preferredProduct).toBeDefined();
    expect(preferred!.nameKey).not.toContain(preferredProduct.brand!.toLowerCase());
    // ...brand and variant together, which is the pairing the caption exists to
    // compose ("Good Culture low fat"), and the brandless case beside it, which
    // is ordinary for a store's own label.
    expect(itemProducts.some(p => p.brand && p.variant)).toBe(true);
    expect(itemProducts.some(p => !p.brand && p.variant)).toBe(true);
    // ...an item with several boxes on record, which is the whole shape the
    // remodel exists for: a pair of strings could hold only the first.
    const counts = new Map<string, number>();
    for (const p of itemProducts) counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeGreaterThan(1);
    // ...and a box carrying the barcode that names it. Invisible without a
    // camera, so an unseeded link reads as a feature the app hasn't got — and
    // it has to be on a row whose name shares nothing with the box's own
    // words, since that is the case name matching cannot cover.
    const scanned = itemProducts.find(p => p.gtin);
    expect(scanned).toBeDefined();
    expect(normalizeGtin(scanned!.gtin!)).toBe(scanned!.gtin);
    const scannedItem = items.find(i => i.id === scanned!.itemId)!;
    expect(scannedItem.nameKey).not.toContain(scanned!.brand!.toLowerCase());
    expect(useGroceryStore.getState().gtinItemFor(scanned!.gtin)).toBe(scannedItem.id);
    // ...and a rating, on a box that isn't the preferred one — "the one I
    // avoid" and "the one I want" being the same row would read as a bug.
    const avoided = itemProducts.find(p => p.rating === 'avoid');
    expect(avoided).toBeDefined();
    expect(items.find(i => i.id === avoided!.itemId)!.preferredProductId).not.toBe(avoided!.id);
    // ...and two boxes of one item in two different places, which is what the
    // per-box pantry columns exist for. A frozen one and an on-hand one on the
    // same item: with one slot per item the app could only have called both of
    // them frozen.
    const frozenBox = itemProducts.find(p => p.frozenAt);
    expect(frozenBox).toBeDefined();
    const sibling = itemProducts.find(
      p => p.itemId === frozenBox!.itemId && p.id !== frozenBox!.id && p.onHandUntil
    );
    expect(sibling).toBeDefined();
    // The item itself stays out of it — a claim about one loaf is not a claim
    // about the row every recipe and every list reads.
    expect(items.find(i => i.id === frozenBox!.itemId)!.frozenAt).toBeNull();
    // ...and the rule that makes a product reach store coverage, plus the claim
    // it reads. A strict item nobody has ruled a store out for would filter
    // nothing, so the switch would look inert.
    const strict = items.find(i => i.productStrict);
    expect(strict).toBeDefined();
    expect(itemShops.some(
      l => l.itemId === strict!.id && l.unavailableProductIds[strict!.preferredProductId!]
    )).toBe(true);
    // ...while another store is left unmarked, which is what shows that not
    // having ruled a shop out still counts as it having the item.
    expect(itemShops.some(
      l => l.itemId === strict!.id && !l.unavailableProductIds[strict!.preferredProductId!]
    )).toBe(true);
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
    // …and so the Pantry view has a pantry to browse — showing *both* kinds of
    // reason, which it couldn't before #1770. A trip used to stamp an assertion
    // onto everything it bought, so every seeded row read as one and the demo
    // could only ever show corrections. A purchase is read back in its own
    // words now, and a row created this instant sits inside the flat window,
    // so the evidence line seeds like anything else.
    const pantry = pantryEntries(items, new Date());
    expect(pantry.length).toBeGreaterThan(5);
    expect(pantry.some(e => e.asserted)).toBe(true);
    expect(pantry.some(e => !e.asserted && e.reason.startsWith('bought '))).toBe(true);
    // Added straight to the pantry: never on a list and never bought — what
    // the pantry sheet's add field makes.
    expect(
      items.some(i => !i.onList && i.purchaseCount === 0 && !i.lastAddedAt)
    ).toBe(true);
  });

  it('seeds a recipe page waiting to be imported from the share sheet', () => {
    // The share extension leaves no trace until something has been shared to
    // it, so with an empty queue the Recipes screen is indistinguishable from a
    // build that can't be shared to at all — the exact case demo mode exists
    // to avoid.
    const { pendingUrls } = useSharedLinkStore.getState();
    expect(pendingUrls.length).toBeGreaterThanOrEqual(1);
    // Canonicalised on the way in, so the banner offers something the import
    // will actually accept rather than failing on the tap that opens it.
    expect(pendingUrls[0]).toMatch(/^https:\/\//);
    expect(sharedLinkLabel(pendingUrls[0])).toBe('cooking.nytimes.com');
    // Queued, not imported: it must not already be in the recipe box, or the
    // banner is offering work that's been done.
    const label = sharedLinkLabel(pendingUrls[0]);
    expect(useRecipeStore.getState().recipes.some(r => r.sourceUrl?.includes(label))).toBe(false);
  });

  it('seeds an either/or on the list, from a recipe choice left for the shelf', () => {
    const { items } = useGroceryStore.getState();
    const grouped = items.filter(i => i.onList && i.choiceGroup);

    // Two rows, one group: without this the grocery half of either/or reads as
    // a feature the app doesn't have (#1572).
    expect(grouped.length).toBeGreaterThanOrEqual(2);
    expect(new Set(grouped.map(i => i.choiceGroup)).size).toBe(1);

    // An opaque id, not the recipe's label — a grocery row renders no heading
    // for a group (see GroceryItem.choiceGroup).
    expect(grouped[0].choiceGroup).not.toContain('Chile');

    // It came off a recipe whose ingredients are alternatives, which is the
    // whole path: the recipe poses the question and the shelf answers it.
    expect(grouped.every(i => i.sourceRecipeId)).toBe(true);
    const source = useRecipeStore.getState().recipes.find(r => r.id === grouped[0].sourceRecipeId);
    expect(source!.ingredients.filter(i => i.choiceGroup).length).toBeGreaterThanOrEqual(2);

    // Each option is its own clean catalog name, never one row called
    // "serrano or jalapeño".
    expect(grouped.every(i => !/\bor\b/.test(i.nameKey))).toBe(true);
  });

  it('seeds substitutes in both directions', () => {
    const { items, itemSubs } = useGroceryStore.getState();

    // Nothing infers one of these, so a demo with none reads as an app that
    // hasn't got the feature — they're invisible until something is linked.
    const butter = items.find(i => i.name === 'Butter');
    const margarine = items.find(i => i.nameKey === 'margarine');
    expect(butter && margarine).toBeTruthy();

    const oneWay = substitutesFor(butter!.id, itemSubs, items);
    expect(oneWay.map(s => s.item.id)).toEqual([margarine!.id]);
    // The asymmetric case, and the caveat that stands in for a per-recipe scope.
    expect(oneWay[0].isMutual).toBe(false);
    expect(oneWay[0].link.note).toBeTruthy();
    expect(substitutesFor(margarine!.id, itemSubs, items)).toEqual([]);

    // ...and the symmetric one, which is two rows rather than a flag.
    const milk = items.find(i => i.name === 'Milk')!;
    const mutual = substitutesFor(milk.id, itemSubs, items);
    expect(mutual).toHaveLength(1);
    expect(mutual[0].isMutual).toBe(true);
    expect(substitutesFor(mutual[0].item.id, itemSubs, items)[0].item.id).toBe(milk.id);

    // A sub link is a user fact, so hasUserFacts keeps both stand-ins through
    // the seed's own clearList on the way past — neither row is swept.
    expect(items.some(i => i.id === margarine!.id)).toBe(true);
    expect(items.some(i => i.id === mutual[0].item.id)).toBe(true);
  });

  it('seeds a standing swap, and one line that opts out of it (#1571)', () => {
    // The one substitute setting that changes what lands in the trolley, so a
    // demo without one shows half the feature — and the per-line opt-out is
    // otherwise a toggle nobody ever sees.
    const { items, itemSubs } = useGroceryStore.getState();
    const milk = items.find(i => i.name === 'Milk')!;
    const oatMilk = items.find(i => i.nameKey === 'oat milk')!;

    const swaps = standingSwapMap(itemSubs, items);
    expect(swaps.get('milk')).toMatchObject({ to: expect.objectContaining({ id: oatMilk.id }) });
    // The both-ways reverse row is never standing, or the pair swaps into
    // itself and standingSwaps drops both.
    expect(itemSubs.find(l => l.itemId === oatMilk.id && l.subItemId === milk.id)?.standing)
      .toBe(false);

    const recipes = useRecipeStore.getState().recipes;
    const recipesById = new Map(recipes.map(r => [r.id, r]));
    const oats = recipes.find(r => r.name === 'Overnight oats')!;
    const swapped = flattenRecipeIngredients(oats, recipesById, undefined, swaps)
      .find(f => f.swappedFrom)!;
    expect(swapped.ingredient.nameKey).toBe('oat milk');
    // The recipe's own word for the line, as written — "1 cup milk".
    expect(swapped.swappedFrom).toBe('milk');
    // Read time only: the recipe still says what it said.
    expect(oats.ingredients.some(i => i.nameKey === 'milk')).toBe(true);

    // ...and the line that said no.
    const mash = recipes.find(r => r.name === 'Mashed potatoes')!;
    const mashLines = flattenRecipeIngredients(mash, recipesById, undefined, swaps);
    expect(mashLines.some(f => f.ingredient.nameKey === 'milk')).toBe(true);
    expect(mashLines.every(f => f.swappedFrom === null)).toBe(true);
  });

  it('seeds cilantro and coriander as two catalog rows, ready to merge (#1570)', () => {
    const { items, mergeItems } = useGroceryStore.getState();
    const cilantro = items.find(i => i.nameKey === 'cilantro');
    const coriander = items.find(i => i.nameKey === 'coriander');
    expect(cilantro && coriander).toBeTruthy();

    // Cilantro has a real purchase behind it; Coriander is on the list,
    // typed fresh, with none — the exact split the issue that added merging
    // describes, and why the seed leaves the two unmerged rather than
    // demonstrating the fix itself.
    expect(cilantro!.purchaseCount).toBeGreaterThan(0);
    expect(coriander!.onList).toBe(true);
    expect(coriander!.purchaseCount).toBe(0);

    // And the feature actually resolves the pair, end to end.
    expect(mergeItems(coriander!.id, cilantro!.id)).toBe(true);
    const survivor = useGroceryStore.getState().itemById(cilantro!.id)!;
    expect(survivor.onList).toBe(true);
    expect(useGroceryStore.getState().itemById(coriander!.id)).toBeNull();
  });

  it('seeds a ratio that actually converts a real recipe line (#1573)', () => {
    // The issue's own motivating example, run end to end against a real
    // seeded recipe rather than a synthetic fixture — "2 cloves garlic" is a
    // line that exists in the demo today, not one invented for the test.
    const { items, itemSubs } = useGroceryStore.getState();
    const garlic = items.find(i => i.name === 'Garlic')!;
    const garlicPowder = items.find(i => i.nameKey === 'garlic powder')!;
    expect(garlicPowder).toBeTruthy();

    const link = substitutesFor(garlic.id, itemSubs, items)[0];
    expect(link).toMatchObject({
      item: expect.objectContaining({ id: garlicPowder.id }),
      link: expect.objectContaining({ ratioFrom: '1 clove', ratioTo: '1/4 tsp' }),
    });

    const recipes = useRecipeStore.getState().recipes;
    const recipesById = new Map(recipes.map(r => [r.id, r]));
    const salmon = recipes.find(r => r.name === 'Lemon garlic salmon')!;
    const garlicLine = flattenRecipeIngredients(salmon, recipesById).find(
      f => f.ingredient.nameKey === 'garlic'
    )!;
    expect(garlicLine.ingredient.quantity).toBe('2 cloves');

    expect(
      substituteQuantity(garlicLine.ingredient.quantity, link.link.ratioFrom!, link.link.ratioTo!)
    ).toEqual({ text: '1/2 tsp', converted: true });
  });

  it('seeds a substitute that actually captions a row, without moving it', () => {
    // A link on its own says nothing — the caption needs the original wanted
    // and the substitute on hand — so the seed has to arrange both halves or
    // the read ships invisible.
    const { items, itemSubs } = useGroceryStore.getState();
    const recipes = useRecipeStore.getState().recipes;
    const recipesById = new Map(recipes.map(r => [r.id, r]));
    const usesButter = recipes.find(r =>
      flattenRecipeIngredients(r, recipesById).some(f => f.ingredient.nameKey === 'butter')
    );
    expect(usesButter).toBeTruthy();

    const rows = classifyPlanned(
      plannedIngredientsForRecipe(usesButter!, recipesById),
      items,
      new Date(),
      itemSubs
    );
    const butterRow = rows.find(r => r.nameKey === 'butter')!;

    expect(butterRow.reason).toBe('you have margarine');
    // The whole safety argument: it still has to be bought.
    expect(butterRow.category).toBe('needToBuy');
  });

  it('counts that same substitute-covered butter toward "what can I make" (#1568)', () => {
    // Same link, same state as the caption test above — the same Butter →
    // Margarine facts are what #1568's readers count toward, no new seed
    // writes needed for this capability to already be visible.
    const { items, itemSubs } = useGroceryStore.getState();
    const recipes = useRecipeStore.getState().recipes;
    const recipesById = new Map(recipes.map(r => [r.id, r]));
    const usesButter = recipes.find(r =>
      flattenRecipeIngredients(r, recipesById).some(f => f.ingredient.nameKey === 'butter')
    )!;

    const count = countLikelyInPantry(usesButter, items, new Date(), recipesById, itemSubs);
    expect(count?.viaSubstitute).toBeGreaterThanOrEqual(1);

    const coverage = pantryCoverageForRecipe(usesButter, items, new Date(), recipesById, itemSubs);
    expect(coverage.viaSubstitute).toBeGreaterThanOrEqual(1);
    expect(describeRecipe(usesButter, count)).toContain('with a substitute');
    expect(describePantryCoverage(coverage)).toContain('with a substitute');

    // Never a free ride to a higher score than the same recipe would earn if
    // butter itself were genuinely fresh — the fully-stocked read still wins.
    const scoreWithSub = scoreRecipeAgainstCatalog(usesButter, items, new Date(), recipesById, itemSubs);
    const scoreWithoutSub = scoreRecipeAgainstCatalog(usesButter, items, new Date(), recipesById);
    expect(scoreWithSub).toBeGreaterThanOrEqual(scoreWithoutSub);
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

    // …and enough of them on the seeded list for ShoppingTripSheet to open
    // with a real pre-selected suggestion rather than an empty one — that's
    // exactly what it reads off summarizeTrip([], plan).suggestion, and a
    // seed that shopped its whole list clean would read as a feature the app
    // hasn't got.
    const plan = planTrip(items, itemShops, shops);
    expect(plan.coverage.length).toBeGreaterThanOrEqual(2);
    const [head, second] = summarizeTrip([], plan).suggestion;
    expect(head?.shop.name).toBe("Trader Joe's");
    expect(describeShopCoverage(head!, plan.itemIds.length)).toMatch(/seen here/);
    // A worthwhile second stop too — Costco covers what Trader Joe's can't.
    expect(second?.shop.name).toBe('Costco');
    const alreadyAtHead = new Set(head!.itemIds);
    const nameOf = new Map(items.map(i => [i.id, i.name]));
    const adds = second!.itemIds
      .filter(id => !alreadyAtHead.has(id))
      .map(id => nameOf.get(id) ?? 'an item');
    expect(adds.sort()).toEqual(['Cottage cheese', 'Peanut butter', 'Tortillas'].sort());
  });

  it('seeds prices, including one item priced at two stores', () => {
    const { items, itemShops, shops } = useGroceryStore.getState();

    // Both halves of the split: a price on the item, and prices per store.
    expect(items.some(i => i.lastPriceMinor !== null)).toBe(true);
    expect(itemShops.some(l => l.lastPriceMinor !== null)).toBe(true);
    // A price is never left without the quantity it was for.
    for (const item of items.filter(i => i.lastPriceMinor !== null)) {
      expect(item.lastPricedAt).not.toBeNull();
    }

    // A trip with no store named prices the item and no link — the same split
    // purchaseCount already has, one field over.
    const noStore = items.filter(
      i => i.lastPriceMinor !== null && !itemShops.some(l => l.itemId === i.id && l.lastPriceMinor !== null)
    );
    expect(noStore.length).toBeGreaterThan(0);

    // And the comparison the per-store half exists for. Without an item priced
    // at two stores, "cheapest at X" is a feature the demo can't show.
    const compared = items.filter(i => cheapestShopFor(i.id, itemShops, shops) !== null);
    expect(compared.length).toBeGreaterThan(0);

    // The per-unit half needs more than that: two prices for *different*
    // quantities, where the bigger number is the better deal. Seeded on Rice —
    // $7.99 for 5 lb at Costco against $2.49 for 1 lb at Trader Joe's.
    const rice = items.find(i => i.nameKey === 'rice')!;
    const ricePrices = shopPricesFor(rice.id, itemShops, shops);
    expect(ricePrices.map(p => p.quantity)).toEqual(['1 lb', '5 lb']);
    expect(cheapestShopFor(rice.id, itemShops, shops)?.shop.name).toBe('Costco');
    expect(describeShopPrices(ricePrices, '$', 'x')).toContain('≈$1.60/lb');

    // The run this feeds: Rice's last (Trader Joe's) price reads as more than
    // usual once its own cheaper Costco price is in the mix, which is exactly
    // what the per-store comparison above already knows and this now says in
    // words on the item sheet.
    const standing = priceStandingFor(rice, null, itemShops);
    expect(standing).toBe('high');
    expect(describePriceStanding(standing)).toBe('More than usual');
  });

  it('seeds a recipe whose cost estimate actually clears the coverage floor', () => {
    // Without this, recipeCost.ts's estimateRecipeCost — the feature #1672
    // added — has no row in the demo that ever answers: most recipes here
    // are priced too thinly to clear the coverage floor, which is realistic
    // but would make the whole capability invisible to anyone handed the
    // phone. Mashed potatoes clears it on its own two priced, measurable
    // lines (potatoes by the pound, milk by the cup) against its one
    // unpriced one (butter, by the tablespoon — priced by weight instead,
    // so it's honestly uncovered rather than guessed).
    const { items } = useGroceryStore.getState();
    const mash = useRecipeStore.getState().recipes.find(r => r.name === 'Mashed potatoes')!;
    const estimate = estimateRecipeCost(mash, items);
    expect(estimate).not.toBeNull();
    expect(estimate!.totalMinor).toBeGreaterThan(0);
    expect(describeRecipeCost(estimate, '$', new Date())).toMatch(/^≈ \$\d+\.\d{2}/);
  });

  it('seeds a trip in progress, with rows that have something to say about it', () => {
    const { items, itemShops, shops, itemSubs, itemProducts } = useGroceryStore.getState();

    // The banner, and the only state in which the list mentions stores at all.
    const trip = useGroceryStore.getState().activeShop();
    expect(trip).not.toBeNull();

    const markers = items
      .filter(i => i.onList)
      .map(i => tripMarkerFor(i, itemShops, shops, trip!, itemSubs, items, itemProducts))
      .filter((m): m is NonNullable<typeof m> => !!m);

    // The three kinds this seed can honestly produce: the store's own negative
    // claim, an item on record at exactly one other store, and a store the user
    // has said hasn't got their product. Without a row carrying one, the whole
    // feature is a banner and nothing else.
    expect(markers.some(m => m.kind === 'unavailable')).toBe(true);
    expect(markers.some(m => m.kind === 'only')).toBe(true);
    expect(markers.some(m => m.kind === 'withoutProduct')).toBe(true);
    // ...and that one carries the next box worth reaching for, which is the
    // whole reason the seed gives cottage cheese a second product. Without it
    // the caption is a refusal with no way forward, and the feature reads as
    // one the app doesn't have.
    expect(markers.some(m => m.kind === 'withoutProduct' && m.alternativeProduct)).toBe(true);
    // ...and most of the list still says nothing, which is the point.
    expect(markers.length).toBeLessThan(items.filter(i => i.onList).length);
  });

  it('seeds a shelf substitute on the unavailable row, tappable to swap (#1567)', () => {
    const { items, itemShops, shops, itemSubs } = useGroceryStore.getState();
    const trip = useGroceryStore.getState().activeShop()!;

    const tortillas = items.find(i => i.name === 'Tortillas')!;
    const cornTortillas = items.find(i => i.nameKey === 'corn tortillas')!;
    expect(cornTortillas).toBeTruthy();

    const marker = tripMarkerFor(tortillas, itemShops, shops, trip, itemSubs, items)!;
    expect(marker.kind).toBe('unavailable');
    expect(marker.substitute?.id).toBe(cornTortillas.id);
    expect(describeTripMarker(marker)).toBe('Not here · or Corn tortillas');

    // Tapping the caption is a real swap: the substitute lands on the list
    // carrying Tortillas off it.
    useGroceryStore.getState().swapForSubstitute(tortillas.id, cornTortillas.id);
    const after = useGroceryStore.getState().items;
    expect(after.find(i => i.id === tortillas.id)?.onList).toBe(false);
    expect(after.find(i => i.id === cornTortillas.id)?.onList).toBe(true);
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
    // A heading declared ahead of anything filed under it — see Recipe.emptySections.
    expect(recipes.some(r => r.emptySections.length > 0)).toBe(true);
  });

  it('seeds a written method, and one left in notes for cook mode to fall back to', () => {
    const { recipes } = useRecipeStore.getState();
    const byId = recipeMap(recipes);

    // Structured steps (Recipe.steps), including on the recipe that's mid-cook,
    // so cook mode opens there with the timer already running.
    expect(recipes.some(r => r.steps.length > 1)).toBe(true);
    expect(recipes.some(r => r.steps.length > 0 && r.timerStartedAt)).toBe(true);

    // A recipe whose method is still a notes blob, which is what cook mode's
    // fallback reads — and it's a composed one, so the same cook also shows a
    // component's own steps attributed to it.
    const fromNotes = recipes.find(r => r.steps.length === 0 && stepsFromNotes(r.notes).length > 1);
    expect(fromNotes).toBeDefined();
    const method = cookSteps(fromNotes!, byId);
    expect(method.some(s => s.fromNotes && s.whole)).toBe(true);
    expect(method.some(s => !s.fromNotes && !s.whole)).toBe(true);
  });

  it('seeds recipe duration, cook history, attribution and a live timer', () => {
    const { recipes } = useRecipeStore.getState();

    expect(recipes.some(r => r.favorite)).toBe(true);
    expect(recipes.some(r => r.tags.length > 1)).toBe(true);
    // A real dietary tag, not just a cooking-style one — the excluded-tags
    // picker (#1693) needs something a household would actually exclude on.
    expect(recipes.some(r => r.tags.includes('vegetarian'))).toBe(true);
    expect(recipes.some(r => r.estimatedMinutes && r.prepMinutes)).toBe(true);
    expect(recipes.some(r => r.servings && r.servingsMax)).toBe(true);
    expect(recipes.some(r => r.recipeYield)).toBe(true);
    // Both ends of the leftovers dial — one dish that keeps longer than the
    // standard window and one that keeps less — plus the many that say nothing.
    expect(recipes.some(r => (r.leftoverKeepDays ?? 0) > LEFTOVER_KEEP_DAYS_DEFAULT)).toBe(true);
    expect(recipes.some(r => r.leftoverKeepDays !== null && r.leftoverKeepDays < LEFTOVER_KEEP_DAYS_DEFAULT)).toBe(true);
    expect(recipes.some(r => r.leftoverKeepDays === null)).toBe(true);
    expect(recipes.some(r => r.prepTasks.some(p => p.reminderOffsetMinutes !== null))).toBe(true);
    expect(recipes.some(r => r.cookCount > 1 && r.lastCookedAt)).toBe(true);
    // Both sides of the vote — a loved, favorited dish and a cooked-twice one
    // decided against, so the box's "Loved first" sort has something to show.
    expect(recipes.some(r => r.vote === 'up')).toBe(true);
    expect(recipes.some(r => r.vote === 'down')).toBe(true);
    expect(recipes.some(r => r.timerStartedAt)).toBe(true);
    // All three attribution shapes — a URL, a byline, and a cookbook page.
    expect(recipes.some(r => r.sourceUrl)).toBe(true);
    expect(recipes.some(r => r.author && r.source)).toBe(true);
    expect(recipes.some(r => r.sourceType === 'cookbook' && r.sourcePage)).toBe(true);
    // What a link import leaves behind, all on one recipe: the address, the
    // site, the byline, and the method read off the page's own markup.
    expect(recipes.some(r =>
      r.sourceType === 'website' && r.sourceUrl && r.source && r.author && r.steps.length > 0,
    )).toBe(true);
  });

  it('leaves the suggestion sheet a fridge to offer, minus the container the week already eats', () => {
    const { leftovers } = useLeftoverStore.getState();
    const { entries } = useMealPlanStore.getState();
    const plannedIds = entries.map(e => e.leftoverId).filter((id): id is string => !!id);

    expect(plannedIds.length).toBeGreaterThan(0);
    const offered = suggestableLeftovers(leftovers, plannedIds);
    // Containers to fill a night with, and the one already planned isn't
    // among them — both halves of the rule, on data the seed already had.
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.some(l => plannedIds.includes(l.id))).toBe(false);
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

    // The suggestion shelf has to have a night to land on, and the run
    // deliberately ends on one: a day still ahead, holding a meal, with its
    // dinner still open. A fortnight where every dinner is spoken for shows
    // that surface only in the one state it isn't for.
    const todayKey = dayKeyOf(new Date());
    const ahead = new Set(entries.filter(e => e.date > todayKey).map(e => e.date));
    const dinners = new Set(entries.filter(e => e.slot === 'dinner').map(e => e.date));
    expect([...ahead].some(date => !dinners.has(date))).toBe(true);
  });

  it('leaves no post-cook offer standing, but sets tonight up to raise one', () => {
    // The "out of anything after X?" offer is the app's answer to a tap you
    // just made, so it can't be seeded — the past nights the seed marks cooked
    // would otherwise leave demo mode opening on a banner about a dinner eight
    // days ago. What *can* be checked is the claim the seed comment makes: that
    // cooking tonight's dinner raises one, which is the only honest way to see
    // this feature in the demo.
    expect(useMealPlanStore.getState().cookedOffer).toBeNull();

    const tonight = useMealPlanStore.getState().entries.find(
      e => e.title === 'Weeknight chicken stir-fry' && !e.cookedAt
    );
    expect(tonight).toBeDefined();

    useMealPlanStore.getState().setCooked(tonight!.id, true);

    // Raised because the stir-fry calls for rice and the seeded pantry claims
    // you have rice — the offer can only ever take away a claim the app is
    // already making, so the overlap is what makes it demonstrable at all.
    expect(useMealPlanStore.getState().cookedOffer).toMatchObject({
      recipeName: 'Weeknight chicken stir-fry',
    });
  });

  it('seeds meal tasks as chains, and a meal that deliberately has none', () => {
    const { entries } = useMealPlanStore.getState();
    const { tasks } = useTaskStore.getState();
    const todayKey = dayKeyOf(getCurrentDayStart());

    const mealTasks = tasks.filter(t => t.generatedKind === 'mealSlot');
    expect(mealTasks.length).toBeGreaterThan(0);
    // Each is keyed by the day and the slot it asks about, not by a meal —
    // which is what lets one exist for a slot nobody has answered.
    mealTasks.forEach(task => {
      const source = parseMealSlotSource(task.generatedSourceId);
      expect(source).not.toBeNull();
      expect(source!.dayKey >= todayKey).toBe(true);
    });
    // A week's worth, not just today's: the days ahead are what show a planned
    // meal saying "Cook X" before its day, and an unplanned one honestly saying
    // it hasn't been decided. Both states in one screen is the seed's job.
    const days = new Set(mealTasks.map(t => parseMealSlotSource(t.generatedSourceId)!.dayKey));
    expect(days.size).toBeGreaterThan(1);
    // Segmented to its slot — the mechanism that keeps dinner off the morning.
    expect(mealTasks.some(t => t.timeSegments.includes('evening'))).toBe(true);

    // Today's answered slots step through cooking and then eating, so the chain
    // is visible in the seed rather than only on a day nobody has planned.
    const dinner = mealTasks.find(
      t => t.generatedSourceId === mealSlotSourceId(todayKey, 'dinner')
    )!;
    expect(dinner.chainEnabled).toBe(true);
    expect(dinner.chainItems.map(c => c.title))
      .toEqual(['Cook Weeknight chicken stir-fry', 'Eat Weeknight chicken stir-fry']);
    // Cook X's estimate is the recipe's own prep + cook time (stirFry: 15 + 20).
    expect(dinner.chainItems.map(c => c.estimatedMinutes)).toEqual([35, null]);
    // Answered with a recipe, so its link opens that rather than the day.
    const stirFry = useRecipeStore.getState().recipes.find(r => r.name === 'Weeknight chicken stir-fry')!;
    expect(dinner.linkUrl).toBe('dundundun://recipe?id=' + stirFry.id);

    // The per-meal opt-out is invisible unless something uses it — today's
    // lunch is the meal that says no, and so has no task and renders as a
    // context row instead.
    expect(entries.some(e => e.cookTask === false)).toBe(true);
    expect(entries.some(e => e.cookTask === null)).toBe(true);
    expect(mealTasks.some(t => t.generatedSourceId === mealSlotSourceId(todayKey, 'lunch')))
      .toBe(false);
  });

  it('seeds a quiet project and the review task the app writes about it', () => {
    const { tasks } = useTaskStore.getState();
    const { projects } = useProjectStore.getState();

    const garage = projects.find(p => p.title === 'Garage shelving');
    expect(garage).toBeDefined();
    // Opted in and past its cadence: the state the feature exists for, and the
    // one that is otherwise invisible everywhere, since an undated project
    // task appears in no list at all.
    expect(garage!.nudgeOptIn).toBe(true);
    expect(garage!.nudgeCadenceDays).toBeGreaterThan(0);

    const review = tasks.find(t => t.generatedKind === 'projectReview');
    expect(review).toBeDefined();
    expect(review!.title).toBe('Review Garage shelving');
    expect(review!.generatedSourceId).toBe(garage!.id);
    // Tapping it opens the pull sheet on this project alone.
    expect(review!.linkUrl).toBe(`dundundun://projects?pull=${garage!.id}`);
    // Filed, not loose — an uncategorized generated task renders above every
    // section, which is exactly where the banner this replaced used to sit.
    expect(review!.category).toBe('Projects');
    // And never inside the project it describes: that would be a dated member,
    // which is what makes a project *not* quiet (see projectReviewTasks.ts).
    expect(review!.projectId).toBeNull();
  });

  it('makes that project read as genuinely quiet, not quiet for zero days', () => {
    const { tasks } = useTaskStore.getState();
    const { projects } = useProjectStore.getState();
    const garage = projects.find(p => p.title === 'Garage shelving')!;

    const members = tasks.filter(t => t.projectId === garage.id);
    // Nothing live in it carries a date — one dated member and the project is
    // not quiet at all.
    expect(members.filter(t => !t.completed).every(t => t.dueDate === null && t.deferUntil === null)).toBe(true);
    // The chip reads off the last completion, so the demo needs one with some
    // age on it or the row says "Quiet 0 days" and demonstrates nothing.
    expect(projectQuietDays(garage, members)).toBeGreaterThan(14);

    // And the real rule agrees it's quiet — otherwise the seeded task would be
    // swept away by the first foreground as describing a project that isn't
    // stalled, and the demo would show the feature for exactly as long as
    // nobody backgrounded the app.
    const stalls = findProjectStalls(projects, tasks, 'nudge');
    expect(wantedProjectReviews(stalls).map(w => w.projectId)).toContain(garage.id);
  });

  it('seeds a pantry guess that has run out, and the check the app writes about it', () => {
    const { tasks } = useTaskStore.getState();
    const { items } = useGroceryStore.getState();
    const oats = items.find(i => i.name === 'Rolled oats')!;

    // The row has to be past the cadence gate, or the generator would rightly
    // refuse to ask about a window it made up.
    expect(oats.purchaseCount).toBeGreaterThanOrEqual(3);
    // And its guess has to have actually run out — an item still inside its
    // window is the state this feature has nothing to say about.
    expect(probablyHaveReason(oats, new Date())).toBeNull();

    const check = tasks.find(t => t.generatedKind === 'pantryCheck');
    expect(check).toBeDefined();
    expect(check!.title).toBe('Check if you still have Rolled oats');
    expect(check!.generatedSourceId).toBe(oats.id);
    // Tapping it opens that item's own sheet, on the Pantry pills.
    expect(check!.linkUrl).toBe(`dundundun://kitchen?item=grocery-${oats.id}`);
    expect(check!.category).toBe('Groceries');

    // And the real rule agrees, so the first foreground sweep doesn't clear the
    // seeded row as describing an item that wants nothing.
    expect(wantedPantryChecks(items, tasks, new Date()).map(w => w.itemId)).toContain(oats.id);
  });

  it('seeds a meal the kitchen cannot make, and the task that says so', () => {
    const { tasks } = useTaskStore.getState();
    const { items, itemSubs } = useGroceryStore.getState();
    const recipes = useRecipeStore.getState().recipes;
    const recipesById = new Map(recipes.map(r => [r.id, r]));
    const entries = useMealPlanStore.getState().entries;
    const todayKey = dayKeyOf(new Date());

    const shop = tasks.find(t => t.generatedKind === 'mealShortfall');
    expect(shop).toBeDefined();
    expect(shop!.title).toContain('Lemon garlic salmon');
    expect(shop!.category).toBe('Meal Plan');

    // It speaks for a real night, and one that is genuinely short: the catalog
    // seeded above has no row at all for salmon fillets or asparagus, and
    // butter is explicitly marked out of.
    const night = entries.find(e => e.id === shop!.generatedSourceId);
    expect(night).toBeDefined();
    const missing = mealShortfallRows(
      night!, recipesById, items, itemSubs, standingSwapMap(itemSubs, items), new Date()
    );
    expect(missing!.map(r => r.name.toLowerCase())).toEqual(
      expect.arrayContaining(['salmon fillets', 'asparagus'])
    );

    // And the real rule agrees, so the first foreground sweep doesn't clear the
    // seeded row — the same standard the pantry check above is held to.
    //
    // Judged on the *stale* pass rather than on wantedMealShortfalls, which is
    // the distinction the cap makes: today's three meals are sooner and win the
    // three slots, and losing that contest is deliberately not a reason to
    // delete a row that already exists. Asserting the want would be asserting
    // the cap, which is not what keeps this row alive.
    expect(
      staleMealShortfallTasks(
        tasks, entries, recipesById, items, itemSubs, standingSwapMap(itemSubs, items),
        todayKey, new Date()
      )
    ).toEqual([]);
  });

  it('seeds the daily task to review tomorrow\'s calendar', () => {
    const { tasks } = useTaskStore.getState();

    const review = tasks.find(t => t.generatedKind === 'calendarReview');
    expect(review).toBeDefined();
    expect(review!.title).toBe('Review tomorrow\'s calendar');
    // Filed under the day's own events category — this generator has no
    // category setting of its own (see GeneratedKindSpec.categorized).
    expect(review!.category).toBe('Calendar Events');
    expect(useSettingsStore.getState().calendarEventCategory).toBe('Calendar Events');
    expect(review!.generatedSourceId).toBe(dayKeyOf(addDays(getCurrentDayStart(), 1)));
  });

  it('leaves that item free of a use-by date, so it carries one task and not two', () => {
    const { items } = useGroceryStore.getState();
    const oats = items.find(i => i.name === 'Rolled oats')!;

    // The shelf-life lexicon deliberately doesn't know rolled oats. If it did,
    // the back-dated trips would have stamped a use-by date three weeks past,
    // and the demo would open with a "Use up" task arguing with the check.
    expect(oats.expiresAt).toBeNull();
  });

  it('seeds a supply that is running low, and the order the app wrote about it', () => {
    const { tasks } = useTaskStore.getState();

    const filter = tasks.find(t => t.title === 'Change the water filter')!;
    expect(filter).toBeDefined();
    // A supply only counts down by riding onto a successor, so it has to be on
    // a repeating task or it would sit at its starting number for ever.
    expect(canHoldSupply(filter)).toBe(true);
    expect(filter.supplyCount).toBe(2);
    expect(filter.supplyUnit).toBe('filters');
    expect(filter.supplyRefillCount).toBe(6);

    // And the real rule agrees it wants ordering, so the first foreground
    // sweep doesn't clear the seeded row as describing a supply that's fine.
    expect(supplyReorderReason(filter)).not.toBeNull();

    const order = tasks.find(t => t.generatedKind === 'supplyReorder')!;
    expect(order).toBeDefined();
    expect(order.title).toBe('Order more filters');
    expect(order.generatedSourceId).toBe(filter.id);
    // Filed under the same category as the task it's for, not a category of
    // its own — see GeneratedKindSpec.categorized.
    expect(order.category).toBe(filter.category);
    // Completing it asks how many arrived — the answer is what puts the count
    // back up, so without the question the supply could only ever fall.
    expect(order.deliverableKind).toBe('number');
    // And it carries the day the last filter runs out, plus the link to buy
    // one, both inherited from the task it speaks for.
    expect(order.deadline).not.toBeNull();
    expect(order.linkUrl).toBe(filter.linkUrl);
  });

  it('seeds the linked half of the bridge, which writes no task at all', () => {
    const { tasks } = useTaskStore.getState();
    const { items } = useGroceryStore.getState();

    const tablets = items.find(i => i.name === 'Dishwasher tablets')!;
    const dishwasher = tasks.find(t => t.title === 'Run the dishwasher')!;
    expect(dishwasher.supplyGroceryItemId).toBe(tablets.id);

    // Low enough to be asking, and the answer is the shopping list rather than
    // a row on Today — a task saying "buy X" beside a list line saying "buy X"
    // is one errand and two nags.
    expect(supplyReorderReason(dishwasher)).not.toBeNull();
    expect(tablets.runningLowAt).not.toBeNull();
    expect(tablets.onList).toBe(true);
    expect(wantedSupplyReorders(tasks).map(w => w.taskId)).not.toContain(dishwasher.id);

    // And the grocery side can say why that row is there.
    expect(describeSupplyStock(suppliesStockedFrom(tablets.id, tasks)))
      .toBe('Stocked for “Run the dishwasher”');
  });

  it('seeds a healthy supply too, so the chip is not only ever a warning', () => {
    const { tasks } = useTaskStore.getState();
    const lenses = tasks.find(t => t.title === 'Swap contact lenses')!;
    expect(lenses.supplyCount).toBe(9);
    expect(describeSupply(lenses)).toBe('9 pairs left');
    // Nowhere near asking for anything — this row is the at-rest state.
    expect(supplyReorderReason(lenses)).toBeNull();
  });

  it('seeds the weekly meal-plan nudge as a stack of seven day tasks', () => {
    const { tasks } = useTaskStore.getState();
    const { groups } = useTaskGroupStore.getState();

    const nudgeTasks = tasks.filter(t => t.generatedKind === 'mealPlanNudge');
    expect(nudgeTasks).toHaveLength(7);

    // All in one stack, ordered down the week.
    const groupIds = new Set(nudgeTasks.map(t => t.groupId));
    expect(groupIds.size).toBe(1);
    const group = groups.find(g => g.id === nudgeTasks[0].groupId);
    expect(group).toBeDefined();
    expect(group!.title).toBe("Plan this week's meals");
    // A stack that arrives unattended opens itself; nothing else would show
    // the seven rows this feature is.
    expect(group!.collapsed).toBe(false);

    // Seven consecutive days, each carrying its own day key and a link that
    // opens the meal plan on it.
    const dayKeys = nudgeTasks
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(t => t.generatedSourceId!);
    expect(new Set(dayKeys).size).toBe(7);
    dayKeys.forEach((key, i) => {
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (i > 0) {
        expect(differenceInCalendarDays(dayKeyToDate(key), dayKeyToDate(dayKeys[i - 1]))).toBe(1);
      }
    });
    nudgeTasks.forEach(t => {
      expect(t.linkUrl).toBe(`dundundun://mealplan?date=${t.generatedSourceId}`);
    });
  });

  it('seeds one nudge day already planned end to end, so the ready state shows', () => {
    // The counter and its full state are invisible until a day has all three
    // meals on it — today's own row, planned end to end by the seed above.
    // The nudge's target week is this week (#1730), the same one that seed
    // already fleshes out, so nothing extra is planted here for it.
    const { entries } = useMealPlanStore.getState();
    const { tasks } = useTaskStore.getState();

    const counts = tasks
      .filter(t => t.generatedKind === 'mealPlanNudge')
      .map(t => countPlannedSlots(entries, t.generatedSourceId!));

    expect(counts.filter(c => c === MEAL_PLAN_NUDGE_SLOT_COUNT)).toHaveLength(1);
    // ...and a spread either side of it, so the counter reads as a range
    // rather than as an on/off badge.
    expect(counts.some(c => c > 0 && c < MEAL_PLAN_NUDGE_SLOT_COUNT)).toBe(true);
  });

  it('seeds today with meals on both sides of the fold', () => {
    const { entries } = useMealPlanStore.getState();
    const { tasks } = useTaskStore.getState();
    const todayKey = dayKeyOf(getCurrentDayStart());
    const todayEntries = entries.filter(e => e.date === todayKey && !e.cookedAt);

    // Half of today's meals are a task in the list; the other half have no
    // task and are the ones that render as context rows (see dayContextRows).
    // A seed where every meal had a cook task would show only one of the two.
    const hasMealTask = (e: { date: string; slot: MealSlot }) =>
      tasks.some(t =>
        t.generatedKind === 'mealSlot'
        && t.generatedSourceId === mealSlotSourceId(e.date, e.slot)
        && !t.completed);
    expect(todayEntries.some(hasMealTask)).toBe(true);
    expect(todayEntries.some(e => !hasMealTask(e))).toBe(true);

    // And they land in a category rather than loose above every section —
    // which is the arrangement the fold is worth having. The names are the
    // ones a fresh install gets (see GeneratedKindSpec.defaultCategory).
    expect(useSettingsStore.getState().mealCookTaskCategory).toBe('Meal Plan');
    expect(useSettingsStore.getState().leftoverUseUpTaskCategory).toBe('Leftovers');
    expect(useCategoryStore.getState().categories.map(c => c.name))
      .toEqual(expect.arrayContaining(['Meal Plan', 'Leftovers']));
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

    const useUpTasks = tasks.filter(t => t.generatedKind === 'groceryUseUp');
    expect(useUpTasks).toHaveLength(1);
    expect(useUpTasks[0].generatedSourceId).toBe(optedIn.id);
    expect(useUpTasks[0].title).toBe(`Use up ${optedIn.name}`);
    // Dated off the use-by day rather than off today, with the day itself
    // carried as the deadline.
    expect(useUpTasks[0].deadline).not.toBeNull();
    // Opens straight to the item's own row in the kitchen view.
    expect(useUpTasks[0].linkUrl).toBe(`dundundun://kitchen?item=grocery-${optedIn.id}`);
  });

  it('seeds a remembered shelf life that has not been activated yet', () => {
    const { items } = useGroceryStore.getState();

    // Cheddar isn't in the shelf-life lexicon and hasn't been bought in this
    // seed, so the correction is recorded but there's nothing to count down
    // from — only a real purchase turns it into an expiresAt.
    const cheddar = items.find(i => i.nameKey === 'cheddar')!;
    expect(cheddar.shelfLifeDays).not.toBeNull();
    expect(cheddar.expiresAt).toBeNull();
  });

  it('seeds one cooking split between the fridge and the freezer', () => {
    const { leftovers } = useLeftoverStore.getState();

    // The log sheet's "Both": two containers of one dish, put away together,
    // one counting down and one not. Invisible until something uses it — a
    // fridge with no such pair reads as an app that can't split a batch.
    const frozenOnLog = leftovers.filter(l => l.frozenAt === l.storedAt);
    expect(frozenOnLog.length).toBeGreaterThan(0);
    const twin = leftovers.find(l =>
      frozenOnLog.some(f => f.title === l.title && f.storedAt === l.storedAt && !l.frozenAt)
    );
    expect(twin).toBeDefined();
  });

  it('seeds a kitchen that answers the merged question — pantry and fridge on one ladder', () => {
    const { items } = useGroceryStore.getState();
    const { leftovers } = useLeftoverStore.getState();
    const entries = kitchenInventory(items, leftovers, new Date());

    // Both halves in one list, which is the whole capability (#1670): with
    // only one of them seeded the merge reads as a feature the app doesn't
    // have rather than one nobody has used yet.
    expect(entries.some(e => e.kind === 'grocery')).toBe(true);
    expect(entries.some(e => e.kind === 'leftover')).toBe(true);

    // A perishable and a container, both counting down through the same
    // ladder — the spinach going off and the chilli going off are the fact
    // the merged read exists to put side by side.
    const dying = useUpEntries(entries);
    expect(dying.some(e => e.kind === 'grocery')).toBe(true);
    expect(dying.some(e => e.kind === 'leftover')).toBe(true);
    // …and a pantry row with nothing counting down at all, which is most of a
    // kitchen and has to read as ignorance rather than as freshness.
    expect(entries.some(e => e.kind === 'grocery' && e.freshness === null)).toBe(true);

    // Most urgent first, and everything on a clock ahead of everything that
    // isn't — the ranking a one-line consumer needs.
    const dated = entries.filter(e => e.useBy !== null);
    expect(entries.slice(0, dated.length)).toEqual(dated);
    expect([...dated].sort((a, b) => a.useBy!.localeCompare(b.useBy!))).toEqual(dated);
    expect(describeKitchen(entries)).toContain('to use up');
  });

  it('seeds the kitchen rows Today draws, including the one paired with a meal', () => {
    const { items, itemSubs } = useGroceryStore.getState();
    const { leftovers } = useLeftoverStore.getState();
    const { tasks } = useTaskStore.getState();
    const entries = kitchenInventory(items, leftovers, new Date());
    const recipesById = new Map(useRecipeStore.getState().recipes.map(r => [r.id, r]));
    const todaysMeals = useMealPlanStore.getState().entries
      .filter(e => e.date === dayKeyOf(new Date()));

    const rows = kitchenContextRows(entries, {
      category: 'Meal Plan',
      hasUseUpTask: entry => !!liveGeneratedTask(
        tasks,
        entry.kind === 'leftover' ? 'leftoverUseUp' : 'groceryUseUp',
        entry.sourceId,
      ),
      plannedUses: plannedUsesToday(
        entries, todaysMeals, recipesById, standingSwapMap(itemSubs, items)
      ),
    });

    // Two rows and not a summary: past two they collapse, and the captions are
    // the thing worth showing. Both are perishables the generator declined —
    // groceryUseUpTasks is off in the seed as it is by default — which is the
    // gap these rows exist to fill.
    expect(rows.map(r => [r.title, r.caption])).toEqual([
      ['Cilantro', 'Use by today'],
      ['Red bell pepper', 'Use by tomorrow · For Weeknight chicken stir-fry'],
    ]);

    // Nothing that already has a "Use up X" task is said twice — the seeded
    // spinach and every leftover in range have one, and none of them is here.
    expect(rows.some(r => r.title === 'Spinach')).toBe(false);
    expect(useUpEntries(entries).length).toBeGreaterThan(rows.length);
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

  it("fills every row of Stats' cooking section", () => {
    // The seed already holds the rows; this asserts the *read* over them lands
    // non-empty, since a section that renders nothing in demo mode reads as a
    // feature the app doesn't have.
    const window = cookingWindow(getCurrentDayStart(), 30);
    const counts = mealCookCounts(useMealPlanStore.getState().entries, window);
    const history = leftoverHistoryIn(useLeftoverStore.getState().leftovers, window);
    const cooked = mostCookedRecipes(useRecipeStore.getState().recipes);

    expect(hasCookingData(counts, history, cooked)).toBe(true);
    // A fraction, not a clean sweep — the point of the row is that some planned
    // nights didn't get cooked.
    expect(counts.plannedCooked).toBeGreaterThan(0);
    expect(counts.plannedCooked).toBeLessThan(counts.planned);
    expect(counts.daysCooked).toBeGreaterThan(0);
    // Both endings, so the row reads "n eaten · n thrown out" rather than half of it.
    expect(history.eaten).toBeGreaterThan(0);
    expect(history.tossed).toBeGreaterThan(0);
    // And a leaderboard that actually ranks rather than a single row.
    expect(cooked.length).toBeGreaterThan(1);
    expect(cooked[0].count).toBeGreaterThan(1);
  });

  it("fills the Logbook's cooking lens, every row treatment included", () => {
    // Reads the loaded window rather than refreshCookHistory, which goes
    // straight to SQLite — the seed's cooked nights are all inside it, and this
    // is about the rows existing, not about the store's snapshot plumbing.
    const events = kitchenEvents(
      useMealPlanStore.getState().entries,
      useLeftoverStore.getState().leftovers,
      useRecipeStore.getState().recipes
    );

    // Several days, or the day sections read as one block with a heading.
    expect(kitchenHistoryDays(events).length).toBeGreaterThan(2);
    // Both kinds of row, since the lens exists to put them in one chronology.
    expect(events.some(e => e.kind === 'cooked')).toBe(true);
    expect(events.some(e => e.kind === 'leftover')).toBe(true);
    // Both endings, which are two different glyphs on the row.
    expect(events.some(e => e.outcome === 'eaten')).toBe(true);
    expect(events.some(e => e.outcome === 'tossed')).toBe(true);
    // A row that opens its recipe, and one that can't — a free-text meal
    // ("Takeout curry") has nowhere to go and shows no chevron.
    expect(events.some(e => e.kind === 'cooked' && e.recipeId)).toBe(true);
    expect(events.some(e => e.kind === 'cooked' && !e.recipeId)).toBe(true);
    // The scale clause, which is silent at 1× and so invisible without a night
    // that was cooked for a crowd.
    expect(events.some(e => e.scale !== 1)).toBe(true);
  });

  it('seeds an opened jar whose countdown is dated from the opening', () => {
    const { items } = useGroceryStore.getState();
    const opened = items.filter(i => i.openedAt);
    expect(opened.length).toBeGreaterThan(0);

    // The point of the second lexicon: a jar addToPantry left dateless comes
    // away from the opening with a real countdown.
    const dated = opened.find(i => openShelfLifeDaysFor(i.name) !== null);
    expect(dated).toBeDefined();
    expect(dated!.expiresAt).not.toBeNull();

    // And one opened by a cooking rather than by hand, which is what dates it
    // to that night rather than to the moment the demo was seeded.
    const today = dayKeyOf(new Date());
    expect(opened.some(i => dayKeyOf(new Date(i.openedAt!)) < today)).toBe(true);
  });

  it('seeds something running low, which is what puts it on the list', () => {
    const { items } = useGroceryStore.getState();
    const low = items.filter(i => i.runningLowAt);
    expect(low.length).toBeGreaterThan(0);
    // The one pantry state that reaches into onList.
    expect(low.every(i => i.onList)).toBe(true);
    // Still had, which is the whole distinction from "Out of it".
    expect(probablyHaveReason(low[0], new Date())).toBe('running low');
  });

  it('seeds a row with a record of going bad, and no banner up to say so', () => {
    const { items } = useGroceryStore.getState();
    const spoiled = items.filter(i => i.spoiledCount > 0);
    expect(spoiled.length).toBeGreaterThan(0);

    // The reader is the point — a count nobody sees is the state #1363 found
    // the fridge's own outcomes in.
    const history = describeDisposalHistory(spoiled[0], new Date());
    expect(history).toContain('Went bad');
    expect(history).toContain('of');

    // Answered often enough to be the case the shelf-life offer exists for,
    // which is what makes the seeded row worth having.
    expect(wantsShelfLifePrompt(spoiled[0])).toBe(true);

    // But not left on screen: a banner is a reaction to a tap, and a demo that
    // boots with one is asserting a tap nobody made.
    expect(useGroceryStore.getState().disposalOffer).toBeNull();

    // Evidence, never arithmetic. Nothing in the record moved the day.
    expect(spoiled[0].shelfLifeDays).toBeNull();
  });

  it('seeds a kitchen where something dying has a recipe that would use it', () => {
    const { items } = useGroceryStore.getState();
    const { leftovers } = useLeftoverStore.getState();
    const { recipes } = useRecipeStore.getState();

    const dying = useUpEntries(kitchenInventory(items, leftovers, new Date()));
    expect(dying.length).toBeGreaterThan(0);

    // Without this the Pantry screen's suggestion block never renders in the
    // demo, and a feature with no row in the seed reads as one the app hasn't
    // got.
    const suggestions = useUpRecipes(dying, recipes);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].uses.length).toBeGreaterThan(0);
  });

  it('seeds a freezer with both halves of the kitchen in it', () => {
    const { items } = useGroceryStore.getState();
    const { leftovers } = useLeftoverStore.getState();

    const frozenItems = items.filter(i => i.frozenAt);
    const frozenContainers = leftovers.filter(l => l.frozenAt);
    expect(frozenItems.length).toBeGreaterThan(0);
    expect(frozenContainers.length).toBeGreaterThan(0);

    // The case the feature was built for: something the shelf-life lexicon
    // gave a short date to, whose date is kept on the row and simply not read.
    const dated = frozenItems.find(i => i.expiresAt);
    expect(dated).toBeDefined();
    expect(liveExpiresAt(dated!)).toBeNull();

    // ...and something that never had a date, which is what most of a freezer
    // is. Without it the section reads as a place perishables hide.
    expect(frozenItems.some(i => !i.expiresAt)).toBe(true);

    // Both kinds land under the one heading in the Pantry screen.
    const sections = buildKitchenSections(
      kitchenInventory(items, leftovers, new Date()),
      useGroceryStore.getState().aisleOrder,
    );
    const freezer = sections.find(s => s.section === FREEZER_SECTION);
    expect(freezer).toBeDefined();
    expect(new Set(freezer!.data.map(e => e.kind))).toEqual(new Set(['grocery', 'leftover']));

    // And nothing in it is nagging: a frozen row is never something to use up.
    expect(useUpEntries(kitchenInventory(items, leftovers, new Date()))
      .some(e => e.section === FREEZER_SECTION)).toBe(false);
  });

  it('seeds a use-up task for every live leftover in "soon", "due" or "over"', () => {
    const { leftovers } = useLeftoverStore.getState();
    const { tasks } = useTaskStore.getState();
    // On by default (leftoverUseUpTasks), unlike the grocery equivalent — the
    // demo has to actually show the feature working, not just the leftover
    // rows that could trigger it.
    expect(useSettingsStore.getState().leftoverUseUpTasks).toBe(true);

    // needsAttention, not `freshnessOf(l) !== 'fresh'`: those were the same
    // question until the freezer, and the seeded frozen chilli is the case that
    // separates them — it's weeks past its keep-until, so freshnessOf still
    // says 'over', but nothing is counting down and no task is wanted.
    const urgent = leftovers.filter(l => needsAttention(l));
    expect(urgent.length).toBeGreaterThan(0);

    const useUpTasks = tasks.filter(t => t.generatedKind === 'leftoverUseUp');
    expect(useUpTasks.length).toBe(urgent.length);
    useUpTasks.forEach(task => {
      const leftover = leftovers.find(l => l.id === task.generatedSourceId);
      expect(leftover).toBeDefined();
      expect(task.title).toBe(`Use up ${leftover!.title}`);
      expect(task.deadline).toBe(leftover!.keepUntil);
      // Same kitchen link shape the grocery use-up tasks carry, opening
      // straight to this leftover's own row.
      expect(task.linkUrl).toBe(`dundundun://kitchen?item=leftover-${leftover!.id}`);
    });
    // The frozen one gets no task however far past its stored day it is, which
    // is the whole reason the seed carries it.
    const frozen = leftovers.find(l => isLiveLeftover(l) && l.frozenAt);
    expect(frozen).toBeDefined();
    expect(freshnessOf(frozen!)).toBe('over');
    expect(useUpTasks.some(t => t.generatedSourceId === frozen!.id)).toBe(false);

    // The fresh one — furthest from its keep-until day — gets no task.
    const fresh = leftovers.find(l => isLiveLeftover(l) && freshnessOf(l) === 'fresh');
    expect(fresh).toBeDefined();
    expect(tasks.some(t => t.generatedSourceId === fresh!.id)).toBe(false);
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
    expect(useTaskStore.getState().tasks.some(t => t.generatedKind === 'mealCook')).toBe(false);
  });
});
