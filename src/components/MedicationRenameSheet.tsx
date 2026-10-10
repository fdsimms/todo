import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useMedicationStore } from '../store/useMedicationStore';
import { EditorSheet } from './EditorSheet';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { DOSE_UNITS, medicationKey } from '../utils/medicationLog';
import { splitStrength } from '../utils/medicationRename';
import { renameMedicationEverywhere } from '../utils/medicationRenameApply';

const NAME_MAX_LENGTH = 60;

interface Props {
  visible: boolean;
  /** The medication being renamed, as it is spelled now. */
  name: string;
  onClose: () => void;
  /** Called after the rename, with the new name (the page's key changes with it). */
  onRenamed: (newName: string) => void;
}

/**
 * Rename a medication, or fold it into another one.
 *
 * "Ibuprofen 200" and "Ibuprofen 400" are two medications because
 * `medicationKey` never folds names on its own. This is the person doing it:
 * rename one to "Ibuprofen" and every dose, the limit and supply, and the tasks
 * that record it follow. The strength the old name carried can be stamped onto
 * the doses that recorded no amount, so combining them doesn't lose it; doses
 * that already have an amount keep it.
 */
export function MedicationRenameSheet({ visible, name, onClose, onRenamed }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const logs = useMedicationStore(s => s.logs);

  const [draft, setDraft] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<string | null>(null);

  // A name that carries its strength ("Ibuprofen 200") is prefilled as the
  // medicine and the strength, for the person to confirm or clear.
  useEffect(() => {
    if (!visible) return;
    const split = splitStrength(name);
    setDraft(split?.stem ?? name);
    setAmount(split ? String(split.amount) : '');
    setUnit(split?.unit ?? null);
  }, [visible, name]);

  const fromKey = medicationKey(name);
  const toKey = medicationKey(draft);
  const own = useMemo(() => logs.filter(l => medicationKey(l.name) === fromKey), [logs, fromKey]);
  const withoutAmount = own.filter(l => l.amount === null).length;
  const target = useMemo(
    () => (toKey && toKey !== fromKey ? logs.find(l => medicationKey(l.name) === toKey) ?? null : null),
    [logs, toKey, fromKey],
  );
  const targetDoses = useMemo(
    () => (target ? logs.filter(l => medicationKey(l.name) === toKey).length : 0),
    [logs, target, toKey],
  );

  const parsed = Number(amount.trim());
  // The amount card is hidden when every dose has one, so a prefilled amount
  // must not block saving from a field nobody can see.
  const hasAmount = withoutAmount > 0 && amount.trim() !== '';
  const amountValid = !hasAmount || (Number.isFinite(parsed) && parsed > 0);
  // An amount with no unit would be dropped by the store, so it is refused
  // here with the reason instead of saving something other than what's shown.
  const needsUnit = hasAmount && amountValid && !unit;
  const unchanged = draft.trim() === name.trim() && !(hasAmount && unit);
  const canSave = toKey.length > 0 && amountValid && !needsUnit && !unchanged;

  const run = () => {
    const to = draft.trim();
    const fill = hasAmount && unit ? { amount: parsed, unit } : null;
    const done = renameMedicationEverywhere(name, to, fill);
    if (done === null) return;
    haptics.success();
    onRenamed(to);
    onClose();
  };

  const handleSave = () => {
    if (!canSave) return;
    if (!target) { run(); return; }
    Alert.alert(
      `Combine with ${target.name.trim()}?`,
      `The ${own.length} ${own.length === 1 ? 'dose' : 'doses'} of ${name} will be recorded as ${target.name.trim()}, `
        + `which already has ${targetDoses}. Its limit and supply stay as they are.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Combine', onPress: run },
      ],
    );
  };

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title="Rename medication"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} />}
          right={<SheetHeaderButton label="Save" onPress={handleSave} disabled={!canSave} />}
        />
      }
    >
      <View style={styles.card}>
        <Text style={styles.groupLabel}>NAME</Text>
        <TextField
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          maxLength={NAME_MAX_LENGTH}
          autoCapitalize="words"
          accessibilityLabel="Medication name"
        />
        <Text style={styles.hint}>
          {target
            ? `You already have a medication called ${target.name.trim()}. Saving combines the two.`
            : 'Every dose, the limit and supply, and any task that records this medication use the new name.'}
        </Text>
      </View>

      {withoutAmount > 0 && (
        <View style={styles.card}>
          <Text style={styles.groupLabel}>AMOUNT FOR DOSES WITHOUT ONE</Text>
          <Text style={styles.hint}>
            {`Optional. ${withoutAmount} ${withoutAmount === 1 ? 'dose has' : 'doses have'} no amount. `
              + 'Enter one to record it on those. Doses that already have an amount keep it.'}
          </Text>
          <TextField
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="e.g. 200"
            placeholderTextColor={colors.textTertiary}
            keyboardType="decimal-pad"
            accessibilityLabel="Amount"
          />
          <SegmentedControl
            options={DOSE_UNITS.map(u => ({ value: u.value, label: u.value }))}
            value={unit ?? ''}
            columns={5}
            label="Unit"
            onChange={value => { haptics.tap(); setUnit(value === unit ? null : value); }}
          />
          {!amountValid && <Text style={styles.error}>Enter a number greater than 0.</Text>}
          {needsUnit && <Text style={styles.error}>Pick a unit for that amount.</Text>}
        </View>
      )}
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  error: {
    color: colors.redText,
    fontSize: font.xs,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
    marginBottom: spacing.sm,
  },
});
