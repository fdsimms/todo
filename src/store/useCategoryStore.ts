import { create } from 'zustand';
import type { Category, TimeOfDay } from '../types';
import {
  dbGetAllCategories,
  dbInsertCategory,
  dbInsertCategoryRow,
  dbUpdateCategory,
  dbDeleteCategory,
  dbRenameCategory,
  dbSetCategoryHideOnVacation,
  dbSetCategoryExcludeFromSuggestions,
  dbSetCategoryExcludeFromNewTasksBanner,
  dbSetCategoryBackfillDismissedFields,
  dbSetCategoryEmoji,
  dbSetCategoryDefaultTimeSegments,
  dbBatchUpdateCategorySortOrders,
  dbGetSetting,
} from '../db/database';
import { firstEmoji } from '../utils/emojiInput';
import { useSettingsStore } from './useSettingsStore';
import { GENERATED_KIND_LIST, GENERATED_KIND_SPECS, type GeneratedKind } from '../utils/generatedTasks';

interface CategoryStore {
  categories: Category[];
  initialized: boolean;
  initialize: () => void;
  addCategory: (name: string) => Category;
  deleteCategory: (name: string) => void;
  // Undo lives in useTaskStore since deleting a category also touches tasks
  // and stacks; this is the low-level row restore it calls once it's undone
  // those side effects.
  restoreCategory: (category: Category) => void;
  renameCategory: (name: string, newName: string) => boolean;
  setCategorySchedule: (name: string, scheduleDays: number[], scheduleStart: string, scheduleEnd: string) => void;
  removeCategorySchedule: (name: string) => void;
  setCategoryHideOnVacation: (name: string, hide: boolean) => void;
  setCategoryExcludeFromSuggestions: (name: string, exclude: boolean) => void;
  setCategoryExcludeFromNewTasksBanner: (name: string, exclude: boolean) => void;
  // Persists the deduped array the Backfill screen (categoryBackfill.ts's
  // dismissCategoryBackfillField) computes — same split as
  // dismissBackfillField/updateTask on the task side.
  setCategoryBackfillDismissedFields: (name: string, fields: string[]) => void;
  setCategoryEmoji: (name: string, emoji: string | null) => void;
  // Only what *new* tasks in this category start with. Retroactively moving
  // the tasks that already exist is a separate, explicit act — see
  // useTaskStore.setCategoryTimeSegments.
  setCategoryDefaultTimeSegments: (name: string, segments: TimeOfDay[]) => void;
  getCategoryByName: (name: string) => Category | null;
  reorderCategories: (orderedNames: string[]) => void;
}

