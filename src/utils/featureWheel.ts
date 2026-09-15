/**
 * The feature wheel: geometry and hit-testing for the radial selector that
 * blooms out of the More tab.
 *
 * It is a "weapon wheel" in the game sense — hold, flick in a direction,
 * release — with one adaptation that reshapes the whole idea, and it is worth
 * writing down because the obvious version does not survive contact with a
 * phone.
 *
 * **A full 360° ring cannot be placed.** Centred on screen it is ~440pt from a
 * thumb resting on the tab bar, which is well outside the arc a thumb sweeps
 * without the hand re-gripping; centred on the touch instead, six of its eight
 * wedges land off-screen or under the tab bar, because the touch is in a
 * corner. So this is a **fan**, not a wheel: a single arc sweeping up and to
 * the left from the anchor, which is the shape a right thumb pivoting at the
 * base of the palm actually traces.
 *
 * **Selection is by angle, never by distance.** A slot owns its entire angular
 * sector from the dead zone outwards, so the finger only has to cross
 * `WHEEL_DEAD_ZONE` in the right direction — it never travels to the chip the
 * icon is drawn on. That is the property the whole thing is for: every option
 * is the same (short) distance away, and after a week the direction is muscle
 * memory and nobody reads the labels. It also means the chips can sit far out
 * where their labels fit, which is the only reason six of them fit at all.
 *
 * **Precision comes from how far you move, which is what caps the slot count.**
 * At the ~118pt release radius a comfortable flick reaches, a 14° sector is
 * about 29pt of arc — a normal-sized target. Squeeze eight slots into the same
 * reachable 70° and they are 10° each, about 21pt, and adjacent options start
 * getting picked by accident. Hence `WHEEL_MAX_SLOTS`. The wheel is therefore
 * a *loadout* rather than a menu — the handful of screens somebody lives in,
 * with `SideMenuDrawer` still the complete index behind a plain tap. That is
 * also how the wheel works in the games this is taken from: it holds what you
 * have equipped, not everything you own.
 *
 * Every length here is in points and scales with the screen (`wheelGeometry`),
 * since the radii were chosen against a 390pt-wide device and a 250pt arc on a
 * 320pt phone would run off both edges.
 */

/**
 * The most slots the reachable arc can separate reliably. See the precision
 * note above: this is a property of the geometry, not a product decision, so
 * raising it means widening the sweep or moving the anchor, not editing this
 * number.
 */
export const WHEEL_MAX_SLOTS = 6;

/**
 * How far the finger must travel before anything is selected. Everything
 * inside this radius means "no slot", which is how a gesture is abandoned:
 * let go without committing, or drag back in and let go.
 *
 * It is also the precision control. A bigger dead zone means the same angular
 * sector is a wider target in points, so this is the number to raise if slots
 * are being mis-picked, ahead of dropping a slot.
 */
export const WHEEL_DEAD_ZONE = 64;

/** Degrees off straight-up for the first slot. Small, so slot 0 reads as "up". */
const SWEEP_NEAR = 2;
/**
 * Degrees off straight-up for the last slot. Past ~72° the chip drops level
 * with the anchor, which on a tab-bar anchor means drawing it underneath the
 * tab bar.
 */
const SWEEP_FAR = 72;

/**
 * How far past the first and last slot still counts as that slot.
 *
 * The extreme slots absorb overshoot rather than ending at their own sector
 * edge: flicking hard past the end of the arc is a confident gesture aimed at
 * the last option, and cancelling it because the finger went 5° too far would
 * read as the wheel dropping inputs. Bounded rather than infinite so that
 * directions the fan plainly does not cover — straight down, or out towards
 * the corner the hand came from — still cancel.
 */
const SWEEP_OVERSHOOT = 40;

export interface WheelGeometry {
  /** No selection inside this radius. */
  dead: number;
  /** Where the icon chips are drawn. */
  chip: number;
  /** Where a chip's text label sits, further out along the same ray. */
  label: number;
  /** How far the highlight wedge extends, a little past the chip. */
  outer: number;
}

/**
 * Radii for a given screen width. The chip arc is a fraction of the width
 * rather than a constant so the fan keeps roughly the same proportions from an
 * SE to a Max, clamped at both ends: below ~190 the labels collide, above ~260
 * the far end of the arc leaves the screen.
 */
export function wheelGeometry(screenWidth: number): WheelGeometry {
  const chip = Math.min(260, Math.max(190, Math.round(screenWidth * 0.64)));
  return { dead: WHEEL_DEAD_ZONE, chip, label: chip + 56, outer: chip + 38 };
}

/** Degrees between adjacent slots. Zero for a fan holding one slot or none. */
export function wheelStep(count: number): number {
  return count > 1 ? (SWEEP_FAR - SWEEP_NEAR) / (count - 1) : 0;
}

/**
 * The angle of each slot, in degrees clockwise from straight up — so negative
 * when the fan opens to the left, which is the usual case (the anchor is the
 * rightmost tab). Index 0 is nearest vertical.
 */
