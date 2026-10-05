import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetModal } from './SheetModal';
import { SafeBlurView } from './SafeBlurView';
import { GlassLayer, glassSupported } from './GlassLayer';
import { SheetScrim } from './SheetScrim';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, animation, type Colors } from '../theme';
import { cardAnchorPlacement, type CardAnchor } from '../utils/cardAnchor';

export type { CardAnchor } from '../utils/cardAnchor';

interface Props {
  visible: boolean;
  /**
   * Called once the card has finished leaving, ahead of whatever `after` the
   * close was given. Clear `visible` here. Optional for a card whose every
   * exit names its own outcome (a confirm, a cancel) through `after`, which
   * then also has to supply `onRequestClose`.
   */
  onClose?: () => void;
  /**
   * The card's body. Gets `close`, which animates the card out and then calls
   * `onClose` followed by `after`: route every exit through it, so the content
   * stays on screen while it fades rather than re-rendering against whatever
   * state the caller clears.
   */
  children: React.ReactNode | ((close: CloseCard) => React.ReactNode);
  /**
   * From `useCardSheet()`, for a sheet whose exits are written as functions
   * outside the JSX (a `save`, a `dismiss(after)`): its `close` reaches this
   * card's animated exit from anywhere in the component.
   */
  controller?: CardSheetController;
  /**
   * What a tap outside the card, or the system back gesture, does. Defaults to
   * `close()`. A card staging typed state passes its discard guard here, the
   * same `handleCancel` a page sheet wires to `onRequestClose`.
   */
  onRequestClose?: (close: CloseCard) => void;
  /**
   * Opens the card as a popover from this point (a button's or a row's touch)
   * rather than centered. Null or omitted centers it, which is also the
   * fallback for an opener with no point to give, such as a swipe action.
   */
  anchor?: CardAnchor | null;
  /** How wide a popover card is, before it narrows to fit the screen. */
  popoverWidth?: number;
  /** Fires once the card is actually on screen: focus a field from here. */
  onShow?: () => void;
  /** Names the scrim for a screen reader. See `SheetScrim`. */
  scrimLabel?: string;
  /** For `SheetModal`'s development warnings. */
  name?: string;
  /**
   * Sheets raised from this card (a date picker, say). Rendered inside this
   * card's Modal but outside the card, which is what keeps them presentable:
   * a sibling Modal would be refused by iOS (see "Two sibling Modals" in
   * CLAUDE.md), and the card's own fade and scale must not apply to them.
   */
  overlays?: React.ReactNode;
  /** Extra style for the card itself (padding, a narrower width). */
  cardStyle?: StyleProp<ViewStyle>;
}

export type CloseCard = (after?: () => void) => void;

export interface CardSheetController {
  /** Animates the card out, then calls its `onClose` and `after`. */
  close: CloseCard;
  /** @internal set by the `CardSheet` it is passed to. */
  bind: { current: CloseCard | null };
}

/**
 * A handle on a `CardSheet`'s animated exit, for the sheet that renders it.
 * Stable for the component's life, so it can sit in a callback's closure.
 * Closing a card that isn't mounted yet just runs `after`.
 */
export function useCardSheet(): CardSheetController {
  const bind = useRef<CloseCard | null>(null);
  return useMemo(() => ({
    bind,
    close: (after?: () => void) => {
      if (bind.current) bind.current(after);
      else after?.();
    },
  }), []);
}

/** Default width of a popover card; centered cards fill the gutters instead. */
const POPOVER_WIDTH = 300;

/**
 * The quick-add shape, for any short sheet: a card that scales in at the middle
 * of the screen over a blurred backdrop, and fades out in a blink. Quick add,
 * quick search and the project/name quick adds each wrote this out by hand;
 * this is that, for the sheets converted from slide-up bottom cards (the
 * answer prompt, the chain step settings, the menus) and for whatever short
 * sheet comes next.
 *
 * Reach for it when the sheet is one small decision: a field or two, a short
 * list of actions, a closed set of options. A picker with a long list, a
 * filter (see "Filtering by an open-ended set" in CLAUDE.md), or a multi-step
 * flow wants the height of a bottom sheet instead.
 *
 * With `anchor` it opens as a popover from that point, growing out of the
 * corner nearest it, which is the shape for an overflow menu: the card appears
 * where the finger already is.
 *
 * The keyboard lifts a centered card by half its height, so the card stays
 * centered in what's left, and caps the card to the room above it; content
 * that can outgrow that belongs in a `ScrollView` inside the card.
 */
