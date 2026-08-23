import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  AUTOSCROLL_INTERVAL_MS,
  autoscrollStep,
  indicatorY,
  resolveFabDrop,
  targetKey,
  zoneAtY,
  zoneKey,
  type DragScroller,
  type DropZone,
  type FabHomeState,
  type FabDropIntent,
  type ZoneRect,
} from '../utils/fabDrop';
import { haptics } from '../utils/haptics';
import { useColors } from '../theme/ThemeContext';
import { animation, radius, spacing, type Colors } from '../theme';

/**
 * Drop targets for a dragged add button.
 *
 * Rows register themselves through context (FabDropZone below), and the
 * provider snapshots their on-screen bands once when a drag starts — the same
 * shape as PaintSelectionProvider, and window-space for the same reason: the
 * button being dragged lives in an absolutely-positioned sibling of the list,
 * so pageY from its PanResponder and measureInWindow from a row are the only
 * two numbers that already agree. Reaching into the list's own scroll-content
 * coordinates instead would mean reconstructing the offsets described at length
 * in reorder.ts's dragTranslation, for no gain.
 *
 * Deliberately independent of ReorderableList: its drag can only be armed from
 * a row's own long-press, it hit-tests against its internal drag's anchoring,
 * and Today drops to a plain FlatList whenever anything is pinned. Measuring
 * separately is what lets the same gesture work across all of those.
 *
 * The user can't scroll during the drag — the button's responder has the touch
 * and the screen suspends the list anyway — so instead the drag scrolls it,
 * from the bands at either end of the viewport, whenever the screen supplies a
 * `scroller`. That makes the whole list reachable rather than only the screenful
 * the drag started on, and it costs two things:
 *
 * 1. **Bands are stored with the scroll offset added in** and the pointer is
 *    queried with the same offset added, so a snapshot taken at one scroll
 *    position still answers correctly at another. Nothing has to be re-measured
 *    just because the list moved.
 * 2. **Rows that mount mid-drag measure themselves as they arrive** — a row
 *    scrolled into view was never in the opening snapshot, and without this it
 *    would be the one row in the viewport a drop couldn't land on.
 *
 * Rows that unmount keep their band on purpose: it stays correct (it just
 * describes somewhere off-screen now) and their list data is still there, so a
 * row scrolled back into view needs no repair.
 */

