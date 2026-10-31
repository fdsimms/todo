import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { BUTTON_LABEL } from '../copy/shared';
import { adjustedQuantity, parseRowFactor } from '../utils/rowAmount';

type Mode = 'full' | 'half' | 'quarter' | 'other';

const PRESET_MODES: Record<Exclude<Mode, 'other'>, number> = { full: 1, half: 0.5, quarter: 0.25 };

function modeFor(factor: number): Mode {
  if (factor === 1) return 'full';
  if (factor === 0.5) return 'half';
  if (factor === 0.25) return 'quarter';
  return 'other';
}

interface Props {
  visible: boolean;
  /** The line's name, shown under the title. */
  name: string;
  /** The line as the sheet would add it at full amount, as written. */
  quantity: string;
  /** What the line is at now (1 = all of it). */
  factor: number;
  /** Turns a written amount into what the person reads (their unit system). */
  show: (quantity: string) => string;
  /** Called as soon as a valid choice is made; there is nothing to confirm. */
  onChange: (factor: number) => void;
  onClose: () => void;
}

/**
 * How much of one line to add from a recipe: all of it, half, a quarter, or a
 * typed fraction. Every choice commits as it is made (the recipe sheet is the
 * place the whole shop is confirmed), so closing has nothing to guard. A
 * choice the amount can't be reduced by is disabled rather than offered and
 * dropped: see `adjustedQuantity`.
 */
export function RowAmountSheet({ visible, name, quantity, factor, show, onChange, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [mode, setMode] = useState<Mode>('full');
  const [text, setText] = useState('');

  useEffect(() => {
    if (!visible) return;
    const opened = modeFor(factor);
    setMode(opened);
    setText(opened === 'other' ? String(factor) : '');
    // Only on open: the sheet drives `factor` itself while it is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const options: SegmentOption<Mode>[] = [
    { value: 'full', label: 'Full' },
    { value: 'half', label: '½', disabled: adjustedQuantity(quantity, 0.5) === null, accessibilityLabel: 'Half' },
    { value: 'quarter', label: '¼', disabled: adjustedQuantity(quantity, 0.25) === null, accessibilityLabel: 'A quarter' },
    { value: 'other', label: 'Other', disabled: adjustedQuantity(quantity, 0.5) === null },
  ];

  const typed = mode === 'other' ? parseRowFactor(text) : null;
  const typedAmount = typed === null ? null : adjustedQuantity(quantity, typed);
  const typedRefused = mode === 'other' && text.trim() !== '' && (typed === null || typedAmount === null);

  const pick = (next: Mode) => {
    setMode(next);
    if (next === 'other') return;
    onChange(PRESET_MODES[next]);
  };

  const onType = (value: string) => {
    setText(value);
    const parsed = parseRowFactor(value);
    if (parsed !== null && adjustedQuantity(quantity, parsed) !== null) onChange(parsed);
  };

  const previewFactor = mode === 'other' ? (typedAmount === null ? factor : typed ?? factor) : PRESET_MODES[mode];
  const result = adjustedQuantity(quantity, previewFactor);

  return (
    <CardSheet name="RowAmountSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Amount to add</Text>
          <Text style={styles.name} numberOfLines={2}>{name}</Text>
        </View>
        <View style={styles.body}>
          <SegmentedControl<Mode> options={options} value={mode} onChange={pick} label="Amount to add" />
          {mode === 'other' && (
            <TextField
              style={styles.input}
              value={text}
              onChangeText={onType}
              placeholder="e.g. 3/4 or 1.5"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numbers-and-punctuation"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={dismiss}
              accessibilityLabel="Fraction of the amount to add"
            />
          )}
          {typedRefused && (
            <Text style={styles.refusal}>
              {typed === null
                ? 'Enter a number or fraction between 0 and 10, like 3/4.'
                : 'That amount can’t be worked out for this line.'}
            </Text>
          )}
          <View style={styles.preview}>
            {previewFactor !== 1 && <Text style={styles.was}>{show(quantity)}</Text>}
            <Text style={styles.now}>{result ? show(result) : show(quantity)}</Text>
          </View>
          <HelpText style={styles.help}>Changes only what goes on the list. The recipe stays as it is.</HelpText>
        </View>
        <View style={styles.footer}>
          <SheetHeaderButton label={BUTTON_LABEL.done} onPress={dismiss} />
        </View>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, alignItems: 'center', gap: spacing.xxs },
    title: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
    name: { color: colors.textSecondary, fontSize: font.sm, textAlign: 'center' },
    body: { padding: spacing.md, gap: spacing.smd },
    input: {
      color: colors.text, fontSize: font.md, backgroundColor: colors.bgTertiary,
      borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44,
    },
    refusal: { color: colors.redText, fontSize: font.sm },
    preview: { gap: spacing.xxs },
    was: { color: colors.textTertiary, fontSize: font.sm, textDecorationLine: 'line-through' },
    now: { color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold },
    help: { color: colors.textTertiary, fontSize: font.xs, lineHeight: font.xs * 1.4 },
    footer: { alignItems: 'center', paddingBottom: spacing.md },
  });
}
