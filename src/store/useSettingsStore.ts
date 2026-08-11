import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import type { ThemeMode } from '../theme';
import { DEFAULT_APP_FONT, isAppFont, type AppFont } from '../theme/fonts';
import type { SortOption, Priority, Effort } from '../types';
import { parseRetentionDays, type RetentionDays } from '../utils/retention';
import { DEFAULT_APP_LOCK_GRACE_SECONDS, parseGraceSeconds } from '../utils/appLock';
import { loadAnthropicApiKey, saveAnthropicApiKey } from '../utils/secureApiKey';
import {
  AI_FEATURE_IDS, defaultAiFeatureConfig, isAiModelId,
  type AiFeatureConfig, type AiFeatureConfigMap, type AiFeatureId,
} from '../utils/aiFeatures';

export type PatchNoteQaStatus = 'pass' | 'fail';

// Which day a week starts on, in date-fns' numbering (0 = Sunday, 1 = Monday).
// Only these two are offered — the rest of date-fns' range exists for locales
// the app doesn't otherwise support, and a seven-way picker for a setting two
// answers cover is a worse row.
export type WeekStart = 0 | 1;

/**
 * Which bottom corner the add button rests in — a reach preference, not a
 * layout direction. Only the add affordances move: the app's other
 * left-anchored decisions (the drawer's edge swipe, a row's leading checkbox,
 * swipe directions) are deliberate and stay put, so this is not an RTL flag.
 *
 * Read by Fab.tsx (the screen button and its menu), MiniFabList.tsx — which
 * puts the in-card add button in the matching corner of the subtasks and stack
 * cards, so both buttons fall under the same thumb — and DemoBanner.tsx, which
 * parks itself in whichever corner the button isn't using.
 */
export type FabHand = 'right' | 'left';

