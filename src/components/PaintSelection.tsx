import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  isInPaintGutter,
  rowIdAtY,
  rowIdsBetween,
  type PaintRowRect,
} from '../utils/paintSelect';
import { haptics } from '../utils/haptics';

/**
 * "Paint" selection: while bulk editing, dragging a finger down the column of
 * checkboxes selects every row it passes over, instead of making the user tap
 * each one. Lifting and dragging back the other way is not an undo — the first
 * row the gesture touches decides the direction (select if it was unselected,
 * deselect if it was selected) and every row after it is set to match, which is
 * what makes a sloppy drag predictable.
 *
 * Scrolling is deliberately untouched everywhere except a narrow strip along
 * the leading edge (PAINT_GUTTER_WIDTH). A touch that lands there is claimed
 * on touch-down, in the capture phase, before anything below sees it. That
 * timing is the whole trick: a gesture can't be taken away from a native
 * UIScrollView once it has started dragging, so waiting to see which way the
 * finger moves would mean the list scrolls out from under the paint. The cost
 * is that you cannot scroll by starting a drag right on the checkboxes — which
 * is the same trade Things 3 makes.
 *
 * Rows register themselves through context (see usePaintSelectionRow, wired up
 * inside TaskItem), so a screen only has to wrap its list in the provider —
 * nothing about the list itself, virtualized or not, has to change.
 */

