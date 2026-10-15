import { PLACE_FIX_TTL_MS, placeGateAllows, placeIdAt, placeLimitedTasks, placeTrustedUntil } from '../utils/placeGate';
import type { SavedPlace } from '../utils/savedPlaces';

jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn() }));

const place = (id: string, latitude: number | null, longitude: number | null, moodTag = false): SavedPlace =>
  ({ id, name: id, text: '', latitude, longitude, moodTag, doorMinutes: null });

const home = place('home', 40.7128, -74.006);
const office = place('office', 40.7484, -73.9857);
// About 110 m north of home.
const nearHome = { latitude: 40.7138, longitude: -74.006, accuracyM: 30 };

const now = new Date(2026, 9, 14, 11, 0);
const limited = { quotaReminders: true, quotaPlaceIds: ['office'] };

describe('placeIdAt', () => {
  it('finds a pinned place the fix is inside, whether or not it offers a mood tag', () => {
    expect(placeIdAt([home, office], nearHome)).toBe('home');
  });

  it('is null away from every place, with a coarse fix, with no accuracy, and with no fix', () => {
    expect(placeIdAt([home, office], { latitude: 41, longitude: -74, accuracyM: 20 })).toBeNull();
    expect(placeIdAt([home], { ...nearHome, accuracyM: 500 })).toBeNull();
    expect(placeIdAt([home], { ...nearHome, accuracyM: null })).toBeNull();
    expect(placeIdAt([home], null)).toBeNull();
  });

  it('ignores a place with no pin', () => {
    expect(placeIdAt([place('home', null, null)], nearHome)).toBeNull();
  });
});

describe('placeGateAllows', () => {
  it('allows a task with no places, or with reminders off, whatever the fix', () => {
    expect(placeGateAllows({ quotaReminders: true, quotaPlaceIds: [] }, null, now)).toBe(true);
    expect(placeGateAllows({ quotaReminders: true }, null, now)).toBe(true);
    expect(placeGateAllows({ quotaReminders: false, quotaPlaceIds: ['office'] }, null, now)).toBe(true);
  });

  it('allows only a fresh fix inside one of the task\'s places', () => {
    const at = +now - 30 * 60 * 1000;
    expect(placeGateAllows(limited, { placeId: 'office', at }, now)).toBe(true);
    expect(placeGateAllows(limited, { placeId: 'home', at }, now)).toBe(false);
    expect(placeGateAllows(limited, { placeId: null, at }, now)).toBe(false);
  });

  it('allows nothing when the phone cannot say where it is', () => {
    expect(placeGateAllows(limited, null, now)).toBe(false);
    expect(placeGateAllows(limited, { placeId: 'office', at: +now - PLACE_FIX_TTL_MS - 1 }, now)).toBe(false);
    expect(placeGateAllows(limited, { placeId: 'office', at: +now + 60_000 }, now)).toBe(false);
  });
});

describe('placeLimitedTasks', () => {
  it('lists only open tasks whose reminders are limited to places', () => {
    const open = { completed: false, archived: false };
    const tasks = [
      { ...open, ...limited },
      { ...open, quotaReminders: true, quotaPlaceIds: [] },
      { ...open, quotaReminders: false, quotaPlaceIds: ['office'] },
      { completed: true, archived: false, ...limited },
      { completed: false, archived: true, ...limited },
    ];
    expect(placeLimitedTasks(tasks)).toEqual([tasks[0]]);
  });
});

describe('placeTrustedUntil', () => {
  it('is unbounded for a task with no places', () => {
    expect(placeTrustedUntil({ quotaReminders: true, quotaPlaceIds: [] }, null)).toBe(Infinity);
    expect(placeTrustedUntil({ quotaReminders: false, quotaPlaceIds: ['office'] }, null)).toBe(Infinity);
  });

  it('ends when the fix expires, so a reminder laid down now cannot outlive it', () => {
    const at = +now - 30 * 60 * 1000;
    expect(placeTrustedUntil(limited, { placeId: 'office', at })).toBe(at + PLACE_FIX_TTL_MS);
  });

  it('allows no instant at all without a fix', () => {
    expect(placeTrustedUntil(limited, null)).toBe(-Infinity);
  });
});
