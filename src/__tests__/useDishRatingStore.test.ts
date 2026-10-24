import { useDishRatingStore } from '../store/useDishRatingStore';
import {
  dbInsertDishRating,
  dbUpdateDishRating,
  dbDeleteDishRating,
} from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllDishRatings: jest.fn(() => []),
  dbInsertDishRating: jest.fn(),
  dbUpdateDishRating: jest.fn(),
  dbDeleteDishRating: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useDishRatingStore.setState({ dishes: [], initialized: false });
});

const state = () => useDishRatingStore.getState();

describe('addDish', () => {
  it('writes the dish and holds it', () => {
    const dish = state().addDish({ name: 'Pad see ew', place: 'Thai Orchid', verdict: 'loved' });
    expect(dish).not.toBeNull();
    expect(state().dishes).toHaveLength(1);
    expect(dbInsertDishRating).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pad see ew', place: 'Thai Orchid', verdict: 'loved' })
    );
  });

  it('refuses a blank name', () => {
    expect(state().addDish({ name: '  ' })).toBeNull();
    expect(dbInsertDishRating).not.toHaveBeenCalled();
  });

  it('applies a photo given for a dish that is already saved', () => {
    const first = state().addDish({ name: 'Pad see ew', place: 'Thai Orchid' })!;
    state().addDish({ name: 'Pad see ew', place: 'Thai Orchid', photo: 'dish-1.jpg' });
    expect(state().dishes.find(d => d.id === first.id)?.photo).toBe('dish-1.jpg');
  });

  it('returns the dish already saved under that name and place rather than a second row', () => {
    const first = state().addDish({ name: 'Pad see ew', place: 'Thai Orchid', verdict: 'loved' })!;
    const again = state().addDish({ name: 'pad see ew', place: 'thai orchid' })!;
    expect(again.id).toBe(first.id);
    expect(state().dishes).toHaveLength(1);
  });

  it('does not clear a verdict when the same dish is added without one', () => {
    state().addDish({ name: 'Soup', verdict: 'avoid' });
    const again = state().addDish({ name: 'Soup', verdict: null })!;
    expect(again.verdict).toBe('avoid');
  });

  it('applies a new verdict to the dish already saved', () => {
    state().addDish({ name: 'Soup', verdict: 'fine' });
    const again = state().addDish({ name: 'Soup', verdict: 'loved' })!;
    expect(again.verdict).toBe('loved');
    expect(state().dishes).toHaveLength(1);
    expect(dbUpdateDishRating).toHaveBeenCalledTimes(1);
  });
});

describe('setVerdict, updateDish and removeDish', () => {
  it('changes the verdict and persists it', () => {
    const dish = state().addDish({ name: 'Soup' })!;
    state().setVerdict(dish.id, 'fine');
    expect(state().dishes[0].verdict).toBe('fine');
    expect(dbUpdateDishRating).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'fine' }));
  });

  it('ignores an id it does not hold', () => {
    state().updateDish('nope', { note: 'x' });
    expect(dbUpdateDishRating).not.toHaveBeenCalled();
  });

  it('folds a dish renamed onto another saved one into a single row', () => {
    const keep = state().addDish({ name: 'Green curry', place: 'Thai Orchid', verdict: 'loved', note: 'extra spicy' })!;
    const other = state().addDish({ name: 'Pad see ew', place: 'Thai Orchid', verdict: 'fine', photo: 'dish-9.jpg' })!;
    state().updateDish(keep.id, { name: 'pad see ew' });
    expect(state().dishes).toHaveLength(1);
    expect(state().dishes[0]).toEqual(expect.objectContaining({
      id: keep.id, name: 'pad see ew', verdict: 'loved', note: 'extra spicy', photo: 'dish-9.jpg',
    }));
    expect(dbDeleteDishRating).toHaveBeenCalledWith(other.id);
  });

  it('removes the row from the database and the list', () => {
    const dish = state().addDish({ name: 'Soup' })!;
    state().removeDish(dish.id);
    expect(state().dishes).toHaveLength(0);
    expect(dbDeleteDishRating).toHaveBeenCalledWith(dish.id);
  });
});

const DAY = new Date(2026, 9, 23, 2, 0);

describe('the rating offer', () => {
  it('is raised for an unrated dish and not for a rated one', () => {
    state().offerRating('Pad see ew', DAY);
    expect(state().offer).toEqual({ name: 'Pad see ew', lastHadAt: DAY });
    state().addDish({ name: 'Soup', verdict: 'fine' });
    state().offerRating('soup', DAY);
    expect(state().offer).toBeNull();
  });

  it('survives a reload of the store', () => {
    state().offerRating('Pad see ew', DAY);
    state().initialize();
    expect(state().offer).toEqual(expect.objectContaining({ name: 'Pad see ew' }));
  });

  it('saves a new dish with no place when answered', () => {
    state().offerRating('Pad see ew', DAY);
    state().rateOffered('loved');
    expect(state().offer).toBeNull();
    expect(state().dishes).toHaveLength(1);
    expect(state().dishes[0]).toEqual(expect.objectContaining({ name: 'Pad see ew', place: null, verdict: 'loved' }));
  });

  it('dates the dish by the day the meal belongs to, not the moment it was answered', () => {
    state().offerRating('Pad see ew', DAY);
    state().rateOffered('loved');
    const stored = state().dishes[0];
    expect(new Date(stored.lastHadAt!).getDate()).toBe(23);
    expect(new Date(stored.lastHadAt!).getHours()).toBe(12);
  });

  it('rates the saved dish of that name rather than adding a second', () => {
    const saved = state().addDish({ name: 'Pad see ew', place: 'Thai Orchid' })!;
    state().offerRating('Pad see ew', DAY);
    state().rateOffered('avoid');
    expect(state().dishes).toHaveLength(1);
    expect(state().dishes.find(d => d.id === saved.id)!.verdict).toBe('avoid');
  });

  it('drops the question when dismissed, and writes nothing', () => {
    state().offerRating('Pad see ew', DAY);
    state().dismissOffer();
    expect(state().offer).toBeNull();
    expect(dbInsertDishRating).not.toHaveBeenCalled();
  });
});
