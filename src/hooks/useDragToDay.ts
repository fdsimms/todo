import { useMemo, useRef, useState } from 'react';
import { PanResponder } from 'react-native';
import { haptics } from '../utils/haptics';

/**
 * The gesture half of "hold a row and drop it on a day of the week below".
 *
 * Two surfaces on the meal plan do this and they are the same gesture: a
 * container lifted out of the fridge (LeftoversCard) and a meal lifted off one
 * of the days themselves (MealSlotRow, via MealPlanScreen). What differs
 * between them is only what a release *writes* — planMeal for one, moveEntry
 * for the other — which is the screen's business either way, so it is the
 * screen that receives the positions and none of it lives here.
 *
 * **This is deliberately only the responder lifecycle.** Where the days are,
 * which one a pageY is over and what a release there means all belong to the
 * drop-zone registry the add button already owns (FabDropZones/fabDrop.ts).
 * A second copy of the hit-testing is the thing this hook exists to prevent —
 * the fridge drag was the only caller when it was written inline in
 * LeftoversCard, and the second caller is exactly when a hand-rolled copy
 * would have started drifting from it.
 *
 * Positions are window-space, the one space a PanResponder's `pageY` and a
 * row's `measureInWindow` already agree on, and what FabDropZoneProvider
 * measures its bands in.
 */

