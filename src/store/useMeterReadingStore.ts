import { create } from 'zustand';
import type { MeterReading } from '../types';
import { dbGetAllMeterReadings, dbInsertMeterReading, dbDeleteMeterReading } from '../db/database';
import { generateId } from '../utils/id';
import { METER_NAME_MAX_LENGTH, meterKey } from '../utils/meters';

/**
 * Readings of the meters a person tracks by hand: an odometer, a shot
 * counter, an engine-hours meter. A task due at a reading (`Task.meterName`)
 * reads them; what they mean for a task is `src/utils/meters.ts`, and what the
 * app does about it is `applyMeterHolds` in `useTaskStore`.
 *
 * Its own store, beside the milestones it is shaped like: rows with their own
 * lifecycle that no task row owns, since one odometer entry serves every task
 * on the car. Readings are only added or deleted, never edited, so the sync
 * merge never has to choose between two devices' values for one row. A wrong
 * reading is deleted and logged again.
 *
 * Loaded wholesale at startup: a reading a month for a few meters is a few
 * hundred rows over a decade.
 */

interface MeterReadingStore {
  readings: MeterReading[];
  initialized: boolean;
  initialize: () => void;
  /** Refuses a blank name or a value that isn't a finite non-negative number. */
  logReading: (name: string, value: number, readAt?: Date) => MeterReading | null;
  removeReading: (id: string) => void;
}

const byReadAt = (a: MeterReading, b: MeterReading) => a.readAt.localeCompare(b.readAt);

export const useMeterReadingStore = create<MeterReadingStore>((set, get) => ({
  readings: [],
  initialized: false,

  initialize() {
    set({ readings: dbGetAllMeterReadings(), initialized: true });
  },

  logReading(name, value, readAt = new Date()) {
    const trimmed = name.trim().slice(0, METER_NAME_MAX_LENGTH);
    if (!trimmed || !Number.isFinite(value) || value < 0) return null;
    const reading: MeterReading = {
      id: generateId(),
      meterKey: meterKey(trimmed),
      meterName: trimmed,
      value,
      readAt: readAt.toISOString(),
      createdAt: new Date().toISOString(),
    };
    dbInsertMeterReading(reading);
    // Kept in the order dbGetAllMeterReadings hands back on the next launch.
    set({ readings: [...get().readings, reading].sort(byReadAt) });
    return reading;
  },

  removeReading(id) {
    dbDeleteMeterReading(id);
    set({ readings: get().readings.filter(r => r.id !== id) });
  },
}));
