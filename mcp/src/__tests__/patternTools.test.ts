/**
 * The pattern reads against a real database, because what they are is a
 * composition of the app's own readers (rhythms, calibration, mood insights)
 * and a stub would test nothing but the stub. The readers' own rules are
 * tested where they live; this checks the composition holds them: the floor
 * below which nothing is said, no coefficient in the output, and a habit's
 * history gathered across its occurrences.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { habitPatterns, moodInsights } from '../patternTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

/** A local instant `daysAgo` days back at `hour`, as stored. */
function at(daysAgo: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function dayKey(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function task(row: { id: string; title: string; completedAt?: string; recurrence?: string; segment?: string; streak?: number; streakDate?: string; previous?: string }): void {
  mockRaw.runSync(
    'INSERT INTO tasks (id, title, created_at, completed, completed_at, recurrence_type, time_of_day, streak_count, streak_date, previous_occurrence_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [
      row.id, row.title, at(60, 9), row.completedAt ? 1 : 0, row.completedAt ?? null, row.recurrence ?? 'daily',
      row.segment ? JSON.stringify([row.segment]) : null, row.streak ?? 0, row.streakDate ?? null, row.previous ?? null,
    ]
  );
}

function mood(daysAgo: number, value: number, tags: string[] = []): void {
  mockRaw.runSync(
    'INSERT INTO mood_logs (id, logged_at, day_key, mood, symptoms, context_tags) VALUES (?,?,?,?,?,?)',
    [`m${daysAgo}`, at(daysAgo, 20), dayKey(daysAgo), value, '[]', JSON.stringify(tags)]
  );
}

let replica: ReturnType<typeof openReplica>;

beforeAll(() => {
  replica = openReplica(':memory:');
});

beforeEach(() => {
  mockRaw.runSync('DELETE FROM tasks');
  mockRaw.runSync('DELETE FROM mood_logs');
  replica.refresh();
});

describe('habitPatterns', () => {
  it('gathers a habit across its occurrences, with its rhythm and a time of day it is not done in', () => {
    // An evening habit, done at 8am on six of the last twelve days.
    for (let i = 1; i <= 12; i += 2) task({ id: `s${i}`, title: 'Stretch', completedAt: at(i, 8), segment: 'evening' });
    task({ id: 'live', title: 'Stretch', segment: 'evening', streak: 3, streakDate: at(1, 0) });
    task({ id: 'once', title: 'Return library book', recurrence: 'none' });
    replica.refresh();

    const result = habitPatterns(replica);
    expect(result.habits.map(h => h.id)).toEqual(['live']);
    const stretch = result.habits[0];
    expect(stretch).toMatchObject({ title: 'Stretch', completed: 6, missed: 0, streak: { count: 3, asOf: dayKey(1) } });
    expect(stretch.rhythm?.peakPartOfDay).toBe('morning');
    expect(stretch.timeOfDayMismatch).toMatchObject({ setTo: 'evening', doneIn: 'morning' });
    expect(result.overall.rhythm?.completions).toBe(6);
    // No timed pairs, so nothing is claimed about estimates.
    expect(result.overall.estimates).toBeNull();
  });

  it('says nothing about a rhythm drawn from too few completions', () => {
    task({ id: 'a', title: 'Floss', completedAt: at(1, 22) });
    task({ id: 'live', title: 'Floss' });
    replica.refresh();
    const [floss] = habitPatterns(replica).habits;
    expect(floss.completed).toBe(1);
    expect(floss.rhythm).toBeUndefined();
  });
});

describe('moodInsights', () => {
  it('holds back a comparison below the floor, and says how far off it is', () => {
    mood(1, 4);
    mood(2, 3);
    replica.refresh();
    const result = moodInsights(replica);
    expect(result.summary.loggedDays).toBe(2);
    expect(result.moodAndCompletions).toEqual({ days: 2, note: expect.stringMatching(/2 of the 10 days/) });
    expect(result.byRepeatingTask).toEqual([]);
  });

  it('compares the days a repeating task was done against the rest, as a direction and never a coefficient', () => {
    // Fourteen days: a walk on the even ones, which are the good days. Each
    // occurrence points back at the one before, as completing spawns them.
    for (let i = 0; i < 14; i++) {
      if (i % 2 === 0) task({ id: `w${i}`, title: 'Walk', completedAt: at(i, 9), previous: i < 12 ? `w${i + 2}` : undefined });
      mood(i, i % 2 === 0 ? 4 : 2, i % 2 === 0 ? [] : ['Deadline']);
    }
    replica.refresh();

    const result = moodInsights(replica);
    expect(result.byRepeatingTask[0]).toMatchObject({ label: 'Walk', daysWith: 7, daysWithout: 7, moodWith: 4, moodWithout: 2 });
    expect(result.byContextTag[0]).toMatchObject({ label: 'Deadline', moodWith: 2, moodWithout: 4 });
    expect(result.moodAndCompletions).toMatchObject({ days: 14, direction: 'more done on better days', strength: 'strong' });
    expect(JSON.stringify(result)).not.toMatch(/"r":/);
    expect(result.rules.join(' ')).toMatch(/never causes/);
  });

  it('dates a milestone by the local day it was placed on, not the UTC date of its instant', () => {
    mockRaw.runSync('INSERT INTO milestones (id, label, date, created_at) VALUES (?,?,?,?)', ['ms', 'New job', at(3, 12), at(3, 12)]);
    replica.refresh();
    const [milestone] = moodInsights(replica).milestones;
    expect(milestone).toMatchObject({ label: 'New job', date: dayKey(3) });
  });
});
