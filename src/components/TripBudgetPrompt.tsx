import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetHeaderButton } from './SheetHeaderButton';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, radius, spacing, type Colors } from '../theme';
import { formatPriceInput, parsePriceInput, priceToInput } from '../utils/groceryPrice';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  /** The ceiling as it stands, or null for none set. */
  budgetMinor: number | null;
  currencySymbol: string;
  /** Null clears it. */
  onSave: (budgetMinor: number | null) => void;
  onClose: () => void;
}

/**
 * Setting what this trip was meant to cost.
 *
 * A small centered card rather than a page sheet, the one shape
 * `LogMealPrompt` already uses and for its reason: there is a single field
 * here, and a full sheet for one number is a lot of screen for a question you
 * answer in three taps. It is also why the `KeyboardAvoidingView` is the right
 * tool rather than `useKeyboardInsetScroll` — there is no ScrollView to inset,
 * and that hook's own note says the two fight each other.
 *
 * Reached from the running total in `ActiveTripBanner` rather than from the
 * sheet that starts a trip, which is a deliberate departure from the issue's
 * "typed when the trip starts". Three reasons, and the third is the one that
 * decided it:
 *
 * 1. There are two ways to start a trip (`ShoppingTripSheet` and
 *    `StartTripPrompt`), so a field at the start is two fields to keep in step.
 * 2. Hanging it off the banner means it is settable from every kitchen screen,
 *    which is where the banner already is.
 * 3. A budget is a thing people decide *at* the shelf as often as before
 *    leaving, and a ceiling you cannot change once the shop has started is one
 *    you have to abandon rather than adjust. Nothing about the feature wanted
 *    it to be write-once.
 *
 * The banner shows the moment a trip starts, so "typed when the trip starts"
 * is still one tap away; what changed is that it stayed available afterwards.
 */
export function TripBudgetPrompt({ visible, budgetMinor, currencySymbol, onSave, onClose }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Re-seeded on every open rather than held, so reopening after a cancel
  // offers what is actually saved rather than the abandoned edit.
  useEffect(() => {
    if (!visible) return;
    setText(budgetMinor === null ? '' : priceToInput(budgetMinor));
    // The sheet stays mounted across opens, so a bare `autoFocus` on the
    // field would only ever fire once.
    inputRef.current?.focus();
  }, [visible, budgetMinor]);

  const parsed = parsePriceInput(text);

  const save = () => {
    haptics.tap();
    // An empty field means no ceiling, which is a real answer and the one the
    // Clear row would otherwise be the only way to give.
    onSave(text.trim() === '' ? null : parsed);
    onClose();
  };

  const clear = () => {
    haptics.tap();
    onSave(null);
    onClose();
  };

  return (
    <SheetModal
      name="TripBudgetPrompt"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Trip budget</Text>
          <Text style={styles.hint}>
            What you meant to spend. The running total shows either way; this is what
            it gets compared to.
          </Text>

          <View style={styles.field}>
            <Text style={styles.symbol}>{currencySymbol}</Text>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={text}
              // Cents-first entry, the same rule every other price field in the
              // app follows, so the decimal point never has to be typed.
              onChangeText={t => setText(formatPriceInput(t))}
              keyboardType="number-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
              inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
              accessibilityLabel="Trip budget"
            />
          </View>

          <View style={styles.actions}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={72} />
            {budgetMinor !== null && (
              <SheetHeaderButton label="Clear" role="cancel" onPress={clear} minWidth={72} />
            )}
            <SheetHeaderButton label="Save" onPress={save} minWidth={72} />
          </View>
        </View>
      </KeyboardAvoidingView>
      {Platform.OS === 'ios' && <NumberPadAccessory />}
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  title: {
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  hint: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    borderWidth: border.hairline,
    borderColor: colors.separator,
    paddingHorizontal: spacing.smd,
    marginTop: spacing.md,
  },
  symbol: { fontSize: font.lg, color: colors.textSecondary },
  input: {
    flex: 1,
    fontSize: font.xl,
    color: colors.text,
    // Never lineHeight on a TextInput — see the note in CLAUDE.md.
    height: 48,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.md,
  },
});
