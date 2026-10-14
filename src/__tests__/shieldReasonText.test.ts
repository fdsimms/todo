import { MAX_NAMED_GATES, selectionLabel, shieldHeadline, shieldHeadlineNote, shieldReasonLines } from '../utils/shieldReasonText';

const time = (iso: string) => (iso === 'bad' ? null : '10:30 AM');

describe('shieldReasonLines', () => {
  it('says a focus session and a key lock plainly', () => {
    expect(shieldReasonLines({ groupId: 'default', reason: 'focus' }, time)).toEqual(['A focus session is running.']);
    expect(shieldReasonLines({ groupId: 'default', reason: 'key' }, time)).toEqual(['Locked with a key tag. Tap one to unlock.']);
  });

  it('says a block the person started, with its end when there is one', () => {
    expect(shieldReasonLines({ groupId: 'default', reason: 'manual', until: '2026-10-14T15:00:00Z' }, time))
      .toEqual(['A block you started runs until 10:30 AM.']);
    expect(shieldReasonLines({ groupId: 'default', reason: 'manual', until: null }, time))
      .toEqual(['A block you started is on until you end it.']);
    expect(shieldReasonLines({ groupId: 'default', reason: 'manual', until: 'bad' }, time))
      .toEqual(['A block you started is running.']);
  });

  it('gives each gate task its own line', () => {
    expect(shieldReasonLines({ groupId: 'default', reason: 'gate', titles: ['Morning walk', 'Pay rent'] }, time))
      .toEqual(['Morning walk isn’t done yet.', 'Pay rent isn’t done yet.']);
  });

  it('collapses gate tasks past the cap into a count', () => {
    const titles = Array.from({ length: MAX_NAMED_GATES + 2 }, (_, i) => `Task ${i}`);
    const lines = shieldReasonLines({ groupId: 'default', reason: 'gate', titles }, time);
    expect(lines).toHaveLength(MAX_NAMED_GATES + 1);
    expect(lines[MAX_NAMED_GATES]).toBe('2 more tasks aren’t done yet.');
    const one = shieldReasonLines({ groupId: 'default', reason: 'gate', titles: [...titles.slice(0, MAX_NAMED_GATES), 'Last'] }, time);
    expect(one[MAX_NAMED_GATES]).toBe('1 more task isn’t done yet.');
  });

  it('still speaks when a gate has no usable title', () => {
    expect(shieldReasonLines({ groupId: 'default', reason: 'gate', titles: ['  '] }, time)).toEqual(['A task has to be done first.']);
    expect(shieldReasonLines({ groupId: 'default', reason: 'gate' }, time)).toEqual(['A task has to be done first.']);
  });

  it('names the failed task and when the block ends, whichever it knows', () => {
    expect(shieldReasonLines({ groupId: 'default', reason: 'penalty', until: 'x', cause: 'Pay rent' }, time))
      .toEqual(['Pay rent wasn’t done in time. Blocked until 10:30 AM.']);
    expect(shieldReasonLines({ groupId: 'default', reason: 'penalty', until: 'x', cause: null }, time))
      .toEqual(['A task wasn’t done in time. Blocked until 10:30 AM.']);
    expect(shieldReasonLines({ groupId: 'default', reason: 'penalty', until: 'bad', cause: 'Pay rent' }, time))
      .toEqual(['Pay rent wasn’t done in time.']);
    expect(shieldReasonLines({ groupId: 'default', reason: 'penalty', until: null, cause: '  ' }, time))
      .toEqual(['A task wasn’t done in time.']);
  });
});

describe('the headline', () => {
  it('says nothing is blocking when no reason holds', () => {
    expect(shieldHeadline(0, 3)).toBe('Nothing is blocking your apps');
    expect(shieldHeadline(0, 0)).toBe('Nothing is blocking your apps');
  });

  it('claims a block only when apps are chosen to block', () => {
    expect(shieldHeadline(2, 3)).toBe('Your apps are blocked');
    expect(shieldHeadline(2, 0)).toBe('No apps are chosen to block');
  });

  it('adds the note that fits', () => {
    expect(shieldHeadlineNote(0, 0)).toMatch(/Choose apps/);
    expect(shieldHeadlineNote(1, 0)).toMatch(/nothing to block/);
    expect(shieldHeadlineNote(1, 2)).toMatch(/key tag or the emergency button ends them/);
    expect(shieldHeadlineNote(0, 2)).toBeNull();
  });
});

describe('selectionLabel', () => {
  it('counts apps and categories, singular and plural', () => {
    expect(selectionLabel(0, 0)).toBe('None');
    expect(selectionLabel(1, 0)).toBe('1 app');
    expect(selectionLabel(3, 1)).toBe('3 apps, 1 category');
    expect(selectionLabel(0, 2)).toBe('2 categories');
  });
});
