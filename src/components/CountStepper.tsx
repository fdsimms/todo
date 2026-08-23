import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { canStep, holdRepeatDelay, stepCount, type StepRange } from '../utils/stepper';

interface Props {
  value: number | null;
  onChange: (next: number | null) => void;
  min: number;
  max: number;
  /** Let − at the floor clear the value instead of sticking there. */
  allowNull?: boolean;
  /**
   * How much one press moves the value. Default 1.
   *
   * For a number whose useful granularity isn't 1 — minutes, where stepping a
   * time window from 15 to 90 is five presses at 15 and seventy-five at 1.
   * `min` should be a multiple of it, since that's where − lands coming back
   * up from null and where the value grid starts.
   */
  step?: number;
  /** Shown in place of a number when `value` is null. */
  emptyLabel?: string;
  /** Renders the number — e.g. `n => `${n}×``. */
  format?: (n: number) => string;
  /** Noun for the a11y labels: "Decrease daily target". */
  label: string;
  /** What a screen reader reads for the value, if `format` doesn't say it well. */
  describeValue?: (n: number | null) => string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A − value + control for a small integer.
 *
 * The alternative is a row of preset chips, which is what Daily target used to
 * be: it has to pick a ceiling and a granularity for everyone, and the moment
 * either is wrong for you there's no way to say so. A stepper has neither, and
 * it collapses a wrapping grid down to one line.
 *
 * Holding a key repeats after a pause (`holdRepeatDelay`), so a value well past
 * the ones you'd have offered as chips is a second of holding rather than
 * thirty taps. Stepping happens on press-*in* — a stepper that waits for the
 * release feels broken next to iOS's own.
 */
export function CountStepper({
  value,
  onChange,
  min,
  max,
  allowNull = false,
  step = 1,
  emptyLabel = 'Off',
  format = String,
  label,
  describeValue,
  style,
}: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const range: StepRange = { min, max, allowNull };

  // The repeat timer fires outside React's render cycle, so it reads the live
  // value and callback from here rather than from a stale closure.
  const latest = useRef({ value, onChange, range });
  latest.current = { value, onChange, range };

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef(0);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const start = (delta: number) => {
    stop();
    tick.current = 0;

    const apply = () => {
      const current = latest.current;
      const next = stepCount(current.value, delta, current.range);
      if (next === current.value) {
        stop();
        return false;
      }
      // Keep the local copy moving too: a repeat can outrun the re-render.
      latest.current = { ...current, value: next };
      current.onChange(next);
      return true;
    };

    haptics.tap();
    if (!apply()) return;

    const schedule = () => {
      timer.current = setTimeout(() => {
        if (apply()) {
          tick.current += 1;
          schedule();
        }
      }, holdRepeatDelay(tick.current));
    };
    schedule();
  };

  const display = value === null ? emptyLabel : format(value);
  const spoken = describeValue ? describeValue(value) : display;

  const key = (delta: number, icon: 'remove' | 'add', verb: string) => {
    const enabled = canStep(value, delta, range);
    return (
      <PressableScale
        style={[styles.key, !enabled && styles.keyDisabled]}
        onPressIn={() => enabled && start(delta)}
        onPressOut={stop}
        disabled={!enabled}
        accessibilityLabel={`${verb} ${label.toLowerCase()}`}
        accessibilityState={{ disabled: !enabled }}
      >
        <Ionicons
          name={icon}
          size={iconSize.md}
          color={enabled ? colors.text : colors.textTertiary}
        />
      </PressableScale>
    );
  };

  return (
    <View style={[styles.wrap, style]}>
      {key(-step, 'remove', 'Decrease')}
      <Text
        style={[styles.value, value === null && styles.valueEmpty]}
        accessibilityLabel={`${label}, ${spoken}`}
      >
        {display}
      </Text>
      {key(step, 'add', 'Increase')}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: colors.bgTertiary, borderRadius: radius.full,
  },
  // 12 + a 20pt glyph + 12 is a 44pt key: the minimum comfortable tap target
  // and no wider. The control's width is the two keys plus the digits.
  key: {
    paddingHorizontal: 12, paddingVertical: spacing.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  keyDisabled: { opacity: 0.4 },
  value: {
    // Fits the widest value (99×) without the keys shifting as digits change.
    minWidth: 40, textAlign: 'center',
    color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  valueEmpty: { color: colors.textTertiary, fontWeight: fontWeight.medium },
});