interface MeasurableRow {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

/** What a lifted row reports: the lift, a moving finger, and however it ended. */
export interface DayDragHandlers<T> {
  /**
   * Held long enough to lift. `frame` is the row's band on screen, so the
   * floating card can start exactly where the row is rather than jumping to
   * the finger.
   */
  onStart: (item: T, frame: { top: number; height: number }) => void;
  /**
   * `page` is where the finger is now; `translation` is measured from where it
   * was when the drag claimed it. Both axes are reported: down the week picks
   * the day, across a day band picks the meal (see slotAtX in fabDrop.ts).
   */
  onMove: (page: { x: number; y: number }, translation: { x: number; y: number }) => void;
  onEnd: (page: { x: number; y: number }) => void;
  /** Touch lost, app switched — nothing was dropped. */
  onCancel: () => void;
}

export interface DayDragSource<T> {
  /** The lifted row's id, for dimming it. Null between drags. */
  draggingId: string | null;
  /**
   * Spread onto the container the rows sit in — the fridge card, a day's card
   * of meals. Safe to spread onto several containers from one hook: whichever
   * one the touch starts in becomes the responder, and there is only ever one
   * drag in flight.
   */
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  /**
   * Raw touch handlers for that same container, and they are not redundant
   * with the responder: a hold that lifts a row and then releases without
   * travelling never grants the responder at all, so neither release nor
   * terminate fires and the row would be stranded mid-drag with the list still
   * switched off. Both are no-ops unless a drag is actually in flight, and the
   * end is idempotent, so the responder's own release racing this one is
   * harmless.
   */
  containerHandlers: {
    onTouchStart: () => void;
    onTouchEnd: (e: { nativeEvent: { pageX: number; pageY: number } }) => void;
    onTouchCancel: () => void;
  };
  /** Ref callback for a row's measurable wrapper, keyed by the row's id. */
  registerRow: (id: string) => (view: any) => void;
  /** Arm the drag. Wire to the row's `onLongPress`. */
  startDrag: (item: T) => void;
}

/**
 * `drag` omitted leaves every handler inert, so a surface with no week under
 * it keeps its rows tap-only exactly as they were.
 */
export function useDragToDay<T extends { id: string }>(
  drag?: DayDragHandlers<T>,
): DayDragSource<T> {
  // Which row is lifted, twice over: state for the dim, a ref for the gesture
  // handlers, which are created once and would otherwise read a stale closure.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const rowViewsRef = useRef<Map<string, MeasurableRow>>(new Map());
  // Where the finger was when the responder was granted. Null until then: the
  // long-press reports no position, so there is no baseline to measure the
  // floating card's travel against until the first move — same reason
  // SortableList seeds its own at grant rather than at the lift.
  const startPageRef = useRef<{ x: number; y: number } | null>(null);
  // Whether a finger is still down, read by the measurement below.
  const touchDownRef = useRef(false);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const api = useMemo<DayDragSource<T>>(() => {
    const endDrag = (pageX: number, pageY: number) => {
      if (draggingIdRef.current === null) return;
      draggingIdRef.current = null;
      startPageRef.current = null;
      setDraggingId(null);
      dragRef.current?.onEnd({ x: pageX, y: pageY });
    };

    const cancelDrag = () => {
      if (draggingIdRef.current === null) return;
      draggingIdRef.current = null;
      startPageRef.current = null;
      setDraggingId(null);
      dragRef.current?.onCancel();
    };

    /**
     * The long-press landed. The row measures itself first — the screen places
     * the floating card off that band — which costs the frame `measureInWindow`
     * takes to answer, and so has to re-check that the gesture is still live: a
     * measurement arriving after the finger has already gone would arm a drag
     * that nothing can ever end, and an armed drag leaves the week's list
     * unscrollable (see the screen's `scrollEnabled`).
     */
    const startDrag = (item: T) => {
      if (!dragRef.current || draggingIdRef.current !== null) return;
      const view = rowViewsRef.current.get(item.id);
      if (typeof view?.measureInWindow !== 'function') return;
      view.measureInWindow((_x, y, _w, h) => {
        if (!touchDownRef.current || draggingIdRef.current !== null) return;
        if (!Number.isFinite(y) || !(h > 0)) return;
        draggingIdRef.current = item.id;
        setDraggingId(item.id);
        // The card lifting off is the only signal the hold worked — nothing has
        // moved yet. Same pulse SortableList's own lift uses.
        haptics.impactMedium();
        dragRef.current?.onStart(item, { top: y, height: h });
      });
    };

    /**
     * Claims the touch only once a row has been lifted, which is what keeps the
     * rows' taps and their own buttons intact — before the hold this responder
     * says no to everything, so nothing about the surface behaves differently.
     *
     * The enclosing list must be told to hold still for the duration (the
     * screen does it off `onStart`/`onEnd`): this responder is a *descendant*
     * of that scroll view, and a native scroll view only stands down for a JS
     * responder that is one of its ancestors. Without it the scroll wins on the
     * first finger move and the row is put straight back down — the failure
     * SortableList.onDragStateChange documents at length.
     */
    const panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => draggingIdRef.current !== null,
      onMoveShouldSetPanResponderCapture: () => draggingIdRef.current !== null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        startPageRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      },
      onPanResponderMove: e => {
        const start = startPageRef.current;
        if (draggingIdRef.current === null || !start) return;
        const { pageX, pageY } = e.nativeEvent;
        dragRef.current?.onMove(
          { x: pageX, y: pageY },
          { x: pageX - start.x, y: pageY - start.y },
        );
      },
      onPanResponderRelease: e => endDrag(e.nativeEvent.pageX, e.nativeEvent.pageY),
      onPanResponderTerminate: () => cancelDrag(),
    });

    return {
      // Replaced below — the memo holds the handlers, not the state they draw.
      draggingId: null,
      panHandlers: panResponder.panHandlers,
      containerHandlers: {
        onTouchStart: () => { touchDownRef.current = true; },
        onTouchEnd: e => {
          touchDownRef.current = false;
          endDrag(e.nativeEvent.pageX, e.nativeEvent.pageY);
        },
        onTouchCancel: () => { touchDownRef.current = false; cancelDrag(); },
      },
      registerRow: (id: string) => (view: any) => {
        if (view) rowViewsRef.current.set(id, view as MeasurableRow);
        else rowViewsRef.current.delete(id);
      },
      startDrag,
    };
    // Every handler reads refs, so one responder for the life of the surface.
  }, []);

  // One object, and it changes identity only when the lifted row does — never
  // merely because the screen re-rendered. A caller that hands this to a
  // memoized renderItem (MealPlanScreen does) would otherwise rebuild it on
  // every store write and re-render every row of the week, which is the same
  // trap ReorderableList's cached `dragHandlerFor` exists to avoid.
  return useMemo(() => ({ ...api, draggingId }), [api, draggingId]);
}
