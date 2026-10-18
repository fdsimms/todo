import type { WorkoutSet } from '../types';
import {
  formatAxisValue,
  formatBestPoint,
  formatMetricPoint,
  formatRecordFigure,
  formatRecordValue,
  formatVolume,
  metricCaption,
  metricLabel,
  metricNote,
  metricNumber,
  recordLabel,
  withThousands,
} from '../utils/workoutRecordText';
import type { SessionPoint } from '../utils/workoutRecords';

const set = (extra: Partial<WorkoutSet> = {}): WorkoutSet => ({
  id: 's', sessionId: 'x', exerciseId: 'e', position: 0, setIndex: 0, kind: 'working', weightKg: 82.5, reps: 8,
  durationSeconds: null, distanceM: null, rpe: null, completedAt: 'z', supersetKey: null, note: null, ...extra,
});

describe('recordLabel', () => {
  it('names each record in plain words, and always says the 1RM is estimated', () => {
    expect(recordLabel('e1rm', 'weight_reps')).toBe('Estimated 1RM');
    expect(recordLabel('weight', 'weight_reps')).toBe('Heaviest weight');
    expect(recordLabel('weight', 'weight_distance')).toBe('Heaviest load');
    expect(recordLabel('repsAt', 'weight_reps', 8)).toBe('Best set of 8');
    expect(recordLabel('best', 'bodyweight_reps')).toBe('Most reps in a set');
    expect(recordLabel('best', 'duration')).toBe('Longest set');
    expect(recordLabel('best', 'distance')).toBe('Farthest set');
    expect(recordLabel('volume', 'weight_reps')).toBe('Most volume in a session');
    expect(recordLabel('volume', 'assisted_reps')).toBe('Most reps in a session');
    expect(recordLabel('volume', 'duration')).toBe('Most time in a session');
    expect(recordLabel('volume', 'distance')).toBe('Most distance in a session');
  });
});

describe('numbers', () => {
  it('groups thousands without a locale', () => {
    expect(withThousands(2640)).toBe('2,640');
    expect(withThousands(1234567)).toBe('1,234,567');
    expect(withThousands(999.6)).toBe('1,000');
    expect(withThousands(12)).toBe('12');
  });

  it('writes a volume in the kind\'s own unit', () => {
    expect(formatVolume(2640, 'weight_reps', 'kg')).toBe('2,640 kg');
    expect(formatVolume(1000, 'weight_reps', 'lb')).toBe('2,205 lb');
    expect(formatVolume(142, 'bodyweight_reps', 'kg')).toBe('142 reps');
    expect(formatVolume(1, 'bodyweight_reps', 'kg')).toBe('1 rep');
    expect(formatVolume(85, 'duration', 'kg')).toBe('1:25');
    expect(formatVolume(1200, 'distance', 'kg')).toBe('1.2 km');
  });

  it('writes a record figure alone', () => {
    expect(formatRecordFigure('e1rm', 'weight_reps', 104.5, 'kg')).toBe('104.5 kg');
    expect(formatRecordFigure('weight', 'weight_reps', 100, 'lb')).toBe('220.5 lb');
    expect(formatRecordFigure('best', 'bodyweight_reps', 12, 'kg')).toBe('12 reps');
    expect(formatRecordFigure('best', 'duration', 65, 'kg')).toBe('1:05');
  });
});

describe('formatRecordValue', () => {
  it('writes a lift with the reps it was done for, and an estimate alone', () => {
    expect(formatRecordValue({ type: 'weight', value: 90, set: set({ reps: 3 }) }, 'weight_reps', 'kg')).toBe('90 kg × 3');
    expect(formatRecordValue({ type: 'repsAt', value: 82.5, reps: 8, set: set() }, 'weight_reps', 'kg')).toBe('82.5 kg × 8');
    expect(formatRecordValue({ type: 'e1rm', value: 104.5, set: set() }, 'weight_reps', 'kg')).toBe('104.5 kg');
    expect(formatRecordValue({ type: 'volume', value: 2640, set: null }, 'weight_reps', 'kg')).toBe('2,640 kg');
  });

  it('writes a carry with its distance', () => {
    expect(formatRecordValue({ type: 'weight', value: 40, set: set({ reps: null, distanceM: 40 }) }, 'weight_distance', 'kg')).toBe('40 kg × 40 m');
  });
});

