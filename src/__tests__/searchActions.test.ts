import type { GroceryItem, GroceryListEntry, MedicationLog } from '../types';
import {
  describeSearchAction,
  glassMl,
  isRunnable,
  searchActions,
  QUICK_ACTION_LIMIT,
  type DescribeContext,
  type DoseAction,
  type GroceryAction,
  type MoodAction,
  type SearchActionSources,
  type WaterAction,
} from '../utils/searchActions';
import type { MedicationSettingsMap } from '../utils/medicationSettings';

let seq = 0;

function dose(name: string, at: string, overrides: Partial<MedicationLog> = {}): MedicationLog {
  seq++;
  return {
    id: `d-${seq}`,
    name,
    takenAt: new Date(at).toISOString(),
    dayKey: at.slice(0, 10),
    amount: 220,
    unit: 'mg',
    asNeeded: true,
    taskId: null,
    note: null,
    ...overrides,
  };
}

function item(id: string, name: string): GroceryItem {
  return { id, name, nameKey: name.toLowerCase() } as GroceryItem;
}

function entry(itemId: string, listId: string | null, checked = false): GroceryListEntry {
  return { itemId, listId, checked } as GroceryListEntry;
}

const logs: MedicationLog[] = [
  dose('Aleve', '2026-10-01T09:00'),
  dose('Aleve', '2026-10-05T09:00', { amount: 440 }),
  dose('Advil', '2026-10-02T09:00', { amount: 200 }),
  dose('Vitamin D', '2026-10-03T09:00', { amount: 1, unit: 'tablet' }),
];

const meds = (from: MedicationLog[] = logs, archived: string[] = []): SearchActionSources =>
  ({ medications: { logs: from, archived } });

const doseNames = (query: string, sources: SearchActionSources = meds()) =>
  searchActions(query, sources).actions.map(a => (a as DoseAction).dose.name);

const groceries = (
  items: GroceryItem[] = [item('milk', 'Milk'), item('eggs', 'Eggs')],
  listEntries: GroceryListEntry[] = [],
  listId: string | null = null,
  listName = 'Groceries',
): SearchActionSources => ({ groceries: { items, listEntries, listId, listName } });

const only = <T,>(query: string, sources: SearchActionSources): T | null => {
  const { actions } = searchActions(query, sources);
  return actions.length === 1 ? (actions[0] as T) : null;
};

describe('searchActions: doses', () => {
  it('offers a dose of a logged medication named after a verb', () => {
    const { actions, onSubmit } = searchActions('take aleve', meds());
    expect(actions).toHaveLength(1);
    expect((actions[0] as DoseAction).dose).toEqual({ name: 'Aleve', amount: 440, unit: 'mg', asNeeded: true });
    expect(onSubmit).toBe(actions[0]);
    expect(doseNames('Took ALEVE.')).toEqual(['Aleve']);
    expect(doseNames('log my aleve')).toEqual(['Aleve']);
  });

  it('repeats the most recent dose when no amount is typed, and records a typed one', () => {
    expect(only<DoseAction>('take aleve 220mg', meds())!.dose).toEqual(
      { name: 'Aleve', amount: 220, unit: 'mg', asNeeded: true });
    expect(only<DoseAction>('take 2 tablets of vitamin d', meds())!.dose).toEqual(
      { name: 'Vitamin D', amount: 2, unit: 'tablet', asNeeded: true });
  });

  it('matches the start of a name or of one of its words', () => {
    expect(doseNames('take a')).toEqual([]); // "a" is a filler word, and nothing is left
    expect(doseNames('take al')).toEqual(['Aleve']);
    expect(doseNames('take ad')).toEqual(['Advil']);
    expect(doseNames('take d')).toEqual(['Vitamin D']);
    expect(doseNames('take leve')).toEqual([]);
  });

  it('puts an exact name ahead of a longer one it starts', () => {
    const more = [...logs, dose('Aleve PM', '2026-10-06T21:00'), dose('Aleve PM', '2026-10-07T21:00')];
    expect(doseNames('take aleve', meds(more))).toEqual(['Aleve', 'Aleve PM']);
    // Two rows, so Return doesn't pick one.
    expect(searchActions('take aleve', meds(more)).onSubmit).toBeNull();
  });

  it('offers a bare name once it is long enough, without letting Return run it', () => {
    expect(doseNames('ale')).toEqual(['Aleve']);
    expect(doseNames('al')).toEqual([]);
    expect(searchActions('aleve', meds()).onSubmit).toBeNull();
  });

  it('offers nothing for a search about something else, or a hidden screen', () => {
    expect(doseNames('buy aleve')).toEqual([]);
    expect(doseNames('take out the trash')).toEqual([]);
    expect(doseNames('take')).toEqual([]);
    expect(doseNames('')).toEqual([]);
    expect(doseNames('take aleve', meds([]))).toEqual([]);
    expect(doseNames('take aleve', { medications: null })).toEqual([]);
  });

  it('leaves out archived medications', () => {
    expect(doseNames('take aleve', meds(logs, ['aleve']))).toEqual([]);
  });

  it('caps the rows it offers', () => {
    const many = ['Med A', 'Med B', 'Med C', 'Med D', 'Med E'].map(n => dose(n, '2026-10-01T09:00'));
    expect(doseNames('take med', meds(many))).toHaveLength(QUICK_ACTION_LIMIT);
    expect(searchActions('take med', meds(many), 1).actions).toHaveLength(1);
    expect(searchActions('take med', meds(many), 0)).toEqual({ actions: [], onSubmit: null });
  });
});

