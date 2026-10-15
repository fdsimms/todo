import { nextSwipeArm, swipeArmDistance } from '@/utils/swipeArm';

const BOTH = { left: true, right: true };
const ARM = 80;
const HYST = 8;

describe('swipeArmDistance', () => {
  it('is half the panel in row travel, scaled back up to finger travel by the friction', () => {
    expect(swipeArmDistance(80, 2)).toBe(80);
    expect(swipeArmDistance(80, 1)).toBe(40);
  });
});

describe('nextSwipeArm', () => {
  it('stays disarmed short of the line', () => {
    expect(nextSwipeArm(false, -79, BOTH, ARM, HYST)).toBe(false);
    expect(nextSwipeArm(false, 79, BOTH, ARM, HYST)).toBe(false);
  });

  it('arms at the line in either direction', () => {
    expect(nextSwipeArm(false, -80, BOTH, ARM, HYST)).toBe(true);
    expect(nextSwipeArm(false, 120, BOTH, ARM, HYST)).toBe(true);
  });

  it('holds while the finger rests just behind the line, so it does not buzz', () => {
    expect(nextSwipeArm(true, -75, BOTH, ARM, HYST)).toBe(true);
    expect(nextSwipeArm(true, -72, BOTH, ARM, HYST)).toBe(true);
  });

  it('disarms once the finger comes back past the hysteresis', () => {
    expect(nextSwipeArm(true, -71, BOTH, ARM, HYST)).toBe(false);
  });

  it('never arms toward a side with no panel', () => {
    expect(nextSwipeArm(false, 200, { left: false, right: true }, ARM, HYST)).toBe(false);
    expect(nextSwipeArm(false, -200, { left: true, right: false }, ARM, HYST)).toBe(false);
  });

  it('drops an armed swipe that crosses back over to the other side', () => {
    expect(nextSwipeArm(true, 90, { left: false, right: true }, ARM, HYST)).toBe(false);
    expect(nextSwipeArm(true, 0, BOTH, ARM, HYST)).toBe(false);
  });
});
