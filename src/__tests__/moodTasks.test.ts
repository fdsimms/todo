import {
  DEFAULT_MOOD_NUDGE_AFTER_DAYS,
  lowMoodDeloadNote,
  MOOD_LOG_TITLE,
  MOOD_NUDGE_COOLDOWN_DAYS,
  MOOD_NUDGE_TITLE,
  daysBetweenKeys,
  moodLogDayKey,
  moodNudgeDayKey,
  moodNudgeNotes,
  wantsMoodNudge,
} from '../utils/moodTasks';
import type { MoodDay } from '../utils/moodInsights';
import type { Task } from '../types';

const days = (moods: (number | null)[]): MoodDay[] =>
  moods.map((mood, i) => ({
    dayKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
    mood,
    symptomKeys: [],
    completed: 0,
    categories: [],
  }));

const generated = (kind: string, sourceId: string): Pick<Task, 'generatedKind' | 'generatedSourceId'> =>
  ({ generatedKind: kind, generatedSourceId: sourceId } as Pick<Task, 'generatedKind' | 'generatedSourceId'>);

describe('the day key on each kind', () => {
  it('reads its own kind and refuses the other one\'s', () => {
    // One column, two generators: without the kind check a nudge could be read
    // as a check-in for the same day.
    expect(moodLogDayKey(generated('moodLog', '2026-08-17'))).toBe('2026-08-17');
    expect(moodLogDayKey(generated('moodNudge', '2026-08-17'))).toBeNull();
    expect(moodNudgeDayKey(generated('moodNudge', '2026-08-17'))).toBe('2026-08-17');
    expect(moodNudgeDayKey(generated('moodLog', '2026-08-17'))).toBeNull();
  });
});

describe('the copy', () => {
  it('names no feeling back at the user and diagnoses nothing', () => {
    // Rule 1 in moodTasks.ts. The app knows somebody tapped a 2 four times;
    // that is the whole of what it knows.
    const words = ['depress', 'anxi', 'unwell', 'ill', 'sad', 'doctor', 'therapy'];
    const copy = `${MOOD_LOG_TITLE} ${MOOD_NUDGE_TITLE} ${moodNudgeNotes(4)}`.toLowerCase();
    for (const word of words) expect(copy).not.toContain(word);
  });

  it('states the count and nothing else about what it might mean', () => {
    expect(moodNudgeNotes(3)).toContain('3 days running');
  });

  it('uses no em dashes, per the copy rules', () => {
    expect(`${MOOD_LOG_TITLE}${MOOD_NUDGE_TITLE}${moodNudgeNotes(2)}`).not.toContain('—');
  });
});

describe('whole days between two day keys', () => {
  it('counts them', () => {
    expect(daysBetweenKeys('2026-08-10', '2026-08-17')).toBe(7);
    expect(daysBetweenKeys('2026-08-17', '2026-08-17')).toBe(0);
  });

  it('survives a DST boundary rather than rounding a day short', () => {
    // Built off local midnight on both sides. Subtracting timestamps across a
    // clock change gives 6.958 days, which floors to 6 and lets the cooldown
    // fire a day early.
    expect(daysBetweenKeys('2026-10-29', '2026-11-05')).toBe(7);
    expect(daysBetweenKeys('2026-03-05', '2026-03-12')).toBe(7);
  });
});

describe('whether to offer the nudge', () => {
  const threshold = DEFAULT_MOOD_NUDGE_AFTER_DAYS;

  it('waits for a run at least as long as the threshold', () => {
    expect(wantsMoodNudge(days([2, 2]), '2026-08-02', threshold, null)).toBe(false);
    expect(wantsMoodNudge(days([2, 2, 2]), '2026-08-03', threshold, null)).toBe(true);
  });

  it('never fires on a run that has already ended', () => {
    expect(wantsMoodNudge(days([1, 1, 1, 5]), '2026-08-04', threshold, null)).toBe(false);
  });

  it('holds off until the cooldown has passed, so a long low patch gets one a week', () => {
    // Rule 2. The person this lands on is by construction having a bad week,
    // and a task a day about it is the failure mode.
    const long = days(Array(14).fill(1));
    expect(wantsMoodNudge(long, '2026-08-14', threshold, '2026-08-10')).toBe(false);
    expect(wantsMoodNudge(long, '2026-08-14', threshold, '2026-08-07')).toBe(true);
    expect(MOOD_NUDGE_COOLDOWN_DAYS).toBe(7);
  });

  it('fires the very first time, with no previous nudge to wait on', () => {
    expect(wantsMoodNudge(days([1, 1, 1]), '2026-08-03', threshold, null)).toBe(true);
  });

  it('treats a threshold below 1 as 1 rather than firing on any day at all', () => {
    expect(wantsMoodNudge(days([5]), '2026-08-01', 0, null)).toBe(false);
    expect(wantsMoodNudge(days([1]), '2026-08-01', 0, null)).toBe(true);
  });

  it('lets an unlogged day neither build the run nor break it', () => {
    // Rule 3: closing the app for a fortnight is not evidence either way.
    expect(wantsMoodNudge(days([2, null, 2, 2]), '2026-08-04', threshold, null)).toBe(true);
  });
});

describe('the line under "Lighten today"', () => {
  it('appears only once the run is as long as the threshold', () => {
    expect(lowMoodDeloadNote(2, 3)).toBeNull();
    expect(lowMoodDeloadNote(3, 3)).toContain('3 days running');
  });

  it('is silent with no run at all, which is the normal case', () => {
    expect(lowMoodDeloadNote(0, 3)).toBeNull();
  });

  it('states what was recorded and nothing about what it means', () => {
    // Same restraint as the nudge's copy one file over: the app knows what was
    // tapped, and that is the whole of what it knows.
    const note = lowMoodDeloadNote(4, 3)!;
    for (const word of ['should', 'need', 'depress', 'anxi', 'unwell', 'rest', 'take it easy']) {
      expect(note.toLowerCase()).not.toContain(word);
    }
    expect(note).not.toContain('\u2014');
  });

  it('treats a threshold below 1 as 1, matching wantsMoodNudge', () => {
    expect(lowMoodDeloadNote(0, 0)).toBeNull();
    expect(lowMoodDeloadNote(1, 0)).not.toBeNull();
  });
});
