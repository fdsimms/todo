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
 * How long the tab bar has to be held before a drag is allowed to bloom the
 * fan at all. Without this, a fast tap that drifted a few pixels — the
 * ordinary jitter of switching tabs quickly, or a thumb crossing from one tab
 * towards the next — read as the start of a drag and opened the wheel
 * unasked. Requiring a hold first makes opening it a deliberate two-part
 * gesture (hold, then drag) rather than something a quick tap can trigger by
 * accident; same delay the hub dwell below already uses, so the two
 * hold-based moments in this file feel the same.
 */
const ARM_DELAY = interaction.delayLongPress;
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
  /** The bottom tabs, in bar order. The zone covers them and re-issues their taps. */
  tabRoutes: string[];
  /** Same callback the drawer gets: switch to this tab. */
  onNavigate: (route: string) => void;
  /**
   * What a plain tap on More does. This owns the bar's touches outright (see
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

/** The level being drawn: the loadout, or the members of a hub drilled into. */
interface Level {
  slots: WheelSlot[];
  /** The hub these came from, or null at the top level. */
  hubLabel: string | null;
}

/**
 * The feature wheel: press the tab bar and drag, and a fan of the screens you
 * live in blooms out under your thumb. Flick towards one and let go.
 *
 * The geometry, the hit-testing and the reasoning behind the shape are all in
 * `src/utils/featureWheel.ts`; this file is the drawing and the gesture. What
 * the fan *holds* is `featureWheelRoutes` in settings, resolved through
 * `wheelSlots` so simplified mode and `kitchenEnabled` take a slot away here
 * exactly as they take a row out of the menu.
 *
 * Four decisions worth not re-deriving:
 *
 * - **A tap on a tab still does what it always did, and that is the
 *   accessibility story.** A flick-and-release in a direction is not something
 *   VoiceOver or Switch Control can drive, and it asks for fine motor control
 *   a list of rows does not, so the wheel may never be the only way to
 *   anything. It isn't: a press that doesn't travel switches tab, or opens
 *   `SideMenuDrawer` with every destination in it, exactly as before.
 *
 *   The zone re-issues those taps itself rather than letting them through,
 *   because letting one through isn't a thing an overlay can do: the responder
 *   negotiation runs over the touch *path* — the hit view and its ancestors —
 *   and the tab buttons are siblings in another subtree, not ancestors of
 *   this. Declining `onStartShouldSetPanResponder` would therefore not hand
 *   the press down to a button, it would drop it, and the tab bar would stop
 *   working. So this claims the touch, and `onPanResponderRelease` re-issues
 *   the press for whichever tab the finger landed on when it never travelled
 *   far enough to bloom the fan. None of that reaches VoiceOver, which
 *   activates a button by its accessibility element rather than by a touch, so
 *   every tab's real label, tint, badge and cook-timer dot still work and are
 *   still what a screen reader drives.
 *
 * - **It blooms from whichever tab was pressed**, rather than only from More.
 *   The fan hugs the corner it starts in, and a right thumb reaches the right
 *   of the bar while a left thumb reaches the left, so binding it to one tab
 *   would make it a right-handed feature. `openLeft` is decided by which half
 *   of the screen the touch landed in, and `wheelGeometry` is handed the room
 *   that leaves, since a middle tab has only half a screen to sweep into.
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
export function FeatureWheel({ tabRoutes, onNavigate, onOpenMenu }: Props) {
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
    rootSlots, width, reduceMotion, onNavigate, onOpenMenu, tabRoutes,
    openLeft: true,
    origin: { x: 0, y: 0 },
    offset: { dx: 0, dy: 0 },
    /** The level being pointed at: the loadout, or a hub's members. */
    slots: rootSlots,
    drilled: false,
    active: null as number | null,
    /** Whether the fan has bloomed yet. Until it has, the touch is still a tap. */
    open: false,
    /** Whether the hold has lasted long enough for a drag to be allowed to open the fan. */
    armed: false,
    arm: null as ReturnType<typeof setTimeout> | null,
    dwell: null as ReturnType<typeof setTimeout> | null,
  });
  live.current.rootSlots = rootSlots;
  live.current.width = width;
  live.current.reduceMotion = reduceMotion;
  live.current.onNavigate = onNavigate;
  live.current.onOpenMenu = onOpenMenu;
  live.current.tabRoutes = tabRoutes;

  // A dwell timer outliving its gesture would drill into a fan nobody is
  // holding any more.
  useEffect(() => () => { clearDwell(); clearArm(); }, []);

  function clearDwell() {
    if (live.current.dwell === null) return;
    clearTimeout(live.current.dwell);
    live.current.dwell = null;
  }

  function clearArm() {
    if (live.current.arm === null) return;
    clearTimeout(live.current.arm);
    live.current.arm = null;
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
    clearArm();
    live.current.open = false;
    live.current.armed = false;
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
      // Claimed on touch-down, which is what makes each tab's tap this
      // component's to re-issue rather than the button's to receive. See the
      // class doc.
      onStartShouldSetPanResponder: () => true,

      onPanResponderGrant: (e) => {
        clearDwell();
        clearArm();
        live.current.open = false;
        live.current.armed = false;
        live.current.drilled = false;
        live.current.active = null;
        live.current.slots = live.current.rootSlots;
        live.current.offset = { dx: 0, dy: 0 };
        // Where the finger landed. Every later offset is `dx`/`dy`, which
        // accumulate from this same moment, so the two always agree.
        live.current.origin = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        // A drag can't bloom the fan until the hold has lasted this long — see
        // `ARM_DELAY`. A fast drag that never lingers here still ends as a
        // plain tap on release, same as before.
        live.current.arm = setTimeout(() => {
          live.current.arm = null;
          live.current.armed = true;
        }, ARM_DELAY);
      },

      onPanResponderMove: (_e, gs) => {
        live.current.offset = { dx: gs.dx, dy: gs.dy };

        if (!live.current.open) {
          // Not held long enough yet for a drag to count, or still inside
          // tap distance, or the fan would have nothing in it.
          if (!live.current.armed) return;
          if (Math.hypot(gs.dx, gs.dy) <= DRAG_SLOP) return;
          if (live.current.rootSlots.length === 0) return;
          const { x, y } = live.current.origin;
          const openLeft = x > live.current.width / 2;
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
        const { x } = live.current.origin;
        const tabs = live.current.tabRoutes;
        close();

        if (!wasOpen) {
          // Never travelled, so this was a tap on the tab underneath, and a tap
          // on a tab does what it has always done. Same haptic the bar's own
          // `tabPress` listener fires.
          const tab = tabs[Math.min(tabs.length - 1, Math.max(0, Math.floor(x / (live.current.width / tabs.length))))];
          if (!tab) return;
          haptics.tap();
          if (tab === 'More') live.current.onOpenMenu();
          else live.current.onNavigate(tab);
          return;
        }

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
        style={[styles.zone, { height: TAB_BAR_HEIGHT + insets.bottom }]}
        {...responder.panHandlers}
      />
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
    zone: {
      position: 'absolute',
      left: 0,
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
