// The on-device model, as the rest of the app sees it.
//
// Sits beside aiSuggestions.ts because it answers the same questions, but it
// is the one "AI service" here that reaches nothing: no key, no host, no
// request. That difference is the feature, and it is why this file needs none
// of the demo-mode gating every other integration in the app carries — see the
// note on `isOnDeviceReady` below.

import type { OnDeviceSchema, OnDeviceAvailability } from 'todo-foundation-models';

export type { OnDeviceAvailability };

interface FoundationModelsBridge {
  isOnDeviceModelAvailable: () => boolean;
  onDeviceModelAvailability: () => OnDeviceAvailability;
  generateOnDevice: (prompt: string, schema: OnDeviceSchema) => Promise<Array<Record<string, string>>>;
}

/**
 * Resolved at the call rather than imported at module scope, the same shape
 * `widgetBridge()` uses and for a second reason on top of its one.
 *
 * Its reason applies here too: the native half doesn't exist in Expo Go or on
 * Android, and a static import throws at module scope instead of at the call.
 * The second is the test suite. Jest runs in the `node` environment with
 * `react-native` untransformed, so anything importing it has to be mocked by
 * every test that reaches it — and this module is imported by
 * `aiSuggestions.ts`, which half the service tests pull in transitively. A
 * static import here made three unrelated suites fail on a file they have no
 * interest in. The `import type` above survives that because it is erased.
 */
function bridge(): FoundationModelsBridge | null {
  try {
    return require('todo-foundation-models') as FoundationModelsBridge;
  } catch {
    return null;
  }
}

/**
 * Resolving the bridge is not the same as the bridge working, so the *calls*
 * degrade too, not just the require.
 *
 * The module's own index.ts already catches a throwing native method, which
 * makes this look redundant, and it is not: these two functions are read
 * during render (`useOnDeviceAvailability`'s initial state, and the route a
 * screen decides its entry points from), and a throw escaping into a render
 * unmounts the React root and blacks out the app. That is the exact failure
 * `todo-alarmkit-bridge` documents, and one layer catching it is only a
 * guarantee while nothing changes underneath.
 */
function degradeOnThrow<T>(call: (b: FoundationModelsBridge) => T, fallback: T): T {
  const native = bridge();
  if (!native) return fallback;
  try {
    return call(native);
  } catch (error) {
    console.warn('[onDeviceModel] native call failed; treating the model as unavailable', error);
    return fallback;
  }
}

/**
 * Whether a generation can be attempted right now.
 *
 * Read at render time by anything deciding whether a control exists, so it is
 * synchronous and cheap. Deliberately *not* gated on demo mode, unlike
 * `widgetBridge` or `weatherLookup`: the CLAUDE.md rule covers writing fiction
 * somewhere the user can see it with the app closed, and draining a real queue
 * into a database about to be thrown away. On-device inference does neither —
 * nothing leaves the process, nothing is consumed, and the suggestion lands in
 * the same review sheet a real one would. This is the first integration where
 * the honest answer is "no gate needed", which is a different thing from
 * having forgotten one, and `onDeviceModel.test.ts` pins it so a later reader
 * doesn't add a gate back on the assumption it was missed.
 */
export function isOnDeviceReady(): boolean {
  return degradeOnThrow(b => b.isOnDeviceModelAvailable() === true, false);
}

export function onDeviceAvailability(): OnDeviceAvailability {
  return degradeOnThrow(b => b.onDeviceModelAvailability(), 'unavailable');
}

/**
 * Copy for a state the user can't act on, or null when there's nothing worth
 * saying. Written to state the mechanism rather than to apologise, the way the
 * rest of the settings copy does.
 *
 * `deviceNotEligible` is the one that has to be explicit: there is no download
 * coming and no switch to find, so a row that only said "unavailable" would
 * read as a bug to anyone holding an older iPhone.
 */
export function describeOnDeviceAvailability(state: OnDeviceAvailability): string | null {
  switch (state) {
    case 'available':
      return null;
    case 'deviceNotEligible':
      return 'This iPhone doesn\'t support Apple Intelligence, so on-device suggestions can\'t run here.';
    case 'notEnabled':
      return 'Turn Apple Intelligence on in the Settings app to use this.';
    case 'notReady':
      return 'Apple Intelligence is still setting up. This will work once it finishes.';
    case 'unavailable':
      return 'On-device suggestions aren\'t available on this device.';
  }
}

/**
 * The failures this module raises, by message.
 *
 * Matched on the string because that is all a thrown `Error` carries across
 * the two files, and `describeAIError` has to be able to tell an on-device
 * failure from a network one to avoid telling someone to check a connection
 * nothing used.
 */
const ON_DEVICE_ERROR_MESSAGES = new Set([
  'On-device model unavailable',
  'On-device model returned malformed output',
]);

export function isOnDeviceErrorMessage(message: string): boolean {
  return ON_DEVICE_ERROR_MESSAGES.has(message);
}

/** Maps an on-device failure to copy safe to show a user, like `describeAIError`. */
export function describeOnDeviceError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'On-device model unavailable') {
    return 'On-device suggestions aren\'t available on this device.';
  }
  if (message === 'On-device model returned malformed output') {
    return 'Nothing came back that could be used. Try again.';
  }
  return 'The on-device model couldn\'t finish that. Try again.';
}

/**
 * Runs one prompt against one schema.
 *
 * A thin pass-through today, and kept as its own function anyway so the
 * availability check and the call sit behind one import rather than every
 * caller reaching into the native module directly — the same reason
 * `widgetBridge()` is the one door to the widget bridge.
 */
export function runOnDevice(
  prompt: string,
  schema: OnDeviceSchema,
): Promise<Array<Record<string, string>>> {
  const native = bridge();
  if (!native) return Promise.reject(new Error('On-device model unavailable'));
  return native.generateOnDevice(prompt, schema);
}

export type { OnDeviceSchema };
