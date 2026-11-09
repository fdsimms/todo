import { changedEditorFields, listChanges } from '../utils/editorChangeSummary';

const snap = (o: Record<string, unknown>) => JSON.stringify(o);

describe('changedEditorFields', () => {
  const base = { title: 'a', notes: '', dueDate: null, recurrenceType: 'none', recurrenceInterval: 1, tags: [] };

  it('is empty when nothing differs', () => {
    expect(changedEditorFields(snap(base), snap({ ...base }))).toEqual([]);
  });

  it('names each changed field once, grouping fields that share a row', () => {
    const next = { ...base, title: 'b', recurrenceType: 'daily', recurrenceInterval: 2 };
    expect(changedEditorFields(snap(base), snap(next))).toEqual(['title', 'repeat']);
  });

  it('compares arrays by value', () => {
    expect(changedEditorFields(snap(base), snap({ ...base, tags: ['x'] }))).toEqual(['tags']);
  });

  it('counts a field it has no word for, last, as other settings', () => {
    const next = { ...base, brandNewField: 1, title: 'b' };
    expect(changedEditorFields(snap({ ...base, brandNewField: 0 }), snap(next))).toEqual(['title', 'other settings']);
  });

  it('returns nothing for a baseline that is not JSON', () => {
    expect(changedEditorFields('', snap(base))).toEqual([]);
  });
});

describe('listChanges', () => {
  it('reads as a sentence fragment', () => {
    expect(listChanges([])).toBe('');
    expect(listChanges(['title'])).toBe('title');
    expect(listChanges(['title', 'notes'])).toBe('title and notes');
    expect(listChanges(['title', 'notes', 'date'])).toBe('title, notes and date');
    expect(listChanges(['title', 'notes', 'date', 'repeat', 'tags'])).toBe('title, notes, date and 2 more');
  });
});
