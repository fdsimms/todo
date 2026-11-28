import {
  cleanPinnedSymptoms,
  isPinnedSymptom,
  parsePinnedSymptoms,
  togglePinnedSymptom,
} from '../utils/pinnedSymptoms';

describe('parsePinnedSymptoms', () => {
  it('reads a stored list, one per symptom in the order pinned', () => {
    expect(parsePinnedSymptoms('["Brain fog"," Fatigue ","brain fog",""]')).toEqual(['Brain fog', 'Fatigue']);
  });

  it('is empty for nothing, for text that isn’t JSON, and for JSON that isn’t a list', () => {
    expect(parsePinnedSymptoms(null)).toEqual([]);
    expect(parsePinnedSymptoms('')).toEqual([]);
    expect(parsePinnedSymptoms('{oops')).toEqual([]);
    expect(parsePinnedSymptoms('{"a":1}')).toEqual([]);
  });

  it('drops entries that aren’t text', () => {
    expect(parsePinnedSymptoms('["Fatigue", 3, null]')).toEqual(['Fatigue']);
  });
});

describe('togglePinnedSymptom', () => {
  it('pins a symptom, matching the way symptoms are matched everywhere', () => {
    expect(isPinnedSymptom(['Brain fog'], '  brain FOG ')).toBe(true);
    expect(togglePinnedSymptom([], 'Brain fog')).toEqual(['Brain fog']);
  });

  it('unpins one that is already pinned, whatever its casing', () => {
    expect(togglePinnedSymptom(['Brain fog', 'Fatigue'], 'brain fog')).toEqual(['Fatigue']);
  });

  it('never adds a blank', () => {
    expect(togglePinnedSymptom(['Fatigue'], '  ')).toEqual(['Fatigue']);
    expect(cleanPinnedSymptoms(['', ' '])).toEqual([]);
  });
});
