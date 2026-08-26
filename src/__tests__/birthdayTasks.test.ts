import type { Person, Task } from '../types';
import {
  birthdayDrift,
  birthdayGiftDrift,
  birthdayGiftTitle,
  birthdayInYear,
  birthdaySourceId,
  birthdayTitle,
  clampBirthdayLeadDays,
  clampBirthdayGiftLeadDays,
  hasBirthday,
  nextBirthday,
  parseBirthdayLeadDays,
  parseBirthdayGiftLeadDays,
  parseBirthdaySource,
  parseBirthdayGiftSource,
  personLinkUrl,
  staleBirthdayTasks,
  staleBirthdayGiftTasks,
  wantedBirthdayTasks,
  wantedBirthdayGiftTasks,
  DEFAULT_BIRTHDAY_LEAD_DAYS,
  DEFAULT_BIRTHDAY_GIFT_LEAD_DAYS,
  MAX_BIRTHDAY_LEAD_DAYS,
} from '../utils/birthdayTasks';

const person = (overrides: Partial<Person> = {}): Person => ({
  id: 'p1',
  name: 'Ansley',
  nickname: '',
  notes: '',
  sortOrder: 1,
  archived: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  birthdayMonth: 3,
  birthdayDay: 14,
  birthYear: null,
  birthdayTaskOptOut: false,
  birthdayGiftTaskOptOut: false,
  phoneNumber: null,
  email: null,
  linkUrl: null,
  cadenceDays: 0,
  nudgeOptIn: false,
  cadenceSetAt: null,
  reachOutDeclinedAt: null,
  askAbout: '',
  backfillDismissedFields: [],
  ...overrides,
});

const genTask = (
  overrides: Partial<Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived' | 'deadline'>> = {}
) => ({
  generatedKind: 'birthday' as const,
  generatedSourceId: 'p1#2026',
  completed: false,
  archived: false,
  deadline: null,
  ...overrides,
});

// Noon, matching what the module itself produces, so a comparison isn't
// accidentally testing the time of day.
const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0);

describe('the lead time', () => {
  it('defaults when handed something that isn\'t a number', () => {
    expect(clampBirthdayLeadDays(NaN)).toBe(DEFAULT_BIRTHDAY_LEAD_DAYS);
  });

  it('allows zero, which means "on the day"', () => {
    expect(clampBirthdayLeadDays(0)).toBe(0);
  });

  it('refuses a negative, which would date the row after the birthday', () => {
    expect(clampBirthdayLeadDays(-5)).toBe(0);
  });

  it('caps at a month, past which the row is furniture', () => {
    expect(clampBirthdayLeadDays(400)).toBe(MAX_BIRTHDAY_LEAD_DAYS);
  });

  // Number(null) and Number('') are 0, not NaN, so a clamp alone reads "never
  // stored" as a deliberate zero — and every install that had not touched the
  // setting would get its birthday tasks on the morning of the birthday.
  it('reads a missing stored value as the default, not as zero', () => {
    expect(parseBirthdayLeadDays(null)).toBe(DEFAULT_BIRTHDAY_LEAD_DAYS);
    expect(parseBirthdayLeadDays(undefined)).toBe(DEFAULT_BIRTHDAY_LEAD_DAYS);
    expect(parseBirthdayLeadDays('')).toBe(DEFAULT_BIRTHDAY_LEAD_DAYS);
    expect(parseBirthdayLeadDays('   ')).toBe(DEFAULT_BIRTHDAY_LEAD_DAYS);
  });

  it('still honours a stored zero, which is a real answer somebody chose', () => {
    expect(parseBirthdayLeadDays('0')).toBe(0);
  });

  it('reads a stored value back', () => {
    expect(parseBirthdayLeadDays('7')).toBe(7);
  });
});

describe('the source id', () => {
  it('round-trips the person and the year', () => {
    expect(parseBirthdaySource(genTask({ generatedSourceId: birthdaySourceId('abc', 2026) })))
      .toEqual({ personId: 'abc', year: 2026 });
  });

  it('carries the year, so next year gets its own task rather than being blocked by this year\'s', () => {
    expect(birthdaySourceId('abc', 2026)).not.toBe(birthdaySourceId('abc', 2027));
  });

  it('reads nothing off another generator\'s source id', () => {
    expect(parseBirthdaySource({ generatedKind: 'projectReview', generatedSourceId: 'abc#2026' })).toBeNull();
  });

  it('refuses a malformed id rather than inventing a year', () => {
    expect(parseBirthdaySource(genTask({ generatedSourceId: 'nohash' }))).toBeNull();
    expect(parseBirthdaySource(genTask({ generatedSourceId: 'abc#notayear' }))).toBeNull();
    expect(parseBirthdaySource(genTask({ generatedSourceId: '#2026' }))).toBeNull();
  });
});

