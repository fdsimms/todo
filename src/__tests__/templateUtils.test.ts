import {
  normalizeTemplateItem,
  normalizeTemplateQuestion,
  resolveOffsetDate,
  buildDraftsFromTemplate,
  formatOffsetLabel,
  formatMinutesOffset,
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
  extractPlaceholders,
  itemPlaceholders,
  normalizePlaceholderName,
  withPlaceholder,
  withoutPlaceholder,
  substitutePlaceholders,
  substituteDraftPlaceholders,
  declaresRunPlaceholder,
  usesItemGroups,
  resolveApplyContainer,
  majorityCategory,
  findMissingRefs,
  templateHasMissingRefs,
  describeMissingRefs,
} from '../utils/templateUtils';
import type { TaskTemplate, TemplateAnchor, TemplateItem, TemplateQuestion } from '../types';

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
  deliverableKind: null,
  chainEnabled: false,
  chainItems: [],
  chainIndex: 0,
  subtasks: [],
  groupId: null,
  refTemplateId: null,
  refTemplateName: '',
  conditions: [],
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

  it('defaults chainIndex to 0 for a template item saved before the field existed', () => {
    expect(normalizeTemplateItem({}).chainIndex).toBe(0);
  });

  it('preserves a stored chainIndex', () => {
    expect(normalizeTemplateItem({ chainIndex: 2 }).chainIndex).toBe(2);
  });

  it('defaults deliverableKind to null for an item saved before the field existed', () => {
    expect(normalizeTemplateItem({}).deliverableKind).toBeNull();
  });

  it('preserves a stored deliverableKind', () => {
    expect(normalizeTemplateItem({ deliverableKind: 'date' }).deliverableKind).toBe('date');
  });
});

