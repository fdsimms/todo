import {
  CAPTURE_TITLE_MAX_LENGTH,
  MAX_REMINDER_CAPTURES,
  activeReminderCaptures,
  drainableReminderCaptures,
  captureDraftFields,
  captureListIds,
  describeReminderCaptureFiling,
  makeReminderCapture,
  parseReminderCaptures,
  serializeReminderCaptures,
} from '../utils/reminderCaptures';
import type { ReminderCapture, ReminderCaptureFiling } from '../types';

function capture(over: Partial<ReminderCapture> = {}): ReminderCapture {
  return { ...makeReminderCapture(), id: 'c1', ...over };
}

describe('makeReminderCapture', () => {
  it('starts on, undecided about a list, and deleting after import', () => {
    const fresh = makeReminderCapture();
    expect(fresh.enabled).toBe(true);
    expect(fresh.listId).toBeNull();
    expect(fresh.confirmedListId).toBeNull();
    // Matches remindersImportDelete's own default — the delete is what stops a
    // capture coming in twice.
    expect(fresh.deleteAfterImport).toBe(true);
  });

  it('gives each capture its own id', () => {
    expect(makeReminderCapture().id).not.toBe(makeReminderCapture().id);
  });
});

describe('activeReminderCaptures', () => {
  it('needs the switch, a list, and that same list confirmed', () => {
    const live = capture({ id: 'live', listId: 'L1', confirmedListId: 'L1' });
    expect(activeReminderCaptures([live])).toEqual([live]);
  });

  it('drops one that is switched off', () => {
    expect(activeReminderCaptures([
      capture({ listId: 'L1', confirmedListId: 'L1', enabled: false }),
    ])).toEqual([]);
  });

  it('drops one with no list picked yet', () => {
    expect(activeReminderCaptures([capture({ listId: null, confirmedListId: null })])).toEqual([]);
  });

  /**
   * The load-bearing one. Importing deletes the user's reminders, so a
   * confirmation answered for one list must never carry to another — and
   * changing where a capture files, or whether it deletes, clears it for the
   * same reason (the alert named both).
   */
  it('drops one whose confirmation was given for a different list', () => {
    expect(activeReminderCaptures([
      capture({ listId: 'L2', confirmedListId: 'L1' }),
    ])).toEqual([]);
  });

  it('drops one whose confirmation was cleared', () => {
    expect(activeReminderCaptures([
      capture({ listId: 'L1', confirmedListId: null }),
    ])).toEqual([]);
  });
});

describe('captureListIds', () => {
  it('names every list in use', () => {
    expect(captureListIds([
      capture({ id: 'a', listId: 'L1' }),
      capture({ id: 'b', listId: 'L2' }),
    ])).toEqual(['L1', 'L2']);
  });

  it('leaves out the capture being edited, so its own list still shows as picked', () => {
    expect(captureListIds([
      capture({ id: 'a', listId: 'L1' }),
      capture({ id: 'b', listId: 'L2' }),
    ], 'a')).toEqual(['L2']);
  });

  it('ignores captures with no list', () => {
    expect(captureListIds([capture({ id: 'a', listId: null })])).toEqual([]);
  });
});

