/**
 * Which mounted copy of a keyboard accessory bar is allowed to render.
 *
 * An `InputAccessoryView` is addressed by a `nativeID` string, and a TextInput
 * attaches to one by naming that string in `inputAccessoryViewID`. The lookup
 * is a global registry on the native side, so two mounted views claiming the
 * same nativeID is not a merge — one of them wins, and nothing says which. The
 * losing case is the bad one: RN Modals each get their own window, so the
 * winner can easily be the copy sitting in a *background* window, which
 * attaches a bar to a keyboard nobody can see and leaves the visible field
 * with none. That's the failure QuickAddModal's handoff to the task editor
 * already goes out of its way to dodge by hand, deferring the editor's own
 * mount until its Modal has closed.
 *
 * Doing that by hand doesn't scale past two mounts: every screen or sheet with
 * a number-pad field wants a bar (iOS's number pad has no return key, so there
 * is otherwise no way to dismiss it), and any of them can have any other one
 * open on top of it. So the accessory components register here instead and
 * render only while they're the newest registration for their nativeID.
 *
 * Newest wins because mount order tracks stacking order: a Modal's subtree
 * mounts after the screen that opened it, so the topmost window is always the
 * last to register. Unregistering pops it and hands the bar back to whatever
 * was underneath, which is what makes a sheet closing restore its screen's own
 * accessory rather than leaving the app with none.
 *
 * Keyed by nativeID rather than global so two *different* bars (the number pad's
 * Done, the title editor's token row) can be mounted at once without competing.
 */

const stacks = new Map<string, string[]>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(fn => fn());
}

/**
 * Claim `nativeID` for `instanceId`, making it the one that renders. A repeat
 * registration of an id already on the stack moves it to the top rather than
 * adding a second entry, so a re-registering instance can't leak a slot.
 */
export function registerAccessory(nativeID: string, instanceId: string): void {
  const stack = stacks.get(nativeID) ?? [];
  const next = stack.filter(id => id !== instanceId);
  next.push(instanceId);
  stacks.set(nativeID, next);
  notify();
}

/**
 * Give up `instanceId`'s claim. Whatever registered before it takes over.
 * Unregistering an id that isn't on the stack is a no-op, so an unmount that
 * runs twice costs nothing.
 */
export function unregisterAccessory(nativeID: string, instanceId: string): void {
  const stack = stacks.get(nativeID);
  if (!stack || !stack.includes(instanceId)) return;
  const next = stack.filter(id => id !== instanceId);
  if (next.length > 0) stacks.set(nativeID, next);
  else stacks.delete(nativeID);
  notify();
}

/** The instance currently allowed to render for `nativeID`, or null if none. */
export function topAccessory(nativeID: string): string | null {
  const stack = stacks.get(nativeID);
  if (!stack || stack.length === 0) return null;
  return stack[stack.length - 1]!;
}

/** Whether `instanceId` is the one that should render for `nativeID`. */
export function isTopAccessory(nativeID: string, instanceId: string): boolean {
  return topAccessory(nativeID) === instanceId;
}

/** Subscribe to changes in who's on top. Returns the unsubscribe function. */
export function subscribeAccessories(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: drop every registration so cases don't leak into one another. */
export function resetAccessoryStacks(): void {
  stacks.clear();
  notify();
}
