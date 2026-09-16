import {
  WHEEL_DEAD_ZONE,
  addWheelRoute,
  moveWheelRoute,
  removeWheelRoute,
  WHEEL_MAX_SLOTS,
  clampLabelX,
  wheelGeometry,
  wheelPoint,
  wheelSlotAngles,
  wheelSlotAt,
  wheelStep,
  wheelWedgePath,
} from '../utils/featureWheel';

/** A point `distance` away from the anchor at `angle` degrees clockwise from up. */
function offsetAt(angle: number, distance: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [distance * Math.sin(rad), -distance * Math.cos(rad)];
}

describe('wheelSlotAngles', () => {
  it('opens to the left by default, starting near vertical', () => {
    expect(wheelSlotAngles(6, true)).toEqual([-2, -16, -30, -44, -58, -72]);
  });

  it('mirrors for an anchor on the left edge', () => {
    expect(wheelSlotAngles(6, false)).toEqual([2, 16, 30, 44, 58, 72]);
  });

  it('spreads a shorter fan across the same sweep, so directions stay distinct', () => {
    expect(wheelSlotAngles(3, true)).toEqual([-2, -37, -72]);
    expect(wheelSlotAngles(2, true)).toEqual([-2, -72]);
  });

  it('puts a lone slot at the near end rather than the middle', () => {
    expect(wheelSlotAngles(1, true)).toEqual([-2]);
  });

  it('has nothing to place for an empty fan', () => {
    expect(wheelSlotAngles(0, true)).toEqual([]);
    expect(wheelStep(0)).toBe(0);
    expect(wheelStep(1)).toBe(0);
  });
});

describe('wheelSlotAt', () => {
  const COUNT = 6;

  it('selects nothing inside the dead zone, however well aimed', () => {
    for (const angle of [-2, -30, -72]) {
      const [dx, dy] = offsetAt(angle, WHEEL_DEAD_ZONE - 1);
      expect(wheelSlotAt(dx, dy, COUNT, true)).toBeNull();
    }
  });

  it('selects the slot the finger is aimed at, once past the dead zone', () => {
    wheelSlotAngles(COUNT, true).forEach((angle, index) => {
      const [dx, dy] = offsetAt(angle, WHEEL_DEAD_ZONE + 1);
      expect(wheelSlotAt(dx, dy, COUNT, true)).toBe(index);
    });
  });

  it('is distance-independent past the dead zone — angle is the whole input', () => {
    const angle = wheelSlotAngles(COUNT, true)[3];
    for (const distance of [70, 120, 250, 600]) {
      const [dx, dy] = offsetAt(angle, distance);
      expect(wheelSlotAt(dx, dy, COUNT, true)).toBe(3);
    }
  });

  it('gives each slot the half-step either side of its own ray', () => {
    const [dx, dy] = offsetAt(-30 + 6, 140); // 6 degrees off slot 2, step is 14
    expect(wheelSlotAt(dx, dy, COUNT, true)).toBe(2);
  });

  it('absorbs overshoot past the first and last slots', () => {
    // Straight up is 2 degrees beyond slot 0, and straight left 18 beyond slot 5.
    expect(wheelSlotAt(...offsetAt(0, 200), COUNT, true)).toBe(0);
    expect(wheelSlotAt(...offsetAt(-90, 200), COUNT, true)).toBe(COUNT - 1);
  });

  it('stops absorbing where the fan plainly does not reach', () => {
    // Out towards the corner the hand came from, and straight down.
    expect(wheelSlotAt(...offsetAt(90, 200), COUNT, true)).toBeNull();
    expect(wheelSlotAt(...offsetAt(180, 200), COUNT, true)).toBeNull();
    expect(wheelSlotAt(...offsetAt(-150, 200), COUNT, true)).toBeNull();
  });

  it('mirrors cleanly for a left-edge anchor', () => {
    wheelSlotAngles(COUNT, false).forEach((angle, index) => {
      const [dx, dy] = offsetAt(angle, 150);
      expect(wheelSlotAt(dx, dy, COUNT, false)).toBe(index);
    });
    // The same gesture against the other side selects nothing.
    expect(wheelSlotAt(...offsetAt(-44, 150), COUNT, false)).toBeNull();
  });

  it('gives a lone slot the whole reachable arc', () => {
    for (const angle of [-2, -40, -72]) {
      expect(wheelSlotAt(...offsetAt(angle, 150), 1, true)).toBe(0);
    }
  });

  it('selects nothing when the fan is empty', () => {
    expect(wheelSlotAt(...offsetAt(-30, 150), 0, true)).toBeNull();
  });

  it('honours a caller-supplied dead zone', () => {
    const [dx, dy] = offsetAt(-30, 90);
    expect(wheelSlotAt(dx, dy, COUNT, true, 40)).toBe(2);
    expect(wheelSlotAt(dx, dy, COUNT, true, 120)).toBeNull();
  });

  it('keeps adjacent slots at least 24pt apart at a comfortable release radius', () => {
    // The precision claim `WHEEL_MAX_SLOTS` rests on: at the distance a flick
    // actually reaches, neighbouring sectors have to be a real target apart.
    const releaseRadius = 118;
    const arc = (wheelStep(WHEEL_MAX_SLOTS) * Math.PI / 180) * releaseRadius;
    expect(arc).toBeGreaterThan(24);
  });
});

