import { ADOPTION_CHECKS, unusedFeatures, type AdoptionCheck } from '../adoptionTools';
import type { Replica } from '../replica';

function task(over: Record<string, unknown> = {}) {
  return {
    id: String(Math.random()),
    parentId: null,
    completed: false,
    archived: false,
    estimatedMinutes: null,
    priority: 0,
    dueDate: null,
    reminderTime: null,
    category: null,
    pinned: false,
    blockedById: null,
    recurrenceType: 'none',
    ...over,
  } as never;
}

function fakeReplica(opts: {
  tasks?: unknown[];
  simpleMode?: boolean;
  notes?: string[];
  tags?: string[];
  templates?: unknown[];
  projects?: unknown[];
  kitchenEnabled?: boolean;
  recipes?: number;
  planned?: number;
  people?: unknown[];
  moodLogs?: number;
  milestones?: unknown[];
  medications?: unknown[];
  rewards?: boolean;
  recipeRows?: unknown[];
  categories?: { name: string; slotIn: boolean }[];
} = {}): Replica {
  return {
    tasks: () => opts.tasks ?? [],
    categories: () => opts.categories ?? [],
    generatorEnabled: () => false,
    settings: () => ({ simpleMode: !!opts.simpleMode, kitchenEnabled: opts.kitchenEnabled ?? true, completedRetentionDays: null, rewardsEnabled: opts.rewards ?? false }),
    recipes: () => opts.recipeRows ?? Array.from({ length: opts.recipes ?? 0 }, () => ({ name: 'Recipe', blanks: [], ingredients: [] })),
    mealPlan: () => Array.from({ length: opts.planned ?? 0 }),
    todayKey: () => '2026-10-05',
    shiftDayKey: (k: string) => k,
    people: () => opts.people ?? [],
    allMoodLogs: () => Array.from({ length: opts.moodLogs ?? 0 }),
    milestones: () => opts.milestones ?? [],
    medicationSettings: () => opts.medications ?? [],
    agentNotes: () => (opts.notes ?? []).map((text, i) => ({ id: String(i), text })),
    tagRegistry: () => opts.tags ?? [],
    templates: () => opts.templates ?? [],
    projects: () => opts.projects ?? [],
    projectProgress: () => ({ done: 0, total: 0 }),
    ruleLists: () => ({ title: [], weather: [], event: [], health: [], screenTime: [], blockOffer: [] }),
    isVisible: () => false,
    searchSettings: (q: string) => (q === 'categories' ? [{ label: 'Categories', path: 'Settings › Organize › Categories' }] : []),
  } as unknown as Replica;
}

const manyOpen = (n: number, over: Record<string, unknown> = {}) => Array.from({ length: n }, () => task(over));

describe('unusedFeatures', () => {
  it('says nothing for a small list, since there is no pattern to point at', () => {
    expect(unusedFeatures(fakeReplica({ tasks: manyOpen(5) })).suggestions).toEqual([]);
  });

  it('quotes the evidence for a check that fires', () => {
    const result = unusedFeatures(fakeReplica({ tasks: manyOpen(12) }));
    const estimates = result.suggestions.find(s => s.id === 'estimates');
    expect(estimates?.seen).toBe('0 of 12 open tasks have a time estimate.');
  });

  it('does not fire a check the data already satisfies', () => {
    const tasks = manyOpen(12, { estimatedMinutes: 15, priority: 2 });
    const ids = unusedFeatures(fakeReplica({ tasks }), { limit: 20 }).suggestions.map(s => s.id);
    expect(ids).not.toContain('estimates');
    expect(ids).not.toContain('priorities');
  });

  it('attaches the Settings path when the check names a setting', () => {
    const result = unusedFeatures(fakeReplica({ tasks: manyOpen(20) }), { limit: 20 });
    expect(result.suggestions.find(s => s.id === 'categories')?.settings).toEqual([
      { label: 'Categories', path: 'Settings › Organize › Categories' },
    ]);
  });

  it('drops the advanced checks in simplified mode', () => {
    const projects = [1, 2, 3].map(i => ({ id: `p${i}`, title: `P${i}`, archived: false, completed: false }));
    const tasks = manyOpen(40);
    const full = unusedFeatures(fakeReplica({ tasks, projects }), { limit: 20 }).suggestions.map(s => s.id);
    const simple = unusedFeatures(fakeReplica({ tasks, projects, simpleMode: true }), { limit: 20 }).suggestions.map(s => s.id);
    expect(full).toContain('templates');
    expect(full).toContain('automations');
    expect(simple).not.toContain('templates');
    expect(simple).not.toContain('automations');
  });

  it('stays quiet about a suggestion an agent note names, and reports that it did', () => {
    const result = unusedFeatures(fakeReplica({ tasks: manyOpen(12), notes: ['Do not suggest estimates again.'] }), { limit: 20 });
    expect(result.suggestions.map(s => s.id)).not.toContain('estimates');
    expect(result.silencedByNotes).toContain('estimates');
  });

  it('caps the list and says how many more applied', () => {
    const result = unusedFeatures(fakeReplica({ tasks: manyOpen(40) }), { limit: 1 });
    expect(result.suggestions).toHaveLength(1);
    expect(result.more).toBeGreaterThan(0);
  });
});