describe('searchActions: water', () => {
  const water: SearchActionSources = { water: { unit: 'ml' } };

  it('offers a glass, one step of the food log stepper', () => {
    expect(only<WaterAction>('water', water)).toMatchObject({ glasses: 1, ml: 250, explicit: false });
    expect(only<WaterAction>('drank water', water)).toMatchObject({ glasses: 1, ml: 250, explicit: true });
    expect(only<WaterAction>('Had a glass of water', water)).toMatchObject({ glasses: 1, explicit: true });
    expect(only<WaterAction>('2 glasses of water', water)).toMatchObject({ glasses: 2, ml: 500 });
    expect(only<WaterAction>('drank 3 cups water', water)).toMatchObject({ glasses: 3, ml: 750 });
  });

  it('counts a glass in ounces for someone who counts in ounces', () => {
    expect(glassMl('flOz')).toBe(237);
    expect(only<WaterAction>('water', { water: { unit: 'flOz' } })!.ml).toBe(237);
  });

  it('lets Return run it only when the words asked for it', () => {
    expect(searchActions('water', water).onSubmit).toBeNull();
    expect(searchActions('drank water', water).onSubmit?.kind).toBe('water');
  });

  it('leaves a search that only mentions water alone', () => {
    expect(searchActions('water the plants', water).actions).toEqual([]);
    expect(searchActions('drank 40 glasses of water', water).actions).toEqual([]);
    expect(searchActions('water', { water: null }).actions).toEqual([]);
  });
});

describe('searchActions: mood', () => {
  const mood: SearchActionSources = { mood: { symptoms: ['Tired', 'Headache'] } };

  it('opens the log from "mood"', () => {
    expect(only<MoodAction>('mood', mood)).toMatchObject({ mood: null, symptom: null, explicit: false });
    expect(only<MoodAction>('log my mood', mood)).toMatchObject({ mood: null, symptom: null, explicit: true });
  });

  it('fills in a symptom you have logged before, spelled your way', () => {
    expect(only<MoodAction>('feeling tired', mood)).toMatchObject({ symptom: 'Tired', mood: null });
    expect(only<MoodAction>("I'm feeling a bit tired", mood)).toMatchObject({ symptom: 'Tired' });
    expect(only<MoodAction>('i feel HEADACHE', mood)).toMatchObject({ symptom: 'Headache' });
  });

  it("fills in a mood only from the scale's own labels", () => {
    expect(only<MoodAction>('feeling low', mood)).toMatchObject({ mood: 2, symptom: null });
    expect(only<MoodAction>('feeling very good', mood)).toMatchObject({ mood: 5 });
    expect(only<MoodAction>('feeling okay', mood)).toMatchObject({ mood: 3 });
    // Not the app's words, so not read as a mood.
    expect(only<MoodAction>('feeling bad', mood)).toMatchObject({ mood: null, symptom: null });
  });

  it('opens the log empty for words it has nothing for', () => {
    expect(only<MoodAction>('feeling like pizza', mood)).toMatchObject({ mood: null, symptom: null });
    expect(searchActions('feeling', mood).onSubmit?.kind).toBe('mood');
  });

  it('offers nothing while the Mood screen is hidden', () => {
    expect(searchActions('feeling tired', { mood: null }).actions).toEqual([]);
  });
});

