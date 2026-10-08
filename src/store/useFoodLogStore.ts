import { create } from 'zustand';
import type { FoodLogEntry, FoodNutrition, MealPlanEntry, MealSlot } from '../types';
import { NUTRIENT_KEYS } from '../types';
import {
  dbBulkDeleteFoodLogEntries,
  dbBulkSetFoodLogSlot,
  dbBulkUpdateFoodLogPlacement,
  dbCountFoodLogEntries,
  dbDeleteFoodLogEntry,
  dbGetFoodLogEntries,
  dbGetFoodLogEntry,
  dbGetPendingHealthFoodEntries,
  dbInsertFoodLogEntry,
  dbUpdateFoodLogEntry,
} from '../db/database';
import { generateId } from '../utils/id';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import {
  logFoodEntryToHealth,
  pendingWriteAction,
  retractFoodEntryFromHealth,
  type FoodWriteResult,
} from '../utils/healthFoodSync';
import { useSettingsStore } from './useSettingsStore';
import { useHealthStore } from './useHealthStore';
import { useTaskStore } from './useTaskStore';
import { buildFoodLogEntry } from '../utils/foodLogEntry';
import {
  type UndoableAction,
  type UndoHistoryActions,
  undoHistoryActions,
} from '../utils/undoHistory';

/**
 * The food log — what was eaten, and when.
 *
 * See `src/utils/foodLog.ts` for every rule about what a helping works out to
 * and what a day of them adds up to, and `FoodLogEntry` for why this is a log
 * rather than a task or a quota.
 *
 * Its own store rather than a slice of `useMealPlanStore`, for the reason
 * `useMoodStore` is its own: these are rows with their own lifecycle that
 * nothing else points at. A meal plan entry is a plan for a square on a
 * calendar and this is a record of something that happened; the two point at
 * each other and are not the same row.
 *
 * **Loaded for a window rather than wholesale**, which is where this parts
 * company with the mood log. Several rows a day forever is a great many more
 * rows than a mood history accumulates, each carrying a nutrition blob, and
 * every screen that wants them wants one day or one week. Same call
 * `useMealPlanStore` makes over the same key format, including the corollary:
 * `entries` holds exactly the loaded window and is never a superset, so
 * anything wanting a day that isn't on screen reads SQLite directly.
 *
 * It is CRUD and nothing else. Nothing here writes to Health, so nothing here
 * needs a demo-mode gate: the database swap already contains it, and the guard
 * belongs on the outbound write when there is one.
 */

/**
 * How far back `loadInsightWindow` reads for the mood pairings.
 *
 * `HEALTH_HISTORY_DAYS`' span, matched to it on purpose: both are the same kind
 * of second dataset paired against the same days, and two windows would mean a
 * finding about steps and a finding about calories on one screen quietly
 * speaking for different stretches of somebody's life.
 *
 * It is a ceiling on the read rather than on what counts. The thin-day rule
 * (see `foodDayInputs`) drops most of what comes back for anybody logging
 * casually, which is why the window is wide: ninety days of ordinary logging is
 * what it takes to clear `MIN_PAIRED_DAYS` of days complete enough to pair.
 *
 * Here rather than on a screen because two screens read this window now, the
 * same reason `HEALTH_HISTORY_DAYS` sits in the store that fetches it.
 */
export const FOOD_INSIGHT_DAYS = 90;

/**
 * A new entry, before the store stamps the parts only it can decide.
 *
 * `nutrition` arrives already built and already scaled — see
 * `scalePanelToAmount` and `recipeHelpingNutrition`. It is a snapshot from this
 * moment on: nothing recomputes it, and editing the recipe or the catalog row
 * it came from next month must not rewrite what somebody ate last Tuesday.
 */
export interface FoodLogDraft {
  label: string;
  quantity: string;
  grams: number | null;
  nutrition: FoodNutrition;
  slot?: MealSlot | null;
  recipeId?: string | null;
  itemId?: string | null;
  productId?: string | null;
  mealPlanEntryId?: string | null;
  /**
   * The panel the helping was measured against, for a food no catalog row
   * holds. See `FoodLogEntry.sourcePanel`; null or absent for anything linked.
   */
  sourcePanel?: FoodNutrition | null;
  /**
   * The moment being recorded, defaulting to now.
   *
   * An entry is a record of a moment and the moment is not always the one you
   * are typing in: logging lunch at bedtime is an ordinary thing to want. Same
   * parameter `addLog` takes one store over, and for the same reason.
   */
  at?: Date;
}

/**
 * A meal that just finished, waiting to be offered as a log entry.
 *
 * Session-only and deliberately id-shaped: the prompt resolves the recipe and
 * computes the figures itself when it opens, so this store never reaches the
 * recipe store or the meal plan. Same posture `pendingFinishLeftoverId` keeps
 * one store over, and the same reason it is not persisted — an offer nobody
 * answered before the app closed is an offer that has expired.
 */
