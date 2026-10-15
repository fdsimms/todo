/**
 * Whether a row swipe is "armed": far enough that letting go now commits its
 * action. `SwipeableRow` ticks once on the way in and once on the way back out,
 * so the finger learns where the line is before it lifts rather than after.
 *
 * `dragX` is the raw finger travel Swipeable reports (its `state.dragX`):
 * positive is a swipe right (the left-hand panel), negative a swipe left (the
 * right-hand panel). A side with no panel never arms.
 *
 * The line itself is Swipeable's own release rule (`handleRelease`): the row
 * opens once `dragX / friction` passes half the panel. That ignores the
 * release's velocity toss on purpose. A flick that opens without crossing gets
 * its haptic at release instead (see `onSwipeableWillOpen` in SwipeableRow).
 *
 * `hysteresis` is how far back past the line the finger has to come before the
 * row disarms, so a finger resting on the line doesn't buzz.
 */
export interface SwipeArmSides {
  /** A left-hand panel exists (revealed by swiping right). */
  left: boolean;
  /** A right-hand panel exists (revealed by swiping left). */
  right: boolean;
}

export function swipeArmDistance(panelWidth: number, friction: number): number {
  return (panelWidth / 2) * friction;
}

export function nextSwipeArm(
  armed: boolean,
  dragX: number,
  sides: SwipeArmSides,
  armAt: number,
  hysteresis: number,
): boolean {
  const sideExists = dragX > 0 ? sides.left : dragX < 0 ? sides.right : false;
  if (!sideExists) return false;
  const travel = Math.abs(dragX);
  return armed ? travel >= armAt - hysteresis : travel >= armAt;
}
