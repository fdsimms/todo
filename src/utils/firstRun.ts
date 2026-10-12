/**
 * The three questions the app asks the first time it opens, and when it does.
 *
 * A new install otherwise lands on a full app: about thirty destinations, the
 * groceries and meals area on, and no notification permission asked for
 * anywhere but a Settings group nobody has a reason to open yet. Each of those
 * is a choice a person can make in a few seconds, so they are asked once,
 * together, and every answer is changeable later in Settings (the sheet is
 * also reachable from Feature areas).
 *
 * This answers nothing on the person's behalf: skipping leaves every default
 * exactly as it was, and a person who has data or sync already is never asked.
 */

export interface FirstRunAnswers {
  /** Show the groceries, recipes and meal plan area (`kitchenEnabled`). */
  groceriesAndMeals: boolean;
  /** Hide the advanced features (`simpleMode`). */
  keepItSimple: boolean;
  /** Ask the system for notification permission on Done. */
  reminders: boolean;
}

/** The answers the sheet opens on. They match the settings' own defaults, so Skip changes nothing. */
export const FIRST_RUN_DEFAULTS: FirstRunAnswers = {
  groceriesAndMeals: true,
  keepItSimple: false,
  reminders: true,
};

/** The two settings the answers write. The third is a permission, not a setting. */
export function firstRunSettings(a: FirstRunAnswers): { kitchenEnabled: boolean; simpleMode: boolean } {
  return { kitchenEnabled: a.groceriesAndMeals, simpleMode: a.keepItSimple };
}

export interface FirstRunState {
  /** Answered or skipped once already, on this device. */
  done: boolean;
  /** Settings and tasks have both finished loading: mid-load every install looks empty. */
  loaded: boolean;
  /** Every task row, completed and archived included. */
  taskCount: number;
  /** Cloud sync is on, so this is not a first run: the other device's data is on its way. */
  syncEnabled: boolean;
  /** Demo mode swaps in a seeded database, which is the opposite of a new install. */
  demoActive: boolean;
}

/** Whether to put the sheet up now. All of these must hold, so a doubt means no sheet. */
export function shouldOfferFirstRun(s: FirstRunState): boolean {
  return !s.done && s.loaded && s.taskCount === 0 && !s.syncEnabled && !s.demoActive;
}
