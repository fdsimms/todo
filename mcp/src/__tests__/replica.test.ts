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

  it('sorts tasks into the app\'s four lenses, which a date comparison could not', () => {
    insert({ id: 'today', title: 'Due now', dueDate: new Date().toISOString() });
    insert({ id: 'later', title: 'Deferred', deferUntil: '2099-01-01T00:00:00.000Z' });
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
      expect(() => replica.setGroceryChecked(milk.id, true)).toThrow(/not on the list/);
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

  it('records a dose for a task that names a medication', () => {
    const task = replica.createTask({ title: 'Ibuprofen', medicationName: 'Ibuprofen' });
    expect(replica.completeTask(task.id, {}).loggedDose).toBe(true);

    const task2 = replica.createTask({ title: 'Hang the picture' });
    expect(replica.completeTask(task2.id, {}).loggedDose).toBe(false);
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

  it('refuses to reschedule a completed task', () => {
    const task = replica.createTask({ title: 'Done' });
    replica.completeTask(task.id, {});
    replica.refresh();
    expect(() => replica.deferTask(task.id, new Date())).toThrow(/already completed/);
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
