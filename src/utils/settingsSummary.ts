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
  vacationMode: boolean;
  autoRemoveExpiredTasks: ExpiredTaskGraceDays;
  autoArchiveProjectsOnComplete: boolean;
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
      s.groceryImportEnabled && 'Groceries from Apple Reminders',
    ) || 'Off — say “Hey Siri, remind me to…”',

    tasksProjects: line(
      s.vacationMode && 'Vacation on',
      s.autoRemoveExpiredTasks !== null && (
        s.autoRemoveExpiredTasks === 0
          ? 'Expired tasks removed immediately'
          : `Expired tasks removed after ${expiredTaskGraceLabel(s.autoRemoveExpiredTasks).toLowerCase()}`
      ),
      s.autoArchiveProjectsOnComplete && 'Projects auto-archive',
    ) || 'Vacation, expiry, auto-archive',

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
