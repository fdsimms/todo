import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { tasksAskingOnCompletion, unansweredCompletionCopy } from '../utils/bulkCompletion';

const NOTHING_QUEUED: readonly string[] = [];

interface CompleteRequest {
  /** Every task the action is about to complete. */
  ids: readonly string[];
  /**
   * Runs the completion, leaving `skipIds` alone. Called with an empty array
   * when nothing needs asking and when the user chooses to complete anyway,
   * so a host that ignores `skipIds` still behaves correctly in the common
   * case — but a host that can't honour it will complete the tasks the queue
   * is about to ask about, which reads as the questions being pointless.
   */
  complete: (skipIds: string[]) => void;
}

/**
 * The confirm a bulk completion shows when some of what it's about to
 * complete would go unanswered, plus the run of questions behind its first
 * button.
 *
 * A choice, not confirmation friction, so it's unconditional rather than
 * riding `confirmBeforeDeleting` — the same line `confirmDelete`'s own note
 * draws between the two kinds of dialog. The bulk paths share this hook rather
 * than each spelling out an Alert, because there are five of them across four
 * screens and the copy drifting between "the bulk bar's warning" and "the
 * stack's warning" is the failure this repo keeps naming.
 *
 * **Completing unanswered stays available and stays one tap.** The feature's
 * own rule is that nothing may ever *require* an answer (see
 * DeliverablePromptSheet), and a confirm that only offered "answer them" would
 * quietly become that. What changes is that it's now chosen rather than
 * assumed.
 *
 * Usage: call `requestComplete` where the bulk action used to run (or
 * `enqueue` for a single task), and render
 * `<DeliverablePromptQueue {...queueProps} />` somewhere in the host.
 */
export function useAnswerFirstCompletion() {
  const [queueIds, setQueueIds] = useState<readonly string[]>(NOTHING_QUEUED);

  const requestComplete = useCallback(({ ids, complete }: CompleteRequest) => {
    const byId = new Map(useTaskStore.getState().tasks.map(t => [t.id, t]));
    const candidates = ids.map(id => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
    const asking = tasksAskingOnCompletion(candidates);
    if (asking.length === 0) {
      complete([]);
      return;
    }
    const askingIds = asking.map(t => t.id);
    const { title, message } = unansweredCompletionCopy(asking.length);
    // Cancel is last because iOS puts a cancel-styled button there whatever the
    // array says; the other two are in the order they'd be reached for.
    Alert.alert(title, message, [
      {
        text: 'Answer',
        onPress: () => {
          // The rest go through first, so the questions are the only thing
          // left on screen rather than being asked over a list that hasn't
          // moved yet.
          complete(askingIds);
          setQueueIds(prev => [...prev, ...askingIds.filter(id => !prev.includes(id))]);
        },
      },
      { text: 'Complete Without Answering', onPress: () => complete([]) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  /**
   * Puts tasks straight into the run with no confirm — for a path completing
   * *one* task with a person right there (the focus session's Done button, a
   * Live Activity's). A single task needs no "some of these" warning; it needs
   * the same question its own row would ask.
   *
   * Appends rather than replaces, and skips what's already queued, so it can
   * land on a run already in progress without disturbing it.
   */
  const enqueue = useCallback((ids: readonly string[]) => {
    setQueueIds(prev => [...prev, ...ids.filter(id => !prev.includes(id))]);
  }, []);

  const onResolved = useCallback(
    (id: string) => setQueueIds(prev => prev.filter(x => x !== id)),
    [],
  );

  return { requestComplete, enqueue, queueProps: { ids: queueIds, onResolved } };
}
