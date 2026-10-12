import { useMeterReadingStore } from '../store/useMeterReadingStore';
import { dbInsertMeterReading, dbDeleteMeterReading } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllMeterReadings: jest.fn(() => []),
  dbInsertMeterReading: jest.fn(),
  dbDeleteMeterReading: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useMeterReadingStore.setState({ readings: [], initialized: false });
});

const state = () => useMeterReadingStore.getState();

describe('logReading', () => {
  it('files the reading under the meter key and keeps the name as typed', () => {
    const r = state().logReading('  Car ', 41000, new Date(2026, 8, 21, 9));
    expect(r).toEqual(expect.objectContaining({ meterKey: 'car', meterName: 'Car', value: 41000 }));
    expect(dbInsertMeterReading).toHaveBeenCalledWith(r);
  });

  it('keeps readings in the order a relaunch reads them back', () => {
    state().logReading('Car', 41000, new Date(2026, 8, 21, 9));
    state().logReading('Car', 40000, new Date(2026, 8, 1, 9));
    expect(state().readings.map(r => r.value)).toEqual([40000, 41000]);
  });

  it('refuses a blank name or a value that is not a reading', () => {
    expect(state().logReading('  ', 10)).toBeNull();
    expect(state().logReading('Car', -1)).toBeNull();
    expect(state().logReading('Car', Number.NaN)).toBeNull();
    expect(state().readings).toHaveLength(0);
    expect(dbInsertMeterReading).not.toHaveBeenCalled();
  });
});

describe('removeReading', () => {
  it('deletes the row and drops it from the list', () => {
    const r = state().logReading('Car', 41000)!;
    state().removeReading(r.id);
    expect(dbDeleteMeterReading).toHaveBeenCalledWith(r.id);
    expect(state().readings).toHaveLength(0);
  });
});