describe('normalizeTemplateQuestion', () => {
  it('falls back to "text" for an empty or unrecognised kind', () => {
    expect(normalizeTemplateQuestion({}).kind).toBe('text');
    const raw = { kind: 'essay' } as unknown as Partial<TemplateQuestion>;
    expect(normalizeTemplateQuestion(raw).kind).toBe('text');
  });

  it('preserves each real kind, including people', () => {
    expect(normalizeTemplateQuestion({ kind: 'number' }).kind).toBe('number');
    expect(normalizeTemplateQuestion({ kind: 'choice' }).kind).toBe('choice');
    expect(normalizeTemplateQuestion({ kind: 'people' }).kind).toBe('people');
  });

  // A people question fills no blank and starts every run at nobody — forced
  // here rather than merely left blank by the editor, so a hand-edited or
  // restored row can't carry a stray name into a title substitution, or a
  // stray default into an unattended run's answer (see personIdsForAnswers).
  it('clears name and defaultValue for a people question regardless of what raw claims', () => {
    const question = normalizeTemplateQuestion({
      kind: 'people',
      name: 'guests',
      defaultValue: 'p1',
    });
    expect(question.name).toBe('');
    expect(question.defaultValue).toBe('');
  });

  it('keeps name and defaultValue for every other kind', () => {
    expect(normalizeTemplateQuestion({ kind: 'text', name: 'city', defaultValue: 'Portland' }))
      .toMatchObject({ name: 'city', defaultValue: 'Portland' });
    // 'choice' already had no author-set default before 'people' existed —
    // unaffected by this change, confirmed so the two don't drift apart.
    expect(normalizeTemplateQuestion({ kind: 'choice', name: 'type', defaultValue: 'Work' }))
      .toMatchObject({ name: 'type', defaultValue: '' });
  });

  it('does not crash on unknown future fields', () => {
    const raw = { kind: 'people', extra: true } as unknown as Partial<TemplateQuestion>;
    expect(() => normalizeTemplateQuestion(raw)).not.toThrow();
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

  it('carries chainIndex onto the draft, so a task can start mid-chain (#788)', () => {
    const item = makeItem({
      chainEnabled: true,
      chainItems: [{ id: 'c1', title: 'Warm up', estimatedMinutes: null }, { id: 'c2', title: 'Main set', estimatedMinutes: null }],
      chainIndex: 1,
    });
    const [draft] = buildDraftsFromTemplate([item], noAnchors);
    expect(draft.chainIndex).toBe(1);
  });

  it('carries deliverableKind onto the draft, so an applied item asks on completion (#1471)', () => {
    const [draft] = buildDraftsFromTemplate([makeItem({ deliverableKind: 'date' })], noAnchors);
    expect(draft.deliverableKind).toBe('date');
  });

  it('leaves deliverableKind null for an ordinary item', () => {
    const [draft] = buildDraftsFromTemplate([makeItem()], noAnchors);
    expect(draft.deliverableKind).toBeNull();
  });

  it('clamps chainIndex against a chain that has since shrunk', () => {
    const item = makeItem({
      chainEnabled: true,
      chainItems: [{ id: 'c1', title: 'Only step', estimatedMinutes: null }],
      chainIndex: 4,
    });
    const [draft] = buildDraftsFromTemplate([item], noAnchors);
    expect(draft.chainIndex).toBe(0);
  });

  it('defaults chainIndex to 0 for an item with no chain steps', () => {
    const [draft] = buildDraftsFromTemplate([makeItem()], noAnchors);
    expect(draft.chainIndex).toBe(0);
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

describe('formatMinutesOffset', () => {
  it('formats whole days', () => {
    expect(formatMinutesOffset(1440)).toBe('1 day before');
    expect(formatMinutesOffset(2880)).toBe('2 days before');
  });

  it('formats whole hours', () => {
    expect(formatMinutesOffset(60)).toBe('1 hour before');
    expect(formatMinutesOffset(120)).toBe('2 hours before');
  });

  it('falls back to raw minutes otherwise', () => {
    expect(formatMinutesOffset(45)).toBe('45 min before');
    expect(formatMinutesOffset(90)).toBe('90 min before');
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
  questions: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  category: null,
  applyContainer: 'stack',
  schedule: null,
  scheduleLastFiredKey: null,
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

describe('extractPlaceholders', () => {
  it('returns distinct names in first-appearance order', () => {
    const items = [
      makeItem({ id: 'i1', title: 'Book {where}' }),
      makeItem({ id: 'i2', title: 'Tell {who} about {where}' }),
    ];
    expect(extractPlaceholders(items)).toEqual(['where', 'who']);
  });

  it('reads notes, subtasks and chain steps too', () => {
    const items = [makeItem({
      title: 'Pack',
      notes: 'for {trip}',
      subtasks: [{ id: 's1', title: 'Charge the {device}' }],
      chainItems: [{ id: 'c1', title: 'Confirm with {who}', estimatedMinutes: null }],
    })];
    expect(extractPlaceholders(items)).toEqual(['trip', 'device', 'who']);
  });

  it('excludes the reserved run placeholder, which is bound to the run name', () => {
    expect(extractPlaceholders([makeItem({ title: 'Put in for PTO for {run}' })])).toEqual([]);
  });

  it('matches case-insensitively and normalizes to lowercase', () => {
    expect(extractPlaceholders([makeItem({ title: '{Where} then {WHERE}' })])).toEqual(['where']);
  });

  it('ignores braces that are not placeholders', () => {
    expect(extractPlaceholders([makeItem({ title: 'Fix {} and {2} and {' })])).toEqual([]);
  });
});

describe('itemPlaceholders', () => {
  it('reads all four fields of one item, in first-appearance order', () => {
    const item = makeItem({
      title: 'Pack for {where}',
      notes: 'ask {who}',
      subtasks: [{ id: 's1', title: 'Charge the {device}' }],
      chainItems: [{ id: 'c1', title: 'Confirm with {who}', estimatedMinutes: null }],
    });
    expect(itemPlaceholders(item)).toEqual(['where', 'who', 'device']);
  });

  // The apply sheet hides `run` (it's bound to the run name); the editor can't,
  // or a title that is nothing but `{run}` would show as having no blanks.
  it('includes run, unlike extractPlaceholders', () => {
    const item = makeItem({ title: 'Put in for PTO for {run}' });
    expect(itemPlaceholders(item)).toEqual(['run']);
    expect(extractPlaceholders([item])).toEqual([]);
  });
});

describe('normalizePlaceholderName', () => {
  it('lowercases, trims and unwraps braces the user typed', () => {
    expect(normalizePlaceholderName('  {Where}  ')).toBe('where');
    expect(normalizePlaceholderName('Who Is Coming')).toBe('who is coming');
  });

  it('collapses inner whitespace so the name matches what the pattern reads back', () => {
    expect(normalizePlaceholderName('who  is\tcoming')).toBe('who is coming');
  });

  it('refuses a name the pattern would not match again', () => {
    expect(normalizePlaceholderName('')).toBeNull();
    expect(normalizePlaceholderName('   ')).toBeNull();
    expect(normalizePlaceholderName('2 nights')).toBeNull();  // must start with a letter
    expect(normalizePlaceholderName('where?')).toBeNull();
    expect(normalizePlaceholderName('a{b}c')).toBeNull();
  });

  it('accepts a name that survives a round trip through the extractor', () => {
    const name = normalizePlaceholderName('{Check-in Date}')!;
    expect(extractPlaceholders([makeItem({ title: `Book {${name}}` })])).toEqual([name]);
  });
});

describe('withPlaceholder', () => {
  it('appends the token to a title', () => {
    expect(withPlaceholder('Book flights', 'where')).toBe('Book flights {where}');
  });

  it('is the whole title when there was none', () => {
    expect(withPlaceholder('', 'where')).toBe('{where}');
    expect(withPlaceholder('   ', 'where')).toBe('{where}');
  });

  it('leaves a name the text already declares where the user put it', () => {
    expect(withPlaceholder('Book {where} flights', 'where')).toBe('Book {where} flights');
    expect(withPlaceholder('Book {Where} flights', 'where')).toBe('Book {Where} flights');
  });

  it('does not double the space before the token', () => {
    expect(withPlaceholder('Book flights ', 'where')).toBe('Book flights {where}');
  });
});

describe('withoutPlaceholder', () => {
  it('removes the token and tidies what it left behind', () => {
    expect(withoutPlaceholder('Book flights to {where}', 'where')).toBe('Book flights to');
    expect(withoutPlaceholder('Pack {what} bags', 'what')).toBe('Pack bags');
    expect(withoutPlaceholder('Call {who}, then pack', 'who')).toBe('Call, then pack');
  });

  it('leaves other blanks alone', () => {
    expect(withoutPlaceholder('Tell {who} about {where}', 'who')).toBe('Tell about {where}');
  });

  it('matches case-insensitively, like every other read', () => {
    expect(withoutPlaceholder('Book {Where}', 'where')).toBe('Book');
  });

  // Same guarantee substitutePlaceholders makes: text this doesn't touch is
  // never quietly reformatted.
  it('returns text that never declared the name byte for byte', () => {
    expect(withoutPlaceholder('Buy  tickets  -', 'where')).toBe('Buy  tickets  -');
    expect(withoutPlaceholder('Book {other}', 'where')).toBe('Book {other}');
  });
});

describe('placeholder arithmetic', () => {
  const values = { nights: '7', where: 'Denver' };

  it('does the sum a packing list actually needs', () => {
    expect(substitutePlaceholders('Pack {nights} shirts', values)).toBe('Pack 7 shirts');
    expect(substitutePlaceholders('Pack {nights - 2} sweaters', values)).toBe('Pack 5 sweaters');
    expect(substitutePlaceholders('Pack {nights + 1} pairs of socks', values)).toBe('Pack 8 pairs of socks');
    expect(substitutePlaceholders('Pack {nights * 2} snacks', values)).toBe('Pack 14 snacks');
  });

  // Three and a half pairs of jeans means four — coming up short is the failure
  // that matters when the answer is what to put in a bag.
  it('rounds a fraction up', () => {
    expect(substitutePlaceholders('Pack {nights / 2} pairs of jeans', values)).toBe('Pack 4 pairs of jeans');
    expect(substitutePlaceholders('Pack {nights / 7} bags', values)).toBe('Pack 1 bags');
  });

  it('never goes below zero', () => {
    expect(substitutePlaceholders('Pack {nights - 20} sweaters', values)).toBe('Pack 0 sweaters');
  });

  it('writes the answer verbatim when no arithmetic is asked for', () => {
    expect(substitutePlaceholders('Book a hotel in {where}', values)).toBe('Book a hotel in Denver');
  });

  it('drops a sum it can\'t do rather than printing one that\'s wrong', () => {
    expect(substitutePlaceholders('Pack {where - 2} shirts', values)).toBe('Pack shirts');
    expect(substitutePlaceholders('Pack {missing / 2} shirts', values)).toBe('Pack shirts');
    expect(substitutePlaceholders('Pack {nights / 0} shirts', values)).toBe('Pack shirts');
  });

  it('spaces around the operator are optional', () => {
    expect(substitutePlaceholders('{nights-2} and {nights - 2}', values)).toBe('5 and 5');
  });

  it('reports the blank a sum reads, so it\'s asked for once', () => {
    const item = makeItem({ title: 'Pack {nights} shirts', notes: 'and {nights / 2} pairs of jeans' });
    expect(extractPlaceholders([item])).toEqual(['nights']);
  });

  it('refuses to mint a blank whose name would read as a sum', () => {
    expect(normalizePlaceholderName('nights-2')).toBeNull();
    expect(normalizePlaceholderName('check-in')).toBe('check-in');
  });

  it('takes the sums with the blank when it\'s removed', () => {
    expect(withoutPlaceholder('Pack {nights / 2} pairs of jeans', 'nights')).toBe('Pack pairs of jeans');
  });
});

describe('substitutePlaceholders', () => {
  it('substitutes a value', () => {
    expect(substitutePlaceholders('Book {where}', { where: 'Denver' })).toBe('Book Denver');
  });

  it('matches the name case-insensitively', () => {
    expect(substitutePlaceholders('Book {Where}', { where: 'Denver' })).toBe('Book Denver');
  });

  it('replaces every occurrence', () => {
    expect(substitutePlaceholders('{x} and {x}', { x: 'a' })).toBe('a and a');
  });

  it('leaves text with no placeholders byte for byte, including odd spacing', () => {
    expect(substitutePlaceholders('Buy  tickets  -', {})).toBe('Buy  tickets  -');
  });

  it('drops an unfilled placeholder rather than leaving a literal brace in a task title', () => {
    expect(substitutePlaceholders('Put in for PTO for {what}', {})).toBe('Put in for PTO for');
    expect(substitutePlaceholders('Put in for PTO for {what}', { what: '   ' })).toBe('Put in for PTO for');
  });

  it('tidies the gap and the dangling separator a dropped value leaves behind', () => {
    expect(substitutePlaceholders('Pack {what} bags', {})).toBe('Pack bags');
    expect(substitutePlaceholders('Book flights — {where}', {})).toBe('Book flights');
    expect(substitutePlaceholders('Call {who}, then pack', {})).toBe('Call, then pack');
  });

  it('trims the value it substitutes', () => {
    expect(substitutePlaceholders('Book {where}', { where: '  Denver  ' })).toBe('Book Denver');
  });

  it('is not left stateful by a previous call (the pattern is a /g regex)', () => {
    const text = 'Book {where}';
    expect(substitutePlaceholders(text, { where: 'A' })).toBe('Book A');
    expect(substitutePlaceholders(text, { where: 'B' })).toBe('Book B');
    expect(substitutePlaceholders(text, { where: 'C' })).toBe('Book C');
  });
});

describe('substituteDraftPlaceholders', () => {
  it('substitutes into title, notes and chain steps', () => {
    const out = substituteDraftPlaceholders({
      title: 'Pack for {trip}',
      notes: 'ask {who}',
      chainItems: [{ id: 'c1', title: 'Confirm {who}', estimatedMinutes: null }],
    }, { trip: 'Denver', who: 'Dan', when: 'Friday' });
    expect(out.title).toBe('Pack for Denver');
    expect(out.notes).toBe('ask Dan');
    expect(out.chainItems).toEqual([{ id: 'c1', title: 'Confirm Dan', estimatedMinutes: null }]);
  });

  it('leaves an absent title/notes/chain absent rather than turning it into a blank string', () => {
    expect(substituteDraftPlaceholders({ dueDate: null }, {})).toEqual({ dueDate: null });
  });
});

describe('declaresRunPlaceholder', () => {
  it('is true when {run} appears anywhere on an item', () => {
    expect(declaresRunPlaceholder([makeItem({ title: 'PTO for {run}' })])).toBe(true);
    expect(declaresRunPlaceholder([makeItem({ notes: 'for {run}' })])).toBe(true);
    expect(declaresRunPlaceholder([makeItem({
      subtasks: [{ id: 's', title: '{run}' }],
    })])).toBe(true);
  });

  it('is false for ordinary items and for other placeholders', () => {
    expect(declaresRunPlaceholder([makeItem({ title: 'Buy tickets' })])).toBe(false);
    expect(declaresRunPlaceholder([makeItem({ title: 'Book {where}' })])).toBe(false);
  });
});

describe('usesItemGroups / resolveApplyContainer', () => {
  const grouped = makeTemplate({
    id: 'trip',
    itemGroups: [{ id: 'g1', title: 'Flights', sortOrder: 1 }],
    questions: [],
    items: [makeItem({ id: 'i1', groupId: 'g1' })],
  });
  const plain = makeTemplate({ id: 'plain', items: [makeItem({ id: 'i2' })] });
  const byId = new Map([[grouped.id, grouped], [plain.id, plain]]);

  const expandedOf = (t: TaskTemplate) => t.items.map(item => ({ item, sourceTemplateId: t.id }));

  it('detects a live item group', () => {
    expect(usesItemGroups(expandedOf(grouped), byId)).toBe(true);
    expect(usesItemGroups(expandedOf(plain), byId)).toBe(false);
  });

  it('ignores a groupId whose group no longer exists', () => {
    const orphan = makeTemplate({ id: 'orphan', items: [makeItem({ id: 'i3', groupId: 'deleted' })] });
    expect(usesItemGroups(expandedOf(orphan), new Map([[orphan.id, orphan]]))).toBe(false);
  });

  it('upgrades stack to project when item groups are in play — a stack cannot hold a stack', () => {
    expect(resolveApplyContainer('stack', expandedOf(grouped), byId)).toBe('project');
  });

  it('leaves stack alone without item groups', () => {
    expect(resolveApplyContainer('stack', expandedOf(plain), byId)).toBe('stack');
  });

  it('never changes an explicit project or none', () => {
    expect(resolveApplyContainer('project', expandedOf(grouped), byId)).toBe('project');
    expect(resolveApplyContainer('none', expandedOf(grouped), byId)).toBe('none');
  });

  it('never changes an explicit task, even with item groups in play — they flatten instead of upgrading', () => {
    expect(resolveApplyContainer('task', expandedOf(grouped), byId)).toBe('task');
  });

  it('sees item groups contributed by a nested template, not just the top-level one', () => {
    // The expanded list spans templates, so the check has to be per-source.
    const expanded = [...expandedOf(plain), ...expandedOf(grouped)];
    expect(resolveApplyContainer('stack', expanded, byId)).toBe('project');
  });
});

describe('majorityCategory', () => {
  it('is null for an empty list or when nobody names a category', () => {
    expect(majorityCategory([])).toBeNull();
    expect(majorityCategory([null, null])).toBeNull();
  });

  it('picks the one category everyone shares', () => {
    expect(majorityCategory(['Home', 'Home', 'Home'])).toBe('Home');
  });

  it('picks whichever category is named most', () => {
    expect(majorityCategory(['Home', 'Work', 'Home'])).toBe('Home');
  });

  it('breaks a tie in favor of whichever category appeared first', () => {
    expect(majorityCategory(['Work', 'Home'])).toBe('Work');
  });

  it('does not let an uncategorized minority outvote a real category', () => {
    expect(majorityCategory(['Home', 'Home', null])).toBe('Home');
  });
});

describe('findMissingRefs', () => {
  const categories = ['Errands', 'Home'];
  const tags = ['travel', 'car'];

  it('returns nothing when every name still resolves', () => {
    const item = makeItem({ category: 'Errands', tags: ['travel', 'car'] });
    expect(findMissingRefs(item, categories, tags)).toEqual([]);
  });

  it('returns nothing for an item with no category and no tags', () => {
    expect(findMissingRefs(makeItem(), categories, tags)).toEqual([]);
  });

  it('flags a category that no longer exists', () => {
    const item = makeItem({ category: 'Deleted' });
    expect(findMissingRefs(item, categories, tags)).toEqual([
      { kind: 'category', name: 'Deleted' },
    ]);
  });

  it('flags each tag that no longer exists, keeping the item order', () => {
    const item = makeItem({ tags: ['travel', 'gone', 'alsogone'] });
    expect(findMissingRefs(item, categories, tags)).toEqual([
      { kind: 'tag', name: 'gone' },
      { kind: 'tag', name: 'alsogone' },
    ]);
  });

  it('reports the category before the tags when both are missing', () => {
    const item = makeItem({ category: 'Deleted', tags: ['gone'] });
    expect(findMissingRefs(item, categories, tags)).toEqual([
      { kind: 'category', name: 'Deleted' },
      { kind: 'tag', name: 'gone' },
    ]);
  });

  it('matches exactly, the way getCategoryByName resolves a name', () => {
    // A rename to different casing leaves the old name genuinely unresolvable.
    expect(findMissingRefs(makeItem({ category: 'errands' }), categories, tags)).toEqual([
      { kind: 'category', name: 'errands' },
    ]);
  });

  it('skips a reference item, whose task fields are ignored at apply time', () => {
    const item = makeItem({
      refTemplateId: 'tpl-2',
      category: 'Deleted',
      tags: ['gone'],
    });
    expect(findMissingRefs(item, categories, tags)).toEqual([]);
  });

  it('flags everything when nothing is registered at all', () => {
    const item = makeItem({ category: 'Errands', tags: ['travel'] });
    expect(findMissingRefs(item, [], [])).toEqual([
      { kind: 'category', name: 'Errands' },
      { kind: 'tag', name: 'travel' },
    ]);
  });
});

describe('templateHasMissingRefs', () => {
  const categories = ['Home'];
  const tags = ['travel'];

  it('is false for a template whose items all resolve', () => {
    const tpl = makeTemplate({ items: [makeItem({ category: 'Home', tags: ['travel'] })] });
    expect(templateHasMissingRefs(tpl, categories, tags)).toBe(false);
  });

  it('is false for a template with no items', () => {
    expect(templateHasMissingRefs(makeTemplate({ items: [] }), categories, tags)).toBe(false);
  });

  it('is true when any one item is stale', () => {
    const tpl = makeTemplate({
      items: [makeItem({ id: 'a', category: 'Home' }), makeItem({ id: 'b', category: 'Gone' })],
    });
    expect(templateHasMissingRefs(tpl, categories, tags)).toBe(true);
  });

  it('does not recurse into a nested template — that one reports for itself', () => {
    const nested = makeTemplate({ id: 'child', items: [makeItem({ category: 'Gone' })] });
    const parent = makeTemplate({
      id: 'parent',
      items: [makeItem({ refTemplateId: nested.id, refTemplateName: 'Child' })],
    });
    expect(templateHasMissingRefs(parent, categories, tags)).toBe(false);
    expect(templateHasMissingRefs(nested, categories, tags)).toBe(true);
  });
});

describe('describeMissingRefs', () => {
  it('returns null when nothing is missing', () => {
    expect(describeMissingRefs([])).toBeNull();
  });

  it('describes a single missing category', () => {
    expect(describeMissingRefs([{ kind: 'category', name: 'Errands' }]))
      .toBe('Category "Errands" no longer exists');
  });

  it('describes a single missing tag, capitalised as the start of the sentence', () => {
    expect(describeMissingRefs([{ kind: 'tag', name: 'car' }]))
      .toBe('Tag "car" no longer exists');
  });

  it('pluralises the verb and the noun for several missing tags', () => {
    expect(describeMissingRefs([
      { kind: 'tag', name: 'car' },
      { kind: 'tag', name: 'boat' },
    ])).toBe('Tags "car", "boat" no longer exist');
  });

  it('joins a category and tags into one sentence, lower-casing the second noun', () => {
    expect(describeMissingRefs([
      { kind: 'category', name: 'Errands' },
      { kind: 'tag', name: 'car' },
    ])).toBe('Category "Errands" and tag "car" no longer exist');
  });

  it('handles several of both', () => {
    expect(describeMissingRefs([
      { kind: 'category', name: 'A' },
      { kind: 'category', name: 'B' },
      { kind: 'tag', name: 'x' },
      { kind: 'tag', name: 'y' },
    ])).toBe('Categories "A", "B" and tags "x", "y" no longer exist');
  });
});
