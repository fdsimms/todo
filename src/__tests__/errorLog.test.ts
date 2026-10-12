import { buildErrorEntry, logError, ERROR_LOG_MAX_DAYS, ERROR_LOG_MAX_ROWS } from '../utils/errorLog';
import { dbInsertErrorLog, dbPruneErrorLog } from '../db/database';
import { isDemoModeActive } from '../utils/demoState';

jest.mock('../db/database', () => ({
  dbInsertErrorLog: jest.fn(),
  dbPruneErrorLog: jest.fn(),
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));

beforeEach(() => {
  jest.clearAllMocks();
  (isDemoModeActive as jest.Mock).mockReturnValue(false);
});

describe('buildErrorEntry', () => {
  it('keeps the source, name, message and the top of the stack', () => {
    const error = new TypeError('boom');
    error.stack = Array.from({ length: 20 }, (_, i) => `at frame${i}`).join('\n');
    const entry = buildErrorEntry('recipe-component-import', error, new Date('2026-10-12T09:00:00'));
    expect(entry).toMatchObject({ source: 'recipe-component-import', name: 'TypeError', message: 'boom' });
    expect(entry.at).toBe(new Date('2026-10-12T09:00:00').toISOString());
    expect(entry.stack.split('\n')).toHaveLength(6);
  });

  it('trims a long message', () => {
    expect(buildErrorEntry('ai', new Error('x'.repeat(5000))).message).toHaveLength(300);
  });

  it('blanks an API key that turned up in a message', () => {
    const entry = buildErrorEntry('ai', new Error('bad key sk-ant-api03-AbC_123-xyz rejected'));
    expect(entry.message).toBe('bad key [key] rejected');
  });

  it('handles a thrown string and a thrown non-error', () => {
    expect(buildErrorEntry('ai', 'oops')).toMatchObject({ name: 'string', message: 'oops', stack: '' });
    expect(buildErrorEntry('ai', { a: 1 })).toMatchObject({ name: 'object', message: '' });
  });
});

describe('logError', () => {
  it('writes the entry and prunes to the age and count caps', () => {
    logError('ai', new Error('boom'));
    expect(dbInsertErrorLog).toHaveBeenCalledWith(expect.objectContaining({ source: 'ai', message: 'boom' }));
    const [cutoff, keep] = (dbPruneErrorLog as jest.Mock).mock.calls[0];
    expect(keep).toBe(ERROR_LOG_MAX_ROWS);
    const ageDays = (Date.now() - new Date(cutoff).getTime()) / 86_400_000;
    expect(Math.round(ageDays)).toBe(ERROR_LOG_MAX_DAYS);
  });

  it('writes nothing in demo mode', () => {
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    logError('ai', new Error('boom'));
    expect(dbInsertErrorLog).not.toHaveBeenCalled();
  });

  it('never throws, even when the database does', () => {
    (dbInsertErrorLog as jest.Mock).mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => logError('ai', new Error('boom'))).not.toThrow();
  });
});
