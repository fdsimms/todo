/**
 * What Settings contains, as data — the eight groups and one record per
 * searchable row.
 *
 * This is a *search index*, not a description of the UI. It deliberately
 * carries no control type, no current value and no handler: the rows stay
 * hand-written JSX in `src/screens/settings/`, because a config able to
 * express a toggle, a value disclosure, a pill row, an inline time picker, a
 * text field and a destructive action — each with its own conditional
 * visibility and alert flow — would be harder to read than the JSX it
 * replaced. What the index is for is the two jobs the JSX can't do: listing
 * the groups, and finding a row you can't see.
 *
 * Its one obligation is to stay in step with that JSX. An entry whose row was
 * renamed or deleted is a search result that goes nowhere, so
 * `settingsIndex.test.ts` guards the structural half of that.
 *
 * The one block that is *not* hand-written is the AI features section, and the
 * reason is that it is the one block of Settings whose rows aren't hand-written
 * either: `PrivacyAiSettings` maps straight over `aiFeaturesFor(kitchenEnabled)`,
 * so a feature added to `AI_FEATURES` grows a row on its own and only the index
 * had to be remembered separately. It wasn't — `substitutes` and `receiptImport`
 * shipped rows with no entry at all, unfindable by search, and `taskBreakdown`
 * kept an entry naming a label ("Task suggestions") the row had stopped
 * rendering. Deriving the entries from the same list is what makes those three
 * failures unrepresentable; only the keywords, which have no counterpart in
 * `AI_FEATURES`, stay written out below.
 */

import { AI_FEATURES, type AiFeatureId } from './aiFeatures';

export type SettingsGroupId =
  | 'appearance'
  | 'dayTime'
  | 'notifications'
  | 'capture'
  | 'tasksProjects'
  | 'privacyAi'
  | 'dataReset'
  | 'about';

/**
 * Named rather than hex, because this module is pure and the palette is
 * theme-dependent — the screen resolves these against `useColors()`.
 */
export type SettingsTint = 'accent' | 'orange' | 'red' | 'green' | 'purple' | 'neutral';

export interface SettingsGroup {
  id: SettingsGroupId;
  title: string;
  /** Ionicons glyph name. */
  icon: string;
  tint: SettingsTint;
  /** Dropped entirely off-platform, along with all of its entries. */
  iosOnly?: boolean;
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: 'appearance', title: 'Appearance', icon: 'color-palette-outline', tint: 'accent' },
  { id: 'dayTime', title: 'Day & time', icon: 'sunny-outline', tint: 'orange' },
  { id: 'notifications', title: 'Notifications', icon: 'notifications-outline', tint: 'red' },
  // Both EventKit integrations live here rather than in two groups: they share
  // a framework, a platform gate and the same caveat (no change notification,
  // so both refresh on foreground), and there is no sixth tint to give a group
  // of its own without repeating one next to it.
  { id: 'capture', title: 'Reminders & Calendar', icon: 'download-outline', tint: 'green', iosOnly: true },
  { id: 'tasksProjects', title: 'Tasks & projects', icon: 'checkbox-outline', tint: 'purple' },
  // Neutral from here down: the five tinted groups are things you configure,
  // the grey ones are housekeeping. A second orange next to Day & time's read
  // as an accident rather than as a category.
  { id: 'privacyAi', title: 'Privacy & AI', icon: 'lock-closed-outline', tint: 'neutral' },
  { id: 'dataReset', title: 'Data & reset', icon: 'archive-outline', tint: 'neutral' },
  { id: 'about', title: 'About', icon: 'information-circle-outline', tint: 'neutral' },
];

