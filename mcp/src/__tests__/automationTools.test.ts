/**
 * Automations against a real database and the real settings store: a rule is
 * checked by the app's own parser, refused when the parser would drop it, and
 * reported as stored when the parser changed it; an edit that changes what a
 * weather rule asks clears its day mark; and a switch lands as the stored
 * value the app reads back.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { deleteRule, listAutomations, saveRule, setAutomation } from '../automationTools';
import { deleteCategory } from '../categoryTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;

beforeAll(() => {
  replica = openReplica(':memory:');
});

beforeEach(() => {
  // One replica for the file, so each test starts from an empty settings
  // table: the switch one test turns on, and the rule lists another saves, are
  // otherwise what the next test reads back. The refresh re-reads the store
  // from the table, defaults and all.
  mockRaw.runSync('DELETE FROM settings');
  replica.refresh();
});

describe('automations', () => {
  it('lists every automation with its switch, and says what each needs on the phone', () => {
    const { automations } = listAutomations(replica);
    const weather = automations.find(a => a.kind === 'weather')!;
    expect(weather).toMatchObject({ on: false, rules: { type: 'weather' }, needsOnPhone: expect.stringMatching(/location/) });
    expect(automations.length).toBeGreaterThan(20);
  });

  it('turns one on as the stored value the app reads back', () => {
    expect(setAutomation(replica, 'weather', { on: true }).on).toBe(true);
    replica.refresh();
    expect(listAutomations(replica).automations.find(a => a.kind === 'weather')!.on).toBe(true);
    expect(() => setAutomation(replica, 'telepathy', { on: true })).toThrow(/No automation/);
  });

  it('adds a weather rule, and clears its day mark when an edit changes what it asks', () => {
    const { saved, created } = saveRule(replica, 'weather', { condition: 'rainy', title: 'Take an umbrella' });
    expect(created).toBe(true);
    const id = saved.id as string;
    // As if the phone had already judged it today.
    const spent = replica.ruleLists().weather.map(r => (r.id === id ? { ...r, lastFiredDayKey: '2026-10-04' } : r));
    replica.setRuleList('weather', spent);

    saveRule(replica, 'weather', { id, title: 'Take the big umbrella' });
    expect(replica.ruleLists().weather.find(r => r.id === id)!.lastFiredDayKey).toBe('2026-10-04');
    saveRule(replica, 'weather', { id, condition: 'snowy' });
    expect(replica.ruleLists().weather.find(r => r.id === id)!.lastFiredDayKey).toBeNull();
  });

  it('refuses a title rule the app would drop, and reports one it adjusted', () => {
    expect(() => saveRule(replica, 'title', { keywords: ['ab'], priority: 3 })).toThrow(/3 or more letters/);
    const result = saveRule(replica, 'title', { keywords: ['Pay', 'xy'], priority: 3 });
    expect(result.saved).toMatchObject({ keywords: ['pay'], priority: 3 });
    expect(result.adjusted?.[0]).toMatch(/keywords/);
  });

  it('clamps a Screen Time threshold the way the sheet does, and says so', () => {
    const result = saveRule(replica, 'screenTime', { thresholdMinutes: 2, title: 'Go outside' });
    expect((result.saved.thresholdMinutes as number)).toBeGreaterThanOrEqual(5);
    expect(result.adjusted?.join(' ')).toMatch(/thresholdMinutes/);
  });

  it('deletes by id, and refuses an id it does not have', () => {
    const { saved } = saveRule(replica, 'event', { matches: ['dentist'], title: 'Floss the night before', leadDays: 1 });
    expect(deleteRule(replica, 'event', saved.id as string).removed).toMatchObject({ title: 'Floss the night before' });
    expect(() => deleteRule(replica, 'event', 'nope')).toThrow(/No event rule/);
    expect(() => saveRule(replica, 'event', { id: 'nope', title: 'x' })).toThrow(/No event rule/);
  });

  describe('the category an automation files under', () => {
    const categoryOf = (kind: string) => listAutomations(replica).automations.find(a => a.kind === kind)!.category;

    it('lists it, and writes the one chosen as a name that exists', () => {
      replica.createTask({ title: 'seed', category: 'Meals', newCategory: true } as never);
      replica.createTask({ title: 'seed', category: 'Evening Tasks', newCategory: true } as never);
      expect(setAutomation(replica, 'calendarReview', { category: ' evening tasks ' }).category).toBe('Evening Tasks');
      replica.refresh();
      expect(categoryOf('calendarReview')).toBe('Evening Tasks');
    });

    it('refuses a category that does not exist, and a call that changes nothing', () => {
      expect(() => setAutomation(replica, 'calendarReview', { category: 'Nope' })).toThrow(/isn't one of your categories/);
      expect(() => setAutomation(replica, 'calendarReview', {})).toThrow(/Say what to change/);
    });

    it('can change the category and the switch together, and warns about none', () => {
      const result = setAutomation(replica, 'birthday', { on: true, category: null });
      expect(result).toMatchObject({ on: true, category: null });
      expect(result.note).toMatch(/loose block/);
    });
  });

  describe('deleting a category', () => {
    it('moves its tasks and re-points every automation that filed under it', () => {
      replica.createTask({ title: 'Old one', category: 'Calendar', newCategory: true } as never);
      replica.createTask({ title: 'Seed', category: 'Meals', newCategory: true } as never);
      setAutomation(replica, 'eventTask', { category: 'Calendar' });
      setAutomation(replica, 'pantryCheck', { category: 'Calendar' });
      const result = deleteCategory(replica, { name: 'calendar', moveTo: 'Meals' });
      replica.refresh();
      expect(result).toMatchObject({ name: 'Calendar', movedTo: 'Meals', tasksMoved: 1 });
      expect(result.automationsRepointed).toHaveLength(2);
      expect(replica.categories().some(c => c.name === 'Calendar')).toBe(false);
      expect(categoryNamed('eventTask')).toBe('Meals');
      expect(categoryNamed('pantryCheck')).toBe('Meals');
      expect(replica.tasks().find(t => t.title === 'Old one')!.category).toBe('Meals');
    });

    it('refuses a category with open tasks unless told where they go', () => {
      replica.createTask({ title: 'Still open', category: 'Scratch', newCategory: true } as never);
      expect(() => deleteCategory(replica, { name: 'Scratch' })).toThrow(/still holds 1 open task/);
      expect(() => deleteCategory(replica, { name: 'Scratch', moveTo: 'Scratch' })).toThrow(/itself/);
      expect(() => deleteCategory(replica, { name: 'Scratch', moveTo: 'Nowhere' })).toThrow(/nothing can move there/);
      deleteCategory(replica, { name: 'Scratch', uncategorize: true });
      replica.refresh();
      expect(replica.tasks().find(t => t.title === 'Still open')!.category).toBeNull();
    });

    it('deletes an empty category with no extra argument', () => {
      replica.createTask({ title: 'tmp', category: 'Empty soon', newCategory: true } as never);
      deleteCategory(replica, { name: 'Empty soon', uncategorize: true });
      expect(() => deleteCategory(replica, { name: 'Empty soon' })).toThrow(/isn't one of your categories/);
    });
  });
});

function categoryNamed(kind: string): string | null {
  return listAutomations(replica).automations.find(a => a.kind === kind)!.category;
}

describe('task settings', () => {
  it('sets what each new task of a kind starts with, and reads it back', () => {
    const result = setAutomation(replica, 'groceryUseUp', {
      taskSettings: { priority: 2, tags: ['cooking', ' cooking '], timeOfDay: 'evening', askOnCompletion: { kind: 'choice', options: ['Ate it', 'Froze it'] } },
    });
    expect(result.taskSettings).toEqual({
      priority: 2, tags: ['cooking'], timeOfDay: 'evening', askOnCompletion: { kind: 'choice', options: ['Ate it', 'Froze it'] },
    });
    replica.refresh();
    const again = listAutomations(replica).automations.find(a => a.kind === 'groceryUseUp')!;
    expect(again.taskSettings).toMatchObject({ priority: 2, tags: ['cooking'] });
    // Says what the automation writes itself, with the lead the person set.
    expect(again.setByApp).toContain('Deadline: The use-by date');
  });

  it('leaves out fields not named and clears one set to null', () => {
    setAutomation(replica, 'birthday', { taskSettings: { priority: 3, tags: ['people'] } });
    const result = setAutomation(replica, 'birthday', { taskSettings: { tags: null } });
    expect(result.taskSettings).toEqual({ priority: 3 });
    expect(setAutomation(replica, 'birthday', { taskSettings: { priority: null } }).taskSettings).toBeUndefined();
  });

  it('refuses a choice question with fewer than two options, and writes nothing', () => {
    const before = listAutomations(replica).automations.find(a => a.kind === 'birthday')!.on;
    expect(() => setAutomation(replica, 'birthday', { on: !before, taskSettings: { askOnCompletion: { kind: 'choice', options: ['Only'] } } }))
      .toThrow(/two options/);
    expect(listAutomations(replica).automations.find(a => a.kind === 'birthday')!.on).toBe(before);
  });
});

describe('task settings an automation writes itself', () => {
  it('refuses a time of day for one that sets its own, and a question for one never completed', () => {
    expect(() => setAutomation(replica, 'moodLog', { taskSettings: { timeOfDay: 'evening' } })).toThrow(/time of day itself/);
    expect(() => setAutomation(replica, 'limitWarning', { taskSettings: { askOnCompletion: { kind: 'yesno' } } })).toThrow(/question/);
    // Clearing is always allowed.
    expect(() => setAutomation(replica, 'moodLog', { taskSettings: { timeOfDay: null } })).not.toThrow();
  });
});
