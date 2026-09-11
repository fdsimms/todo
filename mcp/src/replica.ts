/**
 * The replica: a real `todo.db` opened in Node, with the app's own db layer in
 * front of it.
 *
 * ## The one rule in `mcp/`
 *
 * **Nothing under `mcp/src` may import an app module for its *value*.** Types
 * are free (`import type` is erased); values come through the `Replica` this
 * file returns. That is not tidiness, it is the mechanism: `database.ts` does
 * `SQLite.openDatabaseSync('todo.db')` at module scope, so the shim has to be
 * in Node's module cache before `database.ts` is ever evaluated. A static
 * import anywhere in this package is hoisted above that, `database.ts`
 * evaluates against the real `expo-sqlite`, and it throws on a
 * TurboModuleRegistry lookup with no native side to answer it. Every `require`
 * below is therefore inside a function, deliberately, and the same goes for
 * `visibilityUtils` and `fuzzySearch` — they reach `database.ts` transitively
 * through `useSettingsStore`, so importing them statically breaks it just as
 * thoroughly and much less obviously.
 *
 * `src/types/index.ts` is the one carve-out, and it is a structural one rather
 * than a judgement call: `database.ts` imports *from* types, so nothing can
 * reach the db layer by going the other way. Its constants (`PRIORITY_LABELS`
 * and friends) are safe to import statically, and serialize.ts does.
 *
 * See docs/arch/mcp-server.md.
 */
// date-fns is safe to import for its values: it is a third-party leaf that
// cannot reach database.ts, so the rule above does not apply to it. The app's
// own modules import it exactly this way.
import { addDays } from 'date-fns/addDays';

import { shimModule } from './expoSqliteShim';
import type {
  Category,
  DeliverableKind,
  FoodLogEntry,
  GroceryItem,
  MedicationLog,
  MoodLog,
  Person,
  Project,
  Task,
} from '../../src/types';
import type { FoodLogTotals } from '../../src/utils/foodLog';

type DbModule = typeof import('../../src/db/database');
type VisibilityModule = typeof import('../../src/utils/visibilityUtils');
type FuzzyModule = typeof import('../../src/utils/fuzzySearch');
type EffortModule = typeof import('../../src/utils/effort');
type DeliverablesModule = typeof import('../../src/utils/deliverables');
type DateModule = typeof import('../../src/utils/dateUtils');
type FoodLogModule = typeof import('../../src/utils/foodLog');
type MoodHistoryModule = typeof import('../../src/utils/moodHistory');
type MedicationModule = typeof import('../../src/utils/medicationLog');

/** One task the way `fuzzySearch` ranked it, without the highlight ranges. */
export interface ReplicaSearchHit {
  task: Task;
  score: number;
  projectName: string | null;
}

export interface Replica {
  /** Where the database being served came from. Reported by `describe`. */
  readonly path: string;
  /** Drop cached reads. The server calls this once per request. */
  refresh(): void;

  tasks(): Task[];
  taskById(id: string): Task | null;
  projects(): Project[];
  categories(): Category[];
  groceryItems(): GroceryItem[];

  isVisible(task: Task): boolean;
  isUnscheduled(task: Task): boolean;
  isInbox(task: Task): boolean;
  isBlocked(task: Task): boolean;
  visibleAt(task: Task): Date;
  search(query: string): ReplicaSearchHit[];

  /**
   * The three fields a chain step overrides. They are separate entries rather
   * than raw `task.*` reads for the reason CLAUDE.md gives each of them: mid
   * chain the live step owns the title, the estimate and the question, and a
   * serializer reading the task directly reports the whole chain's answer at
   * every step.
   */
  displayTitle(task: Task): string;
  estimatedMinutes(task: Task): number | null;
  deliverableKind(task: Task): DeliverableKind | null;

  /**
   * The logical day, as a `YYYY-MM-DD` key. Goes through `getLogicalToday` so a
   * read at 1am under a 2am `dayResetTime` gets yesterday, which is the day the
   * user would say they were asking about.
   */
  todayKey(): string;
  /** Shifts a day key by whole days. Used to default a range to "the last N days". */
  shiftDayKey(key: string, days: number): string;

  /** Food log entries between two day keys, inclusive. */
  foodLogEntries(fromDayKey: string, toDayKey: string): FoodLogEntry[];
  /** Summed nutrients over a set of entries. A nutrient nobody stated is absent, never 0. */
  foodTotals(entries: readonly FoodLogEntry[]): FoodLogTotals;

  /** Mood check-ins between two day keys, inclusive. */
  moodLogs(fromDayKey: string, toDayKey: string): MoodLog[];

  /** Doses between two day keys, inclusive. */
  medicationLogs(fromDayKey: string, toDayKey: string): MedicationLog[];
  /** "Ibuprofen · 400 mg · as needed", the app's own one-line rendering of a dose. */
  medicationSummary(log: MedicationLog): string;

  deviceId(): string;
  /** False for a demo database. Phase 1 will not sync one. */
  syncable(): boolean;
}

/**
 * Put the shim in front of `expo-sqlite` for the rest of this process.
 *
 * Must be called before `openReplica()`, and there is nothing to undo it — one
 * process serves one database, which is also why `shimModule` hands out a
 * single handle.
 *
 * Deliberately untested: jest keeps its own module registry, so priming Node's
 * `require.cache` does nothing there. Tests reach the same place with
 * `jest.mock('expo-sqlite')` over `openShimDatabase(':memory:')`, which is why
 * this function holds no logic worth losing — the whole hydration path below is
 * covered, and this is the two lines that are not.
 */
