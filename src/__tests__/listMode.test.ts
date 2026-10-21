import {
  isOpenEnded,
  listCountNote,
  listItemFinder,
  listItemRowShown,
  sectionIsList,
  sectionListPatch,
} from '../utils/listMode';
import type { Project, Task, TaskGroup } from '../types';

const group = (o: Partial<TaskGroup>): TaskGroup => ({
  id: 'g', title: '', notes: '', tags: [], category: null, sortOrder: 0,
  collapsed: false, onToday: false, projectId: null, ...o,
});
const project = (o: Partial<Project>) => ({ id: 'p', ongoing: false, list: false, ...o }) as Project;
const row = (o: Partial<Task>) => ({ groupId: null, projectId: null, parentId: null, ...o }) as Pick<Task, 'groupId' | 'projectId' | 'parentId'>;

describe('sectionIsList', () => {
  it('is a list when the section says so, in any project', () => {
    expect(sectionIsList({ checklist: true }, null)).toBe(true);
    expect(sectionIsList({ checklist: true }, { list: false })).toBe(true);
  });

  it('follows a list project unless the section keeps tasks', () => {
    expect(sectionIsList({}, { list: true })).toBe(true);
    expect(sectionIsList({ keepsTasks: true }, { list: true })).toBe(false);
  });

  it('ignores keepsTasks outside a list project', () => {
    expect(sectionIsList({ keepsTasks: true }, { list: false })).toBe(false);
    expect(sectionIsList({}, null)).toBe(false);
  });
});

describe('sectionListPatch', () => {
  it('writes the section flag in an ordinary project', () => {
    expect(sectionListPatch(true, { list: false })).toEqual({ checklist: true, keepsTasks: false });
    expect(sectionListPatch(false, null)).toEqual({ checklist: false, keepsTasks: false });
  });

  it('writes the override in a list project, and nothing to turn it back on', () => {
    expect(sectionListPatch(false, { list: true })).toEqual({ checklist: false, keepsTasks: true });
    expect(sectionListPatch(true, { list: true })).toEqual({ checklist: false, keepsTasks: false });
  });

  it('round-trips through sectionIsList either way', () => {
    for (const list of [false, true]) {
      for (const want of [false, true]) {
        expect(sectionIsList(sectionListPatch(want, { list }), { list })).toBe(want);
      }
    }
  });
});

describe('listItemFinder', () => {
  const projects = [project({ id: 'wish', list: true }), project({ id: 'trip' })];
  const groups = [
    group({ id: 'books', projectId: 'wish' }),
    group({ id: 'chores', projectId: 'wish', keepsTasks: true }),
    group({ id: 'packing', projectId: 'trip', checklist: true }),
    group({ id: 'bookings', projectId: 'trip' }),
    group({ id: 'stack' }),
  ];
  const isItem = listItemFinder(groups, projects);

  it('reads a section by its own home project', () => {
    expect(isItem(row({ groupId: 'books', projectId: 'wish' }))).toBe(true);
    expect(isItem(row({ groupId: 'chores', projectId: 'wish' }))).toBe(false);
    expect(isItem(row({ groupId: 'packing', projectId: 'trip' }))).toBe(true);
    expect(isItem(row({ groupId: 'bookings', projectId: 'trip' }))).toBe(false);
  });

  it('makes a list project\'s loose rows items, and nothing else\'s', () => {
    expect(isItem(row({ projectId: 'wish' }))).toBe(true);
    expect(isItem(row({ projectId: 'trip' }))).toBe(false);
    expect(isItem(row({}))).toBe(false);
  });

  it('falls back to the task\'s project for a stack that is no project\'s section', () => {
    expect(isItem(row({ groupId: 'stack', projectId: 'wish' }))).toBe(true);
    expect(isItem(row({ groupId: 'stack' }))).toBe(false);
  });

  it('never counts a subtask as an item', () => {
    expect(isItem(row({ projectId: 'wish', parentId: 'x' }))).toBe(false);
  });
});

describe('isOpenEnded', () => {
  it('is true for an ongoing project or a list', () => {
    expect(isOpenEnded(project({ ongoing: true }))).toBe(true);
    expect(isOpenEnded(project({ list: true }))).toBe(true);
    expect(isOpenEnded(project({}))).toBe(false);
  });
});

describe('listCountNote', () => {
  it('counts items, adding checked ones only when there are some', () => {
    expect(listCountNote(7, 1)).toBe('7 items · 1 checked');
    expect(listCountNote(1, 0)).toBe('1 item');
    expect(listCountNote(0, 3)).toBe('0 items · 3 checked');
    expect(listCountNote(0, 0)).toBe('No items yet');
  });
});

describe('listItemRowShown', () => {
  it('shows an item\'s own rows and any row holding a value', () => {
    expect(listItemRowShown('date', false)).toBe(true);
    expect(listItemRowShown('link', false)).toBe(true);
    expect(listItemRowShown('repeat', false)).toBe(false);
    expect(listItemRowShown('repeat', true)).toBe(true);
    // Category follows the hidden-unless-set rule rather than always showing.
    expect(listItemRowShown('category', false)).toBe(false);
    expect(listItemRowShown('category', true)).toBe(true);
  });
});