interface MeasurableView {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

interface PaintSelectionContextValue {
  register: (id: string, view: MeasurableView | null) => void;
}

const PaintSelectionContext = createContext<PaintSelectionContextValue | null>(null);

/**
 * Ref callback a selectable row attaches to its card view, so a paint gesture
 * can find which row the finger is over. A no-op outside a provider, so rows
 * stay usable on screens with no bulk editing.
 *
 * Pass a null id for a row that is a throwaway copy of another — a drag
 * overlay, say. Registering it would claim the real row's slot under the same
 * id, and unmounting it would then evict a row that's still on screen.
 */
export function usePaintSelectionRow(id: string | null) {
  const ctx = useContext(PaintSelectionContext);
  return useCallback(
    // Typed loosely on purpose: this attaches to a host component whose own ref
    // type React won't reconcile with a narrower callback, and the only thing
    // needed off the instance is measureInWindow.
    (view: any) => {
      if (id === null) return;
      ctx?.register(id, (view as MeasurableView | null) ?? null);
    },
    // The context value is stable for the provider's lifetime, so this ref
    // callback is too — React won't churn it with null/node on every render.
    [ctx, id],
  );
}

interface Props {
  /** Painting only arms while bulk selection is on. */
  enabled: boolean;
  /** Current selection, read at gesture time to decide select vs deselect. */
  selectedIds: Set<string>;
  setSelected: (id: string, selected: boolean) => void;
  /**
   * Fired when a paint gesture starts and ends. Screens use it to suspend
   * their list's scrolling for the duration: blocking the native scroll from
   * JS is Android-only (`onShouldBlockNativeResponder`), so on iOS the list
   * has to be told directly.
   */
  onPaintingChange?: (painting: boolean) => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function PaintSelectionProvider({
  enabled,
  selectedIds,
  setSelected,
  onPaintingChange,
  style,
  children,
}: Props) {
  const containerRef = useRef<View | null>(null);
  const containerXRef = useRef(0);
  const rowsRef = useRef<Map<string, MeasurableView>>(new Map());
  // Row bands, sorted top to bottom, snapshotted once per gesture.
  const rectsRef = useRef<PaintRowRect[]>([]);
  const paintingRef = useRef(false);
  // Whether this gesture is selecting or deselecting — decided by the first
  // row it lands on, null until then.
  const paintValueRef = useRef<boolean | null>(null);
  const lastIdRef = useRef<string | null>(null);
  // Rows already handled this gesture. Needed because selectedIds is a render
  // snapshot: several moves can land before React re-renders, so "is it already
  // selected?" goes stale mid-gesture. It also makes dragging back over ground
  // you've covered a no-op rather than a stutter of repeat haptics.
  const paintedRef = useRef<Set<string>>(new Set());
  // A touch whose row wasn't known yet, replayed as measurements arrive.
  const pendingYRef = useRef<number | null>(null);
  // Bumped per gesture so measurements still in flight from the last one are
  // discarded rather than mixed into this one's snapshot.
  const gestureIdRef = useRef(0);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const setSelectedRef = useRef(setSelected);
  setSelectedRef.current = setSelected;
  const onPaintingChangeRef = useRef(onPaintingChange);
  onPaintingChangeRef.current = onPaintingChange;

  const register = useCallback((id: string, view: MeasurableView | null) => {
    if (view) rowsRef.current.set(id, view);
    else rowsRef.current.delete(id);
  }, []);
  const ctx = useMemo(() => ({ register }), [register]);

  const panResponder = useMemo(() => {
    const paintAt = (pageY: number) => {
      const id = rowIdAtY(rectsRef.current, pageY);
      if (id === null) {
        // Either the measurements haven't landed yet or the finger is off the
        // ends of the list. Hold the point so a measurement arriving late can
        // still resolve it — that's what makes a plain tap on a checkbox work,
        // since measureInWindow answers a frame after the touch.
        pendingYRef.current = pageY;
        return;
      }
      pendingYRef.current = null;
      if (id === lastIdRef.current) return;
      const ids = rowIdsBetween(rectsRef.current, lastIdRef.current, id);
      lastIdRef.current = id;
      for (const rowId of ids) {
        if (paintedRef.current.has(rowId)) continue;
        paintedRef.current.add(rowId);
        if (paintValueRef.current === null) {
          paintValueRef.current = !selectedIdsRef.current.has(rowId);
        }
        // Each row is weighed exactly once per gesture, against the selection
        // as it was before the gesture reached it — so this stays accurate even
        // though selectedIds is a render snapshot that lags a fast drag.
        const changed = selectedIdsRef.current.has(rowId) !== paintValueRef.current;
        setSelectedRef.current(rowId, paintValueRef.current);
        // One tick per row that actually flipped: the ratchet that tells you
        // how many you've picked up without looking. Rows already in the target
        // state stay silent, because nothing happened to them.
        if (changed) haptics.tap();
      }
    };

    // Snapshot every mounted row's on-screen band. Once per gesture is enough:
    // the list can't scroll while painting and selection doesn't change any
    // row's height, so the bands hold for the whole drag — and measuring per
    // move would cost a round trip a frame.
    const measureRows = () => {
      rectsRef.current = [];
      const gesture = gestureIdRef.current;
      rowsRef.current.forEach((view, id) => {
        if (typeof view?.measureInWindow !== 'function') return;
        view.measureInWindow((_x, y, _w, h) => {
          // A measurement from a previous gesture describes where the row was
          // then; if the list has scrolled since, folding it in would leave one
          // band pointing at the wrong place.
          if (gestureIdRef.current !== gesture) return;
          if (!Number.isFinite(y) || !(h > 0)) return;
          const next = rectsRef.current.filter(r => r.id !== id);
          next.push({ id, top: y, bottom: y + h });
          next.sort((a, b) => a.top - b.top);
          rectsRef.current = next;
          if (pendingYRef.current !== null) paintAt(pendingYRef.current);
        });
      });
    };

    const endPaint = () => {
      if (!paintingRef.current) return;
      paintingRef.current = false;
      onPaintingChangeRef.current?.(false);
      // Deliberately leaves pendingY/paintValue/painted alone: a measurement
      // from a quick tap can still be in flight, and it should land. The next
      // gesture resets them on grant.
    };

    return PanResponder.create({
      onStartShouldSetPanResponderCapture: e =>
        enabledRef.current && isInPaintGutter(e.nativeEvent.pageX - containerXRef.current),
      onMoveShouldSetPanResponderCapture: () => paintingRef.current,
      // The list must not be able to reclaim the touch part-way through a paint.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: e => {
        gestureIdRef.current += 1;
        paintingRef.current = true;
        paintValueRef.current = null;
        lastIdRef.current = null;
        paintedRef.current = new Set();
        pendingYRef.current = e.nativeEvent.pageY;
        onPaintingChangeRef.current?.(true);
        measureRows();
      },
      onPanResponderMove: e => {
        if (!paintingRef.current) return;
        // Selection mode can end mid-gesture (a bulk action fires and closes
        // it) — stop painting rather than writing into a selection that's on
        // its way out, and give the list its scrolling back.
        if (!enabledRef.current) {
          endPaint();
          return;
        }
        paintAt(e.nativeEvent.pageY);
      },
      onPanResponderRelease: endPaint,
      onPanResponderTerminate: endPaint,
    });
  }, []);

  return (
    <PaintSelectionContext.Provider value={ctx}>
      <View
        ref={containerRef}
        style={[styles.container, style]}
        // The gutter is measured from this container's leading edge, not the
        // window's, so a list that is ever inset still lines up with its rows.
        onLayout={() => {
          containerRef.current?.measureInWindow?.(x => {
            if (Number.isFinite(x)) containerXRef.current = x;
          });
        }}
        {...panResponder.panHandlers}
      >
        {children}
      </View>
    </PaintSelectionContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
