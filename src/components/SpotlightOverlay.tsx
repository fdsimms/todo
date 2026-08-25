import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { animation } from '../theme';
import { useColors } from '../theme/ThemeContext';

// Screens that never spotlight anything still render task rows, and their
// scrims read this permanently-0 value instead of a provider's.
const NO_SPOTLIGHT = new Animated.Value(0);

/**
 * The spotlight mask is not one view: the task list is elevated above the
 * backdrop (so the expanded card can sit on top of it), which means every row,
 * section header and stack header has to paint its own scrim to recede with
 * the rest of the screen. They all draw the same alpha, so they have to move
 * as one — giving each its own Animated.Value made the mask arrive in pieces,
 * each part starting whenever its own component's effect happened to run (and
 * some parts not animating at all). One value per screen, shared through this
 * context, keeps them in lockstep no matter how many rows re-render or how
 * long that render takes.
 */
const SpotlightProgressContext = createContext<Animated.Value>(NO_SPOTLIGHT);

/**
 * Creates the screen's shared 0→1 spotlight progress. The screen owns it — so
 * it can drive anything else that moves with the mask, e.g. fading the FAB —
 * and hands it to `SpotlightProvider` for the scrims below it.
 */
export function useSpotlightProgress(active: boolean): Animated.Value {
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: animation.duration.fast,
      useNativeDriver: true,
    }).start();
  }, [active, progress]);

  return progress;
}

export function SpotlightProvider({
  progress,
  children,
}: {
  progress: Animated.Value;
  children: React.ReactNode;
}) {
  return (
    <SpotlightProgressContext.Provider value={progress}>{children}</SpotlightProgressContext.Provider>
  );
}

/**
 * The dimming layer a spotlighted element draws over itself, driven entirely
 * by the screen's shared progress — a screen that dims anything therefore has
 * to supply a `SpotlightProvider`.
 *
 * Render it unconditionally: it is invisible while nothing is spotlighted. The
 * element that *is* spotlighted is the one that must not render it, and has to
 * keep not rendering it until the mask has faded back out (see
 * `useSpotlightLinger`), or it flashes dark on the way down.
 */
export function SpotlightScrim() {
  const colors = useColors();
  const progress = useContext(SpotlightProgressContext);

  return (
    <Animated.View
      style={[styles.scrim, { opacity: progress, backgroundColor: colors.backdrop }]}
      pointerEvents="none"
    />
  );
}

/**
 * Dimming layer shown behind an expanded ("spotlighted") task. Fades in/out
 * instead of popping, and stays mounted until the fade-out finishes.
 * Sits at zIndex 5; the screen elevates its task list above it (zIndex 10).
 */
export function SpotlightOverlay({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const rendered = useSpotlightLinger(visible);

  if (!rendered) return null;

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <SpotlightScrim />
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onPress} />
    </View>
  );
}

/**
 * True while `active` is true, and for one fade's worth of time after it turns
 * false — the window in which something still has to be on screen (or still
 * has to stay out of the mask's way) while the spotlight fades back out.
 */
export function useSpotlightLinger(active: boolean): boolean {
  const [lingering, setLingering] = useState(active);

  useEffect(() => {
    if (active) {
      setLingering(true);
      return;
    }
    // Nothing to wind down — don't arm a timer on every row that mounts
    // having never been spotlighted.
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), animation.duration.fast);
    return () => clearTimeout(timer);
  }, [active, lingering]);

  // OR'd with `active` so turning on takes effect in the render that flipped
  // it rather than a frame later, once the effect above has run.
  return active || lingering;
}

/**
 * Keeps the screen's list wrapper elevated above the overlay until the
 * overlay's fade-out completes. Dropping the elevation the instant the
 * spotlight ends would put the still-visible overlay on top of every row,
 * flashing the whole list dark for the duration of the fade.
 */
export const useSpotlightElevation = useSpotlightLinger;

const styles = StyleSheet.create({
  scrim: StyleSheet.absoluteFill,
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
  },
});
