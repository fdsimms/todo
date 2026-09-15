import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, useTheme } from '../theme/ThemeContext';
import { animation, border, font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useReduceMotion } from '../utils/useReduceMotion';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useMoodStore } from '../store/useMoodStore';
import { useMedicationStore } from '../store/useMedicationStore';
import { wheelDestinations, type NavDestination } from '../utils/navHubs';
import {
  WHEEL_MAX_SLOTS,
  clampLabelX,
  wheelGeometry,
  wheelPoint,
  wheelSlotAngles,
  wheelSlotAt,
  wheelStep,
  wheelWedgePath,
} from '../utils/featureWheel';

/** Enough finger movement to mean a drag rather than the start of a tap. */
const DRAG_SLOP = 6;
/**
 * The bar's own height, which is what the zone covers — deliberately not a
 * point more. The add button sits at `insets.bottom + 64` on Today, so a zone
 * any taller starts eating taps meant for it.
 */
const TAB_BAR_HEIGHT = 49;
const CHIP_SIZE = 46;
const CHIP_SIZE_ACTIVE = 58;
const LABEL_WIDTH = 96;

interface Props {
  /** Same callback the drawer gets: switch to this tab. */
  onNavigate: (route: string) => void;
  /**
   * What a plain tap on More does. This owns the tab's touches outright (see
   * the class doc), so opening the menu is this component's job to re-issue
   * rather than the tab button's to handle.
   */
  onOpenMenu: () => void;
}

interface Anchor {
  x: number;
  y: number;
  /** Which way the fan sweeps, decided by which half of the screen was pressed. */
  openLeft: boolean;
}

/**
 * The feature wheel: press the More tab and drag, and a fan of the screens you
 * live in blooms out under your thumb. Flick towards one and let go.
 *
 * The geometry, the hit-testing and the reasoning behind the shape are all in
 * `src/utils/featureWheel.ts`; this file is the drawing and the gesture. What
 * the fan *holds* is `featureWheelRoutes` in settings, resolved through
 * `wheelDestinations` so simplified mode and `kitchenEnabled` take a slot away
 * here exactly as they take a row out of the menu.
 *
 * Three decisions worth not re-deriving:
 *
 * - **A tap on More still opens the menu, and that is the accessibility
 *   story.** A flick-and-release in a direction is not something VoiceOver or
 *   Switch Control can drive, and it asks for fine motor control a list of
 *   rows does not, so the wheel may never be the only way to anything. It
 *   isn't: a press that doesn't travel opens `SideMenuDrawer` with every
 *   destination in it, exactly as before.
 *
 *   The zone re-issues that tap itself rather than letting it through,
 *   because letting it through isn't a thing an overlay can do: the responder
 *   negotiation runs over the touch *path* — the hit view and its ancestors —
 *   and the tab button is a sibling in another subtree, not an ancestor of
 *   this. Declining `onStartShouldSetPanResponder` would therefore not hand
 *   the press down to the button, it would drop it, and the More tab would
 *   stop working. So this claims the touch, and `onPanResponderRelease` calls
 *   `onOpenMenu` when the finger never travelled far enough to bloom the fan.
 *   None of that reaches VoiceOver, which activates the button by its
 *   accessibility element rather than by a touch, so the real tab button's
 *   label, its tint and its cook-timer dot all still work and are still what
 *   a screen reader drives.
 *
 * - **It is not a `Modal`.** A drag cannot live inside a
 *   `presentationStyle="pageSheet"` Modal at all (see `EditorSheet`'s note,
 *   #1182: the sheet's own pull-down pan cancels the touches the drag runs
 *   on), and a `fullScreen` Modal would present a view controller mid-gesture
 *   for a thing that shows for half a second. It is a plain absolutely
 *   positioned overlay rendered beside the navigator, the same shape as the
 *   edge-swipe zone next to it in `AppNavigator`.
 *
 * - **The gesture state lives in refs, and the PanResponder is built once.**
 *   This component is mounted on every screen for the whole session and reads
 *   six stores to answer `screenShown`, so a responder rebuilt on each render
 *   would be rebuilt whenever any of them moves — including *during* a drag,
 *   which drops it.
 */
