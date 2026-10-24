/**
 * The dish tools against a real replica, since every write goes through
 * `useDishRatingStore`'s own actions and a stub would test the stub. The
 * store's own rules are tested where it lives; this holds what the tools say,
 * what a retry does, and that nothing here picks an answer for the person.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { addDish, deleteDish, listDishes, updateDish } from '../dishTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the dish tools', () => {
  let replica: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM dish_ratings');
    replica.refresh();
  });

  it('lists nothing, with a note that an answer is only what the person said', () => {
    const list = listDishes(replica);
    expect(list.dishes).toEqual([]);
    expect(list.note).toMatch(/only what the person told you/);
    expect(list.note).toMatch(/not the same as fine/);
  });

  it('adds a dish on the day named and reports it by day', () => {
    const { dish } = addDish(replica, { name: 'Pad see ew', place: 'Thai Orchid', verdict: 'loved', note: 'Extra spicy', date: '2026-09-01' });
    expect(dish).toMatchObject({ name: 'Pad see ew', place: 'Thai Orchid', verdict: 'loved', note: 'Extra spicy', lastHad: '2026-09-01', hasPhoto: false });
    const stored = replica.dishes().find(d => d.id === dish.id)!;
    expect(new Date(stored.lastHadAt!).getHours()).toBe(12);
  });

  it('leaves the answer unset when none was given, and defaults the day to today', () => {
    const { dish } = addDish(replica, { name: 'Green curry' });
    expect(dish.verdict).toBeNull();
    expect(dish.lastHad).toBe(replica.todayKey());
  });

  it('updates the saved dish when the same name and place come in again, so a retry is not a second row', () => {
    const first = addDish(replica, { name: 'Pad see ew', place: 'Thai Orchid', verdict: 'fine' }).dish;
    const again = addDish(replica, { name: 'pad see ew', place: 'thai orchid', verdict: 'loved' }).dish;
    expect(again.id).toBe(first.id);
    expect(again.verdict).toBe('loved');
    expect(listDishes(replica).dishes).toHaveLength(1);
  });

  it('refuses a blank name and a date it cannot read', () => {
    expect(() => addDish(replica, { name: '   ' })).toThrow(/needs a name/);
    expect(() => addDish(replica, { name: 'Soup', date: 'last week' })).toThrow(/not a date I can read/);
    expect(listDishes(replica).dishes).toEqual([]);
  });

  it('filters by answer and by part of the place name', () => {
    addDish(replica, { name: 'Pad see ew', place: 'Thai Orchid', verdict: 'loved' });
    addDish(replica, { name: 'Lasagna', place: "Luigi's", verdict: 'avoid' });
    addDish(replica, { name: 'Soup' });
    expect(listDishes(replica, { verdict: 'loved' }).dishes.map(d => d.name)).toEqual(['Pad see ew']);
    expect(listDishes(replica, { place: 'LUIGI' }).dishes.map(d => d.name)).toEqual(['Lasagna']);
    expect(listDishes(replica, {}).dishes).toHaveLength(3);
  });

  it('changes only what is named, clears with null, and refuses an empty patch or an unknown id', () => {
    const { dish } = addDish(replica, { name: 'Pad see ew', place: 'Thai Orchid', verdict: 'loved', note: 'Extra spicy' });
    expect(updateDish(replica, dish.id, { note: null }).dish).toMatchObject({ note: null, verdict: 'loved', place: 'Thai Orchid' });
    expect(updateDish(replica, dish.id, { verdict: null }).dish.verdict).toBeNull();
    expect(updateDish(replica, dish.id, { place: null }).dish.place).toBeNull();
    expect(() => updateDish(replica, dish.id, {})).toThrow(/Nothing to change/);
    expect(() => updateDish(replica, 'nope', { note: 'x' })).toThrow(/No dish with id nope/);
    expect(() => updateDish(replica, dish.id, { name: '  ' })).toThrow(/needs a name/);
  });

  it('deletes by id and says what it removed', () => {
    const { dish } = addDish(replica, { name: 'Soup' });
    expect(deleteDish(replica, dish.id).removed.name).toBe('Soup');
    expect(listDishes(replica).dishes).toEqual([]);
    expect(() => deleteDish(replica, dish.id)).toThrow(/No dish with id/);
  });
});
