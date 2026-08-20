import type { Task, TitleRule } from '../types';
import {
  describeTitleRuleTargets,
  describeTitleRuleTrigger,
  emptyTitleRule,
  matchKeyword,
  matchTitleRule,
  normalizeKeywords,
  parseTitleRules,
  resolveTitleRules,
  titleRuleBacklog,
  titleRuleIsUseless,
  titleRuleSaysNothing,
} from '../utils/titleRules';

function rule(patch: Partial<TitleRule> = {}): TitleRule {
  return { ...emptyTitleRule(), ...patch };
}

describe('normalizeKeywords', () => {
  it('trims, lowercases and collapses inner whitespace', () => {
    expect(normalizeKeywords(['  Expense ', 'dry   cleaning'])).toEqual(['expense', 'dry cleaning']);
  });

  it('drops keywords too short to be a marker', () => {
    expect(normalizeKeywords(['re', 'a', 'exp'])).toEqual(['exp']);
  });

  it('deduplicates case-insensitively, keeping the first', () => {
    expect(normalizeKeywords(['Expense', 'expense', 'EXPENSE'])).toEqual(['expense']);
  });

  it('ignores non-strings from a hand-edited blob', () => {
    expect(normalizeKeywords(['expense', 7 as unknown as string, null as unknown as string])).toEqual(['expense']);
  });
});

describe('matchKeyword', () => {
  it('matches whole words only — "expense" never fires on "expensive"', () => {
    expect(matchKeyword('expensive dinner', 'expense', 'contains')).toBeNull();
    expect(matchKeyword('expense dinner', 'expense', 'contains')).not.toBeNull();
  });

  it('is case-insensitive', () => {
    expect(matchKeyword('Expense report', 'expense', 'startsWith')).toEqual({ keyword: 'expense', start: 0, end: 7 });
  });

  it('allows a trailing separator after the keyword', () => {
    expect(matchKeyword('Expense: lunch', 'expense', 'startsWith')).toEqual({ keyword: 'expense', start: 0, end: 7 });
  });

  it('anchors startsWith to the first word, ignoring leading whitespace', () => {
    expect(matchKeyword('  expense lunch', 'expense', 'startsWith')).toEqual({ keyword: 'expense', start: 2, end: 9 });
    expect(matchKeyword('file the expense', 'expense', 'startsWith')).toBeNull();
  });

  it('finds a contains keyword anywhere', () => {
    expect(matchKeyword('file the expense today', 'expense', 'contains')).toEqual({
      keyword: 'expense', start: 9, end: 16,
    });
  });

  it('matches a multi-word phrase', () => {
    expect(matchKeyword('dry cleaning pickup', 'dry cleaning', 'startsWith')).toEqual({
      keyword: 'dry cleaning', start: 0, end: 12,
    });
  });

  it('does not fire on a plural — that is a second keyword, not a stem guess', () => {
    expect(matchKeyword('expenses for June', 'expense', 'startsWith')).toBeNull();
  });

  it('treats regex metacharacters in a keyword as literal text', () => {
    expect(matchKeyword('c++ refactor', 'c++', 'startsWith')).not.toBeNull();
    expect(matchKeyword('cxx refactor', 'c++', 'startsWith')).toBeNull();
  });
});

describe('matchTitleRule', () => {
  it('ignores a disabled rule', () => {
    expect(matchTitleRule('expense lunch', rule({ keywords: ['expense'], enabled: false }))).toBeNull();
  });

  it('reports the longest matching keyword, not the first listed', () => {
    const r = rule({ keywords: ['expense', 'expense report'] });
    expect(matchTitleRule('expense report for Q3', r)?.keyword).toBe('expense report');
  });
});