interface SettingsStore {
  dayResetTime: string;   // "HH:MM" — when the logical day flips (default midnight "00:00")
  morningStart: string;   // "HH:MM" — when morning begins (default "06:00")
  afternoonStart: string; // "HH:MM" — when afternoon begins (default "12:00")
  eveningStart: string;   // "HH:MM" — when evening begins (default "18:00")
  nightStart: string;     // "HH:MM" — when night begins (default "21:00")
  // The hours you're actually awake and able to chip away at a quota task —
  // the span its expected-by-now pace ramps across (see quotaExpectedByNow).
  // Deliberately separate from morningStart, which is when morning-segment
  // tasks unhide and can legitimately sit hours before you get up, and from
  // dayResetTime, which decides which calendar day a task belongs to.
  activeHoursStart: string; // "HH:MM" (default "08:00")
  activeHoursEnd: string;   // "HH:MM" (default "22:00")
  // "Don't buzz me between X and Y" for scheduleTaskReminder/scheduleTimerAlarm
  // (src/utils/notifications.ts). Both null = off, which is the default — an
  // existing install keeps buzzing exactly as before until the user opts in.
  // Deliberately its own pair rather than reusing activeHoursStart/activeHoursEnd
  // above: those are the span daily-target pacing ramps across (see the comment
  // on them), an unrelated concept that happens to share the "HH:MM" shape —
  // someone awake at 2am doing something else entirely still doesn't want a
  // task reminder going off. Set together via setQuietHours so a half-set
  // window (a start with no end) is unrepresentable.
  quietHoursStart: string | null; // "HH:MM"
  quietHoursEnd: string | null;   // "HH:MM"
  themeMode: ThemeMode;
  appFont: AppFont; // typeface for the whole app — see src/theme/fonts.ts
  use24HourTime: boolean; // render clock times as "17:30" rather than "5:30 PM"
  weekStartsOn: WeekStart;
  fabHand: FabHand;
  hapticsEnabled: boolean;
  // The accelerometer-driven "shake to undo" gesture (src/utils/useShakeToUndo.ts).
  // On by default, like hapticsEnabled, so an existing install keeps the
  // behavior it already had. Off skips the Accelerometer subscription
  // entirely rather than gating at the callback, so turning it off actually
  // stops the sensor from running.
  shakeToUndoEnabled: boolean;
  // Today's sort & filter, persisted so they survive a cold launch. They're
  // view state rather than a preference — nothing in Settings shows them — but
  // they live here because losing your sort on every launch is the one thing
  // that made the sheet feel broken. Safe to persist the *filters* (which hide
  // tasks, unlike sort) only because TodayScreen always shows the active count
  // as a badge on the sort button and swaps in a "No tasks match these
  // filters" empty state; without both of those this would be a trap.
  sortOption: SortOption;
  filterPriorities: Priority[];
  filterEfforts: Effort[];
  // One summary notification each morning. Off by default — an app that
  // starts notifying you daily because you installed it is the reason people
  // turn notifications off wholesale.
  dailyAgendaEnabled: boolean;
  dailyAgendaTime: string; // "HH:MM"
  // Lives in the device keychain, not the settings table — see
  // src/utils/secureApiKey.ts. It's held here in memory like any other setting,
  // but it arrives a tick late: initialize() is synchronous and the keychain
  // isn't, so initializeSecrets() fills it in (and migrates the old plaintext
  // row) right after. Everything that reads it already treats '' as "AI is off".
  anthropicApiKey: string;
  // Per-feature on/off + model choice for every place the app calls out to
  // Anthropic (see src/utils/aiFeatures.ts and src/services/aiSuggestions.ts).
  // Kept out of DEFAULT_SETTINGS/resetToDefaults for the same reason as
  // patchNotesQaStatus: it's an object, and String(value) doesn't round-trip
  // one. "Reset settings" also has no business quietly re-enabling a feature
  // someone turned off or changing which model they pay for.
  aiFeatureConfig: AiFeatureConfigMap;
  // Face ID (or the device passcode) in front of the whole app. Both of these
  // stay out of DEFAULT_SETTINGS: "reset settings" must not be a way to turn
  // someone's lock off.
  appLockEnabled: boolean;
  appLockGraceSeconds: number; // how long backgrounded before it re-locks
  vacationMode: boolean;
  vacationStart: string | null;
  vacationEnd: string | null; // optional ISO date — vacation mode auto-turns-off once this passes
  autoRemoveExpiredTasks: boolean;
  autoArchiveProjectsOnComplete: boolean;
  // How long completed tasks are kept before a startup purge deletes them.
  // null = forever, and forever is the default: nothing about an existing
  // install changes until the user picks a window in Settings. See
  // src/utils/retention.ts for what a purge may take.
  completedRetentionDays: RetentionDays;
  // Pre-fills the Remind Me field when a task is given a specific clock time
  // (its `windowStart`) — see TaskEditor's `applyDefaultReminderLead`. null =
  // off, the default, so an existing install gets no reminders it didn't ask
  // for. Deliberately doesn't engage for a bare due date or a time-of-day
  // segment (morning/afternoon/evening): neither pins down an actual clock
  // time, and "30 minutes before the day reset" is not a useful reminder.
  defaultReminderLeadMinutes: number | null;
  hideCategories: boolean; // Today's "Hide categories" display option, in Sort & Filter
  // Pulling tasks out of the Reminders app and into the Inbox — the app's voice
  // capture story, since Siri needs no app name to add a reminder. Off by
  // default and never inferred: importing *deletes* the reminder, so it only
  // ever runs against a list the user picked and confirmed by name and count.
  // That's what the third field is for — it holds the list the confirmation was
  // given for, so changing list re-asks rather than swallowing a fresh backlog.
  remindersImportEnabled: boolean;
  remindersImportListId: string | null;
  remindersImportConfirmedListId: string | null;
  // Whether an imported reminder is deleted from the Reminders app. On by
  // default, and on is the mode the whole feature was built around: the delete
  // is what stops a capture being imported twice. Off turns it into a one-way
  // mirror — the list keeps its contents, and a name index over the existing
  // tasks stands in for the delete (see remindersImport.ts). Kept per
  // destination because the two lists are used differently: a dictation inbox
  // wants emptying, a shared grocery list usually doesn't.
  remindersImportDelete: boolean;
  // A second Reminders list, drained into the grocery list instead of the
  // Inbox — which is what makes "Hey Siri, add milk to my Groceries list"
  // land somewhere useful. Must never be the same list as the one above; the
  // picker enforces that (see reminderListOptions' excludeId).
  groceryImportEnabled: boolean;
  groceryImportListId: string | null;
  groceryImportConfirmedListId: string | null;
  /** remindersImportDelete's twin, for the grocery list. Same default, same rules. */
  groceryImportDelete: boolean;
  // Whether the schedule an import parses out of a reminder — its due date,
  // repeat, and alarm — waits on the Inbox row as a suggestion the user taps
  // to accept, or is simply applied. On by default: applying is what takes a
  // capture out of the Inbox and onto Today, and a voice note nobody has read
  // yet is exactly the thing that should not schedule itself.
  remindersImportReview: boolean;
  // When the user last dismissed the quiet-projects banner. Read only through
  // isProjectNudgeDismissedToday, which compares it against today rather than
  // testing it for existence — so it expires at the day rollover on its own and
  // nothing ever has to clear it (same idiom as TaskGroup.completedAt).
  projectNudgeDismissedAt: string | null;
  patchNotesQaStatus: Record<string, PatchNoteQaStatus>; // patch note id -> QA result
  // What a *new* project's nudgeCadenceDays starts at (see DEFAULT_NUDGE_CADENCE_DAYS
  // in src/types/index.ts for why that constant itself stays 0). This is the
  // opt-in the other direction: someone who wants every new project chasing
  // them sets it once here instead of by hand on every project they create.
  // Changing it only affects projects created after the change — existing
  // projects keep whatever cadence they were given.
  defaultProjectNudgeCadenceDays: number;
  initialized: boolean;
  initialize: () => void;
  /** Loads the keychain-backed settings. Call after initialize(). */
  initializeSecrets: () => Promise<void>;
  setDayResetTime: (time: string) => void;
  setMorningStart: (time: string) => void;
  setAfternoonStart: (time: string) => void;
  setEveningStart: (time: string) => void;
  setNightStart: (time: string) => void;
  setActiveHoursStart: (time: string) => void;
  setActiveHoursEnd: (time: string) => void;
  /** Set both at once, or (null, null) to turn quiet hours off. */
  setQuietHours: (start: string | null, end: string | null) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAppFont: (fontId: AppFont) => void;
  setDailyAgendaEnabled: (on: boolean) => void;
  setDailyAgendaTime: (time: string) => void;
  setUse24HourTime: (on: boolean) => void;
  setWeekStartsOn: (day: WeekStart) => void;
  setFabHand: (hand: FabHand) => void;
  setHapticsEnabled: (on: boolean) => void;
  setShakeToUndoEnabled: (on: boolean) => void;
  setSortOption: (sort: SortOption) => void;
  setFilterPriorities: (priorities: Priority[]) => void;
  setFilterEfforts: (efforts: Effort[]) => void;
  setAnthropicApiKey: (key: string) => void;
  setAiFeatureConfig: (id: AiFeatureId, patch: Partial<AiFeatureConfig>) => void;
  setAppLockEnabled: (on: boolean) => void;
  setAppLockGraceSeconds: (seconds: number) => void;
  setVacationMode: (on: boolean, endDate?: string | null) => void;
  setVacationEnd: (endDate: string | null) => void;
  setAutoRemoveExpiredTasks: (on: boolean) => void;
  setAutoArchiveProjectsOnComplete: (on: boolean) => void;
  setCompletedRetentionDays: (days: RetentionDays) => void;
  setDefaultReminderLeadMinutes: (minutes: number | null) => void;
  setHideCategories: (on: boolean) => void;
  setRemindersImportEnabled: (on: boolean) => void;
  setRemindersImportListId: (id: string | null) => void;
  setRemindersImportConfirmedListId: (id: string | null) => void;
  setRemindersImportDelete: (on: boolean) => void;
  setGroceryImportEnabled: (on: boolean) => void;
  setGroceryImportListId: (id: string | null) => void;
  setGroceryImportConfirmedListId: (id: string | null) => void;
  setGroceryImportDelete: (on: boolean) => void;
  setRemindersImportReview: (on: boolean) => void;
  setProjectNudgeDismissedAt: (at: string | null) => void;
  setDefaultProjectNudgeCadenceDays: (days: number) => void;
  setPatchNoteQaStatus: (id: string, status: PatchNoteQaStatus | null) => void;
  resetToDefaults: () => void;
}

