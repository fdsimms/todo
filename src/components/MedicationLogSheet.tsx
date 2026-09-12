import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { MedicationLog } from '../types';
import { useMedicationStore } from '../store/useMedicationStore';
import { EditorSheet } from './EditorSheet';
import { EditorRow } from './EditorRow';
import { PillGroup } from './PillGroup';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { WhenPicker } from './WhenPicker';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { getLogicalToday } from '../utils/dateUtils';
import { DOSE_UNITS, medicationKey, medicationVocabulary } from '../utils/medicationLog';

const NAME_MAX_LENGTH = 60;
const NOTE_MAX_LENGTH = 200;

/**
 * Noon on today's logical day — the anchor `WhenPicker` gives a picked date,
 * so a backdated dose can't be dragged onto the wrong day by a timezone or a
 * DST hour. Same reasoning `MilestoneSheet` and a backdated mood entry use.
 */
function noonOfToday(): Date {
  const d = getLogicalToday();
  d.setHours(12, 0, 0, 0);
  return d;
}

interface Props {
  visible: boolean;
  /** The dose being edited, or null to record a new one. */
  log: MedicationLog | null;
  onClose: () => void;
}

/**
 * Recording a dose by hand — see `src/utils/medicationLog.ts`.
 *
 * **This is not where a scheduled dose goes.** Something you take on a
 * schedule is a repeating task carrying a medication, and completing it
 * records the dose without anybody typing it twice. What this sheet is for is
 * the case a task can't express: a dose taken as needed, which by definition
 * had nothing scheduled to tick.
 *
 * So `asNeeded` defaults to on. A dose reaching this sheet is one no task
 * recorded, which is what as-needed means; somebody catching up a scheduled
 * dose they forgot to tick flips it, and the control says so plainly rather
 * than the sheet guessing from history.
 */
export function MedicationLogSheet({ visible, log, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const logs = useMedicationStore(s => s.logs);
  const addLog = useMedicationStore(s => s.addLog);
  const updateLog = useMedicationStore(s => s.updateLog);
  const removeLog = useMedicationStore(s => s.removeLog);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<string | null>(null);
  const [asNeeded, setAsNeeded] = useState(true);
  const [note, setNote] = useState('');
  const [day, setDay] = useState<Date>(() => noonOfToday());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [drafted, setDrafted] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setName(log?.name ?? '');
    setAmount(log?.amount !== null && log?.amount !== undefined ? String(log.amount) : '');
    setUnit(log?.unit ?? null);
    setAsNeeded(log ? log.asNeeded : true);
    setNote(log?.note ?? '');
    setDay(noonOfToday());
    setShowDatePicker(false);
    setDrafted([]);
  }, [visible, log]);

  /**
   * The pills to offer: what's picked, then what's been logged before, then
   * anything named in this session. Deduped on the match key so re-typing a
   * remembered name with different capitalisation doesn't produce two pills.
   * Same union `MoodLogSheet` builds, and for the same reason — the vocabulary
   * is derived from *saved* doses, so a just-invented name would otherwise
   * vanish on the next render.
   */
  const pillNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const candidate of [name, ...medicationVocabulary(logs), ...drafted]) {
      const trimmed = candidate.trim();
      const key = medicationKey(trimmed);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }, [name, logs, drafted]);

  const createMedication = (raw: string): string | null | void => {
    const trimmed = raw.trim();
    if (!trimmed) return 'Give it a name.';
    if (pillNames.some(n => medicationKey(n) === medicationKey(trimmed))) {
      return 'You already have that one.';
    }
    setDrafted(d => [...d, trimmed]);
    setName(trimmed);
  };

  const canSave = name.trim().length > 0;

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const parsed = Number(amount.trim());
    const usableAmount = amount.trim() !== '' && Number.isFinite(parsed) ? parsed : null;
    if (log) {
      updateLog(log.id, {
        name: trimmed,
        amount: usableAmount,
        unit,
        asNeeded,
        note,
      });
    } else {
      const today = noonOfToday();
      const backdated = day.toDateString() !== today.toDateString();
      addLog({
        name: trimmed,
        amount: usableAmount,
        unit,
        asNeeded,
        note,
        // Only pass an instant when the day was actually changed, so the
        // ordinary case records the real moment rather than noon.
        at: backdated ? day : undefined,
      });
    }
    haptics.success();
    onClose();
  };

  const handleDelete = () => {
    if (!log) { onClose(); return; }
    Alert.alert('Delete this dose?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { removeLog(log.id); onClose(); } },
    ]);
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
          title={log ? 'Edit dose' : 'Record a dose'}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} />}
          right={log ? (
            <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete dose">
              <Ionicons name="trash-outline" size={20} color={colors.red} />
            </TouchableOpacity>
          ) : (
            <SheetHeaderButton label="Save" onPress={handleSave} disabled={!canSave} />
          )}
        />
      }
      footer={
        <WhenPicker
          visible={showDatePicker}
          value={day}
          title="Day"
          showTimeOfDay={false}
          showSuggest={false}
          allowFuture={false}
          onConfirm={picked => { if (picked) setDay(picked); setShowDatePicker(false); }}
          onCancel={() => setShowDatePicker(false)}
        />
      }
    >
      <View style={styles.card}>
        <Text style={styles.groupLabel}>WHAT YOU TOOK</Text>
        <PillGroup
          noun="medication"
          surface="card"
          onCreate={createMedication}
          createMaxLength={NAME_MAX_LENGTH}
          filterPlaceholder="Find or add a medication…"
          options={pillNames.map(candidate => ({
            key: medicationKey(candidate),
            label: candidate,
            selected: medicationKey(candidate) === medicationKey(name),
            onPress: () => { haptics.tap(); setName(candidate); },
          }))}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.groupLabel}>HOW MUCH</Text>
        <Text style={styles.hint}>
          Optional. Leave it blank to record only that you took it.
        </Text>
        <TextInput
          style={styles.amountInput}
          value={amount}
          onChangeText={setAmount}
          placeholder="e.g. 400"
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
      </View>

      <View style={styles.card}>
        <Text style={styles.groupLabel}>WHY YOU TOOK IT</Text>
        <SegmentedControl
          options={[
            { value: true, label: 'As needed' },
            { value: false, label: 'On schedule' },
          ]}
          value={asNeeded}
          label="Why you took it"
          onChange={value => { haptics.tap(); setAsNeeded(value); }}
        />
        <Text style={styles.hint}>
          Something you take on a schedule is better kept as a repeating task,
          which records the dose when you check it off.
        </Text>
      </View>

      {!log && (
        <View style={styles.card}>
          <EditorRow
            icon="calendar-outline"
            label="Day"
            value={format(day, 'EEE, MMM d')}
            onPress={() => { haptics.tap(); setShowDatePicker(true); }}
          />
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.groupLabel}>NOTES</Text>
        <TextInput
          style={styles.noteInput}
          value={note}
          onChangeText={setNote}
          placeholder="e.g. took it with food"
          placeholderTextColor={colors.textTertiary}
          maxLength={NOTE_MAX_LENGTH}
          multiline
          accessibilityLabel="Notes"
        />
      </View>
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
  amountInput: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
    marginBottom: spacing.sm,
  },
  noteInput: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
    minHeight: 60,
    textAlignVertical: 'top',
  },
});