interface MeasurableView {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

/**
 * The current drag target, handed to the few components that change with it.
 *
 * Deliberately not screen state. The target changes several times a second
 * while the finger is moving, and the screen that owns this list re-runs every
 * row's renderItem when it re-renders — which is what made the button judder
 * exactly as it passed over tasks. ReorderableList keeps its own hover
 * animation off React state for the same reason; this is that rule applied to
 * the one piece of drag state the screen can't keep to itself, since the label
 * rides on the button and the highlight sits on a row.
 */
export interface FabIntentChannel {
  publish: (intent: FabDropIntent | null) => void;
  subscribe: (listener: () => void) => () => void;
  get: () => FabDropIntent | null;
}

/** Creates the channel. One per screen, passed to the provider and to readers. */
export function useFabIntentChannel(): FabIntentChannel {
  return useMemo(() => {
    let current: FabDropIntent | null = null;
    const listeners = new Set<() => void>();
    return {
      publish: intent => {
        current = intent;
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

/**
 * Reads the channel through a selector, re-rendering only the component that
 * calls it and only when its own answer changes.
 *
 * Select something comparable — a boolean, the label's text — rather than the
 * intent itself: most crossings don't change either ("New task in Work" reads
 * the same three rows running), and one that doesn't should cost nothing.
 * Keep the callers small and pass their children through untouched, so a
 * change that does land can't reach the rows underneath.
 */
export function useFabIntentSelector<T>(
  channel: FabIntentChannel,
  select: (intent: FabDropIntent | null) => T,
): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const getSnapshot = useCallback(() => selectRef.current(channel.get()), [channel]);
  return useSyncExternalStore(channel.subscribe, getSnapshot, getSnapshot);
}

interface FabDropZoneContextValue {
  registerView: (key: string, view: MeasurableView | null) => void;
  setZone: (key: string, zone: DropZone) => void;
}

const FabDropZoneContext = createContext<FabDropZoneContextValue | null>(null);

interface ZoneProps {
  /** Null for a row that shouldn't be a target — notably a drag overlay's throwaway copy. */
  zone: DropZone | null;
  children: React.ReactNode;
}

/**
 * Wraps a list row so the add button can be dropped on it.
 *
 * Pass a null zone for a row that is a copy of another (ReorderableList
 * re-renders the dragged row into its floating overlay): registering it would
 * claim the real row's slot under the same key, and unmounting it would then
 * evict a row that's still on screen.
 */
export function FabDropZone({ zone, children }: ZoneProps) {
  const ctx = useContext(FabDropZoneContext);
  const key = zone === null ? null : zoneKey(zone);

  // The payload changes identity every render; the ref callback must not, or
  // React tears the view registration down and back up on each one. So the
  // measurable view is keyed by a stable string and the payload is written
  // separately, the same way PaintSelectionProvider assigns its prop refs.
  if (ctx && key !== null && zone !== null) ctx.setZone(key, zone);

  const ref = useCallback(
    // Typed loosely on purpose: this attaches to a host component whose own ref
    // type React won't reconcile with a narrower callback, and the only thing
    // needed off the instance is measureInWindow.
    (view: any) => {
      if (key === null) return;
      ctx?.registerView(key, (view as MeasurableView | null) ?? null);
    },
    [ctx, key],
  );

  if (!ctx || key === null) return <>{children}</>;
  return <View ref={ref} collapsable={false}>{children}</View>;
}

export interface FabDropZonesHandle {
  /** Take the snapshot. Call as the drag arms. */
  begin: () => void;
  /**
   * Resolve the pointer to an intent, updating the indicator and autoscrolling
   * if the pointer has reached either end of the list. `home` overrides both:
   * on the button's own corner the drop is a cancel (once the drag has been
   * somewhere else first) and the list holds still, since that corner and the
   * bottom autoscroll band overlap.
   *
   * `pageX` is optional because only one target has anything to do with it — a
   * meal-plan day band, where across picks the meal (see slotAtX). A drag that
   * leaves it out resolves from the vertical position alone, exactly as every
   * drag did before.
   */
  moveTo: (pageY: number, home?: FabHomeState, pageX?: number | null) => void;
  /** Resolve one last time, clear the indicator, and hand back what was dropped. */
  end: (pageY: number, home?: FabHomeState, pageX?: number | null) => FabDropIntent;
  /** Clear the indicator without resolving anything (cancelled drag). */
  cancel: () => void;
}

interface Props {
  /**
   * Fires as the resolved target changes during a drag, null between drags.
   * The screen uses it to light up a stack row and to label the dragged
   * button; the insertion line is drawn here, since only this component knows
   * where the rows are.
   */
  onIntentChange?: (intent: FabDropIntent | null) => void;
  /**
   * The list to autoscroll while dragging, in a box the screen can swap (Today
   * renders two different lists). Read at each tick, so a null one — no list,
   * or a screen that hasn't wired this up — simply means the drag reaches only
   * what's already on screen, exactly as it did before.
   */
  scroller?: { current: DragScroller | null };
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export const FabDropZoneProvider = forwardRef<FabDropZonesHandle, Props>(
  function FabDropZoneProvider({ onIntentChange, scroller, style, children }, ref) {
    const colors = useColors();
    const styles = useMemo(() => makeStyles(colors), [colors]);

    const containerRef = useRef<View | null>(null);
    const containerYRef = useRef(0);
    const containerHeightRef = useRef(0);
    const viewsRef = useRef<Map<string, MeasurableView>>(new Map());
    const zonesRef = useRef<Map<string, DropZone>>(new Map());
    /**
     * Zone bands, sorted top to bottom, each with the list's scroll offset at
     * the moment it was measured already added in (see the note up top).
     */
    const rectsRef = useRef<ZoneRect[]>([]);
    /** targetKey of the published intent, or null between drags. */
    const targetRef = useRef<string | null>(null);
    // Bumped per drag so measurements still in flight from the last one are
    // discarded rather than mixed into this one's snapshot.
    const dragIdRef = useRef(0);
    const draggingRef = useRef(false);
    // Last thing the finger said, replayed by each autoscroll tick: the list
    // moves under a finger that is holding still, so the target changes without
    // any new pointer event to recompute it from.
    const lastPageYRef = useRef(0);
    // Null for a drag that doesn't report one — see moveTo's `pageX`.
    const lastPageXRef = useRef<number | null>(null);
    const lastHomeRef = useRef<FabHomeState>('outside');
    const autoscrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const autoscrollStepRef = useRef(0);

    const onIntentChangeRef = useRef(onIntentChange);
    onIntentChangeRef.current = onIntentChange;
    const scrollerRef = useRef(scroller);
    scrollerRef.current = scroller;

    /** The list's current scroll offset, or 0 when there's nothing scrollable. */
    const scrollOffset = useCallback(() => scrollerRef.current?.current?.getOffset() ?? 0, []);

    /**
     * Measure one row into the snapshot. The offset is read when the
     * measurement lands rather than when it's issued: measureInWindow answers a
     * frame or so later, and during an autoscroll that frame has moved the list.
     */
    const measureZone = useCallback((key: string, drag: number) => {
      const view = viewsRef.current.get(key);
      const zone = zonesRef.current.get(key);
      if (!zone || typeof view?.measureInWindow !== 'function') return;
      view.measureInWindow((x, y, w, h) => {
        // A measurement from a previous drag describes where the row was
        // then; folding it in now would leave one band pointing at the
        // wrong place.
        if (dragIdRef.current !== drag) return;
        if (!Number.isFinite(y) || !(h > 0)) return;
        const top = y + scrollOffset();
        const next = rectsRef.current.filter(r => zoneKey(r.zone) !== key);
        // No scroll offset on the horizontal pair: the lists this measures are
        // all vertical, so x is the same number at every offset.
        const left = Number.isFinite(x) ? x : 0;
        next.push({ zone, top, bottom: top + h, left, right: left + (w > 0 ? w : 0) });
        next.sort((a, b) => a.top - b.top);
        rectsRef.current = next;
      });
    }, [scrollOffset]);

    const indicatorTop = useRef(new Animated.Value(0)).current;
    const indicatorOpacity = useRef(new Animated.Value(0)).current;
    // Whether the line is currently shown, so a fade only ever runs on the
    // frame it actually changes: re-issuing the same timing on every sample
    // restarts it from wherever it had got to and flickers.
    const indicatorShownRef = useRef(false);

    const registerView = useCallback((key: string, view: MeasurableView | null) => {
      if (view) {
        viewsRef.current.set(key, view);
        // Mounted mid-drag — the list has scrolled this row into view since the
        // opening snapshot, so it measures itself now or it isn't a target.
        if (draggingRef.current) measureZone(key, dragIdRef.current);
      } else {
        viewsRef.current.delete(key);
        zonesRef.current.delete(key);
      }
    }, [measureZone]);
    const setZone = useCallback((key: string, zone: DropZone) => {
      zonesRef.current.set(key, zone);
    }, []);
    const ctx = useMemo(() => ({ registerView, setZone }), [registerView, setZone]);

    const handle = useMemo<FabDropZonesHandle>(() => {
      const hideIndicator = () => {
        if (!indicatorShownRef.current) return;
        indicatorShownRef.current = false;
        Animated.timing(indicatorOpacity, {
          toValue: 0, duration: animation.duration.fast, useNativeDriver: true,
        }).start();
      };

      /**
       * Put the line on the seam the current intent names. `immediate` covers
       * both ways an autoscroll breaks the glide below: a seam that hasn't
       * changed but has *moved* (the list scrolled under a still finger), and a
       * seam that changed while the content was moving anyway. Either way a
       * spring would spend its whole duration chasing the next tick's offset,
       * and the next tick's setValue would fight it for the frames it lived.
       */
      const showIndicator = (intent: FabDropIntent, immediate: boolean) => {
        if (intent.kind !== 'insert') {
          hideIndicator();
          return;
        }
        const hit = rectsRef.current.find(r => zoneKey(r.zone) === intent.anchorKey);
        if (!hit) return;
        // Band space → this container's space: take the scroll offset back out
        // (it was added when the row was measured) so the line lands on the
        // seam where the rows are drawn right now.
        const top = indicatorY(hit, intent.before) - scrollOffset() - containerYRef.current;
        if (indicatorShownRef.current) {
          if (immediate) {
            indicatorTop.stopAnimation();
            indicatorTop.setValue(top);
            return;
          }
          // Already on screen: glide to the new seam. Snapping it there reads
          // as a stutter at speed, since the jump lands on the same frame as
          // the tick and the rows the finger is passing.
          Animated.spring(indicatorTop, {
            toValue: top, ...animation.spring.snappy, useNativeDriver: true,
          }).start();
          return;
        }
        indicatorTop.setValue(top);
        indicatorShownRef.current = true;
        Animated.timing(indicatorOpacity, {
          toValue: 1, duration: animation.duration.fast, useNativeDriver: true,
        }).start();
      };

      const publish = (intent: FabDropIntent, scrolled: boolean) => {
        const target = targetKey(rectsRef.current, intent);
        const changed = targetRef.current !== target;
        if (!changed && !scrolled) return;
        targetRef.current = target;
        showIndicator(intent, scrolled || !changed);
        if (!changed) return;
        // One tick per place the drop can land — rate-limited, because a flick
        // down the list crosses several between frames. A plain drop is silent:
        // nothing was aimed at. Reaching the cancel well is a firmer knock than
        // crossing a seam, because it's the one target that undoes the drag.
        if (intent.kind === 'cancel') haptics.impactMedium();
        else if (intent.kind !== 'plain') haptics.dragTick();
        onIntentChangeRef.current?.(intent);
      };

      /** Resolve the last reported pointer against the bands as they stand now. */
      const resolve = (): FabDropIntent => {
        // The pointer joins the bands' space, which carries the offset.
        const y = lastPageYRef.current + scrollOffset();
        return resolveFabDrop(
          zoneAtY(rectsRef.current, y),
          y,
          lastHomeRef.current === 'returned',
          lastPageXRef.current,
        );
      };

      const stopAutoscroll = () => {
        if (autoscrollTimerRef.current !== null) {
          clearInterval(autoscrollTimerRef.current);
          autoscrollTimerRef.current = null;
        }
        autoscrollStepRef.current = 0;
      };

      const maybeAutoscroll = () => {
        // Only out over the list. The button's corner is inside the bottom
        // band, so scrolling from anywhere near it would mean the list ran to
        // its end while the button was being lifted, and again whenever a drag
        // paused over the well to decide.
        const step = lastHomeRef.current !== 'outside' ? 0 : autoscrollStep(
          lastPageYRef.current,
          containerYRef.current,
          containerYRef.current + containerHeightRef.current,
        );
        autoscrollStepRef.current = step;
        if (step === 0) {
          const wasScrolling = autoscrollTimerRef.current !== null;
          stopAutoscroll();
          // Coming to rest, re-measure. A row measured *during* a scroll banks
          // an offset read a frame after the native measurement, so its band
          // can sit a step or two out; the moment the list stops, everything on
          // screen can say exactly where it is, which is what the release will
          // be judged against.
          if (wasScrolling) {
            const drag = dragIdRef.current;
            viewsRef.current.forEach((_view, key) => measureZone(key, drag));
          }
          return;
        }
        if (autoscrollTimerRef.current !== null) return;
        autoscrollTimerRef.current = setInterval(() => {
          const list = scrollerRef.current?.current;
          if (!list) {
            stopAutoscroll();
            return;
          }
          const from = list.getOffset();
          const next = Math.max(0, Math.min(list.getMaxOffset(), from + autoscrollStepRef.current));
          if (next === from) {
            // Hit an end. Stop the timer rather than idling on it — the next
            // pointer move restarts it if the finger is still in the band.
            stopAutoscroll();
            return;
          }
          list.scrollToOffset(next);
          publish(resolve(), true);
        }, AUTOSCROLL_INTERVAL_MS);
      };

      const clear = () => {
        stopAutoscroll();
        draggingRef.current = false;
        targetRef.current = null;
        hideIndicator();
        onIntentChangeRef.current?.(null);
      };

      return {
        begin: () => {
          dragIdRef.current += 1;
          const drag = dragIdRef.current;
          rectsRef.current = [];
          targetRef.current = null;
          lastHomeRef.current = 'inside';
          lastPageXRef.current = null;
          draggingRef.current = true;
          containerRef.current?.measureInWindow?.((_x, y, _w, h) => {
            if (Number.isFinite(y)) containerYRef.current = y;
            if (h > 0) containerHeightRef.current = h;
          });
          viewsRef.current.forEach((_view, key) => measureZone(key, drag));
        },
        moveTo: (pageY: number, home: FabHomeState = 'outside', pageX: number | null = null) => {
          lastPageYRef.current = pageY;
          lastPageXRef.current = pageX;
          lastHomeRef.current = home;
          publish(resolve(), false);
          maybeAutoscroll();
        },
        end: (pageY: number, home: FabHomeState = 'outside', pageX: number | null = null) => {
          lastPageYRef.current = pageY;
          lastPageXRef.current = pageX;
          lastHomeRef.current = home;
          const intent = resolve();
          clear();
          return intent;
        },
        cancel: clear,
      };
    }, [indicatorOpacity, indicatorTop, measureZone, scrollOffset]);

    // A drag interrupted by this screen going away leaves the timer running.
    useEffect(() => () => {
      if (autoscrollTimerRef.current !== null) clearInterval(autoscrollTimerRef.current);
    }, []);

    useImperativeHandle(ref, () => handle, [handle]);

    return (
      <FabDropZoneContext.Provider value={ctx}>
        <View
          ref={containerRef}
          style={[styles.container, style]}
          onLayout={() => {
            containerRef.current?.measureInWindow?.((_x, y, _w, h) => {
              if (Number.isFinite(y)) containerYRef.current = y;
              if (h > 0) containerHeightRef.current = h;
            });
          }}
        >
          {children}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.indicator,
              { opacity: indicatorOpacity, transform: [{ translateY: indicatorTop }] },
            ]}
          />
        </View>
      </FabDropZoneContext.Provider>
    );
  },
);

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1 },
  indicator: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: 0,
    height: 2,
    marginTop: -1,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});