export interface PendingMealLog {
  /** What to call it, captured now so a renamed recipe cannot rewrite the offer. */
  label: string;
  /** Which meal it was, when the moment knows. */
  slot: MealSlot | null;
  /**
   * The day the meal was planned for, as a `YYYY-MM-DD` key — so an offer
   * raised from a stale meal-log-nudge task (see `mealLogNudgeTasks.ts`)
   * logs the entry against the day the meal actually happened, not whatever
   * day it happens to be answered on.
   */
  dayKey: string;
  /** The dish, for its figures. Null for a leftover whose source no longer resolves. */
  recipeId: string | null;
  /** The planned meal this came from, or null for a leftover. */
  mealPlanEntryId: string | null;
  /** How much of the recipe the cooking made, so the figures match what was on the plate. */
  scale: number;
  /** The either/or answers that cooking used, so the figures match what went in. */
  choices: string[];
  /**
   * What the plate or the container weighed, when something already knows —
   * today only a finished leftover, which was weighed when it went in the
   * fridge (`Leftover.weightG`).
   *
   * **The figure the prompt opens on, never one it writes.** The offer is
   * still an offer: a container finished off after somebody picked at it held
   * less than it was logged with, so this is a starting number to correct
   * rather than an answer. Null for every meal that has nothing to say, which
   * is the ordinary case.
   */
  grams: number | null;
  /**
   * True when a person tapped to log this meal (the food log's "Planned for
   * today" row, the meal plan's "Log this meal") rather than the app offering
   * it on a meal's finish.
   *
   * It decides what happens when the recipe turns out to have no figures to
   * measure it by. Unasked, the prompt quietly doesn't come up, which is what
   * the setting promises. Asked, doing nothing reads as a broken button, so
   * the prompt hands the meal to the search sheet instead — the same answer
   * a meal with no recipe gets.
   */
  asked?: boolean;
}

/**
 * A meal that just finished with nothing the app can measure automatically —
 * a leftover with no recipe, takeout, a typed answer — waiting to be offered
 * the search sheet instead of the auto-computed prompt above.
 *
 * The manual counterpart of `PendingMealLog`, watched by a separate global
 * mount (`LogMealEntrySheet`, beside `LogMealPrompt`) rather than folded into
 * the same flag: the two prompts are different UIs entirely, and a caller
 * deciding which one to raise (see `offerMealLog` in `useTaskStore.ts`) only
 * ever wants one of them showing at a time.
 */
export interface PendingManualMealLog {
  /** What to call it, seeding the search field so finding it is a tap rather than a retype. */
  label: string;
  /** Which meal it was, when the moment knows. */
  slot: MealSlot | null;
  /** The day the meal was planned for, as a `YYYY-MM-DD` key — see `PendingMealLog.dayKey`. */
  dayKey: string;
  /** The planned meal this came from, so the entry it logs can point back at it. */
  mealPlanEntryId: string | null;
}

/**
 * What an edit may change. The instant and its day key are deliberately not on it.
 *
 * `itemId`/`productId` are on it and `nutrition` deliberately keeps them
 * company without being changed by the same edit: saying which catalog row an
 * entry was is provenance, and `FoodLogEntry.nutrition` is a snapshot of what
 * was actually eaten. Re-pointing an entry at a row with different figures must
 * not rewrite the meal — that is the same rule the snapshot exists for, one
 * step further along.
 */
export type FoodLogPatch = Partial<
  Pick<
    FoodLogEntry,
    // `recipeId` is patchable for `reviseEntry`'s sake alone: correcting an
    // entry can also correct what was eaten, and a dish re-picked as a food
    // would otherwise keep pointing at the recipe it is no longer about.
    // `sourcePanel` rides with a correction for the same reason: re-measured
    // against a row or re-picked as another food, the panel it kept describes
    // how the helping used to be measured, not how it is now.
    | 'label' | 'quantity' | 'grams' | 'nutrition' | 'sourcePanel' | 'slot' | 'sortOrder'
    | 'itemId' | 'productId' | 'recipeId'
  >
>;

/** A drag's result for one entry: where it landed, and which meal it landed in. */
export interface FoodLogPlacement {
  id: string;
  slot: MealSlot | null;
  sortOrder: number;
}

