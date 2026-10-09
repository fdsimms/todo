import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
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
import { confirmWithinLimit, recordDose, syncOkAgainNotification, unrecordDose } from '../utils/doseRecording';
import { TextField } from './TextField';

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
  /** The medication a new dose starts on, when opened from its own page. */
  initialName?: string;
  onClose: () => void;
}

/**
 * How long ago a dose recorded today was taken, in minutes. A closed set of
 * the answers people actually give ("about an hour ago"), rather than a time
 * picker, because the point is to record it now while it's remembered. The
 * limit (`medicationSettings.ts`) is measured from this, so "now" for a dose
 * taken two hours ago would put the next one two hours later than it is.
 */
const AGO_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Now' },
  { value: 30, label: '30 min ago' },
  { value: 60, label: '1 hr ago' },
  { value: 120, label: '2 hr ago' },
];

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
export function MedicationLogSheet({ visible, log, initialName, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const logs = useMedicationStore(s => s.logs);
  const archived = useMedicationStore(s => s.archived);
  const updateLog = useMedicationStore(s => s.updateLog);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<string | null>(null);
  const [asNeeded, setAsNeeded] = useState(true);
  const [note, setNote] = useState('');
  const [day, setDay] = useState<Date>(() => noonOfToday());
  const [agoMinutes, setAgoMinutes] = useState(0);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [drafted, setDrafted] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setName(log?.name ?? initialName ?? '');
    setAmount(log?.amount !== null && log?.amount !== undefined ? String(log.amount) : '');
    setUnit(log?.unit ?? null);
    setAsNeeded(log ? log.asNeeded : true);
    setNote(log?.note ?? '');
    setDay(noonOfToday());
    setAgoMinutes(0);
    setShowDatePicker(false);
    setDrafted([]);
  }, [visible, log, initialName]);

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
    for (const candidate of [name, ...medicationVocabulary(logs, archived), ...drafted]) {
      const trimmed = candidate.trim();
      const key = medicationKey(trimmed);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }, [name, logs, archived, drafted]);

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

  const backdated = day.toDateString() !== noonOfToday().toDateString();

  const handleSave = async () => {
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
      syncOkAgainNotification(log.name);
      if (medicationKey(trimmed) !== medicationKey(log.name)) syncOkAgainNotification(trimmed);
    } else {
      // A backdated day records noon on it; today records the real moment,
      // less however long ago it was taken. Only a dose recorded for now-ish
      // is checked against the limit: one remembered from last Tuesday is
      // history, and a warning about it can't change anything.
      const at = backdated
        ? day
        : agoMinutes > 0 ? new Date(Date.now() - agoMinutes * 60_000) : undefined;
      if (!backdated && !(await confirmWithinLimit(trimmed, at ?? new Date()))) return;
      recordDose({
        name: trimmed,
        amount: usableAmount,
        unit,
        asNeeded,
        note,
        at,
      });
    }
    haptics.success();
    onClose();
  };

  const handleDelete = () => {
    if (!log) { onClose(); return; }
    Alert.alert('Delete this dose?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { unrecordDose(log); onClose(); } },
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
            <SheetHeaderButton label="Save" onPress={() => { void handleSave(); }} disabled={!canSave} />
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
        <TextField
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
          Use a repeating task for anything you take on a schedule.
          Checking it off records the dose.
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
          {!backdated && (
            <View style={styles.agoRow}>
              <SegmentedControl
                options={AGO_OPTIONS}
                value={agoMinutes}
                columns={4}
                label="When you took it"
                onChange={value => { haptics.tap(); setAgoMinutes(value); }}
              />
            </View>
          )}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.groupLabel}>NOTES</Text>
        <TextField
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
  agoRow: { marginTop: spacing.sm },
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
