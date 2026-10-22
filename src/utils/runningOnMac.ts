import { isRunningOnMac } from 'todo-key-commands';

let cached: boolean | null = null;

/**
 * Whether this is the iPhone or iPad app running on a Mac, asked of the native
 * side once: the device can't change while the app runs. For the desktop-only
 * behaviors (hover, the window title) that iPhone Mirroring doesn't get, since
 * the app runs on the phone there.
 */
export function runningOnMac(): boolean {
  if (cached === null) cached = isRunningOnMac();
  return cached;
}