describe('resolveTitleRules', () => {
  const work = rule({ keywords: ['expense'], category: 'Work', tags: ['receipts'] });

  it('returns null when nothing fires', () => {
    expect(resolveTitleRules('buy milk', [work])).toBeNull();
  });

  it('fills the fields the matching rule names', () => {
    const fill = resolveTitleRules('expense the client lunch', [work])!;
    expect(fill.category).toBe('Work');
    expect(fill.tags).toEqual(['receipts']);
    expect(fill.priority).toBe(0);
    expect(fill.matched).toHaveLength(1);
  });

  it('leaves the title alone unless the rule strips', () => {
    expect(resolveTitleRules('expense the client lunch', [work])!.cleanTitle)
      .toBe('expense the client lunch');
  });

  it('strips the matched keyword and its separator when asked', () => {
    const r = rule({ keywords: ['expense'], category: 'Work', stripKeyword: true });
    expect(resolveTitleRules('Expense: client lunch', [r])!.cleanTitle).toBe('client lunch');
    expect(resolveTitleRules('file the expense soon', [{ ...r, match: 'contains' }])!.cleanTitle)
      .toBe('file the soon');
  });

  it('refuses a strip that would empty the title', () => {
    const r = rule({ keywords: ['expense'], category: 'Work', stripKeyword: true });
    expect(resolveTitleRules('expense', [r])!.cleanTitle).toBe('expense');
  });

  it('gives a contested field to the longer, more specific keyword', () => {
    const broad = rule({ keywords: ['expense'], category: 'Work' });
    const specific = rule({ keywords: ['expense report'], category: 'Admin' });
    // Listed broad-first, so position can't be what decides it.
    const fill = resolveTitleRules('expense report Q3', [broad, specific])!;
    expect(fill.category).toBe('Admin');
  });

  it('breaks a tie on equal keyword length by list order', () => {
    const first = rule({ keywords: ['invoice'], category: 'Work' });
    const second = rule({ keywords: ['invoice'], category: 'Admin' });
    expect(resolveTitleRules('invoice Acme', [first, second])!.category).toBe('Work');
  });

  it('accumulates tags across every match while a single-valued field is claimed once', () => {
    const a = rule({ keywords: ['expense'], category: 'Work', tags: ['receipts'] });
    const b = rule({ keywords: ['client'], match: 'contains', category: 'Personal', tags: ['billable'] });
    const fill = resolveTitleRules('expense the client lunch', [a, b])!;
    expect(fill.category).toBe('Work');
    expect(fill.tags).toEqual(['receipts', 'billable']);
  });

  it('does not repeat a tag two rules both name', () => {
    const a = rule({ keywords: ['expense'], tags: ['work'] });
    const b = rule({ keywords: ['client'], match: 'contains', tags: ['work'] });
    expect(resolveTitleRules('expense client lunch', [a, b])!.tags).toEqual(['work']);
  });

  it('lets a later rule fill a field an earlier one said nothing about', () => {
    const a = rule({ keywords: ['expense report'], category: 'Work' });
    const b = rule({ keywords: ['expense'], priority: 3 });
    const fill = resolveTitleRules('expense report Q3', [a, b])!;
    expect(fill.category).toBe('Work');
    expect(fill.priority).toBe(3);
  });

  it('strips for both rules when both ask, from the end backwards', () => {
    const a = rule({ keywords: ['expense'], category: 'Work', stripKeyword: true });
    const b = rule({ keywords: ['urgent'], match: 'contains', priority: 4, stripKeyword: true });
    expect(resolveTitleRules('expense urgent lunch', [a, b])!.cleanTitle).toBe('lunch');
  });
});

describe('titleRuleSaysNothing / titleRuleIsUseless', () => {
  it('a fresh rule says nothing and is useless', () => {
    expect(titleRuleSaysNothing(emptyTitleRule())).toBe(true);
    expect(titleRuleIsUseless(emptyTitleRule())).toBe(true);
  });

  it('a rule needs both a keyword and something to say', () => {
    expect(titleRuleIsUseless(rule({ keywords: ['expense'] }))).toBe(true);
    expect(titleRuleIsUseless(rule({ category: 'Work' }))).toBe(true);
    expect(titleRuleIsUseless(rule({ keywords: ['expense'], category: 'Work' }))).toBe(false);
  });

  it('counts a lone tag or a priority as something to say', () => {
    expect(titleRuleSaysNothing(rule({ tags: ['receipts'] }))).toBe(false);
    expect(titleRuleSaysNothing(rule({ priority: 2 }))).toBe(false);
  });
});

