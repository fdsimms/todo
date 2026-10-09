/**
 * Flag copy mode: TEMPORARY dev tooling, remove before the app opens to real
 * users (see `CopyFlag`). While the mode is on, a long-press on any text
 * captures its string and opens a sheet to flag it.
 *
 * This module is the small external store the `Text` patch in
 * `src/theme/AppFont.tsx` reads, so it imports nothing from React or the
 * navigator. The mode is session-only on purpose: it can't be left on by
 * accident across launches.
 */

type Listener = () => void;

let on = false;
let flagged = new Set<string>();
let version = 0;
const modeListeners = new Set<Listener>();
let captureListener: ((text: string) => void) | null = null;

export function isFlagMode(): boolean {
  return on;
}

export function setFlagMode(next: boolean): void {
  if (on === next) return;
  on = next;
  version += 1;
  modeListeners.forEach(l => l());
}

/** Snapshot for `useSyncExternalStore`: changes when the mode or the flagged set does. */
export function getFlagModeVersion(): number {
  return version;
}

export function subscribeFlagMode(listener: Listener): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

/** The strings of every open flag, so flagged text can be drawn underlined. */
export function setFlaggedTexts(texts: Iterable<string>): void {
  flagged = new Set(texts);
  if (!on) return;
  version += 1;
  modeListeners.forEach(l => l());
}

export function isTextFlagged(text: string): boolean {
  return flagged.has(text);
}

export function setCaptureListener(listener: ((text: string) => void) | null): void {
  captureListener = listener;
}

export function requestCapture(text: string): void {
  captureListener?.(text);
}

const MAX_FLAG_LENGTH = 500;

/**
 * The string a `Text` shows, from its children: strings and numbers joined in
 * order. A child that is an element (a nested `Text`) is left out, since it has
 * its own long-press. Empty when there is nothing to flag, which is how an icon
 * glyph or a text made only of elements stays unflaggable.
 */
export function flaggableText(children: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string' || typeof node === 'number') parts.push(String(node));
    else if (Array.isArray(node)) node.forEach(walk);
  };
  walk(children);
  const text = parts.join('').trim();
  return text.slice(0, MAX_FLAG_LENGTH);
}