export function CardSheet({
  visible, onClose, children, controller, onRequestClose, anchor, popoverWidth = POPOVER_WIDTH, onShow, scrimLabel, name, cardStyle, overlays,
}: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();

  const scale = useRef(new Animated.Value(0.95)).current;
  const lift = useRef(new Animated.Value(16)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const closing = useRef(false);

  const placement = anchor
    ? cardAnchorPlacement(anchor, screen, insets, popoverWidth)
    : null;

  useEffect(() => {
    if (!visible) {
      keyboardOffset.setValue(0);
      setKeyboardHeight(0);
      return;
    }
    closing.current = false;
    // Seeded from a keyboard already up: several of these open over a field of
    // their own host's, and iOS sends no show event for a keyboard that never
    // went away.
    const initial = Keyboard.isVisible() ? Keyboard.metrics()?.height ?? 0 : 0;
    setKeyboardHeight(initial);
    keyboardOffset.setValue(anchor ? 0 : -initial / 2);
    scale.setValue(anchor ? 0.9 : 0.95);
    lift.setValue(anchor ? 0 : 16);
    opacity.setValue(0);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      setKeyboardHeight(height);
      if (anchor) return;
      Animated.spring(keyboardOffset, { toValue: -height / 2, ...animation.spring.smooth, useNativeDriver: true }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      Animated.spring(keyboardOffset, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, [visible]);

  const close = (after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(scale, {
        toValue: anchor ? 0.9 : 0.95, duration: animation.duration.dismiss, easing: Easing.in(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(opacity, { toValue: 0, duration: animation.duration.dismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      onClose?.();
      after?.();
    });
  };

  if (controller) controller.bind.current = close;
  const body = typeof children === 'function' ? children(close) : children;

  const requestClose = () => (onRequestClose ? onRequestClose(close) : close());

  // Room the card may take: everything between the safe area and the keyboard,
  // less a gutter top and bottom. A centered card is lifted by half the
  // keyboard, so it is capped against the space above the keyboard too.
  const centeredMax = screen.height - insets.top - (keyboardHeight > 0 ? keyboardHeight : insets.bottom) - spacing.xl * 2;

  return (
    <SheetModal
      name={name}
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={requestClose}
      onShow={onShow}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        {anchor ? null : <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />}
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={requestClose} label={scrimLabel} />
      {placement ? (
        <Animated.View
          style={[
            styles.card,
            shadows.sheet,
            styles.popover,
            glassSupported() && styles.popoverGlass,
            {
              top: placement.top,
              bottom: placement.bottom,
              left: placement.left,
              right: placement.right,
              width: placement.width,
              maxHeight: Math.max(160, placement.maxHeight - keyboardHeight),
              transformOrigin: placement.transformOrigin,
              opacity,
              transform: [{ scale }],
            },
            cardStyle,
          ]}
        >
          <GlassLayer style={styles.popoverClip} />
          <View style={[styles.clip, styles.popoverClip]}>{body}</View>
        </Animated.View>
      ) : (
        <View style={styles.centered} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.card,
              shadows.sheet,
              {
                maxHeight: Math.max(200, centeredMax),
                opacity,
                transform: [{ scale }, { translateY: Animated.add(lift, keyboardOffset) }],
              },
              cardStyle,
            ]}
          >
            <View style={styles.clip}>{body}</View>
          </Animated.View>
        </View>
      )}
      {overlays}
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  centered: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  // The shadow is on the card and the clip on the view inside it: iOS drops
  // the shadow of a view that clips its own bounds.
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
  },
  clip: {
    borderRadius: 20,
    overflow: 'hidden',
    flexShrink: 1,
  },
  // The hairline is what separates a popover from the cards it lands on: in
  // dark mode it is the same colour as they are, and a shadow on black is no
  // edge at all. A centered card doesn't need it, since the blur takes the
  // screen behind it out of focus.
  popover: {
    position: 'absolute',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  popoverClip: {
    borderRadius: 16,
  },
  // A popover is a menu floating over a row, which is what glass is for. The
  // centered card holds fields and stays solid. The glass supplies its own edge.
  popoverGlass: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
});