export interface SettingsEntry {
  id: string;
  groupId: SettingsGroupId;
  /**
   * The row's label as rendered. Where a label is computed at runtime (the app
   * lock names whatever the device authenticates with) this is the common case
   * and the alternatives live in `keywords`.
   */
  label: string;
  /** The section header the row sits under inside its group. */
  section: string;
  /** Words that should find the row but don't appear in its label. */
  keywords?: string[];
  /**
   * Configures the groceries/recipes/meal plan area, so it disappears with it
   * when `kitchenEnabled` is off — the same treatment `iosOnly` gives a group,
   * one row at a time. These rows are scattered across four groups rather than
   * gathered into one, so the flag has to live per-entry.
   *
   * The master switch itself is deliberately *not* flagged: it's the way back.
   */
  kitchen?: boolean;
  /**
   * Configures something simplified mode takes away, so it goes with it — the
   * same one-row-at-a-time treatment `kitchen` gives the grocery area.
   *
   * The master switch itself is deliberately *not* flagged, for the reason
   * `kitchenEnabled` isn't: a setting that hid itself when switched on would
   * have no way back.
   */
  simple?: boolean;
}

/**
 * The words that should find an AI-feature row but don't appear in its label.
 *
 * The one thing the derivation below can't take from `AI_FEATURES`, since a
 * feature's `hint` is written for someone reading the row rather than for
 * someone searching for it. Keyed by `AiFeatureId` so a new feature is a type
 * error here until it has been given some.
 *
 * `suggestions` is kept on `taskBreakdown` because that is what the row used to
 * be called, and someone who set it up under the old name will search for the
 * old name.
 */
const AI_FEATURE_KEYWORDS: Record<AiFeatureId, string[]> = {
  taskBreakdown: ['claude', 'model', 'subtasks', 'steps', 'split', 'suggestions', 'postpone'],
  templateSuggestions: ['claude', 'model', 'checklist'],
  groceryAisles: ['claude', 'model', 'shopping'],
  recipeExtraction: ['claude', 'model', 'ingredients', 'paste', 'photo', 'link'],
  mealIdeas: ['claude', 'model', 'dinner', 'suggest', 'meal plan'],
  substitutes: ['claude', 'model', 'instead of', 'swap', 'replace', 'allergy', 'out of'],
  receiptImport: ['claude', 'model', 'photo', 'till', 'shopping trip', 'prices'],
};

