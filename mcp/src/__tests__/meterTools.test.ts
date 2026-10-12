import type { MeterReading, Task } from '../../../src/types';
import type { Replica } from '../replica';
import { deleteMeterReading, listMeterReadings, logMeterReading } from '../meterTools';

const reading = (id: string, name: string, value: number, readAt: string): MeterReading => ({
  id, meterKey: name.trim().toLowerCase(), meterName: name, value, readAt, createdAt: readAt,
});

function fakeReplica(readings: MeterReading[], tasks: Partial<Task>[] = []) {
  const logged: { name: string; value: number; readAt: Date }[] = [];
  const replica = {
    meterReadings: () => readings,
    tasks: () => tasks as Task[],
    todayKey: () => '2026-10-08',
    logicalDayKeyOf: (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    logMeterReading: (name: string, value: number, readAt: Date) => {
      logged.push({ name, value, readAt });
      return reading('new', name, value, readAt.toISOString());
    },
    deleteMeterReading: (id: string) => {
      const r = readings.find(x => x.id === id);
      if (!r) throw new Error(`No meter reading with id ${id}.`);
      return r;
    },
  } as unknown as Replica;
  return { replica, logged };
}

// Local times, never a Z literal read back as a local day (CLAUDE.md).
const at = (month: number, day: number) => new Date(2026, month, day, 9).toISOString();
const car = [
  reading('a', 'Car', 40000, at(8, 1)),
  reading('b', 'car', 41000, at(8, 21)),
];
const oilChange: Partial<Task> = {
  id: 't1', title: 'Change the oil', meterName: 'Car', meterUnit: 'miles', meterEvery: 5000, meterDueAt: 45000,
  completed: false, archived: false,
};

describe('list_meter_readings', () => {
  it('groups readings by meter with the rate and the tasks on it', () => {
    const { replica } = fakeReplica(car, [oilChange]);
    const { meters } = listMeterReadings(replica, {});
    expect(meters).toHaveLength(1);
    expect(meters[0].readings.map(r => r.value)).toEqual([40000, 41000]);
    expect(meters[0].ratePerDay).toBe(50);
    expect(meters[0].tasks).toEqual([{ id: 't1', title: 'Change the oil', status: 'Due at 45,000 miles · est. Dec 10' }]);
  });

  it('names a meter a task follows before it has ever been read', () => {
    const { replica } = fakeReplica([], [{ ...oilChange, meterName: 'Mower' }]);
    expect(listMeterReadings(replica, {}).meters.map(m => m.name)).toEqual(['Mower']);
  });

  it('narrows to one meter', () => {
    const { replica } = fakeReplica([...car, reading('c', 'Espresso', 120, at(8, 25))]);
    expect(listMeterReadings(replica, { meter: 'espresso' }).meters.map(m => m.name)).toEqual(['Espresso']);
  });
});

describe('log_meter_reading', () => {
  it('logs at noon of the day named, defaulting to today', () => {
    const { replica, logged } = fakeReplica(car);
    logMeterReading(replica, { meter: 'Car', value: 45120 });
    expect(logged[0].name).toBe('Car');
    expect(logged[0].value).toBe(45120);
    expect(logged[0].readAt.getHours()).toBe(12);
  });

  it('refuses a day it cannot read', () => {
    const { replica } = fakeReplica(car);
    expect(() => logMeterReading(replica, { meter: 'Car', value: 1, date: 'soon' })).toThrow(/YYYY-MM-DD/);
  });
});

describe('delete_meter_reading', () => {
  it('returns what it removed', () => {
    const { replica } = fakeReplica(car);
    expect(deleteMeterReading(replica, 'a').removed).toEqual({ id: 'a', meter: 'Car', value: 40000, date: '2026-09-01' });
  });
});
