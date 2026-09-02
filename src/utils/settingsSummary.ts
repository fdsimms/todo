import { formatHHMM } from './clockTime';
import type { SettingsGroupId } from './settingsIndex';
import { expiredTaskGraceLabel, type ExpiredTaskGraceDays } from './expiredTaskGrace';

/**
 * Everything the index needs to describe a group in one line.
 *
 * Deliberately all synchronous settings state and nothing else. The obvious
 * omission is permission status — "Allowed · Daily agenda off" would be a
 * better line than "Daily agenda off" — but reading it means the three async
 * permission probes (notifications, Reminders, app lock) run on the index,
 * whether or not you open any of those groups. Splitting the screen is what
 * got rid of that; putting it back for a subtitle isn't worth it. Surfacing a
 * *denied* permission on the index is worth doing, and wants its own signal
 * rather than a summary line.
 */
export interface SettingsSummaryInput {
  themeMode: string;
  fontLabel: string;
  hapticsEnabled: boolean;
  morningStart: string;
  use24HourTime: boolean;
  weekStartsOn: 0 | 1;
  dailyAgendaEnabled: boolean;
  remindersImportEnabled: boolean;
  groceryImportEnabled: boolean;
  /**
   * Whether the groceries/recipes/meal plan area is shown at all. The grocery
   * import doesn't run without it, so the Capture line must not claim it does
   * — the setting is deliberately left switched on underneath (it resumes when
   * the area comes back), which is exactly why this can't be read off
   * `groceryImportEnabled` alone.
   */
  kitchenEnabled: boolean;
  calendarReadEnabled: boolean;
  /**
   * Read alongside the switch rather than trusting it, and the count is the
   * summary's whole content anyway. The two can disagree: an unreadable
   * `calendarIds` row parses to none picked while the switch stays on, and a
   * line claiming the app is reading calendars when it is reading nothing is
   * the one thing this summary must not say.
   */
  calendarIds: string[];
  healthReadEnabled: boolean;
  simpleMode: boolean;
  /**
   * How many generators are switched on, and how many are on offer — from
   * `generatedTaskCounts`, so this line and the rows behind it count the same
   * list. Resolved by the caller for the reason `retentionLabel` is: it keeps
   * this module clear of anything that reaches the settings store.
   */
  generatedOn: number;
  generatedTotal: number;
  /** Whether the day's meals show as rows on Today. */
  mealsOnToday: boolean;
  /** Already-rendered, like `fontLabel` — null when amounts show as written. */
  unitSystemLabel: string | null;
  vacationMode: boolean;
  autoRemoveExpiredTasks: ExpiredTaskGraceDays;
  autoCompleteProjectsOnDone: boolean;
  appLockEnabled: boolean;
  hasApiKey: boolean;
  /**
   * Already-rendered, like `fontLabel` — null means forever. Resolved by the
   * caller so this module stays free of `retention.ts`, which reaches the
   * settings store and so `expo-sqlite`, which can't load under Jest.
   */
  retentionLabel: string | null;
  demoActive: boolean;
  appVersion: string;
}

const THEME_LABELS: Record<string, string> = {
  dark: 'Dark',
  light: 'Light',
  darkPurple: 'Purple',
  system: 'System',
};

/** Joins the parts that are worth saying, dropping the ones that aren't. */
function line(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ');
}

/**
 * The one-line state under each group on the index.
 *
 * The bias is toward naming what's *on*, since a list of eight "Off"s reads as
 * broken rather than as default. A group with nothing switched on says what it
 * covers instead.
 */
export function settingsSummaries(s: SettingsSummaryInput): Record<SettingsGroupId, string> {
  return {
    appearance: line(
      THEME_LABELS[s.themeMode] ?? 'Dark',
      s.fontLabel,
      !s.hapticsEnabled && 'No haptics',
    ),

    // Only the non-default halves of the format pair get a mention: naming
    // both pushed this line onto a second row, which made one index row taller
    // than the other seven for the sake of restating a default.
    dayTime: line(
      `Day starts ${formatHHMM(s.morningStart, s.use24HourTime)}`,
      s.use24HourTime && '24-hour',
      s.weekStartsOn === 1 && 'Weeks from Monday',
    ),

    notifications: s.dailyAgendaEnabled ? 'Daily agenda on' : 'Reminders only',

    capture: line(
      s.remindersImportEnabled && 'Importing from Apple Reminders',
      s.groceryImportEnabled && s.kitchenEnabled && 'Groceries from Apple Reminders',
      s.calendarReadEnabled && s.calendarIds.length > 0 && (
        s.calendarIds.length === 1 ? 'Reading 1 calendar' : `Reading ${s.calendarIds.length} calendars`
      ),
    ) || 'Off. Say “Hey Siri, remind me to…”',

    tasksProjects: line(
      // Leads, because it changes what the rest of the group even contains —
      // several of the things named below aren't rows any more once it's on.
      s.simpleMode && 'Simplified mode on',
      s.vacationMode && 'Vacation on',
      s.autoRemoveExpiredTasks !== null && (
        s.autoRemoveExpiredTasks === 0
          ? 'Expired tasks removed immediately'
          : `Expired tasks removed after ${expiredTaskGraceLabel(s.autoRemoveExpiredTasks).toLowerCase()}`
      ),
      s.autoCompleteProjectsOnDone && 'Projects auto-complete',
    ) || 'Vacation, expiry, auto-complete',

    // A count rather than a list of names: twelve generators won't fit on a
    // line, and "how much of this is the app writing for me" is the question
    // the group exists to answer. Both halves come from `generatedTaskCounts`,
    // so the total shrinks with the kitchen exactly as the rows behind it do.
    generated: s.generatedOn === 0
      ? `Nothing. ${s.generatedTotal} available`
      : `${s.generatedOn} of ${s.generatedTotal} on`,

    // The switch alone, with no reading named beside it. The number this group
    // shows is a step count that changes by the minute and is often absent
    // altogether, and a summary line that said "4,120 steps" would be stale on
    // the index before it was read — or, worse, would say "No steps" at the one
    // moment it means "Health isn't sharing", which is the confusion the rows
    // themselves are written to avoid.
    health: s.healthReadEnabled ? 'Reading steps' : 'Off. Nothing is read from Health',

    kitchen: line(
      s.mealsOnToday && 'Meals on Today',
      s.unitSystemLabel,
    ) || 'Meals on Today, amounts, swaps',

    privacyAi: line(
      s.appLockEnabled && 'App lock on',
      s.hasApiKey && 'API key set',
    ) || 'App lock, AI suggestions',

    dataReset: line(
      s.retentionLabel === null
        ? 'History kept forever'
        : `History kept ${s.retentionLabel.toLowerCase()}`,
      s.demoActive && 'Demo mode on',
    ),

    about: s.appVersion,
  };
}