describe('kitchen, people and mood checks', () => {
  const ids = (r: Replica) => unusedFeatures(r, { limit: 30 }).suggestions.map(s => s.id);

  it('suggests planning meals only when recipes exist and nothing is planned', () => {
    expect(ids(fakeReplica({ recipes: 6 }))).toContain('meal_plan');
    expect(ids(fakeReplica({ recipes: 6, planned: 2 }))).not.toContain('meal_plan');
    expect(ids(fakeReplica({ recipes: 2 }))).not.toContain('meal_plan');
  });

  it('never suggests a kitchen feature while the kitchen is switched off', () => {
    expect(ids(fakeReplica({ recipes: 6, kitchenEnabled: false }))).not.toContain('meal_plan');
  });

  it('suggests birthdays when people are saved and none has one', () => {
    const person = (birthdayMonth: number | null) => ({ archived: false, kind: 'individual', birthdayMonth });
    expect(ids(fakeReplica({ people: [person(null), person(null), person(null)] }))).toContain('birthdays');
    expect(ids(fakeReplica({ people: [person(null), person(null), person(4)] }))).not.toContain('birthdays');
  });

  it('suggests milestones only once there are enough mood check-ins to compare', () => {
    expect(ids(fakeReplica({ moodLogs: 20 }))).toContain('milestones');
    expect(ids(fakeReplica({ moodLogs: 20, milestones: [{}] }))).not.toContain('milestones');
    expect(ids(fakeReplica({ moodLogs: 3 }))).not.toContain('milestones');
  });
});

