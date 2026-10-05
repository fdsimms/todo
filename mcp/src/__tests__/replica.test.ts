/**
 * The load-bearing test for the whole package: the app's db layer, its stores
 * and its visibility model, standing up in Node against a real SQLite file
 * through the shim.
 *
 * If this passes, the premise of docs/arch/mcp-server.md holds — `src/db` and
 * `src/utils` do not need React Native, and the MCP server is a second host for
 * the layer that is already here rather than a reimplementation of it. If it
 * ever fails, something in the app has grown a native dependency below
 * `database.ts`, and that is worth knowing on the PR that does it rather than
 * the next time somebody runs the server.
 *
 * `installExpoSqliteShim` is not exercised: jest keeps its own module registry,
 * so priming Node's `require.cache` does nothing here. `jest.mock` reaches the
 * same place through the same `openShimDatabase`, which is the part with the
 * behaviour in it.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { createTask as createTaskTool, getTask as getTaskTool, updateTask as updateTaskTool } from '../tools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

/**
 * Rows go in as SQL naming only the columns a case is about, so every other
 * column takes its schema default. That is deliberate on two counts: the tasks
 * table has thirty-odd NOT NULL columns and a fixture listing them is a copy of
 * database.test.ts's that nobody will update, and a row with defaults
 * everywhere else is exactly the shape an install upgrading into a new column
 * has. The read path is what matters here anyway — the server never writes, and
 * `rowToTask` is what it leans on.
 */
function insert(row: { id: string; title: string; dueDate?: string; deferUntil?: string; tags?: string[]; category?: string; priority?: number; parentId?: string }): void {
  mockRaw.runSync(
    'INSERT INTO tasks (id, title, created_at, due_date, defer_until, tags, category, priority, parent_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      row.id,
      row.title,
      '2026-01-01T00:00:00.000Z',
      row.dueDate ?? null,
      row.deferUntil ?? null,
      JSON.stringify(row.tags ?? []),
      row.category ?? null,
      row.priority ?? 0,
      row.parentId ?? null,
    ]
  );
}