describe('searchActions: groceries', () => {
  it('offers to add a catalog item after "buy" or "add"', () => {
    const buy = only<GroceryAction>('buy milk', groceries())!;
    expect(buy).toMatchObject({ name: 'Milk', raw: 'milk', isNew: false, onList: null, listId: null, listName: 'Groceries' });
    expect(searchActions('buy milk', groceries()).onSubmit).toEqual(buy);
    expect(only<GroceryAction>('add eggs', groceries())).toMatchObject({ name: 'Eggs' });
  });

  it('keeps the quantity for the add to read', () => {
    expect(only<GroceryAction>('buy 2 gal milk', groceries())).toMatchObject({ name: 'Milk', raw: '2 gal milk', quantity: '2 gal' });
  });

  it('offers a new item only after "buy", or "add … to the list"', () => {
    expect(only<GroceryAction>('buy saffron', groceries())).toMatchObject({ name: 'saffron', isNew: true });
    expect(searchActions('add saffron', groceries()).actions).toEqual([]);
    expect(only<GroceryAction>('add saffron to the list', groceries())).toMatchObject({ name: 'saffron', raw: 'saffron', isNew: true });
    expect(only<GroceryAction>('add milk to my grocery list', groceries())).toMatchObject({ name: 'Milk', raw: 'milk' });
  });

  it('says so rather than offering an add when the item is already on that list', () => {
    const onList = only<GroceryAction>('buy milk', groceries(undefined, [entry('milk', null)]))!;
    expect(onList.onList).toBe('list');
    expect(isRunnable(onList)).toBe(false);
    expect(searchActions('buy milk', groceries(undefined, [entry('milk', null)])).onSubmit).toBeNull();
    expect(only<GroceryAction>('buy milk', groceries(undefined, [entry('milk', null, true)]))!.onList).toBe('cart');
    // On another list is not on this one.
    expect(only<GroceryAction>('buy milk', groceries(undefined, [entry('milk', 'trip')]))!.onList).toBeNull();
  });

  it('adds to the list it is given', () => {
    expect(only<GroceryAction>('buy milk', groceries(undefined, [], 'trip', 'Beach week')))
      .toMatchObject({ listId: 'trip', listName: 'Beach week' });
  });

  it('offers nothing while Groceries is hidden', () => {
    expect(searchActions('buy milk', { groceries: null }).actions).toEqual([]);
  });
});

describe('describeSearchAction', () => {
  const now = new Date('2026-10-05T12:00');
  const ctx = (overrides: Partial<DescribeContext> = {}): DescribeContext => ({
    medicationLogs: logs,
    medicationSettings: {},
    waterUnit: 'ml',
    waterTodayMl: 0,
    now,
    ...overrides,
  });
  const aleve = only<DoseAction>('take aleve', meds())!;

  it('says the dose and when it was last taken', () => {
    expect(describeSearchAction(aleve, ctx())).toEqual({
      title: 'Record a dose of Aleve',
      meta: ['440 mg', 'Last taken 9:00 AM'],
      warn: false,
      icon: 'medkit-outline',
    });
    expect(describeSearchAction(aleve, ctx({ now: new Date('2026-10-08T12:00') })).meta[1])
      .toBe('Last taken Oct 5, 9:00 AM');
  });

  it('says when the limit you set allows the next dose, when that is not yet', () => {
    const medicationSettings: MedicationSettingsMap = {
      aleve: {
        limit: { minHours: 8, maxPer24h: null, notify: false, since: new Date('2026-01-01T00:00').toISOString() },
        supply: null,
      },
    };
    expect(describeSearchAction(aleve, ctx({ medicationSettings }))).toMatchObject({
      meta: ['440 mg', 'Within your limit at 5:00 PM'],
      warn: true,
    });
  });

  it('leaves out a dose amount nobody recorded', () => {
    const bare = [dose('Tums', '2026-10-05T08:00', { amount: null, unit: null })];
    const tums = only<DoseAction>('take tums', meds(bare))!;
    expect(describeSearchAction(tums, ctx({ medicationLogs: bare })).meta).toEqual(['Last taken 8:00 AM']);
  });

  it('says the glass and the day so far', () => {
    const water = only<WaterAction>('2 glasses of water', { water: { unit: 'ml' } })!;
    expect(describeSearchAction(water, ctx())).toMatchObject({ title: 'Log 2 glasses of water', meta: ['500 ml'] });
    expect(describeSearchAction(water, ctx({ waterTodayMl: 1250 })).meta).toEqual(['500 ml', '1.25 L today so far']);
    const oz = only<WaterAction>('water', { water: { unit: 'flOz' } })!;
    expect(describeSearchAction(oz, ctx({ waterUnit: 'flOz' }))).toMatchObject({ title: 'Log a glass of water', meta: ['8 fl oz'] });
  });

  it('says what the mood log will open with', () => {
    const mood = { mood: { symptoms: ['Tired'] } };
    expect(describeSearchAction(only<MoodAction>('feeling tired', mood)!, ctx()).meta).toEqual(['Opens with Tired checked']);
    expect(describeSearchAction(only<MoodAction>('feeling low', mood)!, ctx()).meta).toEqual(['Opens with Low picked']);
    expect(describeSearchAction(only<MoodAction>('mood', mood)!, ctx())).toMatchObject({ title: 'Log your mood', meta: ['Opens the mood log'] });
  });

  it('names the list, and says when the item is already on it', () => {
    expect(describeSearchAction(only<GroceryAction>('buy 2 gal milk', groceries())!, ctx()))
      .toMatchObject({ title: 'Add Milk to Groceries', meta: ['2 gal'] });
    expect(describeSearchAction(only<GroceryAction>('buy saffron', groceries())!, ctx()).meta)
      .toEqual(['New to your catalog']);
    expect(describeSearchAction(only<GroceryAction>('buy milk', groceries(undefined, [entry('milk', null)]))!, ctx()).title)
      .toBe('Milk is already on Groceries');
    expect(describeSearchAction(only<GroceryAction>('buy milk', groceries(undefined, [entry('milk', null, true)]))!, ctx()).title)
      .toBe('Milk is already in your cart');
  });
});