describe('a birthday on the calendar', () => {
  it('needs both halves', () => {
    expect(hasBirthday(person())).toBe(true);
    expect(hasBirthday(person({ birthdayMonth: null }))).toBe(false);
    expect(hasBirthday(person({ birthdayDay: null }))).toBe(false);
  });

  it('lands on the day the user typed', () => {
    expect(birthdayInYear(person(), 2026)).toEqual(noon(2026, 3, 14));
  });

  it('is at noon, so it cannot slip into the previous logical day', () => {
    expect(birthdayInYear(person(), 2026)!.getHours()).toBe(12);
  });

  it('clamps February 29 to the 28th in a common year', () => {
    const leapling = person({ birthdayMonth: 2, birthdayDay: 29 });
    expect(birthdayInYear(leapling, 2027)).toEqual(noon(2027, 2, 28));
  });

  it('gives a leapling their real date in a leap year', () => {
    const leapling = person({ birthdayMonth: 2, birthdayDay: 29 });
    expect(birthdayInYear(leapling, 2028)).toEqual(noon(2028, 2, 29));
  });

  // The whole reason Person stores a month and a day rather than a date: a
  // stored date clamped once feeds the next clamp, which is the drift
  // recurrenceAnchorDay exists to undo one shelf over. Anchoring to the typed
  // numbers makes it structurally impossible, so this is the test that matters.
  it('never accumulates the clamp across years', () => {
    const leapling = person({ birthdayMonth: 2, birthdayDay: 29 });
    expect(birthdayInYear(leapling, 2027)).toEqual(noon(2027, 2, 28));
    expect(birthdayInYear(leapling, 2028)).toEqual(noon(2028, 2, 29));
    expect(birthdayInYear(leapling, 2029)).toEqual(noon(2029, 2, 28));
    expect(birthdayInYear(leapling, 2032)).toEqual(noon(2032, 2, 29));
  });

  it('has none for a person with no birthday on file', () => {
    expect(birthdayInYear(person({ birthdayMonth: null, birthdayDay: null }), 2026)).toBeNull();
  });
});

describe('when it next comes round', () => {
  it('is later this year when it hasn\'t happened yet', () => {
    expect(nextBirthday(person(), noon(2026, 1, 5))).toEqual(noon(2026, 3, 14));
  });

  it('counts the day itself as still to come, which is when it matters most', () => {
    expect(nextBirthday(person(), noon(2026, 3, 14))).toEqual(noon(2026, 3, 14));
  });

  it('rolls to next year once it has passed', () => {
    expect(nextBirthday(person(), noon(2026, 6, 1))).toEqual(noon(2027, 3, 14));
  });

  it("ignores birthYear entirely — it's never read to place or age this task", () => {
    const withYear = person({ birthYear: 1992 });
    expect(nextBirthday(withYear, noon(2026, 1, 5))).toEqual(nextBirthday(person(), noon(2026, 1, 5)));
  });
});

describe('the title', () => {
  it('names whose birthday it is', () => {
    expect(birthdayTitle(person())).toBe("Ansley's birthday");
  });

  it('prefers what you actually call them', () => {
    expect(birthdayTitle(person({ name: 'Ansley Brown', nickname: 'Ans' }))).toBe("Ans's birthday");
  });

  it("keeps the American 's after a name ending in s", () => {
    expect(birthdayTitle(person({ name: 'Chris' }))).toBe("Chris's birthday");
  });
});

