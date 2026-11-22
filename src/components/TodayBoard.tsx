import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { radius, spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { boardColumnsFor, BOARD_COLUMN_GAP } from '../utils/twoPane';
import {
  boardAimAt,
  boardSections,
  dealBoardSections,
  moveListItem,
  type BoardAim,
  type BoardColumnRect,
  type BoardRowRect,
} from '../utils/todayBoard';
import type { RowScroller } from './ReorderableList';

/** What a drag on the board was released onto. */
export interface BoardDrop<T> {
  dragged: T;
  /** The flat list with the row moved, or null when it lands where it was or on a target below. */
  reordered: T[] | null;
  /** The stack it was dropped into, if it was. */
  join: T | null;
  /** Whether it was dropped on the header block (the Pinned Tasks block), to pin it. */
  pin: boolean;
}

/** What a drag is aimed at that isn't a place in the list: a stack, or the header block. */
export type BoardTarget<T> = { kind: 'join'; item: T } | { kind: 'pin' } | null;

interface Props<T extends { type: string }> {
  /** Today's flat list: headers interleaved with their rows, as the single column draws it. */
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (info: { item: T; drag?: () => void; isActive: boolean }) => React.ReactNode;
  /**
   * The card that follows the pointer while `item` is dragged. A copy of a row
   * must not register as the row (a task's copy passes `isActive`, which keeps it
   * out of the paint-select registry), so the caller draws it.
   */
  renderDragCard: (item: T) => React.ReactNode;
  /** Whether a row can be picked up (a task or a stack; never a header or a calendar row). */
  canDrag: (item: T) => boolean;
  /** A section item's height in rows, to deal sections so the columns end near one another. */
  weightOf: (item: T) => number;
  /** Whether `target` (a stack) takes `dragged` when it is dropped on it. */
  canJoin: (dragged: T, target: T) => boolean;
  /** Whether `dragged` dropped on the header block means pinning it. */
  canPin: (dragged: T) => boolean;
  /** Above the columns, the whole width: the Pinned Tasks block and the bands. */
  header?: React.ReactNode;
  /** Below the columns, the whole width: Later Today, held back. */
  footer?: React.ReactNode;
  /** In place of the columns when there are no rows. */
  empty?: React.ReactNode;
  scrollEnabled: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  rowScrollerRef?: React.Ref<RowScroller>;
  /** The number of columns the board settled on for its width, for the keyboard's reading order. */
  onColumnsChange?: (columns: number) => void;
  onDragBegin?: (item: T) => void;
  /** The target the drag is aimed at, as it changes, for the stack or block to light up. */
  onTargetChange?: (target: BoardTarget<T>) => void;
  onDrop: (drop: BoardDrop<T>) => void;
}

/** Breathing room above a row scrolled into view by the keyboard. */
const ROW_SCROLL_MARGIN = spacing.md;
/** How near the board's top or bottom edge a dragged row starts it scrolling, and how far each tick goes. */
const AUTOSCROLL_ZONE = 64;
const AUTOSCROLL_STEP = 14;
const AUTOSCROLL_TICK_MS = 16;

/**
 * Today on a wide window (`todayWideLayout: 'board'`): its sections dealt into
 * columns across the window, the Pinned Tasks block above them and Later Today
 * below, the whole width. The rows are Today's own (`renderItem`), and so is
 * the order: the board only decides where each section is drawn.
 *
 * It has its own drag, because `ReorderableList`'s works in one column: it
 * finds the slot by adding row heights down the list, which rows side by side
 * break. Here every row is measured where it is when the drag starts, the
 * pointer picks a column and a seam in it (`boardAimAt`), and a line shows where
 * the row will land; the rows stay still. The drop hands back the flat list
 * with the row moved (`moveListItem`), for Today to file through `resolveDrop`
 * as it would a drop in the column. Over a stack's middle it joins the stack;
 * over the header block it pins.
 */
export function TodayBoard<T extends { type: string }>({
  data, keyExtractor, renderItem, renderDragCard, canDrag, weightOf, canJoin, canPin, header, footer, empty,
  scrollEnabled, contentContainerStyle, rowScrollerRef, onColumnsChange, onDragBegin, onTargetChange, onDrop,
}: Props<T>) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const columnCount = width > 0 ? boardColumnsFor(width) : 1;
  const sections = useMemo(() => boardSections(data), [data]);
  const dealt = useMemo(
    () => dealBoardSections(sections.map(s => s.items.reduce((sum, item) => sum + weightOf(item), 0)), columnCount),
    [sections, columnCount, weightOf],
  );
  const onColumnsChangeRef = useRef(onColumnsChange);
  onColumnsChangeRef.current = onColumnsChange;
  useEffect(() => { onColumnsChangeRef.current?.(columnCount); }, [columnCount]);

  // ==== measuring ====
  const containerRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const headerRef = useRef<View | null>(null);
  const columnViews = useRef(new Map<number, View>());
  const rowViews = useRef(new Map<string, View>());
  const scrollOffsetRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const rowRefCache = useRef(new Map<string, (view: View | null) => void>());
  const rowRef = (key: string) => {
    let cached = rowRefCache.current.get(key);
    if (!cached) {
      cached = view => {
        if (view) rowViews.current.set(key, view);
        else rowViews.current.delete(key);
      };
      rowRefCache.current.set(key, cached);
    }
    return cached;
  };

  /** A view's top and left in the board's content coordinates. */
  const measureInBoard = (view: View | undefined | null): Promise<{ x: number; y: number; w: number; h: number } | null> =>
    new Promise(resolve => {
      const container = containerRef.current;
      if (!view || !container) { resolve(null); return; }
      container.measureInWindow((cx, cy) => {
        view.measureInWindow((x, y, w, h) => {
          if (![x, y, w, h].every(Number.isFinite)) { resolve(null); return; }
          resolve({ x: x - cx, y: y - cy + scrollOffsetRef.current, w, h });
        });
      });
    });

  useImperativeHandle(rowScrollerRef, () => ({
    scrollToKey: key => {
      void measureInBoard(rowViews.current.get(key)).then(rect => {
        if (rect) scrollRef.current?.scrollTo({ y: Math.max(0, rect.y - ROW_SCROLL_MARGIN), animated: true });
      });
    },
    keepKeyInView: key => {
      void measureInBoard(rowViews.current.get(key)).then(rect => {
        if (!rect) return;
        const top = scrollOffsetRef.current;
        const viewport = viewportHeightRef.current;
        if (rect.y - ROW_SCROLL_MARGIN < top) {
          scrollRef.current?.scrollTo({ y: Math.max(0, rect.y - ROW_SCROLL_MARGIN), animated: true });
        } else if (viewport > 0 && rect.y + rect.h + ROW_SCROLL_MARGIN > top + viewport) {
          scrollRef.current?.scrollTo({ y: rect.y + rect.h + ROW_SCROLL_MARGIN - viewport, animated: true });
        }
      });
    },
    scrollToTop: () => scrollRef.current?.scrollTo({ y: 0, animated: true }),
    scrollToEnd: () => scrollRef.current?.scrollToEnd({ animated: true }),
  }));

  // ==== the drag ====
  const dataRef = useRef(data);
  dataRef.current = data;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeIndexRef = useRef<number | null>(null);
  const columnsRef = useRef<BoardColumnRect[]>([]);
  const headerRectRef = useRef<{ top: number; bottom: number } | null>(null);
  const startPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const aimRef = useRef<BoardAim | { kind: 'pin' }>({ kind: 'none' });
  // Both in the board's own box (not its content), so a scroll under them doesn't move what is drawn.
  const [line, setLine] = useState<{ column: number; top: number } | null>(null);
  const containerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [card, setCard] = useState<{ key: string; left: number; top: number; width: number } | null>(null);
  const cardShift = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const autoscrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbacks = useRef({ canJoin, canPin, onDragBegin, onTargetChange, onDrop, keyExtractor });
  callbacks.current = { canJoin, canPin, onDragBegin, onTargetChange, onDrop, keyExtractor };

  const stopAutoscroll = () => {
    if (autoscrollRef.current !== null) clearInterval(autoscrollRef.current);
    autoscrollRef.current = null;
  };

  const publishTarget = (aim: BoardAim | { kind: 'pin' }) => {
    const before = aimRef.current;
    aimRef.current = aim;
    const same = before.kind === aim.kind && (aim.kind !== 'join' || (before as typeof aim).index === aim.index);
    if (aim.kind === 'insert') {
      const top = aim.lineY - scrollOffsetRef.current;
      setLine(prev => (prev && prev.column === aim.column && prev.top === top ? prev : { column: aim.column, top }));
    } else {
      setLine(null);
    }
    if (same) return;
    const { onTargetChange: notify } = callbacks.current;
    if (aim.kind === 'join') {
      haptics.impactLight();
      notify?.({ kind: 'join', item: dataRef.current[aim.index]! });
    } else if (aim.kind === 'pin') {
      haptics.impactLight();
      notify?.({ kind: 'pin' });
    } else {
      notify?.(null);
    }
  };

  const updateAim = () => {
    const pointer = lastPointerRef.current;
    const from = activeIndexRef.current;
    if (!pointer || from === null) return;
    const dragged = dataRef.current[from];
    if (!dragged) return;
    // The pointer in content coordinates: the board may have scrolled since the rows were measured.
    const y = pointer.y + scrollOffsetRef.current;
    const head = headerRectRef.current;
    if (head && y >= head.top && y < head.bottom) {
      publishTarget(callbacks.current.canPin(dragged) ? { kind: 'pin' } : { kind: 'none' });
      return;
    }
    const { canJoin: joins } = callbacks.current;
    publishTarget(boardAimAt(columnsRef.current, pointer.x, y, index => {
      const target = dataRef.current[index];
      return !!target && index !== from && joins(dragged, target);
    }));
  };

  const maybeAutoscroll = () => {
    const pointer = lastPointerRef.current;
    const viewport = viewportHeightRef.current;
    if (!pointer || viewport <= 0) { stopAutoscroll(); return; }
    const direction = pointer.y < AUTOSCROLL_ZONE ? -1 : pointer.y > viewport - AUTOSCROLL_ZONE ? 1 : 0;
    if (direction === 0) { stopAutoscroll(); return; }
    if (autoscrollRef.current !== null) return;
    autoscrollRef.current = setInterval(() => {
      const max = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
      const p = lastPointerRef.current;
      if (!p) { stopAutoscroll(); return; }
      const dir = p.y < AUTOSCROLL_ZONE ? -1 : p.y > viewportHeightRef.current - AUTOSCROLL_ZONE ? 1 : 0;
      const next = Math.max(0, Math.min(max, scrollOffsetRef.current + dir * AUTOSCROLL_STEP));
      if (dir === 0 || next === scrollOffsetRef.current) { stopAutoscroll(); return; }
      scrollOffsetRef.current = next;
      scrollRef.current?.scrollTo({ y: next, animated: false });
      updateAim();
    }, AUTOSCROLL_TICK_MS);
  };

  const resetDrag = () => {
    stopAutoscroll();
    activeIndexRef.current = null;
    containerOriginRef.current = null;
    startPointerRef.current = null;
    lastPointerRef.current = null;
    aimRef.current = { kind: 'none' };
    setActiveKey(null);
    setLine(null);
    setCard(null);
    cardShift.setValue({ x: 0, y: 0 });
    callbacks.current.onTargetChange?.(null);
  };

  const commitDrag = () => {
    const from = activeIndexRef.current;
    if (from === null) return;
    const list = dataRef.current;
    const dragged = list[from];
    const aim = aimRef.current;
    // A press that never moved is a long press let go, not a drop: nothing moves.
    const moved = startPointerRef.current !== null;
    resetDrag();
    if (!dragged || !moved) return;
    if (aim.kind === 'join') {
      callbacks.current.onDrop({ dragged, reordered: null, join: list[aim.index] ?? null, pin: false });
    } else if (aim.kind === 'pin') {
      callbacks.current.onDrop({ dragged, reordered: null, join: null, pin: true });
    } else if (aim.kind === 'insert') {
      const reordered = moveListItem(list, from, aim.index);
      if (reordered) callbacks.current.onDrop({ dragged, reordered, join: null, pin: false });
    }
  };

  const startDrag = (key: string) => {
    if (activeIndexRef.current !== null) return;
    const index = dataRef.current.findIndex(item => callbacks.current.keyExtractor(item) === key);
    if (index < 0) return;
    activeIndexRef.current = index;
    aimRef.current = { kind: 'none' };
    setActiveKey(key);
    haptics.impactMedium();
    callbacks.current.onDragBegin?.(dataRef.current[index]!);
    containerRef.current?.measureInWindow((x, y) => {
      if (activeIndexRef.current === index && Number.isFinite(x) && Number.isFinite(y)) containerOriginRef.current = { x, y };
    });
    // Every row, where it is now: the rows don't move during the drag, so this holds until the drop.
    const keyIndex = new Map(dataRef.current.map((item, i) => [callbacks.current.keyExtractor(item), i]));
    const columnEntries = [...columnViews.current.entries()].sort((a, b) => a[0] - b[0]);
    void Promise.all([
      measureInBoard(headerRef.current),
      measureInBoard(rowViews.current.get(key)),
      Promise.all(columnEntries.map(([, view]) => measureInBoard(view))),
      Promise.all([...rowViews.current.entries()].map(async ([rowKey, view]) => ({ rowKey, rect: await measureInBoard(view) }))),
    ]).then(([head, own, columnRects, rowRects]) => {
      if (activeIndexRef.current !== index) return;
      headerRectRef.current = head && head.h > 0 ? { top: head.y, bottom: head.y + head.h } : null;
      const columns: BoardColumnRect[] = columnRects.map(rect => ({
        left: rect?.x ?? 0,
        right: (rect?.x ?? 0) + (rect?.w ?? 0),
        rows: [],
      }));
      for (const { rowKey, rect } of rowRects) {
        const flat = keyIndex.get(rowKey);
        if (rect === null || flat === undefined || rect.h <= 0) continue;
        const centre = rect.x + rect.w / 2;
        const column = columns.findIndex(c => centre >= c.left && centre <= c.right);
        if (column < 0) continue;
        const row: BoardRowRect = { index: flat, header: dataRef.current[flat]?.type === 'header', top: rect.y, bottom: rect.y + rect.h };
        columns[column].rows.push(row);
      }
      for (const column of columns) column.rows.sort((a, b) => a.top - b.top);
      columnsRef.current = columns;
      if (own) setCard({ key, left: own.x, top: own.y - scrollOffsetRef.current, width: own.w });
      updateAim();
    });
  };
  const startDragRef = useRef(startDrag);
  startDragRef.current = startDrag;
  const dragCache = useRef(new Map<string, () => void>());
  const dragHandlerFor = useCallback((key: string) => {
    let cached = dragCache.current.get(key);
    if (!cached) {
      cached = () => startDragRef.current(key);
      dragCache.current.set(key, cached);
    }
    return cached;
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => activeIndexRef.current !== null,
      onMoveShouldSetPanResponderCapture: () => activeIndexRef.current !== null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        startPointerRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      },
      onPanResponderMove: e => {
        if (activeIndexRef.current === null) return;
        const start = startPointerRef.current ?? { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        startPointerRef.current = start;
        cardShift.setValue({ x: e.nativeEvent.pageX - start.x, y: e.nativeEvent.pageY - start.y });
        // The pointer against the board's own box, which is where the content coordinates start.
        const origin = containerOriginRef.current;
        if (!origin) return;
        lastPointerRef.current = { x: e.nativeEvent.pageX - origin.x, y: e.nativeEvent.pageY - origin.y };
        updateAim();
        maybeAutoscroll();
      },
      onPanResponderRelease: () => commitDragRef.current(),
      onPanResponderTerminate: () => resetDragRef.current(),
    }),
  ).current;
  const commitDragRef = useRef(commitDrag);
  commitDragRef.current = commitDrag;
  const resetDragRef = useRef(resetDrag);
  resetDragRef.current = resetDrag;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
    viewportHeightRef.current = e.nativeEvent.layoutMeasurement.height;
    contentHeightRef.current = e.nativeEvent.contentSize.height;
  };

  // ==== render ====
  const renderRow = (item: T) => {
    const key = keyExtractor(item);
    const draggable = canDrag(item);
    return (
      <View
        key={key}
        ref={rowRef(key)}
        collapsable={false}
        style={activeKey === key && styles.lifted}
      >
        {renderItem({ item, drag: draggable ? dragHandlerFor(key) : undefined, isActive: false })}
      </View>
    );
  };

  const floatingItem = card ? data.find(item => keyExtractor(item) === card.key) : undefined;
  const lineColumn = line ? columnsRef.current[line.column] : undefined;
  const isDragging = activeKey !== null;

  return (
    <View ref={containerRef} style={styles.container} {...panResponder.panHandlers} onTouchEnd={() => commitDragRef.current()}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={contentContainerStyle}
        scrollEnabled={scrollEnabled && !isDragging}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onLayout={e => { viewportHeightRef.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_w, h) => { contentHeightRef.current = h; }}
        keyboardShouldPersistTaps="handled"
      >
        {header != null && (
          <View ref={headerRef} collapsable={false}>{header}</View>
        )}
        {data.length === 0 ? empty : (
          <View
            style={[styles.columns, { gap: BOARD_COLUMN_GAP }]}
            onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
          >
            {dealt.map((column, c) => (
              <View
                key={c}
                ref={view => { if (view) columnViews.current.set(c, view); else columnViews.current.delete(c); }}
                collapsable={false}
                style={styles.column}
              >
                {column.map(section => (
                  <View key={keyExtractor(sections[section].items[0]!)}>
                    {sections[section].items.map(renderRow)}
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}
        {footer}
      </ScrollView>
      {lineColumn && line && (
        <View
          pointerEvents="none"
          style={[
            styles.line,
            {
              backgroundColor: colors.accent,
              left: lineColumn.left,
              width: lineColumn.right - lineColumn.left,
              top: line.top - 1,
            },
          ]}
        />
      )}
      {card && floatingItem && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.card,
            {
              left: card.left,
              top: card.top,
              width: card.width,
              transform: [{ translateX: cardShift.x }, { translateY: cardShift.y }, { scale: 1.02 }],
            },
          ]}
        >
          {renderDragCard(floatingItem)}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0 },
  lifted: { opacity: 0.35 },
  line: { position: 'absolute', height: 3, borderRadius: 1.5 },
  card: { position: 'absolute', opacity: 0.95 },
});
