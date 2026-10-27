import { DICTATION_BARS, barHeight, dictationJoiner, dictationRefusal, joinDictation, pushLevel, transcriptRestarted } from '../utils/dictation';

describe('joinDictation', () => {
  it('puts the spoken words on an empty page as they are', () => {
    expect(joinDictation('', 'Slept badly.', 5000)).toBe('Slept badly.');
  });

  it('adds a space after typed words and none after whitespace already there', () => {
    expect(joinDictation('Morning pages', 'went fine', 5000)).toBe('Morning pages went fine');
    expect(joinDictation('Morning pages\n', 'went fine', 5000)).toBe('Morning pages\nwent fine');
  });

  it('leaves the page alone when nothing was heard', () => {
    expect(joinDictation('Already here', '   ', 5000)).toBe('Already here');
  });

  it('is recomputed from the base, so a revised partial replaces the last one', () => {
    const base = 'Start.';
    expect(joinDictation(base, 'I think', 5000)).toBe('Start. I think');
    expect(joinDictation(base, 'I thought so', 5000)).toBe('Start. I thought so');
  });

  it('cuts at the field limit without leaving trailing whitespace', () => {
    expect(joinDictation('abc', 'def ghi', 7)).toBe('abc def');
    expect(joinDictation('abc', 'def ghi', 8)).toBe('abc def');
  });
});

describe('pushLevel', () => {
  it('appends and keeps only the newest levels', () => {
    let levels: number[] = [];
    for (let i = 0; i < DICTATION_BARS + 5; i++) levels = pushLevel(levels, i / 100);
    expect(levels).toHaveLength(DICTATION_BARS);
    expect(levels[levels.length - 1]).toBeCloseTo((DICTATION_BARS + 4) / 100);
  });

  it('clamps a level outside 0..1 and treats a non-number as silence', () => {
    expect(pushLevel([], 3)).toEqual([1]);
    expect(pushLevel([], -1)).toEqual([0]);
    expect(pushLevel([], Number.NaN)).toEqual([0]);
  });
});

describe('barHeight', () => {
  it('maps silence to the minimum and full volume to the maximum', () => {
    expect(barHeight(0, 4, 30)).toBe(4);
    expect(barHeight(1, 4, 30)).toBe(30);
    expect(barHeight(0.5, 4, 30)).toBe(17);
  });

  it('stays inside the range for a bad level', () => {
    expect(barHeight(9, 4, 30)).toBe(30);
    expect(barHeight(Number.NaN, 4, 30)).toBe(4);
  });
});

describe('dictationRefusal', () => {
  it('sends a permission refusal to Settings', () => {
    expect(dictationRefusal('permission').offerSettings).toBe(true);
  });

  it('refuses rather than falling back when speech needs the internet', () => {
    const refusal = dictationRefusal('unavailable');
    expect(refusal.offerSettings).toBe(false);
    expect(refusal.message).toMatch(/never sends your voice/);
  });

  it('has plain copy with no em dash for every failure', () => {
    for (const failure of ['permission', 'unavailable', 'start'] as const) {
      const { title, message } = dictationRefusal(failure);
      expect(`${title} ${message}`).not.toMatch(/—/);
    }
  });
});

describe('dictationJoiner', () => {
  it('replaces a revised partial, as joinDictation does', () => {
    const join = dictationJoiner('Start.', 5000);
    expect(join('I think')).toBe('Start. I think');
    expect(join('I thought so')).toBe('Start. I thought so');
  });

  it('keeps what was heard when the recognizer starts its transcript over after a pause', () => {
    const join = dictationJoiner('', 5000);
    join('Going to watch a movie with Britney soon');
    expect(join('Going to watch a movie with Britney soon and then')).toBe('Going to watch a movie with Britney soon and then');
    expect(join('We')).toBe('Going to watch a movie with Britney soon and then We');
    expect(join('We are going to a show')).toBe('Going to watch a movie with Britney soon and then We are going to a show');
  });

  it('keeps it when the restart arrives as an empty transcript', () => {
    const join = dictationJoiner('Typed.', 5000);
    join('a fairly long first sentence');
    expect(join('')).toBe('Typed. a fairly long first sentence');
    expect(join('next')).toBe('Typed. a fairly long first sentence next');
  });
});

describe('transcriptRestarted', () => {
  it('ignores a short transcript and an ordinary revision', () => {
    expect(transcriptRestarted('hi there', 'hi')).toBe(false);
    expect(transcriptRestarted('I think we should go', 'I thought we should go')).toBe(false);
  });
});
