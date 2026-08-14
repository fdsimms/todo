import { settingsSummaries, type SettingsSummaryInput } from '../utils/settingsSummary';
import { SETTINGS_GROUPS } from '../utils/settingsIndex';

const defaults: SettingsSummaryInput = {
  themeMode: 'dark',
  fontLabel: 'System',
  hapticsEnabled: true,
  morningStart: '06:00',
  use24HourTime: false,
  weekStartsOn: 0,
  dailyAgendaEnabled: false,
  remindersImportEnabled: false,
  groceryImportEnabled: false,
  kitchenEnabled: true,
  calendarReadEnabled: false,
  calendarIds: [],
  vacationMode: false,
  autoRemoveExpiredTasks: null,
  autoArchiveProjectsOnComplete: false,
  appLockEnabled: false,
  hasApiKey: false,
  retentionLabel: null,
  demoActive: false,
  appVersion: '1.0.0 (214)',
};

const summarise = (over: Partial<SettingsSummaryInput> = {}) =>
  settingsSummaries({ ...defaults, ...over });

describe('settingsSummaries', () => {
  it('describes every group', () => {
    const summaries = summarise();
    for (const group of SETTINGS_GROUPS) {
      expect(summaries[group.id].trim()).not.toBe('');
    }
  });

  describe('appearance', () => {
    it('names the theme and the typeface', () => {
      expect(summarise().appearance).toBe('Dark · System');
    });

    it('mentions haptics only when they are off', () => {
      expect(summarise().appearance).not.toContain('haptics');
      expect(summarise({ hapticsEnabled: false }).appearance).toBe('Dark · System · No haptics');
    });

    it('falls back to Dark for an unrecognised theme', () => {
      expect(summarise({ themeMode: 'nonsense' }).appearance).toContain('Dark');
    });

    it('names the purple theme', () => {
      expect(summarise({ themeMode: 'darkPurple' }).appearance).toContain('Purple');
    });
  });

  describe('dayTime', () => {
    it('says only the day start when the formats are default', () => {
      expect(summarise().dayTime).toBe('Day starts 6:00 AM');
    });

    it('honours the 24-hour setting', () => {
      const line = summarise({ use24HourTime: true, morningStart: '02:00' }).dayTime;
      expect(line).toContain('Day starts 02:00');
      expect(line).toContain('24-hour');
    });

    it('names the week start only when it is Monday', () => {
      expect(summarise().dayTime).not.toContain('Weeks from');
      expect(summarise({ weekStartsOn: 1 }).dayTime).toContain('Weeks from Monday');
    });
  });

  describe('groups with nothing switched on', () => {
    // Eight lines all reading "Off" makes a screen look broken rather than
    // default, so a quiet group says what it covers instead.
    it('says what tasks & projects covers', () => {
      expect(summarise().tasksProjects).toBe('Vacation, expiry, auto-archive');
    });

    it('says what privacy & AI covers', () => {
      expect(summarise().privacyAi).toBe('App lock, AI suggestions');
    });

    it('switches to naming what is on', () => {
      expect(summarise({ vacationMode: true }).tasksProjects).toBe('Vacation on');
      expect(summarise({ vacationMode: true, autoRemoveExpiredTasks: 0 }).tasksProjects)
        .toBe('Vacation on · Expired tasks removed immediately');
      expect(summarise({ vacationMode: true, autoRemoveExpiredTasks: 7 }).tasksProjects)
        .toBe('Vacation on · Expired tasks removed after 7 days');
      expect(summarise({ appLockEnabled: true, hasApiKey: true }).privacyAi)
        .toBe('App lock on · API key set');
    });
  });

  describe('dataReset', () => {
    it('reports the default retention as forever', () => {
      expect(summarise().dataReset).toBe('History kept forever');
    });

    it('names a chosen window', () => {
      expect(summarise({ retentionLabel: '1 year' }).dataReset).toContain('History kept');
      expect(summarise({ retentionLabel: '1 year' }).dataReset).not.toContain('forever');
    });

    it('flags demo mode, which disables the backup rows inside', () => {
      expect(summarise({ demoActive: true }).dataReset).toContain('Demo mode on');
    });
  });

  it('reports the version for About', () => {
    expect(summarise().about).toBe('1.0.0 (214)');
  });

  it('reports the notification and capture state', () => {
    expect(summarise().notifications).toBe('Reminders only');
    expect(summarise({ dailyAgendaEnabled: true }).notifications).toBe('Daily agenda on');
    expect(summarise({ remindersImportEnabled: true }).capture).toContain('Importing');
    expect(summarise({ groceryImportEnabled: true }).capture).toContain('Groceries');
  });

  it('stops claiming the grocery import once the groceries area is off', () => {
    // groceryImportEnabled stays true underneath — the area being off is what
    // stops the drain, and the import resumes untouched when it comes back.
    // Reading the flag alone would advertise an import that isn't running.
    const off = summarise({ groceryImportEnabled: true, kitchenEnabled: false });
    expect(off.capture).not.toContain('Groceries');
    expect(off.capture).toBe('Off. Say “Hey Siri, remind me to…”');
  });

  it('leaves the Inbox half of the capture line alone', () => {
    const off = summarise({
      remindersImportEnabled: true, groceryImportEnabled: true, kitchenEnabled: false,
    });
    expect(off.capture).toContain('Importing from Apple Reminders');
    expect(off.capture).not.toContain('Groceries');
  });

  it('counts the calendars being read', () => {
    expect(summarise({ calendarReadEnabled: true, calendarIds: ['a'] }).capture)
      .toContain('Reading 1 calendar');
    expect(summarise({ calendarReadEnabled: true, calendarIds: ['a', 'b'] }).capture)
      .toContain('Reading 2 calendars');
  });

  it('says nothing about calendars when the switch is on but none is picked', () => {
    // The two can disagree — an unreadable calendarIds row parses to none —
    // and claiming a read that isn't happening is the failure to avoid.
    const none = summarise({ calendarReadEnabled: true, calendarIds: [] });
    expect(none.capture).not.toContain('Reading');
    expect(none.capture).toBe('Off. Say “Hey Siri, remind me to…”');
  });
});
