import {
  normalizeTemplateItem,
  resolveOffsetDate,
  buildDraftsFromTemplate,
  formatOffsetLabel,
  anchorLabel,
  formatOffsetWithAnchor,
  wouldCreateCycle,
  expandTemplateItems,
  buildDraftsFromTemplateTree,
  getDirectBrokenRefItemIds,
  templateHasBrokenRefs,
  findTemplatesReferencing,
  buildApplyTree,
  flattenApplyTree,
  expandSelectionWithAncestors,
} from '../utils/templateUtils';
import type { TaskTemplate, TemplateAnchor, TemplateItem } from '../types';

const makeItem = (overrides: Partial<TemplateItem> = {}): TemplateItem => ({
  id: 'item-1',
  title: 'Pack bags',
  notes: '',
  optional: false,
  anchor: 'start',
  dueOffsetDays: null,
  deferOffsetDays: null,
  deadlineOffsetDays: null,
  windowStart: null,
  windowEnd: null,
  reminderOffsetMinutes: null,
  timeSegments: [],
  tags: [],
  category: null,
  priority: 0,
  effort: 0,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceFromCompletion: false,
  recurrenceCount: null,
  vacationPause: false,
  estimatedMinutes: null,
  chainEnabled: false,
  chainItems: [],
  subtasks: [],
  groupId: null,
  refTemplateId: null,
  refTemplateName: '',
  ...overrides,
});

describe('normalizeTemplateItem', () => {
  it('fills every default for an empty object', () => {
    const item = normalizeTemplateItem({});
    expect(item.id).toBeTruthy();
    expect(item.title).toBe('');
    expect(item.notes).toBe('');
    expect(item.optional).toBe(false);
    expect(item.anchor).toBe('start');
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
      anchor: 'end',
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
      anchor: 'end',
      dueOffsetDays: 0,
      deferOffsetDays: -1,
      timeSegments: ['morning'],
      tags: ['travel'],
      category: 'Home',
      priority: 3,
      effort: 2,
    });
  });

  it('coerces an unknown anchor value to "start"', () => {
    const raw = { anchor: 'middle' } as unknown as Partial<TemplateItem>;
    expect(normalizeTemplateItem(raw).anchor).toBe('start');
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
  const start = new Date('2026-06-20T09:00:00');
  const end = new Date('2026-06-27T09:00:00');
  const noAnchors = { start: null, end: null };

  it('maps all item fields onto the draft, resolved against the start anchor', () => {
    const item = makeItem({
      title: 'Pick up rental car',
      notes: 'Take photos of existing damage',
      anchor: 'start',
      dueOffsetDays: -1,
      deferOffsetDays: -2,
      timeSegments: ['afternoon'],
      tags: ['travel', 'car'],
      category: 'Errands',
      priority: 2,
      effort: 1,
    });
    const [draft] = buildDraftsFromTemplate([item], { start, end: null });
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

  it('resolves items anchored to "end" against the end anchor', () => {
    const item = makeItem({ anchor: 'end', dueOffsetDays: -2 });
    const [draft] = buildDraftsFromTemplate([item], { start, end });
    expect(new Date(draft.dueDate!).getDate()).toBe(25);
  });

  it('ignores the start anchor for an item anchored to "end"', () => {
    const item = makeItem({ anchor: 'end', dueOffsetDays: 0 });
    const [draft] = buildDraftsFromTemplate([item], { start, end: null });
    expect(draft.dueDate).toBeNull();
  });

  it('copies tags and timeSegments rather than aliasing the item arrays', () => {
    const item = makeItem({ tags: ['travel'], timeSegments: ['morning'] });
    const [draft] = buildDraftsFromTemplate([item], { start, end: null });
    expect(draft.tags).not.toBe(item.tags);
    expect(draft.timeSegments).not.toBe(item.timeSegments);
  });

  it('leaves dates null when no anchor is picked, even with offsets', () => {
    const item = makeItem({ dueOffsetDays: 0, deferOffsetDays: -1 });
    const [draft] = buildDraftsFromTemplate([item], noAnchors);
    expect(draft.dueDate).toBeNull();
    expect(draft.deferUntil).toBeNull();
  });

  it('builds one draft per item, in order', () => {
    const drafts = buildDraftsFromTemplate(
      [makeItem({ id: 'a', title: 'A' }), makeItem({ id: 'b', title: 'B' })],
      noAnchors
    );
    expect(drafts.map(d => d.title)).toEqual(['A', 'B']);
  });
});

describe('formatOffsetLabel', () => {
  it.each([
    [null, 'No date'],
    [0, 'Same day'],
    [-1, '1 day before'],
    [-3, '3 days before'],
    [1, '1 day after'],
    [2, '2 days after'],
  ] as Array<[number | null, string]>)('formats %p as %p', (offset, label) => {
    expect(formatOffsetLabel(offset)).toBe(label);
  });
});

describe('anchorLabel', () => {
  it('labels "start" and "end"', () => {
    expect(anchorLabel('start')).toBe('Start date');
    expect(anchorLabel('end')).toBe('End date');
  });
});

describe('formatOffsetWithAnchor', () => {
  it.each([
    [null, 'start', 'No date'],
    [0, 'start', 'On start date'],
    [0, 'end', 'On end date'],
    [-1, 'start', '1 day before start date'],
    [-3, 'end', '3 days before end date'],
    [1, 'start', '1 day after start date'],
    [2, 'end', '2 days after end date'],
  ] as Array<[number | null, TemplateAnchor, string]>)('formats %p / %p as %p', (offset, anchor, label) => {
    expect(formatOffsetWithAnchor(offset, anchor)).toBe(label);
  });
});

const makeTemplate = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
  id: 'tpl-1',
  name: 'Template',
  items: [],
  itemGroups: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  category: null,
  ...overrides,
});

