import React, { useEffect, useState } from 'react';
import type { Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { animateLayout } from '../utils/layoutAnimation';
import { asksOnCompletion } from '../utils/deliverables';
import { hasPushupChallenge } from '../utils/pushupCounter';
import { DeliverablePromptSheet } from './DeliverablePromptSheet';
import { PushupCounterSheet } from './PushupCounterSheet';
import { useSheetSubject } from '../hooks/useSheetSubject';

interface Props {
  /** The tasks still to ask about, in order. Always asks about the first one. */
  ids: readonly string[];
  /** Takes `id` off the queue, whatever happened to it. */
  onResolved: (id: string) => void;
  /** Opens the task editor or detail view. Optional. */
  onOpenTask?: (task: Task) => void;
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
 * **A task with pushups to do gets the counter first** (`PushupCounterSheet`),
 * which is why every path completing one with a person present comes through
 * here (`completesThroughQueue`): `completeTask` refuses it otherwise. Once
 * the pushups are counted, a task that also asks something gets its question
 * next and is completed with both; one that doesn't is completed at once and
 * the counter closes. Only one of the two sheets is ever visible, since two
 * modals can't be.
 *
 * Renders nothing until the first question, so a host can mount it
 * unconditionally. After that each sheet stays in the tree and closes
 * through `visible`, because a sheet unmounted while it is on screen
 * skips SheetModal's ordered close (see useSheetSubject).
 */
export function DeliverablePromptQueue({ ids, onResolved, onOpenTask }: Props) {
  const completeTask = useTaskStore(s => s.completeTask);

  const head = ids[0] ?? null;
  // Resolved at render rather than captured when the run started: a task can be
  // completed or deleted from elsewhere while the run is up, and asking about a
  // row that has since gone would prompt for a completion that can't happen.
  // Selects the one task rather than the list: `visible` is derived from this,
  // so it cannot be gated on `visible`, and the whole list would re-render the
  // queue on every task write for a run that is almost always empty.
  const current = useTaskStore(s =>
    head ? s.tasks.find(t => t.id === head && !t.completed) ?? null : null);

  // Tasks whose pushups were counted in this run, still waiting on their
  // question. The question's answer completes them with `pushupsDone`.
  const [counted, setCounted] = useState<readonly string[]>([]);
  useEffect(() => {
    if (head !== null && current === null) onResolved(head);
  }, [head, current]);

  const pushupHead = current && hasPushupChallenge(current) && !counted.includes(current.id) ? current : null;
  const counterTask = pushupHead;
  const promptTask = pushupHead === null ? current : null;

  // Each held past the end of the run, so the last answer closes its sheet
  // through `visible` instead of taking it out of the tree while it is still
  // on screen. See useSheetSubject.
  const shownCounter = useSheetSubject(counterTask);
  const shownPrompt = useSheetSubject(promptTask);

  return (
    <>
      {shownCounter && (
        <PushupCounterSheet
          visible={counterTask !== null}
          task={shownCounter}
          onCounted={() => {
            const task = shownCounter;
            if (asksOnCompletion(task)) {
              // The counter closes and the question opens in the same commit,
              // which is safe; holding both open is not.
              setCounted(prev => [...prev, task.id]);
              return;
            }
            animateLayout();
            completeTask(task.id, { pushupsDone: true });
            onResolved(task.id);
          }}
          onClose={() => onResolved(shownCounter.id)}
        />
      )}
      {shownPrompt && (
        <DeliverablePromptSheet
          visible={promptTask !== null}
          task={shownPrompt}
          onConfirm={(value, reasoning) => {
            animateLayout();
            completeTask(shownPrompt.id, {
              deliverableValue: value,
              deliverableReasoning: reasoning,
              pushupsDone: counted.includes(shownPrompt.id),
            });
            onResolved(shownPrompt.id);
          }}
          onCancel={() => onResolved(shownPrompt.id)}
          onOpenTask={onOpenTask}
        />
      )}
    </>
  );
}
