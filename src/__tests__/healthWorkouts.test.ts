let mockBridge: { readWorkouts: jest.Mock } | null = null;
jest.mock('../utils/healthBridge', () => ({ healthBridge: () => mockBridge }));

import {
  HEALTH_WORKOUT_ACTIVITIES,
  HEALTH_WORKOUT_ACTIVITY_LABEL,
  parseHealthWorkouts,
  readHealthWorkouts,
} from '@/utils/healthWorkouts';

/** Local wall-clock instants, so the tests read the same in every zone. */
function at(day: string, hhmm: string): Date {
  return new Date(`${day}T${hhmm}:00`);
}

function wire(entries: unknown[]): string {
  return JSON.stringify(entries);
}

const run = {
  start: at('2026-10-12', '07:00').toISOString(),
  end: at('2026-10-12', '07:35').toISOString(),
  activity: 'running',
  durationSeconds: 1830,
  source: 'Strava',
  energyKcal: 312,
};

beforeEach(() => {
  mockBridge = null;
});

describe('parseHealthWorkouts', () => {
  it('reads the wire format', () => {
    expect(parseHealthWorkouts(wire([run]))).toEqual([
      {
        start: at('2026-10-12', '07:00'),
        end: at('2026-10-12', '07:35'),
        activity: 'running',
        durationSeconds: 1830,
        sourceName: 'Strava',
        energyKcal: 312,
      },
    ]);
  });

  it('keeps a workout with no energy as absent, never zero', () => {
    const { energyKcal: _omitted, ...noEnergy } = run;
    expect(parseHealthWorkouts(wire([noEnergy]))[0].energyKcal).toBeNull();
    expect(parseHealthWorkouts(wire([{ ...run, energyKcal: null }]))[0].energyKcal).toBeNull();
  });

  it('keeps a present zero as zero', () => {
    expect(parseHealthWorkouts(wire([{ ...run, energyKcal: 0 }]))[0].energyKcal).toBe(0);
  });

  it('reads a broken figure as absent rather than small', () => {
    const [workout] = parseHealthWorkouts(wire([{ ...run, energyKcal: -5, durationSeconds: 'long' }]));
    expect(workout.energyKcal).toBeNull();
    expect(workout.durationSeconds).toBeNull();
  });

  it('leaves a missing duration null rather than working it out from the span', () => {
    const { durationSeconds: _omitted, ...noDuration } = run;
    expect(parseHealthWorkouts(wire([noDuration]))[0].durationSeconds).toBeNull();
  });

  it('reads an activity it does not know as other', () => {
    expect(parseHealthWorkouts(wire([{ ...run, activity: 'underwaterDiving' }]))[0].activity).toBe('other');
    expect(parseHealthWorkouts(wire([{ ...run, activity: 42 }]))[0].activity).toBe('other');
  });

  it('keeps the source name for the attribution, and an empty one when none came', () => {
    expect(parseHealthWorkouts(wire([{ ...run, source: '  Peloton ' }]))[0].sourceName).toBe('Peloton');
    expect(parseHealthWorkouts(wire([{ ...run, source: undefined }]))[0].sourceName).toBe('');
  });

  it('drops an entry with no usable start or end, or one ending before it starts', () => {
    expect(
      parseHealthWorkouts(
        wire([
          { ...run, start: 'yesterday' },
          { ...run, end: undefined },
          { ...run, start: run.end, end: run.start },
          null,
          'run',
        ]),
      ),
    ).toEqual([]);
  });

  it('sorts by start', () => {
    const ride = { ...run, activity: 'cycling', start: at('2026-10-11', '18:00').toISOString(), end: at('2026-10-11', '19:00').toISOString() };
    expect(parseHealthWorkouts(wire([run, ride])).map(w => w.activity)).toEqual(['cycling', 'running']);
  });

  it('answers [] for anything that is not a list', () => {
    expect(parseHealthWorkouts('')).toEqual([]);
    expect(parseHealthWorkouts('null')).toEqual([]);
    expect(parseHealthWorkouts('{"start":"x"}')).toEqual([]);
  });
});

describe('HEALTH_WORKOUT_ACTIVITY_LABEL', () => {
  it('names every activity the bridge can send', () => {
    for (const activity of HEALTH_WORKOUT_ACTIVITIES) {
      expect(HEALTH_WORKOUT_ACTIVITY_LABEL[activity]).toMatch(/\S/);
    }
  });
});

describe('readHealthWorkouts', () => {
  it('reads nothing when the gate is closed (demo mode, off iOS, no native half)', async () => {
    mockBridge = null;
    await expect(readHealthWorkouts(at('2026-10-12', '00:00'), 7)).resolves.toEqual([]);
  });

  it('asks the bridge for the window and parses the answer', async () => {
    mockBridge = { readWorkouts: jest.fn(async () => wire([run])) };
    const anchor = at('2026-10-12', '04:00');
    const workouts = await readHealthWorkouts(anchor, 7);
    expect(mockBridge.readWorkouts).toHaveBeenCalledWith(anchor.toISOString(), 7);
    expect(workouts.map(w => w.sourceName)).toEqual(['Strava']);
  });
});