const DEFAULT_SETTINGS = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
  themeMode: 'dark' as ThemeMode,
  appFont: DEFAULT_APP_FONT,
  use24HourTime: false,
  weekStartsOn: 0 as WeekStart,
  fabHand: 'right' as FabHand,
  hapticsEnabled: true,
  shakeToUndoEnabled: true,
  dailyAgendaEnabled: false,
  dailyAgendaTime: '08:00',
  autoRemoveExpiredTasks: false,
  autoArchiveProjectsOnComplete: false,
  hideCategories: false,
  remindersImportEnabled: false,
  remindersImportDelete: true,
  groceryImportEnabled: false,
  groceryImportDelete: true,
  remindersImportReview: true,
  defaultProjectNudgeCadenceDays: 0,
};

// Every value in DEFAULT_SETTINGS goes back to the settings table through
// String(), so only scalars belong in it — an array would land as "" (or
// "1,2") and read back as garbage. The persisted sort & filter are kept out
// for that reason and because they aren't preferences anyone sets in Settings.
//
// Nothing nullable can go in either, for the same mechanical reason: null lands
// as the literal string "null", which reads back as a truthy value. But the two
// that hit this want opposite things from a reset, so they're handled
// separately rather than together:
//
// - completedRetentionDays stays out of resetToDefaults altogether. "Reset
//   settings" must not quietly re-arm — or disarm — a setting that deletes
//   history; like vacation mode, it only changes when the user changes it.
// - the app lock stays out for the same reason, though it would round-trip
//   fine: "reset appearance and formatting" is not a request to take the lock
//   off the app, and a security control that a nearby menu item silently
//   disables isn't one. Like vacation mode, it changes when the user changes it.
// - the two Reminders list ids are cleared by hand *inside* resetToDefaults,
//   because there the danger runs the other way: turning the import off while
//   leaving the confirmed-list id in place would let a later re-enable skip the
//   confirmation that is the whole safeguard.

