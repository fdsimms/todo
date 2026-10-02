import {
  UNATTENDED_ACTION_SPECS,
  describeUnattendedEntry,
  filterUnattended,
  unattendedDayLabel,
  unattendedDays,
  unattendedIcon,
  unattendedKinds,
  unattendedSource,
  unattendedSummary,
} from '../utils/unattendedLedger';
import { GENERATED_KIND_SPECS } from '../utils/generatedTasks';
import type { UnattendedEntry } from '../types';

/** A local wall-clock time as the ISO instant the app stores, so the suite reads the same in any zone. */
const localIso = (local: string) => new Date(local).toISOString();

// dateUtils reads dayResetTime off the settings store, which reaches
// expo-sqlite. Mocked the same way retention.test.ts does, and for the same
// reason: these rules are pure and there is no database to stand up for them.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: jest.fn(() => ({ dayResetTime: '00:00' })) },
}));

function entry(overrides: Partial<UnattendedEntry> = {}): UnattendedEntry {
  return {
    id: 'e1',
    at: localIso('2026-09-15T06:12'),
    action: 'created',
    kind: 'birthday',
    title: 'Get a card for Ada',
    taskId: 't1',
    count: 1,
    ...overrides,
  };
}

describe('UNATTENDED_ACTION_SPECS', () => {
  it('reads in the past tense, because every row is finished business', () => {
    // A present-tense label would read as a rule still running rather than as
    // something that happened at 06:12 this morning.
    for (const spec of Object.values(UNATTENDED_ACTION_SPECS)) {
      expect(spec.verb).toMatch(/ed$/);
    }
  });

  it('marks exactly one action as adding work', () => {
    const adding = Object.values(UNATTENDED_ACTION_SPECS).filter(s => s.adds);
    expect(adding.map(s => s.action)).toEqual(['created']);
  });
});

describe('unattendedIcon', () => {
  it('uses the generator’s own glyph, so a row matches its Settings row', () => {
    expect(unattendedIcon(entry())).toBe(GENERATED_KIND_SPECS.birthday.icon);
  });

  it('falls back to the action’s glyph for the two sweeps, which have no generator', () => {
    expect(unattendedIcon(entry({ kind: null, action: 'purged' })))
      .toBe(UNATTENDED_ACTION_SPECS.purged.icon);
  });
});

describe('unattendedSource', () => {
  it('names the generator in the words Settings uses for its switch', () => {
    // So somebody who wants a row to stop has the name of the row to look for.
    expect(unattendedSource(entry())).toBe(GENERATED_KIND_SPECS.birthday.label);
  });

  it('names the two sweeps rather than leaving them blank', () => {
    // "The app deleted this" with no attribution is the unaccountability this
    // whole feature exists to end.
    expect(unattendedSource(entry({ kind: null, action: 'expired' }))).toBe('Expired task sweep');
    expect(unattendedSource(entry({ kind: null, action: 'purged' }))).toBe('Completed task cleanup');
  });
});

describe('describeUnattendedEntry', () => {
  it('names the source for a row about one task', () => {
    expect(describeUnattendedEntry(entry())).toBe(GENERATED_KIND_SPECS.birthday.label);
  });

  it('reports a purge’s count, since it took a set rather than a task', () => {
    expect(describeUnattendedEntry(entry({ kind: null, action: 'purged', title: '', taskId: null, count: 40 })))
      .toBe('Completed task cleanup removed 40 completed tasks');
  });

  it('gets the singular right', () => {
    expect(describeUnattendedEntry(entry({ kind: null, action: 'purged', title: '', taskId: null, count: 1 })))
      .toBe('Completed task cleanup removed 1 completed task');
  });
});

describe('unattendedDays', () => {
  it('groups by day, newest day first and newest entry first within it', () => {
    const days = unattendedDays([
      entry({ id: 'a', at: localIso('2026-09-14T08:00') }),
      entry({ id: 'b', at: localIso('2026-09-15T06:00') }),
      entry({ id: 'c', at: localIso('2026-09-15T09:00') }),
    ]);
    expect(days.map(d => d.dayKey)).toEqual(['2026-09-15', '2026-09-14']);
    expect(days[0].entries.map(e => e.id)).toEqual(['c', 'b']);
  });

  it('files an early-morning pass under the logical day whose work it was', () => {
    // 01:30 with a 02:00 reset is still yesterday — the day the catch-up was
    // catching up on. Same anchoring as every other day-keyed read in the app.
    const days = unattendedDays([entry({ at: '2026-09-15T01:30:00' })], '02:00');
    expect(days[0].dayKey).toBe('2026-09-14');
  });

  it('is empty for an empty ledger', () => {
    expect(unattendedDays([])).toEqual([]);
  });
});

describe('unattendedDayLabel', () => {
  const now = new Date('2026-09-15T10:00:00');

  it('looks backwards, where the Later list’s own header looks forwards', () => {
    expect(unattendedDayLabel('2026-09-15', now)).toBe('Today · Sep 15');
    expect(unattendedDayLabel('2026-09-14', now)).toBe('Yesterday · Sep 14');
  });

  it('names the weekday inside the last week', () => {
    expect(unattendedDayLabel('2026-09-11', now)).toBe('Friday · Sep 11');
  });

  it('keeps a date per day past that rather than batching into a month', () => {
    // The ledger is bounded to 90 days, so there is no runaway header count to
    // protect against, and a month header would hide which day a moment fell on.
    expect(unattendedDayLabel('2026-08-02', now)).toBe('Aug 2');
  });

  it('adds the year when it differs', () => {
    expect(unattendedDayLabel('2025-12-30', now)).toBe('Dec 30, 2025');
  });
});

describe('unattendedSummary', () => {
  it('counts rows accounted for, not entries', () => {
    // The one purge row that took 40 tombstones reports 40. Reporting 1 would
    // understate the only pass here that deletes in bulk.
    expect(unattendedSummary([
      entry({ id: 'a' }),
      entry({ id: 'b', action: 'purged', kind: null, count: 40 }),
    ])).toBe('1 added, 40 removed');
  });

  it('names only the side that happened', () => {
    expect(unattendedSummary([entry()])).toBe('1 added');
    expect(unattendedSummary([entry({ action: 'cleared' })])).toBe('1 removed');
  });

  it('says so when there is nothing', () => {
    expect(unattendedSummary([])).toBe('Nothing yet');
  });
});

describe('unattendedKinds', () => {
  it('lists each generator once', () => {
    expect(unattendedKinds([
      entry({ id: 'a', kind: 'birthday' }),
      entry({ id: 'b', kind: 'weather' }),
      entry({ id: 'c', kind: 'birthday' }),
    ])).toEqual(['birthday', 'weather']);
  });

  it('skips the sweeps, which have no kind to offer as a filter', () => {
    expect(unattendedKinds([entry({ kind: null, action: 'purged' })])).toEqual([]);
  });
});

describe('filterUnattended', () => {
  const entries = [entry({ id: 'a', kind: 'birthday' }), entry({ id: 'b', kind: 'weather' })];

  it('narrows to one generator', () => {
    expect(filterUnattended(entries, 'weather').map(e => e.id)).toEqual(['b']);
  });

  it('treats null as no filter rather than as "the ones with no kind"', () => {
    // A filter offering "nothing" as a choice reads as a bug.
    expect(filterUnattended(entries, null).map(e => e.id)).toEqual(['a', 'b']);
  });
});
