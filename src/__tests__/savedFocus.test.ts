/**
 * Tests for src/utils/savedFocus.ts: the saved focus sessions an alarm offers
 * once it is turned off. The suggester has its own tests (focusSuggest.test.ts),
 * so it is replaced here to see what pool and window savedFocusQueue hands it.
 */

import type { FocusContext } from '../utils/focusSuggest';
import type { Task } from '../types';

const mockSuggest = jest.fn((pool: { id: string }[], _ctx: unknown) => pool.map(t => t.id));
jest.mock('../utils/focusSuggest', () => ({
  suggestFocusTasks: (pool: { id: string }[], ctx: unknown) => mockSuggest(pool, ctx),
}));

import {
  MAX_SAVED_FOCUS,
  alarmsUsing,
  describeFilter,
  focusOfferFor,
  matchesFilter,
  normalizeSavedFocus,
  normalizeWindow,
  parseSavedFocusSessions,
  savedFocusNameTaken,
  savedFocusQueue,
} from '../utils/savedFocus';

const task = (id: string, over: Partial<Task> = {}) =>
  ({ id, category: null, projectId: null, tags: [], ...over }) as unknown as Task;

describe('normalizeSavedFocus', () => {
  it('keeps a well-formed session and trims its name', () => {
    expect(normalizeSavedFocus({ id: 's1', name: ' Deep work ', filter: { kind: 'project', value: 'p1' }, windowMinutes: 90 }))
      .toEqual({ id: 's1', name: 'Deep work', filter: { kind: 'project', value: 'p1' }, windowMinutes: 90 });
  });

  it('refuses one with no id or no name', () => {
    expect(normalizeSavedFocus({ name: 'x' })).toBeNull();
    expect(normalizeSavedFocus({ id: 's1', name: '   ' })).toBeNull();
    expect(normalizeSavedFocus(null)).toBeNull();
  });

  it('reads a malformed filter as any task', () => {
    for (const filter of [undefined, { kind: 'colour', value: 'red' }, { kind: 'tag', value: '' }, { kind: 'tag' }]) {
      expect(normalizeSavedFocus({ id: 's1', name: 'a', filter, windowMinutes: null })?.filter).toEqual({ kind: 'all' });
    }
  });
});

describe('normalizeWindow', () => {
  it('clamps to the setup sheet bounds and reads nonsense as no limit', () => {
    expect(normalizeWindow(5)).toBe(15);
    expect(normalizeWindow(10_000)).toBe(480);
    expect(normalizeWindow(47.6)).toBe(48);
    expect(normalizeWindow(0)).toBeNull();
    expect(normalizeWindow('90')).toBeNull();
    expect(normalizeWindow(null)).toBeNull();
  });
});

describe('parseSavedFocusSessions', () => {
  const s = (id: string, name: string) => ({ id, name, filter: { kind: 'all' }, windowMinutes: null });

  it('reads the stored list, dropping bad and duplicate entries', () => {
    const raw = JSON.stringify([s('a', 'One'), { id: 'b' }, s('a', 'Again'), s('c', 'Two')]);
    expect(parseSavedFocusSessions(raw).map(x => x.id)).toEqual(['a', 'c']);
  });

  it('reads empty, damaged or non-list text as none', () => {
    expect(parseSavedFocusSessions(null)).toEqual([]);
    expect(parseSavedFocusSessions('')).toEqual([]);
    expect(parseSavedFocusSessions('{oops')).toEqual([]);
    expect(parseSavedFocusSessions('{"a":1}')).toEqual([]);
  });

  it('keeps no more than the limit', () => {
    const raw = JSON.stringify(Array.from({ length: MAX_SAVED_FOCUS + 3 }, (_, i) => s(`s${i}`, `n${i}`)));
    expect(parseSavedFocusSessions(raw)).toHaveLength(MAX_SAVED_FOCUS);
  });
});

describe('savedFocusNameTaken', () => {
  const sessions = [{ id: 'a', name: 'Deep work', filter: { kind: 'all' as const }, windowMinutes: null }];

  it('compares names without case or surrounding space', () => {
    expect(savedFocusNameTaken(' deep WORK ', sessions)).toBe(true);
    expect(savedFocusNameTaken('Admin', sessions)).toBe(false);
  });

  it('lets a session keep its own name', () => {
    expect(savedFocusNameTaken('Deep work', sessions, 'a')).toBe(false);
  });

  it('does not call an empty name taken', () => {
    expect(savedFocusNameTaken('  ', sessions)).toBe(false);
  });
});

describe('matchesFilter', () => {
  const t = task('t', { category: 'Work', projectId: 'p1', tags: ['deep'] });

  it('matches by category, project id and tag, and any task for all', () => {
    expect(matchesFilter(t, { kind: 'all' })).toBe(true);
    expect(matchesFilter(t, { kind: 'category', value: 'Work' })).toBe(true);
    expect(matchesFilter(t, { kind: 'category', value: 'Home' })).toBe(false);
    expect(matchesFilter(t, { kind: 'project', value: 'p1' })).toBe(true);
    expect(matchesFilter(t, { kind: 'project', value: 'p2' })).toBe(false);
    expect(matchesFilter(t, { kind: 'tag', value: 'deep' })).toBe(true);
    expect(matchesFilter(t, { kind: 'tag', value: 'shallow' })).toBe(false);
  });
});

describe('describeFilter', () => {
  it('names the rule the way the editor reads it back', () => {
    expect(describeFilter({ kind: 'all' })).toBe('Any task');
    expect(describeFilter({ kind: 'tag', value: 'deep' })).toBe('Tag: deep');
  });
});

describe('savedFocusQueue', () => {
  const ctx = { windowMinutes: 30 } as unknown as FocusContext;

  it('hands the suggester only the tasks the rule matches, under the saved window', () => {
    const pool = [task('a', { category: 'Work' }), task('b', { category: 'Home' }), task('c', { category: 'Work' })];
    const ids = savedFocusQueue({ filter: { kind: 'category', value: 'Work' }, windowMinutes: 90 }, pool, ctx);
    expect(ids).toEqual(['a', 'c']);
    expect(mockSuggest).toHaveBeenLastCalledWith(pool.filter(t => t.category === 'Work'), expect.objectContaining({ windowMinutes: 90 }));
  });

  it('passes no limit when the session has none', () => {
    savedFocusQueue({ filter: { kind: 'all' }, windowMinutes: null }, [task('a')], ctx);
    expect(mockSuggest).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ windowMinutes: null }));
  });
});

describe('focusOfferFor', () => {
  const sessions = [{ id: 's1', name: 'Deep work', filter: { kind: 'all' as const }, windowMinutes: null }];

  it('offers the linked session', () => {
    expect(focusOfferFor({ savedFocusId: 's1' }, sessions)?.name).toBe('Deep work');
  });

  it('offers nothing for no link, a deleted session or no alarm', () => {
    expect(focusOfferFor({ savedFocusId: null }, sessions)).toBeNull();
    expect(focusOfferFor({ savedFocusId: 'gone' }, sessions)).toBeNull();
    expect(focusOfferFor(undefined, sessions)).toBeNull();
  });
});

describe('alarmsUsing', () => {
  it('lists the alarms that start a session', () => {
    expect(alarmsUsing('s1', [
      { id: 'a', savedFocusId: 's1' }, { id: 'b', savedFocusId: null }, { id: 'c', savedFocusId: 's1' },
    ])).toEqual(['a', 'c']);
  });
});
