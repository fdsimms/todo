import React from 'react';
import { BannerBar } from './BannerBar';
import { InlineAction } from './InlineAction';
import type { Task } from '../types';
import {
  describeCreatedTaskPlacement,
  describeMovedTaskPlacement,
  type CreatedTaskDestination,
} from '../utils/createdTaskPlacement';

interface Props {
  task: Task;
  destination: CreatedTaskDestination;
  /**
   * 'created' (the default) is a task that just came into existence;
   * 'moved' is one that was already in the Inbox and left it by taking an
   * in-row suggestion — see TodayScreen's presentMovedFromInbox. Only the
   * wording and the Undo action differ; Undo restores the row rather than
   * deleting it, which is TodayScreen's call, not this component's.
   */
  mode?: 'created' | 'moved';
  dayResetTime?: string;
  bottom: number;
  onGoToTask: () => void;
  onUndo: () => void;
  /** Swiped away by hand; the task stays where it is. */
  onDismiss: () => void;
  /** On its way out (see useLingering); BannerBar plays the exit, then `onLeft`. */
  leaving?: boolean;
  onLeft?: () => void;
}

/**
 * Toast TodayScreen shows when a newly created task lands somewhere other
 * than Today (Later, Unscheduled, Inbox) — see `handleTaskCreated`. Used to
 * switch the screen to that sub-view outright, which cost anyone quickly
 * adding several tasks their place on Today after every one that wasn't
 * due today. This names where the task went and offers a way to it and a
 * way to undo the creation, so staying put costs nothing either.
 */
export function CreatedTaskToast({ task, destination, mode = 'created', dayResetTime, bottom, onGoToTask, onUndo, onDismiss, leaving, onLeft }: Props) {
  const message = mode === 'moved'
    ? describeMovedTaskPlacement(task, destination, dayResetTime)
    : describeCreatedTaskPlacement(task, destination, dayResetTime);
  const undoHint = mode === 'moved'
    ? `Undo moving “${task.title}”`
    : `Undo creating “${task.title}”`;

  return (
    <BannerBar
      bottom={bottom}
      label={message}
      onDismiss={onDismiss}
      leaving={leaving}
      onLeft={onLeft}
      actions={
        <>
          <InlineAction label="Go to it" onPress={onGoToTask} accessibilityLabel={`Go to “${task.title}”`} />
          <InlineAction label="Undo" onPress={onUndo} variant="neutral" accessibilityLabel={undoHint} />
        </>
      }
    />
  );
}
