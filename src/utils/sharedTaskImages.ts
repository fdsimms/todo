import type { RecipeImage } from '../services/aiSuggestions';
import { widgetBridge } from './widgetBridge';

/**
 * The app's side of a screenshot shared in to be read for tasks. The files are
 * written by the share extension and live in the App Group container, which only
 * `todo-widget-bridge` can reach (see `SharedTaskImageQueue.swift` for why the
 * app leaves them in place until a person has acted on one).
 *
 * Every function answers through `widgetBridge()`, so each is a no-op in demo
 * mode and on a build without the native functions.
 */

/** The saved images, oldest first. Empty when nothing is queued or the bridge is absent. */
export async function listSharedTaskImages(): Promise<string[]> {
  const bridge = widgetBridge();
  if (!bridge?.listSharedImages) return [];
  try {
    return await bridge.listSharedImages();
  } catch {
    return [];
  }
}

/** One saved image ready to send to the model, or null when it is gone. */
export async function readSharedTaskImage(name: string): Promise<RecipeImage | null> {
  const bridge = widgetBridge();
  if (!bridge?.readSharedImage) return null;
  try {
    const base64 = await bridge.readSharedImage(name);
    // The extension always writes JPEG (SharedTaskImageQueue).
    return base64 ? { base64, mediaType: 'image/jpeg' } : null;
  } catch {
    return null;
  }
}

export async function discardSharedTaskImage(name: string): Promise<void> {
  const bridge = widgetBridge();
  if (!bridge?.deleteSharedImage) return;
  try {
    await bridge.deleteSharedImage(name);
  } catch {
    // Already gone, or a build predating it: nothing to do.
  }
}
