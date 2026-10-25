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

const plain = { withLocation: false };
const located = { withLocation: true };

describe('readEventRowMemo', () => {
  it('reads back the rows stored for the same day, location lines included', () => {
    expect(readEventRowMemo(eventRowMemoValue('2026-10-25', [plain, located]), '2026-10-25'))
      .toEqual([plain, located]);
  });

  it('gives none for another day, nothing stored, or anything unreadable', () => {
    expect(readEventRowMemo(eventRowMemoValue('2026-10-24', [plain]), '2026-10-25')).toEqual([]);
    expect(readEventRowMemo(null, '2026-10-25')).toEqual([]);
    expect(readEventRowMemo('not json', '2026-10-25')).toEqual([]);
    expect(readEventRowMemo(JSON.stringify({ dayKey: '2026-10-25', locations: 'two' }), '2026-10-25')).toEqual([]);
  });

  it('caps a busy day at the placeholder limit', () => {
    const many = Array.from({ length: 14 }, () => plain);
    expect(readEventRowMemo(eventRowMemoValue('2026-10-25', many), '2026-10-25')).toHaveLength(MAX_EVENT_PLACEHOLDERS);
  });
});

describe('saveEventRowMemo', () => {
  it('writes changed rows and skips unchanged ones', () => {
    (dbGetSetting as jest.Mock).mockReturnValue(null);
    saveEventRowMemo('2026-10-25', [located]);
    expect(dbSetSetting).toHaveBeenCalledWith(EVENT_ROW_MEMO_KEY, eventRowMemoValue('2026-10-25', [located]));

    (dbSetSetting as jest.Mock).mockClear();
    (dbGetSetting as jest.Mock).mockReturnValue(eventRowMemoValue('2026-10-25', [located]));
    saveEventRowMemo('2026-10-25', [located]);
    expect(dbSetSetting).not.toHaveBeenCalled();
  });

  it('loads through the same key', () => {
    (dbGetSetting as jest.Mock).mockReturnValue(eventRowMemoValue('2026-10-25', [plain]));
    expect(loadEventRowMemo('2026-10-25')).toEqual([plain]);
    expect(dbGetSetting).toHaveBeenCalledWith(EVENT_ROW_MEMO_KEY);
  });
});