export function FeatureWheel({ onNavigate, onOpenMenu }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { shadows } = useTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const enabled = useSettingsStore(s => s.featureWheelEnabled);
  const routes = useSettingsStore(useShallow(s => s.featureWheelRoutes));
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  // Scalars, so each selector is referentially stable — same reason the drawer
  // and HubPills count rather than list.
  const stacks = useTaskGroupStore(s => s.groups.length);
  const templates = useTemplateStore(s => s.templates.length);
  const people = usePersonStore(s => s.people.length);
  const mood = useMoodStore(s => s.logs.length);
  const medications = useMedicationStore(s => s.logs.length);
  const foodLog = useFoodLogStore(s => s.totalCount);

  const slots = useMemo(
    () => wheelDestinations(
      routes,
      { kitchenEnabled, simpleMode, counts: { stacks, templates, people, mood, medications, foodLog } },
      WHEEL_MAX_SLOTS,
    ),
    [routes, kitchenEnabled, simpleMode, stacks, templates, people, mood, medications, foodLog],
  );

  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const bloom = useRef(new Animated.Value(0)).current;

  // Everything the responder reads, so it can be built once and still see the
  // current values. See the class doc.
  const live = useRef({
    slots, width, reduceMotion, onNavigate, onOpenMenu,
    openLeft: true,
    origin: { x: 0, y: 0 },
    active: null as number | null,
    /** Whether the fan has bloomed yet. Until it has, the touch is still a tap. */
    open: false,
  });
  live.current.slots = slots;
  live.current.width = width;
  live.current.reduceMotion = reduceMotion;
  live.current.onNavigate = onNavigate;
  live.current.onOpenMenu = onOpenMenu;

  const responder = useRef(
    PanResponder.create({
      // Claimed on touch-down, which is what makes the tap this component's to
      // re-issue rather than the tab button's to receive. See the class doc.
      onStartShouldSetPanResponder: () => true,

      onPanResponderGrant: (e) => {
        live.current.open = false;
        live.current.active = null;
        // Where the finger landed. Every later offset is `dx`/`dy`, which
        // accumulate from this same moment, so the two always agree.
        live.current.origin = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      },

      onPanResponderMove: (_e, gs) => {
        if (!live.current.open) {
          // Still inside tap distance, and the fan would have nothing in it.
          if (Math.hypot(gs.dx, gs.dy) <= DRAG_SLOP) return;
          if (live.current.slots.length === 0) return;
          const { x, y } = live.current.origin;
          const openLeft = x > live.current.width / 2;
          live.current.open = true;
          live.current.openLeft = openLeft;
          setAnchor({ x, y, openLeft });
          haptics.impactMedium();
          if (live.current.reduceMotion) {
            bloom.setValue(1);
          } else {
            bloom.setValue(0);
            Animated.spring(bloom, {
              toValue: 1,
              useNativeDriver: true,
              ...animation.spring.snappy,
            }).start();
          }
        }
        const next = wheelSlotAt(gs.dx, gs.dy, live.current.slots.length, live.current.openLeft);
        if (next === live.current.active) return;
        live.current.active = next;
        setActiveIndex(next);
        // One tick per sector crossed is what makes the fan usable without
        // looking at it, which is the whole point of a direction-based
        // selector. Nothing on the way back into the dead zone: that is an
        // undo, and the readout already says so.
        if (next !== null) haptics.tap();
      },

      // Once the touch is ours it stays ours until it ends. Handing it back
      // mid-drag would leave the overlay up with nothing driving it.
      onPanResponderTerminationRequest: () => false,

      onPanResponderRelease: () => {
        const wasOpen = live.current.open;
        const index = live.current.active;
        const destination = index === null ? undefined : live.current.slots[index];
        close();
        if (!wasOpen) {
          // Never travelled: this was a tap on More, and a tap on More opens
          // the menu. Same haptic the tab's own `tabPress` listener fires.
          haptics.tap();
          live.current.onOpenMenu();
          return;
        }
        if (!destination) return;
        haptics.success();
        live.current.onNavigate(destination.route);
      },
      onPanResponderTerminate: () => close(),
    }),
  ).current;

  function close() {
    live.current.open = false;
    live.current.active = null;
    setActiveIndex(null);
    setAnchor(null);
    bloom.setValue(0);
  }

  if (!enabled) return null;

  // The rightmost tab's slot. Groceries drops out of the bar with
  // `kitchenEnabled`, so the slot is a third of the width rather than a
  // quarter — the same arithmetic the bar itself does.
  const tabWidth = width / (kitchenEnabled ? 4 : 3);

  return (
    <>
      <View
        style={[styles.zone, { width: tabWidth, height: TAB_BAR_HEIGHT + insets.bottom }]}
        {...responder.panHandlers}
      />
      {anchor && (
        <WheelOverlay
          anchor={anchor}
          slots={slots}
          activeIndex={activeIndex}
          bloom={bloom}
          colors={colors}
          styles={styles}
          cardShadow={shadows.card}
          width={width}
          topInset={insets.top}
        />
      )}
    </>
  );
}

interface OverlayProps {
  anchor: Anchor;
  slots: NavDestination[];
  activeIndex: number | null;
  bloom: Animated.Value;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  cardShadow: object;
  width: number;
  topInset: number;
}

/**
 * The drawing. Nothing here is interactive — `pointerEvents` is off throughout
 * and it is hidden from the accessibility tree, because the only thing driving
 * it is the PanResponder above that already owns the touch.
 */
