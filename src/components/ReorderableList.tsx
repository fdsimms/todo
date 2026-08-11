import React, { useRef, useState, useEffect, useCallback, useImperativeHandle } from 'react';
import {
  View,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type RefreshControlProps,
} from 'react-native';
import {
  moveItem,
  dropIndexFromTranslation,
  dragTranslation,
  rowDragOffset,
  rowIndexAtContentY,
  clampCardToSlots,
} from '../utils/reorder';
import type { DragScroller } from '../utils/fabDrop';
import { useTheme } from '../theme/ThemeContext';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { haptics } from '../utils/haptics';

const ROW_SHIFT_DURATION = 180;

/** Breathing room left above a row scrolled into view by scrollToKey. */
const ROW_SCROLL_MARGIN = 24;
/**
 * How long scrollToKey waits for a row that hasn't laid out yet. Long enough
 * for a section expanded in the same commit to arrive, short enough that a row
 * which never turns up (the caller's data changed under it) can't hijack an
 * unrelated layout minutes later.
 */
const PENDING_SCROLL_TTL = 800;

export interface RowScroller {
  /**
   * Scroll the row with this key into view. A row that hasn't laid out yet —
   * one in a section the caller expanded in the same commit — is scrolled to
   * as soon as it does, rather than being missed.
   */
  scrollToKey: (key: string) => void;
}

export interface ReorderableRenderInfo<T> {
  item: T;
  /** Call from a long-press to begin dragging this row. */
  drag: () => void;
  isActive: boolean;
}

interface Props<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (info: ReorderableRenderInfo<T>) => React.ReactNode;
  /** Called once with the final order when a drag commits. */
  onReorder: (data: T[]) => void;
  onDragBegin?: () => void;
  /** Called once whenever an active drag ends, whether committed, dropped
   * with no change, or cancelled — always after resetDrag's own state
   * clears, so a listener that starts a fresh drag from here is safe.
   * `committed` distinguishes a real drop (the user lifted their finger) from
   * a cancellation (touch loss, app switch, data changing underneath), so a
   * caller acting on its own drop target can tell the two apart — onReorder
   * can't stand in for that, since it stays silent when the drop leaves the
   * order unchanged. */
  onDragEnd?: (info: { committed: boolean }) => void;
  /** Called each time the dragged item shifts to a new slot (e.g. haptics). */
  onHoverChange?: () => void;
  /**
   * Fired on every raw pointer move during a drag with the current
   * horizontal offset from the drag's start (dx), the row index currently
   * hovered (the gap the drop would land in, or null before the first move),
   * and `overIndex` — the row the floating card is physically sitting on top
   * of, measured against the list's resting layout. Purely additive to the
   * existing vertical reorder machinery — e.g. lets a caller detect "dragged
   * right, like an indent" to offer joining the row under the card into a
   * group, without this component needing to know anything about that
   * meaning.
   *
   * `overIndex` is the right input for a whole-row drop target: `hoverIndex`
   * describes a gap, and while rows are displaced to open that gap the row
   * it names is no longer where the user sees it. `dropDisabled` freezes the
   * displacement so the two agree again.
   */
  onDragMove?: (info: { dx: number; hoverIndex: number | null; overIndex: number | null }) => void;
  /**
   * Suspends reordering for the rest of the drag while true: the list settles
   * back to its resting layout (no gap opens, no rows shift) and a drop
   * commits no reorder. For callers whose drag has been "captured" by another
   * drop target — dropping onto a row rather than between rows — so the list
   * stops moving underneath the card the user is aiming.
   */
  dropDisabled?: boolean;
  /**
   * Row the drag will be absorbed into on release (paired with
   * `dropDisabled`). The floating card settles onto that row and dissolves
   * instead of gliding back to the slot it came from, so the drop reads as
   * "it went in there" rather than "it snapped back and then vanished".
   */
  dropIntoIndex?: number | null;
  /** Restricts how far the active row may move, e.g. to keep it within its own section. */
  dragRange?: (data: T[], activeIndex: number) => [number, number];
  /** Style for the slot shown where the dragged item will land. */
  placeholderStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  ListEmptyComponent?: React.ReactNode;
  /**
   * Rendered above the rows and scrolling with them — Today's pinned block.
   *
   * It is a child of the ScrollView rather than of the container View, and it
   * has to stay that way. Rows report their tops via onLayout, i.e. in scroll
   * *content* coordinates, while calibrateOverlayBase measures against
   * `containerRef` and writes the result into that same map — sound only
   * because the ScrollView sits at y=0 in the container. A header hung in the
   * container instead would add its height to one of those two numbers and not
   * the other, silently offsetting the drag card and every drop gap by exactly
   * that much. Inside the ScrollView it just shifts every row alike, which the
   * math (all measured, never assumed) absorbs.
   *
   * Unmeasured and unkeyed: it never enters the drag maps, so it can't be
   * dragged, dropped onto, or displaced.
   */
  ListHeaderComponent?: React.ReactNode;
  ListFooterComponent?: React.ReactNode;
  onScrollBeginDrag?: () => void;
  /**
   * Fires when a scroll comes to rest — finger lifted, or momentum spent. For
   * callers that want to act on "the user has finished moving the list" rather
   * than on the scroll starting, so a layout change lands between gestures
   * instead of under a moving finger.
   */
  onScrollSettle?: () => void;
  /** Called when the scroll position nears the bottom of the content, e.g. to page in more data. */
  onEndReached?: () => void;
  /** Distance in px from the bottom at which onEndReached fires. Defaults to 300. */
  onEndReachedThreshold?: number;
  /**
   * Lets the caller suspend scrolling from the outside — e.g. while a
   * paint-select gesture owns the touch. Purely ANDed with the drag's own
   * suspension; it can't re-enable scrolling during a drag.
   */
  scrollEnabled?: boolean;
  /**
   * Filled with a handle for scrolling this list from the outside, for the
   * add-button drag's autoscroll (FabDropZones) — that gesture belongs to the
   * button, not to a row, so it can't go through the drag machinery below.
   *
   * A prop rather than the component's own ref because this component is
   * generic and forwardRef isn't; and read-and-scroll rather than a scroll view
   * ref because the caller needs the same clamped offset this component tracks.
   */
  scrollControlRef?: React.Ref<DragScroller>;
  /**
   * Filled with a handle for scrolling a single row into view by key, for
   * jumping to a task from outside the list (the new-todos banner). Separate
   * from `scrollControlRef` because that one is the drag autoscroll's contract
   * — offsets in, offsets out — and knows nothing about rows.
   */
  rowScrollerRef?: React.Ref<RowScroller>;
}