const refItem = (id: string, refTemplateId: string, overrides: Partial<TemplateItem> = {}) =>
  makeItem({ id, refTemplateId, refTemplateName: refTemplateId, ...overrides });

describe('wouldCreateCycle', () => {
  it('flags self-reference', () => {
    expect(wouldCreateCycle([makeTemplate({ id: 'a' })], 'a', 'a')).toBe(true);
  });

  it('flags a direct 2-hop cycle (A -> B, adding B -> A)', () => {
    const templates = [
      makeTemplate({ id: 'a', items: [refItem('a1', 'b')] }),
      makeTemplate({ id: 'b', items: [] }),
    ];
    // A already references B, so adding B -> A would close the loop.
    expect(wouldCreateCycle(templates, 'b', 'a')).toBe(true);
    // But B -> some unrelated template C is fine.
    const withC = [...templates, makeTemplate({ id: 'c', items: [] })];
    expect(wouldCreateCycle(withC, 'b', 'c')).toBe(false);
  });

  it('flags a 3-hop cycle (A -> B -> C, adding C -> A)', () => {
    const templates = [
      makeTemplate({ id: 'a', items: [refItem('a1', 'b')] }),
      makeTemplate({ id: 'b', items: [refItem('b1', 'c')] }),
      makeTemplate({ id: 'c', items: [] }),
    ];
    expect(wouldCreateCycle(templates, 'c', 'a')).toBe(true);
  });

  it('does not flag a non-cyclic chain', () => {
    const templates = [
      makeTemplate({ id: 'a', items: [refItem('a1', 'b')] }),
      makeTemplate({ id: 'b', items: [refItem('b1', 'c')] }),
      makeTemplate({ id: 'c', items: [] }),
    ];
    expect(wouldCreateCycle(templates, 'a', 'c')).toBe(false);
    expect(wouldCreateCycle(templates, 'b', 'c')).toBe(false);
  });
});

describe('getDirectBrokenRefItemIds / templateHasBrokenRefs', () => {
  it('flags a directly dangling reference', () => {
    const template = makeTemplate({ id: 'trip', items: [refItem('t1', 'missing')] });
    const templatesById = new Map([[template.id, template]]);
    expect(getDirectBrokenRefItemIds(template, templatesById)).toEqual(new Set(['t1']));
    expect(templateHasBrokenRefs(template, templatesById)).toBe(true);
  });

  it('flags a transitively broken reference without flagging it directly', () => {
    const packing = makeTemplate({ id: 'packing', items: [refItem('p1', 'missing')] });
    const trip = makeTemplate({ id: 'trip', items: [refItem('t1', 'packing')] });
    const templatesById = new Map([[packing.id, packing], [trip.id, trip]]);
    expect(getDirectBrokenRefItemIds(trip, templatesById)).toEqual(new Set());
    expect(templateHasBrokenRefs(trip, templatesById)).toBe(true);
  });

  it('does not flag a healthy reference', () => {
    const packing = makeTemplate({ id: 'packing', items: [makeItem({ id: 'p1' })] });
    const trip = makeTemplate({ id: 'trip', items: [refItem('t1', 'packing')] });
    const templatesById = new Map([[packing.id, packing], [trip.id, trip]]);
    expect(templateHasBrokenRefs(trip, templatesById)).toBe(false);
  });

  it('does not infinite-loop on cyclic data', () => {
    const a = makeTemplate({ id: 'a', items: [refItem('a1', 'b')] });
    const b = makeTemplate({ id: 'b', items: [refItem('b1', 'a')] });
    const templatesById = new Map([[a.id, a], [b.id, b]]);
    expect(() => templateHasBrokenRefs(a, templatesById)).not.toThrow();
    expect(templateHasBrokenRefs(a, templatesById)).toBe(false);
  });
});

describe('findTemplatesReferencing', () => {
  it('finds every template that directly references the target', () => {
    const packing = makeTemplate({ id: 'packing' });
    const trip = makeTemplate({ id: 'trip', items: [refItem('t1', 'packing')] });
    const move = makeTemplate({ id: 'move', items: [refItem('m1', 'packing')] });
    const unrelated = makeTemplate({ id: 'unrelated' });
    const result = findTemplatesReferencing([packing, trip, move, unrelated], 'packing');
    expect(result.map(t => t.id).sort()).toEqual(['move', 'trip']);
  });

  it('returns [] when nothing references the target', () => {
    const packing = makeTemplate({ id: 'packing' });
    expect(findTemplatesReferencing([packing], 'packing')).toEqual([]);
  });
});

