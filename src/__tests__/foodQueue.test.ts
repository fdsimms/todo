import { parseQueuedFoods, QUEUED_FOOD_MAX_LENGTH } from '../utils/foodQueue';

describe('parseQueuedFoods', () => {
  it('reads the text and the moment it was said', () => {
    const [food] = parseQueuedFoods('[{"text":"Two eggs on toast","at":"2026-10-11T08:30:00Z"}]');
    expect(food.text).toBe('Two eggs on toast');
    expect(food.at?.toISOString()).toBe('2026-10-11T08:30:00.000Z');
  });

  it('trims the text and keeps a meal whose moment is unreadable, filed as now', () => {
    expect(parseQueuedFoods('[{"text":"  A banana ","at":"nonsense"}]')).toEqual([{ text: 'A banana', at: null }]);
    expect(parseQueuedFoods('[{"text":"A banana"}]')).toEqual([{ text: 'A banana', at: null }]);
  });

  it('drops anything malformed without throwing', () => {
    expect(parseQueuedFoods('')).toEqual([]);
    expect(parseQueuedFoods('not json')).toEqual([]);
    expect(parseQueuedFoods('{"text":"x"}')).toEqual([]);
    expect(parseQueuedFoods('[null, 3, {"text":5}, {"text":"   "}, {"at":"2026-10-11T08:30:00Z"}]')).toEqual([]);
  });

  it('keeps the good records beside a bad one, in order', () => {
    expect(parseQueuedFoods('[{"text":"One"},{"text":7},{"text":"Two"}]').map(f => f.text)).toEqual(['One', 'Two']);
  });

  it('cuts a description to the limit', () => {
    const [food] = parseQueuedFoods(JSON.stringify([{ text: 'x'.repeat(QUEUED_FOOD_MAX_LENGTH + 50) }]));
    expect(food.text).toHaveLength(QUEUED_FOOD_MAX_LENGTH);
  });
});
