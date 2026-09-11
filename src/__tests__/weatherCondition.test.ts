import {
  classifyWeather,
  weatherIconFor,
  weatherConditionAdjective,
  weatherConditionNoun,
} from '../utils/weatherCondition';

describe('classifyWeather', () => {
  it('reads a clear sky as sunny', () => {
    expect(classifyWeather(0, 70)).toContain('sunny');
    expect(classifyWeather(1, 70)).toContain('sunny');
  });

  it('reads rain codes, including showers and thunderstorms, as rainy', () => {
    expect(classifyWeather(61, 60)).toEqual(['rainy']);
    expect(classifyWeather(80, 60)).toEqual(['rainy']);
    expect(classifyWeather(95, 60)).toEqual(['rainy']);
  });

  it('reads snow codes as snowy', () => {
    expect(classifyWeather(71, 30)).toContain('snowy');
    expect(classifyWeather(85, 30)).toContain('snowy');
  });

  it('reads an overcast or foggy code as none of sunny/rainy/snowy', () => {
    expect(classifyWeather(3, 60)).toEqual([]);
    expect(classifyWeather(45, 60)).toEqual([]);
  });

  it('adds cold at or below the threshold, independent of the sky', () => {
    expect(classifyWeather(0, 45)).toEqual(['sunny', 'cold']);
    expect(classifyWeather(0, 46)).toEqual(['sunny']);
  });

  it('adds hot at or above the threshold, independent of the sky', () => {
    expect(classifyWeather(0, 85)).toEqual(['sunny', 'hot']);
    expect(classifyWeather(0, 84)).toEqual(['sunny']);
  });

  it('never reports both cold and hot at once', () => {
    const conditions = classifyWeather(1, 60);
    expect(conditions).not.toEqual(expect.arrayContaining(['cold', 'hot']));
  });

  it('reports nothing for an unremarkable mild, overcast day', () => {
    expect(classifyWeather(3, 65)).toEqual([]);
  });
});

describe('weatherIconFor', () => {
  it('picks snow over rain over sun, sky codes only', () => {
    expect(weatherIconFor(71)).toBe('snow-outline');
    expect(weatherIconFor(61)).toBe('rainy-outline');
    expect(weatherIconFor(0)).toBe('sunny-outline');
  });

  it('falls back to a cloud for an overcast or foggy code', () => {
    expect(weatherIconFor(3)).toBe('cloud-outline');
    expect(weatherIconFor(45)).toBe('cloud-outline');
  });
});

describe('weatherConditionAdjective / weatherConditionNoun', () => {
  it('describe the same three sky groups as weatherIconFor, plus a cloudy fallback', () => {
    expect(weatherConditionAdjective(0)).toBe('sunny');
    expect(weatherConditionAdjective(61)).toBe('rainy');
    expect(weatherConditionAdjective(71)).toBe('snowy');
    expect(weatherConditionAdjective(3)).toBe('cloudy');

    expect(weatherConditionNoun(0)).toBe('Sun');
    expect(weatherConditionNoun(61)).toBe('Rain');
    expect(weatherConditionNoun(71)).toBe('Snow');
    expect(weatherConditionNoun(3)).toBe('Clouds');
  });
});
