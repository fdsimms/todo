import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import { GroupDropTarget } from './GroupDropTarget';

/**
 * Which drop target a dragged row is aimed at right now, held outside React
 * state.
 *
 * A screen that kept this as its own state re-rendered itself on every
 * crossing mid-drag: every row's renderItem, the list header, and every sheet
 * mounted beside the list. That was the stutter dragging a line into a section
 * on a project's page. The highlight reads this channel instead, and the
 * list's freeze and drop-into go through `ReorderableList`'s `dropCaptureRef`,
 * so a crossing repaints the one target it lit and nothing else. Same rule the
 * add button's intent follows (see `FabIntentChannel`).
 *
 * The value is an id the caller chooses: a stack's id, or a fixed key for a
 * target that isn't a row (Today's Pinned block).
 */
export interface DropTargetChannel {
  publish: (id: string | null) => void;
  subscribe: (listener: () => void) => () => void;
  get: () => string | null;
}

/** Creates the channel. One per screen. */
export function useDropTargetChannel(): DropTargetChannel {
  return useMemo(() => {
    let current: string | null = null;
    const listeners = new Set<() => void>();
    return {
      publish: id => {
        if (id === current) return;
        current = id;
        listeners.forEach(l => l());
      },
      subscribe: listener => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      get: () => current,
    };
  }, []);
}

/** Whether `id` is the target, re-rendering the caller only when that flips. */
export function useDropTargetAimed(channel: DropTargetChannel, id: string): boolean {
  const getAimed = useCallback(() => channel.get() === id, [channel, id]);
  return useSyncExternalStore(channel.subscribe, getAimed, getAimed);
}

/**
 * `GroupDropTarget` lit from the channel. Children arrive as an untouched
 * prop, so a change repaints the highlight and not the rows inside it.
 */
export function ChannelDropTarget({
  channel,
  id,
  children,
}: {
  channel: DropTargetChannel;
  id: string;
  children: React.ReactNode;
}) {
  const aimed = useDropTargetAimed(channel, id);
  return <GroupDropTarget active={aimed}>{children}</GroupDropTarget>;
}