describe('parseTitleRules', () => {
  it('reads back what it was given', () => {
    const stored = JSON.stringify([rule({ id: 'r1', keywords: ['expense'], category: 'Work' })]);
    expect(parseTitleRules(stored)).toEqual([
      expect.objectContaining({ id: 'r1', keywords: ['expense'], category: 'Work', enabled: true }),
    ]);
  });

  it('returns [] for absent or unreadable storage', () => {
    expect(parseTitleRules(null)).toEqual([]);
    expect(parseTitleRules('not json')).toEqual([]);
    expect(parseTitleRules('{"nope":true}')).toEqual([]);
  });

  it('drops a rule that could never do anything', () => {
    const stored = JSON.stringify([
      { id: 'a', keywords: [], category: 'Work' },
      { id: 'b', keywords: ['expense'] },
      { id: 'c', keywords: ['expense'], category: 'Work' },
    ]);
    expect(parseTitleRules(stored).map(r => r.id)).toEqual(['c']);
  });

  it('falls back field by field rather than dropping a rule over one bad value', () => {
    const stored = JSON.stringify([
      { id: 'a', keywords: ['expense'], category: 'Work', match: 'regex', priority: 99, effort: 'S', enabled: 'yes' },
    ]);
    expect(parseTitleRules(stored)[0]).toEqual(expect.objectContaining({
      match: 'startsWith', priority: 0, effort: 0, enabled: true,
    }));
  });

  it('normalizes keywords on read, so a stored "  Expense " still fires', () => {
    const stored = JSON.stringify([{ id: 'a', keywords: ['  Expense '], category: 'Work' }]);
    const rules = parseTitleRules(stored);
    expect(rules[0].keywords).toEqual(['expense']);
    expect(resolveTitleRules('expense lunch', rules)!.category).toBe('Work');
  });
});

describe('descriptions', () => {
  it('names the trigger, with a count past the first keyword', () => {
    expect(describeTitleRuleTrigger(rule({ keywords: ['expense'] }))).toBe('Starts with “expense”');
    expect(describeTitleRuleTrigger(rule({ keywords: ['expense', 'reimburse'], match: 'contains' })))
      .toBe('Contains “expense” or 1 more');
  });

  it('names up to three targets and then falls back to a count', () => {
    expect(describeTitleRuleTargets(rule({ category: 'Work', tags: ['receipts'] }), 'Work', null))
      .toBe('Work · #receipts');
    expect(describeTitleRuleTargets(
      rule({ category: 'Work', projectId: 'p1', priority: 3, effort: 4, tags: ['a'] }), 'Work', 'Q3',
    )).toBe('5 details');
  });

  it('says nothing about a field whose category or project has since been deleted', () => {
    expect(describeTitleRuleTargets(rule({ category: 'Gone', tags: ['receipts'] }), null, null))
      .toBe('#receipts');
  });
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Expense the client lunch',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  allowOvershoot: false,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  ...overrides,
});

describe('titleRuleBacklog', () => {
  const expense = rule({ keywords: ['expense'], category: 'Work', tags: ['admin'], effort: 1 });

  it('names the live tasks a newly written rule would have filed', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'Expense the client lunch' }),
      makeTask({ id: 'b', title: 'Water the plants' }),
    ];
    expect(titleRuleBacklog(tasks, expense).map(e => e.task.id)).toEqual(['a']);
  });

  it('fills only what the task left blank, and adds tags rather than replacing them', () => {
    const tasks = [makeTask({ id: 'a', category: 'Home', tags: ['bills'], effort: 3 })];
    expect(titleRuleBacklog(tasks, expense)[0].updates).toEqual({ tags: ['bills', 'admin'] });
  });

  it('leaves out a task the rule has nothing left to say about', () => {
    const tasks = [makeTask({ id: 'a', category: 'Home', tags: ['admin'], effort: 3 })];
    expect(titleRuleBacklog(tasks, expense)).toEqual([]);
  });

  it('never touches completed or archived rows, or a subtask', () => {
    const tasks = [
      makeTask({ id: 'done', completed: true }),
      makeTask({ id: 'filed', archived: true }),
      makeTask({ id: 'step', parentId: 'a' }),
    ];
    expect(titleRuleBacklog(tasks, expense)).toEqual([]);
  });

  it('offers nothing for a rule saved switched off, or one that can never fire', () => {
    const tasks = [makeTask({ id: 'a' })];
    expect(titleRuleBacklog(tasks, rule({ ...expense, enabled: false }))).toEqual([]);
    expect(titleRuleBacklog(tasks, rule({ keywords: ['expense'] }))).toEqual([]);
  });

  it('runs the one rule, not every rule that happens to match the same title', () => {
    const tasks = [makeTask({ id: 'a' })];
    const other = rule({ keywords: ['client'], match: 'contains', category: 'Personal' });
    expect(titleRuleBacklog(tasks, other)[0].updates).toEqual({ category: 'Personal' });
    expect(titleRuleBacklog(tasks, expense)[0].updates).toEqual({
      category: 'Work', effort: 1, tags: ['admin'],
    });
  });

  it('leaves the title alone even when the rule strips its keyword', () => {
    const tasks = [makeTask({ id: 'a' })];
    const entry = titleRuleBacklog(tasks, rule({ ...expense, stripKeyword: true }))[0];
    expect(entry.updates).not.toHaveProperty('title');
    expect(entry.task.title).toBe('Expense the client lunch');
  });
});