describe('expandTemplateItems / buildDraftsFromTemplateTree', () => {
  const end = new Date('2026-06-27T09:00:00');

  it('expands a nested template reference into its own leaf items', () => {
    const packing = makeTemplate({
      id: 'packing',
      items: [
        makeItem({ id: 'p1', title: 'Pack bag', anchor: 'end', dueOffsetDays: -1 }),
        makeItem({ id: 'p2', title: 'Charger' }),
      ],
    });
    const trip = makeTemplate({
      id: 'trip',
      items: [
        makeItem({ id: 't1', title: 'Book flights' }),
        refItem('t2', 'packing'),
      ],
    });
    const templatesById = new Map([[packing.id, packing], [trip.id, trip]]);
    const selected = new Set(['t1', 't2', 'p1', 'p2']);

    const expanded = expandTemplateItems(trip.items, trip.id, selected, templatesById);
    expect(expanded.map(e => e.item.title)).toEqual(['Book flights', 'Pack bag', 'Charger']);
    expect(expanded.filter(e => e.sourceTemplateId === 'packing')).toHaveLength(2);

    const drafts = buildDraftsFromTemplateTree(expanded, { start: null, end });
    expect(new Date(drafts[1].dueDate!).getDate()).toBe(26);
  });

  it('contributes zero leaves for a deleted or empty nested template', () => {
    const trip = makeTemplate({ id: 'trip', items: [refItem('t1', 'missing')] });
    const templatesById = new Map([[trip.id, trip]]);
    const expanded = expandTemplateItems(trip.items, trip.id, new Set(['t1']), templatesById);
    expect(expanded).toEqual([]);
  });

  it('only expands the selected descendant leaves', () => {
    const packing = makeTemplate({
      id: 'packing',
      items: [makeItem({ id: 'p1', title: 'Pack bag' }), makeItem({ id: 'p2', title: 'Charger' })],
    });
    const trip = makeTemplate({ id: 'trip', items: [refItem('t1', 'packing')] });
    const templatesById = new Map([[packing.id, packing], [trip.id, trip]]);
    const expanded = expandTemplateItems(trip.items, trip.id, new Set(['t1', 'p1']), templatesById);
    expect(expanded.map(e => e.item.title)).toEqual(['Pack bag']);
  });

  it('does not infinite-loop on a cyclic reference', () => {
    const a = makeTemplate({ id: 'a', items: [refItem('a1', 'b')] });
    const b = makeTemplate({ id: 'b', items: [refItem('b1', 'a')] });
    const templatesById = new Map([[a.id, a], [b.id, b]]);
    const expanded = expandTemplateItems(a.items, a.id, new Set(['a1', 'b1']), templatesById);
    expect(expanded).toEqual([]);
  });
});

describe('buildApplyTree / flattenApplyTree / expandSelectionWithAncestors', () => {
  it('builds a nested tree and flattens it back to leaves', () => {
    const packing = makeTemplate({
      id: 'packing',
      items: [makeItem({ id: 'p1', title: 'Pack bag' })],
    });
    const trip = makeTemplate({
      id: 'trip',
      items: [makeItem({ id: 't1', title: 'Book flights' }), refItem('t2', 'packing')],
    });
    const templatesById = new Map([[packing.id, packing], [trip.id, trip]]);

    const tree = buildApplyTree(trip.items, trip.id, templatesById);
    expect(tree).toHaveLength(2);
    expect(tree[1].children.map(c => c.item.title)).toEqual(['Pack bag']);
    expect(tree[1].broken).toBe(false);

    const leaves = flattenApplyTree(tree);
    expect(leaves.map(l => l.item.title)).toEqual(['Book flights', 'Pack bag']);
  });

  it('marks a node broken when its target is missing, contributing no children', () => {
    const trip = makeTemplate({ id: 'trip', items: [refItem('t1', 'missing')] });
    const templatesById = new Map([[trip.id, trip]]);
    const tree = buildApplyTree(trip.items, trip.id, templatesById);
    expect(tree[0].broken).toBe(true);
    expect(tree[0].children).toEqual([]);
    expect(flattenApplyTree(tree)).toEqual([]);
  });

  it('expandSelectionWithAncestors adds the ref item id whenever any descendant leaf is selected', () => {
    const packing = makeTemplate({
      id: 'packing',
      items: [makeItem({ id: 'p1' }), makeItem({ id: 'p2' })],
    });
    const trip = makeTemplate({ id: 'trip', items: [refItem('t2', 'packing')] });
    const templatesById = new Map([[packing.id, packing], [trip.id, trip]]);
    const tree = buildApplyTree(trip.items, trip.id, templatesById);

    const flat = expandSelectionWithAncestors(tree, new Set(['p1']));
    expect(flat).toEqual(new Set(['t2', 'p1']));

    const none = expandSelectionWithAncestors(tree, new Set());
    expect(none).toEqual(new Set());
  });
});