describe('the chart\'s words and numbers', () => {
  const point = (extra: Partial<SessionPoint> = {}): SessionPoint => ({
    sessionId: 's', dayKey: '2026-10-14', e1rm: 104.5, best: { value: 90, set: set({ weightKg: 90, reps: 3 }) }, volume: 2640, sets: 3, ...extra,
  });

  it('labels the three metrics', () => {
    expect(metricLabel('e1rm')).toBe('Estimated 1RM');
    expect(metricLabel('best')).toBe('Best set');
    expect(metricLabel('volume')).toBe('Volume');
    expect(metricCaption('e1rm')).toBe('estimated');
    expect(metricCaption('volume')).toBeNull();
  });

  it('says what each reading is of', () => {
    expect(metricNote('e1rm', 'weight_reps')).toBe('From your best set of 10 reps or fewer each session');
    expect(metricNote('best', 'weight_reps')).toBe('The heaviest working set each session');
    expect(metricNote('volume', 'weight_reps')).toMatch(/Warm-ups are left out/);
    expect(metricNote('volume', 'bodyweight_reps')).toBe('Total reps over the working sets. Body weight is not added.');
  });

  it('shows a point as text, per metric', () => {
    expect(formatMetricPoint(point(), 'e1rm', 'weight_reps', 'kg')).toBe('104.5 kg');
    expect(formatMetricPoint(point(), 'best', 'weight_reps', 'kg')).toBe('90 kg × 3');
    expect(formatMetricPoint(point(), 'volume', 'weight_reps', 'kg')).toBe('2,640 kg');
    expect(formatMetricPoint(point({ e1rm: null }), 'e1rm', 'weight_reps', 'kg')).toBeNull();
    expect(formatMetricPoint(point({ best: null }), 'best', 'weight_reps', 'kg')).toBeNull();
    expect(formatMetricPoint(point({ volume: null }), 'volume', 'weight_reps', 'kg')).toBeNull();
  });

  it('shows a best set as the kind reads it', () => {
    expect(formatBestPoint({ value: 12, set: set({ weightKg: null, reps: 12 }) }, 'bodyweight_reps', 'kg')).toBe('12 reps');
    expect(formatBestPoint({ value: 65, set: set({ durationSeconds: 65 }) }, 'duration', 'kg')).toBe('1:05');
  });

  it('gives a number in the unit shown for the axis', () => {
    expect(metricNumber(point(), 'e1rm', 'weight_reps', 'kg')).toBe(104.5);
    expect(metricNumber(point(), 'e1rm', 'weight_reps', 'lb')).toBe(230.4);
    expect(metricNumber(point(), 'best', 'weight_reps', 'kg')).toBe(90);
    expect(metricNumber(point(), 'volume', 'weight_reps', 'kg')).toBe(2640);
    expect(metricNumber(point({ best: { value: 12, set: set({ weightKg: null }) } }), 'best', 'bodyweight_reps', 'lb')).toBe(12);
    expect(metricNumber(point({ volume: 142 }), 'volume', 'bodyweight_reps', 'lb')).toBe(142);
    expect(metricNumber(point({ e1rm: null }), 'e1rm', 'weight_reps', 'kg')).toBeNull();
  });

  it('labels the axis in the unit of the reading', () => {
    expect(formatAxisValue(105, 'e1rm', 'weight_reps')).toBe('105');
    expect(formatAxisValue(97.5, 'e1rm', 'weight_reps')).toBe('97.5');
    expect(formatAxisValue(2500, 'volume', 'weight_reps')).toBe('2,500');
    expect(formatAxisValue(90, 'best', 'duration')).toBe('1:30');
    expect(formatAxisValue(1500, 'best', 'distance')).toBe('1.5 km');
  });
});