/** A local calendar day, for comparing two dates without a timezone fight. */
function dayOf(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

describe('the replica', () => {
  let replica: ReturnType<typeof openReplica>;

  // Opened once: database.ts opens its handle at module scope and every test
  // here shares it, so a per-case reopen would re-run every migration against
  // the same database rather than starting a fresh one. `mockRaw` also only
  // exists from here on, since the mock factory does not run until openReplica
  // first requires expo-sqlite.
  beforeAll(() => {
    replica = openReplica(':memory:');
    // Every task created through taskPatch needs a category; the cases that
    // aren't about categories file theirs here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../src/store/useCategoryStore').useCategoryStore.getState().addCategory('Home');
    replica.refresh();
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM tasks');
    replica.refresh();
  });

  it('opens, migrates and hydrates without React Native', () => {
    // initDatabase ran: the schema exists and reads answer.
    expect(replica.tasks()).toEqual([]);
    // The stores hydrated: a device id is minted and the db is a real one.
    expect(replica.deviceId()).toEqual(expect.any(String));
    expect(replica.syncable()).toBe(true);
  });

  it('round-trips a task through the app\'s own row mapping', () => {
    insert({ id: 't1', title: 'Buy milk', tags: ['errand'], category: 'Home', priority: 3 });
    replica.refresh();

    const task = replica.taskById('t1');
    expect(task).toMatchObject({ id: 't1', title: 'Buy milk', category: 'Home', priority: 3 });
    // The JSON columns came back as arrays rather than as strings, which is the
    // half of rowToTask a hand-written `SELECT *` would have got wrong.
    expect(task?.tags).toEqual(['errand']);
    expect(task?.timeSegments).toEqual([]);
  });

  it('keeps its task read across a refresh when nothing changed, and drops it when something did', () => {
    replica.refresh();
    const before = replica.tasks();
    // Same file as far as SQLite can tell: the read is reused, not repeated.
    replica.refresh();
    expect(replica.tasks()).toBe(before);

    // A write on this connection moves the token, so the next refresh re-reads.
    insert({ id: 'refresh-probe', title: 'Probe' });
    replica.refresh();
    const after = replica.tasks();
    expect(after).not.toBe(before);
    expect(after.some(t => t.id === 'refresh-probe')).toBe(true);

    mockRaw.runSync('DELETE FROM tasks WHERE id = ?', ['refresh-probe']);
    replica.refresh();
    expect(replica.tasks().some(t => t.id === 'refresh-probe')).toBe(false);
  });

  it('sorts tasks into the app\'s four lenses, which a date comparison could not', () => {
    insert({ id: 'today', title: 'Due now', dueDate: new Date().toISOString() });
    insert({ id: 'later', title: 'Deferred', deferUntil: '2099-06-01T12:00:00.000Z' });
    insert({ id: 'unscheduled', title: 'Someday', category: 'Home' });
    // Bare: no date, no category, no tags, no priority. That is what makes it
    // an inbox task rather than an unscheduled one.
    insert({ id: 'inbox', title: 'Untriaged' });
    replica.refresh();

    const idsWhere = (p: (t: Parameters<typeof replica.isVisible>[0]) => boolean) =>
      replica.tasks().filter(p).map(t => t.id);

    expect(idsWhere(t => replica.isVisible(t))).toEqual(['today']);
    expect(idsWhere(t => replica.isUnscheduled(t))).toEqual(['unscheduled']);
    expect(idsWhere(t => replica.isInbox(t))).toEqual(['inbox']);
    // The lenses are disjoint, which is the property `matchesView` leans on.
    expect(idsWhere(t => replica.isVisible(t) || replica.isUnscheduled(t) || replica.isInbox(t)))
      .toEqual(['today', 'unscheduled', 'inbox']);

    expect(replica.visibleAt(replica.taskById('later')!).getFullYear()).toBe(2099);
  });

  it('reads the look-ahead in Node: rows on their day, a carried-over task and a projection', () => {
    const at = (days: number) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + days);
      return d.toISOString();
    };
    insert({ id: 'soon', title: 'Dentist', dueDate: at(2) });
    insert({ id: 'late', title: 'Taxes', dueDate: at(-3) });
    mockRaw.runSync("INSERT INTO tasks (id, title, created_at, due_date, recurrence_type) VALUES ('daily', 'Stretch', '2026-01-01T00:00:00.000Z', ?, 'daily')", [at(0)]);
    replica.refresh();

    const la = replica.lookAhead(5);
    expect(la.days).toHaveLength(5);
    expect(la.days[2].tasks.map(t => t.id)).toContain('soon');
    expect(la.carriedOver.map(t => t.id)).toEqual(['late']);
    // A daily task has one real row today and a projected occurrence after it.
    expect(la.days[1].expected.map(e => e.taskId)).toContain('daily');
  });

  it('finds a Settings row by a word that is not in its label, with the path to it', () => {
    const hits = replica.searchSettings('midnight');
    expect(hits[0]).toMatchObject({ label: 'Morning', path: 'Settings › Day & time › When the day turns over › Morning' });
  });

  it('reports the settings a reader needs to talk about the day', () => {
    expect(replica.settings()).toMatchObject({ dayResetTime: '00:00', weekStartsOn: 0, kitchenEnabled: true });
  });

  it('ranks a search with the app\'s own ranking', () => {
    insert({ id: 'a', title: 'Water the plants' });
    insert({ id: 'b', title: 'Call the plumber' });
    replica.refresh();

    expect(replica.search('plant').map(h => h.task.id)).toEqual(['a']);
    expect(replica.search('').map(h => h.task.id)).toEqual([]);
  });

  it('reads the log tables through the app\'s own row mapping', () => {
    // food_logs, mood_logs and medication_logs all arrived on main long after
    // this package was written, so this is the case that says the shim keeps up
    // with the schema rather than only with the tables it was built against.
    mockRaw.runSync(
      "INSERT INTO food_logs (id, day_key, at_iso, slot, label, quantity, nutrition, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        'f1',
        '2026-09-11',
        '2026-09-11T08:00:00.000Z',
        'breakfast',
        'Porridge',
        '1 bowl',
        // A real panel, because parseFoodNutrition refuses one with no basis,
        // no recordedAt or no amounts, and rowToFoodLogEntry drops the row
        // rather than inventing figures for it. That refusal is the behaviour
        // being relied on here, not an obstacle to the fixture.
        JSON.stringify({
          basis: 'perServing',
          recordedAt: '2026-09-11T08:00:00.000Z',
          amounts: { calorieKcal: 210 },
        }),
        '2026-09-11T08:00:00.000Z',
      ]
    );
    mockRaw.runSync(
      "INSERT INTO mood_logs (id, logged_at, day_key, mood, symptoms, context_tags) VALUES (?,?,?,?,?,?)",
      ['m1', '2026-09-11T09:00:00.000Z', '2026-09-11', 4, JSON.stringify([{ name: 'Headache', severity: 2 }]), '[]']
    );
    mockRaw.runSync(
      "INSERT INTO medication_logs (id, name, taken_at, day_key, amount, unit, as_needed) VALUES (?,?,?,?,?,?,?)",
      ['d1', 'Ibuprofen', '2026-09-11T20:00:00.000Z', '2026-09-11', 400, 'mg', 1]
    );
    replica.refresh();

    expect(replica.foodLogEntries('2026-09-01', '2026-09-30').map(e => e.label)).toEqual(['Porridge']);

    const mood = replica.moodLogs('2026-09-01', '2026-09-30');
    expect(mood).toHaveLength(1);
    // The JSON column came back as objects, and as_needed's 0/1 came back a
    // boolean — the two halves of rowToTask's discipline that a hand-written
    // query would have to redo.
    expect(mood[0].symptoms).toEqual([{ name: 'Headache', severity: 2 }]);

    const doses = replica.medicationLogs('2026-09-01', '2026-09-30');
    expect(doses[0].asNeeded).toBe(true);
    expect(replica.medicationSummary(doses[0])).toContain('Ibuprofen');
  });

  describe('correcting and deleting log entries', () => {
    beforeEach(() => {
      mockRaw.runSync('DELETE FROM food_logs');
      mockRaw.runSync('DELETE FROM mood_logs');
      mockRaw.runSync('DELETE FROM medication_logs');
    });

    it('restates an estimated food entry, and leaves its day alone', () => {
      const entry = replica.logFood({ label: 'Burrito', quantity: '1', amounts: { calorieKcal: 600 } });
      const updated = replica.updateFoodEntry(entry.id, { label: 'Chicken burrito', amounts: { calorieKcal: 750, proteinG: 40 }, slot: 'lunch' });

      expect(updated).toMatchObject({ label: 'Chicken burrito', slot: 'lunch', dayKey: entry.dayKey, atISO: entry.atISO });
      expect(updated.nutrition.amounts).toMatchObject({ calorieKcal: 750, proteinG: 40 });
      expect(() => replica.updateFoodEntry(entry.id, { label: ' ' })).toThrow(/needs a name/);
      expect(() => replica.updateFoodEntry('nope', {})).toThrow(/No food entry/);
    });

    it('will not restate figures that were measured, or touch one already in Apple Health', () => {
      const measured = replica.logFood({ label: 'Oats', amounts: { calorieKcal: 300 } });
      mockRaw.runSync("UPDATE food_logs SET nutrition = json_set(nutrition, '$.source', 'openFoodFacts') WHERE id = ?", [measured.id]);
      expect(() => replica.updateFoodEntry(measured.id, { amounts: { calorieKcal: 1 } })).toThrow(/measured/);
      // A rename is not a figure, so it still goes through.
      expect(replica.updateFoodEntry(measured.id, { label: 'Porridge oats' }).label).toBe('Porridge oats');

      const synced = replica.logFood({ label: 'Soup', amounts: { calorieKcal: 200 } });
      mockRaw.runSync("UPDATE food_logs SET health_sample_ids = '[\"s1\"]' WHERE id = ?", [synced.id]);
      expect(() => replica.deleteFoodEntry(synced.id)).toThrow(/Apple Health/);
      expect(() => replica.updateFoodEntry(synced.id, { amounts: { calorieKcal: 1 } })).toThrow(/Apple Health/);
    });

    it('deletes a food entry', () => {
      const entry = replica.logFood({ label: 'Toast', amounts: { calorieKcal: 100 } });
      expect(replica.deleteFoodEntry(entry.id).label).toBe('Toast');
      expect(replica.foodLogEntries(entry.dayKey, entry.dayKey)).toEqual([]);
    });

    it('corrects a mood check-in in the spelling already used, and refuses to empty it', () => {
      const log = replica.logMood({ mood: 3, symptoms: [{ name: 'Headache', severity: 2 }], note: 'meh' });
      const updated = replica.updateMoodLog(log.id, { mood: 4, symptoms: [{ name: 'headache', severity: 3 }], note: null });

      expect(updated).toMatchObject({ mood: 4, note: null, dayKey: log.dayKey });
      expect(updated.symptoms).toEqual([{ name: 'Headache', severity: 3 }]);
      expect(() => replica.updateMoodLog(log.id, { mood: null, symptoms: [] })).toThrow(/empty/);
      expect(() => replica.updateMoodLog(log.id, { mood: 9 })).toThrow(/1 \(low\) to 5/);
      expect(replica.deleteMoodLog(log.id).id).toBe(log.id);
      expect(() => replica.deleteMoodLog(log.id)).toThrow(/No mood check-in/);
    });

    it('corrects a dose, keeping amount and unit together', () => {
      const dose = replica.logMedication({ name: 'Ibuprofen', amount: 200, unit: 'mg' });
      expect(replica.updateMedicationLog(dose.id, { amount: 400 })).toMatchObject({ amount: 400, unit: 'mg', name: 'Ibuprofen' });
      expect(() => replica.updateMedicationLog(dose.id, { unit: null })).toThrow(/together/);
      expect(replica.updateMedicationLog(dose.id, { name: 'ibuprofen', note: 'with food' })).toMatchObject({ name: 'Ibuprofen', note: 'with food' });
      expect(replica.deleteMedicationLog(dose.id).id).toBe(dose.id);
      expect(() => replica.deleteMedicationLog(dose.id)).toThrow(/No dose/);
    });
  });

  describe('changing the meal plan', () => {
    it('moves a meal to the end of another slot, and renames only a free-text one', () => {
      const a = replica.planMeal({ date: '2026-09-20', slot: 'dinner', title: 'Takeout' });
      replica.planMeal({ date: '2026-09-21', slot: 'lunch', title: 'Soup' });
      const moved = replica.updateMeal(a.id, { date: '2026-09-21', slot: 'lunch', title: 'Pizza' });

      expect(moved).toMatchObject({ date: '2026-09-21', slot: 'lunch', title: 'Pizza' });
      expect(moved.sortOrder).toBeGreaterThan(replica.mealPlan('2026-09-21', '2026-09-21').find(e => e.title === 'Soup')!.sortOrder);

      const recipe = replica.createRecipe({ name: 'Chili' });
      const backed = replica.planMeal({ date: '2026-09-22', slot: 'dinner', recipeId: recipe.id });
      expect(() => replica.updateMeal(backed.id, { title: 'Stew' })).toThrow(/recipe or leftover/);
      expect(replica.updateMeal(backed.id, { scale: 2 }).recipeScale).toBe(2);
      expect(() => replica.updateMeal(a.id, { scale: 2 })).toThrow(/recipe has a scale/);
      expect(() => replica.updateMeal('nope', {})).toThrow(/No planned meal/);
    });

    it('removes a meal, but not one marked cooked', () => {
      const a = replica.planMeal({ date: '2026-09-23', slot: 'dinner', title: 'Pasta' });
      expect(replica.removeMeal(a.id).title).toBe('Pasta');
      expect(replica.mealPlan('2026-09-23', '2026-09-23')).toEqual([]);

      const b = replica.planMeal({ date: '2026-09-24', slot: 'dinner', title: 'Rice' });
      mockRaw.runSync("UPDATE meal_plan_entries SET cooked_at = '2026-09-24T19:00:00.000Z' WHERE id = ?", [b.id]);
      expect(() => replica.removeMeal(b.id)).toThrow(/marked cooked/);
    });
  });

  describe('adding and changing a person', () => {
    it('adds someone with nothing claimed about the friendship, and changes them', () => {
      const person = replica.createPerson({ name: ' Sam ', birthday: { month: 2, day: 29 }, email: 'sam@example.com', askAbout: 'the move' });
      expect(person).toMatchObject({ name: 'Sam', birthdayMonth: 2, birthdayDay: 29, birthYear: null, email: 'sam@example.com', askAbout: 'the move' });
      // The rule the doc exists for: no rhythm is declared on anybody's behalf.
      expect(person).toMatchObject({ cadenceDays: 0, nudgeOptIn: false, groupId: null });
      expect(replica.people().some(p => p.id === person.id)).toBe(true);

      const updated = replica.updatePerson(person.id, { nickname: 'Sammy', birthday: null, email: null });
      expect(updated).toMatchObject({ nickname: 'Sammy', birthdayMonth: null, birthdayDay: null, email: null, name: 'Sam' });
    });

    it('refuses a birthday that is not a date, a blank name, and an unknown person', () => {
      expect(() => replica.createPerson({ name: 'A', birthday: { month: 4, day: 31 } })).toThrow(/real month/);
      expect(() => replica.createPerson({ name: 'A', birthday: { month: 5, day: 5, year: 1800 } })).toThrow(/1900/);
      expect(() => replica.createPerson({ name: ' ' })).toThrow(/needs a name/);
      expect(() => replica.updatePerson('nope', { nickname: 'x' })).toThrow(/No person/);
    });
  });

  it('renames a stack without touching its category', () => {
    const stack = replica.createStack('Morning', 'Home');
    const renamed = replica.renameStack(stack.id, ' Mornings ');
    expect(renamed).toMatchObject({ id: stack.id, title: 'Mornings', category: 'Home' });
    expect(replica.stacks().find(s => s.id === stack.id)!.title).toBe('Mornings');
    expect(() => replica.renameStack(stack.id, ' ')).toThrow(/needs a title/);
    expect(() => replica.renameStack('nope', 'x')).toThrow(/No stack/);
  });

  describe('changing and deleting a recipe', () => {
    it('changes scalar fields and replaces the lists, leaving the rest', () => {
      const recipe = replica.createRecipe({ name: 'Edit Chili', servings: 4, ingredients: [{ text: '1 onion' }, { text: '2 cloves garlic' }], steps: [{ text: 'Chop' }, { text: 'Cook' }], tags: ['soup'] });
      const updated = replica.updateRecipe(recipe.id, {
        servings: 6,
        notes: 'Better next day',
        ingredients: [{ text: '3 onions' }],
        steps: [{ text: 'Chop everything' }],
      });

      expect(updated).toMatchObject({ servings: 6, notes: 'Better next day', tags: ['soup'] });
      expect(updated.ingredients.map(i => i.name)).toEqual(['onions']);
      expect(updated.steps.map(s => s.text)).toEqual(['Chop everything']);
      expect(() => replica.updateRecipe('nope', {})).toThrow(/No recipe/);
    });

    it('renames, retitles planned meals, and refuses a clash in the same cookbook', () => {
      const a = replica.createRecipe({ name: 'Rename Soup' });
      replica.createRecipe({ name: 'Rename Stew' });
      const meal = replica.planMeal({ date: '2026-09-30', slot: 'dinner', recipeId: a.id });

      expect(() => replica.updateRecipe(a.id, { name: 'rename stew' })).toThrow(/already a recipe/);
      expect(() => replica.updateRecipe(a.id, { name: ' ' })).toThrow(/needs a name/);
      const renamed = replica.updateRecipe(a.id, { name: 'Rename Broth' });
      expect(renamed.name).toBe('Rename Broth');
      expect(replica.mealPlan('2026-09-30', '2026-09-30').find(e => e.id === meal.id)!.title).toBe('Rename Broth');
    });

    it('leaves everything alone when the edit is refused', () => {
      const a = replica.createRecipe({ name: 'Atomic A', servings: 2 });
      replica.createRecipe({ name: 'Atomic B' });
      expect(() => replica.updateRecipe(a.id, { servings: 9, name: 'Atomic B' })).toThrow();
      expect(replica.recipes().find(r => r.id === a.id)!.servings).toBe(2);
    });

    it('deletes a recipe and says how many planned meals lose the link', () => {
      const a = replica.createRecipe({ name: 'Delete Me' });
      replica.planMeal({ date: '2026-10-01', slot: 'dinner', recipeId: a.id });
      const result = replica.deleteRecipe(a.id);
      expect(result).toMatchObject({ plannedMeals: 1 });
      expect(replica.recipes().some(r => r.id === a.id)).toBe(false);
      expect(replica.mealPlan('2026-10-01', '2026-10-01')[0].title).toBe('Delete Me');
      expect(() => replica.deleteRecipe(a.id)).toThrow(/No recipe/);
    });
  });

  it('bounds a log range on the logical day rather than the calendar one', () => {
    // getLogicalToday honours dayResetTime, so a read at 1am under a 2am reset
    // asks about the day the user would name. Only the shape is asserted here;
    // dateUtils owns the arithmetic and tests it.
    expect(replica.todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(replica.shiftDayKey('2026-03-02', -7)).toBe('2026-02-23');
    expect(replica.shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('builds a whole template, resolving group keys and question names to ids', () => {
    const built = replica.createTemplate({
      name: 'Trip',
      category: 'Home',
      container: 'project',
      anchorsAreAway: true,
      groups: [{ key: 'clothes', title: 'Clothes' }],
      questions: [
        { name: 'trip', prompt: 'What kind of trip?', kind: 'choice', options: ['Work', 'Holiday'] },
        { name: 'nights', prompt: 'How many nights?', kind: 'number', fromDates: 'nights' },
      ],
      items: [
        { title: 'Shirts', groupKey: 'clothes', dueOffsetDays: -1 },
        { title: 'Laptop', conditions: [{ question: 'trip', values: ['Work'] }] },
      ],
    });

    expect(built).toMatchObject({ name: 'Trip', category: 'Home', applyContainer: 'project', anchorsAreAway: true });

    // The two cross-references the caller wrote as a key and a name now point
    // at ids it could not have known, which is the whole job of the applier.
    const group = built.itemGroups[0];
    const choice = built.questions.find(q => q.name === 'trip')!;
    expect(built.items.find(i => i.title === 'Shirts')!.groupId).toBe(group.id);
    expect(built.items.find(i => i.title === 'Laptop')!.conditions).toEqual([
      { questionId: choice.id, values: ['Work'] },
    ]);
    expect(choice.id).not.toBe('trip');
  });

  it('leaves the field defaults to the app\'s own normalizer', () => {
    const built = replica.createTemplate({ name: 'Bare', items: [{ title: 'One thing' }] });
    const item = built.items[0];

    // Restating these in the tool would be a second copy of normalizeTemplateItem
    // to keep in step with the app.
    expect(item).toMatchObject({
      anchor: 'start',
      optional: false,
      polarity: 'positive',
      recurrenceType: 'none',
      recurrenceInterval: 1,
      priority: 0,
      tags: [],
      conditions: [],
    });
    expect(item.id).toEqual(expect.any(String));
  });

  it('nests one template inside another, by name', () => {
    const packing = replica.createTemplate({ name: 'Packing list', items: [{ title: 'Socks' }] });
    const trip = replica.createTemplate({
      name: 'Trip with packing',
      items: [{ title: 'Bring the packing list', refTemplate: 'Packing list' }],
    });

    const ref = trip.items[0];
    expect(ref.refTemplateId).toBe(packing.id);
    // Carried so a broken reference can still say what it pointed at.
    expect(ref.refTemplateName).toBe('Packing list');
  });

  it('writes nothing at all when the plan is invalid', () => {
    const before = replica.templates().length;
    expect(() =>
      replica.createTemplate({
        name: 'Broken',
        items: [{ title: 'Thing', groupKey: 'nope' }],
      })
    ).toThrow('does not define');

    // A half-built template is worse than none: it looks finished in the list.
    expect(replica.templates()).toHaveLength(before);
  });

  it('reports every problem in one throw', () => {
    expect(() => replica.createTemplate({ name: '', items: [] })).toThrow(/name is required.*at least one item/);
  });

  describe('updateTemplate', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = () => require('../../../src/db/database');
    beforeEach(() => mockRaw.runSync('DELETE FROM templates'));

    const trip = () => replica.createTemplate({
      name: 'Trip',
      groups: [{ key: 'clothes', title: 'Clothes', checklist: true }],
      questions: [{ name: 'trip', prompt: 'What kind of trip?', kind: 'choice', options: ['Work', 'Holiday'] }],
      items: [
        { title: 'Shirts', groupKey: 'clothes', dueOffsetDays: -1, estimatedMinutes: 10 },
        { title: 'Laptop', conditions: [{ question: 'trip', values: ['Work'] }] },
      ],
    });

    it('changes only the scalar fields it is given, leaving the items alone', () => {
      const built = trip();
      const updated = replica.updateTemplate(built.id, { name: ' Trip v2 ', category: 'Home', container: 'stack' });

      expect(updated).toMatchObject({ id: built.id, name: 'Trip v2', category: 'Home', applyContainer: 'stack' });
      expect(updated.items).toEqual(built.items);
      expect(replica.templates().find(t => t.id === built.id)!.name).toBe('Trip v2');
    });

    it('finds the template by exact name too', () => {
      trip();
      expect(replica.updateTemplate('Trip', { anchorsAreAway: true }).anchorsAreAway).toBe(true);
    });

    it('clears the fired mark only when the schedule actually changes', () => {
      const built = trip();
      replica.updateTemplate(built.id, { schedule: { frequency: 'weekly', weekday: 1 } });
      const stored = replica.templates().find(t => t.id === built.id)!;
      // Simulate a period that already fired.
      stored.scheduleLastFiredKey = '2026-W36';
      db().dbUpdateTemplate(stored);

      const same = replica.updateTemplate(built.id, { schedule: { frequency: 'weekly', weekday: 1 } });
      expect(same.scheduleLastFiredKey).toBe('2026-W36');
      const moved = replica.updateTemplate(built.id, { schedule: { frequency: 'weekly', weekday: 3 } });
      expect(moved.scheduleLastFiredKey).toBeNull();
      expect(replica.updateTemplate(built.id, { schedule: null }).schedule).toBeNull();
    });

    it('keeps an item by id with every field it had, including ones a plan cannot name', () => {
      const built = trip();
      const shirts = built.items.find(i => i.title === 'Shirts')!;
      const laptop = built.items.find(i => i.title === 'Laptop')!;

      const updated = replica.updateTemplate(built.id, {
        items: [{ id: shirts.id, title: 'Shirts and socks' }, { id: laptop.id }, { title: 'Charger' }],
      });

      const kept = updated.items.find(i => i.id === shirts.id)!;
      expect(kept).toMatchObject({ title: 'Shirts and socks', dueOffsetDays: -1, estimatedMinutes: 10, groupId: built.itemGroups[0].id });
      // The condition still points at the same question, since a kept
      // question keeps its id.
      expect(updated.items.find(i => i.id === laptop.id)!.conditions).toEqual(laptop.conditions);
      expect(updated.items.find(i => i.title === 'Charger')!.id).not.toBe(shirts.id);
      expect(updated.itemGroups).toEqual(built.itemGroups);
      expect(updated.questions).toEqual(built.questions);
    });

    it('removes an item that is left out', () => {
      const built = trip();
      const updated = replica.updateTemplate(built.id, { items: [{ id: built.items[0].id }] });
      expect(updated.items).toHaveLength(1);
    });

    it('replaces questions and refuses a condition left pointing at a removed one', () => {
      const built = trip();
      expect(() => replica.updateTemplate(built.id, { questions: [] })).toThrow(/does not define/);
      expect(replica.templates().find(t => t.id === built.id)!.questions).toHaveLength(1);
    });

    it('writes nothing when the edit is invalid', () => {
      const built = trip();
      expect(() => replica.updateTemplate(built.id, { name: 'Renamed', items: [{ id: 'nope', title: 'x' }] })).toThrow(/not an item of this template/);
      expect(replica.templates().find(t => t.id === built.id)!.name).toBe('Trip');
      expect(() => replica.updateTemplate(built.id, { name: ' ' })).toThrow(/name is required/);
      expect(() => replica.updateTemplate('missing', { name: 'x' })).toThrow(/No template/);
    });

    it('refuses to nest a template inside itself, directly or through another', () => {
      const a = replica.createTemplate({ name: 'A', items: [{ title: 'a1' }] });
      const b = replica.createTemplate({ name: 'B', items: [{ title: 'Nest A', refTemplate: a.id }] });
      expect(() => replica.updateTemplate(a.id, { items: [{ title: 'Nest A', refTemplate: a.id }] })).toThrow(/contain itself/);
      expect(() => replica.updateTemplate(a.id, { items: [{ title: 'Nest B', refTemplate: b.id }] })).toThrow(/contain itself/);
    });

    it('writes a chain and a rotation on an item, and keeps their ids across an edit', () => {
      const t = replica.createTemplate({
        name: 'Routine',
        items: [
          { title: 'Book haircut', chain: { steps: [{ title: 'Book', asks: 'date', answerSchedulesNextStep: true, estimatedMinutes: 5 }, { title: 'Get haircut' }] } },
          { title: 'Weekly reads', rotation: { members: ['Poetry', 'History'] } },
        ],
      });
      const chain = t.items[0];
      expect(chain).toMatchObject({ chainEnabled: true, chainIndex: 0 });
      expect(chain.chainItems.map(c => c.title)).toEqual(['Book', 'Get haircut']);
      expect(chain.chainItems[0]).toMatchObject({ deliverableKind: 'date', deliverableDatesNextStep: true, estimatedMinutes: 5 });
      expect(t.items[1].rotationItems.map(r => r.title)).toEqual(['Poetry', 'History']);

      // Renaming one step and adding a member keeps the ids that were there.
      const updated = replica.updateTemplate(t.id, {
        items: [
          { id: chain.id, chain: { steps: [{ title: 'Book it', asks: 'date', answerSchedulesNextStep: true }, { title: 'Get haircut' }] } },
          { id: t.items[1].id, rotation: { members: ['Poetry', 'History', 'Essays'] } },
        ],
      });
      expect(updated.items[0].chainItems[0].id).toBe(chain.chainItems[0].id);
      expect(updated.items[1].rotationItems.slice(0, 2).map(r => r.id)).toEqual(t.items[1].rotationItems.map(r => r.id));

      // An item sent as { id } alone keeps both, and null removes one.
      const kept = replica.updateTemplate(t.id, { items: [{ id: chain.id }, { id: t.items[1].id, rotation: null }] });
      expect(kept.items[0].chainEnabled).toBe(true);
      expect(kept.items[1]).toMatchObject({ rotationEnabled: false, rotationItems: [] });
    });

    it('refuses a one-step chain, a repeated rotation member, and both at once', () => {
      expect(() => replica.createTemplate({ name: 'A', items: [{ title: 'x', chain: { steps: [{ title: 'only' }] } }] })).toThrow(/at least two steps/);
      expect(() => replica.createTemplate({ name: 'B', items: [{ title: 'x', rotation: { members: ['a', 'A'] } }] })).toThrow(/all be different/);
      expect(() => replica.createTemplate({ name: 'C', items: [{ title: 'x', chain: { steps: [{ title: 'a' }, { title: 'b', answerSchedulesNextStep: true }] }, rotation: { members: ['a', 'b'] } }] })).toThrow(/needs asks: "date"|both a chain and a rotation/);
    });

    it('registers a template category the editor can list', () => {
      const built = trip();
      replica.updateTemplate(built.id, { category: 'Travel' });
      expect(db().dbGetAllTemplateCategories().map((c: { name: string }) => c.name)).toContain('Travel');
    });

    it('deletes a template and names the ones that nested it', () => {
      const inner = replica.createTemplate({ name: 'Inner', items: [{ title: 'i' }] });
      replica.createTemplate({ name: 'Outer', items: [{ title: 'Nest', refTemplate: inner.id }] });
      const result = replica.deleteTemplate('Inner');
      expect(result.nestedIn).toEqual(['Outer']);
      expect(replica.templates().map(t => t.name)).toEqual(['Outer']);
      expect(() => replica.deleteTemplate('Inner')).toThrow(/No template/);
    });

    it('reorders: the listed ones first, the rest after in their old order', () => {
      const a = replica.createTemplate({ name: 'A', items: [{ title: 'x' }] });
      const b = replica.createTemplate({ name: 'B', items: [{ title: 'x' }] });
      const c = replica.createTemplate({ name: 'C', items: [{ title: 'x' }] });
      expect(replica.reorderTemplates([c.id]).map(t => t.name)).toEqual(['C', 'A', 'B']);
      expect(replica.templates().sort((x, y) => x.sortOrder - y.sortOrder).map(t => t.name)).toEqual(['C', 'A', 'B']);
      expect(() => replica.reorderTemplates([a.id, a.id])).toThrow(/twice/);
      expect(() => replica.reorderTemplates(['nope'])).toThrow(/No template/);
      void b;
    });

    describe('running a template', () => {
      const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
      const trip = () => replica.createTemplate({
        name: 'Trip',
        container: 'project',
        anchorsAreAway: true,
        groups: [{ key: 'clothes', title: 'Clothes', checklist: true }],
        questions: [
          { name: 'kind', prompt: 'What kind of trip?', kind: 'choice', options: ['Holiday', 'Work'] },
          { name: 'nights', prompt: 'How many nights?', kind: 'number', fromDates: 'nights' },
        ],
        items: [
          { title: 'Pack {nights} shirts', groupKey: 'clothes', dueOffsetDays: -1, category: 'Home' },
          { title: 'Laptop', conditions: [{ question: 'kind', values: ['Work'] }], category: 'Home' },
          { title: 'Sunscreen', optional: true, category: 'Home', subtasks: [{ id: 's1', title: 'SPF 50' }] },
        ],
      });

      it('creates a project with the away span, answers in titles, the section and its checklist flag', () => {
        const t = trip();
        const result = replica.applyTemplate(t.id, { runName: 'Lisbon', start: day(2026, 10, 10), end: day(2026, 10, 17) });

        expect(result.container).toMatchObject({ kind: 'project', name: 'Lisbon' });
        // Nights come off the dates, 10th to 17th being 7, and the work-only
        // laptop and the optional sunscreen are off by default.
        expect(result.tasks.map(x => x.title)).toEqual(['Pack 7 shirts']);
        const project = replica.projects().find(p => p.id === result.container!.id)!;
        expect(project.awayStart).toBeTruthy();
        expect(result.tasks[0].projectId).toBe(project.id);
        const section = replica.stacks().find(g => g.title === 'Clothes')!;
        expect(section).toMatchObject({ projectId: project.id, checklist: true });
        expect(replica.tasks().find(x => x.id === result.tasks[0].id)!.groupId).toBe(section.id);
      });

      it('follows the answers, and include / leaveOut', () => {
        const t = trip();
        const sunscreen = t.items.find(i => i.title === 'Sunscreen')!;
        const shirts = t.items.find(i => i.title.startsWith('Pack'))!;
        const result = replica.applyTemplate(t.id, {
          answers: { kind: 'Work', nights: '3' },
          include: [sunscreen.id],
          leaveOut: [shirts.id],
        });

        expect(result.tasks.map(x => x.title).sort()).toEqual(['Laptop', 'Sunscreen']);
        // Unnamed run: loose tasks, and the optional item's stub is a subtask.
        expect(result.container).toBeNull();
        const stub = replica.tasks().find(x => x.title === 'SPF 50');
        expect(stub?.parentId).toBe(result.tasks.find(x => x.title === 'Sunscreen')!.id);
      });

      it('puts the items under one task when the container is a task, and into a stack otherwise', () => {
        const one = replica.createTemplate({ name: 'Onboarding', container: 'task', items: [{ title: 'Laptop', category: 'Home', subtasks: [{ id: 'a', title: 'Order' }] }, { title: 'Badge', category: 'Home' }] });
        const asTask = replica.applyTemplate(one.id, { runName: 'New hire' });
        expect(asTask.container).toMatchObject({ kind: 'task', name: 'New hire' });
        // The stub is flattened onto the run task rather than nested a level deeper.
        expect(replica.tasks().find(x => x.title === 'Order')!.parentId).toBe(asTask.container!.id);

        const stackT = replica.createTemplate({ name: 'Morning', container: 'stack', items: [{ title: 'Stretch', category: 'Home' }, { title: 'Water', category: 'Home' }] });
        const asStack = replica.applyTemplate(stackT.id, { runName: 'Mornings' });
        const stack = replica.stacks().find(g => g.id === asStack.container!.id)!;
        expect(stack).toMatchObject({ title: 'Mornings', category: 'Home' });
        expect(replica.tasks().filter(x => x.groupId === stack.id)).toHaveLength(2);
      });

      // The default selection names leaves; the run has to find its way into
      // a nested template by itself or everything inside one is dropped.
      it('creates the items of a nested template', () => {
        const packing = replica.createTemplate({ name: 'Packing', items: [{ title: 'Charger', category: 'Home' }] });
        const outer = replica.createTemplate({ name: 'Weekend', items: [{ title: 'Book hotel', category: 'Home' }, { title: 'Packing', refTemplate: packing.id }] });
        const result = replica.applyTemplate(outer.id, {});
        expect(result.tasks.map(x => x.title)).toEqual(['Book hotel', 'Charger']);
      });

      it('refuses a bad answer, an unknown item or project, and writes nothing', () => {
        const t = trip();
        const before = replica.tasks().length;
        expect(() => replica.applyTemplate(t.id, { answers: { kind: 'Cruise' } })).toThrow(/must be one of Holiday, Work/);
        expect(() => replica.applyTemplate(t.id, { answers: { nope: 'x' } })).toThrow(/no question named/);
        expect(() => replica.applyTemplate(t.id, { include: ['zzz'] })).toThrow(/not an item of this run/);
        expect(() => replica.applyTemplate(t.id, { projectId: 'nope' })).toThrow(/No project/);
        expect(() => replica.applyTemplate('missing', {})).toThrow(/No template/);
        expect(replica.tasks()).toHaveLength(before);
      });
    });

    it('survives a pre-existing broken nested reference on a rename', () => {
      const inner = replica.createTemplate({ name: 'Inner', items: [{ title: 'i' }] });
      const outer = replica.createTemplate({ name: 'Outer', items: [{ title: 'Nest', refTemplate: inner.id }] });
      db().dbDeleteTemplate(inner.id);
      expect(replica.updateTemplate(outer.id, { name: 'Outer 2' }).items[0].refTemplateName).toBe('Inner');
    });
  });

  it('creates a task through the app\'s own builder, defaults and all', () => {
    const task = replica.createTask({ title: 'Water the plants', category: 'Home' });

    expect(task).toMatchObject({ title: 'Water the plants', category: 'Home', completed: false });
    // newTaskFromDraft's doing, not the tool's: an id, a created stamp, and the
    // hundred other fields at their defaults. A tool restating any of these
    // would be a second copy to keep in step.
    expect(task.id).toEqual(expect.any(String));
    expect(task.createdAt).toEqual(expect.any(String));
    expect(task.recurrenceType).toBe('none');
    expect(task.tags).toEqual([]);

    // And it is really in the database, not just returned.
    replica.refresh();
    expect(replica.taskById(task.id)?.title).toBe('Water the plants');
  });

  it('gives each new task the next sort order rather than colliding on one', () => {
    const first = replica.createTask({ title: 'First' });
    const second = replica.createTask({ title: 'Second' });
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
  });

  it('refuses a task with no title', () => {
    expect(() => replica.createTask({ title: '   ' })).toThrow('needs a title');
  });

  it('leaves the reminder to the device that receives it', () => {
    // addTask schedules a notification around this; the replica deliberately
    // does not, because it has no notification centre and the phone's own
    // rebuildNotificationQueue reschedules from every task after a sync.
    const task = replica.createTask({
      title: 'Call the dentist',
      reminderTime: '2099-01-01T09:00:00.000Z',
    });
    expect(task.reminderTime).toBe('2099-01-01T09:00:00.000Z');
  });

  // ==== project progress ====

  // The read listProjects reports. A plain count of incomplete rows disagrees
  // with it on exactly this case, which is why the tool was changed to ask.
  it('counts a project member once however many times it has recurred', () => {
    mockRaw.runSync(
      'INSERT INTO projects (id, title, created_at) VALUES (?,?,?)',
      ['p1', 'Habits', '2026-01-01T00:00:00.000Z']
    );
    // One habit, worked three times: two tombstones chained back to the first
    // row, plus the live occurrence.
    insert({ id: 'h1', title: 'Water the plants' });
    insert({ id: 'h2', title: 'Water the plants' });
    insert({ id: 'h3', title: 'Water the plants' });
    mockRaw.runSync('UPDATE tasks SET project_id = ? WHERE id IN (?,?,?)', ['p1', 'h1', 'h2', 'h3']);
    mockRaw.runSync("UPDATE tasks SET completed = 1, completed_at = ? WHERE id IN (?,?)",
      ['2026-03-01T00:00:00.000Z', 'h1', 'h2']);
    mockRaw.runSync('UPDATE tasks SET previous_occurrence_id = ? WHERE id = ?', ['h1', 'h2']);
    mockRaw.runSync('UPDATE tasks SET previous_occurrence_id = ? WHERE id = ?', ['h2', 'h3']);
    replica.refresh();

    // One member, not three, and not done while its live row is outstanding.
    expect(replica.projectProgress('p1')).toEqual({ done: 0, total: 1 });
  });

  it('counts a finished one-off as done', () => {
    mockRaw.runSync(
      'INSERT INTO projects (id, title, created_at) VALUES (?,?,?)',
      ['p2', 'Kitchen', '2026-01-01T00:00:00.000Z']
    );
    insert({ id: 'a', title: 'Pick tiles' });
    insert({ id: 'b', title: 'Order tiles' });
    mockRaw.runSync('UPDATE tasks SET project_id = ? WHERE id IN (?,?)', ['p2', 'a', 'b']);
    mockRaw.runSync("UPDATE tasks SET completed = 1, completed_at = ? WHERE id = ?",
      ['2026-03-01T00:00:00.000Z', 'a']);
    replica.refresh();

    expect(replica.projectProgress('p2')).toEqual({ done: 1, total: 2 });
  });

  // ==== groceries ====

  describe('the grocery list', () => {
    beforeEach(() => {
      mockRaw.runSync('DELETE FROM grocery_items');
      mockRaw.runSync('DELETE FROM grocery_list_items');
      replica.refresh();
    });

    it('mints a shelf item and puts it in the trolley', () => {
      const { item, isNew } = replica.addGroceryItem('milk');
      expect(isNew).toBe(true);
      expect(item.name).toBe('milk');
      expect(item.onList).toBe(true);
      // Filed by the app's own lexicon rather than left unplaced.
      expect(item.aisle).toBe('Dairy & Eggs');

      replica.refresh();
      expect(replica.groceryItems().map(i => i.name)).toEqual(['milk']);
    });

    it('splits a leading amount off the name', () => {
      const { item } = replica.addGroceryItem('2 gal milk');
      expect(item.name).toBe('milk');
      expect(item.quantity).toBe('2 gal');
    });

    it('takes a quantity stated separately without it becoming the name', () => {
      const { item } = replica.addGroceryItem('milk', { quantity: '1 pint' });
      expect(item.name).toBe('milk');
      expect(item.quantity).toBe('1 pint');
    });

    // The whole reason the catalog and the list are one thing: a name bought
    // before comes back with everything recorded on it.
    it('re-lists a parked row rather than minting a second', () => {
      const first = replica.addGroceryItem('milk').item;
      replica.removeFromGroceryList(first.id);
      replica.refresh();

      const again = replica.addGroceryItem('milk');
      expect(again.isNew).toBe(false);
      expect(again.item.id).toBe(first.id);
      expect(again.item.onList).toBe(true);
      replica.refresh();
      expect(replica.groceryItems()).toHaveLength(1);
    });

    // The read the arch doc names as the mistake to avoid.
    it('resolves a singular onto the plural row already there', () => {
      const peppers = replica.addGroceryItem('Serrano peppers').item;
      const again = replica.addGroceryItem('serrano pepper');

      expect(again.isNew).toBe(false);
      expect(again.item.id).toBe(peppers.id);
      // ...and does not rename it, since nameKey is derived from name.
      expect(again.item.name).toBe('Serrano peppers');
    });

    // The membership is left exactly as it was, which is what stops a re-add
    // shuffling the walk order. The row's own `checked` mirror is cleared, and
    // that asymmetry is the app's existing behaviour rather than this tool's:
    // see the note in planGroceryAdd.
    it('does not disturb the membership of something already on the list', () => {
      const milk = replica.addGroceryItem('milk').item;
      replica.setGroceryChecked(milk.id, true);
      replica.refresh();

      const again = replica.addGroceryItem('milk');
      expect(again.wasOnList).toBe(true);
      expect(again.isNew).toBe(false);
      expect(again.item.id).toBe(milk.id);
    });

    it('checks off and un-checks', () => {
      const milk = replica.addGroceryItem('milk').item;
      expect(replica.setGroceryChecked(milk.id, true).checked).toBe(true);
      expect(replica.setGroceryChecked(milk.id, false).checked).toBe(false);
    });

    it('refuses to check off something that is not in the trolley', () => {
      const milk = replica.addGroceryItem('milk').item;
      replica.removeFromGroceryList(milk.id);
      replica.refresh();
      expect(() => replica.setGroceryChecked(milk.id, true)).toThrow(/not on the home list/);
    });

    // Every grocery tool is about the list at home. A row only on a trip's
    // list is in *a* trolley (GroceryItem.onList), which is not this one.
    it('exposes the list entries, so a read can tell the home list from a trip\'s', () => {
      const sunscreen = replica.addGroceryItem('sunscreen', { listId: 'airbnb' }).item;
      replica.refresh();
      expect(replica.groceryListEntries().map(e => [e.itemId, e.listId])).toEqual([[sunscreen.id, 'airbnb']]);
    });

    it('refuses to take a row off the home list when only a trip\'s list holds it', () => {
      const sunscreen = replica.addGroceryItem('sunscreen', { listId: 'airbnb' }).item;
      replica.refresh();
      expect(() => replica.removeFromGroceryList(sunscreen.id)).toThrow(/not on the home list/);
      expect(replica.groceryListEntries()).toHaveLength(1);
    });

    it('does not call an add to the home list a no-op when only a trip\'s list held the row', () => {
      replica.addGroceryItem('sunscreen', { listId: 'airbnb' });
      replica.refresh();
      const again = replica.addGroceryItem('sunscreen');
      expect(again.isNew).toBe(false);
      expect(again.wasOnList).toBe(false);
      expect(replica.groceryListEntries().map(e => e.listId).sort()).toEqual(['airbnb', null].sort());
    });

    // Parks, never deletes. Dropping a row wrongly destroys a price history or
    // a substitute with no undo.
    it('parks a row rather than deleting it', () => {
      const milk = replica.addGroceryItem('milk').item;
      const parked = replica.removeFromGroceryList(milk.id);

      expect(parked.onList).toBe(false);
      replica.refresh();
      expect(replica.groceryItems().map(i => i.id)).toEqual([milk.id]);
    });

    it('drops the recipe credit along with the recipe\'s quantity', () => {
      // What the app's own removeFromList does. Kept, a hand-typed re-add
      // weeks later still read 'For "Chili"'.
      const beans = replica.addGroceryItem('beans').item;
      mockRaw.runSync(
        'UPDATE grocery_items SET source_recipe_id = ?, source_recipe_title = ? WHERE id = ?',
        ['r-chili', 'Chili', beans.id]
      );
      replica.refresh();

      const parked = replica.removeFromGroceryList(beans.id);

      expect(parked.sourceRecipeId).toBeNull();
      expect(parked.sourceRecipeTitle).toBeNull();
    });

    it('refuses an unknown id rather than doing nothing', () => {
      expect(() => replica.addGroceryItem('   ')).toThrow(/needs a name/);
      expect(() => replica.setGroceryChecked('nope', true)).toThrow(/No grocery item/);
      expect(() => replica.removeFromGroceryList('nope')).toThrow(/No grocery item/);
    });
  });

  it('clears cached reads on refresh, so a sync landing mid-session is seen', () => {
    insert({ id: 'first', title: 'First' });
    replica.refresh();
    expect(replica.tasks()).toHaveLength(1);

    insert({ id: 'second', title: 'Second' });
    // Without a refresh the cache still answers, which is the point of it.
    expect(replica.tasks()).toHaveLength(1);
    replica.refresh();
    expect(replica.tasks()).toHaveLength(2);
  });

  // ==== completing ====

  it('completes a plain task and spawns nothing', () => {
    const task = replica.createTask({ title: 'Hang the picture' });
    const result = replica.completeTask(task.id, {});

    expect(result.completed.completed).toBe(true);
    expect(result.completed.completedAt).toEqual(expect.any(String));
    expect(result.nextTask).toBeNull();
    expect(result.rolledOver).toEqual([]);
  });

  // The reason the whole completion core was lifted out of useTaskStore rather
  // than reimplemented: a recurring task whose successor never appears reads
  // as a daily habit that stopped after one day.
  it('spawns the next occurrence of a recurring task, on the next date', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const task = replica.createTask({
      title: 'Water the plants',
      recurrenceType: 'daily',
      dueDate: today.toISOString(),
    });
    const result = replica.completeTask(task.id, {});

    expect(result.nextTask).not.toBeNull();
    expect(dayOf(result.nextTask!.dueDate)).toBe(dayOf(tomorrow.toISOString()));
    // A fresh row rather than the same one moved: the completed one stays as
    // the record of that day.
    expect(result.nextTask!.id).not.toBe(task.id);
    expect(result.nextTask!.completed).toBe(false);
    // Both rows are in the database, which is what a device will pull.
    replica.refresh();
    expect(replica.tasks()).toHaveLength(2);
  });

  it('reopens a completed task and removes the occurrence it spawned', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const task = replica.createTask({ title: 'Water the plants', recurrenceType: 'daily', dueDate: today.toISOString() });
    const done = replica.completeTask(task.id, {});

    const reopened = replica.reopenTask(task.id);

    expect(reopened.task).toMatchObject({ id: task.id, completed: false, completedAt: null });
    expect(reopened.removed.map(t => t.id)).toEqual([done.nextTask!.id]);
    replica.refresh();
    expect(replica.tasks().map(t => t.id)).toEqual([task.id]);
  });

  it('keeps a successor that was completed since', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const task = replica.createTask({ title: 'Water the plants', recurrenceType: 'daily', dueDate: today.toISOString() });
    const first = replica.completeTask(task.id, {});
    // Due tomorrow, so completing it early is refused; make it due now first.
    mockRaw.runSync('UPDATE tasks SET due_date = ? WHERE id = ?', [today.toISOString(), first.nextTask!.id]);
    replica.refresh();
    replica.completeTask(first.nextTask!.id, {});

    expect(replica.reopenTask(task.id).removed.map(t => t.id)).not.toContain(first.nextTask!.id);
  });

  it('refuses to reopen what is not completed, and what only the phone can undo', () => {
    const open = replica.createTask({ title: 'Open', category: 'Home' });
    expect(() => replica.reopenTask(open.id)).toThrow(/not completed/);
    expect(() => replica.reopenTask('nope')).toThrow(/No task/);

    const logged = replica.createTask({ title: 'Logged', category: 'Home' });
    replica.completeTask(logged.id, {});
    mockRaw.runSync("UPDATE tasks SET completion_calendar_event_id = 'ev1' WHERE id = ?", [logged.id]);
    replica.refresh();
    expect(() => replica.reopenTask(logged.id)).toThrow(/calendar event/);
  });

  // getNextDueDate's { catchUp: true }, which completeTask passes because it is
  // placing a real row. Without it, finishing a task months late spawns a
  // successor dated months ago: overdue on arrival, and one completion per
  // missed occurrence to work back to the present.
  it('walks a long-overdue recurrence up to the present rather than into the past', () => {
    const task = replica.createTask({
      title: 'Water the plants',
      recurrenceType: 'daily',
      dueDate: '2026-03-01T12:00:00.000Z',
    });
    const result = replica.completeTask(task.id, {});

    // Today or later, not "the day after the one it was last due". It lands on
    // today rather than in the future because catchUp walks the rule's own
    // grid up to the present rather than past it.
    const next = new Date(result.nextTask!.dueDate!);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    expect(next.getTime()).toBeGreaterThanOrEqual(todayStart.getTime());
  });

  it('advances a chain one step rather than finishing the task', () => {
    const task = replica.createTask({
      title: 'Laundry',
      chainEnabled: true,
      chainItems: [
        { id: 'c1', title: 'Wash', estimatedMinutes: null },
        { id: 'c2', title: 'Dry', estimatedMinutes: null },
      ],
    });
    const result = replica.completeTask(task.id, {});

    expect(result.nextTask).not.toBeNull();
    expect(result.nextTask!.chainIndex).toBe(1);
  });

  it('spends one unit of a supply, and only because a person did the thing', () => {
    const task = replica.createTask({
      title: 'Replace the filter',
      recurrenceType: 'monthly',
      dueDate: '2026-03-01T12:00:00.000Z',
      supplyCount: 3,
    });
    const result = replica.completeTask(task.id, {});
    expect(result.nextTask!.supplyCount).toBe(2);
  });

  it('writes and reads back a rotation, a countdown, a health target and a supply through the tools', () => {
    const rot = createTaskTool(replica, { title: 'Podcasts', category: 'Home', rotation: { members: ['Spanish', 'French', 'Hindi'] } });
    expect(rot.rotation!.members.map(m => m.title)).toEqual(['Spanish', 'French', 'Hindi']);
    expect(rot.target).toBeUndefined();
    expect(rot.repeat).toEqual({ every: 'week' });
    expect(replica.taskById(rot.task.id)).toMatchObject({ rotationEnabled: true, targetCount: 3, quotaPeriod: 'week', polarity: 'positive' });

    // Logging a pick moves this week's cover, and a re-send keeps the member's id.
    const before = replica.taskById(rot.task.id)!;
    replica.updateTask(rot.task.id, { rotationLog: [{ itemId: before.rotationItems[0].id, at: new Date().toISOString() }], rotationPeriodStart: new Date().toISOString() });
    const edited = updateTaskTool(replica, rot.task.id, { rotation: { members: ['Spanish', 'Hindi', 'German'] } });
    expect(edited.rotation!.members.map(m => m.title)).toEqual(['Spanish', 'Hindi', 'German']);
    expect(replica.taskById(rot.task.id)!.rotationItems[0].id).toBe(before.rotationItems[0].id);
    expect(replica.taskById(rot.task.id)!.targetCount).toBe(3);

    const timed = createTaskTool(replica, { title: 'Stretch', category: 'Home', timed: { minutes: 15 } });
    expect(timed.timed).toEqual({ minutes: 15 });
    expect(replica.taskById(timed.task.id)!.estimatedMinutes).toBe(15);

    const health = createTaskTool(replica, { title: 'Walk', category: 'Home', healthTarget: { metric: 'steps' } });
    expect(health.healthTarget).toEqual({ metric: 'steps', target: 8000 });

    const supply = createTaskTool(replica, { title: 'Filter', category: 'Home', repeat: { every: 'month' }, dueDate: '2026-03-01T12:00:00.000Z', supply: { count: 3, unit: 'filters' } });
    expect(supply.supply).toMatchObject({ count: 3, unit: 'filters', reorderAt: 1 });

    expect(() => createTaskTool(replica, { title: 'Both', category: 'Home', timed: { minutes: 10 }, healthTarget: { metric: 'steps' } })).toThrow(/timed and healthTarget/);
    expect(getTaskTool(replica, supply.task.id)!.gatesApps).toBeUndefined();
  });

  it('records a dose for a task that names a medication', () => {
    const task = replica.createTask({ title: 'Ibuprofen', medicationName: 'Ibuprofen' });
    expect(replica.completeTask(task.id, {}).loggedDose).toBe(true);

    const task2 = replica.createTask({ title: 'Hang the picture' });
    expect(replica.completeTask(task2.id, {}).loggedDose).toBe(false);
  });

  it('earns coins for a completion while rewards are on, and nothing while off', () => {
    const coins = () => mockRaw.getAllSync<{ task_id: string; amount: number }>(
      "SELECT task_id, amount FROM coin_entries WHERE kind = 'earn'"
    );
    const off = replica.createTask({ title: 'Before switching on' });
    replica.completeTask(off.id, {});
    expect(coins()).toEqual([]);

    mockRaw.runSync("INSERT OR REPLACE INTO settings (key, value) VALUES ('rewardsEnabled', 'true')");
    replica.refresh();
    const task = replica.createTask({ title: 'Write the report', estimatedMinutes: 90 });
    replica.completeTask(task.id, {});
    expect(coins()).toEqual([{ task_id: task.id, amount: 5 }]);
  });

  it('refuses a task that is already completed', () => {
    const task = replica.createTask({ title: 'Once' });
    replica.completeTask(task.id, {});
    replica.refresh();
    expect(() => replica.completeTask(task.id, {})).toThrow(/already completed/);
  });

  // There is no tap that finishes "don't smoke" — see Task.polarity. The store
  // returns silently here; over MCP that would read as success.
  it('refuses a negative habit, and says what to do instead', () => {
    const task = replica.createTask({ title: 'No biting nails', polarity: 'negative' });
    expect(() => replica.completeTask(task.id, {})).toThrow(/slip/);
  });

  it('refuses a recurring task that is not due yet', () => {
    const task = replica.createTask({
      title: 'Next week',
      recurrenceType: 'weekly',
      dueDate: '2099-01-01T12:00:00.000Z',
    });
    expect(() => replica.completeTask(task.id, {})).toThrow(/not due yet/);
  });

  it('refuses an unknown id rather than doing nothing', () => {
    expect(() => replica.completeTask('nope', {})).toThrow(/No task with id/);
  });

  // ==== the question a completion asks ====

  it('refuses to complete a task that asks a question with no answer', () => {
    const task = replica.createTask({ title: 'Pick a colour', deliverableKind: 'text' });
    // No deliverableValue key at all: nobody asked.
    expect(() => replica.completeTask(task.id)).toThrow(/asks a question/);
    expect(() => replica.completeTask(task.id, {})).toThrow(/asks a question/);
  });

  it('records an answer that was given', () => {
    const task = replica.createTask({ title: 'Pick a colour', deliverableKind: 'text' });
    const result = replica.completeTask(task.id, { deliverableValue: 'Green' });
    expect(result.completed.deliverableValue).toBe('Green');
  });

  // A fixed set of answers takes one of them, in the option's own spelling,
  // or the project's tally counts it as no answer.
  it('takes one of a Pick one question\'s options, and refuses anything else', () => {
    const task = replica.createTask({
      title: 'Dana', deliverableKind: 'choice', deliverableOptions: ['Yes', 'No', 'Maybe'],
    });
    expect(() => replica.completeTask(task.id, { deliverableValue: 'Coming' })).toThrow(/Yes, No, Maybe/);
    const result = replica.completeTask(task.id, { deliverableValue: 'maybe' });
    expect(result.completed.deliverableValue).toBe('Maybe');
  });

  it('keeps an option that has a comma in it whole', () => {
    const task = replica.createTask({
      title: 'Dana', deliverableKind: 'choice', deliverableOptions: ['Yes, definitely', 'No'],
    });
    expect(replica.deliverableOptions(task)).toEqual(['Yes, definitely', 'No']);
  });

  // The app may never *require* an answer, so declining has to get through.
  // What is refused above is a caller that never offered the choice.
  it('accepts an explicit decline', () => {
    const task = replica.createTask({ title: 'Pick a colour', deliverableKind: 'text' });
    const result = replica.completeTask(task.id, { deliverableValue: null });
    expect(result.completed.completed).toBe(true);
    expect(result.completed.deliverableValue).toBeNull();
  });

  it('checks whether a task can be completed at all before asking for an answer', () => {
    // Both wrong at once. The refusal that matters is the one the caller can
    // do nothing about, not the one it could fix by asking.
    const task = replica.createTask({
      title: 'Next week',
      recurrenceType: 'weekly',
      dueDate: '2099-01-01T12:00:00.000Z',
      deliverableKind: 'text',
    });
    expect(() => replica.completeTask(task.id)).toThrow(/not due yet/);
  });

  // ==== rescheduling ====

  it('moves a plain task by writing its date', () => {
    const task = replica.createTask({ title: 'Call back', dueDate: '2026-03-01T12:00:00.000Z' });
    const moved = replica.deferTask(task.id, new Date('2026-03-05T12:00:00.000Z'));
    expect(moved.dueDate?.slice(0, 10)).toBe('2026-03-05');
    expect(moved.deferUntil).toBeNull();
  });

  // The asymmetry scheduleMoveUpdates exists for (#1953). Pushing a recurring
  // task out must not rebase every future occurrence onto the new day.
  it('pushes a recurring task out with a defer, leaving its schedule anchored', () => {
    const task = replica.createTask({
      title: 'Water the plants',
      recurrenceType: 'daily',
      dueDate: '2026-03-01T12:00:00.000Z',
    });
    const moved = replica.deferTask(task.id, new Date('2026-03-04T12:00:00.000Z'));

    expect(moved.deferUntil?.slice(0, 10)).toBe('2026-03-04');
    // The grid the rest of its future is measured from has not moved.
    expect(moved.dueDate?.slice(0, 10)).toBe('2026-03-01');
  });

  it('pulls a recurring task forward by moving its date, keeping the grid anchor', () => {
    const task = replica.createTask({
      title: 'Water the plants',
      recurrenceType: 'daily',
      dueDate: '2026-03-10T12:00:00.000Z',
    });
    const moved = replica.deferTask(task.id, new Date('2026-03-08T12:00:00.000Z'));

    // A defer cannot pull a task in front of its own date, so the date moves.
    expect(moved.dueDate?.slice(0, 10)).toBe('2026-03-08');
    expect(moved.deferUntil).toBeNull();
    // ...and the schedule keeps its own anchor to step from.
    expect(moved.recurrenceAnchorDate?.slice(0, 10)).toBe('2026-03-10');
  });

  it('clears a date rather than deleting anything', () => {
    const task = replica.createTask({ title: 'Someday', dueDate: '2026-03-01T12:00:00.000Z' });
    const moved = replica.deferTask(task.id, null);
    expect(moved.dueDate).toBeNull();
    replica.refresh();
    expect(replica.taskById(task.id)).not.toBeNull();
  });

  // ==== archiving ====

  it('archives a task off every list and restores it, as the app does', () => {
    const task = replica.createTask({ title: 'Book the wrong venue', pinned: true });
    const archived = replica.setTaskArchived(task.id, true);
    expect(archived).toMatchObject({ archived: true, pinned: false });
    expect(archived.archivedAt).toEqual(expect.any(String));
    replica.refresh();
    expect(replica.isVisible(replica.taskById(task.id)!)).toBe(false);

    const restored = replica.setTaskArchived(task.id, false);
    expect(restored).toMatchObject({ archived: false, archivedAt: null, streakCount: 0 });
  });

  it('refuses to archive a checklist item on its own', () => {
    const parent = replica.createTask({ title: 'Invitations' });
    const sub = replica.createTask({ title: 'Buy stamps', parentId: parent.id });
    expect(() => replica.setTaskArchived(sub.id, true)).toThrow(/checklist item/);
  });

  it('lists a project\'s decisions, newest first, leaving archived ones out', () => {
    const { project } = replica.createProjectPlan({ defaultTaskCategory: 'Home',
      title: 'Wedding',
      steps: [
        { fields: { title: 'Ceremony format?', deliverableKind: 'choice', deliverableOptions: ['City Hall', 'Officiant'] } },
        { fields: { title: 'Guest count?', deliverableKind: 'number' } },
        { fields: { title: 'Dropped question', deliverableKind: 'text' } },
      ],
    });
    const [format, count, dropped] = replica.tasks().filter(t => t.projectId === project.id).sort((a, b) => a.sortOrder - b.sortOrder);
    replica.completeTask(format.id, { deliverableValue: 'City Hall', completedAt: '2026-09-01T10:00:00.000Z' });
    replica.completeTask(count.id, { deliverableValue: '14', completedAt: '2026-09-03T10:00:00.000Z' });
    replica.completeTask(dropped.id, { deliverableValue: 'x', completedAt: '2026-09-04T10:00:00.000Z' });
    replica.refresh();
    replica.setTaskArchived(dropped.id, true);

    const decisions = replica.projectDecisions(project.id);
    expect(decisions.map(t => [t.title, t.deliverableValue])).toEqual([['Guest count?', '14'], ['Ceremony format?', 'City Hall']]);
  });

  it('adds a batch of steps to an existing project, waiting on the batch and on what is already there', () => {
    const { project, tasks: [license] } = replica.createProjectPlan({ defaultTaskCategory: 'Home', title: 'Wedding', steps: [{ fields: { title: 'Get the license' } }] });
    const added = replica.addProjectSteps(project.id, [
      { fields: { title: 'Book City Hall', waitsOn: [license.id] } },
      { fields: { title: 'Tell the guests' }, waitsOn: [0], subtasks: ['Text family'] },
    ]);
    replica.refresh();
    const [hall, guests, text] = added;
    expect(hall.projectId).toBe(project.id);
    expect(replica.isBlocked(replica.taskById(hall.id)!)).toBe(true);
    expect(guests.blockedById).toBe(hall.id);
    expect(text).toMatchObject({ title: 'Text family', parentId: guests.id });
  });

  it('adds nothing when one step in the batch is bad', () => {
    const { project } = replica.createProjectPlan({ defaultTaskCategory: 'Home', title: 'Wedding', steps: [] });
    const before = replica.tasks().length;
    expect(() => replica.addProjectSteps(project.id, [
      { fields: { title: 'Fine' } },
      { fields: { title: 'Bad' }, waitsOn: [5] },
    ])).toThrow(/steps\[1\]\.waitsOn: 5 is not an earlier step/);
    replica.refresh();
    expect(replica.tasks().length).toBe(before);
    expect(() => replica.addProjectSteps('nope', [{ fields: { title: 'x' } }])).toThrow(/No project/);
  });

  it('plans a branch on an earlier step\'s answer, and rules the other branch out once answered', () => {
    const { project, tasks: created } = replica.createProjectPlan({ defaultTaskCategory: 'Home',
      title: 'Wedding',
      steps: [
        { fields: { title: 'Ceremony format?', deliverableKind: 'choice', deliverableOptions: ['City Hall', 'Officiant'] } },
        { fields: { title: 'Book City Hall' }, onlyIfAnswerTo: { step: 0, answers: ['city hall'] } },
        { fields: { title: 'Hire officiant' }, onlyIfAnswerTo: { step: 0, answers: ['Officiant'] } },
        { fields: { title: 'Pay the fee' }, waitsOn: [1] },
      ],
    });
    const [question, hall, officiant, fee] = created;
    // Spelled as the question offers it, whatever case it was given in.
    expect(hall.answerGate).toEqual({ taskId: question.id, answers: ['City Hall'] });
    replica.refresh();
    expect(replica.isBlocked(replica.taskById(hall.id)!)).toBe(true);

    replica.completeTask(question.id, { deliverableValue: 'Officiant' });
    replica.refresh();
    expect(replica.isNotNeeded(replica.taskById(hall.id)!)).toBe(true);
    expect(replica.isNotNeeded(replica.taskById(fee.id)!)).toBe(true);
    expect(replica.isBlocked(replica.taskById(officiant.id)!)).toBe(false);
    // Out of the count: the question is done, the officiant is the one left.
    expect(replica.projectProgress(project.id)).toEqual({ done: 1, total: 2 });
  });

  it('refuses a branch on an answer the question does not offer, or on a question with no listed answers', () => {
    const q = replica.createTask({ title: 'Format?', deliverableKind: 'choice', deliverableOptions: ['City Hall', 'Officiant'] });
    const free = replica.createTask({ title: 'Notes?', deliverableKind: 'text' });
    expect(() => replica.taskPatch({ category: 'Home', onlyIfAnswer: { taskId: q.id, answers: ['Cityhall'] } }, null, false)).toThrow(/isn't one of its answers \(City Hall, Officiant\)/);
    expect(() => replica.taskPatch({ category: 'Home', onlyIfAnswer: { taskId: free.id, answers: ['x'] } }, null, false)).toThrow(/can't decide this task/);
    expect(() => replica.taskPatch({ category: 'Home', onlyIfAnswer: { taskId: q.id, answers: [] } }, null, false)).toThrow(/at least one answer/);
    expect(replica.taskPatch({ category: 'Home', onlyIfAnswer: { taskId: q.id, answers: ['officiant'] } }, null, false).answerGate)
      .toEqual({ taskId: q.id, answers: ['Officiant'] });
    expect(replica.taskPatch({ category: 'Home', onlyIfAnswer: null }, null, false).answerGate).toBeNull();
  });

  // ==== event date ====

  it('dates steps from the event date, before and after it, at midday on the local day', () => {
    const { project, tasks: [license, thanks] } = replica.createProjectPlan({ defaultTaskCategory: 'Home',
      title: 'Wedding',
      eventDate: '2027-06-14',
      steps: [
        { fields: { title: 'Get the license', dueDaysFromEvent: -60 } },
        { fields: { title: 'Thank-you notes', dueDaysFromEvent: 7, deadlineDaysFromEvent: 30 } },
      ],
    });
    const local = (iso: string | null) => { const d = new Date(iso!); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]; };
    expect(local(project.eventDate!)).toEqual([2027, 6, 14, 12]);
    expect(local(license.dueDate)).toEqual([2027, 4, 15, 12]);
    expect(local(thanks.dueDate)).toEqual([2027, 6, 21, 12]);
    expect(local(thanks.deadline)).toEqual([2027, 7, 14, 12]);
  });

  it('dates a step at the end of a month counted from the event', () => {
    const { tasks: [records, sameMonth] } = replica.createProjectPlan({ defaultTaskCategory: 'Home',
      title: 'Wedding',
      eventDate: '2027-01-30',
      steps: [
        { fields: { title: 'Update records', dueEndOfMonthAfterEvent: 1 } },
        { fields: { title: 'Return the suit', deadlineEndOfMonthAfterEvent: 0 } },
      ],
    });
    const local = (iso: string | null) => { const d = new Date(iso!); return [d.getMonth() + 1, d.getDate(), d.getHours()]; };
    // Jan 30 plus a month clamps to Feb 28, and the end of February is the answer.
    expect(local(records.dueDate)).toEqual([2, 28, 12]);
    expect(local(sameMonth.deadline)).toEqual([1, 31, 12]);
  });

  it('refuses event-relative days with no event date, or alongside the date they replace', () => {
    expect(() => replica.taskPatch({ category: 'Home', dueDaysFromEvent: -3 }, null, false)).toThrow(/has none/);
    const { project } = replica.createProjectPlan({ defaultTaskCategory: 'Home', title: 'Move', eventDate: '2027-03-01', steps: [] });
    expect(() => replica.taskPatch({ category: 'Home', projectId: project.id, dueDaysFromEvent: -3, dueDate: '2027-01-01' }, null, false)).toThrow(/not more/);
    expect(replica.taskPatch({ category: 'Home', projectId: project.id, dueDaysFromEvent: -3 }, null, false).dueDate).toEqual(expect.any(String));
  });

  it('moves a project\'s dated tasks by the days its event moved, leaving pinned and undated ones', () => {
    const { project, tasks: [license, pinned, undated] } = replica.createProjectPlan({ defaultTaskCategory: 'Home',
      title: 'Wedding',
      eventDate: '2027-06-14',
      steps: [
        { fields: { title: 'Get the license', dueDaysFromEvent: -60 } },
        { fields: { title: 'Final fitting', dueDaysFromEvent: -7, pinned: true } },
        { fields: { title: 'Someday: pick a song' } },
      ],
    });
    replica.updateProject(project.id, { eventDate: '2027-07-14' });
    const move = replica.moveProjectTasks(project.id, new Date(project.eventDate!), new Date(replica.projects().find(p => p.id === project.id)!.eventDate!));
    expect(move.deltaDays).toBe(30);
    expect(move.moved.map(t => t.id)).toEqual([license.id]);
    expect(new Date(move.moved[0].dueDate!).getDate()).toBe(15); // Apr 15 -> May 15
    expect(move.skipped.map(s => s.task.id)).toEqual([pinned.id]);
    replica.refresh();
    expect(replica.taskById(undated.id)!.dueDate).toBeNull();
    // Not counted as the person putting it off.
    expect(replica.taskById(license.id)!.postponeCount).toBe(0);
  });

  it('writes an item branch as a gate on the keyed item, spelled as the question offers it', () => {
    const built = replica.createTemplate({
      name: 'Wedding',
      items: [
        { title: 'Ceremony format?', key: 'format', deliverableKind: 'choice', deliverableOptions: ['City Hall', 'Officiant'] },
        { title: 'Book City Hall', onlyIfAnswer: { item: 'format', answers: ['city hall'] } },
      ],
    });
    const [format, hall] = built.items;
    expect(hall.answerGate).toEqual({ itemId: format.id, answers: ['City Hall'] });
  });

  // ==== categories ====

  it('files every new task under a category: named, the project default, or a title rule', () => {
    expect(() => replica.taskPatch({ title: 'Call the florist' }, null, false)).toThrow(/needs a category\. Pick the one it belongs under from yours \(.*Home.*\)/);
    // Spelled as the person spelled it, whatever case it was named in.
    expect(replica.taskPatch({ title: 'Call the florist', category: 'home' }, null, false).category).toBe('Home');
    // A checklist item has no section to land in, so it needs none.
    expect(() => replica.taskPatch({ title: 'Roses' }, null, true)).not.toThrow();
    const { project } = replica.createProjectPlan({ title: 'Wedding', defaultTaskCategory: 'Home', steps: [] });
    expect(() => replica.taskPatch({ title: 'Call the florist', projectId: project.id }, null, false)).not.toThrow();
    // Editing an existing task doesn't demand one.
    const t = replica.createTask({ title: 'Old one' });
    expect(() => replica.taskPatch({ notes: 'x' }, t, false)).not.toThrow();
  });

  it('refuses a category that isn\'t one of the user\'s, unless it is flagged new, and then creates it', () => {
    expect(() => replica.taskPatch({ title: 'Book the hall', category: 'Weddnig' }, null, false))
      .toThrow(/"Weddnig" isn't one of your categories \(.*\)\. Use one of those, or pass newCategory: true/);
    const patch = replica.taskPatch({ title: 'Book the hall', category: 'Wedding', newCategory: true }, null, false);
    const task = replica.createTask(patch);
    replica.refresh();
    expect(task.category).toBe('Wedding');
    expect(replica.categories().map(c => c.name)).toContain('Wedding');
    expect(() => replica.createProjectPlan({ title: 'X', defaultTaskCategory: 'Nope', steps: [] })).toThrow(/defaultTaskCategory: "Nope"/);
  });

  it('records why and revisit-if with an answer, and corrects them afterwards', () => {
    const q = replica.createTask({ title: 'Ceremony format?', deliverableKind: 'choice', deliverableOptions: ['City Hall', 'Officiant'] });
    replica.completeTask(q.id, { deliverableValue: 'City Hall', deliverableReasoning: { why: 'Under 20 guests', revisitIf: null } });
    replica.refresh();
    expect(replica.taskById(q.id)).toMatchObject({ deliverableWhy: 'Under 20 guests', deliverableRevisitIf: null });

    const edited = replica.updateAnswer(q.id, { revisitIf: 'No slots before March' });
    expect(edited).toMatchObject({ deliverableValue: 'City Hall', deliverableWhy: 'Under 20 guests', deliverableRevisitIf: 'No slots before March' });
    expect(replica.updateAnswer(q.id, { answer: 'officiant' }).deliverableValue).toBe('Officiant');
    expect(() => replica.updateAnswer(q.id, { answer: 'Beach' })).toThrow(/one of: City Hall, Officiant/);
    expect(replica.updateAnswer(q.id, { answer: null })).toMatchObject({ deliverableWhy: null, deliverableRevisitIf: null });
    const plain = replica.createTask({ title: 'No question' });
    expect(() => replica.updateAnswer(plain.id, { why: 'x' })).toThrow(/doesn't ask a question/);
  });

  it('refuses to reschedule a completed task', () => {
    const task = replica.createTask({ title: 'Done' });
    replica.completeTask(task.id, {});
    replica.refresh();
    expect(() => replica.deferTask(task.id, new Date())).toThrow(/already completed/);
  });
  describe('editing a task', () => {
    it('re-derives what the app re-derives when the schedule changes', () => {
      const task = replica.createTask({ title: 'Rent', recurrenceType: 'monthly', dueDate: '2026-01-31T12:00:00.000Z' });
      const patch = replica.taskPatch({ category: 'Home', repeat: { every: 'month', monthDay: 15 } }, task, false);
      const { task: edited } = replica.updateTask(task.id, patch);
      expect(edited.recurrenceMonthDay).toBe(15);
      // The anchor is cleared by the rule mergeTaskUpdate carries over from the store.
      expect(edited.recurrenceAnchorDate).toBeNull();
      replica.refresh();
      expect(replica.taskById(task.id)!.recurrenceMonthDay).toBe(15);
    });

    it('writes blockers the app can read, and refuses a cycle', () => {
      const a = replica.createTask({ title: 'Buy paint' });
      const b = replica.createTask({ title: 'Paint the hall' });
      replica.updateTask(b.id, replica.taskPatch({ category: 'Home', waitsOn: [a.id] }, b, false));
      replica.refresh();
      expect(replica.isBlocked(replica.taskById(b.id)!)).toBe(true);
      expect(() => replica.taskPatch({ category: 'Home', waitsOn: [b.id] }, replica.taskById(a.id), false)).toThrow(/can't be waited on/);
      expect(() => replica.taskPatch({ category: 'Home', waitsOn: ['nope'] }, null, false)).toThrow(/no task with id nope/);
    });

    it('refuses a completed task', () => {
      const t = replica.createTask({ title: 'Done' });
      replica.completeTask(t.id, {});
      replica.refresh();
      expect(() => replica.updateTask(t.id, { notes: 'x' })).toThrow(/completed/);
    });

    it('counts a push in defer_task toward the postpone count, as a push on the phone does', () => {
      const t = replica.createTask({ title: 'Call the bank', dueDate: new Date().toISOString() });
      const later = new Date(Date.now() + 3 * 86_400_000);
      expect(replica.deferTask(t.id, later).postponeCount).toBe(1);
    });
  });

  describe('projects', () => {
    beforeEach(() => {
      mockRaw.runSync('DELETE FROM projects');
      replica.refresh();
    });

    it('creates a project and its plan, with blockers between steps and a checklist', () => {
      const { project, tasks: made } = replica.createProjectPlan({
        title: 'Paint the hall',
        notes: 'Before the party',
        defaultTaskCategory: 'Home',
        steps: [
          { fields: { title: 'Pick a colour' } },
          { fields: { title: 'Buy paint', estimatedMinutes: 60 }, subtasks: ['Rollers', 'Tape'], waitsOn: [0] },
          { fields: { title: 'Paint', category: 'Weekend', newCategory: true }, waitsOn: [0, 1] },
        ],
      });
      expect(project.notes).toBe('Before the party');
      const [pick, buy, paint] = made.filter(t => !t.parentId);
      expect(made.filter(t => t.parentId === buy.id).map(t => t.title)).toEqual(['Rollers', 'Tape']);
      expect(buy.blockedById).toBe(pick.id);
      expect([paint.blockedById, ...(paint.blockedByIds ?? [])]).toEqual([pick.id, buy.id]);
      // The project's own default category reaches its steps: the store is
      // loaded now, where it used to be empty and the setting was ignored.
      expect(pick.category).toBe('Home');
      expect(paint.category).toBe('Weekend');
      expect(made.every(t => t.parentId || t.projectId === project.id)).toBe(true);
    });

    it('writes nothing when any step is wrong, and lists every problem', () => {
      expect(() => replica.createProjectPlan({ defaultTaskCategory: 'Home',
        title: 'Broken',
        steps: [
          { fields: { title: 'A' }, waitsOn: [0] },
          { fields: { title: 'B', target: { count: 1, per: 'day' } } },
        ],
      })).toThrow(/steps\[0\]\.waitsOn.*steps\[1\]/s);
      replica.refresh();
      expect(replica.projects().some(p => p.title === 'Broken')).toBe(false);
    });

    it('rolls the project back if a write fails partway', () => {
      const db = require('../../../src/db/database');
      const spy = jest.spyOn(db, 'dbInsertTask').mockImplementationOnce(() => { throw new Error('disk full'); });
      expect(() => replica.createProjectPlan({ defaultTaskCategory: 'Home', title: 'Half', steps: [{ fields: { title: 'A' } }] })).toThrow('disk full');
      spy.mockRestore();
      replica.refresh();
      expect(replica.projects().some(p => p.title === 'Half')).toBe(false);
    });

    it('completes and archives a project without touching its tasks', () => {
      const { project, tasks: made } = replica.createProjectPlan({ defaultTaskCategory: 'Home', title: 'Garden', steps: [{ fields: { title: 'Weed' } }] });
      const done = replica.updateProject(project.id, { title: 'Garden 2026', completed: true, archived: true });
      expect(done).toMatchObject({ title: 'Garden 2026', completed: true, archived: true });
      expect(replica.taskById(made[0].id)!.completed).toBe(false);
      expect(() => replica.updateProject('nope', { title: 'x' })).toThrow(/No project/);
    });
  });

  describe('meals and people', () => {
    beforeEach(() => {
      mockRaw.runSync('DELETE FROM meal_plan_entries');
      mockRaw.runSync('DELETE FROM recipes');
      mockRaw.runSync('DELETE FROM people');
    });

    it('plans a recipe, titled with its name, at the end of its slot', () => {
      mockRaw.runSync("INSERT INTO recipes (id, name, name_key, created_at) VALUES ('r1', 'Chili', 'chili', '2026-01-01T00:00:00.000Z')");
      const first = replica.planMeal({ date: '2026-10-05', slot: 'dinner', recipeId: 'r1' });
      const second = replica.planMeal({ date: '2026-10-05', slot: 'dinner', title: 'Salad' });
      expect(first).toMatchObject({ title: 'Chili', recipeId: 'r1', recipeScale: 1 });
      expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
      expect(replica.mealPlan('2026-10-05', '2026-10-05')).toHaveLength(2);
      expect(() => replica.planMeal({ date: '2026-10-05', slot: 'dinner', recipeId: 'gone' })).toThrow(/No recipe/);
    });

    it('adds to a person\'s history as a completed task naming them, on that day', () => {
      mockRaw.runSync("INSERT INTO people (id, name, created_at) VALUES ('p1', 'Sam', '2026-01-01T00:00:00.000Z')");
      replica.refresh();
      const at = new Date('2026-09-20T18:00:00.000Z');
      const task = replica.addPersonHistory(['p1'], 'Coffee', at);
      expect(task).toMatchObject({ completed: true, completedAt: at.toISOString(), personIds: ['p1'] });
      expect(replica.personHistory('p1')).toEqual([{ taskId: task.id, title: 'Coffee', at: at.toISOString() }]);
      expect(() => replica.addPersonHistory(['p1'], 'Later', new Date(Date.now() + 86_400_000))).toThrow(/future/);
      expect(() => replica.addPersonHistory(['nobody'], 'X', at)).toThrow(/No person/);
    });
  });
});

describe('the expo-sqlite shim', () => {
  it('reports `changes`, which the purge paths read', () => {
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)');
    db.runSync('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 1]);
    db.runSync('INSERT INTO t (id, n) VALUES (?, ?)', ['b', 2]);

    expect(db.runSync('DELETE FROM t WHERE n > ?', [0]).changes).toBe(2);
  });

  it('binds undefined as null and booleans as 0/1', () => {
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT PRIMARY KEY, flag INTEGER, note TEXT)');
    // better-sqlite3 throws on both of these unbidden; the device path coerces.
    db.runSync('INSERT INTO t (id, flag, note) VALUES (?, ?, ?)', ['a', true, undefined]);

    expect(db.getFirstSync('SELECT flag, note FROM t WHERE id = ?', ['a'])).toEqual({
      flag: 1,
      note: null,
    });
  });

  it('returns null rather than undefined for a miss', () => {
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT PRIMARY KEY)');
    expect(db.getFirstSync('SELECT * FROM t WHERE id = ?', ['nope'])).toBeNull();
  });

  it('rolls a transaction back as one unit', () => {
    const db = openShimDatabase(':memory:');
    db.execSync('CREATE TABLE t (id TEXT PRIMARY KEY)');

    expect(() =>
      db.withTransactionSync(() => {
        db.runSync('INSERT INTO t (id) VALUES (?)', ['a']);
        throw new Error('nope');
      })
    ).toThrow('nope');

    expect(db.getAllSync('SELECT * FROM t')).toEqual([]);
  });
});
