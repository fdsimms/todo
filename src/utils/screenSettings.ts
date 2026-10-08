import type { SettingsEntry } from './settingsIndex';

/**
 * The Settings rows that configure each screen's own feature, so a screen can
 * offer them where the feature is instead of leaving them to be found by
 * browsing Settings (`ScreenSettingsSheet`, opened from the screen's gear).
 *
 * Settings was reachable only from the menu's footer, and only the Weight
 * screen linked into it, so "where do I turn this on" meant knowing which of
 * thirteen groups to open. The rows are named here rather than derived,
 * because which settings belong to which screen is a judgment the index has
 * no field for, and two or three that really belong beat a long list of
 * everything that mentions the word.
 *
 * **Only rows that always render go here.** A row behind a parent toggle
 * (`SettingsEntry.requires`) isn't on the page while that toggle is off, so a
 * jump to it would land on nothing; name the parent instead.
 * `screenSettings.test.ts` holds the list to that, and to every id existing.
 */
export const SCREEN_SETTINGS: Readonly<Record<string, readonly string[]>> = {
  Today: ['newTaskDestination', 'mealsOnToday', 'calendarRead'],
  Projects: ['autoCompleteProjects', 'hideListPreviews', 'hideNextStep', 'defaultProjectNudgeCadence', 'gen:projectReview'],
  Calendar: ['calendarRead', 'deadlineCalendar', 'completionCalendar', 'claudeCalendar'],
  Reminders: ['defaultReminderLead', 'quietHours', 'notifPermission'],
  Stuck: ['postponeCheck', 'gen:waitingFollowUp'],
  Groceries: ['groceryImport', 'tripLiveActivity', 'ai:groceryAisles'],
  Recipes: ['unitSystem', 'householdServings', 'ai:recipeExtraction'],
  MealPlan: ['gen:mealPlanNudge', 'mealCalendar', 'householdServings'],
  Kitchen: ['gen:pantryCheck', 'gen:pantryReview', 'gen:groceryUseUp'],
  FoodLog: ['nutritionTargets', 'mealLogPrompt', 'healthWrite'],
  Mood: ['gen:moodLog', 'gen:moodNudge'],
  Weight: ['weightGoal', 'weightUnit', 'healthRead'],
  Sleep: ['sleepGoal', 'healthRead'],
  Logbook: ['retention', 'completionCalendar'],
  Stats: ['weekStartsOn'],
  UnattendedLog: ['backgroundRefreshEnabled', 'retention'],
  People: ['gen:birthday', 'gen:reachOut'],
  Categories: ['hideCategories', 'newTaskCategory'],
  Templates: ['ai:templateSuggestions'],
  Tips: ['tipsEnabled'],
};

/**
 * One screen's settings rows that are on show right now, in the order above.
 * `visible` is `visibleSettingsEntries(...)`, so a kitchen row with the
 * kitchen off, or a simplified-mode row in simplified mode, isn't offered.
 * Empty means the screen shows no gear.
 */
export function screenSettingsEntries(route: string, visible: readonly SettingsEntry[]): SettingsEntry[] {
  const ids = SCREEN_SETTINGS[route];
  if (!ids) return [];
  const byId = new Map(visible.map(e => [e.id, e]));
  return ids.map(id => byId.get(id)).filter((e): e is SettingsEntry => e !== undefined);
}