describe('since: features that are new to the person', () => {
  const repeating = (over: Record<string, unknown> = {}) => task({ recurrenceType: 'daily', ...over });
  const holidayTasks = [repeating(), repeating(), repeating()];

  it('keeps only checks that shipped on or after the date, newest first', () => {
    const replica = fakeReplica({
      tasks: holidayTasks,
      medications: [{ name: 'Vitamin D3' }],
    });
    const result = unusedFeatures(replica, { since: '2026-10-01', limit: 20 });
    expect(result.suggestions.map(s => s.id)).toEqual(['supplement_nutrients', 'holiday_repeats']);
    expect(result.suggestions[0].shipped).toBe('2026-10-10');
  });

  it('leaves out a check that shipped before the date, and any check with no recorded date', () => {
    const replica = fakeReplica({ tasks: manyOpen(40), medications: [{ name: 'Vitamin D3' }] });
    const ids = unusedFeatures(replica, { since: '2026-10-09', limit: 20 }).suggestions.map(s => s.id);
    expect(ids).toEqual(['supplement_nutrients']);
  });

  it('does not suggest holidays once a repeating task uses them, or a supplement that lists its contents', () => {
    const replica = fakeReplica({
      tasks: [repeating({ recurrenceHolidays: 'skip' }), repeating(), repeating()],
      medications: [{ name: 'Vitamin D3', nutrients: 'Per 1 tablet: 1 nutrient' }, { name: 'Ibuprofen' }],
    });
    expect(unusedFeatures(replica, { since: '2026-01-01', limit: 20 }).suggestions).toEqual([]);
  });

  it('suggests a bounty only with rewards on, a task moved three or more times, and no bounty posted', () => {
    const ids = (rewards: boolean, tasks: unknown[]) =>
      unusedFeatures(fakeReplica({ rewards, tasks }), { since: '2026-10-01', limit: 20 }).suggestions.map(s => s.id);
    const pushed = task({ postponeCount: 4 });
    expect(ids(true, [pushed])).toContain('bounty');
    expect(ids(false, [pushed])).not.toContain('bounty');
    expect(ids(true, [task({ postponeCount: 1 })])).not.toContain('bounty');
    expect(ids(true, [pushed, task({ bountyPushes: 0 })])).not.toContain('bounty');
  });

  it('suggests blanks for a recipe with four or more optional lines and none of its own', () => {
    const line = (optional: boolean) => ({ name: 'x', optional });
    const ids = (recipeRows: unknown[]) =>
      unusedFeatures(fakeReplica({ recipeRows }), { since: '2026-10-01', limit: 20 }).suggestions.map(s => s.id);
    const loose = { name: 'Fridge frittata', blanks: [], ingredients: [line(true), line(true), line(true), line(true), line(false)] };
    expect(ids([loose])).toContain('recipe_blanks');
    expect(ids([{ ...loose, blanks: [{ id: 'b' }] }])).not.toContain('recipe_blanks');
    expect(ids([{ ...loose, ingredients: loose.ingredients.slice(1) }])).not.toContain('recipe_blanks');
  });

  it('suggests a destination only for a trip that has away dates and none', () => {
    const trip = (over: Record<string, unknown>) => ({ id: 'p', title: 'Lisbon', archived: false, completed: false, awayStart: '2026-11-01', destination: null, ...over });
    const ids = (projects: unknown[]) =>
      unusedFeatures(fakeReplica({ projects }), { since: '2026-09-01', limit: 20 }).suggestions.map(s => s.id);
    expect(ids([trip({})])).toContain('trip_destination');
    expect(ids([trip({ destination: 'Lisbon' })])).not.toContain('trip_destination');
    expect(ids([trip({ awayStart: null })])).not.toContain('trip_destination');
  });

  it('suggests waiting for a lighter day once tasks keep being moved by hand and nothing waits', () => {
    const ids = (tasks: unknown[], categories: { name: string; slotIn: boolean }[] = []) =>
      unusedFeatures(fakeReplica({ tasks: tasks as never, categories }), { since: '2026-10-19', limit: 20 }).suggestions.map(s => s.id);
    const pushed = [...manyOpen(3, { postponeCount: 2 }), ...manyOpen(20)];
    expect(ids(pushed)).toContain('slot_in');
    expect(ids([...manyOpen(2, { postponeCount: 2 }), ...manyOpen(20)])).not.toContain('slot_in');
    expect(ids(pushed, [{ name: 'Chores', slotIn: true }])).not.toContain('slot_in');
    expect(ids([...pushed, ...manyOpen(1, { slotIn: true })])).not.toContain('slot_in');
  });

  it('suggests block for coins only with rewards on, the automation off and no rule written', () => {
    const ids = (rewards: boolean, on: boolean, rules: number) => unusedFeatures({
      ...fakeReplica({ rewards }),
      generatorEnabled: () => on,
      ruleLists: () => ({ blockOffer: Array.from({ length: rules }) }),
    } as unknown as Replica, { since: '2026-10-19', limit: 20 }).suggestions.map(s => s.id);
    expect(ids(true, false, 0)).toContain('block_for_coins');
    expect(ids(false, false, 0)).not.toContain('block_for_coins');
    expect(ids(true, true, 0)).not.toContain('block_for_coins');
    expect(ids(true, false, 1)).not.toContain('block_for_coins');
  });

  it('suggests a program only with Workouts on, two or more routines and no program', () => {
    const ids = (on: boolean, routines: number, programs: number) => unusedFeatures({
      ...fakeReplica(),
      settings: () => ({ simpleMode: false, kitchenEnabled: true, completedRetentionDays: null, rewardsEnabled: false, workoutsEnabled: on }),
      workoutRoutines: () => Array.from({ length: routines }),
      workoutPrograms: () => Array.from({ length: programs }),
      gyms: () => [],
      workoutSessions: () => [],
    } as unknown as Replica, { since: '2026-09-01', limit: 20 }).suggestions.map(s => s.id);
    expect(ids(true, 2, 0)).toContain('workout_programs');
    expect(ids(true, 2, 1)).not.toContain('workout_programs');
    expect(ids(true, 1, 0)).not.toContain('workout_programs');
    expect(ids(false, 3, 0)).not.toContain('workout_programs');
  });
});

describe('ADOPTION_CHECKS', () => {
  it('records since as a YYYY-MM-DD date, because the since filter compares it as text', () => {
    for (const c of ADOPTION_CHECKS) if (c.since !== undefined) expect(c.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('has unique ids, because an id is how a declined suggestion is named', () => {
    const ids = ADOPTION_CHECKS.map((c: AdoptionCheck) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no id that is a substring of another, or naming one in a note would silence both', () => {
    const ids = ADOPTION_CHECKS.map(c => c.id);
    for (const a of ids) for (const b of ids) if (a !== b) expect(b.includes(a)).toBe(false);
  });
});
