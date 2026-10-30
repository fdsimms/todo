import type { EventTaskRule, Task } from '../types';
import { generatedBy } from '../utils/generatedTasks';
import { eventTaskSourceId } from '../utils/eventTasks';
import { leavePrepAlert, leavePrepLine, leavePrepSignature, openLeavePrep } from '../utils/leavePrep';

const KEY = 'ev1|2026-10-31T15:00:00.000Z';

const rule = (over: Partial<EventTaskRule> = {}): EventTaskRule => ({
  id: 'r1', matches: ['Optometrist'], title: 'Bring glasses', leadDays: 0, enabled: true, beforeLeaving: true, ...over,
});

function task(over: Partial<Task>): Task {
  return { id: 't', title: 'x', completed: false, archived: false, ...over } as Task;
}

const leave = task({ id: 'leave', ...generatedBy('travel', KEY) });
const prep = (id: string, ruleId = 'r1', key = KEY, over: Partial<Task> = {}) =>
  task({ id, title: `Prep ${id}`, ...generatedBy('eventTask', eventTaskSourceId(key, ruleId)), ...over });

describe('openLeavePrep', () => {
  it('finds the open prep tasks for the same occurrence, from a rule tied to leaving', () => {
    const tasks = [leave, prep('a'), prep('b')];
    expect(openLeavePrep(leave, tasks, [rule()]).map(t => t.id)).toEqual(['a', 'b']);
  });

  it('ignores prep for another occurrence, finished or archived prep, and rules not tied to leaving', () => {
    const tasks = [
      leave,
      prep('other', 'r1', 'ev2|2026-10-31T15:00:00.000Z'),
      prep('done', 'r1', KEY, { completed: true }),
      prep('filed', 'r1', KEY, { archived: true }),
      prep('plain', 'r2'),
    ];
    expect(openLeavePrep(leave, tasks, [rule(), rule({ id: 'r2', beforeLeaving: undefined })])).toEqual([]);
  });

  it('is empty for a task that is not a Leave row, and with no rule tied to leaving', () => {
    expect(openLeavePrep(task({}), [prep('a')], [rule()])).toEqual([]);
    expect(openLeavePrep(leave, [prep('a')], [rule({ beforeLeaving: false })])).toEqual([]);
    expect(openLeavePrep(leave, [prep('a')], [rule({ afterEvent: true })])).toEqual([]);
  });
});

describe('leavePrepLine and leavePrepAlert', () => {
  it('names what is open, and nothing when nothing is', () => {
    expect(leavePrepLine([])).toBeNull();
    expect(leavePrepLine([{ title: 'Bring glasses' }, { title: 'Insurance card' }]))
      .toBe('Still open: Bring glasses, Insurance card');
  });

  it('words the alert for one task and for several', () => {
    expect(leavePrepAlert([{ title: 'Bring glasses' }]))
      .toEqual({ title: 'Leave without it?', message: '“Bring glasses” isn’t checked off yet.' });
    expect(leavePrepAlert([{ title: 'A' }, { title: 'B' }]))
      .toEqual({ title: 'Leave with 2 tasks open?', message: '• A\n• B' });
  });
});

describe('leavePrepSignature', () => {
  it('changes when a prep task is finished and is empty with no rule tied to leaving', () => {
    const open = leavePrepSignature([leave, prep('a'), prep('b')], [rule()]);
    expect(open).toBe('a,b');
    expect(leavePrepSignature([leave, prep('a', 'r1', KEY, { completed: true }), prep('b')], [rule()])).toBe('b');
    expect(leavePrepSignature([leave, prep('a')], [rule({ beforeLeaving: false })])).toBe('');
  });
});