describe('who wants a task right now', () => {
  const lead = 3;

  it('says nobody while the birthday is outside the window', () => {
    expect(wantedBirthdayTasks([person()], lead, noon(2026, 3, 1))).toEqual([]);
  });

  it('offers one the day the window opens', () => {
    const wants = wantedBirthdayTasks([person()], lead, noon(2026, 3, 11));
    expect(wants).toHaveLength(1);
    expect(wants[0].title).toBe("Ansley's birthday");
    expect(wants[0].deadline).toEqual(noon(2026, 3, 14));
  });

  it('is still offering it on the day itself', () => {
    expect(wantedBirthdayTasks([person()], lead, noon(2026, 3, 14))).toHaveLength(1);
  });

  it('stops the day after', () => {
    expect(wantedBirthdayTasks([person()], lead, noon(2026, 3, 15))).toEqual([]);
  });

  // Dating it backwards from the birthday would put it in the past whenever the
  // app wasn't opened on the exact day the window opened, and isTaskVisible
  // renders a past date as overdue — for a birthday that hasn't happened.
  it('dates the row today, not backwards from the birthday', () => {
    const wants = wantedBirthdayTasks([person()], lead, noon(2026, 3, 13));
    expect(wants[0].dueDate).toEqual(noon(2026, 3, 13));
  });

  it('carries the number, so the row\'s own call and text buttons work', () => {
    const wants = wantedBirthdayTasks([person({ phoneNumber: '555 123 4567' })], lead, noon(2026, 3, 13));
    expect(wants[0].phoneNumber).toBe('555 123 4567');
  });

  it('skips somebody with no birthday on file', () => {
    expect(wantedBirthdayTasks([person({ birthdayMonth: null, birthdayDay: null })], lead, noon(2026, 3, 13)))
      .toEqual([]);
  });

  it('skips somebody filed away', () => {
    expect(wantedBirthdayTasks([person({ archived: true })], lead, noon(2026, 3, 13))).toEqual([]);
  });

  it('honours the per-person opt-out, which is permanent here', () => {
    expect(wantedBirthdayTasks([person({ birthdayTaskOptOut: true })], lead, noon(2026, 3, 13))).toEqual([]);
  });

  // No cap, deliberately, unlike every other generator: dropping one would be
  // the app deciding which friend matters least. See the note on the function.
  it('offers one for everybody born in the same week rather than capping', () => {
    const people = [
      person({ id: 'a', name: 'A', birthdayMonth: 3, birthdayDay: 14 }),
      person({ id: 'b', name: 'B', birthdayMonth: 3, birthdayDay: 13 }),
      person({ id: 'c', name: 'C', birthdayMonth: 3, birthdayDay: 15 }),
      person({ id: 'd', name: 'D', birthdayMonth: 3, birthdayDay: 15 }),
    ];
    const wants = wantedBirthdayTasks(people, 5, noon(2026, 3, 12));
    expect(wants).toHaveLength(4);
  });

  it('puts the soonest birthday first', () => {
    const people = [
      person({ id: 'a', name: 'A', birthdayMonth: 3, birthdayDay: 15 }),
      person({ id: 'b', name: 'B', birthdayMonth: 3, birthdayDay: 13 }),
    ];
    const wants = wantedBirthdayTasks(people, 5, noon(2026, 3, 12));
    expect(wants.map(w => w.personId)).toEqual(['b', 'a']);
  });

  it('rolls into next year across the turn', () => {
    const nye = person({ birthdayMonth: 1, birthdayDay: 2 });
    const wants = wantedBirthdayTasks([nye], lead, noon(2026, 12, 31));
    expect(wants).toHaveLength(1);
    expect(wants[0].deadline).toEqual(noon(2027, 1, 2));
    expect(wants[0].sourceId).toBe(birthdaySourceId('p1', 2027));
  });
});

describe('the rows whose reason has gone', () => {
  it('clears one nobody wants any more', () => {
    const live = genTask({ generatedSourceId: 'p1#2026' });
    expect(staleBirthdayTasks([live], [])).toEqual([live]);
  });

  it('leaves a row that is still wanted alone', () => {
    const live = genTask({ generatedSourceId: 'p1#2026' });
    const wants = wantedBirthdayTasks([person()], 3, noon(2026, 3, 13));
    expect(staleBirthdayTasks([live], wants)).toEqual([]);
  });

  it('clears last year\'s row once this year\'s is the wanted one', () => {
    const lastYear = genTask({ generatedSourceId: 'p1#2025' });
    const wants = wantedBirthdayTasks([person()], 3, noon(2026, 3, 13));
    expect(staleBirthdayTasks([lastYear], wants)).toEqual([lastYear]);
  });

  it('ignores completed and archived rows, which are history', () => {
    const done = genTask({ completed: true });
    const filed = genTask({ archived: true });
    expect(staleBirthdayTasks([done, filed], [])).toEqual([]);
  });

  it('ignores another generator\'s tasks entirely', () => {
    const other = genTask({ generatedKind: 'projectReview', generatedSourceId: 'p1' });
    expect(staleBirthdayTasks([other], [])).toEqual([]);
  });
});

describe('chasing the date', () => {
  const want = wantedBirthdayTasks([person()], 3, noon(2026, 3, 13))[0];

  // The rule docs/arch/generated-tasks.md states for every generator: a
  // reconcile that recomputes a date from anything but its source silently
  // overwrites the field the user is most likely to have changed by hand.
  it('leaves a row alone when the birthday has not moved', () => {
    expect(birthdayDrift({ deadline: noon(2026, 3, 14).toISOString() }, want)).toBeNull();
  });

  it('does not care what time of day the stored deadline is', () => {
    expect(birthdayDrift({ deadline: new Date(2026, 2, 14, 6, 30).toISOString() }, want)).toBeNull();
  });

  it('moves the row when the birthday itself was corrected', () => {
    const drift = birthdayDrift({ deadline: noon(2026, 3, 20).toISOString() }, want);
    expect(drift).not.toBeNull();
    expect(new Date(drift!.deadline)).toEqual(noon(2026, 3, 14));
  });

  it('fills in a deadline that was never there', () => {
    expect(birthdayDrift({ deadline: null }, want)).not.toBeNull();
  });
});

