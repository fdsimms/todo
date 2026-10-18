import {
  activeSectionKey,
  scrollTargetFor,
  EditorJumpTracker,
  ACTIVE_THRESHOLD,
  JUMP_HOLD_MS,
  JUMP_PAD,
} from '../utils/editorJump';

const sections = [
  { key: 'when', y: 400 },
  { key: 'repeat', y: 900 },
  { key: 'filed', y: 1300 },
];
const at = (offset: number, content = 2000, viewport = 700) => ({ offset, content, viewport });

describe('activeSectionKey', () => {
  it('is the first card while the scroll is above it', () => {
    expect(activeSectionKey(sections, at(0))).toBe('when');
  });

  it('moves to a card once its top reaches the threshold below the scroll top', () => {
    expect(activeSectionKey(sections, at(900 - ACTIVE_THRESHOLD - 1))).toBe('when');
    expect(activeSectionKey(sections, at(900 - ACTIVE_THRESHOLD))).toBe('repeat');
  });

  it('is the last card at the very bottom, which the short last cards never reach otherwise', () => {
    expect(activeSectionKey(sections, at(1300, 2000, 700))).toBe('filed');
    expect(activeSectionKey(sections, at(1100, 1800, 700))).toBe('filed');
  });

  it('reads cards in position order, whatever order they arrive in', () => {
    expect(activeSectionKey([...sections].reverse(), at(950))).toBe('repeat');
  });

  it('is null with no cards', () => {
    expect(activeSectionKey([], at(0))).toBeNull();
  });
});

describe('scrollTargetFor', () => {
  it('leaves the pad above the target', () => {
    expect(scrollTargetFor(900, at(0))).toBe(900 - JUMP_PAD);
  });

  it('stops at the bottom of the scroll and at the top', () => {
    expect(scrollTargetFor(1900, at(0, 2000, 700))).toBe(1300);
    expect(scrollTargetFor(4, at(0))).toBe(0);
  });
});

describe('EditorJumpTracker', () => {
  const order = ['when', 'repeat', 'priority', 'filed'];

  it('lists the rendered cards in the bar’s order, and drops one that stops rendering', () => {
    const t = new EditorJumpTracker(order);
    t.setSectionY('filed', 1300);
    t.setSectionY('when', 400);
    expect(t.getSnapshot().present).toEqual(['when', 'filed']);
    t.setSectionY('filed', null);
    expect(t.getSnapshot().present).toEqual(['when']);
  });

  it('ignores a card outside its order for the bar, but can still find its rows', () => {
    const t = new EditorJumpTracker(order);
    t.setSectionY('kind', 200);
    t.setCardY('kind', 0);
    t.setRowY('kind', 'kind', 10);
    expect(t.getSnapshot().present).toEqual([]);
    expect(t.rowY('kind')).toBe(210);
  });

  it('places a row by summing its card’s top, the heading above the card, and its own top', () => {
    const t = new EditorJumpTracker(order);
    t.setSectionY('repeat', 900);
    t.setCardY('repeat', 20);
    t.setRowY('repeat', 'streak', 52);
    expect(t.rowY('streak')).toBe(972);
    t.setSectionY('repeat', 950);
    expect(t.rowY('streak')).toBe(1022);
  });

  it('has no place for a row whose card isn’t rendered', () => {
    const t = new EditorJumpTracker(order);
    t.setRowY('repeat', 'streak', 52);
    expect(t.rowY('streak')).toBeNull();
    expect(t.rowY('nothing')).toBeNull();
  });

  it('marks the cards holding a value', () => {
    const t = new EditorJumpTracker(order);
    t.setSectionY('when', 400);
    t.setSectionY('repeat', 900);
    t.setHasValue('repeat', true);
    expect(t.getSnapshot().withValue).toEqual(['repeat']);
  });

  it('follows the scroll', () => {
    const t = new EditorJumpTracker(order);
    t.setSectionY('when', 400);
    t.setSectionY('repeat', 900);
    t.setScroll(at(0));
    expect(t.getSnapshot().active).toBe('when');
    t.setScroll(at(890));
    expect(t.getSnapshot().active).toBe('repeat');
  });

  it('holds a jump’s card while the scroll passes the ones between, then follows again', () => {
    let now = 1000;
    const t = new EditorJumpTracker(order, () => now);
    t.setSectionY('when', 400);
    t.setSectionY('repeat', 900);
    t.setSectionY('filed', 1300);
    t.setScroll(at(0, 3000));
    expect(t.jumpTo('filed')).toBe(1300 - JUMP_PAD);
    t.setScroll(at(890, 3000));
    expect(t.getSnapshot().active).toBe('filed');
    now += JUMP_HOLD_MS + 1;
    t.setScroll(at(895, 3000));
    expect(t.getSnapshot().active).toBe('repeat');
  });

  it('has nowhere to jump for a card that isn’t rendered', () => {
    const t = new EditorJumpTracker(order);
    expect(t.jumpTo('filed')).toBeNull();
  });

  it('only tells its listeners when what the bar draws changes', () => {
    const t = new EditorJumpTracker(order);
    const heard = jest.fn();
    t.subscribe(heard);
    t.setSectionY('when', 400);
    t.setSectionY('repeat', 900);
    heard.mockClear();
    const before = t.getSnapshot();
    t.setScroll(at(10));
    t.setScroll(at(20));
    expect(heard).not.toHaveBeenCalled();
    expect(t.getSnapshot()).toBe(before);
    t.setScroll(at(890));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener once it unsubscribes', () => {
    const t = new EditorJumpTracker(order);
    const heard = jest.fn();
    const stop = t.subscribe(heard);
    stop();
    t.setSectionY('when', 400);
    expect(heard).not.toHaveBeenCalled();
  });
});