interface FoodLogStore extends UndoHistoryActions {
  /** The top of `undoStack`, mirrored. See useTaskStore's own note. */
  lastAction: UndoableAction | null;
  undoStack: UndoableAction[];
  redoStack: UndoableAction[];
  /** Exactly the loaded window, oldest instant first. Never a superset. */
  entries: FoodLogEntry[];
  rangeStart: string | null;
  rangeEnd: string | null;
  /**
   * How many entries exist in total, across every day.
   *
   * Kept apart from `entries.length`, which counts only the loaded window.
   * Simplified mode asks whether there is a history here at all, and answering
   * that from one day's rows would hide the screen and its months of entries
   * on any day nobody had logged yet. See `screenShown`.
   */
  totalCount: number;
  initialized: boolean;
  initialize: () => void;
  /** Replaces `entries` with the inclusive run of logical days between the keys. */
  loadRange: (startKey: string, endKey: string) => void;
  /**
   * Every entry on or after `fromKey` (every entry at all when null), read
   * straight from the database and handed back rather than stored.
   *
   * For the CSV export, which wants months of rows once and keeps none of
   * them. Not a fourth window: nothing renders from it, so there is nothing for
   * another screen's read to clobber.
   */
  entriesSince: (fromKey: string | null) => FoodLogEntry[];
  /**
   * A second window, for a reader that isn't the day view.
   *
   * Kept apart from `entries` rather than widening it, the same split
   * `useMealPlanStore` keeps for `cookingCounts`: the food log screen owns
   * `entries` and steps it one day at a time, and Stats wants a month. Sharing
   * one window would have each screen's read clobber the other's, so stepping
   * to yesterday would empty a section on a screen nobody had touched.
   *
   * Rows rather than a computed tally, because everything derived from them is
   * pure and lives in `nutritionStats.ts` — a store that also did the
   * arithmetic would put it somewhere jest can't reach.
   */
  windowEntries: FoodLogEntry[];
  windowStart: string | null;
  windowEnd: string | null;
  loadWindow: (startKey: string, endKey: string) => void;
  /**
   * A third window, for the Mood screen's insight reads.
   *
   * The same argument that split `windowEntries` off from `entries`, applied
   * once more rather than stretched: Stats owns that one and steps it to its
   * own span, and a Mood screen sharing it would empty a section on a screen
   * nobody had touched. Both are blurred tabs that stay mounted for the life
   * of the session, so a clobbered window is not a frame of wrongness — it
   * lasts until that screen is focused again.
   *
   * Deliberately not a fourth: three named windows is where this stops being
   * worth a keyed map, and a fourth reader is the moment to build one rather
   * than to paste this again.
   */
  insightEntries: FoodLogEntry[];
  insightStart: string | null;
  insightEnd: string | null;
  loadInsightWindow: (startKey: string, endKey: string) => void;
  /**
   * A run of days read straight through, stored nowhere.
   *
   * **The fourth reader the note above warns about, answered without a fourth
   * window.** That warning is about *stored* windows: three named arrays each
   * clobbering each other is what makes a fourth worth a keyed map. This reader
   * — the entry sheet, ranking its list by what has actually been eaten — wants
   * a snapshot at the moment it opens and never wants to be told again, so
   * holding it in the store would be state nothing subscribes to and one more
   * array to keep in step on every write.
   */
  recentEntries: (startKey: string, endKey: string) => FoodLogEntry[];
  /**
   * Record something eaten.
   *
   * The day key is stamped here from `dayResetTime`, never derived from the
   * instant on read — see `FoodLogEntry.dayKey`. This is the grace-window rule
   * from CLAUDE.md, and the food log is where it bites hardest: an 11pm snack
   * recorded at 12:30am with a 02:00 reset belongs to the evening it happened
   * in, not to the day that had barely started.
   */
  /**
   * `undoable: false` is for a caller that is one step of a bigger action and
   * files its own entry (or none): `moveEntry` removes a row and re-adds it, and
   * an undo that deleted the re-added row would lose the meal outright.
   */
  addEntry: (draft: FoodLogDraft, opts?: { undoable?: boolean }) => FoodLogEntry | null;
  updateEntry: (id: string, patch: FoodLogPatch) => void;
  /**
   * Correct an entry, Health included.
   *
   * `updateEntry`'s counterpart for the half of a row that is a claim about
   * what somebody ate rather than about where it is filed. Where that one is
   * deliberately dumb, this one retracts the samples the entry already wrote
   * and writes the corrected figures in their place, which is the pair its
   * doc names: `retractFoodEntryFromHealth` then `logFoodEntryToHealth`.
   *
   * `atISO` and `dayKey` stay unpatchable here too. They were stamped together
   * from one instant under one reset time, and re-dating means a new entry.
   */
  reviseEntry: (id: string, patch: FoodLogPatch) => void;
  /**
   * Writes to Health the entries an agent logged over MCP, which cannot reach
   * HealthKit itself (`FoodLogEntry.healthWritePending`). Goes through
   * `logFoodEntryToHealth`, so every guard a new entry gets applies, and through
   * `recordHealthWrite`, which stores the sample ids and clears the flag.
   *
   * An entry the switch is off for, or this device cannot write, stays pending
   * for a later pass. One too old (`pendingWriteAction`) or stating nothing
   * writable is cleared without a write. Concurrent calls collapse into one, so
   * launch, foreground and a sync landing together cannot write a meal twice.
   * Callers gate on the app being in front (`runPendingHealthFoodWrites`).
   */
  writePendingHealthEntries: () => Promise<void>;
  /**
   * Forget an entry.
   *
   * Once something writes nutrients to Health this is also where those samples
   * are retracted, which is what `FoodLogEntry.healthSampleIds` exists for. A
   * typo'd entry that cannot be unwritten from a medical record is the failure
   * the whole feature is arranged around.
   */
  removeEntry: (id: string, opts?: { undoable?: boolean }) => void;
  /** Forget several entries at once — the bulk bar's Delete. */
  removeEntries: (ids: string[]) => void;
  /** Re-slot several entries at once — the bulk bar's Move to meal. */
  moveEntries: (ids: string[], slot: MealSlot | null) => void;
  /**
   * Move an entry to a different day (or a different moment the same day).
   *
   * Not a patch: `reviseEntry` and `updateEntry` both keep `atISO`/`dayKey`
   * off what they'll touch, per `foodLogEntryEdit`'s own doc comment — "they
   * were stamped together from one instant under one reset time, and
   * re-dating means a new entry." So this composes `removeEntry` (retracting
   * the stale Health sample) and `addEntry` (writing a fresh one at the new
   * instant) rather than adding a second path that pokes `atISO` in place,
   * which is what would leave a HealthKit sample dated the old day while the
   * app's own log said otherwise. `mealPlanEntryId` rides along — this is
   * still the same meal, only its recorded moment was wrong.
   */
  moveEntry: (id: string, at: Date) => FoodLogEntry | null;
  /**
   * Log a copy of an entry onto another day (or another moment today).
   *
   * A new occurrence, not a correction: unlike `moveEntry`, the source entry
   * is untouched, and `mealPlanEntryId` is dropped rather than carried over —
   * a duplicate did not fulfil whatever meal the original was planned
   * against.
   */
  duplicateEntry: (id: string, at: Date) => FoodLogEntry | null;
  /**
   * Persists a drag: each touched entry's new slot and its new position in
   * the day's one running order. A drag that only reorders within a section
   * still goes through this — `slot` is simply unchanged for those rows.
   */
  reorderEntries: (updates: FoodLogPlacement[]) => void;

  /**
   * The meal a just-finished "Eat" step, or a just-emptied leftover, is
   * offering to log. Null while there is nothing to ask about.
   *
   * Watched by `LogMealPrompt` (mounted in AppNavigator beside
   * `FinishLeftoverPrompt`, since a completion can land from Today, Search, a
   * bulk action or the widget rather than from any one screen). Cleared by the
   * prompt's own answer, and by `uncompleteTask` when the tick that set it is
   * taken back.
   */
  pendingMealLog: PendingMealLog | null;
  setPendingMealLog: (pending: PendingMealLog | null) => void;

