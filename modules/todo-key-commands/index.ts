import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

export interface KeyCommandSpec {
  id: string;
  /** A character, or "escape" / "up" / "down" / "left" / "right" / "return" / "delete". */
  input: string;
  modifiers: string[];
}

/** One menu bar item; see `MenuItemSpec` in `src/utils/macMenu.ts`. */
export interface NativeMenuItem {
  id: string;
  title: string;
  menu: string;
  submenu: string;
  input: string;
  modifiers: string[];
}

/** One right-click menu item. `icon` is an SF Symbol name, or '' for none. */
export interface NativePointerMenuItem {
  id: string;
  title: string;
  icon: string;
  destructive: boolean;
}

export interface NativePointerViewProps extends ViewProps {
  toolTip?: string | null;
  menuItems?: NativePointerMenuItem[];
  onMenuSelect?: (event: { nativeEvent: { id: string } }) => void;
}

interface Subscription {
  remove(): void;
}

interface TodoKeyCommandsNativeModule {
  isAvailable(): boolean;
  isOnMac(): boolean;
  setCommands(specs: KeyCommandSpec[]): void;
  isMenuBarAvailable(): boolean;
  setMenuItems(items: NativeMenuItem[]): void;
  setWindowTitle(title: string): void;
  setMinimumWindowSize(width: number, height: number): void;
  addListener(event: 'onKeyCommand' | 'onMenuCommand', listener: (event: { id: string }) => void): Subscription;
}

// Same lazy resolve as the other bridges here: requireNativeModule throws when
// the module isn't linked (Android, Expo Go), so the exports below degrade to
// doing nothing rather than throwing into a caller with no branch for it.
let nativeModule: TodoKeyCommandsNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoKeyCommandsNativeModule>('TodoKeyCommands');
  } catch {
    nativeModule = null;
  }
}

/**
 * Hands the native side the shortcuts to listen for. An empty list turns it
 * all off, including the first-responder view the module keeps in the window
 * (see the Swift module's header).
 *
 * **No demo-mode gate, and that is not an oversight.** It reads key presses
 * and writes nothing anywhere: the CLAUDE.md rule is about writes outside the
 * app's database and queues drained into the demo one.
 */
export function setKeyCommands(specs: KeyCommandSpec[]): void {
  if (!nativeModule) return;
  try {
    nativeModule.setCommands(specs);
  } catch (error) {
    console.warn('[todo-key-commands] native call failed; keyboard shortcuts are off', error);
  }
}

/** Called with the id of each shortcut pressed. Returns the unsubscribe. */
export function addKeyCommandListener(listener: (id: string) => void): () => void {
  if (!nativeModule) return () => {};
  try {
    const subscription = nativeModule.addListener('onKeyCommand', event => listener(event.id));
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/**
 * Whether the app is the iPhone or iPad app running on a Mac (Apple silicon's
 * "Designed for iPad"). False everywhere else, and when the native half isn't
 * linked or is an older build without this call: a build that can't say
 * leaves a Mac to turn the setting on by hand, as it always was.
 */
export function isRunningOnMac(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isOnMac() === true;
  } catch {
    return false;
  }
}

/**
 * Whether the menu bar was set up at launch: iOS 26 or later, on a Mac or an
 * iPad. False when the native half isn't linked, or is an older build without
 * the menu bar, which is how a caller knows to keep every shortcut on the key
 * sink instead.
 */
export function isMenuBarAvailable(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isMenuBarAvailable() === true;
  } catch {
    return false;
  }
}

/** Hands the native side the menu bar's items. Picks come back through `addMenuCommandListener`. */
export function setMenuItems(items: NativeMenuItem[]): void {
  if (!nativeModule) return;
  try {
    nativeModule.setMenuItems(items);
  } catch (error) {
    console.warn('[todo-key-commands] setMenuItems failed; the menu bar keeps its last items', error);
  }
}

/** Called with the id of each menu bar item chosen. Returns the unsubscribe. */
export function addMenuCommandListener(listener: (id: string) => void): () => void {
  if (!nativeModule) return () => {};
  try {
    const subscription = nativeModule.addListener('onMenuCommand', event => listener(event.id));
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/** What the window's title bar says, on a Mac. Does nothing where the native half can't. */
export function setWindowTitle(title: string): void {
  if (!nativeModule) return;
  try {
    nativeModule.setWindowTitle(title);
  } catch {
    // An older build without the call: the title stays the app's name.
  }
}

/** The smallest the window may be dragged to, in points. */
export function setMinimumWindowSize(width: number, height: number): void {
  if (!nativeModule) return;
  try {
    nativeModule.setMinimumWindowSize(width, height);
  } catch {
    // An older build without the call: the window keeps the system's limits.
  }
}

let pointerView: ComponentType<NativePointerViewProps> | null | undefined;

/**
 * The native view behind `PointerView`, or null where it can't be had: not
 * linked, or an older build without the view. Resolved once.
 */
export function getNativePointerView(): ComponentType<NativePointerViewProps> | null {
  if (pointerView !== undefined) return pointerView;
  pointerView = null;
  if (!nativeModule) return null;
  try {
    pointerView = requireNativeViewManager<NativePointerViewProps>('TodoKeyCommands');
  } catch (error) {
    console.warn('[todo-key-commands] pointer view is not registered; tooltips and right-click menus are off', error);
  }
  return pointerView;
}
