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
 */

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
}

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  // Appearance
  { id: 'theme', groupId: 'appearance', label: 'Theme', section: 'Theme',
    keywords: ['dark', 'light', 'purple', 'system', 'colour', 'color'] },
  { id: 'fabHand', groupId: 'appearance', label: 'Add button', section: 'Theme',
    keywords: ['corner', 'left', 'right', 'handed', 'plus', 'fab'] },
  { id: 'typeface', groupId: 'appearance', label: 'Typeface', section: 'Typeface',
    keywords: ['font', 'bricolage', 'fraunces', 'space grotesk', 'nunito', 'outfit', 'serif', 'mono'] },
  { id: 'haptics', groupId: 'appearance', label: 'Haptic feedback', section: 'Feedback',
    keywords: ['vibrate', 'vibration', 'taptic', 'buzz'] },

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
    keywords: ['holiday', 'pause', 'away', 'streaks'] },
  { id: 'vacationEnd', groupId: 'tasksProjects', label: 'End date', section: 'Vacation',
    keywords: ['vacation end', 'return'] },
  { id: 'autoRemoveExpired', groupId: 'tasksProjects', label: 'Auto-remove expired tasks', section: 'Time-limited tasks',
    keywords: ['window', 'delete'] },
  { id: 'timerLiveActivity', groupId: 'tasksProjects', label: 'Live Activity while timing', section: 'Timers',
    keywords: ['lock screen', 'dynamic island', 'timer', 'stopwatch', 'cooking', 'recipe', 'countdown'] },
  { id: 'postponeCheck', groupId: 'tasksProjects', label: 'Suggest an action after repeated reschedules', section: 'Rescheduling',
    keywords: ['postpone', 'procrastinate', 'snooze', 'defer', 'avoid'] },
  { id: 'postponeCheckThreshold', groupId: 'tasksProjects', label: 'Reschedule threshold', section: 'Rescheduling',
    keywords: ['postpone', 'how many'] },
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
      'hide', 'remove', 'disable', 'turn off', 'menu', 'drawer'] },
  { id: 'mealsOnToday', groupId: 'tasksProjects', label: 'Show the day\'s meals', section: 'Meals on Today',
    keywords: ['meal plan', 'dinner', 'menu', 'today', 'hide meals', 'leftovers', 'in the list', 'block'], kitchen: true },
  // The four generators, all in one section now (#1524) — they used to be three
  // sections here plus one over in Notifications. Each keeps its own entry
  // rather than collapsing to one "Tasks the app adds" row: a search index
  // exists to find the row you can't see, and "cook tasks" and "use-by" are
  // what people type, not the name of the section they happen to share.
  { id: 'mealCookTasks', groupId: 'tasksProjects', label: 'Cook tasks', section: 'Tasks the app adds',
    keywords: ['meal plan', 'recipe', 'dinner', 'auto', 'generated', 'automatic'], kitchen: true },
  { id: 'mealCookTaskCategory', groupId: 'tasksProjects', label: 'File cook tasks under', section: 'Tasks the app adds',
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
  // Flagged too: it only ever restates a recipe's or a grocery row's amount, so
  // with the area gone there is nothing left for it to convert.
  { id: 'unitSystem', groupId: 'tasksProjects', label: 'Units', section: 'Recipe & grocery amounts',
    keywords: ['metric', 'imperial', 'convert', 'grams', 'ounces', 'pounds', 'cups', 'millilitres', 'measurement'],
    kitchen: true },
  { id: 'currencySymbol', groupId: 'tasksProjects', label: 'Currency', section: 'Recipe & grocery amounts',
    keywords: ['price', 'cost', 'money', 'symbol', 'dollar', 'pound', 'euro', 'yen', 'grocery'],
    kitchen: true },

  // Privacy & AI
  { id: 'appLock', groupId: 'privacyAi', label: 'Require Face ID to open', section: 'App lock',
    keywords: ['touch id', 'biometric', 'lock', 'passcode', 'privacy', 'security'] },
  { id: 'appLockGrace', groupId: 'privacyAi', label: 'Lock again after', section: 'App lock',
    keywords: ['grace', 'timeout'] },
  { id: 'apiKey', groupId: 'privacyAi', label: 'Anthropic API Key', section: 'AI suggestions',
    keywords: ['ai', 'claude', 'suggestions'] },
  { id: 'aiTaskSuggestions', groupId: 'privacyAi', label: 'Task suggestions', section: 'AI features',
    keywords: ['claude', 'model', 'tag', 'effort', 'category'] },
  { id: 'aiTemplateSuggestions', groupId: 'privacyAi', label: 'Template drafting', section: 'AI features',
    keywords: ['claude', 'model', 'checklist'] },
  { id: 'aiGroceryAisles', groupId: 'privacyAi', label: 'Grocery aisle sorting', section: 'AI features',
    keywords: ['claude', 'model', 'shopping'], kitchen: true },
  { id: 'aiRecipeExtraction', groupId: 'privacyAi', label: 'Recipe import', section: 'AI features',
    keywords: ['claude', 'model', 'ingredients'], kitchen: true },
  { id: 'aiMealIdeas', groupId: 'privacyAi', label: 'Meal ideas', section: 'AI features',
    keywords: ['claude', 'model', 'dinner', 'suggest', 'meal plan'], kitchen: true },

  // Data & reset
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
 * `kitchenEnabled` defaults to true so a caller that doesn't care (a test, a
 * platform check) gets the whole index, the way it did before the setting
 * existed.
 */
export function visibleSettingsEntries(platformOS: string, kitchenEnabled = true): SettingsEntry[] {
  const shown = new Set(visibleSettingsGroups(platformOS).map(g => g.id));
  return SETTINGS_ENTRIES.filter(e => shown.has(e.groupId) && (kitchenEnabled || !e.kitchen));
}

export function settingsGroup(id: SettingsGroupId): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find(g => g.id === id);
}
