import React, { useEffect } from 'react';
import { useTaskStore } from '../store/useTaskStore';
import { animateLayout } from '../utils/layoutAnimation';
import { DeliverablePromptSheet } from './DeliverablePromptSheet';
import { useSheetSubject } from '../hooks/useSheetSubject';

interface Props {
  /** The tasks still to ask about, in order. Always asks about the first one. */
  ids: readonly string[];
  /** Takes `id` off the queue, whatever happened to it. */
  onResolved: (id: string) => void;
}

/**
 * Asks a run of questions one sheet at a time, completing each task with what
 * it was answered with.
 *
 * One sheet is up at a time because two modals can't be, and because these are
 * separate decisions: the answers aren't a form to fill in, they're N
 * completions that each happen to ask something.
 *
 * **The queue is the host's state and this only ever shifts the head off it**
 * (`onResolved`), rather than holding a cursor of its own. That's what lets a
 * host append to a run already in progress without replaying what's been
 * answered — a Live Activity's Done landing while a bulk run is open, say.
 *
 * **Cancelling skips that one task and moves on; it doesn't abandon the rest.**
 * The sheet's two ways out keep their per-task meanings — "Complete without an
 * answer" completes it unanswered, Cancel leaves it alone — and a run of three
 * where cancelling the second silently dropped the third would be its own
 * quiet loss, which is the thing this path exists to stop.
 *
 * Renders nothing until the first question, so a host can mount it
 * unconditionally. After that the sheet stays in the tree and closes
 * through `visible`, because a sheet unmounted while it is on screen
 * skips SheetModal's ordered close (see useSheetSubject).
 */
export function DeliverablePromptQueue({ ids, onResolved }: Props) {
  const tasks = useTaskStore(s => s.tasks);
  const completeTask = useTaskStore(s => s.completeTask);

  const head = ids[0] ?? null;
  // Resolved at render rather than captured when the run started: a task can be
  // completed or deleted from elsewhere while the run is up, and asking about a
  // row that has since gone would prompt for a completion that can't happen.
  const current = head ? tasks.find(t => t.id === head && !t.completed) ?? null : null;

  useEffect(() => {
    if (head !== null && current === null) onResolved(head);
  }, [head, current]);

  // Held past the end of the run, so the last answer closes the sheet through
  // `visible` instead of taking it out of the tree while it is still on
  // screen. See useSheetSubject.
  const shown = useSheetSubject(current);
  if (!shown) return null;

  return (
    <DeliverablePromptSheet
      visible={current !== null}
      task={shown}
      onConfirm={value => {
        animateLayout();
        completeTask(shown.id, { deliverableValue: value });
        onResolved(shown.id);
      }}
      onCancel={() => onResolved(shown.id)}
    />
  );
}
