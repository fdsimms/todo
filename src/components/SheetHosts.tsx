import React, { useRef, useState } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Task } from '../types';
import type { TaskKind } from '../utils/taskKinds';
import { LazySheet } from './LazySheet';
import { QuickAddModal } from './QuickAddModal';
import { TaskEditor, type TaskDraft } from './TaskEditor';

/**
 * Quick add and the task editor, rendered from a store of their own rather than
 * from the screen that opens them.
 *
 * A screen whose list isn't memoized (Today, a project's page) re-renders every
 * row each time its own state changes. With a sheet's open state held there,
 * opening the sheet re-rendered the whole screen in the very commit that had to
 * mount the sheet. Held in a per-screen store and read by these two memoized
 * hosts, opening one re-renders the sheet and nothing else. A screen that needs
 * the state itself (Today's two-pane layout) subscribes to just that part.
 */

/** A store made once for the life of the component that calls it. */
export function useSheetStore<T>(initial: T): StoreApi<T> {
  return useState(() => createStore<T>(() => initial))[0];
}

type QuickAddProps = React.ComponentProps<typeof QuickAddModal>;

export type QuickAddSheetState = {
  visible: boolean;
  type: TaskKind;
  seed: QuickAddProps['seed'];
  seedLabel: string | null;
};

export const QUICK_ADD_CLOSED: QuickAddSheetState = { visible: false, type: 'task', seed: undefined, seedLabel: null };

export const QuickAddSheetHost = React.memo(function QuickAddSheetHost({
  store,
  ...props
}: { store: StoreApi<QuickAddSheetState> } & Omit<QuickAddProps, 'visible' | 'seed' | 'seedLabel' | 'initialType'>) {
  const { visible, type, seed, seedLabel } = useStore(store, useShallow(st => st));
  return (
    <LazySheet open={visible} warm>
      <QuickAddModal {...props} visible={visible} seed={seed} seedLabel={seedLabel} initialType={type} />
    </LazySheet>
  );
});

export type EditorSheetState = {
  visible: boolean;
  task: Task | null;
  draft: Partial<TaskDraft> | null;
};

export const EDITOR_CLOSED: EditorSheetState = { visible: false, task: null, draft: null };

/** Each editor store's way of asking its open form whether it holds unsaved edits. */
const dirtyChecks = new WeakMap<StoreApi<EditorSheetState>, () => boolean>();

/**
 * Whether the editor open in this store has edits it hasn't saved. Only the inline
 * pane reports one; a sheet covers the list it opened from, so there is nothing
 * to ask before re-pointing it.
 */
export function editorHasUnsavedChanges(store: StoreApi<EditorSheetState>): boolean {
  return store.getState().visible && (dirtyChecks.get(store)?.() ?? false);
}

/** The editor as a sheet, or with `inline`, as the pane beside a list. */
export const EditorSheetHost = React.memo(function EditorSheetHost({
  store,
  onClose,
  inline = false,
}: {
  store: StoreApi<EditorSheetState>;
  onClose: () => void;
  inline?: boolean;
}) {
  const { visible, task, draft } = useStore(store, useShallow(st => st));
  const dirtyCheckRef = useRef<(() => boolean) | null>(null);
  if (inline) {
    dirtyChecks.set(store, () => dirtyCheckRef.current?.() ?? false);
    return <TaskEditor inline visible={visible} task={task} initialDraft={draft} onClose={onClose} dirtyCheckRef={dirtyCheckRef} />;
  }
  return (
    <LazySheet open={visible} warm>
      <TaskEditor visible={visible} task={task} initialDraft={draft} onClose={onClose} />
    </LazySheet>
  );
});
