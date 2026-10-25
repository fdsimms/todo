import { customMinutesProblem, isPresetMinutes, parseCustomMinutes, shortMinutesLabel } from '../utils/customMinutes';

const RANGE = { min: 15, max: 720 };

describe('parseCustomMinutes', () => {
  it('accepts a whole number inside the range, edges included', () => {
    expect(parseCustomMinutes('45', RANGE)).toBe(45);
    expect(parseCustomMinutes(' 15 ', RANGE)).toBe(15);
    expect(parseCustomMinutes('720', RANGE)).toBe(720);
  });

  it('refuses empty, out of range, decimals and non-digits', () => {
    expect(parseCustomMinutes('', RANGE)).toBeNull();
    expect(parseCustomMinutes('14', RANGE)).toBeNull();
    expect(parseCustomMinutes('721', RANGE)).toBeNull();
    expect(parseCustomMinutes('4.5', RANGE)).toBeNull();
    expect(parseCustomMinutes('-30', RANGE)).toBeNull();
    expect(parseCustomMinutes('1e3', RANGE)).toBeNull();
    expect(parseCustomMinutes('123456', RANGE)).toBeNull();
  });

  it('allows zero when the range does', () => {
    expect(parseCustomMinutes('0', { min: 0, max: 60 })).toBe(0);
  });
});

describe('customMinutesProblem', () => {
  it('says nothing about an empty field', () => {
    expect(customMinutesProblem('', RANGE)).toBeNull();
    expect(customMinutesProblem('  ', RANGE)).toBeNull();
  });

  it('names the range when the text cannot be used', () => {
    expect(customMinutesProblem('5', RANGE)).toBe('Enter a whole number of minutes from 15 to 720.');
  });

  it('is null for a usable value', () => {
    expect(customMinutesProblem('45', RANGE)).toBeNull();
  });
});

describe('shortMinutesLabel', () => {
  it('reads minutes, hours and both', () => {
    expect(shortMinutesLabel(45)).toBe('45 min');
    expect(shortMinutesLabel(120)).toBe('2 hr');
    expect(shortMinutesLabel(90)).toBe('1 hr 30 min');
  });
});

describe('isPresetMinutes', () => {
  it('matches numbers and null', () => {
    expect(isPresetMinutes(30, [15, 30])).toBe(true);
    expect(isPresetMinutes(null, [15, null])).toBe(true);
    expect(isPresetMinutes(45, [15, 30])).toBe(false);
  });
});
