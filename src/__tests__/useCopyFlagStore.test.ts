import { useCopyFlagStore } from '../store/useCopyFlagStore';

jest.mock('../db/database', () => ({
  dbGetAllCopyFlags: jest.fn(() => []),
  dbInsertCopyFlag: jest.fn(),
  dbUpdateCopyFlag: jest.fn(),
  dbDeleteCopyFlag: jest.fn(),
}));

describe('useCopyFlagStore', () => {
  beforeEach(() => {
    useCopyFlagStore.setState({ flags: [], initialized: false });
  });

  it('refuses blank text', () => {
    expect(useCopyFlagStore.getState().addFlag('   ', 'Today', '')).toBeNull();
  });

  it('adds an open flag, newest first', () => {
    const { addFlag } = useCopyFlagStore.getState();
    addFlag('One', 'Today', '');
    const second = addFlag('Two', 'Today', ' too jokey ');
    expect(second).toMatchObject({ status: 'open', note: 'too jokey', resolution: '' });
    expect(useCopyFlagStore.getState().flags.map(f => f.text)).toEqual(['Two', 'One']);
  });

  it('returns the open flag already on that text and screen', () => {
    const { addFlag } = useCopyFlagStore.getState();
    const first = addFlag('One', 'Today', '');
    expect(addFlag('One', 'Today', 'again')).toBe(first);
    expect(useCopyFlagStore.getState().flags).toHaveLength(1);
    expect(addFlag('One', 'Later', '')).not.toBe(first);
  });

  it('updates a note and removes a flag', () => {
    const flag = useCopyFlagStore.getState().addFlag('One', 'Today', '')!;
    useCopyFlagStore.getState().updateNote(flag.id, ' fix ');
    expect(useCopyFlagStore.getState().flags[0].note).toBe('fix');
    useCopyFlagStore.getState().removeFlag(flag.id);
    expect(useCopyFlagStore.getState().flags).toEqual([]);
  });
});
