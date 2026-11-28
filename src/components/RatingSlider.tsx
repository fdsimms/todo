import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { positionFraction, ratingFromPosition, stepRating } from '../utils/ratingSlider';
import { RATING_MAX } from '../utils/moodLog';

const THUMB = 28;
const TRACK_HEIGHT = 8;

interface Props {
  /** The symptom's name, shown as the row's label. */
  label: string;
  /** 0 (none right now) to `RATING_MAX`. */
  value: number;
  /** Called with each new whole value while the thumb moves, and once for a tap. */
  onChange: (value: number) => void;
  /**
   * Set when the symptom has only a Mild/Moderate/Severe level and no rating
   * yet: the readout says that level instead of a number, and the thumb is
   * drawn hollow at `value` until it is touched.
   */
  levelOnly?: string | null;
  /** True from touch-down to release, so the host can switch its scroll view off for the drag. */
  onScrubChange?: (scrubbing: boolean) => void;
  /** Held on the label: where the row's own menu opens from. */
  onLabelLongPress?: () => void;
  accessibilityHint?: string;
}

/**
 * A 0 to 10 rating, for a symptom the person tracks closely. Whole numbers
 * only, so every position means something they can say aloud, and the same
 * track is a tap target as well as a drag. No library for it: the app has no
 * slider, and this one is a track, a thumb and a `PanResponder` like the
 * scrub charts (`WeightChart`), which is why it reports `onScrubChange`.
 *
 * 0 is "none right now" and means the symptom is left off the entry, not that
 * a zero was recorded (`withRating` in `moodLog.ts`).
 */
export function RatingSlider({
  label, value, onChange, levelOnly = null, onScrubChange, onLabelLongPress, accessibilityHint,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const [touched, setTouched] = useState(false);

  // The responder is built once, so everything it reads goes through refs.
  const widthRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onScrubRef = useRef(onScrubChange);
  onScrubRef.current = onScrubChange;
  const startX = useRef(0);

  const emit = (x: number) => {
    const next = ratingFromPosition(x, widthRef.current);
    if (next === valueRef.current && !levelOnlyRef.current) return;
    valueRef.current = next;
    haptics.tap();
    onChangeRef.current(next);
  };
  const levelOnlyRef = useRef(levelOnly);
  levelOnlyRef.current = levelOnly;

  const responder = useMemo(() => PanResponder.create({
    // Claimed on touch-down so a tap lands a value and the page can't start
    // scrolling under a drag; the host's scroll view is off for the scrub.
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => {
      startX.current = e.nativeEvent.locationX;
      setTouched(true);
      onScrubRef.current?.(true);
      emit(startX.current);
    },
    onPanResponderMove: (_e, g) => emit(startX.current + g.dx),
    onPanResponderRelease: () => onScrubRef.current?.(false),
    onPanResponderTerminate: () => onScrubRef.current?.(false),
    onPanResponderTerminationRequest: () => false,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reads everything through refs
  }), []);

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const hollow = levelOnly !== null && levelOnly !== undefined && !touched;
  const fraction = positionFraction(value);
  const usable = Math.max(width - THUMB, 0);
  const readout = hollow ? levelOnly : value === 0 ? 'None' : `${value} / ${RATING_MAX}`;

  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Text style={styles.label} onLongPress={onLabelLongPress} suppressHighlighting>{label}</Text>
        <Text style={[styles.readout, hollow && styles.readoutLevel]}>{readout}</Text>
      </View>
      <View
        style={styles.touch}
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityValue={{ min: 0, max: RATING_MAX, now: value, text: hollow ? String(levelOnly) : value === 0 ? 'None' : `${value} out of ${RATING_MAX}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => {
          const next = stepRating(value, e.nativeEvent.actionName === 'increment' ? 1 : -1);
          setTouched(true);
          onChange(next);
        }}
        {...responder.panHandlers}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: width > 0 ? THUMB / 2 + usable * fraction : 0 }, hollow && styles.fillHidden]} />
        </View>
        <View
          pointerEvents="none"
          style={[styles.thumb, { left: usable * fraction }, hollow && styles.thumbHollow]}
        />
      </View>
      <View style={styles.ends}>
        <Text style={styles.endLabel}>None</Text>
        <Text style={styles.endLabel}>Worst</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { marginTop: spacing.smd },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { flex: 1, fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text, paddingRight: spacing.sm },
  readout: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.accentText, fontVariant: ['tabular-nums'] },
  readoutLevel: { color: colors.textSecondary, fontWeight: fontWeight.regular },
  // Taller than the thumb so a finger that lands a little off it still counts.
  touch: { height: 44, justifyContent: 'center' },
  track: { height: TRACK_HEIGHT, borderRadius: radius.full, backgroundColor: colors.bgTertiary, overflow: 'hidden' },
  fill: { height: TRACK_HEIGHT, backgroundColor: colors.accent },
  fillHidden: { opacity: 0 },
  thumb: {
    position: 'absolute',
    top: (44 - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.bg,
    borderWidth: 3,
    borderColor: colors.accent,
  },
  thumbHollow: { borderColor: colors.controlBorder },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
  endLabel: { fontSize: font.xs, color: colors.textSecondary },
});
