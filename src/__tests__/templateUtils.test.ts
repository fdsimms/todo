import {
  normalizeTemplateItem,
  resolveOffsetDate,
  buildDraftsFromTemplate,
  formatOffsetLabel,
} from '../utils/templateUtils';
import type { TemplateItem } from '../types';

const makeItem = (overrides: Partial<TemplateItem> = {}): TemplateItem => ({
  id: 'item-1',
  title: 'Pack bags',
  notes: '',
  optional: false,
  dueOffsetDays: null,
  deferOffsetDays: null,
  timeSegments: [],
  tags: [],
  category: null,
  priority: 0,
  effort: 0,
  ...overrides,
});

describe('normalizeTemplateItem', () => {
  it('fills every default for an empty object', () => {
    const item = normalizeTemplateItem({});
    expect(item.id).toBeTruthy();
    expect(item.title).toBe('');
    expect(item.notes).toBe('');
    expect(item.optional).toBe(false);
    expect(item.dueOffsetDays).toBeNull();
    expect(item.deferOffsetDays).toBeNull();
    expect(item.timeSegments).toEqual([]);
    expect(item.tags).toEqual([]);
    expect(item.category).toBeNull();
    expect(item.priority).toBe(0);
    expect(item.effort).toBe(0);
  });

  it('preserves provided fields', () => {
    const item = normalizeTemplateItem({
      id: 'abc',
      title: 'Trash',
      optional: true,
      dueOffsetDays: 0,
      deferOffsetDays: -1,
      timeSegments: ['morning'],
      tags: ['travel'],
      category: 'Home',
      priority: 3,
      effort: 2,
    });
    expect(item).toMatchObject({
      id: 'abc',
      title: 'Trash',
      optional: true,
      dueOffsetDays: 0,
      deferOffsetDays: -1,
      timeSegments: ['morning'],
      tags: ['travel'],
      category: 'Home',
      priority: 3,
      effort: 2,
    });
  });

  it('does not crash on unknown future fields', () => {
    const raw = { title: 'X', showWhen: { questionId: 'q1' } } as Partial<TemplateItem>;
    expect(() => normalizeTemplateItem(raw)).not.toThrow();
    expect(normalizeTemplateItem(raw).title).toBe('X');
  });

  it('keeps a zero offset (does not coerce to null)', () => {
    expect(normalizeTemplateItem({ dueOffsetDays: 0 }).dueOffsetDays).toBe(0);
  });
});

describe('resolveOffsetDate', () => {
  const anchor = new Date('2026-06-20T15:30:00');

  it('returns null without an anchor', () => {
    expect(resolveOffsetDate(null, -1)).toBeNull();
  });

  it('returns null without an offset', () => {
    expect(resolveOffsetDate(anchor, null)).toBeNull();
  });

  it('normalizes to noon on the anchor day for offset 0', () => {
    const d = new Date(resolveOffsetDate(anchor, 0)!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });

  it('handles negative offsets (days before)', () => {
    const d = new Date(resolveOffsetDate(anchor, -3)!);
    expect(d.getDate()).toBe(17);
    expect(d.getHours()).toBe(12);
  });

  it('handles positive offsets (days after)', () => {
    const d = new Date(resolveOffsetDate(anchor, 2)!);
    expect(d.getDate()).toBe(22);
  });

  it('crosses month boundaries', () => {
    const d = new Date(resolveOffsetDate(new Date('2026-07-01T08:00:00'), -2)!);
    expect(d.getMonth()).toBe(5); // June
    expect(d.getDate()).toBe(29);
  });
});

describe('buildDraftsFromTemplate', () => {
  const anchor = new Date('2026-06-20T09:00:00');

  it('maps all item fields onto the draft', () => {
    const item = makeItem({
      title: 'Pick up rental car',
      notes: 'Take photos of existing damage',
      dueOffsetDays: -1,
      deferOffsetDays: -2,
      timeSegments: ['afternoon'],
      tags: ['travel', 'car'],
      category: 'Errands',
      priority: 2,
      effort: 1,
    });
    const [draft] = buildDraftsFromTemplate([item], anchor);
    expect(draft.title).toBe('Pick up rental car');
    expect(draft.notes).toBe('Take photos of existing damage');
    expect(new Date(draft.dueDate!).getDate()).toBe(19);
    expect(new Date(draft.deferUntil!).getDate()).toBe(18);
    expect(draft.timeSegments).toEqual(['afternoon']);
    expect(draft.tags).toEqual(['travel', 'car']);
    expect(draft.category).toBe('Errands');
    expect(draft.priority).toBe(2);
    expect(draft.effort).toBe(1);
  });

  it('copies tags and timeSegments rather than aliasing the item arrays', () => {
    const item = makeItem({ tags: ['travel'], timeSegments: ['morning'] });
    const [draft] = buildDraftsFromTemplate([item], anchor);
    expect(draft.tags).not.toBe(item.tags);
    expect(draft.timeSegments).not.toBe(item.timeSegments);
  });

  it('leaves dates null when no anchor is picked, even with offsets', () => {
    const item = makeItem({ dueOffsetDays: 0, deferOffsetDays: -1 });
    const [draft] = buildDraftsFromTemplate([item], null);
    expect(draft.dueDate).toBeNull();
    expect(draft.deferUntil).toBeNull();
  });

  it('builds one draft per item, in order', () => {
    const drafts = buildDraftsFromTemplate(
      [makeItem({ id: 'a', title: 'A' }), makeItem({ id: 'b', title: 'B' })],
      null
    );
    expect(drafts.map(d => d.title)).toEqual(['A', 'B']);
  });
});

describe('formatOffsetLabel', () => {
  it.each([
    [null, 'No date'],
    [0, 'On anchor day'],
    [-1, '1 day before'],
    [-3, '3 days before'],
    [1, '1 day after'],
    [2, '2 days after'],
  ] as Array<[number | null, string]>)('formats %p as %p', (offset, label) => {
    expect(formatOffsetLabel(offset)).toBe(label);
  });
});