const SORT_OPTIONS: SortOption[] = ['default', 'priority', 'effort-asc', 'effort-desc', 'due-date', 'streak'];

/** The Settings row's preset pills for defaultReminderLeadMinutes. */
export const DEFAULT_REMINDER_LEAD_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Off' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
];

/**
 * Parses the stored settings value. Anything unrecognised reads as off, the
 * same failure mode as parseRetentionDays: a garbled value must not start
 * silently attaching reminders to tasks that never asked for one.
 */
function parseDefaultReminderLeadMinutes(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Reads back a JSON number array written by one of the filter setters,
 * dropping anything outside `max`. These come out of a TEXT column that a
 * previous build (or a hand-edited database) could have left in any shape, and
 * a bad value here silently filters every task out of Today — so an unparseable
 * or out-of-range entry is discarded rather than trusted.
 */
function parseFilterArray<T extends number>(raw: string | null, max: number): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is T => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max
    );
  } catch {
    return [];
  }
}

export const useSettingsStore = create<SettingsStore>(set => ({
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
  quietHoursStart: null,
  quietHoursEnd: null,
  themeMode: 'dark',
  appFont: DEFAULT_APP_FONT,
  use24HourTime: false,
  weekStartsOn: 0,
  fabHand: 'right',
  hapticsEnabled: true,
  shakeToUndoEnabled: true,
  sortOption: 'default',
  filterPriorities: [],
  filterEfforts: [],
  dailyAgendaEnabled: false,
  dailyAgendaTime: '08:00',
  anthropicApiKey: '',
  aiFeatureConfig: defaultAiFeatureConfig(),
  appLockEnabled: false,
  appLockGraceSeconds: DEFAULT_APP_LOCK_GRACE_SECONDS,
  vacationMode: false,
  vacationStart: null,
  vacationEnd: null,
  autoRemoveExpiredTasks: false,
  autoArchiveProjectsOnComplete: false,
  completedRetentionDays: null,
  defaultReminderLeadMinutes: null,
  hideCategories: false,
  remindersImportEnabled: false,
  remindersImportListId: null,
  remindersImportConfirmedListId: null,
  remindersImportDelete: true,
  groceryImportEnabled: false,
  groceryImportListId: null,
  groceryImportConfirmedListId: null,
  groceryImportDelete: true,
  remindersImportReview: true,
  projectNudgeDismissedAt: null,
  patchNotesQaStatus: {},
  defaultProjectNudgeCadenceDays: 0,
  initialized: false,

  initialize() {
    const resetTime = dbGetSetting('dayResetTime') ?? '00:00';
    const morningStart = dbGetSetting('morningStart') ?? '06:00';
    const afternoonStart = dbGetSetting('afternoonStart') ?? '12:00';
    const eveningStart = dbGetSetting('eveningStart') ?? '18:00';
    const nightStart = dbGetSetting('nightStart') ?? '21:00';
    const activeHoursStart = dbGetSetting('activeHoursStart') ?? '08:00';
    const activeHoursEnd = dbGetSetting('activeHoursEnd') ?? '22:00';
    const quietHoursStart = dbGetSetting('quietHoursStart') || null;
    const quietHoursEnd = dbGetSetting('quietHoursEnd') || null;
    const themeMode = (dbGetSetting('themeMode') as ThemeMode | null) ?? 'dark';
    const storedFont = dbGetSetting('appFont');
    const appFont = isAppFont(storedFont) ? storedFont : DEFAULT_APP_FONT;
    const use24HourTime = dbGetSetting('use24HourTime') === 'true';
    const weekStartsOn: WeekStart = dbGetSetting('weekStartsOn') === '1' ? 1 : 0;
    const fabHand: FabHand = dbGetSetting('fabHand') === 'left' ? 'left' : 'right';
    // Defaults on rather than off, so an install that predates the setting
    // keeps the haptics it already had.
    const hapticsEnabled = dbGetSetting('hapticsEnabled') !== 'false';
    // Same reasoning as hapticsEnabled above: defaults on so an install that
    // predates the setting keeps shake-to-undo working.
    const shakeToUndoEnabled = dbGetSetting('shakeToUndoEnabled') !== 'false';
    const storedSort = dbGetSetting('sortOption') as SortOption | null;
    const sortOption: SortOption =
      storedSort && SORT_OPTIONS.includes(storedSort) ? storedSort : 'default';
    const filterPriorities = parseFilterArray<Priority>(dbGetSetting('filterPriorities'), 4);
    const filterEfforts = parseFilterArray<Effort>(dbGetSetting('filterEfforts'), 6);
    const dailyAgendaEnabled = dbGetSetting('dailyAgendaEnabled') === 'true';
    const dailyAgendaTime = dbGetSetting('dailyAgendaTime') ?? '08:00';
    const appLockEnabled = dbGetSetting('appLockEnabled') === 'true';
    const appLockGraceSeconds = parseGraceSeconds(dbGetSetting('appLockGraceSeconds'));
    const vacationMode = dbGetSetting('vacationMode') === 'true';
    const vacationStart = dbGetSetting('vacationStart') ?? null;
    const vacationEnd = dbGetSetting('vacationEnd') || null;
    const autoRemoveExpiredTasks = dbGetSetting('autoRemoveExpiredTasks') === 'true';
    const autoArchiveProjectsOnComplete = dbGetSetting('autoArchiveProjectsOnComplete') === 'true';
    const completedRetentionDays = parseRetentionDays(dbGetSetting('completedRetentionDays'));
    const defaultReminderLeadMinutes = parseDefaultReminderLeadMinutes(dbGetSetting('defaultReminderLeadMinutes'));
    const hideCategories = dbGetSetting('hideCategories') === 'true';
    const remindersImportEnabled = dbGetSetting('remindersImportEnabled') === 'true';
    // `!== 'false'`, not `=== 'true'`, because this one defaults ON — an
    // install that predates the setting has no row, and the usual comparison
    // would read that absence as "apply without asking", which is the opposite
    // of the safe default. Same pattern as hapticsEnabled above.
    const remindersImportReview = dbGetSetting('remindersImportReview') !== 'false';
    const remindersImportListId = dbGetSetting('remindersImportListId') || null;
    const remindersImportConfirmedListId = dbGetSetting('remindersImportConfirmedListId') || null;
    // `!== 'false'` again, and here it's the more important of the two: an
    // install that predates the setting has already been deleting reminders,
    // and reading the missing row as "off" would silently switch it to leaving
    // them behind — duplicating every capture the name index didn't catch.
    const remindersImportDelete = dbGetSetting('remindersImportDelete') !== 'false';
    const groceryImportEnabled = dbGetSetting('groceryImportEnabled') === 'true';
    const groceryImportListId = dbGetSetting('groceryImportListId') || null;
    const groceryImportConfirmedListId = dbGetSetting('groceryImportConfirmedListId') || null;
    const groceryImportDelete = dbGetSetting('groceryImportDelete') !== 'false';
    const projectNudgeDismissedAt = dbGetSetting('projectNudgeDismissedAt') || null;
    // Same TEXT-column parse as every other numeric setting here: an
    // unparseable or missing row (a fresh install, or one that predates this
    // setting) reads back as 0 — never nudge — matching DEFAULT_NUDGE_CADENCE_DAYS.
    const storedDefaultCadence = Number(dbGetSetting('defaultProjectNudgeCadenceDays'));
    const defaultProjectNudgeCadenceDays =
      Number.isFinite(storedDefaultCadence) && storedDefaultCadence > 0 ? storedDefaultCadence : 0;
    const storedQaStatus = dbGetSetting('patchNotesQaStatus');
    let patchNotesQaStatus: Record<string, PatchNoteQaStatus> = {};
    if (storedQaStatus) {
      try {
        patchNotesQaStatus = JSON.parse(storedQaStatus);
      } catch {
        patchNotesQaStatus = {};
      }
    }
    // Merged feature-by-feature against the defaults, rather than trusted
    // wholesale, so a feature added after this setting was first saved shows up
    // enabled with the default model instead of silently missing from the map.
    const aiFeatureConfig = defaultAiFeatureConfig();
    const storedAiFeatureConfig = dbGetSetting('aiFeatureConfig');
    if (storedAiFeatureConfig) {
      try {
        const parsed = JSON.parse(storedAiFeatureConfig) as Partial<
          Record<AiFeatureId, Partial<AiFeatureConfig>>
        >;
        for (const id of AI_FEATURE_IDS) {
          const stored = parsed[id];
          if (!stored) continue;
          aiFeatureConfig[id] = {
            enabled: typeof stored.enabled === 'boolean' ? stored.enabled : aiFeatureConfig[id].enabled,
            model: isAiModelId(stored.model) ? stored.model : aiFeatureConfig[id].model,
          };
        }
      } catch {
        // keep defaults
      }
    }
    set({ dayResetTime: resetTime, morningStart, afternoonStart, eveningStart, nightStart, activeHoursStart, activeHoursEnd, quietHoursStart, quietHoursEnd, themeMode, appFont, dailyAgendaEnabled, dailyAgendaTime, use24HourTime, weekStartsOn, fabHand, hapticsEnabled, shakeToUndoEnabled, sortOption, filterPriorities, filterEfforts, appLockEnabled, appLockGraceSeconds, vacationMode, vacationStart, vacationEnd, autoRemoveExpiredTasks, autoArchiveProjectsOnComplete, completedRetentionDays, defaultReminderLeadMinutes, hideCategories, remindersImportEnabled, remindersImportListId, remindersImportConfirmedListId, remindersImportDelete, remindersImportReview, groceryImportEnabled, groceryImportListId, groceryImportConfirmedListId, groceryImportDelete, projectNudgeDismissedAt, patchNotesQaStatus, aiFeatureConfig, defaultProjectNudgeCadenceDays, initialized: true });
  },

  /**
   * The keychain half of initialize(). Separate because SecureStore is async
   * and initialize() is called from an effect that also has to leave the DB
   * ready for everything downstream of it — awaiting a keychain round trip in
   * the middle of that would delay it for a value nothing needs at launch.
   *
   * A key the user typed while this was in flight wins: the write has already
   * gone to the keychain, and clobbering it with the value we set out to read
   * would silently undo it.
   */
  async initializeSecrets() {
    const anthropicApiKey = await loadAnthropicApiKey();
    set(state => (state.anthropicApiKey ? {} : { anthropicApiKey }));
  },

  setDayResetTime(time: string) {
    dbSetSetting('dayResetTime', time);
    dbSetSetting('morningStart', time);
    set({ dayResetTime: time, morningStart: time });
  },

  setMorningStart(time: string) {
    dbSetSetting('morningStart', time);
    set({ morningStart: time });
  },

  setAfternoonStart(time: string) {
    dbSetSetting('afternoonStart', time);
    set({ afternoonStart: time });
  },

  setEveningStart(time: string) {
    dbSetSetting('eveningStart', time);
    set({ eveningStart: time });
  },

  setNightStart(time: string) {
    dbSetSetting('nightStart', time);
    set({ nightStart: time });
  },

  setActiveHoursStart(time: string) {
    dbSetSetting('activeHoursStart', time);
    set({ activeHoursStart: time });
  },

  setActiveHoursEnd(time: string) {
    dbSetSetting('activeHoursEnd', time);
    set({ activeHoursEnd: time });
  },

  setQuietHours(start: string | null, end: string | null) {
    dbSetSetting('quietHoursStart', start ?? '');
    dbSetSetting('quietHoursEnd', end ?? '');
    set({ quietHoursStart: start, quietHoursEnd: end });
  },

  setThemeMode(mode: ThemeMode) {
    dbSetSetting('themeMode', mode);
    set({ themeMode: mode });
  },

  setAppFont(fontId: AppFont) {
    dbSetSetting('appFont', fontId);
    set({ appFont: fontId });
  },

  setDailyAgendaEnabled(on: boolean) {
    dbSetSetting('dailyAgendaEnabled', on ? 'true' : 'false');
    set({ dailyAgendaEnabled: on });
  },

  setDailyAgendaTime(time: string) {
    dbSetSetting('dailyAgendaTime', time);
    set({ dailyAgendaTime: time });
  },

  setUse24HourTime(on: boolean) {
    dbSetSetting('use24HourTime', on ? 'true' : 'false');
    set({ use24HourTime: on });
  },

  setWeekStartsOn(day: WeekStart) {
    dbSetSetting('weekStartsOn', String(day));
    set({ weekStartsOn: day });
  },

  setFabHand(hand: FabHand) {
    dbSetSetting('fabHand', hand);
    set({ fabHand: hand });
  },

  setHapticsEnabled(on: boolean) {
    dbSetSetting('hapticsEnabled', on ? 'true' : 'false');
    set({ hapticsEnabled: on });
  },

  setShakeToUndoEnabled(on: boolean) {
    dbSetSetting('shakeToUndoEnabled', on ? 'true' : 'false');
    set({ shakeToUndoEnabled: on });
  },

  setSortOption(sort: SortOption) {
    dbSetSetting('sortOption', sort);
    set({ sortOption: sort });
  },

  setFilterPriorities(priorities: Priority[]) {
    dbSetSetting('filterPriorities', JSON.stringify(priorities));
    set({ filterPriorities: priorities });
  },

  setFilterEfforts(efforts: Effort[]) {
    dbSetSetting('filterEfforts', JSON.stringify(efforts));
    set({ filterEfforts: efforts });
  },

  // State first, keychain second and unawaited: every reader of the key is
  // synchronous (aiSuggestions pulls it straight off getState()), and the
  // Settings field that calls this fires on blur, where an await would leave
  // the app briefly disagreeing with what's on screen. A write that fails
  // leaves the key working for this launch and gone at the next one, which is
  // the honest outcome when the keychain won't take it — see secureApiKey.ts
  // on why there is no plaintext fallback.
  setAnthropicApiKey(key: string) {
    set({ anthropicApiKey: key });
    saveAnthropicApiKey(key);
  },

  setAiFeatureConfig(id: AiFeatureId, patch: Partial<AiFeatureConfig>) {
    set(state => {
      const next = { ...state.aiFeatureConfig, [id]: { ...state.aiFeatureConfig[id], ...patch } };
      dbSetSetting('aiFeatureConfig', JSON.stringify(next));
      return { aiFeatureConfig: next };
    });
  },

  setAppLockEnabled(on: boolean) {
    dbSetSetting('appLockEnabled', on ? 'true' : 'false');
    set({ appLockEnabled: on });
  },

  setAppLockGraceSeconds(seconds: number) {
    dbSetSetting('appLockGraceSeconds', String(seconds));
    set({ appLockGraceSeconds: seconds });
  },

  setVacationMode(on: boolean, endDate?: string | null) {
    if (on) {
      const start = new Date().toISOString();
      const end = endDate ?? null;
      dbSetSetting('vacationMode', 'true');
      dbSetSetting('vacationStart', start);
      dbSetSetting('vacationEnd', end ?? '');
      set({ vacationMode: true, vacationStart: start, vacationEnd: end });
    } else {
      dbSetSetting('vacationMode', 'false');
      dbSetSetting('vacationEnd', '');
      set({ vacationMode: false, vacationStart: null, vacationEnd: null });
    }
  },

  setVacationEnd(endDate: string | null) {
    dbSetSetting('vacationEnd', endDate ?? '');
    set({ vacationEnd: endDate });
  },

  setProjectNudgeDismissedAt(at: string | null) {
    dbSetSetting('projectNudgeDismissedAt', at ?? '');
    set({ projectNudgeDismissedAt: at });
  },

  setAutoRemoveExpiredTasks(on: boolean) {
    dbSetSetting('autoRemoveExpiredTasks', on ? 'true' : 'false');
    set({ autoRemoveExpiredTasks: on });
  },

  setAutoArchiveProjectsOnComplete(on: boolean) {
    dbSetSetting('autoArchiveProjectsOnComplete', on ? 'true' : 'false');
    set({ autoArchiveProjectsOnComplete: on });
  },

  // Stored as '' for forever, matching vacationEnd/projectNudgeDismissedAt —
  // the settings table is all TEXT, and parseRetentionDays reads anything it
  // doesn't recognise back as forever.
  setCompletedRetentionDays(days: RetentionDays) {
    dbSetSetting('completedRetentionDays', days === null ? '' : String(days));
    set({ completedRetentionDays: days });
  },

  // Stored as '' for off, matching completedRetentionDays — an unrecognised
  // value reads back as off, never as some inherited lead time.
  setDefaultReminderLeadMinutes(minutes: number | null) {
    dbSetSetting('defaultReminderLeadMinutes', minutes === null ? '' : String(minutes));
    set({ defaultReminderLeadMinutes: minutes });
  },

  setHideCategories(on: boolean) {
    dbSetSetting('hideCategories', on ? 'true' : 'false');
    set({ hideCategories: on });
  },

  setRemindersImportEnabled(on: boolean) {
    dbSetSetting('remindersImportEnabled', on ? 'true' : 'false');
    set({ remindersImportEnabled: on });
  },

  setRemindersImportListId(id: string | null) {
    dbSetSetting('remindersImportListId', id ?? '');
    set({ remindersImportListId: id });
  },

  setRemindersImportConfirmedListId(id: string | null) {
    dbSetSetting('remindersImportConfirmedListId', id ?? '');
    set({ remindersImportConfirmedListId: id });
  },

  setRemindersImportDelete(on: boolean) {
    dbSetSetting('remindersImportDelete', on ? 'true' : 'false');
    set({ remindersImportDelete: on });
  },

  setGroceryImportEnabled(on: boolean) {
    dbSetSetting('groceryImportEnabled', on ? 'true' : 'false');
    set({ groceryImportEnabled: on });
  },

  setGroceryImportListId(id: string | null) {
    dbSetSetting('groceryImportListId', id ?? '');
    set({ groceryImportListId: id });
  },

  setGroceryImportConfirmedListId(id: string | null) {
    dbSetSetting('groceryImportConfirmedListId', id ?? '');
    set({ groceryImportConfirmedListId: id });
  },

  setGroceryImportDelete(on: boolean) {
    dbSetSetting('groceryImportDelete', on ? 'true' : 'false');
    set({ groceryImportDelete: on });
  },

  setRemindersImportReview(on: boolean) {
    dbSetSetting('remindersImportReview', on ? 'true' : 'false');
    set({ remindersImportReview: on });
  },

  setPatchNoteQaStatus(id: string, status: PatchNoteQaStatus | null) {
    set(state => {
      const next = { ...state.patchNotesQaStatus };
      if (status) {
        next[id] = status;
      } else {
        delete next[id];
      }
      dbSetSetting('patchNotesQaStatus', JSON.stringify(next));
      return { patchNotesQaStatus: next };
    });
  },

  setDefaultProjectNudgeCadenceDays(days: number) {
    dbSetSetting('defaultProjectNudgeCadenceDays', String(days));
    set({ defaultProjectNudgeCadenceDays: days });
  },

  resetToDefaults() {
    Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
      dbSetSetting(key, String(value));
    });
    // Not in DEFAULT_SETTINGS because String(null) doesn't round-trip — see the
    // note above it. Clearing both matters: a reset that turned the import off
    // but left the confirmed-list id in place would let re-enabling later skip
    // the confirmation and swallow whatever had piled up meanwhile.
    dbSetSetting('remindersImportListId', '');
    dbSetSetting('remindersImportConfirmedListId', '');
    dbSetSetting('groceryImportListId', '');
    dbSetSetting('groceryImportConfirmedListId', '');
    set({
      ...DEFAULT_SETTINGS,
      remindersImportListId: null,
      remindersImportConfirmedListId: null,
      groceryImportListId: null,
      groceryImportConfirmedListId: null,
    });
  },
}));
