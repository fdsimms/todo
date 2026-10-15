import React, { useEffect, useState } from 'react';
import { InlineAction } from './InlineAction';
import { BannerBar } from './BannerBar';

const VISIBLE_MS = 4000;

interface Props {
  /** Number of tasks the apply created. */
  count: number;
  bottom: number;
  onDismiss: () => void;
  /** What to call them: "item" on a list, "task" everywhere else. */
  noun?: 'task' | 'item';
  /**
   * Takes you to where the run landed. Omitted where you are already there
   * (a run applied from the project's own page), and the toast stays a plain
   * confirmation.
   */
  goTo?: { label: string; onPress: () => void };
}

/**
 * Toast shown after applying a template, in place of opening the task
 * editor on whatever it created — see CLAUDE.md's note on this. Names how
 * many tasks landed and auto-dismisses; there's nothing to undo here
 * that shake-to-undo doesn't already cover. With `goTo`, it also offers a
 * way to the place they landed, since an apply from the template list
 * otherwise leaves you somewhere the tasks aren't.
 */
export function TemplateAppliedToast({ count, bottom, onDismiss, noun = 'task', goTo }: Props) {
  // Times out by dropping away, and only then tells the parent it's gone. A
  // swipe has already carried it off, so that one goes straight to onDismiss.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setLeaving(true), VISIBLE_MS);
    return () => clearTimeout(timeout);
  }, []);

  const message = count === 1 ? `Created 1 ${noun}` : `Created ${count} ${noun}s`;

  return (
    <BannerBar
      bottom={bottom}
      label={message}
      onDismiss={onDismiss}
      leaving={leaving}
      onLeft={onDismiss}
      actions={goTo ? (
        <InlineAction
          label={goTo.label}
          onPress={() => { setLeaving(true); goTo.onPress(); }}
          accessibilityLabel={goTo.label}
        />
      ) : undefined}
    />
  );
}
