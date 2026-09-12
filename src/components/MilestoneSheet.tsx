import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { Milestone } from '../types';
import { useMilestoneStore } from '../store/useMilestoneStore';
import { EditorSheet } from './EditorSheet';
import { EditorRow } from './EditorRow';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { WhenPicker } from './WhenPicker';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { getLogicalToday } from '../utils/dateUtils';

const LABEL_MAX_LENGTH = 80;

/**
 * Noon on today's logical day — the same anchor `WhenPicker` gives a picked
 * date (`noonOf`), so a default nobody touches still lands on the invariant
 * this sheet's date field promises: a timezone or DST boundary can't drag it
 * onto the wrong day.
 */
function noonOfToday(): Date {
  const d = getLogicalToday();
  d.setHours(12, 0, 0, 0);
  return d;
}

interface Props {
  visible: boolean;
  /** The milestone being edited, or null to add a new one. */
  milestone: Milestone | null;
  onClose: () => void;
}

/**
 * Marking a day something changed — see `docs/arch/mood-log.md`.
 *
 * Two fields only, mirroring `PersonNoteSheet`: what happened, and the day it
 * happened. There is no kind picker, unlike that sheet's — a milestone has no
 * fixed vocabulary, freeform label and all.
 *
 * The date defaults to today rather than starting empty, and there is no way
 * to clear it: unlike a `PersonNote`'s optional `relevantOn`, a milestone
 * *is* its date — it is the split point every before/after read on the Mood
 * screen is built from, so there is no "any time" state for it to have.
 */
export function MilestoneSheet({ visible, milestone, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const addMilestone = useMilestoneStore(s => s.addMilestone);
  const updateMilestone = useMilestoneStore(s => s.updateMilestone);
  const removeMilestone = useMilestoneStore(s => s.removeMilestone);

  const [label, setLabel] = useState('');
  const [date, setDate] = useState<Date>(() => noonOfToday());
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLabel(milestone?.label ?? '');
    setDate(milestone ? new Date(milestone.date) : noonOfToday());
    setShowDatePicker(false);
  }, [visible, milestone]);

  const saveAndClose = () => {
    const trimmed = label.trim();
    if (milestone) {
      // An emptied label is a deleted milestone rather than a blank row, the
      // same call `PersonNoteSheet` makes about an emptied note: the field is
      // the whole content, so clearing it is the only thing it could mean.
      if (!trimmed) removeMilestone(milestone.id);
      else updateMilestone(milestone.id, { label: trimmed, date: date.toISOString() });
    } else if (trimmed) {
      addMilestone(trimmed, date);
    }
    onClose();
  };

  const handleDelete = () => {
    if (!milestone) { onClose(); return; }
    Alert.alert('Delete this milestone?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { removeMilestone(milestone.id); onClose(); } },
    ]);
  };

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title={milestone ? 'Edit milestone' : 'New milestone'}
          left={<SheetHeaderButton label="Done" onPress={saveAndClose} />}
          right={milestone ? (
            <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete milestone">
              <Ionicons name="trash-outline" size={20} color={colors.red} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        />
      }
      footer={
        <WhenPicker
          visible={showDatePicker}
          value={date}
          title="Date"
          showTimeOfDay={false}
          showSuggest={false}
          onConfirm={picked => { if (picked) setDate(picked); setShowDatePicker(false); }}
          onCancel={() => setShowDatePicker(false)}
        />
      }
    >
      <TextInput
        style={styles.textInput}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. Started sertraline"
        placeholderTextColor={colors.textTertiary}
        maxLength={LABEL_MAX_LENGTH}
        multiline
        autoFocus={!milestone}
        accessibilityLabel="What happened"
      />

      <EditorRow
        icon="calendar-outline"
        label="Date"
        value={format(date, 'EEE, MMM d, yyyy')}
        onPress={() => { haptics.tap(); setShowDatePicker(true); }}
      />
      <Text style={styles.hint}>
        Used to split your mood record into before and after this day.
      </Text>
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
  headerSpacer: { width: 20 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  textInput: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: 17,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
});
