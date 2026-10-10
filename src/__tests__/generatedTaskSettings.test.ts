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
import { GENERATED_KINDS, GENERATED_KIND_LIST } from '../utils/generatedTasks';
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

const CTX = { groceryUseUpLeadDays: 2, birthdayLeadDays: 3, birthdayGiftLeadDays: 10, mealShortfallLeadDays: 2 };
const CTX0 = { groceryUseUpLeadDays: 3, birthdayLeadDays: 0, birthdayGiftLeadDays: 0, mealShortfallLeadDays: 0 };

describe('TASK_SETTINGS_SPECS', () => {
  it('names only real kinds', () => {
    for (const kind of Object.keys(TASK_SETTINGS_SPECS)) expect(GENERATED_KINDS).toContain(kind);
  });

  it('has an entry for every generator Settings lists', () => {
    for (const spec of GENERATED_KIND_LIST) expect(hasTaskSettingsSheet(spec.kind)).toBe(true);
  });

  it('describes the date with the lead the person set', () => {
    const owned = TASK_SETTINGS_SPECS.groceryUseUp!.owned(CTX0);
    expect(owned.find(f => f.key === 'date')?.summary).toBe('3 days before the use-by date');
    const birthday = TASK_SETTINGS_SPECS.birthday!.owned(CTX0);
    expect(birthday.find(f => f.key === 'date')?.summary).toBe('On the birthday');
    const gift = TASK_SETTINGS_SPECS.birthdayGift!.owned(CTX);
    expect(gift.find(f => f.key === 'date')?.summary).toBe('When the birthday is 10 days away');
  });

  it('locks the editable row for every field the generator owns that the sheet also edits', () => {
    // A generator that writes a time of day or a question would have its
    // owned row contradict the editable one, and the fill would never apply.
    for (const spec of Object.values(TASK_SETTINGS_SPECS)) {
      const keys = spec!.owned(CTX).map(f => f.key);
      for (const lockable of ['time', 'ask'] as const) {
        if (keys.includes(lockable)) expect(spec!.locks ?? []).toContain(lockable);
      }
      // And it never claims the fields the sheet always edits.
      for (const always of ['category', 'tags', 'priority', 'effort', 'difficulty']) expect(keys).not.toContain(always);
    }
  });

  it('describes every owned field in plain copy', () => {
    for (const spec of Object.values(TASK_SETTINGS_SPECS)) {
      for (const field of spec!.owned(CTX)) {
        expect(`${field.summary} ${field.hint}`).not.toMatch(/—/);
        expect(field.summary.length).toBeGreaterThan(0);
        expect(field.hint.length).toBeGreaterThan(0);
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