export function installExpoSqliteShim(filePath: string): void {
  const resolved = require.resolve('expo-sqlite');
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: shimModule(filePath),
  } as NodeJS.Module;
}

/**
 * Open the replica and hydrate everything a read needs.
 *
 * The store initialisation is not optional and not deferrable. `isTaskVisible`
 * reads `dayResetTime` from `useSettingsStore` and a category's schedule from
 * `useCategoryStore`; unhydrated, both hand back defaults and the visibility
 * check answers confidently and wrongly, which is worse than refusing. Same for
 * the two registries: without a task source `resolveBlocker` returns undefined,
 * `canBlock(undefined)` is false, and a task waiting on another one reads as
 * ready to do.
 */
export function openReplica(path = process.env.TODO_DB_PATH ?? 'todo.db'): Replica {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const db = require('../../src/db/database') as DbModule;
  const visibility = require('../../src/utils/visibilityUtils') as VisibilityModule;
  const fuzzy = require('../../src/utils/fuzzySearch') as FuzzyModule;
  const effort = require('../../src/utils/effort') as EffortModule;
  const deliverables = require('../../src/utils/deliverables') as DeliverablesModule;
  const dates = require('../../src/utils/dateUtils') as DateModule;
  const foodLog = require('../../src/utils/foodLog') as FoodLogModule;
  const moodHistory = require('../../src/utils/moodHistory') as MoodHistoryModule;
  const medication = require('../../src/utils/medicationLog') as MedicationModule;
  const { registerTaskSource } = require('../../src/utils/blockerRegistry') as typeof import('../../src/utils/blockerRegistry');
  const { registerPersonSource } = require('../../src/utils/peopleRegistry') as typeof import('../../src/utils/peopleRegistry');
  const { useSettingsStore } = require('../../src/store/useSettingsStore') as typeof import('../../src/store/useSettingsStore');
  const { useCategoryStore } = require('../../src/store/useCategoryStore') as typeof import('../../src/store/useCategoryStore');
  /* eslint-enable @typescript-eslint/no-require-imports */

  db.initDatabase();
  useSettingsStore.getState().initialize();
  useCategoryStore.getState().initialize();

  // Read caches, cleared per request by `refresh`. They exist because the
  // blocker registry resolves one id at a time: without them, a list of 200
  // tasks in which 20 are blocked is 20 full table reads.
  let taskCache: Task[] | null = null;
  let personCache: Person[] | null = null;
  let projectCache: Project[] | null = null;

  const tasks = (): Task[] => (taskCache ??= db.dbGetAllTasks());
  const people = (): Person[] => (personCache ??= db.dbGetAllPeople());
  const projects = (): Project[] => (projectCache ??= db.dbGetAllProjects());

  registerTaskSource(tasks);
  registerPersonSource(people);

  return {
    path,

    refresh() {
      taskCache = null;
      personCache = null;
      projectCache = null;
      useSettingsStore.getState().initialize();
      useCategoryStore.getState().initialize();
    },

    tasks,
    projects,
    taskById: (id: string) => tasks().find(t => t.id === id) ?? null,
    categories: () => db.dbGetAllCategories(),
    groceryItems: () => db.dbGetAllGroceryItems(),

    isVisible: (task: Task) => visibility.isTaskVisible(task),
    isUnscheduled: (task: Task) => visibility.isUnscheduledTask(task),
    isInbox: (task: Task) => visibility.isInboxTask(task),
    isBlocked: (task: Task) => visibility.isTaskBlocked(task),
    visibleAt: (task: Task) => visibility.getVisibleAt(task),

    displayTitle: (task: Task) => visibility.displayTitleFor(task),
    estimatedMinutes: (task: Task) => effort.estimatedMinutesFor(task),
    deliverableKind: (task: Task) => deliverables.deliverableKindFor(task),

    todayKey: () => dates.dayKeyOf(dates.getLogicalToday()),
    shiftDayKey: (key: string, days: number) =>
      dates.dayKeyOf(addDays(dates.dayKeyToDate(key), days)),

    // The only one of the three with a ranged db read of its own, because
    // food_logs is the table that grows fastest — several rows a day, for ever.
    // The other two are read whole and filtered, which is what the app does.
    foodLogEntries: (from: string, to: string) => db.dbGetFoodLogEntries(from, to),
    foodTotals: (entries: readonly FoodLogEntry[]) => foodLog.foodLogTotals(entries),

    moodLogs: (from: string, to: string) =>
      moodHistory.logsInDayRange(db.dbGetAllMoodLogs(), from, to),

    medicationLogs: (from: string, to: string) =>
      db.dbGetAllMedicationLogs().filter(l => l.dayKey >= from && l.dayKey <= to),
    medicationSummary: (log: MedicationLog) => medication.medicationLogSummary(log),

    // The same ranking the quick-search sheet gets, project names and all —
    // reimplementing it here would be a second answer to "what matches", which
    // is the drift this whole package is arranged to avoid.
    search(query: string): ReplicaSearchHit[] {
      const names = new Map(projects().map(p => [p.id, p.title]));
      return fuzzy
        .fuzzySearch(tasks(), query, names)
        .map(r => ({ task: r.task, score: r.score, projectName: r.projectName }));
    },

    deviceId: () => db.dbGetDeviceId(),
    syncable: () => db.isSyncableDatabase(),
  };
}
