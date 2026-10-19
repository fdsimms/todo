/**
 * Whether iPhone Mirroring mode should start on, because the app is running on
 * a Mac.
 *
 * Mirroring mode is what turns a swipe into a button, offers Undo after every
 * change and switches the keyboard shortcuts on, and all of that is what a Mac
 * window needs (a pointer stands in for a finger and nothing can be shaken).
 * The stored setting wins whenever there is one: a person who turned it off on
 * their Mac has said so, and `setMirroringMode` writes `'false'`, which is not
 * absent. Only a Mac that has never been asked gets it on, and nothing is
 * written, so the default follows the device instead of becoming a choice.
 */
export function shouldDefaultMirroringOn(stored: string | null | undefined, onMac: boolean): boolean {
  return onMac && (stored === null || stored === undefined);
}
