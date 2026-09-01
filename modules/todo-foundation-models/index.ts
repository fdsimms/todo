import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/**
 * Apple's on-device language model (Foundation Models, iOS 26+).
 *
 * One generic call rather than a bridge per feature. The alternative was a
 * native method per prompt — `suggestAisles`, `suggestSubtasks`, and so on —
 * which puts the schema, the prompt and the parse on the Swift side, three
 * places a JS-side change would have to be mirrored into. `generate` instead
 * takes the schema as JSON, builds it at runtime with `DynamicGenerationSchema`
 * and hands back `GeneratedContent` as JSON, so every caller keeps its
 * validation in TypeScript next to the Claude path's validation, which is
 * where `aiSuggestions.ts` already refuses to trust a returned string as an
 * identifier.
 *
 * Two limits shape what can be asked of it, both worth knowing before adding a
 * caller:
 *
 * - **The context window is small** (roughly 4k tokens for prompt and
 *   completion together), so this is for short inputs with bounded outputs.
 *   Anything vision or long-context stays on the Claude path.
 * - **Availability is not a permission.** It is off on ineligible hardware
 *   permanently, with no prompt to show and nothing for the user to grant —
 *   see `OnDeviceAvailability` below.
 *
 * Resolved once, lazily, with every export degrading to "unavailable" if the
 * module isn't there — the todo-alarmkit-bridge shape, for the reason spelled
 * out in that file: resolving is not the same as working, and a TypeError off
 * a missing method lands in whatever called it.
 */

/**
 * Why the model can't be used, when it can't.
 *
 * `deviceNotEligible` is the one with no route forward: Apple Intelligence
 * needs an iPhone 15 Pro or the 16 line and up, and on anything older there is
 * no download to wait for and no switch to find. The other two are temporary,
 * which is why they're distinct — `notEnabled` is worth telling someone about
 * because they can act on it, and `notReady` resolves itself.
 */
export type OnDeviceAvailability =
  | 'available'
  | 'deviceNotEligible'
  | 'notEnabled'
  | 'notReady'
  | 'unavailable';

/**
 * A field in the schema handed to `generate`. Deliberately a small closed set
 * rather than a pass-through of JSON Schema: `DynamicGenerationSchema` supports
 * far less than JSON Schema does, and a type that promised more than the native
 * side can build would fail at runtime on the device instead of in the editor.
 */
export type OnDeviceField =
  | { name: string; type: 'string'; description?: string }
  /** Constrained to `choices` — the native side builds this as an anyOf. */
  | { name: string; type: 'enum'; choices: string[]; description?: string };

export interface OnDeviceSchema {
  /** Named for the model's benefit; it appears in the guided-generation prompt. */
  name: string;
  description?: string;
  /** One object per array element, described by `fields`. */
  fields: OnDeviceField[];
}

interface TodoFoundationModelsNativeModule {
  isAvailable(): boolean;
  availability(): OnDeviceAvailability;
  generate(prompt: string, schemaJson: string): Promise<string>;
}

let nativeModule: TodoFoundationModelsNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoFoundationModelsNativeModule>('TodoFoundationModels');
  } catch {
    nativeModule = null;
  }
}

function degradeOnThrow<T>(call: () => T, fallback: T): T {
  if (!nativeModule) return fallback;
  try {
    return call();
  } catch (error) {
    console.warn('[todo-foundation-models] native call failed; treating the model as unavailable', error);
    return fallback;
  }
}

/** Whether this build, on this device, can run any of the rest of it. */
export function isOnDeviceModelAvailable(): boolean {
  return degradeOnThrow(() => nativeModule!.isAvailable() === true, false);
}

/** The same answer with the reason attached, for copy that has to explain itself. */
export function onDeviceModelAvailability(): OnDeviceAvailability {
  return degradeOnThrow(() => nativeModule!.availability(), 'unavailable');
}

/**
 * Runs one guided-generation prompt and returns the rows it produced.
 *
 * Rejects rather than degrading, unlike everything above it: a caller asking
 * for a generation has already checked availability, so an empty array here
 * would be indistinguishable from the model genuinely having nothing to say.
 * `onDeviceModel.ts` maps the rejection to user-facing copy, the same way
 * `describeAIError` does for the Claude path.
 */
export async function generateOnDevice(
  prompt: string,
  schema: OnDeviceSchema,
): Promise<Array<Record<string, string>>> {
  if (!nativeModule) throw new Error('On-device model unavailable');
  const json = await nativeModule.generate(prompt, JSON.stringify(schema));
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('On-device model returned malformed output');
  }
  if (!Array.isArray(parsed)) throw new Error('On-device model returned malformed output');
  // Every value is flattened to a string here so the caller's validation has
  // one shape to check. Guided generation constrains the *shape*, never the
  // content, so a row with a missing or non-string field is dropped rather
  // than passed on for the caller to re-check.
  const rows: Array<Record<string, string>> = [];
  for (const row of parsed) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    rows.push(out);
  }
  return rows;
}
