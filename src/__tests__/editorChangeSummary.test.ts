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

import { changedList, changedSlots } from '../utils/editorChangeSummary';

describe('changedList', () => {
  it('lists each changed label once, in order', () => {
    expect(changedList([['a', true], ['b', false], ['a', true], ['c', true]])).toBe('a and c');
    expect(changedList([['a', false]])).toBe('');
  });
});

describe('changedSlots', () => {
  const labels = ['name', 'days', 'start'];
  it('names the slots that differ', () => {
    expect(changedSlots(labels, '["a",[1],5]', '["b",[1],6]')).toBe('name and start');
    expect(changedSlots(labels, '["a",[1],5]', '["a",[1],5]')).toBe('');
  });
  it('compares nested values by content', () => {
    expect(changedSlots(labels, '["a",[1,2],5]', '["a",[1,3],5]')).toBe('days');
  });
  it('is empty for unreadable input', () => {
    expect(changedSlots(labels, 'x', '[]')).toBe('');
  });
});