describe('captureDraftFields', () => {
  const at = (hour: number) => new Date(2026, 8, 15, hour, 30);

  it('derives the meal from when the reminder was dictated', () => {
    expect(captureDraftFields({ kind: 'meal', slot: null }, at(8))).toEqual({ logMealSlot: 'breakfast' });
    expect(captureDraftFields({ kind: 'meal', slot: null }, at(13))).toEqual({ logMealSlot: 'lunch' });
    expect(captureDraftFields({ kind: 'meal', slot: null }, at(19))).toEqual({ logMealSlot: 'dinner' });
    expect(captureDraftFields({ kind: 'meal', slot: null }, at(23))).toEqual({ logMealSlot: 'snack' });
  });

  it('honours a pinned slot over the clock', () => {
    expect(captureDraftFields({ kind: 'meal', slot: 'dinner' }, at(8)))
      .toEqual({ logMealSlot: 'dinner' });
  });

  /**
   * The whole point of the meal arm: it stamps the field that makes a *tick*
   * raise the food log's own prompt, and writes nothing to the food log itself.
   * An entry with no nutrition figure is refused by addEntry, and one staged
   * unconfirmed would make a day read as logged to every nutrition read in the
   * app.
   */
  it('never writes a food log entry, only the offer', () => {
    const fields = captureDraftFields({ kind: 'meal', slot: null }, at(12));
    expect(Object.keys(fields)).toEqual(['logMealSlot']);
  });

  it('files into a project', () => {
    expect(captureDraftFields({ kind: 'project', projectId: 'p1' }, at(12)))
      .toEqual({ projectId: 'p1' });
  });

  it('files under a category', () => {
    expect(captureDraftFields({ kind: 'category', category: 'Home' }, at(12)))
      .toEqual({ category: 'Home' });
  });

  it('files with one tag', () => {
    expect(captureDraftFields({ kind: 'tag', tag: 'errand' }, at(12)))
      .toEqual({ tags: ['errand'] });
  });

  /**
   * Filing is not scheduling. A dated capture would put a sentence nobody has
   * read onto Today, and a project-list capture is exactly the undated running
   * list ProjectKind 'list' exists for.
   */
  it('never dates anything', () => {
    const filings: ReminderCaptureFiling[] = [
      { kind: 'meal', slot: null },
      { kind: 'project', projectId: 'p1' },
      { kind: 'category', category: 'Home' },
      { kind: 'tag', tag: 'errand' },
    ];
    for (const filing of filings) {
      const fields = captureDraftFields(filing, at(12));
      expect(fields).not.toHaveProperty('dueDate');
      expect(fields).not.toHaveProperty('deferUntil');
      expect(fields).not.toHaveProperty('deadline');
      expect(fields).not.toHaveProperty('reminderTime');
    }
  });
});

describe('parseReminderCaptures', () => {
  it('reads back what it wrote', () => {
    const captures = [
      capture({ id: 'a', title: 'Food', listId: 'L1', confirmedListId: 'L1' }),
      capture({ id: 'b', title: 'Wish list', filing: { kind: 'project', projectId: 'p1' } }),
    ];
    expect(parseReminderCaptures(serializeReminderCaptures(captures))).toEqual(captures);
  });

  it('reads nothing saved as an empty list', () => {
    expect(parseReminderCaptures(null)).toEqual([]);
    expect(parseReminderCaptures('')).toEqual([]);
    expect(parseReminderCaptures(undefined)).toEqual([]);
  });

  it('reads malformed JSON as nothing saved rather than throwing', () => {
    expect(parseReminderCaptures('{not json')).toEqual([]);
    expect(parseReminderCaptures('{"a":1}')).toEqual([]);
  });

  it('drops a bad entry rather than the whole list', () => {
    const good = capture({ id: 'a', listId: 'L1', confirmedListId: 'L1' });
    const raw = JSON.stringify([good, { id: '' }, null, 42]);
    expect(parseReminderCaptures(raw)).toEqual([good]);
  });

  /**
   * Unlike a health rule with an unknown metric, which falls back: a filing
   * that can't be read has no destination to fall back *to*, and guessing one
   * would drain somebody's list into the wrong place.
   */
  it('drops a capture whose filing cannot be read', () => {
    expect(parseReminderCaptures(JSON.stringify([
      { ...capture(), filing: { kind: 'nonsense' } },
    ]))).toEqual([]);
    expect(parseReminderCaptures(JSON.stringify([
      { ...capture(), filing: { kind: 'project' } },
    ]))).toEqual([]);
    expect(parseReminderCaptures(JSON.stringify([
      { ...capture(), filing: { kind: 'tag', tag: '' } },
    ]))).toEqual([]);
  });

  it('falls back to deriving the slot when a stored one is unrecognised', () => {
    const parsed = parseReminderCaptures(JSON.stringify([
      { ...capture(), filing: { kind: 'meal', slot: 'brunch' } },
    ]));
    expect(parsed[0].filing).toEqual({ kind: 'meal', slot: null });
  });

  it('treats a missing enabled and deleteAfterImport as on', () => {
    const parsed = parseReminderCaptures(JSON.stringify([
      { id: 'a', filing: { kind: 'meal', slot: null } },
    ]));
    expect(parsed[0].enabled).toBe(true);
    expect(parsed[0].deleteAfterImport).toBe(true);
    expect(parsed[0].title).toBe('');
  });

  it('never reads back a confirmation for a list it does not also hold', () => {
    // An empty string is how resetToDefaults clears these, so it must not come
    // back as a confirmed id.
    const parsed = parseReminderCaptures(JSON.stringify([
      { ...capture(), listId: '', confirmedListId: '' },
    ]));
    expect(parsed[0].listId).toBeNull();
    expect(parsed[0].confirmedListId).toBeNull();
    expect(activeReminderCaptures(parsed)).toEqual([]);
  });

  it('truncates an over-long title and caps the list', () => {
    const long = 'x'.repeat(CAPTURE_TITLE_MAX_LENGTH + 20);
    const many = Array.from({ length: MAX_REMINDER_CAPTURES + 4 }, (_, i) =>
      capture({ id: `c${i}`, title: long }));
    const parsed = parseReminderCaptures(JSON.stringify(many));
    expect(parsed).toHaveLength(MAX_REMINDER_CAPTURES);
    expect(parsed[0].title).toHaveLength(CAPTURE_TITLE_MAX_LENGTH);
  });
});