describe('wheelGeometry', () => {
  it('orders the radii outwards from the dead zone, with the wedge tucked short of the chip', () => {
    const g = wheelGeometry(390);
    expect(g.dead).toBe(WHEEL_DEAD_ZONE);
    expect(g.chip).toBeGreaterThan(g.dead);
    // The wedge's outer radius sits just inside the chip's own, so the chip's
    // circle covers the wedge's corners rather than the wedge poking past it
    // — see the comment above `wheelGeometry`'s return.
    expect(g.outer).toBeLessThan(g.chip);
    expect(g.outer).toBeGreaterThan(g.dead);
    expect(g.label).toBeGreaterThan(g.chip);
  });

  it('scales with the screen, clamped at both ends', () => {
    expect(wheelGeometry(390).chip).toBe(250);
    expect(wheelGeometry(320).chip).toBe(205);
    // A very narrow screen keeps a usable arc rather than collapsing it.
    expect(wheelGeometry(200).chip).toBe(190);
    // A very wide one stops growing rather than running off the far edge.
    expect(wheelGeometry(1024).chip).toBe(260);
  });

  it('keeps the far end of the arc clear of a tab bar at the anchor', () => {
    // The last slot sits SWEEP_FAR off vertical, so its height above the
    // anchor is what has to clear the bar the anchor is in.
    const { chip } = wheelGeometry(390);
    const lastAngle = wheelSlotAngles(6, true)[5];
    const { y } = wheelPoint(341, 736, chip, lastAngle);
    expect(736 - y).toBeGreaterThan(60);
  });
});

describe('wheelPoint', () => {
  it('puts zero degrees straight up and negative degrees to the left', () => {
    expect(wheelPoint(100, 100, 50, 0)).toEqual({ x: 100, y: 50 });
    const left = wheelPoint(100, 100, 50, -90);
    expect(left.x).toBeCloseTo(50);
    expect(left.y).toBeCloseTo(100);
  });
});

