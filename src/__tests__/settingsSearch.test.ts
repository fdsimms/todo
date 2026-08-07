import { searchSettings } from '../utils/settingsSearch';
import { SETTINGS_ENTRIES, type SettingsEntry } from '../utils/settingsIndex';

const entries: SettingsEntry[] = [
  { id: 'vacationMode', groupId: 'tasksProjects', label: 'Vacation mode', section: 'Vacation',
    keywords: ['holiday', 'streaks'] },
  { id: 'dayReset', groupId: 'dayTime', label: 'Morning', section: 'When the day turns over',
    keywords: ['streaks', 'day start'] },
  { id: 'haptics', groupId: 'appearance', label: 'Haptic feedback', section: 'Feedback' },
];

const ids = (q: string, from: SettingsEntry[] = entries) =>
  searchSettings(from, q).map(r => r.entry.id);

describe('searchSettings', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(searchSettings(entries, '')).toEqual([]);
    expect(searchSettings(entries, '   ')).toEqual([]);
  });

  it('matches on the label', () => {
    expect(ids('vacation')).toEqual(['vacationMode']);
  });

  it('is case-insensitive', () => {
    expect(ids('VACATION')).toEqual(['vacationMode']);
    expect(ids('Morning')).toEqual(['dayReset']);
  });

  it('matches on a keyword the label does not contain', () => {
    expect(ids('holiday')).toEqual(['vacationMode']);
  });

  it('matches on the section name', () => {
    expect(ids('feedback')).toEqual(['haptics']);
  });

  it('finds every row a keyword spans', () => {
    expect(ids('streaks').sort()).toEqual(['dayReset', 'vacationMode']);
  });

  it('requires every term to match something', () => {
    // "vacation" hits, "zzz" doesn't — so the row drops out entirely.
    expect(ids('vacation zzz')).toEqual([]);
  });

  it('lets separate terms match different fields of one entry', () => {
    expect(ids('vacation holiday')).toEqual(['vacationMode']);
  });

  it('returns no match for a query nothing contains', () => {
    expect(ids('kubernetes')).toEqual([]);
  });

  describe('ranges', () => {
    it('aligns to the matched substring of the label', () => {
      const [result] = searchSettings(entries, 'mode');
      expect(result.entry.id).toBe('vacationMode');
      expect(result.labelRanges).toEqual([[9, 13]]);
      expect('Vacation mode'.slice(9, 13)).toBe('mode');
    });

    it('is empty when only a keyword matched', () => {
      const [result] = searchSettings(entries, 'holiday');
      expect(result.labelRanges).toEqual([]);
    });

    it('merges overlapping ranges from two terms', () => {
      // "hapt" and "haptic" both match from index 0; unmerged, HighlightedText
      // would emit the shared span twice.
      const [result] = searchSettings(entries, 'hapt haptic');
      expect(result.labelRanges).toEqual([[0, 6]]);
    });

    it('finds a term repeated in one label', () => {
      const repeated: SettingsEntry[] = [
        { id: 'x', groupId: 'about', label: 'Reset all reset', section: 'Reset' },
      ];
      const [result] = searchSettings(repeated, 'reset');
      expect(result.labelRanges).toEqual([[0, 5], [10, 15]]);
    });
  });

  describe('matchedVia', () => {
    it('names the keyword when the label did not match', () => {
      const [result] = searchSettings(entries, 'holiday');
      expect(result.matchedVia).toBe('holiday');
    });

    it('is null when the label matched', () => {
      const [result] = searchSettings(entries, 'vacation');
      expect(result.matchedVia).toBeNull();
    });
  });

  describe('ranking', () => {
    it('puts a label match above a keyword-only match', () => {
      expect(ids('streaks')[0]).toBe('vacationMode');
      const scored = searchSettings(entries, 'morning streaks');
      expect(scored[0].entry.id).toBe('dayReset');
    });

    it('puts a label-prefix match above a mid-label one', () => {
      const both: SettingsEntry[] = [
        { id: 'mid', groupId: 'about', label: 'Auto time', section: 'A' },
        { id: 'start', groupId: 'about', label: 'Time zone', section: 'A' },
      ];
      expect(searchSettings(both, 'time')[0].entry.id).toBe('start');
    });
  });

  describe('against the real registry', () => {
    it('finds the day-start row by what people call it', () => {
      expect(ids('day start', SETTINGS_ENTRIES)).toContain('dayReset');
    });

    it('finds the import row from "siri"', () => {
      expect(ids('siri', SETTINGS_ENTRIES)).toContain('remindersImport');
    });

    it('finds the app lock from "touch id"', () => {
      expect(ids('touch id', SETTINGS_ENTRIES)).toContain('appLock');
    });

    it('gathers every streak-related row under one query', () => {
      const hits = ids('streak', SETTINGS_ENTRIES);
      expect(hits).toEqual(expect.arrayContaining(['resetStreaks', 'vacationMode', 'dayReset']));
    });
  });
});
