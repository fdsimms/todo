import { flatRowOrder, laterRowOrder, todayRowOrder, unscheduledRowOrder, type OrderableRow } from '../utils/rowOrder';
import type { LaterListItem } from '../utils/taskGrouping';
import type { Task, TaskGroup } from '../types';

const task = (id: string) => ({ id });
const taskRow = (id: string): OrderableRow => ({ type: 'task', task: task(id) });
const groupRow = (id: string, ...children: string[]): OrderableRow => ({
  type: 'group',
  group: { id },
  children: children.map(task),
});
const header: OrderableRow = { type: 'header' };
const always = () => true;
const never = () => false;

describe('todayRowOrder', () => {
  it('walks the tasks in the order they are drawn, skipping headers and rows that are not tasks', () => {
    const data = [taskRow('a'), header, taskRow('b'), { type: 'context' } as OrderableRow, taskRow('c')];
    expect(todayRowOrder([], data, always).ids).toEqual(['a', 'b', 'c']);
  });

  it('puts the project bands first, since they are drawn above the list', () => {
    const order = todayRowOrder([[taskRow('band1'), groupRow('s', 'band2')]], [taskRow('a')], always);
    expect(order.ids).toEqual(['band1', 'band2', 'a']);
  });

  it('has a stack\'s members only while the stack is open', () => {
    const data = [taskRow('a'), groupRow('stack', 'x', 'y'), taskRow('b')];
    expect(todayRowOrder([], data, always).ids).toEqual(['a', 'x', 'y', 'b']);
    expect(todayRowOrder([], data, never).ids).toEqual(['a', 'b']);
  });

  it('scrolls a task to its own row and a stack\'s member to the stack\'s, and a band\'s to nothing', () => {
    const order = todayRowOrder([[taskRow('band')]], [taskRow('a'), groupRow('stack', 'x')], always);
    expect(order.slots.get('a')).toBe('a');
    expect(order.slots.get('x')).toBe('g-stack');
    expect(order.slots.has('band')).toBe(false);
  });

  it('lists a task once, at its first place', () => {
    const order = todayRowOrder([], [taskRow('a'), groupRow('stack', 'a', 'b')], always);
    expect(order.ids).toEqual(['a', 'b']);
    expect(order.slots.get('a')).toBe('a');
  });

  it('is empty for an empty list', () => {
    expect(todayRowOrder([], [], always).ids).toEqual([]);
  });
});

describe('flatRowOrder', () => {
  it('slots each task to its index and a stack\'s members to the stack\'s', () => {
    const order = flatRowOrder([taskRow('a'), groupRow('s', 'x', 'y'), taskRow('b')], always);
    expect(order.ids).toEqual(['a', 'x', 'y', 'b']);
    expect(order.slots.get('a')).toBe(0);
    expect(order.slots.get('x')).toBe(1);
    expect(order.slots.get('y')).toBe(1);
    expect(order.slots.get('b')).toBe(2);
  });

  it('skips a folded stack', () => {
    expect(flatRowOrder([taskRow('a'), groupRow('s', 'x')], never).ids).toEqual(['a']);
  });
});

describe('unscheduledRowOrder', () => {
  it('is the list as drawn, by index', () => {
    const order = unscheduledRowOrder([task('a'), task('b')]);
    expect(order.ids).toEqual(['a', 'b']);
    expect(order.slots.get('b')).toBe(1);
  });
});

describe('laterRowOrder', () => {
  const t = (id: string) => ({ id } as Task);
  const items: LaterListItem[] = [
    { type: 'header', label: 'Tomorrow', key: 'h-Tomorrow', dateISO: null },
    { type: 'task', task: t('a'), key: 'a' },
    { type: 'stack', key: 'stack-1', group: { id: 'g' } as TaskGroup, tasks: ['s1', 's2', 's3', 's4'].map(t) },
    { type: 'task', task: t('b'), key: 'b' },
  ];

  it('skips headers and keeps the day order', () => {
    expect(laterRowOrder(items, new Set(), new Set(), 2).ids).toEqual(['a', 'b']);
  });

  it('walks into a stack only when it is opened', () => {
    const open = laterRowOrder(items, new Set(['stack-1']), new Set(), 2);
    expect(open.ids).toEqual(['a', 's1', 's2', 'b']);
    expect(open.slots.get('s2')).toBe('stack-1');
  });

  it('shows every member once "Show more" is pressed', () => {
    const all = laterRowOrder(items, new Set(['stack-1']), new Set(['stack-1']), 2);
    expect(all.ids).toEqual(['a', 's1', 's2', 's3', 's4', 'b']);
  });

  it('slots each task to its list item\'s key, which is not always its id', () => {
    const repeated: LaterListItem[] = [{ type: 'task', task: t('a'), key: 'a-2' }];
    expect(laterRowOrder(repeated, new Set(), new Set(), 5).slots.get('a')).toBe('a-2');
  });

  it('lists a task drawn on two days once', () => {
    const twice: LaterListItem[] = [
      { type: 'task', task: t('a'), key: 'a' },
      { type: 'task', task: t('a'), key: 'a-2' },
    ];
    expect(laterRowOrder(twice, new Set(), new Set(), 5).ids).toEqual(['a']);
  });
});
