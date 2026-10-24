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

  it('removes the row from the database and the list', () => {
    const dish = state().addDish({ name: 'Soup' })!;
    state().removeDish(dish.id);
    expect(state().dishes).toHaveLength(0);
    expect(dbDeleteDishRating).toHaveBeenCalledWith(dish.id);
  });
});

describe('the rating offer', () => {
  it('is raised for an unrated dish and not for a rated one', () => {
    state().offerRating('Pad see ew');
    expect(state().offer).toEqual({ name: 'Pad see ew' });
    state().addDish({ name: 'Soup', verdict: 'fine' });
    state().offerRating('soup');
    expect(state().offer).toBeNull();
  });

  it('saves a new dish with no place when answered', () => {
    state().offerRating('Pad see ew');
    state().rateOffered('loved');
    expect(state().offer).toBeNull();
    expect(state().dishes).toHaveLength(1);
    expect(state().dishes[0]).toEqual(expect.objectContaining({ name: 'Pad see ew', place: null, verdict: 'loved' }));
  });

  it('rates the saved dish of that name rather than adding a second', () => {
    const saved = state().addDish({ name: 'Pad see ew', place: 'Thai Orchid' })!;
    state().offerRating('Pad see ew');
    state().rateOffered('avoid');
    expect(state().dishes).toHaveLength(1);
    expect(state().dishes.find(d => d.id === saved.id)!.verdict).toBe('avoid');
  });

  it('drops the question when dismissed, and writes nothing', () => {
    state().offerRating('Pad see ew');
    state().dismissOffer();
    expect(state().offer).toBeNull();
    expect(dbInsertDishRating).not.toHaveBeenCalled();
  });
});
