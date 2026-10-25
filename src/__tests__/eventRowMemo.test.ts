import {
  EVENT_ROW_MEMO_KEY,
  MAX_EVENT_PLACEHOLDERS,
  eventRowMemoValue,
  loadEventRowMemo,
  readEventRowMemo,
  saveEventRowMemo,
} from '../utils/eventRowMemo';
import { dbGetSetting, dbSetSetting } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn(),
  dbSetSetting: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

describe('readEventRowMemo', () => {
  it('reads back the count stored for the same day', () => {
    expect(readEventRowMemo(eventRowMemoValue('2026-10-25', 3), '2026-10-25')).toBe(3);
  });

  it('gives 0 for another day, nothing stored, or anything unreadable', () => {
    expect(readEventRowMemo(eventRowMemoValue('2026-10-24', 3), '2026-10-25')).toBe(0);
    expect(readEventRowMemo(null, '2026-10-25')).toBe(0);
    expect(readEventRowMemo('not json', '2026-10-25')).toBe(0);
    expect(readEventRowMemo(JSON.stringify({ dayKey: '2026-10-25', count: 'two' }), '2026-10-25')).toBe(0);
  });

  it('caps a busy day at the placeholder limit', () => {
    expect(readEventRowMemo(eventRowMemoValue('2026-10-25', 14), '2026-10-25')).toBe(MAX_EVENT_PLACEHOLDERS);
  });
});

describe('saveEventRowMemo', () => {
  it('writes a changed count and skips an unchanged one', () => {
    (dbGetSetting as jest.Mock).mockReturnValue(null);
    saveEventRowMemo('2026-10-25', 2);
    expect(dbSetSetting).toHaveBeenCalledWith(EVENT_ROW_MEMO_KEY, eventRowMemoValue('2026-10-25', 2));

    (dbSetSetting as jest.Mock).mockClear();
    (dbGetSetting as jest.Mock).mockReturnValue(eventRowMemoValue('2026-10-25', 2));
    saveEventRowMemo('2026-10-25', 2);
    expect(dbSetSetting).not.toHaveBeenCalled();
  });

  it('loads through the same key', () => {
    (dbGetSetting as jest.Mock).mockReturnValue(eventRowMemoValue('2026-10-25', 1));
    expect(loadEventRowMemo('2026-10-25')).toBe(1);
    expect(dbGetSetting).toHaveBeenCalledWith(EVENT_ROW_MEMO_KEY);
  });
});
