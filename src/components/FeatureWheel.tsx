import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { animation, border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useReduceMotion } from '../utils/useReduceMotion';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useMoodStore } from '../store/useMoodStore';
import { useMedicationStore } from '../store/useMedicationStore';
import { wheelSlots, type WheelSlot } from '../utils/navHubs';
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
 * The bar's own height, used only to plant the handle just above it. The add
 * button sits at `insets.bottom + 64` on Today, so anything taller here would
 * start reaching for the same space.
 */
const TAB_BAR_HEIGHT = 49;
/** The handle's touch target — wider than the pill drawn inside it. */
const HANDLE_WIDTH = 64;
const HANDLE_HEIGHT = 28;
/** The visible grabber: same shape language as a sheet's own drag handle. */
const HANDLE_PILL_WIDTH = 36;
const HANDLE_PILL_HEIGHT = 5;
const CHIP_SIZE = 46;
const CHIP_SIZE_ACTIVE = 58;
const LABEL_WIDTH = 96;

interface Props {
  /** Same callback the drawer gets: switch to this tab. */
  onNavigate: (route: string) => void;
}

interface Anchor {
  x: number;
  y: number;
  /** Which way the fan sweeps, decided by which way the drag first moves. */
  openLeft: boolean;
}

/** The level being drawn: the loadout, or the members of a hub drilled into. */
interface Level {
  slots: WheelSlot[];
  /** The hub these came from, or null at the top level. */
  hubLabel: string | null;
}

/**
 * The feature wheel: press the small handle above the tab bar and drag, and a
 * fan of the screens you live in blooms out under your thumb. Flick towards
 * one and let go.
 *
 * The geometry, the hit-testing and the reasoning behind the shape are all in
 * `src/utils/featureWheel.ts`; this file is the drawing and the gesture. What
 * the fan *holds* is `featureWheelRoutes` in settings, resolved through
 * `wheelSlots` so simplified mode and `kitchenEnabled` take a slot away here
 * exactly as they take a row out of the menu.
 *
 * **It used to live on the tab bar itself** — press any tab and drag, with a
 * hold-before-drag delay added later so a fast tap that drifted a few pixels
 * (the ordinary jitter of switching tabs quickly) didn't bloom the fan
 * unasked. That hold was a patch over the real problem: a gesture control and
 * a row of tap targets sharing one piece of touchable surface will always
 * have to arbitrate between them somehow, and every arbitration rule is
 * something to get wrong or feel arbitrary. Moving the gesture to its own
 * small handle removes the conflict at the root rather than mediating it —
 * nothing else lives here, so there's nothing to protect a tap on and nothing
 * to hold-delay a drag against.
 *
 * Four decisions worth not re-deriving:
 *
 * - **A plain tap on the handle does nothing, and that is deliberate — not an
 *   oversight.** A flick-and-release in a direction is not something VoiceOver
 *   or Switch Control can drive, and it asks for fine motor control a list of
 *   rows does not, so the wheel may never be the only way to anything. It
 *   isn't: every tab still switches on a tap exactly as it always did (the
 *   handle no longer sits on top of them, so their own touch handling is
 *   untouched by this component), and `SideMenuDrawer` still holds every
 *   destination behind a plain tap on More. The handle is hidden from the
 *   accessibility tree for the same reason: nothing under a screen reader's
 *   double-tap would do anything useful with it.
 *
 * - **It blooms from a fixed, centered handle, and `openLeft` is decided by
 *   which way the drag first moves** rather than by where the touch landed.
 *   A tab-bar anchor could read handedness off which side of the bar was
 *   pressed; a handle narrow enough to be one small target can't — every
 *   touch on it lands in roughly the same place. Reading the first move's
 *   direction instead is a more direct signal anyway: a thumb pulling left
 *   gets the left-leaning fan, one pulling right gets the right-leaning one,
 *   whichever hand is holding the phone. `wheelGeometry` still gets handed
 *   half the screen as the room it has either way, the same accommodation a
 *   middle tab needed before.
 *
 * - **A hub slot opens on a dwell, and releasing on it goes to its first
 *   screen.** Holding still on one for `interaction.delayLongPress` swaps the
 *   arc for that hub's members, which is the sub-wheel a game would give you.
 *   Releasing without waiting goes where the hub's own menu row goes
 *   (`rowEntryRoute`), so the fast gesture is never punished by a wait it
 *   didn't ask for, and the slow one is the only one that costs anything.
 *
 * - **It is not a `Modal`.** A drag cannot live inside a
 *   `presentationStyle="pageSheet"` Modal at all (see `EditorSheet`'s note,
 *   #1182: the sheet's own pull-down pan cancels the touches the drag runs
 *   on), and a `fullScreen` Modal would present a view controller mid-gesture
 *   for a thing that shows for half a second. It is a plain absolutely
 *   positioned overlay rendered beside the navigator, the same shape as the
 *   edge-swipe zone next to it in `AppNavigator`.
 *
 * The gesture state lives in refs and the PanResponder is built once: this is
 * mounted on every screen for the whole session and reads six stores to answer
 * `screenShown`, so a responder rebuilt on each render would be rebuilt
 * whenever any of them moves, including *during* a drag, which drops it.
 */
