import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  canStep, clampCount, holdRepeatDelay, stepCount, type StepRange,
} from '../utils/stepper';

interface Props {
  value: number | null;
  onChange: (next: number | null) => void;
  min: number;
  max: number;
  /** Let − at the floor clear the value instead of sticking there. */
  allowNull?: boolean;
  /**
   * Where + lands from empty, if not `min` — see `StepRange.start`. Only
   * matters together with `allowNull`; there's nothing to seed a start for
   * on a stepper whose floor is never empty to begin with.
   */
  start?: number;
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
 *
 * **The value itself is tappable, and turns into a plain numeric field.**
 * `stepCount` deliberately steps first and clamps second (see its own doc
 * comment) rather than snapping to the step's grid, so a value that started
 * off-grid — typed in from elsewhere, or read off a source with its own
 * precision — stays off-grid on every press after: a sodium target of 2,006
 * steps to 2,106, 2,206, forever carrying that 6. Typing the number directly
 * is the way out, and it's also just faster for a value someone is copying
 * off a label or a doctor's note rather than counting up to. Tapping the
 * digits shows the bare number (never the formatted string — `format` is a
 * display concern, not something to parse back out), autofocuses and
 * preselects it, and commits on blur or submit through `clampCount` — the
 * same clamp a value arriving from outside the valid range already gets.
 * An empty field commits `null` when `allowNull`, otherwise reverts silently:
 * this is a correction, not a second confirm step, so there's no dialog for
 * "leave the field or lose your typing".
 *
 * **What this is not: a stepper whose value is a sentence.** #2132 swept the
 * hand-rolled copies onto this component and left two behind, both template
 * offset rows (`TemplateItemEditor`'s `OffsetRow`, `TemplateItemQuickAdd`'s due
 * offset). Their value isn't a number with a unit beside it — it's
 * `formatOffsetWithAnchor`, which renders the sign as words and the zero as a
 * different sentence again ("On start date" / "3 days before end date" /
 * "2 days after start date"). Two things follow, and both are structural: the
 * value slot here is `minWidth: 40` and can't flex, where those rows give the
 * prose `flex: 1` so it can shrink; and the offsets are deliberately unbounded
 * in *both* directions, where this needs a `min` and a `max`. Splitting the
 * number out as a sibling `Text` doesn't rescue it either, because the sentence
 * is what carries the before/after meaning. If those rows ever want this
 * component, the sentence has to stop being the value first.
 */
export function CountStepper({
  value,
  onChange,
  min,
  max,
  allowNull = false,
  start,
  step = 1,
  emptyLabel = 'Off',
  format = String,
  label,
  describeValue,
  style,
}: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const range: StepRange = { min, max, allowNull, start, step };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

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

  const startRepeat = (delta: number) => {
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

  const openEditor = () => {
    stop();
    setDraft(value === null ? '' : String(value));
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (range.allowNull) onChange(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    const clamped = clampCount(parsed, range);
    if (clamped !== value) onChange(clamped);
  };

  const key = (delta: number, icon: 'remove' | 'add', verb: string) => {
    const enabled = canStep(value, delta, range);
    return (
      <PressableScale
        style={[styles.key, !enabled && styles.keyDisabled]}
        onPressIn={() => enabled && startRepeat(delta)}
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
      {editing ? (
        <TextInput
          style={styles.valueInput}
          value={draft}
          onChangeText={setDraft}
          onBlur={commitEdit}
          onSubmitEditing={commitEdit}
          keyboardType="number-pad"
          autoFocus
          selectTextOnFocus
          accessibilityLabel={`${label}, editing`}
        />
      ) : (
        <PressableScale style={styles.valuePress} onPress={openEditor}>
          <Text
            style={[styles.value, value === null && styles.valueEmpty]}
            accessibilityLabel={`${label}, ${spoken}`}
          >
            {display}
          </Text>
        </PressableScale>
      )}
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
    paddingHorizontal: spacing.smd, paddingVertical: spacing.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  keyDisabled: { opacity: 0.4 },
  valuePress: { paddingVertical: spacing.xs },
  value: {
    // Fits the widest value (99×) without the keys shifting as digits change.
    minWidth: 40, textAlign: 'center',
    color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  valueEmpty: { color: colors.textTertiary, fontWeight: fontWeight.medium },
  // Same box as `value` so the keys don't shift when the field opens; padding
  // 0 and no border keep it looking like the digits themselves, not a form.
  valueInput: {
    minWidth: 40, textAlign: 'center', padding: 0,
    color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold,
  },
});
