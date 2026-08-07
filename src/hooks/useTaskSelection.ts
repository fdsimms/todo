import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { Task } from '../types';
import { isLiveRecurring } from '../utils/visibilityUtils';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useTaskStore } from '../store/useTaskStore';

// Bulk-selection state shared by every task list screen. A row's swipe
// gesture enters selection mode with that row pre-selected (see TaskItem's
// onSwipeSelect); tapping other rows while selectionMode is on toggles them,
// and dragging down the checkbox column paints a run of them at once (see
// PaintSelectionProvider, fed by `paintProps` below).
export function useTaskSelection(allTasks: Task[]) {
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const markMissed = useTaskStore(s => s.markMissed);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // True only while a paint gesture owns the touch (see PaintSelectionProvider);
  // screens suspend their list's scrolling on it.
  const [painting, setPainting] = useState(false);

  // Takes a list as well as a single id: swiping a stack header selects every
  // live task in it at once (see TaskGroupHeader's onSwipeSelect).
  // These two are wrapped, like setSelected below, because they end up as
  // props on a memoized TaskItem: a fresh identity per render would defeat its
  // shallow compare and put every row back to re-rendering on each selection
  // change. Empty deps are safe — both reach state only through the functional
  // form of setState, so a frozen closure can't read a stale value.
  const enterSelectionMode = useCallback((initial?: string | string[]) => {
    haptics.impactHeavy();
    animateLayout();
    setSelectionMode(true);
    const ids = initial === undefined ? [] : Array.isArray(initial) ? initial : [initial];
    setSelectedIds(new Set(ids));
  }, []);

  // Every change to the selection ticks, so adding rows one at a time feels
  // like the same mechanism as painting a run of them.
  const toggleSelection = useCallback((id: string) => {
    haptics.tap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Set an explicit value rather than flipping: a paint gesture drives a whole
  // run of rows to the same state, and it fires faster than React re-renders,
  // so a toggle would race the selection it's reading from. No haptic here —
  // the gesture is the one that knows whether a row actually changed (see
  // PaintSelectionProvider), and a tick per row it merely passed over would be
  // feedback for nothing.
  const setSelected = useCallback((id: string, selected: boolean) => {
    setSelectedIds(prev => {
      if (prev.has(id) === selected) return prev;
      const next = new Set(prev);
      if (selected) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const exitSelection = () => {
    animateLayout();
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // Selection lasts for a visit, not for the life of the screen. Every screen
  // that bulk-selects stays mounted when you leave it (tab screens are kept
  // alive, and enableScreens(false) means a blurred one isn't even frozen), so
  // without this a selection made on Today is still active — bar and all — on
  // coming back from Projects. Cleared on blur rather than on focus so the
  // first frame painted on return is already out of selection mode.
  //
  // No animateLayout() on this path, unlike exitSelection: the rows going away
  // aren't on screen to animate, and a queued LayoutAnimation would land on
  // whichever screen commits next instead.
  useFocusEffect(
    useCallback(() => {
      return () => {
        setSelectionMode(false);
        setSelectedIds(new Set());
        setPainting(false);
      };
    }, [])
  );

  const selectAll = (ids: string[]) => setSelectedIds(new Set(ids));
  const deselectAll = () => setSelectedIds(new Set());

  // A live recurring task in the selection makes "delete" ambiguous — see
  // the matching prompt in TaskItem's single-task delete flow (now folded
  // into this same bulk path). For a mixed selection, "This Task(s)" marks
  // just the recurring ones missed — closing each out as not-done and moving
  // it to its next occurrence — and deletes the rest;
  // "This and Future Tasks" deletes everything, ending any series in the
  // selection.
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    const plural = count === 1 ? 'task' : 'tasks';
    const liveRecurringIds = ids.filter(id => {
      const t = allTasks.find(x => x.id === id);
      return t ? isLiveRecurring(t) : false;
    });
    if (liveRecurringIds.length === 0) {
      Alert.alert(
        `Delete ${count} ${plural}?`,
        `You're about to delete ${count} ${plural}. You can undo this by shaking your phone right after.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              bulkDeleteTasks(ids);
              exitSelection();
            },
          },
        ],
      );
      return;
    }
    const restIds = ids.filter(id => !liveRecurringIds.includes(id));
    Alert.alert(
      `Delete ${count} ${plural}?`,
      'Some selected tasks repeat. Mark just this occurrence missed for those, or delete everything and stop their series? You can undo this by shaking your phone right after.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'This Task(s)',
          onPress: () => {
            liveRecurringIds.forEach(id => markMissed(id));
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

  // Everything PaintSelectionProvider needs, in one bundle — a screen just
  // spreads it onto the provider wrapping its list.
  const paintProps = useMemo(
    () => ({
      enabled: selectionMode,
      selectedIds,
      setSelected,
      onPaintingChange: setPainting,
    }),
    [selectionMode, selectedIds, setSelected],
  );

  return {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    handleBulkDelete,
    painting,
    paintProps,
  };
}
