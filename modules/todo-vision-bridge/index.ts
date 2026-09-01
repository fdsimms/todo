import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * One line of text Vision recognized, with where it sat on the page.
 *
 * Coordinates are normalized to 0..1 against the image's own dimensions, with
 * the origin at the **top left** and y growing downward — flipped from
 * Vision's own bottom-left convention in the Swift layer so every reader above
 * this can treat "sort by y" as "reading order". Sizes are normalized the same
 * way, so a `height` of 0.02 is a line 2% of the photo's height tall.
 */
export interface RecognizedLine {
  text: string;
  /** Vision's own 0..1 confidence in this reading. */
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TodoVisionNativeModule {
  isAvailable(): boolean;
  recognizeText(uri: string): Promise<unknown>;
}

// Same lazy resolve the AlarmKit bridge uses, for the same reason:
// requireNativeModule throws outright when the module isn't linked (Android,
// web, Expo Go without a dev build), so resolving it once here lets every
// export below stay a plain function that degrades to "no text" rather than
// throwing into a caller that has no branch for it.
let nativeModule: TodoVisionNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoVisionNativeModule>('TodoVision');
  } catch {
    nativeModule = null;
  }
}

/**
 * Resolving the module is not the same as the module working — see the longer
 * note on `degradeOnThrow` in todo-alarmkit-bridge. The stakes are lower here
 * (nothing calls this from App.tsx's launch effect) but the shape is the same,
 * and an OCR read that throws must land on the vision-API path rather than
 * failing the scan the user just framed.
 */
function degradeOnThrow<T>(call: () => T, fallback: T): T {
  if (!nativeModule) return fallback;
  try {
    return call();
  } catch (error) {
    console.warn('[todo-vision-bridge] native call failed; treating Vision as unavailable', error);
    return fallback;
  }
}

export function isVisionAvailable(): boolean {
  return degradeOnThrow(() => nativeModule!.isAvailable() === true, false);
}

/**
 * Reads the text off the image at `uri`, which must be a `file://` URL.
 *
 * Returns an empty array for every failure — unlinked module, unreadable file,
 * a photo with no text in it — because all three mean the same thing to the
 * one caller: there is nothing here worth sending as text, so send the image.
 *
 * Every field is re-validated rather than trusted: a native module that
 * half-registers hands back shapes this signature promises and the runtime
 * doesn't, and `tsc` can't see across that boundary.
 */
export async function recognizeText(uri: string): Promise<RecognizedLine[]> {
  const result = await degradeOnThrow<Promise<unknown>>(
    () => nativeModule!.recognizeText(uri),
    Promise.resolve([]),
  ).catch(error => {
    console.warn('[todo-vision-bridge] recognizeText rejected; treating Vision as unavailable', error);
    return [];
  });

  if (!Array.isArray(result)) return [];
  const lines: RecognizedLine[] = [];
  for (const raw of result) {
    if (!raw || typeof raw !== 'object') continue;
    const line = raw as Record<string, unknown>;
    if (typeof line.text !== 'string' || !line.text) continue;
    const numbers = ['confidence', 'x', 'y', 'width', 'height'] as const;
    if (numbers.some(key => typeof line[key] !== 'number' || !Number.isFinite(line[key] as number))) {
      continue;
    }
    lines.push({
      text: line.text,
      confidence: line.confidence as number,
      x: line.x as number,
      y: line.y as number,
      width: line.width as number,
      height: line.height as number,
    });
  }
  return lines;
}
