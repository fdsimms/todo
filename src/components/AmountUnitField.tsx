import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextInput, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, spacing, type Colors } from '../theme';
import { fieldWell } from '../theme/textStyles';
import {
  amountUnitLabel, OTHER_UNIT, readAmount, writeAmount, type AmountUnitGroup,
} from '../utils/amountUnit';
import { inflectUnit, parseQuantity, rationalToNumber } from '../utils/quantity';
import { ChoiceMenuChip } from './ChoiceMenuChip';
import { TextField } from './TextField';

interface Props {
  /** The quantity string, as every reader parses it ("2 cloves", "3/4 cup"). */
  value: string;
  onChangeText: (next: string) => void;
  /** The menu, from `amountUnit.ts`. A unit key is also the word written. */
  groups: AmountUnitGroup[];
  /** For `SheetModal`'s development warnings. */
  name: string;
  placeholder?: string;
  /** For "Something else", where the whole amount is typed. */
  otherPlaceholder?: string;
  accessibilityLabel: string;
  maxLength?: number;
  style?: StyleProp<ViewStyle>;
  inputRef?: React.Ref<TextInput>;
  returnKeyType?: 'done' | 'next';
  onSubmitEditing?: () => void;
  /** The unit an empty field starts on, when it isn't the menu's first. */
  defaultUnit?: string;
  /** Labels for keys that read differently here: `NO_UNIT` as "of the batch". */
  unitLabels?: Record<string, string>;
}

/**
 * An amount as a number and a unit picked from a menu, read from and written
 * back to the plain quantity string the field it replaces held, so a caller
 * swaps it in for a `TextField` and nothing downstream changes. The menu is the
 * `ChoiceMenuChip` every amount-and-unit field uses (`DoseAmountField`,
 * `UnitMenuChip`), and ends in "Something else" for what it can't hold
 * ("1 14 oz can", "to taste"): the field then takes the whole amount as text.
 * The rules are `amountUnit.ts`.
 */
export function AmountUnitField({
  value, onChangeText, groups, name, placeholder = 'e.g. 2', otherPlaceholder = 'e.g. 1 14 oz can',
  accessibilityLabel, maxLength = 60, style, inputRef, returnKeyType = 'done', onSubmitEditing, defaultUnit, unitLabels,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const units = useMemo(() => groups.flatMap(g => g.units), [groups]);

  // Read from `value` whenever it isn't what this field last wrote: a sheet
  // reseeding on open, or a caller clearing it. What the field writes itself
  // isn't read back, so a unit picked before any number is typed stays picked.
  const read = (text: string) => {
    const got = readAmount(text, units);
    return !got.number && defaultUnit && units.includes(defaultUnit) ? { number: '', unit: defaultUnit } : got;
  };
  const [state, setState] = useState(() => read(value));
  const written = useRef(value);
  if (value !== written.current) {
    written.current = value;
    const next = read(value);
    if (next.number !== state.number || next.unit !== state.unit) setState(next);
  }

  const update = (next: { number: string; unit: string }) => {
    setState(next);
    const text = writeAmount(next.number, next.unit);
    written.current = text;
    onChangeText(text);
  };

  const other = state.unit === OTHER_UNIT;
  // A count reads with its number ("2 cloves", "1 clove").
  const q = parseQuantity(state.number);
  const amount = q.amount ? rationalToNumber(q.rangeMax ?? q.amount) : 1;
  const label = (unit: string) => unitLabels?.[unit] ?? amountUnitLabel(unit);
  const chipLabel = other ? 'Other' : inflectUnit(label(state.unit), amount);

  const menu = useMemo(
    () => groups.map(g => ({
      ...(g.heading ? { heading: g.heading } : {}),
      options: g.units.map(u => ({ key: u, label: unitLabels?.[u] ?? amountUnitLabel(u) })),
    })),
    [groups, unitLabels],
  );

  return (
    <View style={[styles.field, style]}>
      <TextField
        ref={inputRef}
        style={styles.input}
        value={state.number}
        onChangeText={number => update({ number, unit: state.unit })}
        placeholder={other ? otherPlaceholder : placeholder}
        placeholderTextColor={colors.textTertiary}
        maxLength={maxLength}
        // A number, unless the amount is typed whole: "Something else" wants
        // letters ("1 14 oz can"), and fractions need the "/" a decimal pad lacks.
        keyboardType={other ? 'default' : 'numbers-and-punctuation'}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType={returnKeyType}
        blurOnSubmit={returnKeyType === 'done'}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={accessibilityLabel}
      />
      <ChoiceMenuChip
        name={name}
        noun="Unit"
        groups={menu}
        selectedKey={state.unit}
        labelOverride={chipLabel}
        onSelect={unit => {
          // Leaving "Something else", only a leading number carries over:
          // "1 14 oz can" picked as cups would otherwise write "1 14 oz can cups".
          if (other && unit !== OTHER_UNIT) {
            const lead = parseQuantity(state.number);
            const number = lead.amount ? state.number.trim().slice(0, state.number.trim().length - lead.rest.length).trim() : '';
            update({ number, unit });
            return;
          }
          update({ number: state.number, unit });
        }}
      />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    field: { ...fieldWell(colors), paddingLeft: spacing.md, paddingRight: spacing.xs, gap: spacing.sm },
    input: { flex: 1, minWidth: 0, color: colors.text, fontSize: font.md, padding: 0, minHeight: 44 },
  });
}