export const useCategoryStore = create<CategoryStore>((set, get) => ({
  categories: [],
  initialized: false,

  initialize() {
    const categories = dbGetAllCategories();
    set({ categories, initialized: true });
  },

  addCategory(name) {
    const existing = get().categories.find(c => c.name === name);
    if (existing) return existing;
    const category = dbInsertCategory(name);
    set(s => ({ categories: [...s.categories, category] }));
    return category;
  },

  deleteCategory(name) {
    dbDeleteCategory(name);
    set(s => ({ categories: s.categories.filter(c => c.name !== name) }));
  },

  restoreCategory(category) {
    dbInsertCategoryRow(category);
    set(s => ({ categories: [...s.categories, category] }));
  },

  renameCategory(name, newName) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) return false;
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return false;
    if (get().categories.some(c => c.name === trimmed)) return false;
    dbRenameCategory(cat.id, name, trimmed);
    set(s => ({
      categories: s.categories.map(c => (c.id === cat.id ? { ...c, name: trimmed } : c)),
    }));
    return true;
  },

  setCategorySchedule(name, scheduleDays, scheduleStart, scheduleEnd) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbUpdateCategory(cat.id, { scheduleDays, scheduleStart, scheduleEnd });
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, scheduleDays, scheduleStart, scheduleEnd } : c
      ),
    }));
  },

  removeCategorySchedule(name) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbUpdateCategory(cat.id, { scheduleDays: null, scheduleStart: null, scheduleEnd: null });
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, scheduleDays: null, scheduleStart: null, scheduleEnd: null } : c
      ),
    }));
  },

  setCategoryHideOnVacation(name, hide) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbSetCategoryHideOnVacation(cat.id, hide);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, hideOnVacation: hide } : c
      ),
    }));
  },

  setCategoryExcludeFromSuggestions(name, exclude) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbSetCategoryExcludeFromSuggestions(cat.id, exclude);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, excludeFromSuggestions: exclude } : c
      ),
    }));
  },

  setCategoryExcludeFromNewTasksBanner(name, exclude) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbSetCategoryExcludeFromNewTasksBanner(cat.id, exclude);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, excludeFromNewTasksBanner: exclude } : c
      ),
    }));
  },

  setCategoryBackfillDismissedFields(name, fields) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbSetCategoryBackfillDismissedFields(cat.id, fields);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, backfillDismissedFields: fields } : c
      ),
    }));
  },

  setCategoryEmoji(name, emoji) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    // One emoji, always — every write lands here, so clamping at this one point
    // is what keeps a two-emoji category from existing at all. See emojiInput.ts
    // for why "one emoji" can't be expressed as a string length.
    const single = firstEmoji(emoji) || null;
    dbSetCategoryEmoji(cat.id, single);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, emoji: single } : c
      ),
    }));
  },

  setCategoryDefaultTimeSegments(name, segments) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbSetCategoryDefaultTimeSegments(cat.id, segments);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, defaultTimeSegments: segments } : c
      ),
    }));
  },

  getCategoryByName(name) {
    return get().categories.find(c => c.name === name) ?? null;
  },

  reorderCategories(orderedNames) {
    // Names not yet backed by a category row (e.g. a legacy task category
    // that predates the registry) are registered on the fly so they get a
    // stable id/sortOrder like everything else.
    const ensured = orderedNames.map(name => get().getCategoryByName(name) ?? get().addCategory(name));
    const updates = ensured.map((c, index) => ({ id: c.id, sortOrder: index + 1 }));
    dbBatchUpdateCategorySortOrders(updates);
    set(s => ({
      categories: s.categories.map(c => {
        const u = updates.find(x => x.id === c.id);
        return u ? { ...c, sortOrder: u.sortOrder } : c;
      }),
    }));
  },
}));

/** What the events category is called until the user renames it. */
export const CALENDAR_EVENTS_CATEGORY = 'Calendar Events';

/**
 * Give something the app files into a category one to file into (#1571).
 *
 * The shared half of `ensureCalendarEventCategory` and
 * `ensureGeneratedTaskCategory`: create a real category — a row in the same
 * table as every other, renameable, reorderable, deletable — and point the
 * setting at it, rather than teaching the list about a synthetic section only
 * one feature can use. Everything that makes filing worth having (its place in
 * the order, collapsing it, focusing it) is then the category feature working
 * normally.
 *
 * **An empty stored row is a deliberate "nowhere" and is left alone**, which is
 * the whole reason startup can't just fill in any blank it finds: deleting the
 * category clears the setting, and a startup pass that couldn't tell that from
 * "never answered" would put it back every launch, with no way for the user to
 * say no. An *absent* row is the only unanswered state, so that's the one that
 * gets filled in — and it's also what makes this safe on an install that has
 * been running for a year with the generator on: it has never answered either,
 * so it gets the same default a fresh install does, applying to the tasks
 * written from here on and never to the ones already filed.
 */
function ensureCategoryFor(
  settingKey: string,
  name: string,
  current: string | null,
  assign: (category: string) => void,
  force: boolean,
): void {
  if (current) return;
  if (!force && dbGetSetting(settingKey) !== null) return;
  useCategoryStore.getState().addCategory(name);
  assign(name);
}

/**
 * Make sure the day's events have a section to land in.
 *
 * Called from two places for two reasons: turning the read on (`force`, so the
 * section appears with the events rather than a launch later), and app startup,
 * which is how an install that already had the read on gets one without a
 * migration step of its own.
 */
export function ensureCalendarEventCategory(opts: { force?: boolean } = {}): void {
  const settings = useSettingsStore.getState();
  if (!settings.calendarReadEnabled) return;
  ensureCategoryFor(
    'calendarEventCategory',
    CALENDAR_EVENTS_CATEGORY,
    settings.calendarEventCategory,
    settings.setCalendarEventCategory,
    !!opts.force,
  );
}

