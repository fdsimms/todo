import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { useTaskStore } from '../store/useTaskStore';
import { haptics } from '../utils/haptics';
import {
  isStampFromEarlierLaunch,
  reachOutHistoryTitle,
  reachOutPromptMessage,
} from '../utils/reachOutIntent';

/**
 * Roughly when this launch began, stamped as the module is imported.
 *
 * Read only by `isStampFromEarlierLaunch`, whose own note explains what it is
 * for.
 */
const PROCESS_START_MS = Date.now();

/**
 * The question a tap on Call, Text or Email comes back to.
 *
 * Mounted once at the app root, because the tap and the answer happen on
 * different screens: Call on "Call Mom" from Today hands off to the dialler and
 * returns you to Today, not to Mom's page. See `docs/arch/people.md`, "Tapping
 * Call or Text, and the question that follows", for the whole argument; the
 * short version is that the app cannot detect that you rang anybody (iOS
 * exposes no call log and no message read at all), so what it has is its own
 * button being tapped, which is an intention rather than an event. Asking is
 * what turns the one into the other.
 *
 * **This is the one prompt in the people feature that arrives unasked**, and it
 * is allowed only because the user's own tap armed it moments earlier. It says
 * nothing about the friendship, carries no count and no colour, shows in full
 * the entry it would write, and "Not now" leaves no mark at all. The calendar
 * offer next door may still never prompt on Today, and the difference is what
 * the two things are: that one volunteers an observation about your life, this
 * one confirms something you just did.
 */
export function useReachOutPrompt(): void {
  // Waits for the people store to have loaded, which is what guarantees the
  // SQLite file is open: the stamp lives in the `settings` table, and a read
  // attempted mid-launch would find nothing and silently drop a question the
  // app had genuinely been holding. `initialized` goes false→true exactly once
  // per process — `useTaskStore.initialize`'s fan-out sets it again on a demo
  // swap, but to the same value, so this effect is not rebuilt by one.
  const ready = usePersonStore(s => s.initialized);

  useEffect(() => {
    if (!ready) return;
    const ask = (trigger: 'mount' | 'foreground'): void => {
      const people = usePersonStore.getState();
      const pending = people.peekPendingReachOut(new Date());
      if (!pending) return;
      // Left where it is rather than cleared, so a real foreground later can
      // still pick it up. See `isStampFromEarlierLaunch` for why mount alone is
      // not enough evidence that anything actually happened.
      if (trigger === 'mount' && !isStampFromEarlierLaunch(pending, PROCESS_START_MS)) return;
      const subject = people.getPersonById(pending.personId);
      // Deleted between the tap and the answer. Resolve-or-shrug, the same way
      // every other reader of a person id here behaves.
      if (!subject) {
        people.clearPendingReachOut();
        return;
      }
      // Cleared *before* the alert rather than from its buttons, so it can only
      // ever be asked once: a second foreground while the alert is still up
      // would otherwise stack a duplicate on top of it. The failure this leaves
      // open — the app dying mid-question and never asking again — is the one
      // worth having, since a question nobody answered already means no.
      people.clearPendingReachOut();
      const at = new Date(pending.at);
      const name = displayNameOf(subject);
      Alert.alert(
        'Add to history?',
        reachOutPromptMessage(pending.kind, name, at),
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Add',
            onPress: () => {
              haptics.success();
              useTaskStore.getState().addCompletedTask(
                reachOutHistoryTitle(pending.kind, name),
                at,
                [pending.personId],
              );
            },
          },
        ],
      );
    };

    // Two triggers, catching different things. The listener is the ordinary
    // path: the hand-off backgrounds the app and coming back is itself the
    // evidence that something happened. Mount covers the app having been
    // reclaimed during a long call, which relaunches with no transition to
    // hear — and is guarded, because a mount is not on its own evidence of
    // anything, least of all for somebody who just cancelled iOS's own "call
    // this number?" sheet without leaving the app.
    ask('mount');
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') ask('foreground');
    });
    return () => subscription.remove();
  }, [ready]);
}