function WheelOverlay({
  anchor, slots, activeIndex, bloom, colors, styles, cardShadow, width, topInset,
}: OverlayProps) {
  const geo = wheelGeometry(width);
  const angles = wheelSlotAngles(slots.length, anchor.openLeft);
  const step = wheelStep(slots.length);
  const active = activeIndex === null ? null : slots[activeIndex];

  // Sits above the far end of the arc, out of the hand's way, and never so
  // high that it lands under the status bar on a short screen.
  const readoutTop = Math.max(topInset + spacing.sm, anchor.y - geo.label - 44);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop, opacity: bloom }]}
      />

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: bloom }]}>
        <Svg style={StyleSheet.absoluteFill}>
          {/* The dead zone, drawn so "drag back here and let go" is visible
              rather than something you have to be told. */}
          <Circle
            cx={anchor.x}
            cy={anchor.y}
            r={geo.dead}
            fill="none"
            stroke={colors.separator}
            strokeWidth={1}
            strokeDasharray="4 5"
          />
          {activeIndex !== null && (
            <Path
              d={wheelWedge(anchor, geo, angles[activeIndex], step)}
              fill={colors.accentSubtle}
              stroke={colors.accent}
              strokeWidth={1.4}
            />
          )}
        </Svg>
      </Animated.View>

      {slots.map((slot, index) => {
        const isActive = index === activeIndex;
        const size = isActive ? CHIP_SIZE_ACTIVE : CHIP_SIZE;
        const chip = wheelPoint(anchor.x, anchor.y, geo.chip, angles[index]);
        const label = wheelPoint(anchor.x, anchor.y, geo.label, angles[index]);
        // The chips bloom outwards from the anchor rather than fading in
        // place, so the fan reads as coming from the finger.
        const transform = [
          { translateX: bloom.interpolate({ inputRange: [0, 1], outputRange: [anchor.x - chip.x, 0] }) },
          { translateY: bloom.interpolate({ inputRange: [0, 1], outputRange: [anchor.y - chip.y, 0] }) },
          { scale: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
        ];
        return (
          <React.Fragment key={slot.route}>
            <Animated.View
              style={[
                styles.chip,
                cardShadow,
                {
                  left: chip.x - size / 2,
                  top: chip.y - size / 2,
                  width: size,
                  height: size,
                  backgroundColor: isActive ? colors.accent : colors.bgSecondary,
                  borderWidth: isActive ? 0 : border.hairline,
                  transform,
                },
              ]}
            >
              <Ionicons
                name={slot.icon as React.ComponentProps<typeof Ionicons>['name']}
                size={isActive ? 26 : 21}
                color={isActive ? colors.onAccent : colors.text}
              />
            </Animated.View>
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.chipLabel,
                {
                  left: clampLabelX(label.x, LABEL_WIDTH / 2, width) - LABEL_WIDTH / 2,
                  top: label.y - 8,
                  color: isActive ? colors.accentText : colors.textSecondary,
                  fontWeight: isActive ? fontWeight.bold : fontWeight.semibold,
                  opacity: bloom,
                },
              ]}
            >
              {slot.label}
            </Animated.Text>
          </React.Fragment>
        );
      })}

      <Animated.View style={[styles.readout, cardShadow, { top: readoutTop, opacity: bloom }]}>
        {active ? (
          <>
            <Ionicons
              name={active.icon as React.ComponentProps<typeof Ionicons>['name']}
              size={20}
              color={colors.accent}
            />
            <Text style={styles.readoutText} numberOfLines={1}>{active.label}</Text>
          </>
        ) : (
          <Text style={styles.readoutHint} numberOfLines={1}>Let go to cancel</Text>
        )}
      </Animated.View>
    </View>
  );
}

/** The highlight wedge for one slot: its own half-step either side, out past its chip. */
function wheelWedge(
  anchor: Anchor,
  geo: ReturnType<typeof wheelGeometry>,
  angle: number,
  step: number,
): string {
  // A lone slot has no step to halve, so give it the sweep it actually owns.
  const half = (step === 0 ? 40 : Math.abs(step)) / 2;
  return wheelWedgePath(anchor.x, anchor.y, geo.dead, geo.outer, angle - half, angle + half);
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    zone: {
      position: 'absolute',
      right: 0,
      bottom: 0,
    },
    chip: {
      position: 'absolute',
      borderRadius: radius.full,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipLabel: {
      position: 'absolute',
      width: LABEL_WIDTH,
      textAlign: 'center',
      fontSize: font.xxs,
    },
    readout: {
      position: 'absolute',
      left: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      borderWidth: border.hairline,
      borderColor: colors.separator,
      backgroundColor: colors.bgSecondary,
    },
    readoutText: {
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
      color: colors.text,
    },
    readoutHint: {
      fontSize: font.md,
      color: colors.textSecondary,
    },
  });
}
