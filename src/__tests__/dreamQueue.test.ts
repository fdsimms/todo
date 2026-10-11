import { parseQueuedDreams, QUEUED_DREAM_MAX_LENGTH } from '../utils/dreamQueue';

describe('parseQueuedDreams', () => {
  it('reads the text and the moment it was said', () => {
    const [dream] = parseQueuedDreams('[{"text":"A long corridor","at":"2026-10-11T06:30:00Z"}]');
    expect(dream.text).toBe('A long corridor');
    expect(dream.at?.toISOString()).toBe('2026-10-11T06:30:00.000Z');
  });

  it('trims the text and keeps a dream whose moment is unreadable, filed as now', () => {
    expect(parseQueuedDreams('[{"text":"  Flying ","at":"nonsense"}]')).toEqual([{ text: 'Flying', at: null }]);
    expect(parseQueuedDreams('[{"text":"Flying"}]')).toEqual([{ text: 'Flying', at: null }]);
  });

  it('drops anything malformed without throwing', () => {
    expect(parseQueuedDreams('')).toEqual([]);
    expect(parseQueuedDreams('not json')).toEqual([]);
    expect(parseQueuedDreams('{"text":"x"}')).toEqual([]);
    expect(parseQueuedDreams('[null, 3, {"text":5}, {"text":"   "}, {"at":"2026-10-11T06:30:00Z"}]')).toEqual([]);
  });

  it('keeps the good records beside a bad one, in order', () => {
    expect(parseQueuedDreams('[{"text":"One"},{"text":7},{"text":"Two"}]').map(d => d.text)).toEqual(['One', 'Two']);
  });

  it('cuts a dream to the entry limit', () => {
    const [dream] = parseQueuedDreams(JSON.stringify([{ text: 'x'.repeat(QUEUED_DREAM_MAX_LENGTH + 50) }]));
    expect(dream.text).toHaveLength(QUEUED_DREAM_MAX_LENGTH);
  });
});
