import {
  NO_GENERATED_TASK_EXTRAS,
  TASK_SETTINGS_SPECS,
  describeGeneratedTaskSettings,
  generatedExtrasFill,
  hasGeneratedTaskExtras,
  hasTaskSettingsSheet,
  leadDaysPhrase,
  parseGeneratedTaskExtras,
  parseGeneratedTaskExtrasValue,
} from '../utils/generatedTaskSettings';
import { GENERATED_KINDS } from '../utils/generatedTasks';
import type { GeneratedTaskExtras } from '../types';

const extras = (patch: Partial<GeneratedTaskExtras>): GeneratedTaskExtras => ({ ...NO_GENERATED_TASK_EXTRAS, ...patch });

describe('hasGeneratedTaskExtras', () => {
  it('is false for nothing set, and for options without a choice question', () => {
    expect(hasGeneratedTaskExtras(null)).toBe(false);
    expect(hasGeneratedTaskExtras(NO_GENERATED_TASK_EXTRAS)).toBe(false);
    expect(hasGeneratedTaskExtras(extras({ deliverableOptions: ['a', 'b'] }))).toBe(false);
  });

  it('is true once any field is set', () => {
    expect(hasGeneratedTaskExtras(extras({ tags: ['x'] }))).toBe(true);
    expect(hasGeneratedTaskExtras(extras({ timeSegments: ['morning'] }))).toBe(true);
    expect(hasGeneratedTaskExtras(extras({ deliverableKind: 'text' }))).toBe(true);
  });
});

describe('parseGeneratedTaskExtras', () => {
  it('round-trips a stored value', () => {
    const stored = { groceryUseUp: extras({ tags: ['cooking'], timeSegments: ['evening'], deliverableKind: 'choice', deliverableOptions: ['Ate it', 'Froze it'] }) };
    expect(parseGeneratedTaskExtras(JSON.stringify(stored))).toEqual(stored);
  });

  it('reads nothing from a missing or corrupt value', () => {
    expect(parseGeneratedTaskExtras(null)).toEqual({});
    expect(parseGeneratedTaskExtras('{nope')).toEqual({});
    expect(parseGeneratedTaskExtras('[1]')).toEqual({});
  });

  it('drops a bad field rather than the whole kind', () => {
    expect(parseGeneratedTaskExtrasValue({ tags: ['a', 3, ' a ', ''], timeSegments: ['noon', 'night'], deliverableKind: 'essay' }))
      .toEqual(extras({ tags: ['a'], timeSegments: ['night'] }));
  });

  it('keeps options only with a choice question, and drops a kind left with nothing', () => {
    expect(parseGeneratedTaskExtrasValue({ deliverableKind: 'yesno', deliverableOptions: ['a', 'b'] }))
      .toEqual(extras({ deliverableKind: 'yesno' }));
    expect(parseGeneratedTaskExtras(JSON.stringify({ birthday: { tags: [] } }))).toEqual({});
  });
});

describe('generatedExtrasFill', () => {
  const set = extras({ tags: ['cooking', 'fridge'], timeSegments: ['evening'], deliverableKind: 'choice', deliverableOptions: ['Ate it', 'Froze it'] });

  it('fills every field a draft left alone', () => {
    expect(generatedExtrasFill({}, set)).toEqual({
      tags: ['cooking', 'fridge'],
      timeSegments: ['evening'],
      deliverableKind: 'choice',
      deliverableOptions: ['Ate it', 'Froze it'],
    });
  });

  it('adds its tags to the draft\'s rather than replacing them', () => {
    expect(generatedExtrasFill({ tags: ['fridge', 'veg'] }, set).tags).toEqual(['fridge', 'veg', 'cooking']);
  });

  it('never overrides a time of day or a question the draft names', () => {
    const fill = generatedExtrasFill({ timeSegments: ['morning'], deliverableKind: 'text', deliverableOptions: [] }, set);
    expect(fill.timeSegments).toEqual(['morning']);
    expect(fill.deliverableKind).toBe('text');
    expect(fill.deliverableOptions).toEqual([]);
  });

  it('treats an empty time-of-day list as unanswered', () => {
    expect(generatedExtrasFill({ timeSegments: [] }, set).timeSegments).toEqual(['evening']);
  });

  it('hands the draft back unchanged when nothing is set', () => {
    const draft = { tags: ['x'], timeSegments: [] as [], deliverableKind: null, deliverableOptions: [] };
    expect(generatedExtrasFill(draft, null)).toEqual(draft);
    expect(generatedExtrasFill(draft, NO_GENERATED_TASK_EXTRAS)).toEqual(draft);
  });
});

describe('TASK_SETTINGS_SPECS', () => {
  it('names only real kinds', () => {
    for (const kind of Object.keys(TASK_SETTINGS_SPECS)) expect(GENERATED_KINDS).toContain(kind);
  });

  it('opens the sheet for the use-up and birthday kinds', () => {
    expect(hasTaskSettingsSheet('groceryUseUp')).toBe(true);
    expect(hasTaskSettingsSheet('birthday')).toBe(true);
    expect(hasTaskSettingsSheet('pantryCheck')).toBe(false);
  });

  it('describes the date with the lead the person set', () => {
    const owned = TASK_SETTINGS_SPECS.groceryUseUp!.owned({ groceryUseUpLeadDays: 3, birthdayLeadDays: 0 });
    expect(owned.find(f => f.key === 'date')?.summary).toBe('3 days before the use-by date');
    const birthday = TASK_SETTINGS_SPECS.birthday!.owned({ groceryUseUpLeadDays: 3, birthdayLeadDays: 0 });
    expect(birthday.find(f => f.key === 'date')?.summary).toBe('On the birthday');
  });

  it('never offers a field it also locks', () => {
    // The sheet edits category, tags, time of day, the defaults and a question;
    // a generator that wrote one of those would have its owned row contradict
    // the editable one.
    const editable = ['category', 'tags', 'time', 'priority', 'effort', 'difficulty', 'deliverable'];
    for (const spec of Object.values(TASK_SETTINGS_SPECS)) {
      for (const field of spec!.owned({ groceryUseUpLeadDays: 2, birthdayLeadDays: 3 })) {
        expect(editable).not.toContain(field.key);
      }
    }
  });
});

describe('leadDaysPhrase', () => {
  it('counts days, singular at one', () => {
    expect(leadDaysPhrase(1, 'the birthday')).toBe('1 day before the birthday');
    expect(leadDaysPhrase(5, 'the birthday')).toBe('5 days before the birthday');
  });
});

describe('describeGeneratedTaskSettings', () => {
  it('is null when nothing is set', () => {
    expect(describeGeneratedTaskSettings(null, null, null)).toBeNull();
  });

  it('lists the category, the defaults and the extras in order', () => {
    expect(describeGeneratedTaskSettings(
      'Groceries',
      { priority: 2, difficulty: null, effort: null, showStreak: null, vacationPause: null, excludeFromSuggestions: null },
      extras({ tags: ['cooking'], timeSegments: ['evening'], deliverableKind: 'yesno' }),
    )).toBe('Groceries · Medium · #cooking · Evening · Asks on completion');
  });
});