describe('describeReminderCaptureFiling', () => {
  it('says which meal, or that it comes from the time of day', () => {
    expect(describeReminderCaptureFiling({ kind: 'meal', slot: null }))
      .toBe('Food log, meal from the time of day');
    expect(describeReminderCaptureFiling({ kind: 'meal', slot: 'breakfast' }))
      .toBe('Food log, as breakfast');
  });

  it('names a project or category, and says so when it has gone', () => {
    expect(describeReminderCaptureFiling(
      { kind: 'project', projectId: 'p1' }, { projectName: 'Wish List' }
    )).toBe('Project: Wish List');
    expect(describeReminderCaptureFiling({ kind: 'project', projectId: 'p1' }))
      .toBe('Project (deleted)');
    expect(describeReminderCaptureFiling(
      { kind: 'category', category: 'Home' }, { categoryName: 'Home' }
    )).toBe('Category: Home');
    expect(describeReminderCaptureFiling({ kind: 'category', category: 'Home' }))
      .toBe('Category (deleted)');
  });

  it('names a tag', () => {
    expect(describeReminderCaptureFiling({ kind: 'tag', tag: 'errand' })).toBe('Tagged #errand');
  });
});

/**
 * The one predicate the drain asks twice — once for "is the import on at all",
 * once to build the targets. Those two disagreeing is a bug this feature has
 * already had: a leg the early-out counts and the builder drops reports "the
 * list you chose has gone" for a list that is sitting right there.
 */
describe('drainableReminderCaptures', () => {
  const live = (over: Partial<ReminderCapture> = {}) =>
    capture({ listId: 'L1', confirmedListId: 'L1', ...over });

  it('stands a meal capture down while the kitchen area is off', () => {
    const meal = live({ filing: { kind: 'meal', slot: null } });
    expect(drainableReminderCaptures([meal], { kitchenEnabled: true })).toEqual([meal]);
    expect(drainableReminderCaptures([meal], { kitchenEnabled: false })).toEqual([]);
  });

  it('leaves every other filing alone, since they land ordinary tasks', () => {
    const filings: ReminderCaptureFiling[] = [
      { kind: 'project', projectId: 'p1' },
      { kind: 'category', category: 'Home' },
      { kind: 'tag', tag: 'errand' },
    ];
    for (const filing of filings) {
      expect(drainableReminderCaptures([live({ filing })], { kitchenEnabled: false }))
        .toHaveLength(1);
    }
  });

  it('still applies every gate activeReminderCaptures applies', () => {
    expect(drainableReminderCaptures(
      [live({ confirmedListId: null })], { kitchenEnabled: true }
    )).toEqual([]);
    expect(drainableReminderCaptures(
      [live({ enabled: false })], { kitchenEnabled: true }
    )).toEqual([]);
  });
});
