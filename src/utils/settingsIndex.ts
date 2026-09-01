/**
 * What Settings contains, as data — the ten groups and one record per
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
 *
 * The generators are the second such block and were drifting the same way — see
 * `GENERATED_ENTRIES`, which derives them from `GENERATED_KIND_LIST` for the
 * same reasons and had the same three symptoms to fix. Both are the exception
 * that proves the rule above: a block of Settings is derived here exactly when
 * its *rows* are derived there, and hand-written otherwise.
 */

import { AI_FEATURES, type AiFeatureId } from './aiFeatures';
import { GENERATED_KIND_LIST, type GeneratedKind } from './generatedTasks';

export type SettingsGroupId =
  | 'appearance'
  | 'dayTime'
  | 'notifications'
  | 'capture'
  | 'tasksProjects'
  | 'generated'
  | 'kitchen'
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
  /**
   * Dropped with the groceries/recipes/meal-plan area, along with all of its
   * entries — the group-level version of `SettingsEntry.kitchen`.
   *
   * A whole group appearing and disappearing is a much plainer account of what
   * the master switch does than the previous arrangement, where a third of the
   * Tasks & projects screen silently changed length. It also means the rows
   * inside need no `kitchen` flag of their own: the group gate drops them, so
   * flagging them again would be a second copy of one answer.
   *
   * The switch itself must never live in a group carrying this, for the reason
   * its own entry is unflagged: it would be a setting with no way back. It
   * stays under Feature areas in Tasks & projects.
   */
  kitchenOnly?: boolean;
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: 'appearance', title: 'Appearance', icon: 'color-palette-outline', tint: 'accent' },
  { id: 'dayTime', title: 'Day & time', icon: 'sunny-outline', tint: 'orange' },
  { id: 'notifications', title: 'Notifications', icon: 'notifications-outline', tint: 'red' },
  // Both EventKit integrations live here rather than in two groups: they share
  // a framework, a platform gate and the same caveat (no change notification,
  // so both refresh on foreground).
  { id: 'capture', title: 'Reminders & Calendar', icon: 'download-outline', tint: 'green', iosOnly: true },
  { id: 'tasksProjects', title: 'Tasks & projects', icon: 'checkbox-outline', tint: 'purple' },
  // Its own group rather than one section of fourteen inside Tasks & projects,
  // which is where half that screen's rows were. It answers the question the
  // section's own header comment names as the one people actually have — *what
  // writes tasks into my list* — and it is the part of Settings that grows every
  // time a generator ships, so it wants a door of its own rather than a deeper
  // scroll. Not `kitchenOnly`: six of the twelve generators have nothing to do
  // with the kitchen and keep running without it, which is exactly the bug that
  // hiding them behind the area's gate used to cause.
  { id: 'generated', title: 'Automatic tasks', icon: 'sparkles-outline', tint: 'accent' },
  { id: 'kitchen', title: 'Groceries & meals', icon: 'cart-outline', tint: 'orange', kitchenOnly: true },
  // Neutral from here down: the tinted groups are things you configure, the grey
  // ones are housekeeping. There are only five tints and seven tinted groups, so
  // two repeat — the rule is that a repeat never lands *next to* its own other
  // instance, since adjacency is what reads as an accident rather than as a
  // category. Appearance/Automatic tasks are five rows apart, Day & time and
  // Groceries & meals four.
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
  projectTaskSuggestions: ['claude', 'model', 'checklist', 'fill', 'generate', 'description'],
  groceryAisles: ['claude', 'model', 'shopping'],
  recipeExtraction: ['claude', 'model', 'ingredients', 'paste', 'photo', 'link'],
  mealIdeas: ['claude', 'model', 'dinner', 'suggest', 'meal plan'],
  substitutes: ['claude', 'model', 'instead of', 'swap', 'replace', 'allergy', 'out of'],
  receiptImport: ['claude', 'model', 'photo', 'till', 'shopping trip', 'prices'],
  calendarImport: ['claude', 'model', 'paste', 'appointment', 'itinerary', 'add to calendar'],
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

