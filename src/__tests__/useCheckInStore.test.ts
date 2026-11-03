import { useCheckInStore } from '../store/useCheckInStore';
import { dbDeleteCheckIn, dbInsertCheckIn, dbUpdateCheckIn } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllCheckIns: jest.fn(() => []),
  dbInsertCheckIn: jest.fn(),
  dbUpdateCheckIn: jest.fn(),
  dbDeleteCheckIn: jest.fn(),
}));

const input = { sourceKind: 'medication' as const, sourceId: 'd1', subject: ' Aleve ', about: ' headache ', dueAt: '2026-11-02T15:00:00.000Z', dayKey: '2026-11-02' };

beforeEach(() => {
  jest.clearAllMocks();
  useCheckInStore.setState({ checkIns: [], initialized: false });
});

describe('useCheckInStore', () => {
  it('adds a waiting check-in with trimmed text', () => {
    const c = useCheckInStore.getState().add(input);
    expect(c).toMatchObject({ subject: 'Aleve', about: 'headache', answer: null, answeredAt: null });
    expect(dbInsertCheckIn).toHaveBeenCalledWith(c);
    expect(useCheckInStore.getState().checkIns).toEqual([c]);
  });

  it('stores a blank "what for" as none', () => {
    expect(useCheckInStore.getState().add({ ...input, about: '   ' }).about).toBeNull();
  });

  it('saves an answer with its time', () => {
    const c = useCheckInStore.getState().add(input);
    const saved = useCheckInStore.getState().answer(c.id, 'better', new Date('2026-11-02T15:05:00.000Z'));
    expect(saved).toMatchObject({ answer: 'better', answeredAt: '2026-11-02T15:05:00.000Z' });
    expect(dbUpdateCheckIn).toHaveBeenCalledWith(saved);
  });

  it('answers nothing for a check-in that no longer exists', () => {
    expect(useCheckInStore.getState().answer('gone', 'same')).toBeNull();
    expect(dbUpdateCheckIn).not.toHaveBeenCalled();
  });

  it('removes every check-in about one dose and reports their ids', () => {
    const a = useCheckInStore.getState().add(input);
    useCheckInStore.getState().add({ ...input, sourceId: 'd2' });
    expect(useCheckInStore.getState().removeForSource('medication', 'd1')).toEqual([a.id]);
    expect(dbDeleteCheckIn).toHaveBeenCalledWith(a.id);
    expect(useCheckInStore.getState().checkIns).toHaveLength(1);
    // The same id under the other kind is a different thing.
    expect(useCheckInStore.getState().removeForSource('food', 'd2')).toEqual([]);
  });
});
