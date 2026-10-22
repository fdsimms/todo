import { pickTitleSuggestion, suggestionMatch, describeTitleSuggestion, type TitleSuggestionContext } from '../utils/titleSuggestion';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0, use24HourTime: false }),
  },
}));

const base: TitleSuggestionContext = {
  plainKind: true,
  estimateOffered: true,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  hasSeries: false,
  hasChainSteps: false,
  projects: [{ id: 'p1', title: 'Japan' }],
  waitCandidates: [{ id: 't1', title: 'get W-2' }],
  weatherTasksOn: true,
  weatherWait: null,
  polarity: 'positive',
  windowEnd: null,
  hasRainSkip: false,
  rainUnit: 'mm',
  sunClock: () => '19:30',
};

const kindOf = (title: string, ctx: Partial<TitleSuggestionContext> = {}) =>
  pickTitleSuggestion(title, { ...base, ...ctx })?.kind ?? null;

describe('pickTitleSuggestion', () => {
  it('reads a pasted link out of a title', () => {
    const s = pickTitleSuggestion('Write Airbnb review https://www.airbnb.com/reviews/1/edit?x=1', base);
    expect(s?.kind).toBe('link');
    if (s?.kind === 'link') expect(s.hit.url).toBe('https://www.airbnb.com/reviews/1/edit?x=1');
  });

  it('reads a phone number and an email address', () => {
    expect(kindOf('call the doctor 555-123-4567')).toBe('phone');
    expect(kindOf('email jane@example.com about the invoice')).toBe('email');
  });

  it('reads priority and project tokens', () => {
    expect(kindOf('clean the garage !urgent')).toBe('priority');
    expect(kindOf('book hotel +japan')).toBe('project');
    expect(kindOf('book hotel +japan', { projects: null })).toBeNull();
  });

  it('puts priority ahead of a link in the same line', () => {
    expect(kindOf('read https://example.com !high')).toBe('priority');
  });

  it('offers a timer only from the plain kind', () => {
    expect(kindOf('play violin for 15 minutes')).toBe('duration');
    expect(kindOf('play violin for 15 minutes', { plainKind: false })).toBeNull();
  });

  it('offers a supply only once there is a repeat', () => {
    expect(kindOf('replace cpap filter 6 filters left')).toBeNull();
    expect(kindOf('replace cpap filter 6 filters left', { recurrenceType: 'monthly' })).toBe('supply');
  });

  it('refuses a target the repeat would undo', () => {
    expect(kindOf('drink water 8 times a day')).toBe('target');
    expect(kindOf('drink water 8 times a day', { recurrenceType: 'weekly', recurrenceInterval: 2 })).toBeNull();
    expect(kindOf('run 3 times a week', { recurrenceType: 'daily' })).toBeNull();
    const weekly = pickTitleSuggestion('run 3 times', { ...base, recurrenceType: 'weekly' });
    expect(weekly?.kind).toBe('target');
    if (weekly?.kind === 'target') expect(weekly.hit.period).toBe('week');
  });

  it('reads an estimate except where the kind has none', () => {
    expect(kindOf('clean the garage ~2h')).toBe('estimate');
    expect(kindOf('clean the garage ~2h', { estimateOffered: false })).toBeNull();
  });

  it('holds a weather wait to where it would be honored', () => {
    const line = 'leave books on the curb on the next sunny day';
    expect(kindOf(line)).toBe('weather');
    expect(kindOf(line, { weatherTasksOn: false })).toBeNull();
    expect(kindOf(line, { recurrenceType: 'daily' })).toBeNull();
    expect(kindOf(line, { hasSeries: true })).toBeNull();
  });

  it('resolves a sun window to a clock time, and says nothing without one', () => {
    const s = pickTitleSuggestion('porch lights after sunset', base);
    expect(s?.kind).toBe('sun');
    if (s?.kind === 'sun') expect(s.hit.clock).toBe('19:30');
    expect(kindOf('porch lights after sunset', { sunClock: () => null })).toBeNull();
  });

  it('skips for rain only on a repeat with the weather switch on', () => {
    const line = 'water the garden every 2 days unless it rains';
    expect(kindOf('water the garden unless it rains', { recurrenceType: 'daily' })).toBe('rain');
    expect(kindOf('water the garden unless it rains')).toBeNull();
    expect(kindOf('water the garden unless it rains', { recurrenceType: 'daily', weatherTasksOn: false })).toBeNull();
    expect(line).toContain('rains');
  });

  it('reads waiting on, subtasks and avoid last', () => {
    expect(kindOf('file taxes after get W-2')).toBe('waiting');
    expect(kindOf('pack: socks, charger, passport')).toBe('subtasks');
    expect(kindOf("Don't check Twitter")).toBe('avoid');
    expect(kindOf("Don't check Twitter", { polarity: 'negative' })).toBeNull();
  });

  it('carries an "until 4pm" into the avoid suggestion and its pill', () => {
    const s = pickTitleSuggestion("Don't eat until 4pm", base)!;
    expect(s.kind).toBe('avoid');
    expect(describeTitleSuggestion(s, 'mm', h => `@${h}`).label).toBe('Avoid this habit · clean at @16:00');
    expect(describeTitleSuggestion(pickTitleSuggestion("Don't check Twitter", base)!, 'mm', h => h).label).toBe('Avoid this habit');
  });

  it('offers just the closing time to a habit already set to don\'t-do', () => {
    const neg = { polarity: 'negative' as const };
    const s = pickTitleSuggestion('Skip breakfast until 10am', { ...base, ...neg })!;
    expect(s.kind).toBe('avoid');
    if (s.kind === 'avoid') expect(s.hit).toMatchObject({ endsAt: '10:00', already: true });
    expect(describeTitleSuggestion(s, 'mm', h => `@${h}`).label).toBe('Clean at @10:00');
    expect(suggestionMatch('Skip breakfast until 10am', s).matchedText).toBe('until 10am');
    // Not again once the window end holds it, and not for a title with no closing time.
    expect(kindOf('Skip breakfast until 10am', { ...neg, windowEnd: '10:00' })).toBeNull();
    expect(kindOf("Don't check Twitter", neg)).toBeNull();
  });

  it('reads a chain from the plain kind', () => {
    expect(kindOf('call mom -> buy milk -> walk the dog')).toBe('chain');
    expect(kindOf('call mom -> buy milk', { plainKind: false })).toBeNull();
  });

  it('says nothing for an ordinary title', () => {
    expect(kindOf('Buy milk')).toBeNull();
    expect(kindOf('   ')).toBeNull();
  });
});

describe('suggestionMatch and describeTitleSuggestion', () => {
  it('locates the matched text and words the pill', () => {
    const title = 'read https://example.com later';
    const s = pickTitleSuggestion(title, base)!;
    const match = suggestionMatch(title, s);
    expect(match.matchedText).toBe('https://example.com');
    expect(title.slice(match.matchStart, match.matchStart + match.matchedText.length)).toBe('https://example.com');
    expect(describeTitleSuggestion(s, 'mm', h => h)).toEqual({ icon: 'link-outline', label: 'https://example.com' });
  });

  it('marks a chain as the whole line', () => {
    const title = 'a -> b';
    const s = pickTitleSuggestion(title, base)!;
    expect(suggestionMatch(title, s).wholeLine).toBe(true);
    expect(describeTitleSuggestion(s, 'mm', h => h).label).toBe('Chain · 2 steps');
  });
});
