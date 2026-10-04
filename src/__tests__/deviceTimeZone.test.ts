jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn() }));

import { DEVICE_TIME_ZONE_KEY, isValidTimeZone, recordDeviceTimeZone } from '../utils/deviceTimeZone';
import { isSyncedSettingKey } from '../db/syncTracking';
import { DEVICE_TIME_ZONE_KEY as SERVER_KEY } from '../../mcp/src/timeZone';

describe('recordDeviceTimeZone', () => {
  it('writes the zone when it differs from the stored one, and only then', () => {
    const write = jest.fn();
    expect(recordDeviceTimeZone('America/New_York', () => 'UTC', write)).toBe(true);
    expect(write).toHaveBeenCalledWith(DEVICE_TIME_ZONE_KEY, 'America/New_York');

    write.mockClear();
    expect(recordDeviceTimeZone('America/New_York', () => 'America/New_York', write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('writes nothing for a zone the runtime could not name', () => {
    const write = jest.fn();
    expect(recordDeviceTimeZone(null, () => null, write)).toBe(false);
    expect(recordDeviceTimeZone('Mars/Olympus_Mons', () => null, write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('the setting', () => {
  it('is synced, under the key the server reads', () => {
    expect(isSyncedSettingKey(DEVICE_TIME_ZONE_KEY)).toBe(true);
    expect(SERVER_KEY).toBe(DEVICE_TIME_ZONE_KEY);
  });

  it('accepts real zones and refuses made-up ones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Nowhere/Special')).toBe(false);
  });
});
