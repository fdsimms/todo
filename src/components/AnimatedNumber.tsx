import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { animation } from '../theme';
import { AnimatedText } from '../theme/AppFont';
import { rollColumns, rollDirection, type RollColumn } from '../utils/digitRoll';
import { useReduceMotion } from '../utils/useReduceMotion';

interface Props {
  /** What to show: a number already formatted ("12", "3/8", "1,250"). */
  text: string;
  /**
   * The number behind it, for which way the digits roll: up for more, down
   * for less. Omitted or unchanged, a changed character crossfades in place.
   */
  value?: number | null;
  /** The text's own look. Nothing that lays it out: that's `containerStyle`. */
  style?: StyleProp<TextStyle>;
  /**
   * Layout for the number as a whole. It's a row in both states, so centring
   * is `justifyContent` and a fixed box is `minWidth`.
   */
  containerStyle?: StyleProp<ViewStyle>;
  /** Spoken in place of the bare number. */
  accessibilityLabel?: string;
  /** Passed to every Text drawn, for a badge capping its own growth. */
  maxFontSizeMultiplier?: number;
}

interface Roll {
  columns: RollColumn[];
  dir: 1 | -1 | 0;
  progress: Animated.Value;
}

/**
 * A number that rolls the digits that changed, the way a counter does,
 * instead of swapping the whole thing in one frame. Steppers, the coin count,
 * a quota's 3/8, header badges and a stack's tally all use it, so a count
 * reads as something counting.
 *
 * At rest it is one ordinary `Text`, so a number that isn't changing lays out
 * exactly as it did before. Only while a change plays does it split into a
 * column per character (rollColumns): an unchanged column sits still, and a
 * changed one slides its old character out and the new one in by a line
 * height, on the snappy spring. The split happens in the same render as the
 * change, so the first frame shows the old number rather than a flash of the
 * new one. Figures are tabular, so a column keeps its width as it rolls.
 *
 * Reduce Motion, and a number not yet measured, just change.
 */
export function AnimatedNumber({ text, value, style, containerStyle, accessibilityLabel, maxFontSizeMultiplier }: Props) {
  const reduceMotion = useReduceMotion();
  const [height, setHeight] = useState(0);
  const [last, setLast] = useState<{ text: string; value: number | null | undefined }>({ text, value });
  const [roll, setRoll] = useState<Roll | null>(null);

  // Derived during render rather than in an effect, so the frame the change
  // lands on is already the start of the roll.
  if (text !== last.text) {
    setLast({ text, value });
    setRoll(reduceMotion || height === 0
      ? null
      : {
        columns: rollColumns(last.text, text),
        dir: rollDirection(last.value, value),
        progress: new Animated.Value(0),
      });
  } else if (value !== last.value) {
    setLast({ text, value });
  }

  useEffect(() => {
    if (!roll) return;
    Animated.spring(roll.progress, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true })
      .start(({ finished }) => {
        if (finished) setRoll(current => (current === roll ? null : current));
      });
  }, [roll]);

  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent?.layout?.height;
    if (h && Math.abs(h - height) > 0.5) setHeight(h);
  };

  if (!roll) {
    return (
      <View style={[styles.row, containerStyle]}>
        <Text
          style={[style, styles.figures]}
          numberOfLines={1}
          onLayout={onLayout}
          accessibilityLabel={accessibilityLabel}
          maxFontSizeMultiplier={maxFontSizeMultiplier}
        >
          {text}
        </Text>
      </View>
    );
  }

  const travel = roll.dir * height;
  const inY = roll.progress.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] });
  const outY = roll.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -travel] });
  const inOpacity = roll.progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });
  const outOpacity = roll.progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0], extrapolate: 'clamp' });

  return (
    <View
      style={[styles.row, containerStyle]}
      accessible
      accessibilityLabel={accessibilityLabel ?? text}
    >
      {roll.columns.map((col, i) => {
        if (!col.changed) {
          return <Text key={i} style={[style, styles.figures]} maxFontSizeMultiplier={maxFontSizeMultiplier}>{col.to}</Text>;
        }
        // A column that is going away is sized by the character leaving it;
        // every other one by the character arriving.
        const leaving = col.to === '';
        return (
          <View key={i} style={[styles.column, { height }]}>
            <AnimatedText
              maxFontSizeMultiplier={maxFontSizeMultiplier}
              style={[
                style,
                styles.figures,
                leaving
                  ? { opacity: outOpacity, transform: [{ translateY: outY }] }
                  : { opacity: inOpacity, transform: [{ translateY: inY }] },
              ]}
            >
              {leaving ? col.from : col.to}
            </AnimatedText>
            {!leaving && col.from !== '' && (
              <AnimatedText
                maxFontSizeMultiplier={maxFontSizeMultiplier}
                style={[style, styles.figures, styles.outgoing, { opacity: outOpacity, transform: [{ translateY: outY }] }]}
              >
                {col.from}
              </AnimatedText>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { overflow: 'hidden' },
  outgoing: { position: 'absolute', left: 0, right: 0, top: 0 },
  figures: { fontVariant: ['tabular-nums'] },
});