const DEFAULT_ROW_HEIGHT = 52;
const AUTOSCROLL_ZONE = 72;
const AUTOSCROLL_STEP = 8;
const AUTOSCROLL_INTERVAL_MS = 16;

/**
 * A reorderable list that is structurally immune to "stranded cell" bugs:
 * rows are plain flow-layout views with NO transforms at rest, so there is no
 * resting offset that can be left in a bad state. While dragging, the active
 * row becomes an invisible placeholder (the gap) and a finger-anchored overlay
 * floats above the list. Any interruption (touch loss, app switch, screenshot)
 * resets to the plain layout without committing.
 *
 * Rows can be any height — section headers shorter than task rows are fine —
 * because drop targeting walks real measured heights (see reorder.ts).
 *
 * Drag initiation keeps the same contract as before: a row's long-press calls
 * the provided `drag()`, after which this component captures the rest of the
 * touch via the responder system.
 */
export function ReorderableList<T>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
  onDragBegin,
  onDragEnd,
  onHoverChange,
  onDragMove,
  dropDisabled = false,
  dropIntoIndex = null,
  dragRange,
  placeholderStyle,
  contentContainerStyle,
  refreshControl,
  ListEmptyComponent,
  ListHeaderComponent,
  ListFooterComponent,
  onScrollBeginDrag,
  onScrollSettle,
  onEndReached,
  onEndReachedThreshold = 300,
  scrollEnabled = true,
  scrollControlRef,
  rowScrollerRef,
}: Props<T>) {
  const { shadows } = useTheme();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // The committed order, rendered locally the instant a drop lands. This is
  // set in the SAME state batch as the drag reset, so the first frame after
  // the overlay disappears is guaranteed to show the new order — the parent's
  // data refresh (via onReorder → store → props) may land a frame later, and
  // without this the list briefly flashed the old order on drop. Cleared as
  // soon as the data prop changes (the parent caught up).
  const [committedData, setCommittedData] = useState<T[] | null>(null);
  // Overlay top position (viewport coords) at drag start; finger movement is
  // applied via the Animated translate values so moves don't re-render the
  // list. The card follows the finger in both axes (X is purely cosmetic —
  // drop targeting stays vertical).
  const [overlayBaseTop, setOverlayBaseTop] = useState(0);
  const overlayY = useRef(new Animated.Value(0)).current;
  const overlayX = useRef(new Animated.Value(0)).current;
  const overlayScale = useRef(new Animated.Value(1.03)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  // Owns the scroll ref so it can pull the list back out of a keyboard inset
  // it was left parked in (see the hook).
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();
  const scrollRef = keyboardScroll.ref;
  const dataRef = useRef(data);
  const onReorderRef = useRef(onReorder);
  const onDragEndRef = useRef(onDragEnd);
  const activeIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const startPageYRef = useRef(0);
  const lastPageYRef = useRef(0);
  const startPageXRef = useRef(0);
  const onHoverChangeRef = useRef(onHoverChange);
  const onDragMoveRef = useRef(onDragMove);
  const dropDisabledRef = useRef(dropDisabled);
  const dropIntoIndexRef = useRef(dropIntoIndex);
  dropIntoIndexRef.current = dropIntoIndex;
  const dragRangeRef = useRef(dragRange);
  const onEndReachedRef = useRef(onEndReached);
  const onEndReachedThresholdRef = useRef(onEndReachedThreshold);
  const endReachedFiredRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const scrollOffsetAtStartRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const layoutYRef = useRef<Map<string, number>>(new Map());
  // translateY per row, owned here so they can be reset synchronously on commit
  // (a child-owned value would reset a frame late and flash). Rows rest at 0.
  const rowOffsetsRef = useRef<Map<string, Animated.Value>>(new Map());
  // The offset each row is currently animating toward, so a hover change only
  // restarts the animations whose targets actually moved.
  const rowTargetsRef = useRef<Map<string, number>>(new Map());
  const autoscrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against commitDrag re-entry while the drop animation runs (it can
  // be invoked from both onTouchEnd and onPanResponderRelease).
  const committingRef = useRef(false);
  // Mirrors overlayBaseTop state so the stable PanResponder callbacks read the
  // latest value.
  const overlayBaseTopRef = useRef(0);
  // Content-Y the dragged row rested at when the finger took hold of it. The
  // card's anchor describes that spot, so a later measurement may only re-pin
  // the anchor while the row is still there (see calibrateOverlayBase).
  const dragStartRowTopRef = useRef(0);
  // Set once the list re-lays out under a live drag, which is the point the
  // anchor stops being re-pinnable: the row's slot has moved but the finger
  // hasn't, and the card belongs to the finger (see calibrateOverlayBase).
  const listMovedRef = useRef(false);
  // How far the card has been shifted off the finger to keep it in reach of the
  // list (see reanchorCardIntoRange). Kept apart from the finger baseline it
  // corrects, because onPanResponderGrant rewrites that baseline on the first
  // move of the drag and would otherwise wipe a correction made before it.
  const cardShiftRef = useRef(0);
  const containerRef = useRef<View | null>(null);
  const rowViewsRef = useRef<Map<string, View>>(new Map());

  // What the rows currently render. Kept in a ref (assigned during render) so
  // the gesture handlers always operate on the same array the user is seeing.
  const renderData = committedData ?? data;
  dataRef.current = renderData;
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);
  useEffect(() => { onDragEndRef.current = onDragEnd; }, [onDragEnd]);
  useEffect(() => { onHoverChangeRef.current = onHoverChange; }, [onHoverChange]);
  useEffect(() => { onDragMoveRef.current = onDragMove; }, [onDragMove]);
  useEffect(() => { dragRangeRef.current = dragRange; }, [dragRange]);
  useEffect(() => { onEndReachedRef.current = onEndReached; }, [onEndReached]);
  useEffect(() => { onEndReachedThresholdRef.current = onEndReachedThreshold; }, [onEndReachedThreshold]);
  // A newly-grown data set may still be within the threshold (e.g. the page
  // just added wasn't enough to clear it) — let the next scroll re-fire
  // rather than staying latched from before the content grew.
  useEffect(() => { endReachedFiredRef.current = false; }, [data.length]);

  // Whenever the parent re-renders with data (the source of truth once it has
  // caught up after a drop), drop the local committed copy. Keyed on the data
  // reference, NOT its key sequence: a drop whose regrouped result has the same
  // sequence it started with (e.g. a task dragged out and snapping back) still
  // needs the raw committed copy cleared, or the list stays stuck on it.
  useEffect(() => {
    if (activeIndexRef.current === null) setCommittedData(null);
    // Forget the measurements of rows that are no longer in the list — a row
    // hidden by a collapsed section leaves its last content-Y behind, and a
    // position nothing is at is worse than no position: scrollToKey would
    // scroll to where the row used to be instead of waiting for it to come
    // back. Pruned from here rather than from the row's ref callback, which
    // React tears down and re-runs on every render (the callback is inline),
    // taking live measurements with it.
    const live = new Set(data.map(keyExtractor));
    for (const key of Array.from(layoutYRef.current.keys())) {
      if (!live.has(key)) {
        layoutYRef.current.delete(key);
        heightsRef.current.delete(key);
      }
    }
    // A ScrollView's native scroll offset isn't automatically clamped when its
    // content shrinks (e.g. a bulk edit removes most of the visible rows) —
    // the viewport can be left scrolled past the end of the new, shorter
    // content, rendering blank and refusing to scroll (nothing left to pull
    // it back up). Snap back to top whenever the data goes empty; for a
    // partial shrink, onContentSizeChange (below) catches the case where the
    // current offset now overshoots the new content.
    if (data.length === 0 && scrollOffsetRef.current > 0) {
      scrollOffsetRef.current = 0;
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [data]);

  // Cancel an in-progress drag only if the actual items changed underneath it.
  const dataKeySignature = data.map(keyExtractor).join('\u0000');
  useEffect(() => {
    if (activeIndexRef.current !== null && !committingRef.current) resetDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKeySignature]);

  // Same optimistic bookkeeping this component's own autoscroll does: record
  // the offset as commanded, because the scroll event confirming it lands a
  // frame later and a caller stepping every frame would keep re-issuing the
  // offset it already asked for.
  useImperativeHandle(scrollControlRef, () => ({
    getOffset: () => scrollOffsetRef.current,
    getMaxOffset: () => Math.max(0, contentHeightRef.current - viewportHeightRef.current),
    scrollToOffset: (y: number) => {
      scrollOffsetRef.current = y;
      scrollRef.current?.scrollTo({ y, animated: false });
    },
  }), [scrollRef]);

  // A key waiting for its row to lay out, armed by scrollToKey below and
  // claimed by that row's onLayout.
  const pendingScrollKeyRef = useRef<string | null>(null);
  const pendingScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPendingScroll = () => {
    pendingScrollKeyRef.current = null;
    if (pendingScrollTimerRef.current) clearTimeout(pendingScrollTimerRef.current);
    pendingScrollTimerRef.current = null;
  };
  useEffect(() => clearPendingScroll, []);

  // Deliberately NOT clamped to the content: contentHeightRef is only as fresh
  // as the last onContentSizeChange, and the row this lands on is often one
  // that just appeared — so a clamp computed here would under-scroll on
  // exactly the jump it exists to serve. The scroll view clamps natively.
  const scrollRowIntoView = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - ROW_SCROLL_MARGIN), animated: true });
  }, [scrollRef]);

  useImperativeHandle(rowScrollerRef, () => ({
    scrollToKey: (key: string) => {
      clearPendingScroll();
      const y = layoutYRef.current.get(key);
      if (y !== undefined) {
        scrollRowIntoView(y);
        return;
      }
      pendingScrollKeyRef.current = key;
      pendingScrollTimerRef.current = setTimeout(clearPendingScroll, PENDING_SCROLL_TTL);
    },
  }), [scrollRowIntoView]);

  const stopAutoscroll = () => {
    if (autoscrollTimerRef.current !== null) {
      clearInterval(autoscrollTimerRef.current);
      autoscrollTimerRef.current = null;
    }
  };

  const resetDrag = useCallback((committed = false) => {
    stopAutoscroll();
    committingRef.current = false;
    activeIndexRef.current = null;
    hoverIndexRef.current = null;
    setActiveIndex(null);
    onDragEndRef.current?.({ committed });
    // Do NOT reset the overlay's animated values here: the native view obeys
    // setValue immediately, while React unmounts the overlay a frame later —
    // zeroing the translates snapped the card back to its drag-start position
    // for one visible frame (the "flash to old spot" on drop). The values are
    // re-initialized in startDrag before the overlay mounts again.
  }, []);

  const currentHeights = (): number[] =>
    dataRef.current.map(item => heightsRef.current.get(keyExtractor(item)) ?? DEFAULT_ROW_HEIGHT);

  const getRowOffset = (key: string): Animated.Value => {
    let v = rowOffsetsRef.current.get(key);
    if (!v) {
      v = new Animated.Value(0);
      rowOffsetsRef.current.set(key, v);
    }
    return v;
  };

  const settleRowOffsets = () => {
    rowOffsetsRef.current.forEach(v => v.setValue(0));
    rowTargetsRef.current.clear();
  };

  // Measured content-Y of the gap the dragged item will drop into (matches the
  // real laid-out positions, so it's correct regardless of list padding).
  const gapContentY = (a: number, t: number): number => {
    const key = (i: number) => keyExtractor(dataRef.current[i]!);
    const y = (i: number) => layoutYRef.current.get(key(i)) ?? 0;
    const h = (i: number) => heightsRef.current.get(key(i)) ?? DEFAULT_ROW_HEIGHT;
    return t >= a ? y(t) + h(t) - h(a) : y(t);
  };

  // Slide rows as the hover target moves: the resting rows open/close the gap,
  // and the (invisible) placeholder row glides to the gap carrying the slot
  // marker. The placeholder moving via its own transform keeps the marker in
  // normal flow, so it can't be thrown off by list padding.
  //
  // Driven imperatively from updateHover rather than via React state: a hover
  // change re-rendering the whole list (every row's renderItem) made long
  // lists visibly stutter during a drag. Rows the change doesn't displace are
  // skipped, so crossing one slot animates only the row(s) that swap, not all
  // of them.
  const animateRowsForHover = (t: number) => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    const heights = currentHeights();
    const activeHeight = heights[ai] ?? DEFAULT_ROW_HEIGHT;
    const activeKey = keyExtractor(dataRef.current[ai]!);
    const activeY = layoutYRef.current.get(activeKey) ?? 0;
    const gapY = gapContentY(ai, t);
    dataRef.current.forEach((item, i) => {
      const key = keyExtractor(item);
      const target = i === ai ? gapY - activeY : rowDragOffset(i, ai, t, activeHeight);
      // Rows rest at 0 (settleRowOffsets runs at drag start), so a missing
      // entry means the row hasn't been displaced yet.
      if ((rowTargetsRef.current.get(key) ?? 0) === target) return;
      rowTargetsRef.current.set(key, target);
      Animated.timing(getRowOffset(key), {
        toValue: target,
        duration: ROW_SHIFT_DURATION,
        // JS-driven on purpose: the row transform is removed (style → plain) in
        // the same React render that commits the new order. A native-driven
        // value can stay attached to the native view after its style prop is
        // removed, leaving the row translated on top of another (overlap). A
        // JS value is applied per render, so it clears cleanly and atomically.
        useNativeDriver: false,
      }).start();
    });
  };

  // On-screen tops of the drop slots at the two ends of this drag's range —
  // where the card would come to rest at either extreme, so they're the span it
  // is allowed to float across (see clampCardToSlots). Null when there's
  // nothing to measure against.
  const cardTopLimits = (): [number, number] | null => {
    const ai = activeIndexRef.current;
    const list = dataRef.current;
    if (ai === null || list.length === 0) return null;
    const last = list.length - 1;
    const range = dragRangeRef.current?.(list, ai) ?? [0, last];
    const lo = Math.max(0, Math.min(last, range[0]));
    const hi = Math.max(0, Math.min(last, range[1]));
    const scroll = scrollOffsetRef.current;
    return [gapContentY(ai, lo) - scroll, gapContentY(ai, hi) - scroll];
  };

  // Where the finger is holding the card: the anchor it was pinned to when it
  // took hold of the row, plus everything it has moved since (and any shift a
  // re-layout has charged it — see reanchorCardIntoRange).
  const cardTopRaw = (): number =>
    overlayBaseTopRef.current + cardShiftRef.current + (lastPageYRef.current - startPageYRef.current);

  // Top edge of the floating card in the container's coordinates: the above,
  // held within the slots the drag can actually reach. The single source of
  // truth for where the card is — the drop gap, the autoscroll zones and the
  // hit test all read it, so none of them can disagree with what the user can
  // see.
  const cardTopNow = (): number => {
    const raw = cardTopRaw();
    const limits = cardTopLimits();
    return limits === null ? raw : clampCardToSlots(raw, limits[0], limits[1]);
  };

  // Draw the card wherever cardTopNow says it is. The overlay renders from this
  // translate alone, so anything that can move the card without the finger
  // moving — the list re-laying out under it, an autoscroll step sliding the
  // clamp — has to run this, or the drawn card and the drop gap drift apart.
  const syncOverlayToCard = () => {
    overlayY.setValue(cardTopNow() - overlayBaseTopRef.current);
  };

  /**
   * Hand the finger the card back after a re-layout stranded it out of reach.
   *
   * A card the clamp has to catch is one the list has moved out from under: the
   * finger is holding a slot that no longer exists anywhere near it. Put the
   * card back on the slot the drop is actually aimed at — the row's own
   * placeholder at the start of a drag, whatever gap the user had opened later
   * on — so the card is where the eye expects to find its row after the layout
   * settles.
   *
   * The correction is carried alongside the finger's travel, not folded into
   * the anchor: the anchor still describes the grab (see calibrateOverlayBase),
   * and the finger keeps driving the card point for point from this moment on.
   * Leaving the clamp to do this alone would instead give the drag a dead zone
   * as deep as the distance the list moved — a category header grabbed from the
   * bottom of a scrolled screen lands its run of headers a screenful above the
   * finger, and every one of those points would have to be dragged back before
   * the card left the end it was pressed against.
   *
   * The card is no longer under the finger afterwards — neither is the row it
   * stands for, which is what a collapse does — but the drop gap follows the
   * card, so what the user aims is what they see.
   */
  const reanchorCardIntoRange = () => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    // In reach, so the finger is still the better authority — leave it alone.
    if (cardTopRaw() === cardTopNow()) return;
    const slot = gapContentY(ai, hoverIndexRef.current ?? ai) - scrollOffsetRef.current;
    cardShiftRef.current += slot - cardTopRaw();
    syncOverlayToCard();
  };

  // Content-Y of the middle of the floating card, i.e. where it actually sits
  // over the list right now. cardTopNow is container-relative, so the scroll
  // offset converts it back to content coordinates.
  const cardCenterContentY = (): number | null => {
    const ai = activeIndexRef.current;
    if (ai === null) return null;
    const activeKey = keyExtractor(dataRef.current[ai]!);
    const activeHeight = heightsRef.current.get(activeKey) ?? DEFAULT_ROW_HEIGHT;
    return cardTopNow() + scrollOffsetRef.current + activeHeight / 2;
  };

  // The row the card is on top of, measured against resting layout (see the
  // onDragMove docs for why resting rather than displaced).
  const rowUnderCard = (): number | null => {
    const y = cardCenterContentY();
    if (y === null) return null;
    // One pass over the rows (this runs on every pointer move, so it stays as
    // cheap as the hover math next to it).
    const tops: number[] = [];
    const heights: number[] = [];
    for (const item of dataRef.current) {
      const key = keyExtractor(item);
      tops.push(layoutYRef.current.get(key) ?? 0);
      heights.push(heightsRef.current.get(key) ?? DEFAULT_ROW_HEIGHT);
    }
    return rowIndexAtContentY(tops, heights, y);
  };

  const updateHover = () => {
    const ai = activeIndexRef.current;
    // Frozen: leave hoverIndex wherever the caller's capture left it (its own
    // slot, per the effect below) so nothing shifts under the card.
    if (dropDisabledRef.current) return;
    if (ai === null) return;
    // Measured from the card against the row's live resting slot, NOT from the
    // finger's own travel: the list can re-lay out mid-drag (a category drag
    // collapses every section under it), which moves that slot while the finger
    // delta still describes the old layout. See dragTranslation.
    const activeKey = keyExtractor(dataRef.current[ai]!);
    let next = dropIndexFromTranslation(
      currentHeights(),
      ai,
      dragTranslation(
        cardTopNow(),
        layoutYRef.current.get(activeKey) ?? 0,
        scrollOffsetRef.current,
      ),
    );
    const range = dragRangeRef.current?.(dataRef.current, ai);
    if (range) next = Math.max(range[0], Math.min(range[1], next));
    if (next !== hoverIndexRef.current) {
      hoverIndexRef.current = next;
      animateRowsForHover(next);
      onHoverChangeRef.current?.();
    }
  };

  // Entering the frozen state closes any gap that was open (rows animate back
  // to rest and the drop slot returns to the dragged row's own position);
  // leaving it re-targets from wherever the finger currently is.
  useEffect(() => {
    dropDisabledRef.current = dropDisabled;
    const ai = activeIndexRef.current;
    if (ai === null) return;
    if (dropDisabled) {
      if (hoverIndexRef.current !== ai) {
        hoverIndexRef.current = ai;
        animateRowsForHover(ai);
      }
    } else {
      updateHover();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropDisabled]);

  const maybeAutoscroll = () => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    // Card position within the viewport.
    const overlayTopNow = cardTopNow();
    const viewport = viewportHeightRef.current;
    let step = 0;
    if (overlayTopNow < AUTOSCROLL_ZONE) step = -AUTOSCROLL_STEP;
    else if (overlayTopNow > viewport - AUTOSCROLL_ZONE) step = AUTOSCROLL_STEP;

    if (step === 0) {
      stopAutoscroll();
      return;
    }
    if (autoscrollTimerRef.current === null) {
      autoscrollTimerRef.current = setInterval(() => {
        const maxOffset = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
        const next = Math.max(0, Math.min(maxOffset, scrollOffsetRef.current + step));
        if (next === scrollOffsetRef.current) {
          stopAutoscroll();
          return;
        }
        scrollOffsetRef.current = next;
        scrollRef.current?.scrollTo({ y: next, animated: false });
        // Scrolling slides the clamp's slots up the screen with the rest of
        // the list, so a card resting against one has to be redrawn even though
        // the finger hasn't moved.
        syncOverlayToCard();
        updateHover();
      }, AUTOSCROLL_INTERVAL_MS);
    }
  };

  const commitDrag = useCallback(() => {
    const ai = activeIndexRef.current;
    if (ai === null || committingRef.current) return;
    committingRef.current = true;
    stopAutoscroll();

    const hi = hoverIndexRef.current;
    const result = hi !== null && hi !== ai ? moveItem(dataRef.current, ai, hi) : null;

    // Where the card finishes: onto the row that's absorbing it if the caller
    // claimed the drop, otherwise into the open gap (the same content position
    // the displaced rows opened up). Committing only after the card covers the
    // destination masks the overlay→row swap.
    const into = dropIntoIndexRef.current;
    const intoItem = into !== null && into >= 0 && into !== ai ? dataRef.current[into] : undefined;
    const slotContentY = intoItem !== undefined
      ? (layoutYRef.current.get(keyExtractor(intoItem)) ?? 0)
      : gapContentY(ai, hi ?? ai);
    const slotTop = slotContentY - scrollOffsetRef.current;
    Animated.parallel([
      Animated.timing(overlayY, {
        toValue: slotTop - overlayBaseTopRef.current,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(overlayX, { toValue: 0, duration: 160, useNativeDriver: true }),
      // Absorbed drops shrink and fade into the target row; ordinary drops
      // just settle back to their resting size.
      Animated.timing(overlayScale, {
        toValue: intoItem !== undefined ? 0.88 : 1,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: intoItem !== undefined ? 0 : 1,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Commit in one atomic React render: new order (committedData) AND
      // isDragging false, which switches rows from their animated transform to
      // a plain (transform-free) style. Because no native animated value is
      // involved at rest, there's no native-vs-JS race — the rows land exactly
      // where the last drag frame left them. committedData also makes that
      // first frame show the new order regardless of parent/store timing.
      if (result) setCommittedData(result);
      resetDrag(true);
      if (result) onReorderRef.current(result);
    });
  }, [resetDrag, keyExtractor, overlayY, overlayX, overlayScale, overlayOpacity]);

  /**
   * Ask the shadow tree where the dragged row REALLY is, and pin the floating
   * card to it if that is still the slot the finger took hold of.
   *
   * Everything about a drag is derived from the dragged row's content-Y: the
   * card's anchor at drag start, and the drop gap on every move after it (see
   * dragTranslation). layoutYRef is the JS copy of that number and it is only
   * as fresh as the last onLayout — a height animation still settling, or a
   * list re-laid out in the same tick the drag began, leaves it describing a
   * layout the user can't see any more. `measureLayout` answers from the
   * shadow tree, so it is the row's position as of the last commit however far
   * behind the onLayout callbacks are, and it is what layoutYRef should have
   * said. Write it there.
   *
   * `measureLayout` reports in the layout tree, NOT on screen: a scroll view's
   * content sits at origin 0 there however far the list is scrolled (Fabric
   * gates the content-origin offset behind `includeTransform`, which
   * `dom::measureLayout` passes as false; Paper's shadow-view walk has no
   * notion of it). So `y` is a content-Y, directly comparable to onLayout's,
   * and the scroll offset is all that separates it from an on-screen position.
   *
   * The card's anchor is a different question and only some of these
   * measurements can speak to it. It describes where the row rested when the
   * finger grabbed it, so it may only be re-pinned while the row is still
   * resting there — the stale-layout case above. Once the LIST moves the row
   * instead (a category header's drag auto-collapses every section, shifting it
   * up by a screenful of task rows), its new slot is nowhere near the finger,
   * and re-pinning to it is what left the card floating a screen from the
   * finger. Then the anchor stays put, the drop gap re-derives from the card,
   * and the two still agree. Where the card *goes* when a re-layout leaves it
   * out of reach of the list entirely is a separate question, settled by the
   * finger's baseline rather than by the anchor — see reanchorCardIntoRange.
   */
  const calibrateOverlayBase = (key: string, rowTop: number) => {
    const rowView = rowViewsRef.current.get(key);
    const container = containerRef.current;
    if (!rowView || !container || typeof rowView.measureLayout !== 'function') return;
    try {
      rowView.measureLayout(
        container as any,
        (_x: number, y: number, _w: number, h: number) => {
          // Bail if the drag ended (or is landing) before the measurement came
          // back — moving the base then would yank the card mid-flight.
          if (activeIndexRef.current === null || committingRef.current) return;
          if (!Number.isFinite(y)) return;
          // The row's own numbers, refreshed whatever else is true below: they
          // describe the row, not the grab.
          layoutYRef.current.set(key, y);
          if (Number.isFinite(h) && h > 0) heightsRef.current.set(key, h);
          // Everything from here re-pins the anchor. Not once a hover change
          // has displaced the rows, not once the list has scrolled out from
          // under a card that stays with the finger through autoscroll, and not
          // once the list has re-laid out — in all three the row is no longer
          // resting where the anchor describes.
          if (hoverIndexRef.current !== activeIndexRef.current) return;
          if (scrollOffsetRef.current !== scrollOffsetAtStartRef.current) return;
          if (listMovedRef.current) return;
          // Compared against the caller's rowTop, not `y`: the two differ
          // exactly when layoutYRef was stale, which is the case this re-pin
          // exists for. `y` differing from where the row started means the list
          // moved it — the card belongs to the finger now (see the note above).
          if (rowTop !== dragStartRowTopRef.current) return;
          // The anchor now describes the measured slot, so that is what a later
          // measurement has to match to still count as "the row hasn't moved".
          // Leaving the stale value here would keep re-answering that question
          // against a position the row was never actually at.
          dragStartRowTopRef.current = y;
          const base = y - scrollOffsetAtStartRef.current;
          overlayBaseTopRef.current = base;
          setOverlayBaseTop(base);
        },
        () => {},
      );
    } catch {
      // Measurement is a refinement, not a requirement — the derived base above
      // still gets the drag off the ground.
    }
  };

  const startDrag = (index: number, key: string) => {
    if (activeIndexRef.current !== null) return;
    const rowTop = layoutYRef.current.get(key) ?? 0;
    // Clear any leftover transform from the previous drag before these values
    // become live again (rows only apply them while isDragging is true).
    settleRowOffsets();
    activeIndexRef.current = index;
    hoverIndexRef.current = index;
    scrollOffsetAtStartRef.current = scrollOffsetRef.current;
    dragStartRowTopRef.current = rowTop;
    listMovedRef.current = false;
    // The pan hasn't captured yet, so anchor to the row; the first move event
    // establishes the finger baseline.
    startPageYRef.current = 0;
    lastPageYRef.current = 0;
    startPageXRef.current = 0;
    cardShiftRef.current = 0;
    const baseTop = rowTop - scrollOffsetRef.current;
    overlayBaseTopRef.current = baseTop;
    setOverlayBaseTop(baseTop);
    calibrateOverlayBase(key, rowTop);
    overlayY.setValue(0);
    overlayX.setValue(0);
    overlayScale.setValue(1.03);
    overlayOpacity.setValue(1);
    setActiveIndex(index);
    // Fired here rather than left to each caller: the lift is the only
    // confirmation that a long-press became a drag, and callers that forgot it
    // (the categories screen) felt broken next to the ones that didn't. Callers
    // must NOT add their own on top.
    haptics.impactMedium();
    onDragBegin?.();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => activeIndexRef.current !== null,
      onMoveShouldSetPanResponderCapture: () => activeIndexRef.current !== null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        startPageYRef.current = e.nativeEvent.pageY;
        lastPageYRef.current = e.nativeEvent.pageY;
        startPageXRef.current = e.nativeEvent.pageX;
        // startDrag pinned the card from layoutYRef, which is only as fresh as
        // the last onLayout — a height animation still settling (or one whose
        // frames never made it back to JS) leaves it describing a layout the
        // user can't see any more, and startDrag's own measurement resolves a
        // frame later, often into that same window. The finger has just moved,
        // so measure again: as long as the row is still resting in the slot it
        // was grabbed from, that measurement is the ground truth the base is
        // supposed to describe (and if it isn't, calibrateOverlayBase leaves
        // the base alone rather than yanking the card off the finger).
        const ai = activeIndexRef.current;
        if (ai === null) return;
        const activeKey = keyExtractor(dataRef.current[ai]!);
        calibrateOverlayBase(activeKey, layoutYRef.current.get(activeKey) ?? 0);
      },
      onPanResponderMove: e => {
        if (activeIndexRef.current === null || committingRef.current) return;
        lastPageYRef.current = e.nativeEvent.pageY;
        syncOverlayToCard();
        const dx = e.nativeEvent.pageX - startPageXRef.current;
        overlayX.setValue(dx);
        updateHover();
        maybeAutoscroll();
        onDragMoveRef.current?.({ dx, hoverIndex: hoverIndexRef.current, overIndex: rowUnderCard() });
      },
      onPanResponderRelease: () => commitDrag(),
      onPanResponderTerminate: () => {
        // A terminate during the drop animation is cleaned up by the
        // animation's completion; resetting here would yank the gliding card.
        if (!committingRef.current) resetDrag();
      },
    }),
  ).current;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
    if (!onEndReachedRef.current) return;
    const distanceFromEnd = contentHeightRef.current - viewportHeightRef.current - scrollOffsetRef.current;
    if (distanceFromEnd < onEndReachedThresholdRef.current) {
      if (!endReachedFiredRef.current) {
        endReachedFiredRef.current = true;
        onEndReachedRef.current();
      }
    } else {
      endReachedFiredRef.current = false;
    }
  };

  const isDragging = activeIndex !== null;
  const activeKey = isDragging ? keyExtractor(renderData[activeIndex]!) : null;
  const activeItem = isDragging ? renderData[activeIndex]! : null;

  return (
    <View ref={containerRef} style={styles.container} {...panResponder.panHandlers} onTouchEnd={commitDrag}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        scrollEnabled={scrollEnabled && !isDragging}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onLayout={(e: LayoutChangeEvent) => { viewportHeightRef.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_w, h) => {
          contentHeightRef.current = h;
          // Same clamp as the data-empty case above, for shrinks that leave
          // some rows (not zero) but fewer than the current scroll offset
          // can show.
          const maxOffset = Math.max(0, h - viewportHeightRef.current);
          if (scrollOffsetRef.current > maxOffset) {
            scrollOffsetRef.current = maxOffset;
            scrollRef.current?.scrollTo({ y: maxOffset, animated: false });
          }
          // The content resizing under a live drag means the list re-laid out,
          // so the dragged row's slot has moved. The drop gap is derived from
          // that slot on every move, and a category drag collapses every
          // section in the very tick it begins — too early for the row's own
          // onLayout to have brought the new position back. Take it from the
          // shadow tree instead, which is already committed by now.
          const ai = activeIndexRef.current;
          if (ai === null || committingRef.current) return;
          listMovedRef.current = true;
          const key = keyExtractor(dataRef.current[ai]!);
          calibrateOverlayBase(key, layoutYRef.current.get(key) ?? 0);
          // The re-layout can also leave the card out of reach of every slot it
          // could drop into — a category drag collapses the header run up to
          // the top of the screen while the finger stays where it grabbed from,
          // a screenful below. Bring it back to the list and count the drag
          // from there. One frame later, because the rows' own onLayout
          // callbacks — which the reachable slots are measured from — are still
          // in flight at this point.
          requestAnimationFrame(() => {
            if (activeIndexRef.current === null || committingRef.current) return;
            reanchorCardIntoRange();
            updateHover();
          });
        }}
        contentContainerStyle={contentContainerStyle}
        refreshControl={refreshControl}
        onScrollBeginDrag={onScrollBeginDrag}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        {...keyboardScroll.props}
        // Composed on top of the keyboard hook's handlers, not spread before
        // them: it claims both of these itself to keep its recorded offset
        // fresh (see useKeyboardInsetScroll), so replacing either would strand
        // the list the next time the keyboard closes over it.
        onScrollEndDrag={e => {
          keyboardScroll.props.onScrollEndDrag(e);
          onScrollSettle?.();
        }}
        onMomentumScrollEnd={e => {
          keyboardScroll.props.onMomentumScrollEnd(e);
          onScrollSettle?.();
        }}
      >
        {ListHeaderComponent}
        {renderData.length === 0 && ListEmptyComponent}
        {renderData.map(item => {
          const key = keyExtractor(item);
          // Rows render in their ORIGINAL order; displacement is purely a
          // transform, which keeps the scroll layout stable (so the transforms
          // animate) and onLayout reporting true resting positions.
          const isPlaceholder = key === activeKey;
          return (
            <Animated.View
              key={key}
              // Kept so a drag can measure the row's real on-screen position
              // rather than inferring it from content-Y (see
              // calibrateOverlayBase).
              ref={(r: View | null) => {
                if (r) rowViewsRef.current.set(key, r);
                else rowViewsRef.current.delete(key);
              }}
              pointerEvents={isPlaceholder ? 'none' : 'auto'}
              // Animated transform ONLY while dragging. At rest the style is
              // plain, so the commit render (new order + no transform) is one
              // atomic React commit with no native animated value to race.
              style={isDragging ? { transform: [{ translateY: getRowOffset(key) }] } : undefined}
              onLayout={e => {
                heightsRef.current.set(key, e.nativeEvent.layout.height);
                layoutYRef.current.set(key, e.nativeEvent.layout.y);
                // The row a scrollToKey is waiting on has arrived.
                if (pendingScrollKeyRef.current === key) {
                  clearPendingScroll();
                  scrollRowIntoView(e.nativeEvent.layout.y);
                }
                // Re-measure against the fresh content-Y: the origin (and the
                // row's own height) can move with the layout, and both feed the
                // drop gap. The card's anchor is deliberately NOT re-pinned
                // once the row has moved in the list's layout — it belongs to
                // the finger, and the gap re-derives from it (see
                // calibrateOverlayBase).
                if (isPlaceholder) calibrateOverlayBase(key, e.nativeEvent.layout.y);
              }}
            >
              {/* The dragged row is hidden in place (the floating card stands in
                  for it) and shows the drop-slot marker instead. */}
              {isPlaceholder && <View style={[StyleSheet.absoluteFill, placeholderStyle]} pointerEvents="none" />}
              <View style={isPlaceholder ? styles.placeholder : undefined}>
                {renderItem({
                  item,
                  drag: () => {
                    const idx = dataRef.current.findIndex(d => keyExtractor(d) === key);
                    if (idx >= 0) startDrag(idx, key);
                  },
                  isActive: false,
                })}
              </View>
            </Animated.View>
          );
        })}
        {ListFooterComponent}
      </ScrollView>

      {activeItem !== null && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.overlay,
            shadows.fab,
            {
              top: overlayBaseTop,
              opacity: overlayOpacity,
              transform: [{ translateY: overlayY }, { translateX: overlayX }, { scale: overlayScale }],
            },
          ]}
        >
          {renderItem({ item: activeItem, drag: () => {}, isActive: true })}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  placeholder: { opacity: 0 },
  // Shadow comes from the theme (shadows.fab) so the lifted card reads
  // correctly in both light and dark mode.
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    shadowColor: '#000',
  },
});