export function wheelSlotAngles(count: number, openLeft: boolean): number[] {
  if (count <= 0) return [];
  const step = wheelStep(count);
  const sign = openLeft ? -1 : 1;
  return Array.from({ length: count }, (_, i) => sign * (SWEEP_NEAR + i * step));
}

/** Screen-space point at `radius` along `angle` (degrees clockwise from up). */
export function wheelPoint(
  originX: number,
  originY: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: originX + radius * Math.sin(rad), y: originY - radius * Math.cos(rad) };
}

/**
 * Which slot a touch offset selects, or `null` for none.
 *
 * `dx`/`dy` are offsets from the anchor in screen coordinates, so a negative
 * `dy` is upwards. `null` covers all three ways to select nothing: inside the
 * dead zone, aimed somewhere the fan does not reach, or there are no slots.
 */
export function wheelSlotAt(
  dx: number,
  dy: number,
  count: number,
  openLeft: boolean,
  deadZone: number = WHEEL_DEAD_ZONE,
): number | null {
  if (count <= 0) return null;
  if (Math.hypot(dx, dy) < deadZone) return null;

  // Degrees out from vertical along the direction the fan opens, so the rest
  // of the arithmetic is the same whichever side the anchor is on.
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const out = openLeft ? -angle : angle;

  const step = wheelStep(count);
  if (out < SWEEP_NEAR - SWEEP_OVERSHOOT) return null;
  if (out > SWEEP_FAR + SWEEP_OVERSHOOT) return null;
  if (count === 1) return 0;

  const index = Math.round((out - SWEEP_NEAR) / step);
  return Math.min(count - 1, Math.max(0, index));
}

/**
 * An SVG path for the highlight wedge behind the selected slot: the annular
 * sector between two radii, spanning `angleFrom` to `angleTo`.
 *
 * Drawn as a wedge rather than as a halo around the chip because the wedge is
 * the honest picture of the hit area — the whole sector is live at any
 * distance past the dead zone, and a ring drawn only around the icon would say
 * the opposite.
 */
export function wheelWedgePath(
  originX: number,
  originY: number,
  innerRadius: number,
  outerRadius: number,
  angleFrom: number,
  angleTo: number,
): string {
  const p = (r: number, a: number) => wheelPoint(originX, originY, r, a);
  const a = p(innerRadius, angleFrom);
  const b = p(outerRadius, angleFrom);
  const c = p(outerRadius, angleTo);
  const d = p(innerRadius, angleTo);
  const large = Math.abs(angleTo - angleFrom) > 180 ? 1 : 0;
  const sweep = angleTo > angleFrom ? 1 : 0;
  return [
    `M${a.x} ${a.y}`,
    `L${b.x} ${b.y}`,
    `A${outerRadius} ${outerRadius} 0 ${large} ${sweep} ${c.x} ${c.y}`,
    `L${d.x} ${d.y}`,
    `A${innerRadius} ${innerRadius} 0 ${large} ${sweep === 1 ? 0 : 1} ${a.x} ${a.y}`,
    'Z',
  ].join(' ');
}

/**
 * Keeps a centred label box on screen.
 *
 * The labels sit further out along each slot's own ray, which is what stops
 * them colliding with each other, but the ray for the slot nearest vertical
 * runs off the edge the anchor is against. Nudging that one label back inside
 * costs a couple of points of alignment against its ray and buys a label that
 * can be read.
 */
export function clampLabelX(
  x: number,
  halfWidth: number,
  screenWidth: number,
  margin: number = 12,
): number {
  const min = margin + halfWidth;
  const max = screenWidth - margin - halfWidth;
  if (min > max) return screenWidth / 2;
  return Math.min(max, Math.max(min, x));
}

/**
 * Moves one route a step along the wheel's order.
 *
 * Returns the **original array** when the move can't happen — the route isn't
 * on the wheel, or it's already at one end — so a caller can skip the store
 * write and the haptic on an identity check rather than comparing contents.
 * Same contract `categoryOrder.ts` documents, for the same reason.
 */
export function moveWheelRoute(routes: string[], route: string, delta: number): string[] {
  const from = routes.indexOf(route);
  if (from < 0) return routes;
  const to = from + delta;
  if (to < 0 || to >= routes.length) return routes;
  const next = [...routes];
  next.splice(from, 1);
  next.splice(to, 0, route);
  return next;
}

/**
 * Appends a route to the wheel. Identity-returns when it is already on, or
 * when the fan is full — the caller shows the cap rather than silently
 * dropping somebody else's slot to make room.
 */
export function addWheelRoute(
  routes: string[],
  route: string,
  maxSlots: number = WHEEL_MAX_SLOTS,
): string[] {
  if (routes.includes(route)) return routes;
  if (routes.length >= maxSlots) return routes;
  return [...routes, route];
}

/** Takes a route off the wheel. Identity-returns when it wasn't on it. */
export function removeWheelRoute(routes: string[], route: string): string[] {
  if (!routes.includes(route)) return routes;
  return routes.filter(r => r !== route);
}
