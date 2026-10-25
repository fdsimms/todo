import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../theme';
import { isPresetMinutes, parseCustomMinutes, shortMinutesLabel, type MinutesRange } from '../utils/customMinutes';
import { CustomMinutesField } from './CustomMinutesField';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';

const OTHER = 'other' as const;
type PickValue = number | null | typeof OTHER;

interface Props {
  /** The quick picks. A `null` value is an option like "Off" or "Until I end it". */
  presets: SegmentOption<number | null>[];
  value: number | null;
  onChange: (minutes: number | null) => void;
  /** What a typed value may be. Presets are never checked against it. */
  range: MinutesRange;
  /** Names the group for screen readers: "Block length". */
  label: string;
  columns?: number;
  surface?: 'page' | 'card';
  /** The text on the last segment while nothing custom is set. Defaults to "Other…". */
  otherLabel?: string;
  /** Shows a typed value on its own segment. Defaults to "45 min", "1 hr 30 min". */
  describe?: (minutes: number) => string;
}

/**
 * A row of preset lengths with a last segment for any other number. Picking it
 * (or opening a row whose saved value isn't a preset) shows a minutes field
 * under the track, and a typed value takes that segment's label so the row
 * still reads as one choice made. A value the field refuses is never passed to
 * `onChange`: the row keeps its last good one and the field says why.
 *
 * The presets stay the fast path. This exists so the answer to "I wanted 45"
 * is a number field rather than the nearest preset.
 */
export function MinutesSegments({
  presets, value, onChange, range, label, columns, surface, otherLabel = 'Other…', describe = shortMinutesLabel,
}: Props) {
  const custom = value !== null && !isPresetMinutes(value, presets.map(p => p.value));
  const [otherOpen, setOtherOpen] = useState(false);
  const [text, setText] = useState(custom && value !== null ? String(value) : '');
  const showField = otherOpen || custom;
  const selected: PickValue = showField ? OTHER : value;

  const options: SegmentOption<PickValue>[] = [
    ...presets,
    {
      value: OTHER,
      label: custom && value !== null ? describe(value) : otherLabel,
      accessibilityLabel: custom && value !== null ? `${label}, ${describe(value)}. Change` : `${label}, other`,
    },
  ];

  const onPick = (next: PickValue) => {
    if (next === OTHER) {
      setOtherOpen(true);
      setText(value !== null ? String(value) : '');
      return;
    }
    setOtherOpen(false);
    setText('');
    onChange(next);
  };

  const onType = (t: string) => {
    setText(t);
    // Typing a number that happens to be a preset must not close the field under the finger.
    setOtherOpen(true);
    const parsed = parseCustomMinutes(t, range);
    if (parsed !== null) onChange(parsed);
  };

  return (
    <View>
      <SegmentedControl<PickValue>
        options={options}
        value={selected}
        onChange={onPick}
        columns={columns}
        label={label}
        surface={surface}
      />
      {showField && (
        <View style={styles.field}>
          <CustomMinutesField text={text} onChangeText={onType} range={range} label={label} autoFocus={otherOpen && !custom} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: spacing.smd },
});