describe('wheelWedgePath', () => {
  it('draws a closed annular sector', () => {
    const d = wheelWedgePath(341, 736, 64, 288, -23, -37);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // Out along one edge, round the outer arc, in, and back round the inner one.
    expect(d.match(/A/g)).toHaveLength(2);
  });

  it('reverses the sweep flag with the direction, so the two arcs close', () => {
    expect(wheelWedgePath(0, 0, 10, 20, -10, 10)).toContain('A20 20 0 0 1');
    expect(wheelWedgePath(0, 0, 10, 20, 10, -10)).toContain('A20 20 0 0 0');
  });

  it('leaves the sector sharp-cornered when no corner radius is given', () => {
    const d = wheelWedgePath(0, 0, 10, 20, -10, 10);
    expect(d).not.toContain('Q');
  });

  describe('with a corner radius', () => {
    it('fillets the two outer corners with a Q curve on each, still closing the path', () => {
      const d = wheelWedgePath(0, 0, 10, 20, -10, 10, 4);
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
      expect(d.match(/Q/g)).toHaveLength(2);
      // Still one outer arc and one inner arc, same as the unrounded path.
      expect(d.match(/A/g)).toHaveLength(2);
    });

    it('leaves the inner corners alone', () => {
      const sharp = wheelWedgePath(0, 0, 10, 20, -10, 10);
      const rounded = wheelWedgePath(0, 0, 10, 20, -10, 10, 4);
      // Both paths still open and close on the same inner-radius point.
      const start = sharp.split(' ')[0];
      expect(rounded.startsWith(start)).toBe(true);
    });
  });
});

describe('clampLabelX', () => {
  it('leaves a label that already fits where its ray put it', () => {
    expect(clampLabelX(200, 48, 390)).toBe(200);
  });

  it('pulls a label back inside either edge', () => {
    expect(clampLabelX(370, 48, 390)).toBe(330);
    expect(clampLabelX(10, 48, 390)).toBe(60);
  });

  it('centres a label too wide to fit rather than picking an edge', () => {
    expect(clampLabelX(10, 300, 390)).toBe(195);
  });
});

describe('editing the wheel’s routes', () => {
  it('moves a route a step in either direction', () => {
    expect(moveWheelRoute(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveWheelRoute(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
  });

  it('identity-returns a move that cannot happen, so the caller can skip the write', () => {
    const routes = ['a', 'b', 'c'];
    expect(moveWheelRoute(routes, 'a', -1)).toBe(routes);
    expect(moveWheelRoute(routes, 'c', 1)).toBe(routes);
    expect(moveWheelRoute(routes, 'zz', -1)).toBe(routes);
  });

  it('appends a route, and identity-returns a duplicate or a full fan', () => {
    expect(addWheelRoute(['a'], 'b', 6)).toEqual(['a', 'b']);
    const dup = ['a', 'b'];
    expect(addWheelRoute(dup, 'b', 6)).toBe(dup);
    const full = ['a', 'b', 'c'];
    expect(addWheelRoute(full, 'd', 3)).toBe(full);
  });

  it('removes a route, and identity-returns one that was never on', () => {
    expect(removeWheelRoute(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    const routes = ['a', 'b'];
    expect(removeWheelRoute(routes, 'zz')).toBe(routes);
  });

  it('defaults the cap to the geometry’s own limit', () => {
    const full = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(full).toHaveLength(WHEEL_MAX_SLOTS);
    expect(addWheelRoute(full, 'g')).toBe(full);
  });
});

describe('wheelGeometry with a cramped anchor', () => {
  it('shrinks the arc to the room the fan opens into', () => {
    // A middle tab on a 390pt screen has about 244pt to sweep into.
    expect(wheelGeometry(390, 244).chip).toBeLessThan(wheelGeometry(390).chip);
  });

  it('keeps the far slot on screen from a middle anchor', () => {
    const anchorX = 146; // the Groceries tab, second of four
    const available = 390 - anchorX;
    const { chip } = wheelGeometry(390, available);
    const far = wheelSlotAngles(6, false)[5];
    const { x } = wheelPoint(anchorX, 700, chip, far);
    expect(x + 29).toBeLessThan(390);
  });

  it('still takes the full arc when the anchor has a whole screen beside it', () => {
    expect(wheelGeometry(390, 341).chip).toBe(250);
  });

  it('never shrinks below the label-collision floor, however cramped', () => {
    expect(wheelGeometry(390, 60).chip).toBe(190);
  });
});
