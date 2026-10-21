import type { ExerciseKind, WorkoutSet } from '../types';
import type { WeightUnit } from './weightLog';
import { kgToUnit } from './weightLog';
import { formatRestSeconds, formatWeightWithUnit, weightToDisplay } from './workoutData';
import { formatDistance } from './workoutSession';
import type { RecordMetric, RecordType, SessionPoint, VolumeUnit } from './workoutRecords';
import { volumeUnit } from './workoutRecords';

/**
 * The words and numbers a record or a chart point is shown as. Kept apart from
 * `workoutRecords.ts` (which is arithmetic) so what a screen says lives in one
 * place the exercise page, the finish summary and Stats all read, and so a
 * wording change is a test change. Plain and literal, American English, no
 * claims: a 1RM is always "estimated" and a volume says what it is the sum of.
 */

/** 1,234 with a comma, regardless of the device's locale (and of whether the runtime has a locale table). */
export function withThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** What a record is called. */
export function recordLabel(type: RecordType, kind: ExerciseKind, reps?: number): string {
  switch (type) {
    case 'e1rm': return 'Estimated 1RM';
    case 'weight': return kind === 'weight_distance' ? 'Heaviest load' : 'Heaviest weight';
    case 'repsAt': return `Best set of ${reps ?? 0}`;
    case 'best':
      if (kind === 'duration') return 'Longest set';
      if (kind === 'distance') return 'Farthest set';
      return 'Most reps in a set';
    case 'volume':
      if (kind === 'weight_reps') return 'Most volume in a session';
      if (kind === 'duration') return 'Most time in a session';
      if (kind === 'distance' || kind === 'weight_distance') return 'Most distance in a session';
      return 'Most reps in a session';
  }
}

/**
 * Every function here takes a `scale` (2 for a two-dumbbell exercise logged as a pair
 * total, `dumbbellLoad.ts`) that multiplies the stored one-dumbbell weights for
 * reading; the default 1 changes nothing.
 *
 * A volume in the unit its kind has, with that unit: "2,640 kg", "142 reps", "4:30", "1.2 km". */
export function formatVolume(value: number, kind: ExerciseKind, unit: WeightUnit, scale = 1): string {
  const u: VolumeUnit = volumeUnit(kind);
  if (u === 'kg') return `${withThousands(kgToUnit(value * scale, unit))} ${unit}`;
  if (u === 'seconds') return formatRestSeconds(value);
  if (u === 'm') return formatDistance(value);
  return `${withThousands(value)} ${value === 1 ? 'rep' : 'reps'}`;
}

/** A record's figure alone, without the set that holds it: what "was" is followed by. */
export function formatRecordFigure(type: RecordType, kind: ExerciseKind, value: number, unit: WeightUnit, scale = 1): string {
  switch (type) {
    case 'e1rm':
    case 'weight':
    case 'repsAt':
      return formatWeightWithUnit(value * scale, unit);
    case 'best':
      if (kind === 'duration') return formatRestSeconds(value);
      if (kind === 'distance') return formatDistance(value);
      return `${value} ${value === 1 ? 'rep' : 'reps'}`;
    case 'volume':
      return formatVolume(value, kind, unit, scale);
  }
}

/**
 * A record as its row shows it: the figure, and for a lift the reps it was
 * done for ("82.5 kg × 8"). An estimated 1RM is the figure alone, since no set
 * ever lifted it.
 */
export function formatRecordValue(
  record: { type: RecordType; value: number; reps?: number; set: Pick<WorkoutSet, 'reps' | 'distanceM'> | null },
  kind: ExerciseKind,
  unit: WeightUnit,
  scale = 1,
): string {
  const figure = formatRecordFigure(record.type, kind, record.value, unit, scale);
  if (record.type === 'weight' || record.type === 'repsAt') {
    if (kind === 'weight_distance' && record.set?.distanceM != null) return `${figure} × ${formatDistance(record.set.distanceM)}`;
    const reps = record.type === 'repsAt' ? record.reps : record.set?.reps;
    return reps != null ? `${figure} × ${reps}` : figure;
  }
  return figure;
}

/**
 * A record beaten this workout, as the finish summary shows it: the old figure,
 * then the new one ("102 kg" then "104.5 kg"). A best set of N already names its
 * reps in the label, so its new figure leaves the "× 8" off; a heaviest weight
 * keeps the reps it was lifted for, since those aren't in its label.
 */
