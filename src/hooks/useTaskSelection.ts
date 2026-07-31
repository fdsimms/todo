import { useState } from 'react';
import { Alert } from 'react-native';
import type { Task } from '../types';
import { isLiveRecurring } from '../utils/visibilityUtils';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useTaskStore } from '../store/useTaskStore';

// Bulk-selection state shared by every task list screen. A row's swipe
// gesture enters selection mode with that row pre-selected (see TaskItem's
// onSwipeSelect); tapping other rows while selectionMode is on toggles them.
export function useTaskSelection(allTasks: Task[]) {
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const skipNextRecurrence = useTaskStore(s => s.skipNextRecurrence);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const enterSelectionMode = (initialId?: string) => {
    haptics.impactHeavy();
    animateLayout();
    setSelectionMode(true);
    setSelectedIds(initialId ? new Set([initialId]) : new Set());
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    animateLayout();
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const selectAll = (ids: string[]) => setSelectedIds(new Set(ids));
  const deselectAll = () => setSelectedIds(new Set());

  // A live recurring task in the selection makes "delete" ambiguous — see
  // the matching prompt in TaskItem's single-task delete flow (now folded
  // into this same bulk path). For a mixed selection, "This Task(s)" skips
  // just the recurring ones to their next occurrence and deletes the rest;
  // "This and Future Tasks" deletes everything, ending any series in the
  // selection.
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const liveRecurringIds = ids.filter(id => {
      const t = allTasks.find(x => x.id === id);
      return t ? isLiveRecurring(t) : false;
    });
    if (liveRecurringIds.length === 0) {
      bulkDeleteTasks(ids);
      exitSelection();
      return;
    }
    const restIds = ids.filter(id => !liveRecurringIds.includes(id));
    Alert.alert(
      'Delete recurring tasks',
      'Some selected tasks repeat. Skip just this occurrence for those, or delete everything and stop their series?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'This Task(s)',
          onPress: () => {
            liveRecurringIds.forEach(id => skipNextRecurrence(id));
            bulkDeleteTasks(restIds);
            exitSelection();
          },
        },
        {
          text: 'This and Future Tasks',
          style: 'destructive',
          onPress: () => {
            bulkDeleteTasks(ids);
            exitSelection();
          },
        },
      ],
    );
  };

  return {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    handleBulkDelete,
  };
}
