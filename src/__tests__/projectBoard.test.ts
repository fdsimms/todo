import { boardColumns, boardMove, columnIndexAt, insertIndexAt, LOOSE_COLUMN_KEY } from '../utils/projectBoard';
import type { ProjectListItem } from '../utils/projectStacks';
import type { Task, TaskGroup } from '../types';

const task = (id: string, groupId: string | null = null): Task => ({ id, groupId } as Task);
const group = (id: string): TaskGroup => ({ id, title: id } as TaskGroup);
const loose = (id: string): ProjectListItem => ({ type: 'task', task: task(id) });
const section = (id: string, children: string[]): ProjectListItem =>
  ({ type: 'group', group: group(id), children: children.map(c => task(c, id)) });

// a, [S: s1 s2], b, [T: empty]
const items: ProjectListItem[] = [loose('a'), section('S', ['s1', 's2']), loose('b'), section('T', [])];

describe('boardColumns', () => {
  it('puts the loose tasks first, then each section in list order', () => {
    const columns = boardColumns(items);
    expect(columns.map(c => c.key)).toEqual([LOOSE_COLUMN_KEY, 'S', 'T']);
    expect(columns[0].tasks.map(t => t.id)).toEqual(['a', 'b']);
    expect(columns[1].tasks.map(t => t.id)).toEqual(['s1', 's2']);
    expect(columns[2].tasks).toEqual([]);
  });

  it('keeps an empty no-section column so a card can leave a section', () => {
    const columns = boardColumns([section('S', ['s1'])]);
    expect(columns[0]).toEqual({ key: LOOSE_COLUMN_KEY, group: null, tasks: [] });
  });
});

describe('columnIndexAt', () => {
  const frames = [{ x: 0, width: 100 }, { x: 120, width: 100 }, { x: 240, width: 100 }];
  it('answers the column under the finger', () => {
    expect(columnIndexAt(frames, 150)).toBe(1);
  });
  it('answers the nearest column in a gap or past either end', () => {
    expect(columnIndexAt(frames, 115)).toBe(1);
    expect(columnIndexAt(frames, -40)).toBe(0);
    expect(columnIndexAt(frames, 900)).toBe(2);
  });
  it('answers null with no columns', () => {
    expect(columnIndexAt([], 10)).toBeNull();
  });
});

describe('insertIndexAt', () => {
  const frames = [{ top: 0, height: 40 }, { top: 50, height: 40 }];
  it('counts the cards whose middle is above the finger', () => {
    expect(insertIndexAt(frames, 10)).toBe(0);
    expect(insertIndexAt(frames, 30)).toBe(1);
    expect(insertIndexAt(frames, 500)).toBe(2);
  });
});

describe('boardMove', () => {
  it('writes nothing for a card dropped where it was', () => {
    expect(boardMove(items, 's1', 'S', 0)).toEqual({ kind: 'none' });
    expect(boardMove(items, 'b', LOOSE_COLUMN_KEY, 1)).toEqual({ kind: 'none' });
  });

  it('reorders within a section', () => {
    expect(boardMove(items, 's1', 'S', 1)).toEqual({
      kind: 'move', taskId: 's1', groupId: 'S', leaveGroupId: null, joinGroupId: null, groupOrder: ['s2', 's1'], projectOrder: null,
    });
  });

  it('joins a section at the slot it was dropped in', () => {
    expect(boardMove(items, 'a', 'S', 1)).toEqual({
      kind: 'move', taskId: 'a', groupId: 'S', leaveGroupId: null, joinGroupId: 'S', groupOrder: ['s1', 'a', 's2'], projectOrder: null,
    });
  });

  it('moves between sections, leaving one and joining the other', () => {
    expect(boardMove(items, 's2', 'T', 0)).toEqual({
      kind: 'move', taskId: 's2', groupId: 'T', leaveGroupId: 'S', joinGroupId: 'T', groupOrder: ['s2'], projectOrder: null,
    });
  });

  it('places a card leaving a section before the loose task that follows it', () => {
    const move = boardMove(items, 's1', LOOSE_COLUMN_KEY, 1);
    expect(move).toMatchObject({ groupId: null, leaveGroupId: 'S', joinGroupId: null, groupOrder: null });
    expect(move.kind === 'move' && move.projectOrder).toEqual(['a', 'S', 's1', 'b', 'T']);
  });

  it('places a card dropped last in the loose column after the last loose task', () => {
    const move = boardMove(items, 's1', LOOSE_COLUMN_KEY, 2);
    expect(move.kind === 'move' && move.projectOrder).toEqual(['a', 'S', 'b', 's1', 'T']);
  });

  it('reorders loose tasks against the whole list, keeping the sections in place', () => {
    const move = boardMove(items, 'b', LOOSE_COLUMN_KEY, 0);
    expect(move.kind === 'move' && move.projectOrder).toEqual(['b', 'a', 'S', 'T']);
  });

  it('appends to the end of the list when the loose column is empty', () => {
    const only: ProjectListItem[] = [section('S', ['s1'])];
    const move = boardMove(only, 's1', LOOSE_COLUMN_KEY, 0);
    expect(move.kind === 'move' && move.projectOrder).toEqual(['S', 's1']);
  });

  it('clamps an index past the end of the column', () => {
    const move = boardMove(items, 'a', 'S', 99);
    expect(move.kind === 'move' && move.groupOrder).toEqual(['s1', 's2', 'a']);
  });

  it('writes nothing for a task or column it cannot find', () => {
    expect(boardMove(items, 'zz', 'S', 0)).toEqual({ kind: 'none' });
    expect(boardMove(items, 'a', 'nope', 0)).toEqual({ kind: 'none' });
  });
});
