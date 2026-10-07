import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface KeyCommandSpec {
  id: string;
  /** A character, or "escape" / "up" / "down" / "left" / "right" / "return". */
  input: string;
  modifiers: string[];
}

interface Subscription {
  remove(): void;
}

interface TodoKeyCommandsNativeModule {
  isAvailable(): boolean;
  setCommands(specs: KeyCommandSpec[]): void;
  addListener(event: 'onKeyCommand', listener: (event: { id: string }) => void): Subscription;
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