  /**
   * The meal a just-finished "Eat" step, or its own missed-log nudge task, is
   * offering to log with nothing the app can measure automatically. Null
   * while there is nothing to ask about.
   *
   * Watched by `LogMealEntrySheet` (mounted in AppNavigator beside
   * `LogMealPrompt`), which is `pendingMealLog`'s own mount but for the sheet
   * rather than the modal. Cleared the same two ways: the sheet's own
   * close, and `uncompleteTask` when the tick that set it is taken back.
   */
  pendingManualMealLog: PendingManualMealLog | null;
  setPendingManualMealLog: (pending: PendingManualMealLog | null) => void;

  /**
   * Raise the offer to log a planned meal — the auto-computed prompt for a
   * recipe-backed one, the search sheet for anything else.
   *
   * Lives here rather than beside its first caller because it is now raised
   * from two very different places, and both want the identical offer: a meal
   * slot chain's "Eat" step being ticked (`useTaskStore`, which is where this
   * used to be a module-local function), and a tap on a planned meal that the
   * food log can see hasn't been logged yet (`FoodLogScreen`). It only ever
   * writes the two pending fields above, which is exactly what this store owns.
   *
   * **It does not check `mealLogPrompt` and must not.** That setting is the
   * ceiling on the app *volunteering* an offer, which is the unattended
   * caller's question to ask (`wantsMealLogPrompt`, `mealLog.ts`) — a person
   * tapping a planned meal has asked for it outright, and a switch meaning
   * "stop interrupting me" was never meant to answer that.
   *
   * `asked` says which of the two it is — see `PendingMealLog.asked`.
   */
  offerMealLog: (entry: MealPlanEntry, opts?: { asked?: boolean }) => void;

  /**
   * True when Health has just refused a meal and the person has not been told.
   *
   * Watched by `HealthWriteRefusedNotice` (mounted in AppNavigator beside
   * `LogMealPrompt`), for the reason those two are mounted there rather than on
   * a screen: a meal is logged from the food log, a meal plan square, a cook
   * task's prompt or a nudge, and the notice has to reach whichever one the
   * person is standing on.
   *
   * Session state, because it only means "there is something to say right
   * now". Whether it has *already* been said is `healthFoodWriteRefusalSeen`
   * in settings, which persists.
   */
  pendingHealthWriteRefusal: boolean;
  setPendingHealthWriteRefusal: (pending: boolean) => void;
}

/** How this module hands state back, so the helper below can share it. */
type FoodLogSet = (
  partial: Partial<FoodLogStore> | ((s: FoodLogStore) => Partial<FoodLogStore>),
) => void;

/**
 * Reconciles the water-quota tasks against today's food log total, once a
 * write has actually landed — the log-to-task half of the connection
 * `logHealthMetric: 'waterMl'` makes. See `syncWaterQuotaTasks`'s own doc
 * comment in `useTaskStore.ts` for what it does; this is only the choke
 * point that calls it. Skipped for anything backdated, which cannot change
 * what today's own total is, the same gate the Health re-read above it uses
 * and for the same reason.
 */
/**
 * Puts a row into whichever of the three loaded windows its day falls inside,
 * and nothing else. Shared by `addEntry` and by undoing a delete, so a restored
 * row lands exactly where a fresh one would.
 */
function insertIntoWindows(entry: FoodLogEntry, get: () => FoodLogStore, set: FoodLogSet): void {
  const { rangeStart, rangeEnd, windowStart, windowEnd, insightStart, insightEnd } = get();
  const byInstant = (a: FoodLogEntry, b: FoodLogEntry) => a.atISO.localeCompare(b.atISO);
  if (rangeStart && rangeEnd && entry.dayKey >= rangeStart && entry.dayKey <= rangeEnd) {
    set(s => ({ entries: [...s.entries, entry].sort(byInstant) }));
  }
  if (windowStart && windowEnd && entry.dayKey >= windowStart && entry.dayKey <= windowEnd) {
    set(s => ({ windowEntries: [...s.windowEntries, entry].sort(byInstant) }));
  }
  if (insightStart && insightEnd && entry.dayKey >= insightStart && entry.dayKey <= insightEnd) {
    set(s => ({ insightEntries: [...s.insightEntries, entry].sort(byInstant) }));
  }
}

/**
 * Undo of a delete: writes the rows back under their own ids.
 *
 * The samples a delete retracted from Health are gone, so the restored rows
 * start with none and are written again, the same write `addEntry` makes. That
 * is the one place Health is written outside add and revise, and it is the
 * mirror of the retract the delete sent.
 */
function restoreEntries(rows: FoodLogEntry[], get: () => FoodLogStore, set: FoodLogSet): void {
  for (const row of rows) {
    if (dbGetFoodLogEntry(row.id)) continue;
    const restored: FoodLogEntry = { ...row, healthSampleIds: [] };
    dbInsertFoodLogEntry(restored);
    set(s => ({ totalCount: s.totalCount + 1 }));
    insertIntoWindows(restored, get, set);
    void logFoodEntryToHealth(restored).then(result => recordHealthWrite(restored, result, set));
  }
  const todayKey = dayKeyOf(getCurrentDayStart());
  if (rows.some(r => r.dayKey === todayKey)) {
    useTaskStore.getState().syncWaterQuotaTasks();
    useTaskStore.getState().syncSnackNudgeTasks();
    useTaskStore.getState().syncLimitWarningTasks();
  }
}

/** The fields `patch` names, as `entry` holds them now: what undoes the patch. */
function priorFields(entry: FoodLogEntry, patch: FoodLogPatch): FoodLogPatch {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) before[key] = (entry as unknown as Record<string, unknown>)[key];
  return before as FoodLogPatch;
}

