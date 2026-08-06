import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  indicatorY,
  resolveFabDrop,
  targetKey,
  zoneAtY,
  zoneKey,
  type DropZone,
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
 * coordinates instead would mean reconstructing the offset described at length
 * in reorder.ts's contentOriginOffset, for no gain.
 *
 * Deliberately independent of ReorderableList: its drag can only be armed from
 * a row's own long-press, it hit-tests against its internal drag's anchoring,
 * and Today drops to a plain FlatList whenever anything is pinned. Measuring
 * separately is what lets the same gesture work across all of those.
 *
 * The snapshot is taken once, so the list must not scroll during the drag (the
 * screen suspends it) and a drop can only land on something already on screen.
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
  /** Resolve the pointer to an intent, updating the indicator. */
  moveTo: (pageY: number) => void;
  /** Resolve one last time, clear the indicator, and hand back what was dropped. */
  end: (pageY: number) => FabDropIntent;
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
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export const FabDropZoneProvider = forwardRef<FabDropZonesHandle, Props>(
  function FabDropZoneProvider({ onIntentChange, style, children }, ref) {
    const colors = useColors();
    const styles = useMemo(() => makeStyles(colors), [colors]);

    const containerRef = useRef<View | null>(null);
    const containerYRef = useRef(0);
    const viewsRef = useRef<Map<string, MeasurableView>>(new Map());
    const zonesRef = useRef<Map<string, DropZone>>(new Map());
    /** Zone bands, sorted top to bottom, snapshotted once per drag. */
    const rectsRef = useRef<ZoneRect[]>([]);
    /** targetKey of the published intent, or null between drags. */
    const targetRef = useRef<string | null>(null);
    // Bumped per drag so measurements still in flight from the last one are
    // discarded rather than mixed into this one's snapshot.
    const dragIdRef = useRef(0);

    const onIntentChangeRef = useRef(onIntentChange);
    onIntentChangeRef.current = onIntentChange;

    const indicatorTop = useRef(new Animated.Value(0)).current;
    const indicatorOpacity = useRef(new Animated.Value(0)).current;
    // Whether the line is currently shown, so a fade only ever runs on the
    // frame it actually changes: re-issuing the same timing on every sample
    // restarts it from wherever it had got to and flickers.
    const indicatorShownRef = useRef(false);

    const registerView = useCallback((key: string, view: MeasurableView | null) => {
      if (view) viewsRef.current.set(key, view);
      else {
        viewsRef.current.delete(key);
        zonesRef.current.delete(key);
      }
    }, []);
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

      const showIndicator = (intent: FabDropIntent) => {
        if (intent.kind !== 'insert') {
          hideIndicator();
          return;
        }
        const hit = rectsRef.current.find(r => zoneKey(r.zone) === intent.anchorKey);
        if (!hit) return;
        // Window space → this container's space, so the line lands on the seam
        // the drop will actually use.
        const top = indicatorY(hit, intent.before) - containerYRef.current;
        if (indicatorShownRef.current) {
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

      const publish = (intent: FabDropIntent) => {
        const target = targetKey(rectsRef.current, intent);
        if (targetRef.current === target) return;
        targetRef.current = target;
        showIndicator(intent);
        // One tick per place the drop can land — rate-limited, because a flick
        // down the list crosses several between frames. A plain drop is silent:
        // nothing was aimed at.
        if (intent.kind !== 'plain') haptics.dragTick();
        onIntentChangeRef.current?.(intent);
      };

      const clear = () => {
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
          containerRef.current?.measureInWindow?.((_x, y) => {
            if (Number.isFinite(y)) containerYRef.current = y;
          });
          viewsRef.current.forEach((view, key) => {
            const zone = zonesRef.current.get(key);
            if (!zone || typeof view?.measureInWindow !== 'function') return;
            view.measureInWindow((_x, y, _w, h) => {
              // A measurement from a previous drag describes where the row was
              // then; folding it in now would leave one band pointing at the
              // wrong place.
              if (dragIdRef.current !== drag) return;
              if (!Number.isFinite(y) || !(h > 0)) return;
              const next = rectsRef.current.filter(r => zoneKey(r.zone) !== key);
              next.push({ zone, top: y, bottom: y + h });
              next.sort((a, b) => a.top - b.top);
              rectsRef.current = next;
            });
          });
        },
        moveTo: (pageY: number) => {
          publish(resolveFabDrop(zoneAtY(rectsRef.current, pageY), pageY));
        },
        end: (pageY: number) => {
          const intent = resolveFabDrop(zoneAtY(rectsRef.current, pageY), pageY);
          clear();
          return intent;
        },
        cancel: clear,
      };
    }, [indicatorOpacity, indicatorTop]);

    useImperativeHandle(ref, () => handle, [handle]);

    return (
      <FabDropZoneContext.Provider value={ctx}>
        <View
          ref={containerRef}
          style={[styles.container, style]}
          onLayout={() => {
            containerRef.current?.measureInWindow?.((_x, y) => {
              if (Number.isFinite(y)) containerYRef.current = y;
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
