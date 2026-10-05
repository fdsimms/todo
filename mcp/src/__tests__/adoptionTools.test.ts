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
} = {}): Replica {
  return {
    tasks: () => opts.tasks ?? [],
    settings: () => ({ simpleMode: !!opts.simpleMode, kitchenEnabled: opts.kitchenEnabled ?? true, completedRetentionDays: null }),
    recipes: () => Array.from({ length: opts.recipes ?? 0 }),
    mealPlan: () => Array.from({ length: opts.planned ?? 0 }),
    todayKey: () => '2026-10-05',
    shiftDayKey: (k: string) => k,
    people: () => opts.people ?? [],
    allMoodLogs: () => Array.from({ length: opts.moodLogs ?? 0 }),
    milestones: () => opts.milestones ?? [],
    agentNotes: () => (opts.notes ?? []).map((text, i) => ({ id: String(i), text })),
    tagRegistry: () => opts.tags ?? [],
    templates: () => opts.templates ?? [],
    projects: () => opts.projects ?? [],
    projectProgress: () => ({ done: 0, total: 0 }),
    ruleLists: () => ({ title: [], weather: [], event: [], health: [], screenTime: [] }),
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

describe('ADOPTION_CHECKS', () => {
  it('has unique ids, because an id is how a declined suggestion is named', () => {
    const ids = ADOPTION_CHECKS.map((c: AdoptionCheck) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no id that is a substring of another, or naming one in a note would silence both', () => {
    const ids = ADOPTION_CHECKS.map(c => c.id);
    for (const a of ids) for (const b of ids) if (a !== b) expect(b.includes(a)).toBe(false);
  });
});
