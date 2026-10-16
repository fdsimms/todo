import { stackPlacements, runSelection, toggleRun, stackProgress } from '../utils/focusStacks';
import type { FocusStep } from '../types';

const names = new Map([['g1', 'Morning supplements'], ['g2', 'Evening']]);
const t = (id: string, groupId?: string | null) => ({ id, groupId });

describe('stackPlacements', () => {
  it('encloses adjacent members of one stack in a tray', () => {
    const p = stackPlacements([t('a'), t('b', 'g1'), t('c', 'g1'), t('d', 'g1'), t('e')], names);
    expect(p.get('a')).toBeUndefined();
    expect(p.get('e')).toBeUndefined();
    expect(p.get('b')).toMatchObject({ kind: 'tray', first: true, last: false, runIds: ['b', 'c', 'd'], name: 'Morning supplements' });
    expect(p.get('c')).toMatchObject({ kind: 'tray', first: false, last: false });
    expect(p.get('d')).toMatchObject({ kind: 'tray', first: false, last: true });
  });

  it('gives a member with no neighbour from its stack a caption', () => {
    const p = stackPlacements([t('a', 'g1'), t('b'), t('c', 'g1')], names);
    expect(p.get('a')).toEqual({ kind: 'caption', groupId: 'g1', name: 'Morning supplements' });
    expect(p.get('c')).toMatchObject({ kind: 'caption' });
  });

  it('splits a run when a row is moved out of its middle', () => {
    const p = stackPlacements([t('a', 'g1'), t('b', 'g1'), t('x'), t('c', 'g1'), t('d', 'g1')], names);
    expect(p.get('a')).toMatchObject({ kind: 'tray', first: true, runIds: ['a', 'b'] });
    expect(p.get('c')).toMatchObject({ kind: 'tray', first: true, runIds: ['c', 'd'] });
  });

  it('keeps two different stacks side by side as separate runs', () => {
    const p = stackPlacements([t('a', 'g1'), t('b', 'g1'), t('c', 'g2'), t('d', 'g2')], names);
    expect(p.get('b')).toMatchObject({ last: true, groupId: 'g1' });
    expect(p.get('c')).toMatchObject({ first: true, groupId: 'g2' });
  });

  it('treats a member of a deleted stack as unstacked', () => {
    const p = stackPlacements([t('a', 'gone'), t('b', 'gone')], names);
    expect(p.size).toBe(0);
  });
});

describe('runSelection / toggleRun', () => {
  const run = ['a', 'b', 'c'];
  it('reads all, none and some', () => {
    expect(runSelection(run, new Set(['a', 'b', 'c', 'z']))).toBe('all');
    expect(runSelection(run, new Set(['z']))).toBe('none');
    expect(runSelection(run, new Set(['a']))).toBe('some');
  });

  it('takes a full run out, and fills any other state', () => {
    expect([...toggleRun(run, new Set(['a', 'b', 'c', 'z']))]).toEqual(['z']);
    expect([...toggleRun(run, new Set(['a', 'z'])).values()].sort()).toEqual(['a', 'b', 'c', 'z']);
    expect([...toggleRun(run, new Set())].sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    const before = new Set(['a']);
    toggleRun(run, before);
    expect([...before]).toEqual(['a']);
  });
});

describe('stackProgress', () => {
  const work = (taskId: string): FocusStep => ({ kind: 'work', taskId, minutes: 1, part: 1, partCount: 1, long: false });
  const rest: FocusStep = { kind: 'rest', taskId: null, minutes: 5, part: 1, partCount: 1, long: false };
  const groups: Record<string, string | undefined> = { a: 'g1', b: 'g1', c: 'g1', d: 'g1', x: undefined };
  const groupOf = (id: string) => groups[id];

  it('places the current task among what is left, counting what is passed', () => {
    const steps = [work('b'), work('x'), work('c'), work('d')];
    expect(stackProgress(steps, 0, ['a'], groupOf)).toEqual({ groupId: 'g1', position: 2, total: 4, done: 1 });
    expect(stackProgress(steps, 2, ['a'], groupOf)).toMatchObject({ position: 3, total: 4 });
  });

  it('reads steps behind the cursor as passed', () => {
    const steps = [work('a'), work('b'), work('c')];
    expect(stackProgress(steps, 1, [], groupOf)).toEqual({ groupId: 'g1', position: 2, total: 3, done: 1 });
  });

  it('counts a multi-part task once', () => {
    const steps = [work('a'), rest, work('a'), work('b')];
    expect(stackProgress(steps, 0, [], groupOf)).toMatchObject({ position: 1, total: 2 });
  });

  it('is null for a break, an unstacked task, or a stack of one', () => {
    expect(stackProgress([rest, work('a')], 0, [], groupOf)).toBeNull();
    expect(stackProgress([work('x'), work('a')], 0, [], groupOf)).toBeNull();
    expect(stackProgress([work('a'), work('x')], 0, [], groupOf)).toBeNull();
  });
});