export function FeatureWheel({ onNavigate }: Props) {
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

  const rootSlots = useMemo(
    () => wheelSlots(
      routes,
      { kitchenEnabled, simpleMode, counts: { stacks, templates, people, mood, medications, foodLog } },
      WHEEL_MAX_SLOTS,
    ),
    [routes, kitchenEnabled, simpleMode, stacks, templates, people, mood, medications, foodLog],
  );

  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const bloom = useRef(new Animated.Value(0)).current;

  // Everything the responder reads, so it can be built once and still see the
  // current values. See the class doc.
  const live = useRef({
    rootSlots, width, reduceMotion, onNavigate,
    openLeft: true,
    origin: { x: 0, y: 0 },
    offset: { dx: 0, dy: 0 },
    /** The level being pointed at: the loadout, or a hub's members. */
    slots: rootSlots,
    drilled: false,
    active: null as number | null,
    /** Whether the fan has bloomed yet. Until it has, the touch is still a tap. */
    open: false,
    dwell: null as ReturnType<typeof setTimeout> | null,
  });
  live.current.rootSlots = rootSlots;
  live.current.width = width;
  live.current.reduceMotion = reduceMotion;
  live.current.onNavigate = onNavigate;

  // A dwell timer outliving its gesture would drill into a fan nobody is
  // holding any more.
  useEffect(() => () => clearDwell(), []);

  function clearDwell() {
    if (live.current.dwell === null) return;
    clearTimeout(live.current.dwell);
    live.current.dwell = null;
  }

  function runBloom() {
    if (live.current.reduceMotion) {
      bloom.setValue(1);
      return;
    }
    bloom.setValue(0);
    Animated.spring(bloom, { toValue: 1, useNativeDriver: true, ...animation.spring.snappy }).start();
  }

  /** Recomputes the highlight from where the finger already is. */
  function refreshActive() {
    const { dx, dy } = live.current.offset;
    const next = wheelSlotAt(dx, dy, live.current.slots.length, live.current.openLeft);
    live.current.active = next;
    setActiveIndex(next);
  }

  function setSlots(slots: WheelSlot[], hubLabel: string | null) {
    live.current.slots = slots;
    live.current.drilled = hubLabel !== null;
    setLevel({ slots, hubLabel });
    runBloom();
    // The finger is already pointing somewhere, so light up whatever is under
    // it now rather than waiting for the next move.
    refreshActive();
  }

  function close() {
    clearDwell();
    live.current.open = false;
    live.current.drilled = false;
    live.current.active = null;
    live.current.slots = live.current.rootSlots;
    setActiveIndex(null);
    setAnchor(null);
    setLevel(null);
    bloom.setValue(0);
  }

  const responder = useRef(
    PanResponder.create({
      // Claimed on touch-down. Nothing else lives on the handle, so there's
      // no button underneath to protect the way there was on the tab bar.
      onStartShouldSetPanResponder: () => true,

      onPanResponderGrant: (e) => {
        clearDwell();
        live.current.open = false;
        live.current.drilled = false;
        live.current.active = null;
        live.current.slots = live.current.rootSlots;
        live.current.offset = { dx: 0, dy: 0 };
        // Where the finger landed. Every later offset is `dx`/`dy`, which
        // accumulate from this same moment, so the two always agree.
        live.current.origin = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      },

      onPanResponderMove: (_e, gs) => {
        live.current.offset = { dx: gs.dx, dy: gs.dy };

        if (!live.current.open) {
          // Still inside tap distance, and the fan would have nothing in it.
          if (Math.hypot(gs.dx, gs.dy) <= DRAG_SLOP) return;
          if (live.current.rootSlots.length === 0) return;
          const { x, y } = live.current.origin;
          // Every touch lands in roughly the same place on a handle this
          // small, so the side the finger's on can't say which way to open —
          // the direction it first moves can. See the class doc.
          const openLeft = gs.dx < 0;
          live.current.open = true;
          live.current.openLeft = openLeft;
          setAnchor({ x, y, openLeft });
          setLevel({ slots: live.current.rootSlots, hubLabel: null });
          haptics.impactMedium();
          runBloom();
        }

        const next = wheelSlotAt(gs.dx, gs.dy, live.current.slots.length, live.current.openLeft);
        if (next === live.current.active) return;

        clearDwell();
        live.current.active = next;
        setActiveIndex(next);

        if (next === null) {
          // Back inside the dead zone. One level at a time: from a hub's
          // members that means "go back", and only from the top level does
          // letting go mean cancel.
          if (live.current.drilled) {
            haptics.impactLight();
            setSlots(live.current.rootSlots, null);
          }
          return;
        }

        // One tick per sector crossed is what makes the fan usable without
        // looking at it, which is the whole point of a direction-based
        // selector.
        haptics.tap();

        const slot = live.current.slots[next];
        if (!live.current.drilled && slot?.members) {
          live.current.dwell = setTimeout(() => {
            live.current.dwell = null;
            const hub = live.current.slots[live.current.active ?? -1];
            if (!hub?.members) return;
            haptics.impactMedium();
            setSlots(
              hub.members.map(m => ({ key: m.route, label: m.label, icon: m.icon, route: m.route })),
              hub.label,
            );
          }, interaction.delayLongPress);
        }
      },

      // Once the touch is ours it stays ours until it ends. Handing it back
      // mid-drag would leave the overlay up with nothing driving it.
      onPanResponderTerminationRequest: () => false,

      onPanResponderRelease: () => {
        const wasOpen = live.current.open;
        const index = live.current.active;
        const slot = index === null ? undefined : live.current.slots[index];
        close();

        // Never travelled, so this was a plain tap on the handle — which does
        // nothing. See the class doc.
        if (!wasOpen) return;

        if (!slot) return;
        haptics.success();
        live.current.onNavigate(slot.route);
      },
      onPanResponderTerminate: () => close(),
    }),
  ).current;

  if (!enabled) return null;

  return (
    <>
      <View
        style={[styles.handle, { bottom: TAB_BAR_HEIGHT + insets.bottom }]}
        // Hidden from accessibility — see the class doc's first bullet. The
        // pill fades out while the fan is bloomed so it doesn't sit under the
        // overlay looking like a second, static control.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        {...responder.panHandlers}
      >
        <Animated.View
          style={[
            styles.handlePill,
            { backgroundColor: colors.separator, opacity: bloom.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
          ]}
        />
      </View>
      {anchor && level && (
        <WheelOverlay
          anchor={anchor}
          level={level}
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
  level: Level;
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
  anchor, level, activeIndex, bloom, colors, styles, cardShadow, width, topInset,
}: OverlayProps) {
  const { slots, hubLabel } = level;
  // The room the fan has on the side it opens towards. A middle tab has only
  // half a screen; see `wheelGeometry`.
  const room = anchor.openLeft ? anchor.x : width - anchor.x;
  const geo = wheelGeometry(width, room);
  const angles = wheelSlotAngles(slots.length, anchor.openLeft);
  const step = wheelStep(slots.length);
  const active = activeIndex === null ? null : slots[activeIndex];

  // Sits clear above the arc, out of the hand's way, and never so high that it
  // lands under the status bar on a short screen. The gap has to clear the
  // readout's *own* height as well as the labels below it: measured from its
  // top, a 52pt gap put the card straight over the two labels nearest
  // vertical, which are the ones at the top of the fan.
  const readoutTop = Math.max(topInset + spacing.sm, anchor.y - geo.label - 104);

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
          {/* The dead zone, drawn so "let go here" is visible rather than
              something you have to be told. */}
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
          <React.Fragment key={slot.key}>
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
              {/* A hub slot says so with a second ring rather than a glyph of
                  its own: the icon is already the thing that identifies it,
                  and the ring is readable at a glance from the corner of the
                  eye, which is all a chip on an arc ever gets. */}
              {slot.members && (
                <View
                  style={[
                    styles.hubRing,
                    { borderColor: isActive ? colors.onAccent : colors.accent },
                  ]}
                />
              )}
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
            <View style={styles.readoutText}>
              <Text style={styles.readoutTitle} numberOfLines={1}>
                {hubLabel ? `${hubLabel} › ${active.label}` : active.label}
              </Text>
              {active.members && (
                <Text style={styles.readoutHint} numberOfLines={1}>Hold to open its screens</Text>
              )}
            </View>
          </>
        ) : (
          <Text style={styles.readoutTitle} numberOfLines={1}>
            {hubLabel ? 'Pull back to go back' : 'Let go to cancel'}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

/**
 * The outer corner radius on the wedge's fillet — see `wheelWedgePath`. Big
 * enough to round off visibly against the chip's own curve, small enough to
 * stay a corner treatment rather than reshaping the wedge.
 */
const WEDGE_CORNER_RADIUS = 10;

/** The highlight wedge for one slot: its own half-step either side, tucked under its chip. */
function wheelWedge(
  anchor: Anchor,
  geo: ReturnType<typeof wheelGeometry>,
  angle: number,
  step: number,
): string {
  // A lone slot has no step to halve, so give it the sweep it actually owns.
  const half = (step === 0 ? 40 : Math.abs(step)) / 2;
  return wheelWedgePath(
    anchor.x, anchor.y, geo.dead, geo.outer, angle - half, angle + half, WEDGE_CORNER_RADIUS,
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    handle: {
      position: 'absolute',
      left: '50%',
      width: HANDLE_WIDTH,
      height: HANDLE_HEIGHT,
      marginLeft: -HANDLE_WIDTH / 2,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingBottom: spacing.xs,
    },
    handlePill: {
      width: HANDLE_PILL_WIDTH,
      height: HANDLE_PILL_HEIGHT,
      borderRadius: radius.full,
    },
    chip: {
      position: 'absolute',
      borderRadius: radius.full,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hubRing: {
      position: 'absolute',
      top: -5,
      left: -5,
      right: -5,
      bottom: -5,
      borderRadius: radius.full,
      borderWidth: 1.5,
      opacity: 0.6,
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
      right: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      borderWidth: border.hairline,
      borderColor: colors.separator,
      backgroundColor: colors.bgSecondary,
    },
    readoutText: { flex: 1, gap: spacing.xxs },
    readoutTitle: {
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
      color: colors.text,
    },
    readoutHint: {
      fontSize: font.xxs,
      color: colors.textSecondary,
    },
  });
}