/**
 * Each generator's category setting, as a pair this module can read and
 * write — null for a kind with no category setting of its own (see
 * `GeneratedKindSpec.categorized`).
 */
function generatedCategorySetting(kind: GeneratedKind): {
  key: string;
  current: string | null;
  assign: (category: string) => void;
} | null {
  const s = useSettingsStore.getState();
  switch (kind) {
    // Shared arm: mealSlot is the fold of mealCook and kept its settings keys.
    case 'mealSlot':
    case 'mealCook':
      return { key: 'mealCookTaskCategory', current: s.mealCookTaskCategory, assign: s.setMealCookTaskCategory };
    case 'groceryUseUp':
      return { key: 'groceryUseUpTaskCategory', current: s.groceryUseUpTaskCategory, assign: s.setGroceryUseUpTaskCategory };
    case 'leftoverUseUp':
      return { key: 'leftoverUseUpTaskCategory', current: s.leftoverUseUpTaskCategory, assign: s.setLeftoverUseUpTaskCategory };
    case 'mealPlanNudge':
      return { key: 'mealPlanNudgeTaskCategory', current: s.mealPlanNudgeTaskCategory, assign: s.setMealPlanNudgeTaskCategory };
    case 'projectReview':
      return { key: 'projectReviewTaskCategory', current: s.projectReviewTaskCategory, assign: s.setProjectReviewTaskCategory };
    case 'pantryCheck':
      return { key: 'pantryCheckTaskCategory', current: s.pantryCheckTaskCategory, assign: s.setPantryCheckTaskCategory };
    case 'mealShortfall':
      return { key: 'mealShortfallTaskCategory', current: s.mealShortfallTaskCategory, assign: s.setMealShortfallTaskCategory };
    case 'supplyReorder':
      return { key: 'supplyReorderTaskCategory', current: s.supplyReorderTaskCategory, assign: s.setSupplyReorderTaskCategory };
    // Reuses calendarEventCategory instead — see GeneratedKindSpec.categorized.
    // ensureGeneratedTaskCategory returns before this null is ever used.
    case 'calendarReview':
      return null;
    case 'birthday':
      return { key: 'birthdayTaskCategory', current: s.birthdayTaskCategory, assign: s.setBirthdayTaskCategory };
  }
}

/** Whether this generator is currently switched on. */
function generatorEnabled(kind: GeneratedKind): boolean {
  const s = useSettingsStore.getState();
  switch (kind) {
    case 'mealSlot':
    case 'mealCook': return s.mealCookTasks;
    case 'groceryUseUp': return s.groceryUseUpTasks;
    case 'leftoverUseUp': return s.leftoverUseUpTasks;
    case 'mealPlanNudge': return s.mealPlanNudgeEnabled;
    case 'projectReview': return s.projectReviewTasks;
    case 'pantryCheck': return s.pantryCheckTasks;
    case 'mealShortfall': return s.mealShortfallTasks;
    case 'supplyReorder': return s.supplyReorderTasks;
    case 'calendarReview': return s.calendarReviewTasks;
    case 'birthday': return s.birthdayTasks;
  }
}

/**
 * Give a generator's tasks a category to file under.
 *
 * The same move `ensureCalendarEventCategory` makes, for the six kinds that
 * write tasks: a generator left at its shipped default filed *nothing*, and an
 * uncategorized task renders in the loose block above every section — so the
 * tasks the app writes unasked ended up at the very top of Today, which is the
 * position this whole change exists to give back to real work.
 *
 * Two pairs of them name the same category, which is why this reads the
 * registry rather than taking a name: see `GeneratedKindSpec.defaultCategory`.
 */
export function ensureGeneratedTaskCategory(kind: GeneratedKind, opts: { force?: boolean } = {}): void {
  if (!generatorEnabled(kind)) return;
  const setting = generatedCategorySetting(kind);
  if (!setting) return;
  const { key, current, assign } = setting;
  ensureCategoryFor(key, GENERATED_KIND_SPECS[kind].defaultCategory, current, assign, !!opts.force);
}

/** Every generator that's on, at startup. Idempotent, like the calendar's. */
export function ensureGeneratedTaskCategories(): void {
  GENERATED_KIND_LIST.forEach(spec => ensureGeneratedTaskCategory(spec.kind));
}
