import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { SettingsSection } from '../screens/settings/SettingsSection';
import { SettingsRow } from '../screens/settings/SettingsRow';
import { InlineTimePicker } from '../screens/settings/InlineTimePicker';
import { makeSettingsStyles } from '../screens/settings/settingsStyles';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { allGroups, groupName, resolveGroupId } from '../utils/appGroups';
import {
  WEEKDAYS, formatMinutes, scheduleProblem, type BlockSchedule,
} from '../utils/blockSchedule';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The schedule being edited, or null to make a new one. */
  scheduleId: string | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Draft {
  name: string;
  groupId: string;
  days: number[];
  startMinutes: number;
  endMinutes: number;
  tagCanPause: boolean;
}

const NEW_DRAFT: Draft = {
  name: '',
  groupId: 'default',
  days: [...WEEKDAYS],
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
  tagCanPause: true,
};

const draftKey = (d: Draft) => JSON.stringify([d.name.trim(), d.groupId, [...d.days].sort(), d.startMinutes, d.endMinutes, d.tagCanPause]);

function minutesToDate(minutes: number): Date {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/**
 * The editor for one schedule: when it blocks, which group of apps, and whether
 * a key tag can pause it. A schedule saves on Save only, so the swipe-down
 * goes through the same discard confirmation Cancel does.
 */
export function BlockScheduleSheet({ visible, onClose, scheduleId }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settingsStyles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const use24HourTime = useSettingsStore(s => s.use24HourTime);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const customGroups = useAppGroupStore(s => s.groups);
  const existing = useAppGroupStore(s => s.schedules.find(x => x.id === scheduleId) ?? null);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [editingTime, setEditingTime] = useState<'start' | 'end' | null>(null);
  const [pendingTime, setPendingTime] = useState<Date>(() => minutesToDate(0));
  const baseline = useRef(draftKey(NEW_DRAFT));

  // Seeded each time the sheet opens, with the baseline stamped alongside so
  // "differs from what it opened with" has something fixed to compare to.
  useEffect(() => {
    if (!visible) return;
    const seed: Draft = existing
      ? {
        name: existing.name,
        groupId: resolveGroupId(customGroups, existing.groupId),
        days: [...existing.days],
        startMinutes: existing.startMinutes,
        endMinutes: existing.endMinutes,
        tagCanPause: existing.tagCanPause,
      }
      : NEW_DRAFT;
    setDraft(seed);
    setEditingTime(null);
    baseline.current = draftKey(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scheduleId]);

  const problem = scheduleProblem(draft);
  const dirty = draftKey(draft) !== baseline.current;
  const orderedDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7),
    [weekStartsOn],
  );

  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const handleSave = () => {
    if (problem) return;
    const fields: Omit<BlockSchedule, 'id' | 'pausedUntil'> = {
      ...draft,
      name: draft.name,
      enabled: existing?.enabled ?? true,
    };
    const store = useAppGroupStore.getState();
    const result = scheduleId ? store.updateSchedule(scheduleId, fields) : store.addSchedule(fields);
    if (!result.ok) {
      Alert.alert(
        result.reason === 'full' ? 'Too many schedules' : 'Can’t save this schedule',
        result.reason === 'full' ? 'Remove a schedule before adding another.' : result.message,
      );
      return;
    }
    haptics.success();
    onClose();
  };

  const toggleDay = (day: number) => {
    haptics.tap();
    setDraft(d => ({
      ...d,
      days: d.days.includes(day) ? d.days.filter(x => x !== day) : [...d.days, day],
    }));
  };

  const chooseGroup = () => {
    haptics.tap();
    Alert.alert('Apps to block', 'Choose which group of apps this schedule blocks.', [
      ...allGroups(customGroups).map(g => ({
        text: g.id === draft.groupId ? `${g.name} (selected)` : g.name,
        onPress: () => setDraft(d => ({ ...d, groupId: g.id })),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const openTime = (which: 'start' | 'end') => {
    haptics.tap();
    if (editingTime === which) { setEditingTime(null); return; }
    setPendingTime(minutesToDate(which === 'start' ? draft.startMinutes : draft.endMinutes));
    setEditingTime(which);
  };

  const confirmTime = () => {
    const minutes = pendingTime.getHours() * 60 + pendingTime.getMinutes();
    setDraft(d => (editingTime === 'start' ? { ...d, startMinutes: minutes } : { ...d, endMinutes: minutes }));
    setEditingTime(null);
  };

  const remove = () => {
    if (!scheduleId) return;
    confirmDelete({
      title: 'Delete this schedule?',
      message: 'Its apps stay as they are; the schedule just stops blocking them.',
      onConfirm: () => {
        useAppGroupStore.getState().removeSchedule(scheduleId);
        onClose();
      },
    });
  };

  const overnight = draft.endMinutes <= draft.startMinutes && draft.startMinutes !== draft.endMinutes;

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title={scheduleId ? 'Edit schedule' : 'New schedule'}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label="Save" onPress={handleSave} disabled={problem !== null} minWidth={64} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <SettingsSection label="Name">
            <View style={styles.nameWrap}>
              <TextField
                style={styles.nameInput}
                value={draft.name}
                onChangeText={name => setDraft(d => ({ ...d, name }))}
                placeholder="Schedule name"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="sentences"
                returnKeyType="done"
                maxLength={24}
                accessibilityLabel="Schedule name"
              />
            </View>
          </SettingsSection>

          <SettingsSection label="Days" footer={overnight ? 'This runs overnight. It belongs to the day it starts on, so a Friday window still blocks early Saturday.' : undefined}>
            <View style={styles.dayRow}>
              {orderedDays.map(day => {
                const on = draft.days.includes(day);
                return (
                  <TouchableOpacity
                    key={day}
                    style={[settingsStyles.pill, on && settingsStyles.pillActive, styles.dayPill]}
                    onPress={() => toggleDay(day)}
                    accessibilityRole="button"
                    accessibilityLabel={DAY_NAMES[day]}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[settingsStyles.pillText, on && settingsStyles.pillTextActive]}>{DAY_INITIALS[day]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </SettingsSection>

          <SettingsSection label="Time">
            <SettingsRow
              icon="play-outline"
              label="Starts"
              value={formatMinutes(draft.startMinutes, use24HourTime)}
              expanded={editingTime === 'start'}
              onPress={() => openTime('start')}
            />
            {editingTime === 'start' && (
              <InlineTimePicker value={pendingTime} onChange={setPendingTime} onCancel={() => setEditingTime(null)} onConfirm={confirmTime} />
            )}
            <View style={settingsStyles.sep} />
            <SettingsRow
              icon="stop-outline"
              label="Ends"
              value={formatMinutes(draft.endMinutes, use24HourTime)}
              expanded={editingTime === 'end'}
              onPress={() => openTime('end')}
            />
            {editingTime === 'end' && (
              <InlineTimePicker value={pendingTime} onChange={setPendingTime} onCancel={() => setEditingTime(null)} onConfirm={confirmTime} />
            )}
          </SettingsSection>
          {problem && <Text style={styles.problem}>{problem}</Text>}

          <SettingsSection label="Apps">
            <SettingsRow
              icon="apps-outline"
              label="Apps to block"
              hint="Choose the apps in each group on the Screen Time screen."
              value={groupName(customGroups, draft.groupId)}
              onPress={chooseGroup}
            />
            <View style={settingsStyles.sep} />
            <SettingsRow
              icon="radio-outline"
              label="Key tag can pause it"
              hint={draft.tagCanPause
                ? 'Tapping a key tag during a block lifts it until it ends. The next block starts on time.'
                : 'A key tag does nothing to this schedule.'}
              toggle={draft.tagCanPause}
              onPress={() => { haptics.tap(); setDraft(d => ({ ...d, tagCanPause: !d.tagCanPause })); }}
            />
          </SettingsSection>

          {scheduleId && (
            <SettingsSection>
              <SettingsRow icon="trash-outline" iconColor={colors.red} label="Delete schedule" labelColor={colors.redText} onPress={remove} />
            </SettingsSection>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    content: { paddingBottom: spacing.xl },
    nameWrap: { padding: spacing.md },
    nameInput: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium, minHeight: 36 },
    dayRow: { flexDirection: 'row', gap: spacing.xs, padding: spacing.md },
    dayPill: { paddingHorizontal: 0, borderRadius: radius.sm },
    problem: {
      color: colors.redText, fontSize: font.sm, marginHorizontal: spacing.md, marginBottom: spacing.md,
    },
  });
}