export function formatRecordChange(
  record: { type: RecordType; value: number; previous: number; reps?: number; set: Pick<WorkoutSet, 'reps' | 'distanceM'> | null },
  kind: ExerciseKind,
  unit: WeightUnit,
  scale = 1,
): { before: string; after: string } {
  return {
    before: formatRecordFigure(record.type, kind, record.previous, unit, scale),
    after: record.type === 'repsAt'
      ? formatRecordFigure(record.type, kind, record.value, unit, scale)
      : formatRecordValue(record, kind, unit, scale),
  };
}

/** The segmented control's label for each metric. */
export function metricLabel(metric: RecordMetric): string {
  return metric === 'e1rm' ? 'Estimated 1RM' : metric === 'best' ? 'Best set' : 'Volume';
}

/** One line under the headline saying what the number is of, so it never reads as more than it is. */
export function metricNote(metric: RecordMetric, kind: ExerciseKind): string {
  if (metric === 'e1rm') return 'From your best set of 10 reps or fewer each session';
  if (metric === 'best') {
    if (kind === 'weight_reps' || kind === 'weight_distance') return 'The heaviest working set each session';
    if (kind === 'duration') return 'The longest working set each session';
    if (kind === 'distance') return 'The farthest working set each session';
    return 'The most reps in one working set each session';
  }
  switch (volumeUnit(kind)) {
    case 'kg': return 'Weight times reps over the working sets. Warm-ups are left out.';
    case 'reps': return 'Total reps over the working sets. Body weight is not added.';
    case 'seconds': return 'Total time over the working sets.';
    case 'm': return 'Total distance over the working sets.';
  }
}

/** The word after the headline figure: "estimated" for the 1RM and nothing for the rest. */
export function metricCaption(metric: RecordMetric): string | null {
  return metric === 'e1rm' ? 'estimated' : null;
}

/** The best set of a point as a line: "90 kg × 3", "12 reps", "1:05". */
export function formatBestPoint(best: { value: number; set: WorkoutSet }, kind: ExerciseKind, unit: WeightUnit, scale = 1): string {
  if (kind === 'weight_reps') {
    return best.set.reps !== null ? `${formatWeightWithUnit(best.value * scale, unit)} × ${best.set.reps}` : formatWeightWithUnit(best.value * scale, unit);
  }
  if (kind === 'weight_distance') {
    return best.set.distanceM !== null ? `${formatWeightWithUnit(best.value * scale, unit)} × ${formatDistance(best.set.distanceM)}` : formatWeightWithUnit(best.value * scale, unit);
  }
  return formatRecordFigure('best', kind, best.value, unit);
}

/** A point's value for a metric as text: what the headline and the scrub tooltip show. Null when the session has none. */
export function formatMetricPoint(point: SessionPoint, metric: RecordMetric, kind: ExerciseKind, unit: WeightUnit, scale = 1): string | null {
  if (metric === 'e1rm') return point.e1rm !== null ? formatWeightWithUnit(point.e1rm * scale, unit) : null;
  if (metric === 'best') return point.best ? formatBestPoint(point.best, kind, unit, scale) : null;
  return point.volume !== null ? formatVolume(point.volume, kind, unit, scale) : null;
}

/** A point's value as a plain number on the chart's axis, in the unit shown. Null when the session has none. */
export function metricNumber(point: SessionPoint, metric: RecordMetric, kind: ExerciseKind, unit: WeightUnit, scale = 1): number | null {
  const weighted = kind === 'weight_reps' || kind === 'weight_distance';
  if (metric === 'e1rm') return point.e1rm !== null ? weightToDisplay(point.e1rm * scale, unit) : null;
  if (metric === 'best') {
    if (!point.best) return null;
    return weighted ? weightToDisplay(point.best.value * scale, unit) : point.best.value;
  }
  if (point.volume === null) return null;
  return volumeUnit(kind) === 'kg' ? Math.round(kgToUnit(point.volume * scale, unit)) : point.volume;
}

/** An axis label for a number from `metricNumber`: bare for weights and reps, a clock for seconds, a distance for metres. */
export function formatAxisValue(value: number, metric: RecordMetric, kind: ExerciseKind): string {
  const asSeconds = (metric === 'best' && kind === 'duration') || (metric === 'volume' && kind === 'duration');
  if (asSeconds) return formatRestSeconds(value);
  const asMeters = (metric === 'best' && kind === 'distance') || (metric === 'volume' && (kind === 'distance' || kind === 'weight_distance'));
  if (asMeters) return formatDistance(value);
  return value >= 1000 ? withThousands(value) : String(Number(value.toFixed(1)));
}