/**
 * The words that should find a generator's row but don't appear in its label.
 *
 * The `AI_FEATURE_KEYWORDS` treatment, applied to the other list Settings
 * renders by mapping over a registry. Keyed by `GeneratedKind` so a new
 * generator is a type error here until it has been given some.
 *
 * `mealCook` is retired and renders no row (see `GENERATED_KINDS`), but the
 * record is exhaustive over the union, so it keeps a key. Nothing reads it.
 */
const GENERATED_KEYWORDS: Record<GeneratedKind, string[]> = {
  mealSlot: ['meal plan', 'recipe', 'cook', 'cook task', 'breakfast', 'lunch', 'dinner', 'eat',
    'what to eat', 'auto', 'generated', 'automatic'],
  mealCook: ['meal plan', 'recipe', 'cook', 'generated', 'automatic'],
  groceryUseUp: ['expiry', 'expires', 'expiration', 'use by', 'best before', 'perishable', 'spoil',
    'waste', 'fridge', 'grocery', 'food', 'leftovers', 'generated', 'automatic'],
  pantryCheck: ['cupboard', 'stock', 'still have', 'run out', 'out of', 'grocery', 'kitchen',
    'restock', 'generated', 'automatic'],
  leftoverUseUp: ['fridge', 'expiry', 'expires', 'use by', 'spoil', 'waste', 'food', 'generated',
    'automatic'],
  mealPlanNudge: ['meal plan', 'weekly', 'nudge', 'remind', 'planning', 'generated', 'automatic'],
  mealShortfall: ['ingredients', 'missing', 'meal plan', 'grocery', 'buy', 'short', 'generated',
    'automatic'],
  projectReview: ['stalled', 'stale', 'nudge', 'pull', 'idle', 'abandoned', 'generated', 'automatic'],
  supplyReorder: ['supply', 'stock', 'restock', 'order more', 'refill', 'running low', 'run out',
    'consumable', 'filter', 'cartridge', 'generated', 'automatic'],
  calendarReview: ['events', 'agenda', 'schedule', 'generated', 'automatic'],
  birthday: ['people', 'person', 'friend', 'family', 'age', 'gift', 'present', 'card', 'generated',
    'automatic'],
  birthdayGift: ['people', 'person', 'friend', 'family', 'present', 'shopping', 'buy', 'generated',
    'automatic'],
  reachOut: ['people', 'person', 'friend', 'family', 'catch up', 'cadence', 'nudge', 'reach out',
    'contact', 'generated', 'automatic'],
  // `swipe` and `deck` earn their place: they are what a person remembers about
  // this one, and the label can't carry either without describing a gesture
  // instead of what the setting does.
  pantryReview: ['cupboard', 'stock', 'take stock', 'swipe', 'deck', 'still have', 'grocery',
    'kitchen', 'generated', 'automatic'],
  screenTime: ['phone', 'usage', 'distraction', 'social media', 'doomscroll', 'limit', 'apps'],
  moodLog: ['symptom', 'symptoms', 'feeling', 'feelings', 'wellbeing', 'well-being',
    'health', 'journal', 'diary', 'track', 'log', 'generated', 'automatic'],
  moodNudge: ['mood', 'down', 'wellbeing', 'well-being', 'health', 'fun', 'enjoy', 'cheer',
    'generated', 'automatic'],
  // No 'weekend' or 'empty': both are already in this generator's label, which
  // the index searches on its own.
  weekendNudge: ['saturday', 'sunday', 'friday', 'bare', 'free', 'plans',
    'planning', 'project', 'generated', 'automatic'],
  weather: ['sunny', 'rainy', 'snowy', 'cold', 'hot', 'sunscreen', 'umbrella', 'coat', 'forecast',
    'location', 'temperature', 'generated', 'automatic'],
};