function syncWaterQuotaTasksIfToday(dayKey: string): void {
  if (dayKey !== dayKeyOf(getCurrentDayStart())) return;
  useTaskStore.getState().syncWaterQuotaTasks();
  // The snack suggestion reads the same log, so a write that lands is also the
  // moment it should come on or go away.
  useTaskStore.getState().syncSnackNudgeTasks();
  // And the Stay under warnings, off the same totals.
  useTaskStore.getState().syncLimitWarningTasks();
  // And the meal's own task: food logged into lunch answers "Choose lunch".
  useTaskStore.getState().syncLoggedMealSlotTasks();
}

/**
 * Files what Health said about one entry: its sample ids, or the one refusal
 * worth saying out loud.
 *
 * Shared by the two paths that write, so a meal logged and a meal corrected
 * are reported identically. A refusal in practice means sharing was never
 * granted in Health's own sheet, and it is invisible: the row saved either
 * way, so the only sign is a meal that never arrives. Said once rather than
 * per meal, and re-armed by a write that lands, so a later breakage is
 * surfaced instead of being swallowed by having complained once already.
 *
 * The other three outcomes stay silent on purpose. `off` is the switch doing
 * what it says, `unavailable` is a device with no Health at all (or demo
 * mode), and `nothingToWrite` is an entry stating no figure, which is an
 * ordinary thing to log and not a fault.
 *
 * The row is rewritten straight through rather than via `updateEntry`, which
 * only finds rows inside the loaded range: a meal backdated outside the window
 * on screen is stored and simply isn't in `entries`, and losing its ids would
 * mean samples that can never be retracted. It is rebuilt from the entry the
 * caller already holds, so no read is needed either.
 */
function recordHealthWrite(entry: FoodLogEntry, result: FoodWriteResult, set: FoodLogSet): void {
  const settings = useSettingsStore.getState();
  if (result.outcome === 'refused') {
    if (!settings.healthFoodWriteRefusalSeen) {
      settings.setHealthFoodWriteRefusalSeen(true);
      set({ pendingHealthWriteRefusal: true });
    }
    return;
  }
  if (result.outcome !== 'written') return;
  if (settings.healthFoodWriteRefusalSeen) settings.setHealthFoodWriteRefusalSeen(false);

  // The row as it stands now, not as it stood when the write set off. The
  // write is a round trip to HealthKit, and the entry can be deleted, moved
  // (a re-date is a delete and a fresh row) or corrected before it comes back.
  // Stamping the snapshot wrote the old figures back over a correction and
  // left a moved or deleted entry's samples in Health with nothing pointing at
  // them. So a row that is gone, or whose figures are no longer what was just
  // written, takes the samples back out instead: whatever changed it has
  // already sent Health its own write.
  const fresh = dbGetFoodLogEntry(entry.id);
  if (!fresh || healthFiguresDiffer(entry, fresh)) {
    void retractFoodEntryFromHealth(result.sampleIds);
    return;
  }
  // Also clears `healthWritePending`: written is written, whichever path asked.
  const written = { healthSampleIds: result.sampleIds, healthWritePending: false };
  dbUpdateFoodLogEntry({ ...fresh, ...written });
  const stamp = (e: FoodLogEntry) => (e.id === entry.id ? { ...e, ...written } : e);
  set(s => ({
    entries: s.entries.map(stamp),
    windowEntries: s.windowEntries.map(stamp),
    insightEntries: s.insightEntries.map(stamp),
  }));

  // A nutrient sample landing in Health just now is the one thing that can
  // make a health rule newly true, and nothing else prompts a re-read:
  // `useHealthSync` only refreshes the in-memory reading `checkHealthTasks`
  // judges against on mount, a settings change, or the app coming back to
  // the foreground — so a session spent entirely inside this app's own food
  // log (open it, log breakfast, lunch and dinner, never background it)
  // never sees today's total move and the rule is never re-judged. Skipped
  // for a backdated entry, which cannot change what today's own reading is.
  if (entry.dayKey === dayKeyOf(getCurrentDayStart())) {
    void useHealthStore.getState().refresh().then(() => {
      useTaskStore.getState().checkHealthTasks();
    });
  }
}

let pendingWriteRunning = false;

/** Drops the pending flag from a row as it stands now, on disk and in memory. */
function clearHealthWritePending(id: string, set: FoodLogSet): void {
  const fresh = dbGetFoodLogEntry(id);
  if (!fresh || !fresh.healthWritePending) return;
  dbUpdateFoodLogEntry({ ...fresh, healthWritePending: false });
  const clear = (e: FoodLogEntry) => (e.id === id ? { ...e, healthWritePending: false } : e);
  set(s => ({
    entries: s.entries.map(clear),
    windowEntries: s.windowEntries.map(clear),
    insightEntries: s.insightEntries.map(clear),
  }));
}

/**
 * Whether a correction changed anything Health is holding.
 *
 * Compared per nutrient over `NUTRIENT_KEYS` rather than by stringifying the
 * record, so two panels built in different orders can't read as different and
 * cost somebody a needless rewrite of their own medical record.
 */
function healthFiguresDiffer(before: FoodLogEntry, after: FoodLogEntry): boolean {
  if (before.label !== after.label) return true;
  return NUTRIENT_KEYS.some(key => before.nutrition.amounts[key] !== after.nutrition.amounts[key]);
}

/**
 * Whether a re-read of a window came back with exactly the rows already held.
 * The rows carry no updated stamp, so this compares contents; a row built in
 * memory with its keys in another order merely reads as changed, which costs
 * the re-render this exists to skip and nothing worse.
 */
export function sameEntries(held: readonly FoodLogEntry[], read: readonly FoodLogEntry[]): boolean {
  if (held.length !== read.length) return false;
  return held.every((e, i) => e === read[i] || JSON.stringify(e) === JSON.stringify(read[i]));
}

