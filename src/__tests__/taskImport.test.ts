import { candidatesFromExtracted, candidatesToAdd, draftFromCandidate } from '../utils/taskImport';

describe('candidatesFromExtracted', () => {
  it('ticks every row and lands a read day at noon, local', () => {
    const [a, b] = candidatesFromExtracted([
      { title: 'Call the dentist', date: '2026-10-30', notes: '' },
      { title: 'Buy stamps', date: null, notes: 'Post office' },
    ]);
    expect(a.included).toBe(true);
    expect(a.dueDate).toEqual(new Date(2026, 9, 30, 12, 0, 0, 0));
    expect(b.dueDate).toBeNull();
    expect(b.notes).toBe('Post office');
    expect(a.id).not.toBe(b.id);
  });
});

describe('candidatesToAdd', () => {
  it('leaves out unticked rows and rows whose title was cleared', () => {
    const rows = candidatesFromExtracted([
      { title: 'One', date: null, notes: '' },
      { title: 'Two', date: null, notes: '' },
      { title: 'Three', date: null, notes: '' },
    ]);
    rows[1].included = false;
    rows[2].title = '   ';
    expect(candidatesToAdd(rows).map(r => r.title)).toEqual(['One']);
  });
});

describe('draftFromCandidate', () => {
  it('trims the title and carries the date and notes only when there are any', () => {
    const [row] = candidatesFromExtracted([{ title: 'Call', date: '2026-10-30', notes: 'Dr. Lee' }]);
    row.title = '  Call Dr. Lee ';
    expect(draftFromCandidate(row)).toEqual({
      title: 'Call Dr. Lee',
      notes: 'Dr. Lee',
      dueDate: new Date(2026, 9, 30, 12).toISOString(),
    });
    const [bare] = candidatesFromExtracted([{ title: 'Call', date: null, notes: '' }]);
    expect(draftFromCandidate(bare)).toEqual({ title: 'Call' });
  });
});
