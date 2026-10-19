import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { AnimatedNumber } from './AnimatedNumber';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  canStep, clampCount, holdRepeatDelay, parseStepperInput, stepCount, type StepRange,
} from '../utils/stepper';
import { TextField } from './TextField';

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
  /**
   * Decimal places a value keeps when finer than `step` (see `StepRange.places`).
   * Set it, and the field typed into takes a decimal point (or comma), for a
   * stepper whose value isn't a whole number: a weight in 2.5 kg steps.
   */
  places?: number;
  /** Values a press moves between instead of a fixed `step`; see `StepRange.ladder`. */
  ladder?: readonly number[];
  /** Shown in place of a number when `value` is null. */
  emptyLabel?: string;
  /** Renders the number — e.g. `n => `${n}×``. */
  format?: (n: number) => string;
  /** Noun for the a11y labels: "Decrease daily target". */
  label: string;
  /** What a screen reader reads for the value, if `format` doesn't say it well. */
  describeValue?: (n: number | null) => string;
  style?: StyleProp<ViewStyle>;
  /**
   * For a stepper that shares a row with other cells: it fills the width it is
   * given, with narrower keys (36pt, so two fit side by side on a phone).
   */
  inline?: boolean;
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
  places,
  ladder,
  emptyLabel = 'Off',
  format = String,
  label,
  describeValue,
  style,
  inline = false,
}: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const range: StepRange = { min, max, allowNull, start, step, places, ladder };
  // A decimal field wherever the value can hold one; a whole-number counter
  // keeps the number pad, which has no point key to mistype.
  const decimal = (places ?? 0) > 0 || !Number.isInteger(step);

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

    // 'limit' is a step that landed on the end of the range: nothing past it
    // will move, so the repeat stops there.
    const apply = (): 'moved' | 'limit' | 'stuck' => {
      const current = latest.current;
      const next = stepCount(current.value, delta, current.range);
      if (next === current.value) {
        stop();
        return 'stuck';
      }
      // Keep the local copy moving too: a repeat can outrun the re-render.
      latest.current = { ...current, value: next };
      current.onChange(next);
      return canStep(next, delta, current.range) ? 'moved' : 'limit';
    };

    // Every step is felt, not just the first: a held key used to go silent
    // after its opening tick. Repeats use dragTick, which is rate-limited, so a
    // fast ramp doesn't blur into one long buzz. The step that reaches the end
    // of the range gets a firmer bump in place of its tick, never as well as.
    const first = apply();
    if (first === 'stuck') return;
    if (first === 'limit') { haptics.impactLight(); return; }
    haptics.tap();

    const schedule = () => {
      timer.current = setTimeout(() => {
        const result = apply();
        if (result === 'stuck') return;
        if (result === 'limit') { haptics.impactLight(); stop(); return; }
        haptics.dragTick();
        tick.current += 1;
        schedule();
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
    const parsed = parseStepperInput(trimmed, range);
    if (parsed === null) return;
    const clamped = clampCount(parsed, range);
    if (clamped !== value) onChange(clamped);
  };

  const key = (delta: number, icon: 'remove' | 'add', verb: string) => {
    const enabled = canStep(value, delta, range);
    return (
      <PressableScale
        style={[styles.key, inline && styles.keyInline, !enabled && styles.keyDisabled]}
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
    <View style={[styles.wrap, inline && styles.wrapInline, style]}>
      {key(-step, 'remove', 'Decrease')}
      {editing ? (
        <TextField
          style={[styles.valueInput, inline && styles.valueInputInline]}
          value={draft}
          onChangeText={setDraft}
          onBlur={commitEdit}
          onSubmitEditing={commitEdit}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          autoFocus
          selectTextOnFocus
          accessibilityLabel={`${label}, editing`}
        />
      ) : (
        <PressableScale style={[styles.valuePress, inline && styles.valuePressInline]} onPress={openEditor}>
          <AnimatedNumber
            text={display}
            value={value}
            style={[styles.value, value === null && styles.valueEmpty]}
            containerStyle={styles.valueBox}
            accessibilityLabel={`${label}, ${spoken}`}
          />
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
  wrapInline: { alignSelf: 'stretch', justifyContent: 'space-between' },
  // 12 + a 20pt glyph + 12 is a 44pt key: the minimum comfortable tap target
  // and no wider. The control's width is the two keys plus the digits.
  key: {
    paddingHorizontal: spacing.smd, paddingVertical: spacing.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  keyInline: { paddingHorizontal: spacing.sm },
  keyDisabled: { opacity: 0.4 },
  valuePress: { paddingVertical: spacing.xs },
  valuePressInline: { flex: 1, alignItems: 'center' },
  // Fits the widest value (99×) without the keys shifting as digits change.
  valueBox: { minWidth: 40, justifyContent: 'center' },
  value: {
    color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  valueEmpty: { color: colors.textTertiary, fontWeight: fontWeight.medium },
  // Same box as `value` so the keys don't shift when the field opens; padding
  // 0 and no border keep it looking like the digits themselves, not a form.
  valueInputInline: { flex: 1, minWidth: 0 },
  valueInput: {
    minWidth: 40, textAlign: 'center', padding: 0,
    color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold,
  },
});
