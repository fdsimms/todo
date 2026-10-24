import {
  isPlausiblePulse,
  parsePulseInput,
  parsePulseSeries,
  pulsesSince,
  standalonePulses,
  type PulseEntry,
} from '../utils/pulseLog';

const at = (h: number, d = 10) => new Date(2026, 9, d, h);
const entry = (when: Date, bpm: number, kind: PulseEntry['kind'] = 'logged'): PulseEntry => ({ at: when, bpm, kind });

describe('parsePulseInput', () => {
  it('takes whole beats per minute only', () => {
    expect(parsePulseInput('64')).toBe(64);
    expect(parsePulseInput(' 64 ')).toBe(64);
    expect(parsePulseInput('64.5')).toBeNull();
    expect(parsePulseInput('64 bpm')).toBeNull();
    expect(parsePulseInput('')).toBeNull();
  });

  it('refuses a number no pulse could be', () => {
    expect(parsePulseInput('29')).toBeNull();
    expect(parsePulseInput('251')).toBeNull();
    expect(isPlausiblePulse(30)).toBe(true);
    expect(isPlausiblePulse(250)).toBe(true);
  });
});

describe('parsePulseSeries', () => {
  it('reads both kinds, oldest first', () => {
    const json = JSON.stringify([
      { at: new Date(2026, 9, 11, 8).toISOString(), bpm: 58, kind: 'resting' },
      { at: new Date(2026, 9, 10, 9).toISOString(), bpm: 64, kind: 'logged' },
    ]);
    expect(parsePulseSeries(json).map(e => [e.bpm, e.kind])).toEqual([[64, 'logged'], [58, 'resting']]);
  });

  it('drops a malformed entry, an unknown kind and an implausible number', () => {
    const json = JSON.stringify([
      { at: 'not a date', bpm: 64, kind: 'logged' },
      { at: new Date(2026, 9, 10, 9).toISOString(), bpm: 64, kind: 'other' },
      { at: new Date(2026, 9, 10, 9).toISOString(), bpm: 900, kind: 'logged' },
      { at: new Date(2026, 9, 10, 9).toISOString(), bpm: '64', kind: 'logged' },
      null,
      { at: new Date(2026, 9, 10, 9).toISOString(), bpm: 70, kind: 'logged' },
    ]);
    expect(parsePulseSeries(json).map(e => e.bpm)).toEqual([70]);
  });

  it('answers empty for anything that is not a list', () => {
    expect(parsePulseSeries('[]')).toEqual([]);
    expect(parsePulseSeries('{}')).toEqual([]);
    expect(parsePulseSeries('nope')).toEqual([]);
  });
});

describe('standalonePulses', () => {
  it('drops a logged pulse at a reading’s instant, which its row already shows', () => {
    const entries = [entry(at(8), 64), entry(at(9), 70)];
    const readings = [{ at: at(8) }];
    expect(standalonePulses(entries, readings).map(e => e.bpm)).toEqual([70]);
  });

  it('never drops a resting entry, even at a reading’s instant', () => {
    const entries = [entry(at(8), 58, 'resting')];
    expect(standalonePulses(entries, [{ at: at(8) }])).toHaveLength(1);
  });

  it('keeps everything when there are no readings', () => {
    const entries = [entry(at(8), 64), entry(at(9), 58, 'resting')];
    expect(standalonePulses(entries, [])).toHaveLength(2);
  });
});

describe('pulsesSince', () => {
  it('keeps entries at or after the start of the range', () => {
    const entries = [entry(at(8, 9), 60), entry(at(8, 10), 61), entry(at(8, 11), 62)];
    expect(pulsesSince(entries, at(8, 10)).map(e => e.bpm)).toEqual([61, 62]);
  });
});