/** One entry per row `PrivacyAiSettings` actually renders, in the same order. */
const AI_FEATURE_ENTRIES: SettingsEntry[] = AI_FEATURES.map(feature => ({
  id: `ai:${feature.id}`,
  groupId: 'privacyAi' as const,
  label: feature.label,
  section: 'AI features',
  keywords: AI_FEATURE_KEYWORDS[feature.id],
  // Carried across rather than restated: the row itself disappears with the
  // area (`aiFeaturesFor`), so an entry that outlived it would be a result
  // pointing at nothing. Same for the two that go with simplified mode.
  ...(feature.kitchen ? { kitchen: true } : {}),
  ...(feature.simple ? { simple: true } : {}),
}));

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  // Appearance
  { id: 'theme', groupId: 'appearance', label: 'Theme', section: 'Theme',
    keywords: ['dark', 'light', 'purple', 'system', 'colour', 'color'] },
  { id: 'fabHand', groupId: 'appearance', label: 'Add button', section: 'Theme',
    keywords: ['corner', 'left', 'right', 'handed', 'plus', 'fab'] },
  { id: 'typeface', groupId: 'appearance', label: 'Typeface', section: 'Typeface',
    keywords: ['font', 'bricolage', 'fraunces', 'space grotesk', 'nunito', 'outfit', 'serif', 'mono'] },
  { id: 'appFontRandomize', groupId: 'appearance', label: 'Randomize', section: 'Typeface',
    keywords: ['font', 'shuffle', 'mix', 'rotate', 'cold start', 'launch'] },
  { id: 'haptics', groupId: 'appearance', label: 'Haptic feedback', section: 'Feedback',
    keywords: ['vibrate', 'vibration', 'taptic', 'buzz'] },
  { id: 'confirmBeforeDeleting', groupId: 'appearance', label: 'Confirm before deleting', section: 'Feedback',
    keywords: ['delete', 'alert', 'confirmation', 'undo', 'forget', 'clear'] },
  { id: 'hideHelpText', groupId: 'appearance', label: 'Help text', section: 'Feedback',
    keywords: ['hint', 'description', 'explanation', 'subtitle', 'terse', 'declutter'] },
  { id: 'tipsEnabled', groupId: 'appearance', label: 'Tips', section: 'Feedback',
    keywords: ['tutorial', 'onboarding', 'learn', 'discover', 'banner', 'suggestion', 'help'] },

  // Day & time
  { id: 'dayReset', groupId: 'dayTime', label: 'Morning', section: 'When the day turns over',
    keywords: ['day start', 'day reset', 'today', 'streaks', 'midnight'] },
  { id: 'afternoon', groupId: 'dayTime', label: 'Afternoon starts', section: 'When the day turns over' },
  { id: 'evening', groupId: 'dayTime', label: 'Evening starts', section: 'When the day turns over' },
  { id: 'night', groupId: 'dayTime', label: 'Night starts', section: 'When the day turns over' },
  { id: 'activeStart', groupId: 'dayTime', label: 'Awake from', section: 'Awake hours',
    keywords: ['daily target', 'pace', 'active hours'] },
  { id: 'activeEnd', groupId: 'dayTime', label: 'Awake until', section: 'Awake hours',
    keywords: ['active hours'] },
  { id: 'use24HourTime', groupId: 'dayTime', label: '24-hour time', section: 'How times read',
    keywords: ['clock', 'am', 'pm', 'format'] },
  { id: 'weekStartsOn', groupId: 'dayTime', label: 'Week starts on', section: 'How times read',
    keywords: ['sunday', 'monday', 'calendar', 'stats'] },

  // Notifications
  { id: 'notifPermission', groupId: 'notifications', label: 'Reminders', section: 'Notifications',
    keywords: ['permission', 'allow', 'notification', 'alerts'] },
  { id: 'dailyAgenda', groupId: 'notifications', label: 'Daily agenda', section: 'Notifications',
    keywords: ['morning summary', 'digest', 'notification'] },
  { id: 'dailyAgendaTime', groupId: 'notifications', label: 'Send it at', section: 'Notifications',
    keywords: ['agenda time'] },
  // The meal-plan nudge used to sit here, on the grounds that it fires on a
  // schedule. It writes a *task*, though, not a notification, which is the
  // thing it has in common with the other three generators — so it moved to
  // "Tasks the app adds" in Tasks & projects (#1524).

  // Capture from Reminders (iOS)
  { id: 'remindersImport', groupId: 'capture', label: 'Import from Reminders', section: 'Apple Reminders',
    keywords: ['siri', 'voice', 'apple', 'capture', 'inbox', 'dictate', 'hey siri'] },
  { id: 'remindersPermission', groupId: 'capture', label: 'Reminders access', section: 'Apple Reminders',
    keywords: ['permission', 'allow'] },
  { id: 'remindersList', groupId: 'capture', label: 'List', section: 'Apple Reminders',
    keywords: ['which list', 'default list'] },
  { id: 'remindersImportReview', groupId: 'capture', label: 'Review before applying', section: 'Apple Reminders',
    keywords: ['approve', 'confirm', 'schedule', 'date', 'repeat', 'alarm', 'inbox'] },
  { id: 'remindersImportDelete', groupId: 'capture', label: 'Delete after importing', section: 'Apple Reminders',
    keywords: ['remove', 'keep', 'leave', 'duplicate', 'copy', 'one-way', 'mirror'] },
  { id: 'groceryImport', groupId: 'capture', label: 'Send a list to Groceries', section: 'Apple Reminders',
    keywords: ['siri', 'shopping', 'voice', 'apple', 'milk', 'hey siri'], kitchen: true },
  { id: 'groceryImportList', groupId: 'capture', label: 'Grocery list', section: 'Apple Reminders',
    keywords: ['which list', 'shopping'], kitchen: true },
  { id: 'groceryImportTwoWay', groupId: 'capture', label: 'Two-way sync', section: 'Apple Reminders',
    keywords: ['both ways', 'mirror', 'shopping', 'shared list', 'write back', 'duplicate'],
    kitchen: true },
  { id: 'groceryImportDelete', groupId: 'capture', label: 'Delete after adding to Groceries', section: 'Apple Reminders',
    keywords: ['remove', 'keep', 'leave', 'duplicate', 'shopping', 'mirror'], kitchen: true },
  { id: 'importNow', groupId: 'capture', label: 'Import now', section: 'Apple Reminders',
    keywords: ['sync', 'refresh'] },

  // Calendar (iOS). "Google" earns a keyword on every row: it's what people
  // will search for, and it appears in none of the labels — the app reads
  // EventKit calendars and never asks which service is behind one.
  { id: 'calendarRead', groupId: 'capture', label: 'Read my calendar', section: 'Calendar',
    keywords: ['google', 'gcal', 'ical', 'icloud', 'outlook', 'events', 'meetings', 'busy', 'schedule'] },
  { id: 'calendarPermission', groupId: 'capture', label: 'Calendar access', section: 'Calendar',
    keywords: ['permission', 'allow', 'google'] },
  { id: 'calendarList', groupId: 'capture', label: 'Calendars', section: 'Calendar',
    keywords: ['which calendar', 'google', 'work', 'shared', 'subscribed'] },
  { id: 'calendarToday', groupId: 'capture', label: 'Today', section: 'Calendar',
    keywords: ['events', 'booked', 'busy', 'free', 'google'] },
  { id: 'calendarEventCategory', groupId: 'capture', label: 'Show events under', section: 'Calendar',
    keywords: ['category', 'section', 'today', 'events on today', 'hide events', 'file', 'where'] },
  { id: 'reminderMeetingNudge', groupId: 'capture', label: 'Move reminders out of meetings', section: 'Calendar',
    keywords: ['notification', 'event', 'busy', 'nudge', 'delay', 'push back'] },
  { id: 'deadlineCalendar', groupId: 'capture', label: 'Write deadlines to', section: 'Deadlines on your calendar',
    keywords: ['all-day', 'event', 'export', 'google', 'sync'] },
  { id: 'mealCalendar', groupId: 'capture', label: 'Write meals to', section: 'Meals on your calendar',
    keywords: ['all-day', 'event', 'export', 'google', 'sync', 'meal plan', 'dinner', 'share', 'household', 'family'],
    kitchen: true },

  // Tasks & projects
  { id: 'vacationMode', groupId: 'tasksProjects', label: 'Vacation mode', section: 'Vacation',
    keywords: ['holiday', 'pause', 'away', 'streaks'], simple: true },
  { id: 'vacationEnd', groupId: 'tasksProjects', label: 'End date', section: 'Vacation',
    keywords: ['vacation end', 'return'], simple: true },
  { id: 'autoRemoveExpired', groupId: 'tasksProjects', label: 'Auto-remove expired tasks', section: 'Time-limited tasks',
    keywords: ['window', 'delete'], simple: true },
  { id: 'timerLiveActivity', groupId: 'tasksProjects', label: 'Live Activity while timing', section: 'Timers',
    keywords: ['lock screen', 'dynamic island', 'timer', 'stopwatch', 'cooking', 'recipe', 'countdown'] },
  { id: 'postponeCheck', groupId: 'tasksProjects', label: 'Suggest an action after repeated reschedules', section: 'Rescheduling',
    keywords: ['postpone', 'procrastinate', 'snooze', 'defer', 'avoid'] },
  { id: 'postponeCheckThreshold', groupId: 'tasksProjects', label: 'Reschedule threshold', section: 'Rescheduling',
    keywords: ['postpone', 'how many'] },
  // Every focus row carries "pomodoro": it's the name most people have for the
  // thing, and it appears nowhere in the UI copy (which says what each setting
  // does in literal terms instead), so without it the whole section is
  // unfindable by the only word someone is likely to type.
  { id: 'focusWorkCapMinutes', groupId: 'tasksProjects', label: 'Work stretch length', section: 'Focus sessions', simple: true,
    keywords: ['pomodoro', 'focus', 'timer', 'deep work', 'block', 'session', 'cap'] },
  { id: 'focusDefaultWorkMinutes', groupId: 'tasksProjects', label: 'Length without an estimate', section: 'Focus sessions', simple: true,
    keywords: ['pomodoro', 'focus', 'unestimated', 'default', 'fallback'] },
  { id: 'focusRestAfterMinutes', groupId: 'tasksProjects', label: 'Break after this much work', section: 'Focus sessions', simple: true,
    keywords: ['pomodoro', 'focus', 'rest', 'interval', 'how often'] },
  { id: 'focusRestAfterTasks', groupId: 'tasksProjects', label: 'Break after this many tasks', section: 'Focus sessions', simple: true,
    keywords: ['pomodoro', 'focus', 'rest', 'how many'] },
  { id: 'focusRestMinutes', groupId: 'tasksProjects', label: 'Break length', section: 'Focus sessions', simple: true,
    keywords: ['pomodoro', 'focus', 'rest', 'short break'] },
  { id: 'focusLongRestEvery', groupId: 'tasksProjects', label: 'Long break every', section: 'Focus sessions', simple: true,
    keywords: ['pomodoro', 'focus', 'rest', 'how often'] },
  { id: 'focusLongRestMinutes', groupId: 'tasksProjects', label: 'Long break length', section: 'Focus sessions', simple: true,
    keywords: ['pomodoro', 'focus', 'rest'] },
  { id: 'focusLiveActivity', groupId: 'tasksProjects', label: 'Live Activity while focusing', section: 'Focus sessions',
    keywords: ['pomodoro', 'session', 'lock screen', 'dynamic island', 'widget'] },
  // Keyworded for what someone types when a task landed somewhere they didn't
  // put it — "why did this go to Work" is a search for the rule, not for the
  // word "rule". The other New tasks rows are unindexed; this one earns an
  // entry because it's the only thing in Settings that can explain a task
  // filing itself.
  { id: 'titleRules', groupId: 'tasksProjects', label: 'Title rules', section: 'New tasks',
    keywords: ['keyword', 'expense', 'automatic', 'auto file', 'category', 'project', 'tag',
      'starts with', 'parse', 'shortcut', 'prefix', 'why did this'] },
  { id: 'simpleTaskForm', groupId: 'tasksProjects', label: 'Show fewer fields', section: 'Task form',
    keywords: ['simple', 'quick add', 'editor', 'chips', 'declutter', 'basic', 'minimal'] },
  { id: 'autoArchiveProjects', groupId: 'tasksProjects', label: 'Auto-archive projects', section: 'Projects',
    keywords: ['finished', 'complete'] },
  { id: 'defaultProjectNudgeCadence', groupId: 'tasksProjects', label: 'Default nudge cadence', section: 'Projects',
    keywords: ['nudge me', 'stalled', 'quiet', 'chase', 'reminder', 'stall', 'new project'] },
  // The master switch for the groceries/recipes/meal plan area. Unflagged, and
  // has to stay that way — a row that hid itself when switched off would be a
  // setting with no way back.
  { id: 'kitchenEnabled', groupId: 'tasksProjects', label: 'Groceries & meals', section: 'Feature areas',
    keywords: ['grocery', 'recipes', 'meal plan', 'shopping', 'food', 'cooking',
      'hide', 'remove', 'disable', 'turn off', 'menu', 'drawer', 'tab bar'] },
  // The other master switch, and unflagged for the same reason. Keyworded for
  // the features it removes as well as for what it is: someone who wants
  // chains or the focus timer gone will search for those, not for "simplified".
  { id: 'simpleMode', groupId: 'tasksProjects', label: 'Simplified mode', section: 'Feature areas',
    keywords: ['simple', 'simplify', 'basic', 'minimal', 'declutter', 'overwhelming', 'advanced',
      'hide', 'remove', 'disable', 'turn off', 'chains', 'timed', 'daily target', 'quota',
      'focus', 'pomodoro', 'stacks', 'templates', 'stats', 'drift', 'backfill', 'waiting',
      'deadline', 'blocked', 'barcode', 'receipt', 'pantry', 'substitutes', 'cook mode'] },
  { id: 'mealsOnToday', groupId: 'tasksProjects', label: 'Show the day\'s meals', section: 'Meals on Today',
    keywords: ['meal plan', 'dinner', 'menu', 'today', 'hide meals', 'leftovers', 'takeaway'], kitchen: true },
  { id: 'kitchenOnToday', groupId: 'tasksProjects', label: 'Show what needs using up', section: 'Meals on Today',
    keywords: ['fridge', 'kitchen', 'expiry', 'use by', 'spoil', 'waste', 'leftovers', 'pantry', 'today'],
    kitchen: true, simple: true },
  { id: 'restockOfferEnabled', groupId: 'tasksProjects', label: 'Restock after cooking', section: 'Meals on Today',
    keywords: ['banner', 'ingredients', 'shopping list', 'offer'], kitchen: true },
  { id: 'productLookupEnabled', groupId: 'privacyAi', label: 'Look up scanned barcodes', section: 'Barcode lookups',
    keywords: ['upc', 'ean', 'gtin', 'open food facts', 'pantry', 'unpack', 'network', 'privacy'],
    kitchen: true, simple: true },
  { id: 'fdcApiKey', groupId: 'privacyAi', label: 'FoodData Central key', section: 'Barcode lookups',
    keywords: ['usda', 'api', 'barcode', 'scan', 'branded', 'nutrition'], kitchen: true, simple: true },
  { id: 'goUpcApiKey', groupId: 'privacyAi', label: 'Go-UPC key', section: 'Barcode lookups',
    keywords: ['api', 'barcode', 'scan', 'paid', 'fallback'], kitchen: true, simple: true },
  { id: 'clearGtinLookups', groupId: 'privacyAi', label: 'Forget saved barcodes', section: 'Barcode lookups',
    keywords: ['cache', 'clear', 'reset', 'wrong name', 'upc', 'gtin', 'scan again'], kitchen: true, simple: true },
  { id: 'tripLiveActivity', groupId: 'tasksProjects', label: 'Live Activity while shopping', section: 'Shopping trip',
    keywords: ['lock screen', 'dynamic island', 'store', 'trip', 'grocery', 'elapsed', 'timer'],
    kitchen: true, simple: true },
  // The generators, all in one section now (#1524) — they used to be three
  // sections here plus one over in Notifications. Each keeps its own entry
  // rather than collapsing to one "Tasks the app adds" row: a search index
  // exists to find the row you can't see, and "cook tasks" and "use-by" are
  // what people type, not the name of the section they happen to share.
  //
  // Two of them are *not* flagged `kitchen`: the section is shared, but a quiet
  // project has nothing to do with the grocery area, so hiding its rows along
  // with the kitchen's would take away a setting that still does something.
  { id: 'mealCookTasks', groupId: 'tasksProjects', label: 'Meal tasks', section: 'Tasks the app adds',
    keywords: ['meal plan', 'recipe', 'cook', 'cook task', 'breakfast', 'lunch', 'dinner', 'eat',
      'what to eat', 'auto', 'generated', 'automatic'], kitchen: true },
  // Its own entry rather than riding the row above: "which meals" is what a
  // person types when they want breakfast to stop asking, and the setting they
  // need is a toggle inside another generator's card.
  { id: 'mealSlotsEnabled', groupId: 'tasksProjects', label: 'Meals you eat', section: 'Tasks the app adds',
    keywords: ['breakfast', 'lunch', 'dinner', 'snack', 'skip', 'which ones'], kitchen: true },
  { id: 'mealCookTaskCategory', groupId: 'tasksProjects', label: 'File meal tasks under', section: 'Tasks the app adds',
    keywords: ['category', 'meal plan', 'kitchen'], kitchen: true },
  { id: 'groceryUseUpTasks', groupId: 'tasksProjects', label: 'Use-up tasks for groceries', section: 'Tasks the app adds',
    keywords: ['expiry', 'expires', 'expiration', 'use by', 'best before', 'perishable', 'spoil',
      'waste', 'fridge', 'grocery', 'food', 'leftovers', 'generated', 'automatic'], kitchen: true },
  { id: 'groceryUseUpLeadDays', groupId: 'tasksProjects', label: 'Show the task', section: 'Tasks the app adds',
    keywords: ['expiry', 'use by', 'days before', 'lead', 'warning', 'grocery'], kitchen: true },
  { id: 'groceryUseUpTaskCategory', groupId: 'tasksProjects', label: 'File use-up tasks under', section: 'Tasks the app adds',
    keywords: ['category', 'grocery', 'expiry', 'kitchen'], kitchen: true },
  { id: 'leftoverUseUpTasks', groupId: 'tasksProjects', label: 'Use-up tasks for leftovers', section: 'Tasks the app adds',
    keywords: ['fridge', 'expiry', 'expires', 'use by', 'spoil', 'waste', 'food', 'generated', 'automatic'], kitchen: true },
  { id: 'leftoverUseUpTaskCategory', groupId: 'tasksProjects', label: 'File use-up tasks under', section: 'Tasks the app adds',
    keywords: ['category', 'leftover', 'fridge', 'kitchen'], kitchen: true },
  { id: 'mealPlanNudge', groupId: 'tasksProjects', label: 'Plan meals for the week', section: 'Tasks the app adds',
    keywords: ['meal plan', 'weekly', 'nudge', 'remind', 'planning', 'generated', 'automatic'], kitchen: true },
  { id: 'mealPlanNudgeTime', groupId: 'tasksProjects', label: 'Nudge me on', section: 'Tasks the app adds',
    keywords: ['meal plan', 'weekday', 'day', 'time', 'when'], kitchen: true },
  { id: 'mealPlanNudgeTaskCategory', groupId: 'tasksProjects', label: 'File them under', section: 'Tasks the app adds',
    keywords: ['category', 'meal plan', 'weekly', 'nudge', 'kitchen'], kitchen: true },
  { id: 'projectReviewTasks', groupId: 'tasksProjects', label: 'Review tasks for quiet projects', section: 'Tasks the app adds',
    keywords: ['stalled', 'stale', 'nudge', 'pull', 'idle', 'abandoned', 'generated', 'automatic'] },
  { id: 'projectReviewTaskCategory', groupId: 'tasksProjects', label: 'File them under', section: 'Tasks the app adds',
    keywords: ['category', 'project', 'review', 'quiet'] },
  { id: 'pantryCheckTasks', groupId: 'tasksProjects', label: 'Pantry checks', section: 'Tasks the app adds',
    keywords: ['cupboard', 'stock', 'still have', 'run out', 'out of', 'grocery', 'kitchen',
      'restock', 'generated', 'automatic'], kitchen: true },
  { id: 'pantryCheckTaskCategory', groupId: 'tasksProjects', label: 'File them under', section: 'Tasks the app adds',
    keywords: ['category', 'pantry', 'grocery', 'kitchen'], kitchen: true },
  // Flagged too: it only ever restates a recipe's or a grocery row's amount, so
  // with the area gone there is nothing left for it to convert.
  { id: 'unitSystem', groupId: 'tasksProjects', label: 'Units', section: 'Recipe & grocery amounts',
    keywords: ['metric', 'imperial', 'convert', 'grams', 'ounces', 'pounds', 'cups', 'millilitres', 'measurement'],
    kitchen: true },
  { id: 'currencySymbol', groupId: 'tasksProjects', label: 'Currency', section: 'Recipe & grocery amounts',
    keywords: ['price', 'cost', 'money', 'symbol', 'dollar', 'pound', 'euro', 'yen', 'grocery'],
    kitchen: true },
  // The row is a count and a way in; the rules themselves live on the links.
  // Keyworded for what someone would actually type when a recipe surprised
  // them — "why does this say oat milk" is a search for the swap, not for the
  // word "substitute".
  { id: 'standingSwaps', groupId: 'tasksProjects', label: 'Standing swaps', section: 'Substitutes',
    keywords: ['substitute', 'instead of', 'always use', 'replace', 'oat milk', 'dairy',
      'allergy', 'recipe', 'grocery', 'automatic'],
    kitchen: true, simple: true },

  // Privacy & AI
  { id: 'appLock', groupId: 'privacyAi', label: 'Require Face ID to open', section: 'App lock',
    keywords: ['touch id', 'biometric', 'lock', 'passcode', 'privacy', 'security'] },
  { id: 'appLockGrace', groupId: 'privacyAi', label: 'Lock again after', section: 'App lock',
    keywords: ['grace', 'timeout'] },
  { id: 'apiKey', groupId: 'privacyAi', label: 'Anthropic API Key', section: 'AI suggestions',
    keywords: ['ai', 'claude', 'suggestions'] },
  ...AI_FEATURE_ENTRIES,

  // Data & reset
  { id: 'syncEnabled', groupId: 'dataReset', label: 'Sync with iCloud', section: 'Sync',
    keywords: ['devices', 'mac', 'laptop', 'phone', 'across', 'same'] },
  { id: 'syncNow', groupId: 'dataReset', label: 'Sync now', section: 'Sync',
    keywords: ['refresh', 'update', 'fetch'] },
  { id: 'exportBackup', groupId: 'dataReset', label: 'Export all data', section: 'Backup',
    keywords: ['backup', 'json', 'save', 'share'] },
  { id: 'restoreBackup', groupId: 'dataReset', label: 'Restore from a backup', section: 'Backup',
    keywords: ['import', 'replace'] },
  { id: 'retention', groupId: 'dataReset', label: 'Keep completed tasks for', section: 'History',
    keywords: ['history', 'logbook', 'retention', 'purge', 'delete'] },
  { id: 'demoMode', groupId: 'dataReset', label: 'Demo mode', section: 'Demo',
    keywords: ['sample', 'try', 'preview'] },
  { id: 'resetStreaks', groupId: 'dataReset', label: 'Reset all streaks', section: 'Reset',
    keywords: ['zero'] },
  { id: 'resetDefaults', groupId: 'dataReset', label: 'Reset to defaults', section: 'Reset',
    keywords: ['factory', 'restore defaults'] },

  // About
  { id: 'version', groupId: 'about', label: 'Version', section: 'About', keywords: ['build'] },
  { id: 'patchNotes', groupId: 'about', label: "What's New", section: 'About',
    keywords: ['changelog', 'patch notes', 'updates', 'release'] },
];

/** The groups to show on this platform, in order. */
export function visibleSettingsGroups(platformOS: string): SettingsGroup[] {
  return SETTINGS_GROUPS.filter(g => !g.iosOnly || platformOS === 'ios');
}

/**
 * The entries reachable right now — an iOS-only group takes its rows with it,
 * and the kitchen rows go with `kitchenEnabled`.
 *
 * `kitchenEnabled` defaults to true and `simpleMode` to false so a caller that
 * doesn't care (a test, a platform check) gets the whole index, the way it did
 * before either setting existed.
 */
export function visibleSettingsEntries(
  platformOS: string,
  kitchenEnabled = true,
  simpleMode = false,
): SettingsEntry[] {
  const shown = new Set(visibleSettingsGroups(platformOS).map(g => g.id));
  return SETTINGS_ENTRIES.filter(e =>
    shown.has(e.groupId)
    && (kitchenEnabled || !e.kitchen)
    && (!simpleMode || !e.simple));
}

export function settingsGroup(id: SettingsGroupId): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find(g => g.id === id);
}
