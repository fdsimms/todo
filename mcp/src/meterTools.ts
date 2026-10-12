/**
 * Meter readings: the odometer, shot counter or engine-hours meter a task can
 * be due at (`Task.meterName`, src/utils/meters.ts, docs/arch/meters.md).
 *
 * A reading belongs to the meter, not to a task, so one logged here moves
 * every task on that meter. The writes go through `useMeterReadingStore` by
 * way of the replica, so a blank name or a reading that isn't a number is
 * refused as the app refuses it. Holding and releasing the tasks is the
 * phone's pass, so a task can take until the next sync to move.
 */
import type { MeterReading } from '../../src/types';
import type { Replica } from './replica';
import { eventNoonIso } from './taskFields';
import { knownMeterNames, meterChipText, meterKey, meterRatePerDay, readingsFor } from '../../src/utils/meters';

export interface MeterReadingRow {
  id: string;
  meter: string;
  value: number;
  /** `YYYY-MM-DD`, the day it was read. */
  date: string;
}

function row(replica: Replica, r: MeterReading): MeterReadingRow {
  return { id: r.id, meter: r.meterName, value: r.value, date: replica.logicalDayKeyOf(r.readAt) };
}

export interface MeterSummary {
  name: string;
  readings: MeterReadingRow[];
  /** Per day, from readings at least a week apart in the last year. Absent when they can't say. */
  ratePerDay?: number;
  /** Open tasks on this meter, with what the app would show on the row. */
  tasks: { id: string; title: string; status: string | null }[];
}

const MOVES_ON_SYNC = 'Tasks on a meter are held and released by the phone, so one can take until its next sync to move after a reading is logged.';

export function listMeterReadings(replica: Replica, input: { meter?: string }): { meters: MeterSummary[]; note: string } {
  const readings = replica.meterReadings();
  const openTasks = replica.tasks().filter(t => t.meterName && !t.completed && !t.archived);
  const names = [...new Set([
    ...knownMeterNames(readings),
    ...openTasks.map(t => t.meterName!.trim()),
  ].map(n => n.trim()))]
    .filter((n, i, all) => all.findIndex(m => meterKey(m) === meterKey(n)) === i)
    .filter(n => !input.meter || meterKey(n) === meterKey(input.meter));
  return {
    meters: names.map(name => {
      const rate = meterRatePerDay(readings, name);
      return {
        name,
        readings: readingsFor(readings, name).map(r => row(replica, r)),
        ...(rate !== null ? { ratePerDay: Math.round(rate * 10) / 10 } : {}),
        tasks: openTasks
          .filter(t => meterKey(t.meterName!) === meterKey(name))
          .map(t => ({ id: t.id, title: t.title, status: meterChipText(t, readings) })),
      };
    }),
    note: MOVES_ON_SYNC,
  };
}

export interface LogMeterReadingInput {
  meter: string;
  value: number;
  /** `YYYY-MM-DD`. Defaults to the person's logical today. */
  date?: string;
}

export function logMeterReading(replica: Replica, input: LogMeterReadingInput): { reading: MeterReadingRow; note: string } {
  const day = input.date ?? replica.todayKey();
  const iso = eventNoonIso(day);
  if (!iso) throw new Error(`date: "${day}" is not a date I can read. Use YYYY-MM-DD.`);
  const reading = replica.logMeterReading(input.meter, input.value, new Date(iso));
  return { reading: row(replica, reading), note: MOVES_ON_SYNC };
}

export function deleteMeterReading(replica: Replica, id: string): { removed: MeterReadingRow } {
  return { removed: row(replica, replica.deleteMeterReading(id)) };
}
