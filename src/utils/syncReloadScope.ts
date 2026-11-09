/**
 * Which stores a sync has to reload, from the tables it wrote.
 *
 * A sync from another device used to reload everything: `useTaskStore.initialize`
 * fans out to every data store, and each one re-read its tables and re-ran
 * whatever its `initialize` does besides (re-aiming notifications, dropping the
 * prompt a sheet was showing, pruning) because one row changed somewhere else
 * (#4267). The apply knows which tables it wrote (`ApplyReport.changedTables`),
 * so a store none of whose tables are among them is left exactly as it is.
 *
 * `STORE_RELOAD_READS` is the other half: what each part of the fan-out reads.
 * It is checked rather than trusted. `syncReload.test.ts` runs the real fan-out
 * over a real database, records every table and setting each part reads, and
 * fails on one that isn't listed here, so a store that starts reading a new
 * table can't silently stop following it across a sync.
 */
import type { ApplyReport } from './syncMerge';

/** What one part of the reload reads from the database. */
export interface ReloadReads {
  /** Tables, by name. Never `settings`, which is named by key below. */
  tables: readonly string[];
  /** Keys of the `settings` table, or `'any'` for a part that depends on settings at large. */
  settings?: readonly string[] | 'any';
}

/**
 * Every part of `useTaskStore.initialize`'s fan-out, under the name it is timed
 * by (`timedPart`), with what it reads. A device-local table or key is listed
 * like any other; a sync never names one, so it never causes a reload.
 */
export const STORE_RELOAD_READS = {
  Category: { tables: ['categories'] },
  Template: { tables: ['templates'] },
  TaskGroup: { tables: ['task_groups'] },
  Project: { tables: ['projects'] },
  ProjectCategory: { tables: ['project_categories'] },
  Person: { tables: ['people'] },
  PersonNote: { tables: ['person_notes'] },
  PersonGroup: { tables: ['person_groups'] },
  Mood: { tables: ['mood_logs'] },
  Milestone: { tables: ['milestones'] },
  Cookware: { tables: ['cookware'], settings: ['cookware_recent'] },
  CopyFlag: { tables: ['copy_flags'] },
  Fast: { tables: ['fasts'] },
  Workout: {
    tables: [
      'exercises',
      'workout_routines',
      'workout_programs',
      'workout_routine_versions',
      'workout_program_versions',
      'workout_sessions',
      'workout_sets',
    ],
    settings: ['workoutRoutineGroups'],
  },
  Gym: { tables: ['gyms', 'gym_exercises'] },
  Journal: { tables: ['journal_entries'] },
  Medication: {
    tables: ['medication_logs'],
    settings: [
      'medication_archived',
      'medication_registered',
      'medication_settings',
      'medication_summary_last',
      'medication_milestone_dismissed',
    ],
  },
  CheckIn: { tables: ['check_ins'] },
  Reward: { tables: ['coin_entries', 'rewards'] },
  Unlock: { tables: ['reward_unlocks'] },
  FoodLog: { tables: ['food_logs'] },
  SavedMeals: { tables: ['saved_meals'] },
  PendingEstimate: { tables: ['pending_estimates'] },
  PendingRecipeEstimate: { tables: ['pending_recipe_estimates'] },
  Unattended: { tables: ['unattended_log'] },
  TemplateCategory: { tables: ['template_categories'] },
  Grocery: {
    tables: [
      'grocery_items',
      'grocery_shops',
      'grocery_item_shops',
      'grocery_item_subs',
      'grocery_item_products',
      'grocery_store_aliases',
      'grocery_lists',
      'grocery_list_items',
    ],
    settings: [
      'grocery_aisle_hidden',
      'grocery_aisle_order',
      'grocery_aisle_nonfood',
      'grocery_aisle_overrides',
      'grocery_last_shop_id',
      'grocery_trip_shop_id',
      'grocery_trip_started_at',
      'grocery_trip_budget_minor',
      'grocery_active_list',
      'grocery_group_by',
    ],
  },
  Recipe: { tables: ['recipes', 'cookbooks'] },
  MealPlan: { tables: ['meal_plan_entries', 'week_pool_entries'], settings: ['meal_plan_added_to_list'] },
  MealSkip: { tables: ['meal_skips'] },
  Leftover: { tables: ['leftovers'] },
  EventReminder: { tables: [], settings: ['event_reminders'] },
  HiddenEvents: { tables: [], settings: ['hidden_calendar_events'] },
  EventPeople: {
    tables: ['event_people_links'],
    settings: ['event_people_links_migration_done', 'calendarEventPeople'],
  },
  EventTaskLink: { tables: [], settings: ['calendarEventTasks'] },
  AgentSuggestion: { tables: ['calendar_requests'] },
  // The task list itself, and the tag registry read beside it.
  'read tasks': { tables: ['tasks'], settings: ['tag_registry'] },
  // The focus session is this device's own, but it is pruned against the task
  // list it was planned from.
  Focus: { tables: ['focus_sessions', 'focus_session_log', 'tasks'] },
  // Not database reads of its own: it schedules from the stores above (tasks,
  // the trip's shop, and the daily agenda's meals, recipes and people) and
  // from settings at large.
  'reschedule reminders': {
    tables: ['tasks', 'grocery_shops', 'meal_plan_entries', 'recipes', 'people'],
    settings: 'any',
  },
  // Reads the leftovers and tasks in memory, each leftover's planned meals,
  // and the use-up task settings.
  'reconcile leftover tasks': { tables: ['leftovers', 'tasks', 'meal_plan_entries'], settings: 'any' },
} as const satisfies Record<string, ReloadReads>;

export type ReloadPart = keyof typeof STORE_RELOAD_READS;

/** What a sync changed, as far as a reload needs to know. */
export interface SyncReloadScope {
  tables: ReadonlySet<string>;
  settingKeys: ReadonlySet<string>;
}

export type AppliedChanges = Pick<ApplyReport, 'changedTables' | 'changedSettingKeys' | 'folded'>;

/**
 * The scope of the reload an apply calls for, or null for "everything": a
 * fold repointed rows in tables the report doesn't list (`ApplyReport.folded`),
 * and no narrower answer than all of it is safe.
 */
export function syncReloadScope(applied: AppliedChanges): SyncReloadScope | null {
  if (applied.folded) return null;
  return { tables: new Set(applied.changedTables), settingKeys: new Set(applied.changedSettingKeys) };
}

/** Whether a reload of `scope` has anything to tell a reader of `reads`. A null scope reaches everyone. */
export function scopeReaches(scope: SyncReloadScope | null, reads: ReloadReads): boolean {
  if (!scope) return true;
  if (reads.tables.some(table => scope.tables.has(table))) return true;
  if (!reads.settings || !scope.tables.has('settings')) return false;
  // Settings changed with no key named: not something the apply does, but if
  // it ever did, reading too much is the safe side to be wrong on.
  if (reads.settings === 'any' || scope.settingKeys.size === 0) return true;
  return reads.settings.some(key => scope.settingKeys.has(key));
}

/** `scopeReaches` for a named part of the task store's fan-out. */
export function reloadReaches(scope: SyncReloadScope | null, part: ReloadPart): boolean {
  return scopeReaches(scope, STORE_RELOAD_READS[part]);
}

/** Whether the settings store itself has anything to re-read. */
export function reloadReachesSettings(scope: SyncReloadScope | null): boolean {
  return !scope || scope.tables.has('settings');
}