describe('the link', () => {
  it('scopes to the person', () => {
    expect(personLinkUrl('abc')).toBe('dundundun://people?person=abc');
  });

  it('falls back to the bare list rather than minting a link to nobody', () => {
    expect(personLinkUrl('')).toBe('dundundun://people');
  });
});

describe('the gift task', () => {
  it('has its own, longer default lead time', () => {
    expect(DEFAULT_BIRTHDAY_GIFT_LEAD_DAYS).toBeGreaterThan(DEFAULT_BIRTHDAY_LEAD_DAYS);
    expect(clampBirthdayGiftLeadDays(NaN)).toBe(DEFAULT_BIRTHDAY_GIFT_LEAD_DAYS);
    expect(parseBirthdayGiftLeadDays(null)).toBe(DEFAULT_BIRTHDAY_GIFT_LEAD_DAYS);
    expect(parseBirthdayGiftLeadDays('0')).toBe(0);
    expect(parseBirthdayGiftLeadDays('12')).toBe(12);
  });

  it('shares the source id shape with the reminder, scoped apart by kind', () => {
    const sourceId = birthdaySourceId('abc', 2026);
    expect(parseBirthdayGiftSource(genTask({ generatedKind: 'birthdayGift', generatedSourceId: sourceId })))
      .toEqual({ personId: 'abc', year: 2026 });
    // A birthday task carrying the identical string isn't read as a gift task.
    expect(parseBirthdayGiftSource(genTask({ generatedKind: 'birthday', generatedSourceId: sourceId })))
      .toBeNull();
  });

  it('names the action, unlike the reminder', () => {
    expect(birthdayGiftTitle(person())).toBe("Get Ansley's birthday gift");
  });

  describe('who wants one right now', () => {
    const lead = 10;

    it('offers one inside the window', () => {
      const wants = wantedBirthdayGiftTasks([person()], lead, noon(2026, 3, 6));
      expect(wants).toHaveLength(1);
      expect(wants[0].title).toBe("Get Ansley's birthday gift");
      expect(wants[0].deadline).toEqual(noon(2026, 3, 14));
    });

    it('says nobody outside the window', () => {
      expect(wantedBirthdayGiftTasks([person()], lead, noon(2026, 3, 1))).toEqual([]);
    });

    it('honours the reminder opt-out too — not wanting to be told rules out shopping for it', () => {
      expect(wantedBirthdayGiftTasks([person({ birthdayTaskOptOut: true })], lead, noon(2026, 3, 6)))
        .toEqual([]);
    });

    it('honours its own, narrower opt-out', () => {
      expect(wantedBirthdayGiftTasks([person({ birthdayGiftTaskOptOut: true })], lead, noon(2026, 3, 6)))
        .toEqual([]);
    });

    it('carries no cap, same as the reminder', () => {
      const people = [
        person({ id: 'a', name: 'A', birthdayMonth: 3, birthdayDay: 14 }),
        person({ id: 'b', name: 'B', birthdayMonth: 3, birthdayDay: 15 }),
      ];
      expect(wantedBirthdayGiftTasks(people, lead, noon(2026, 3, 10))).toHaveLength(2);
    });
  });

  describe('the rows whose reason has gone', () => {
    it('clears one nobody wants any more', () => {
      const live = genTask({ generatedKind: 'birthdayGift', generatedSourceId: 'p1#2026' });
      expect(staleBirthdayGiftTasks([live], [])).toEqual([live]);
    });

    it('leaves a row that is still wanted alone', () => {
      const live = genTask({ generatedKind: 'birthdayGift', generatedSourceId: 'p1#2026' });
      const wants = wantedBirthdayGiftTasks([person()], 10, noon(2026, 3, 6));
      expect(staleBirthdayGiftTasks([live], wants)).toEqual([]);
    });

    it("ignores the reminder's own tasks, despite sharing the source id shape", () => {
      const reminder = genTask({ generatedKind: 'birthday', generatedSourceId: 'p1#2026' });
      expect(staleBirthdayGiftTasks([reminder], [])).toEqual([]);
    });
  });

  describe('chasing the date', () => {
    const want = wantedBirthdayGiftTasks([person()], 10, noon(2026, 3, 6))[0];

    it('leaves a row alone when the birthday has not moved', () => {
      expect(birthdayGiftDrift({ deadline: noon(2026, 3, 14).toISOString() }, want)).toBeNull();
    });

    it('moves the row when the birthday itself was corrected', () => {
      const drift = birthdayGiftDrift({ deadline: noon(2026, 3, 20).toISOString() }, want);
      expect(drift).not.toBeNull();
      expect(new Date(drift!.deadline)).toEqual(noon(2026, 3, 14));
    });
  });
});