/**
 * One entry per row `GeneratedTasksSection` actually renders, in the same order.
 *
 * Derived rather than written out, for the reason the AI features are: this is
 * the other block of Settings whose rows come from a registry, so a generator
 * added to `GENERATED_KIND_LIST` grew a row on its own and only the index had to
 * be remembered separately. It wasn't — the three "File … under" entries below
 * named labels (`File meal tasks under`, `File use-up tasks under`) that the row
 * stopped rendering when the generators were gathered into one section, and
 * every one of the nine says plain "File them under" now.
 *
 * **`kitchen` comes from the registry too**, which is the half that matters:
 * whether a generator survives the area being switched off is one fact, and it
 * was previously written down twice — once here and once as a gate (or a missing
 * gate) in the pass itself. `GeneratedKindSpec.kitchen` is the single answer,
 * and `settingsIndex.test.ts` holds the two lists against each other.
 *
 * **`section` is the generator's own name, not the section header.** Nine rows
 * read "File them under" and four read "Show the task", so the group title is
 * what a result needs least and the generator is what it needs most: "File them
 * under · Birthday reminders" is answerable, nine identical rows are not. The
 * toggle rows take the header instead, since their label already carries the
 * generator's name.
 */
const GENERATED_ENTRIES: SettingsEntry[] = GENERATED_KIND_LIST.flatMap(spec => {
  const shared = {
    groupId: 'generated' as const,
    // Carried across rather than restated — an entry that outlived its row
    // would be a result pointing at nothing, and an entry that left while its
    // row stayed would be a task nobody can find the switch for.
    ...(spec.kitchen ? { kitchen: true } : {}),
  };
  return [
    {
      ...shared,
      id: `gen:${spec.kind}`,
      label: spec.label,
      section: 'Automatic tasks',
      keywords: GENERATED_KEYWORDS[spec.kind],
    },
    ...(spec.categorized ? [{
      ...shared,
      id: `gen:${spec.kind}:category`,
      label: 'File them under',
      section: spec.label,
      keywords: ['category', 'where', 'section'],
    }] : []),
  ];
});

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
  { id: 'hideHelpText', groupId: 'appearance', label: 'Hide help text', section: 'Feedback',
    keywords: ['hint', 'description', 'explanation', 'subtitle', 'terse', 'declutter'] },
  { id: 'shakeToUndo', groupId: 'appearance', label: 'Shake to undo', section: 'Feedback',
    keywords: ['gesture', 'revert', 'mistake', 'accident', 'restore', 'take back'] },
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
  // The five rows below had no entry at all, which made the group's own subject
  // unsearchable: "quiet hours" and "do not disturb" are among the most likely
  // things anybody types into this field, and neither found anything.
  { id: 'tripReminder', groupId: 'notifications', label: 'Trip reminder', section: 'Notifications',
    keywords: ['shopping', 'store', 'still at', 'left', 'forgot', 'grocery'], kitchen: true },
  { id: 'quietHours', groupId: 'notifications', label: 'Quiet hours', section: 'Notifications',
    keywords: ['do not disturb', 'dnd', 'night', 'silence', 'mute', 'sleep', 'overnight',
      'no notifications'] },
  { id: 'quietHoursStart', groupId: 'notifications', label: 'From', section: 'Notifications',
    keywords: ['quiet hours', 'start', 'silence', 'night'] },
  { id: 'quietHoursEnd', groupId: 'notifications', label: 'Until', section: 'Notifications',
    keywords: ['quiet hours', 'end', 'silence', 'morning'] },
  { id: 'quietHoursFromAwake', groupId: 'notifications', label: 'Set from awake hours', section: 'Notifications',
    keywords: ['quiet hours', 'match', 'copy', 'day & time'] },
  { id: 'defaultReminderLead', groupId: 'notifications', label: 'Remind me before', section: 'Default reminder',
    keywords: ['lead', 'early', 'ahead', 'start time', 'automatic', 'notification', 'alert'] },
  // The meal-plan nudge used to sit here, on the grounds that it fires on a
  // schedule. It writes a *task*, though, not a notification, which is the
  // thing it has in common with the other three generators — so it moved to
  // "Automatic tasks" in Tasks & projects (#1524).

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
  { id: 'calendarSyncNow', groupId: 'capture', label: 'Sync now', section: 'Calendar',
    keywords: ['refresh', 'force', 'manual', 'reload', 'events', 'stale'] },
  { id: 'calendarVacationHidden', groupId: 'capture', label: 'Hide during vacation', section: 'Calendar',
    keywords: ['away', 'exclude', 'work calendar', 'trip'] },
  { id: 'calendarEventCategory', groupId: 'capture', label: 'Show events under', section: 'Calendar',
    keywords: ['category', 'section', 'today', 'events on today', 'hide events', 'file', 'where'] },
  { id: 'reminderMeetingNudge', groupId: 'capture', label: 'Move reminders out of meetings', section: 'Calendar',
    keywords: ['notification', 'event', 'busy', 'nudge', 'delay', 'push back'] },
  { id: 'calendarPeopleHistory', groupId: 'capture', label: 'Match events to people', section: 'Calendar',
    keywords: ['friends', 'family', 'history', 'together', 'name', 'title', 'suggest', 'past'] },
  { id: 'deadlineCalendar', groupId: 'capture', label: 'Write deadlines to', section: 'Deadlines on your calendar',
    keywords: ['all-day', 'event', 'export', 'google', 'sync'] },
  { id: 'mealCalendar', groupId: 'capture', label: 'Write meals to', section: 'Meals on your calendar',
    keywords: ['all-day', 'event', 'export', 'google', 'sync', 'meal plan', 'dinner', 'share', 'household', 'family'],
    kitchen: true },

  // ── Tasks & projects ──────────────────────────────────────────────────────
  // In the order the screen renders them, which the registry's own comment
  // promises ("equal-scoring rows come back in the order you'd scroll past
  // them") and had stopped keeping: New tasks and Projects were written here
  // in the middle and rendered at the bottom.
  //
  // The six New tasks rows are indexed. They were left out on the grounds that
  // the section's own footer explains them, which is true for someone already
  // reading the section and no help at all to someone looking for it — "default
  // priority", "quick add" and "where new tasks go" are exactly what a person
  // types, and the group holding them is no longer one scroll away.
  { id: 'newTaskCategory', groupId: 'tasksProjects', label: 'Category', section: 'New tasks',
    keywords: ['default', 'new task', 'quick add', 'file', 'starts with'] },
  { id: 'newTaskPriority', groupId: 'tasksProjects', label: 'Priority', section: 'New tasks',
    keywords: ['default', 'new task', 'flag', 'important', 'urgent'] },
  { id: 'newTaskEffort', groupId: 'tasksProjects', label: 'Effort', section: 'New tasks',
    keywords: ['default', 'new task', 'size', 'estimate', 'small', 'large'] },
  { id: 'newTaskTimeOfDay', groupId: 'tasksProjects', label: 'Time of day', section: 'New tasks',
    keywords: ['default', 'new task', 'morning', 'afternoon', 'evening', 'night', 'segment'] },
  { id: 'newTaskDestination', groupId: 'tasksProjects', label: 'Where quick-add lands', section: 'New tasks',
    keywords: ['default', 'new task', 'inbox', 'today', 'unscheduled', 'goes', 'files'] },
  { id: 'openEditorAfterQuickAdd', groupId: 'tasksProjects', label: 'Open editor after quick add', section: 'New tasks',
    keywords: ['new task', 'sheet', 'stay', 'straight to', 'full form'] },
  // Keyworded for what someone types when a task landed somewhere they didn't
  // put it — "why did this go to Work" is a search for the rule, not for the
  // word "rule".
  { id: 'titleRules', groupId: 'tasksProjects', label: 'Title rules', section: 'New tasks',
    keywords: ['keyword', 'expense', 'automatic', 'auto file', 'category', 'project', 'tag',
      'starts with', 'parse', 'shortcut', 'prefix', 'why did this', 'link', 'url', 'app'] },
  // Sits under the generator's own section, beside gen:weather and
  // gen:weather:category (see GENERATED_ENTRIES) — this is the row that opens
  // the rule editor those two can't.
  { id: 'weatherRules', groupId: 'generated', label: 'Rules', section: 'Weather-based tasks',
    keywords: ['sunny', 'rainy', 'snowy', 'cold', 'hot', 'sunscreen', 'umbrella', 'coat',
      'forecast', 'location', 'condition', 'weather rule'] },
  { id: 'screenTimeRules', groupId: 'generated', label: 'Rules', section: 'Screen time tasks',
    keywords: ['screen time', 'usage', 'phone', 'apps', 'threshold', 'minutes', 'distraction',
      'social media', 'doomscroll', 'limit', 'screen time rule'] },
  { id: 'simpleTaskForm', groupId: 'tasksProjects', label: 'Show fewer fields', section: 'Task form',
    keywords: ['simple', 'quick add', 'chips', 'declutter', 'basic', 'minimal'] },
  { id: 'hideCategories', groupId: 'tasksProjects', label: 'Hide categories', section: 'Today',
    keywords: ['flat', 'one list', 'headers', 'sections', 'group', 'ungrouped', 'today'] },
  { id: 'autoCompleteProjects', groupId: 'tasksProjects', label: 'Auto-complete projects', section: 'Projects',
    // 'archive' and 'auto-archive' stay indexed: this row archived a finished
    // project until it started completing one, and someone who set it up under
    // the old behaviour will search for the old word.
    keywords: ['finished', 'done', 'archive', 'auto-archive', 'wrap up'] },
  // Named for the row as it reads now. It was indexed as "Default nudge
  // cadence" long after the row had been renamed, which is a result naming a
  // label nobody can find on the screen it opens.
  { id: 'defaultProjectNudgeCadence', groupId: 'tasksProjects', label: 'Default review cadence', section: 'Projects',
    keywords: ['nudge me', 'nudge', 'stalled', 'quiet', 'chase', 'reminder', 'stall', 'new project'] },
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
  // "Screen time" is the name most people have for this and appears nowhere in
  // the copy, same argument as "pomodoro" on the rows above. So are "block"
  // and "distraction", which is what somebody is actually looking for.
  { id: 'focusShield', groupId: 'tasksProjects', label: 'Block apps while focusing', section: 'Focus sessions',
    keywords: ['screen time', 'pomodoro', 'distraction', 'shield', 'social media', 'restrict'] },
  { id: 'focusShieldApps', groupId: 'tasksProjects', label: 'Apps to block', section: 'Focus sessions',
    keywords: ['screen time', 'distraction', 'which apps', 'picker', 'choose'] },
  { id: 'timerLiveActivity', groupId: 'tasksProjects', label: 'Live Activity while timing', section: 'Timers',
    keywords: ['lock screen', 'dynamic island', 'timer', 'stopwatch', 'cooking', 'recipe', 'countdown'] },
  { id: 'autoRemoveExpired', groupId: 'tasksProjects', label: 'Auto-remove expired tasks', section: 'Time-limited tasks',
    keywords: ['window', 'delete'], simple: true },
  { id: 'vacationMode', groupId: 'tasksProjects', label: 'Vacation mode', section: 'Vacation',
    keywords: ['holiday', 'pause', 'away', 'streaks'], simple: true },
  { id: 'vacationEnd', groupId: 'tasksProjects', label: 'End date', section: 'Vacation',
    keywords: ['vacation end', 'return'], simple: true },
  // The master switch for the groceries/recipes/meal plan area. Unflagged, and
  // has to stay that way — a row that hid itself when switched off would be a
  // setting with no way back, which is now also why it can't live in the
  // Groceries & meals group its rows moved to.
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
      'deadline', 'blocked', 'barcode', 'receipt', 'pantry', 'substitutes', 'cook mode',
      'recipe steps'] },
  // ── Automatic tasks ───────────────────────────────────────────────────────
  // Derived from GENERATED_KIND_LIST — see GENERATED_ENTRIES above for why, and
  // for why these rows' `section` names the generator rather than the header.
  ...GENERATED_ENTRIES,
  // The controls only one generator has, which the registry has no field for
  // and shouldn't grow one (see GeneratedTasksSection's `extrasFor`). Their
  // section is the generator's name for the reason the derived rows' is: four
  // rows read "Show the task", and the group title tells them apart from
  // nothing.
  // Sits above every generator rather than inside one: it decides when the
  // whole list gets a chance to run, not what any of them do.
  { id: 'backgroundRefreshEnabled', groupId: 'generated', label: 'Add tasks while the app is closed',
    section: 'Automatic tasks',
    keywords: ['background', 'background refresh', 'overnight', 'away', 'wake',
      'catch up', 'top up', 'widget', 'stale', 'battery'] },
  { id: 'mealSlotsEnabled', groupId: 'generated', label: 'Meals you eat', section: 'Meal tasks',
    keywords: ['breakfast', 'lunch', 'dinner', 'snack', 'skip', 'which ones'], kitchen: true },
  { id: 'groceryUseUpLeadDays', groupId: 'generated', label: 'Show the task', section: 'Use-up tasks for groceries',
    keywords: ['expiry', 'use by', 'days before', 'lead', 'warning', 'grocery'], kitchen: true },
  { id: 'mealShortfallLeadDays', groupId: 'generated', label: 'Show the task', section: 'Shopping tasks for planned meals',
    keywords: ['days before', 'lead', 'ahead', 'warning', 'shop', 'meal'], kitchen: true },
  { id: 'birthdayLeadDays', groupId: 'generated', label: 'Show the task', section: 'Birthday reminders',
    keywords: ['birthday', 'days before', 'lead', 'early', 'notice', 'warning'] },
  { id: 'weekendNudgeLeadDays', groupId: 'generated', label: 'Show the task', section: 'Nudge for an empty weekend',
    keywords: ['weekend', 'thursday', 'friday', 'days before', 'lead', 'early', 'notice', 'warning'] },
  { id: 'birthdayGiftLeadDays', groupId: 'generated', label: 'Show the task', section: 'Birthday gift reminders',
    keywords: ['birthday', 'gift', 'present', 'days before', 'lead', 'early', 'notice', 'warning'] },
  { id: 'mealPlanNudgeTime', groupId: 'generated', label: 'Nudge me on', section: 'Plan meals for the week',
    keywords: ['meal plan', 'weekday', 'day', 'time', 'when'], kitchen: true },
  { id: 'calendarReviewTimeSegment', groupId: 'generated', label: 'Show the task', section: 'Review tomorrow\'s calendar',
    keywords: ['morning', 'afternoon', 'evening', 'night', 'time of day', 'hold back', 'when'] },
  // Spans both use-up generators, so it sits below the loop rather than inside
  // either one's extras — and so its section can't be one generator's name.
  { id: 'useUpTaskCap', groupId: 'generated', label: 'Limit use-up tasks', section: 'Automatic tasks',
    keywords: ['cap', 'how many', 'most', 'too many', 'flood', 'expiry', 'leftovers'], kitchen: true },

  // `kitchen`-gated to match the row itself, which is hidden with the
  // groceries area: the only feature routed on-device today lives there, so a
  // result leading to a row that isn't rendered would be a dead end. The
  // keywords do the heavy lifting — nobody looking for this searches
  // "on-device".
  { id: 'onDeviceAiEnabled', groupId: 'privacyAi', label: 'Use Apple Intelligence',
    section: 'On-device suggestions', kitchen: true,
    keywords: ['on device', 'offline', 'no key', 'free', 'private', 'foundation models',
      'grocery', 'aisle', 'sort', 'siri'] },

  { id: 'productLookupEnabled', groupId: 'privacyAi', label: 'Look up scanned barcodes', section: 'Barcode lookups',
    keywords: ['upc', 'ean', 'gtin', 'open food facts', 'pantry', 'unpack', 'network', 'privacy'],
    kitchen: true, simple: true },
  { id: 'fdcApiKey', groupId: 'privacyAi', label: 'FoodData Central key', section: 'Barcode lookups',
    keywords: ['usda', 'api', 'barcode', 'scan', 'branded', 'nutrition'], kitchen: true, simple: true },
  { id: 'goUpcApiKey', groupId: 'privacyAi', label: 'Go-UPC key', section: 'Barcode lookups',
    keywords: ['api', 'barcode', 'scan', 'paid', 'fallback'], kitchen: true, simple: true },
  { id: 'clearGtinLookups', groupId: 'privacyAi', label: 'Forget saved barcodes', section: 'Barcode lookups',
    keywords: ['cache', 'clear', 'reset', 'wrong name', 'upc', 'gtin', 'scan again'], kitchen: true, simple: true },

  // ── Groceries & meals ─────────────────────────────────────────────────────
  // No `kitchen` flags below: the group itself is `kitchenOnly`, so the group
  // gate drops every one of these and flagging them again would be a second
  // copy of one answer. `simple` still applies — that's a different switch.
  { id: 'mealsOnToday', groupId: 'kitchen', label: 'Show the day\'s meals', section: 'Meals on Today',
    keywords: ['meal plan', 'dinner', 'menu', 'today', 'hide meals', 'leftovers', 'takeaway'] },
  { id: 'kitchenOnToday', groupId: 'kitchen', label: 'Show what needs using up', section: 'Meals on Today',
    keywords: ['fridge', 'kitchen', 'expiry', 'use by', 'spoil', 'waste', 'leftovers', 'pantry', 'today'],
    simple: true },
  { id: 'cookRecapEnabled', groupId: 'kitchen', label: 'Ask after cooking', section: 'Meals on Today',
    keywords: ['rate', 'rating', 'review', 'leftovers', 'used up', 'out of', 'sheet', 'prompt', 'cooked'] },
  { id: 'restockOfferEnabled', groupId: 'kitchen', label: 'Restock after cooking', section: 'Meals on Today',
    keywords: ['ingredients', 'shopping list', 'offer', 'buy again', 'cooked'] },
  { id: 'tripLiveActivity', groupId: 'kitchen', label: 'Live Activity while shopping', section: 'Shopping trip',
    keywords: ['lock screen', 'dynamic island', 'store', 'trip', 'grocery', 'elapsed', 'timer'],
    simple: true },
  { id: 'unitSystem', groupId: 'kitchen', label: 'Units', section: 'Recipe & grocery amounts',
    keywords: ['metric', 'imperial', 'convert', 'grams', 'ounces', 'pounds', 'cups', 'millilitres', 'measurement'] },
  { id: 'currencySymbol', groupId: 'kitchen', label: 'Currency', section: 'Recipe & grocery amounts',
    keywords: ['price', 'cost', 'money', 'symbol', 'dollar', 'pound', 'euro', 'yen', 'grocery'] },
  // The row is a count and a way in; the rules themselves live on the links.
  // Keyworded for what someone would actually type when a recipe surprised
  // them — "why does this say oat milk" is a search for the swap, not for the
  // word "substitute".
  { id: 'standingSwaps', groupId: 'kitchen', label: 'Standing swaps', section: 'Substitutes',
    keywords: ['substitute', 'instead of', 'always use', 'replace', 'oat milk', 'dairy',
      'allergy', 'recipe', 'grocery', 'automatic'],
    simple: true },

  // Privacy & AI
  { id: 'appLock', groupId: 'privacyAi', label: 'Require Face ID to open', section: 'App lock',
    keywords: ['touch id', 'biometric', 'lock', 'passcode', 'privacy', 'security'] },
  { id: 'appLockGrace', groupId: 'privacyAi', label: 'Lock again after', section: 'App lock',
    keywords: ['grace', 'timeout'] },
  { id: 'apiKey', groupId: 'privacyAi', label: 'Anthropic API key', section: 'AI suggestions',
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

/**
 * The groups to show right now, in order.
 *
 * `kitchenEnabled` defaults to true for the reason it does in
 * `visibleSettingsEntries`: a caller that doesn't care (a test, a platform
 * check) gets the whole list, the way it did before the setting existed.
 */
export function visibleSettingsGroups(platformOS: string, kitchenEnabled = true): SettingsGroup[] {
  return SETTINGS_GROUPS.filter(g =>
    (!g.iosOnly || platformOS === 'ios')
    && (!g.kitchenOnly || kitchenEnabled));
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
  const shown = new Set(visibleSettingsGroups(platformOS, kitchenEnabled).map(g => g.id));
  return SETTINGS_ENTRIES.filter(e =>
    shown.has(e.groupId)
    && (kitchenEnabled || !e.kitchen)
    && (!simpleMode || !e.simple));
}

export function settingsGroup(id: SettingsGroupId): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find(g => g.id === id);
}