export const useFoodLogStore = create<FoodLogStore>((set, get) => ({
  entries: [],
  rangeStart: null,
  rangeEnd: null,
  windowEntries: [],
  windowStart: null,
  windowEnd: null,
  insightEntries: [],
  insightStart: null,
  insightEnd: null,
  totalCount: 0,
  initialized: false,
  pendingMealLog: null,
  pendingManualMealLog: null,
  pendingHealthWriteRefusal: false,
  lastAction: null,
  undoStack: [],
  redoStack: [],
  ...undoHistoryActions(set, get),

  initialize() {
    // The current logical day, because that is what a day view opens on and it
    // is one small read. Anything wider is the screen's own loadRange call.
    const todayKey = dayKeyOf(getCurrentDayStart());
    set({
      entries: dbGetFoodLogEntries(todayKey, todayKey),
      rangeStart: todayKey,
      rangeEnd: todayKey,
      totalCount: dbCountFoodLogEntries(),
      initialized: true,
    });
  },

  loadRange(startKey, endKey) {
    const entries = dbGetFoodLogEntries(startKey, endKey);
    const s = get();
    // Called on every return to the food log, for loadWindow's reason.
    if (s.rangeStart === startKey && s.rangeEnd === endKey && sameEntries(s.entries, entries)) return;
    set({ entries, rangeStart: startKey, rangeEnd: endKey });
  },

  entriesSince(fromKey) {
    return dbGetFoodLogEntries(fromKey ?? '0000-01-01', '9999-12-31');
  },

  loadWindow(startKey, endKey) {
    const entries = dbGetFoodLogEntries(startKey, endKey);
    const s = get();
    // Called on every focus of Stats; a fresh array of identical rows would
    // re-render the whole screen for nothing (see sameEntries).
    if (s.windowStart === startKey && s.windowEnd === endKey && sameEntries(s.windowEntries, entries)) return;
    set({ windowEntries: entries, windowStart: startKey, windowEnd: endKey });
  },

  recentEntries(startKey, endKey) {
    return dbGetFoodLogEntries(startKey, endKey);
  },

  loadInsightWindow(startKey, endKey) {
    const entries = dbGetFoodLogEntries(startKey, endKey);
    const s = get();
    // Called on every focus of Mood, for loadWindow's reason.
    if (s.insightStart === startKey && s.insightEnd === endKey && sameEntries(s.insightEntries, entries)) return;
    set({ insightEntries: entries, insightStart: startKey, insightEnd: endKey });
  },

  addEntry(draft, opts) {
    // The row itself, and its refusals, are `buildFoodLogEntry`'s, which the
    // MCP server shares. Everything after the insert is this store's.
    const entry = buildFoodLogEntry(draft, dayKey => dbGetFoodLogEntries(dayKey, dayKey), generateId);
    if (!entry) return null;
    dbInsertFoodLogEntry(entry);
    set(s => ({ totalCount: s.totalCount + 1 }));

    // Only into the windows on screen. An entry backdated outside them is
    // stored and simply isn't loaded, the contract the range read already keeps.
    insertIntoWindows(entry, get, set);

    // One of the two triggers, the other being `reviseEntry` correcting what
    // this one wrote. `logFoodEntryToHealth` is called from those two and from
    // nowhere else, the same single-writer rule the water write keeps and for
    // the same reason: a caller that looped it into a save, a sweep or a sync
    // pass would put meals nobody ate into somebody's medical record. It owns
    // every guard (demo mode, the write switch, the bridge), so this is not the
    // place to add another.
    //
    // Fire-and-forget with a follow-up patch, because the write is a native
    // round trip and this action is synchronous. A failure needs no repair: the
    // entry keeps its empty `healthSampleIds`, which is exactly what "wrote
    // nothing, so there is nothing to retract" means. It does need *saying*,
    // for the one outcome a person can act on — see `recordHealthWrite`.
    void logFoodEntryToHealth(entry).then(result => recordHealthWrite(entry, result, set));
    syncWaterQuotaTasksIfToday(entry.dayKey);

    if (opts?.undoable !== false) {
      get().setLastAction({
        label: `Logged "${entry.label}"`,
        // removeEntry also retracts what was written to Health.
        undo: () => get().removeEntry(entry.id),
        redo: () => { get().addEntry(draft); },
      });
    }

    return entry;
  },

  /**
   * Patches a row. Deliberately dumb, and deliberately not a Health writer.
   *
   * This is what `addEntry`'s own Health write calls back into to store the
   * sample ids, so a retract-and-rewrite here would chase its own tail. The
   * one thing the UI changes through it is an entry's catalog link, which is
   * provenance and reaches neither `nutrition` nor `label` — so the rule below
   * still holds and is still unexercised.
   *
   * **An edit path reaching `nutrition` or `label` goes through `reviseEntry`
   * instead**, which retracts the old samples and writes new ones rather than
   * patching the row and leaving Health stating the meal as first typed.
   */
  updateEntry(id, patch) {
    const entry = get().entries.find(e => e.id === id);
    if (!entry) return;
    // `atISO` and `dayKey` are deliberately not patchable. They were stamped
    // together from one instant under one reset time, and letting an edit move
    // one without the other is how an entry ends up counted on a day it did not
    // happen on. Re-dating means a new entry.
    const updated: FoodLogEntry = { ...entry, ...patch };
    dbUpdateFoodLogEntry(updated);
    set(s => ({
      entries: s.entries.map(e => (e.id === id ? updated : e)),
      windowEntries: s.windowEntries.map(e => (e.id === id ? updated : e)),
      insightEntries: s.insightEntries.map(e => (e.id === id ? updated : e)),
    }));
    // Moving a row into a meal is the other way food lands in a slot.
    if (patch.slot !== undefined) useTaskStore.getState().syncLoggedMealSlotTasks();
    const before = priorFields(entry, patch);
    get().setLastAction({
      label: `Edited "${entry.label}"`,
      undo: () => get().updateEntry(id, before),
      redo: () => get().updateEntry(id, patch),
    });
  },

  reviseEntry(id, patch) {
    // Read from SQLite rather than from `entries`, the rule every other write
    // here keeps: a backdated entry outside the window on screen is an
    // ordinary row, and finding it only when it happens to be loaded would
    // leave a correction silently doing nothing.
    const current = dbGetFoodLogEntry(id);
    if (!current) return;

    const updated: FoodLogEntry = { ...current, ...patch };
    const rewrites = healthFiguresDiffer(current, updated);
    // Cleared as the row is written rather than once the retract comes back,
    // so nothing is ever left pointing at samples already on their way out.
    if (rewrites) updated.healthSampleIds = [];

    const before = priorFields(current, patch);
    get().setLastAction({
      label: `Edited "${current.label}"`,
      // Through reviseEntry again, so Health is retracted and rewritten to the
      // figures being restored rather than left stating the edit.
      undo: () => get().reviseEntry(id, before),
      redo: () => get().reviseEntry(id, patch),
    });

    dbUpdateFoodLogEntry(updated);
    const swap = (e: FoodLogEntry) => (e.id === id ? updated : e);
    set(s => ({
      entries: s.entries.map(swap),
      windowEntries: s.windowEntries.map(swap),
      insightEntries: s.insightEntries.map(swap),
    }));

    // A correction that moved the meal or re-filed the item changed nothing
    // Health is holding, and rewriting anyway would churn somebody's medical
    // record for a field it never saw.
    if (!rewrites) return;

    syncWaterQuotaTasksIfToday(updated.dayKey);

    const stale = current.healthSampleIds;
    void (async () => {
      // In that order, and the write happens either way. A retract that fails
      // leaves the old sample in Health exactly as a failed retract on delete
      // does, which is something the person can remove there; skipping the
      // write over it would instead leave Health holding only the figures that
      // were just corrected.
      if (stale.length > 0) await retractFoodEntryFromHealth(stale);
      recordHealthWrite(updated, await logFoodEntryToHealth(updated), set);
    })();
  },

  async writePendingHealthEntries() {
    if (pendingWriteRunning) return;
    pendingWriteRunning = true;
    try {
      for (const entry of dbGetPendingHealthFoodEntries()) {
        if (pendingWriteAction(entry) === 'drop') {
          clearHealthWritePending(entry.id, set);
          continue;
        }
        const result = await logFoodEntryToHealth(entry);
        // Nothing the entry states can be written, now or later: waiting would
        // only retry the same answer.
        if (result.outcome === 'nothingToWrite') clearHealthWritePending(entry.id, set);
        else recordHealthWrite(entry, result, set);
      }
    } finally {
      pendingWriteRunning = false;
    }
  },

  setPendingMealLog(pending) {
    set({ pendingMealLog: pending });
  },

  setPendingManualMealLog(pending) {
    set({ pendingManualMealLog: pending });
  },

  offerMealLog(entry, opts) {
    if (entry.recipeId) {
      set({
        pendingManualMealLog: null,
        pendingMealLog: {
          label: entry.title,
          slot: entry.slot,
          dayKey: entry.date,
          recipeId: entry.recipeId,
          mealPlanEntryId: entry.id,
          scale: entry.recipeScale,
          choices: entry.recipeChoices,
          // A meal cooked tonight has nothing weighed yet — the prompt asks.
          // Only a container that was weighed on the way into the fridge
          // arrives with a figure (see finishLeftover).
          grams: null,
          asked: opts?.asked === true,
        },
      });
      return;
    }
    // Cleared in the same commit rather than left standing: the two prompts
    // are separate global mounts and only one of them may be showing at a
    // time (see `PendingManualMealLog`), which is a rule a second offer
    // raised over the first would otherwise break.
    set({
      pendingMealLog: null,
      pendingManualMealLog: {
        label: entry.title,
        slot: entry.slot,
        dayKey: entry.date,
        mealPlanEntryId: entry.id,
      },
    });
  },

  setPendingHealthWriteRefusal(pending) {
    set({ pendingHealthWriteRefusal: pending });
  },

  removeEntry(id, opts) {
    // Read before the delete, since the ids (and the day) are on the row
    // that is about to go. A meal removed from the log has to be removed
    // from Health too: an entry logged against the wrong picker and left in
    // a medical record is the permanent-false-fact case this whole feature
    // is arranged around. Nothing is awaited and nothing is undone on
    // failure — the row is gone either way, and Health's own record is
    // something the person can delete there.
    // Read from the database rather than from the loaded arrays, for the same
    // reason the write above does not go through `updateEntry`: a backdated
    // entry outside the window on screen is an ordinary row, and finding it
    // only when it happens to be loaded would strand its samples.
    const removed = dbGetFoodLogEntry(id);
    const written = removed?.healthSampleIds ?? [];
    if (written.length > 0) void retractFoodEntryFromHealth(written);

    dbDeleteFoodLogEntry(id);
    set(s => ({
      entries: s.entries.filter(e => e.id !== id),
      windowEntries: s.windowEntries.filter(e => e.id !== id),
      insightEntries: s.insightEntries.filter(e => e.id !== id),
      // Floored, so a delete of a row outside the loaded window can't drive the
      // count negative and make the screen vanish while it still holds entries.
      totalCount: Math.max(0, s.totalCount - 1),
    }));
    if (removed) syncWaterQuotaTasksIfToday(removed.dayKey);
    if (removed && opts?.undoable !== false) {
      get().setLastAction({
        label: `Deleted "${removed.label}"`,
        destructive: true,
        undo: () => restoreEntries([removed], get, set),
        redo: () => get().removeEntry(id),
      });
    }
  },

  removeEntries(ids) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    // Same rule removeEntry keeps, just over several rows: a meal removed
    // from the log has to be removed from Health too, and read from the
    // database rather than the loaded arrays so a backdated entry outside
    // the window on screen doesn't strand its samples.
    const removed = ids.map(id => dbGetFoodLogEntry(id)).filter((e): e is FoodLogEntry => e !== null);
    const written = removed.flatMap(e => e.healthSampleIds);
    if (written.length > 0) void retractFoodEntryFromHealth(written);

    dbBulkDeleteFoodLogEntries(ids);
    set(s => ({
      entries: s.entries.filter(e => !idSet.has(e.id)),
      windowEntries: s.windowEntries.filter(e => !idSet.has(e.id)),
      insightEntries: s.insightEntries.filter(e => !idSet.has(e.id)),
      totalCount: Math.max(0, s.totalCount - idSet.size),
    }));
    const todayKey = dayKeyOf(getCurrentDayStart());
    if (removed.some(e => e.dayKey === todayKey)) {
      useTaskStore.getState().syncWaterQuotaTasks();
      useTaskStore.getState().syncSnackNudgeTasks();
      useTaskStore.getState().syncLimitWarningTasks();
    }
    if (removed.length > 0) {
      get().setLastAction({
        label: removed.length === 1 ? `Deleted "${removed[0].label}"` : `${removed.length} entries deleted`,
        destructive: true,
        undo: () => restoreEntries(removed, get, set),
        redo: () => get().removeEntries(ids),
      });
    }
  },

  moveEntries(ids, slot) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const priorSlots = get().entries.filter(e => idSet.has(e.id)).map(e => ({ id: e.id, slot: e.slot }));
    dbBulkSetFoodLogSlot(ids, slot);
    set(s => ({
      entries: s.entries.map(e => (idSet.has(e.id) ? { ...e, slot } : e)),
      windowEntries: s.windowEntries.map(e => (idSet.has(e.id) ? { ...e, slot } : e)),
      // The insight window too. A slot change is not cosmetic to it: the
      // thin-day rule counts *distinct meals*, so moving two entries into one
      // slot can drop a day out of every mood pairing.
      insightEntries: s.insightEntries.map(e => (idSet.has(e.id) ? { ...e, slot } : e)),
    }));
    if (priorSlots.length > 0) {
      get().setLastAction({
        label: priorSlots.length === 1 ? 'Moved 1 entry' : `Moved ${priorSlots.length} entries`,
        undo: () => {
          const bySlot = new Map<MealSlot | null, string[]>();
          for (const p of priorSlots) bySlot.set(p.slot, [...(bySlot.get(p.slot) ?? []), p.id]);
          for (const [prior, group] of bySlot) get().moveEntries(group, prior);
        },
        redo: () => get().moveEntries(ids, slot),
      });
    }
  },

  reorderEntries(updates) {
    if (updates.length === 0) return;
    const wanted = new Set(updates.map(u => u.id));
    const prior: FoodLogPlacement[] = get().entries
      .filter(e => wanted.has(e.id))
      .map(e => ({ id: e.id, slot: e.slot, sortOrder: e.sortOrder }));
    dbBulkUpdateFoodLogPlacement(updates);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({
      entries: s.entries.map(e => {
        const u = byId.get(e.id);
        return u ? { ...e, slot: u.slot, sortOrder: u.sortOrder } : e;
      }),
      windowEntries: s.windowEntries.map(e => {
        const u = byId.get(e.id);
        return u ? { ...e, slot: u.slot, sortOrder: u.sortOrder } : e;
      }),
      insightEntries: s.insightEntries.map(e => {
        const u = byId.get(e.id);
        return u ? { ...e, slot: u.slot, sortOrder: u.sortOrder } : e;
      }),
    }));
    if (prior.length > 0) {
      get().setLastAction({
        label: 'Reordered meals',
        undo: () => get().reorderEntries(prior),
        redo: () => get().reorderEntries(updates),
      });
    }
  },

  moveEntry(id, at) {
    const current = dbGetFoodLogEntry(id);
    if (!current) return null;
    get().removeEntry(id, { undoable: false });
    const moved = get().addEntry({
      label: current.label,
      quantity: current.quantity,
      grams: current.grams,
      nutrition: current.nutrition,
      // The same food, so the same panel to correct it against later.
      sourcePanel: current.sourcePanel ?? null,
      slot: current.slot,
      recipeId: current.recipeId,
      itemId: current.itemId,
      productId: current.productId,
      mealPlanEntryId: current.mealPlanEntryId,
      at,
    }, { undoable: false });
    // One step for the pair. Undoing puts the original row back under its own
    // id and drops the re-dated copy; redoing runs the move again from it.
    if (moved) {
      get().setLastAction({
        label: `Moved "${current.label}"`,
        undo: () => {
          get().removeEntry(moved.id);
          restoreEntries([current], get, set);
        },
        redo: () => { get().moveEntry(id, at); },
      });
    }
    return moved;
  },

  duplicateEntry(id, at) {
    const current = dbGetFoodLogEntry(id);
    if (!current) return null;
    return get().addEntry({
      label: current.label,
      quantity: current.quantity,
      grams: current.grams,
      nutrition: current.nutrition,
      // The same food, so the same panel to correct it against later.
      sourcePanel: current.sourcePanel ?? null,
      slot: current.slot,
      recipeId: current.recipeId,
      itemId: current.itemId,
      productId: current.productId,
      mealPlanEntryId: null,
      at,
    });
  },
}));
