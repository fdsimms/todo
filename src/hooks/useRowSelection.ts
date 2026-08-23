import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { featureHidden } from '../utils/simpleMode';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Bulk-selection state for a list of rows, whatever the rows are — tasks
 * (through useTaskSelection, which adds their delete flow on top), templates,
 * projects. It knows about ids and nothing else, so a screen brings its own
 * actions and its own bar.
 *
 * A row enters selection mode with itself pre-selected (a swipe on the task
 * lists, the header's select button elsewhere); tapping other rows while
 * selectionMode is on toggles them, and dragging down the column of selection
 * dots paints a run of them at once (see PaintSelectionProvider, fed by
 * `paintProps` below).
 */
export function useRowSelection() {
  const simpleMode = useSettingsStore(s => s.simpleMode);
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

  // Everything PaintSelectionProvider needs, in one bundle — a screen just
  // spreads it onto the provider wrapping its list.
  const paintProps = useMemo(
    () => ({
      // Gated here rather than at each of the five screens that spread this:
      // painting is one gesture with one switch behind it, and a list that
      // painted on Tags but not on Today would be the drift the bundle exists
      // to prevent. Off, the dots take a tap each and the column scrolls.
      enabled: selectionMode && !featureHidden('paintSelect', simpleMode),
      selectedIds,
      setSelected,
      onPaintingChange: setPainting,
    }),
    [selectionMode, simpleMode, selectedIds, setSelected],
  );

  return {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    setSelected,
    exitSelection,
    selectAll,
    deselectAll,
    painting,
    paintProps,
  };
}
