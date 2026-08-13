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
  dbSetCategoryExcludeFromPinSuggestions,
  dbSetCategoryEmoji,
  dbSetCategoryDefaultTimeSegments,
  dbBatchUpdateCategorySortOrders,
  dbGetSetting,
} from '../db/database';
import { firstEmoji } from '../utils/emojiInput';
import { useSettingsStore } from './useSettingsStore';

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
  setCategoryExcludeFromPinSuggestions: (name: string, exclude: boolean) => void;
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

  setCategoryExcludeFromPinSuggestions(name, exclude) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbSetCategoryExcludeFromPinSuggestions(cat.id, exclude);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, excludeFromPinSuggestions: exclude } : c
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
 * Make sure the day's events have a section to land in (#1571).
 *
 * Events file under a category like everything else on Today, which leaves one
 * question a fresh install can't answer for itself: *which* one. This creates
 * a real category — a row in the same table as every other, renameable,
 * reorderable, deletable — and points the setting at it, rather than teaching
 * the list about a synthetic section that only events can use. Everything that
 * makes the fold worth having (its place in the order, collapsing it, focusing
 * it) is then the category feature working normally.
 *
 * **Only ever fills in a blank.** A category the user has picked, renamed or
 * pointed elsewhere is never overwritten, and a name that's already taken is
 * adopted rather than duplicated (`addCategory` returns the existing row). If
 * they delete the category, the setting is cleared by the delete and events
 * stop showing until one is picked again — which is a real answer, and the
 * closest thing this feature has to an off switch that isn't the calendar read
 * itself.
 *
 * Called from two places for two reasons: turning the read on (`force`, so the
 * section appears with the events rather than a launch later), and app startup,
 * which is how an install that already had the read on gets one without a
 * migration step of its own.
 *
 * **An empty stored row is a deliberate "nowhere" and is left alone**, which is
 * the whole reason startup can't just fill in any blank it finds: deleting the
 * category clears the setting, and a startup pass that couldn't tell that from
 * "never answered" would put it back every launch — the user would have no way
 * to say no. An *absent* row is the only unanswered state, so that's the one
 * that gets filled in.
 */
export function ensureCalendarEventCategory(opts: { force?: boolean } = {}): void {
  const settings = useSettingsStore.getState();
  if (!settings.calendarReadEnabled) return;
  if (settings.calendarEventCategory) return;
  if (!opts.force && dbGetSetting('calendarEventCategory') !== null) return;
  useCategoryStore.getState().addCategory(CALENDAR_EVENTS_CATEGORY);
  settings.setCalendarEventCategory(CALENDAR_EVENTS_CATEGORY);
}
