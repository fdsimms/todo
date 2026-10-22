import { QUICK_ADD_PHRASES } from '../utils/quickAddPhrases';
import { pickTitleSuggestion, type TitleSuggestionContext } from '../utils/titleSuggestion';
import { parseTaskInput } from '../utils/parseTaskInput';

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

const NOW = new Date(2026, 9, 20, 9, 0);
const phrases = QUICK_ADD_PHRASES.flatMap(s => s.phrases);

describe('the "What can I type?" sheet', () => {
  it.each(phrases.filter(p => p.reads === 'title').map(p => [p.example, p] as const))(
    'still reads %s',
    (_example, phrase) => {
      if (phrase.reads !== 'title') return;
      expect(pickTitleSuggestion(phrase.example, { ...base, ...phrase.context })?.kind).toBe(phrase.kind);
    },
  );

  it.each(phrases.filter(p => p.reads === 'schedule').map(p => [p.example] as const))(
    'still reads a date out of %s',
    example => {
      expect(parseTaskInput(example, NOW, NOW, '00:00')).not.toBeNull();
    },
  );

  it('lists each example once', () => {
    const examples = phrases.map(p => p.example);
    expect(new Set(examples).size).toBe(examples.length);
  });
});
