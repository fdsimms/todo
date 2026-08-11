import React, { useState, useMemo } from 'react';
import { View, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTaskStore } from '../../store/useTaskStore';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { CalendarPicker } from '../../components/CalendarPicker';
import { EXPIRED_TASK_GRACE_OPTIONS, expiredTaskGraceLabel, type ExpiredTaskGraceDays } from '../../utils/expiredTaskGrace';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsPills, type PillOption } from './SettingsPills';
import { makeSettingsStyles } from './settingsStyles';

const EXPIRED_TASK_GRACE_PILLS: PillOption<ExpiredTaskGraceDays>[] =
  EXPIRED_TASK_GRACE_OPTIONS.map(o => ({ value: o.value, label: o.label }));

export function TasksProjectsSettings() {
  const vacationMode = useSettingsStore(s => s.vacationMode);
  const setVacationMode = useSettingsStore(s => s.setVacationMode);
  const vacationStart = useSettingsStore(s => s.vacationStart);
  const vacationEnd = useSettingsStore(s => s.vacationEnd);
  const setVacationEnd = useSettingsStore(s => s.setVacationEnd);
  const autoRemoveExpiredTasks = useSettingsStore(s => s.autoRemoveExpiredTasks);
  const setAutoRemoveExpiredTasks = useSettingsStore(s => s.setAutoRemoveExpiredTasks);
  const autoArchiveProjectsOnComplete = useSettingsStore(s => s.autoArchiveProjectsOnComplete);
  const setAutoArchiveProjectsOnComplete = useSettingsStore(s => s.setAutoArchiveProjectsOnComplete);
  const hideCategories = useSettingsStore(s => s.hideCategories);
  const setHideCategories = useSettingsStore(s => s.setHideCategories);

  const forgivVacationStreaks = useTaskStore(s => s.forgivVacationStreaks);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const [showVacationEndPicker, setShowVacationEndPicker] = useState(false);

  return (
    <>
      <SettingsSection
        label="Vacation"
        footer={`${vacationMode && vacationStart ? `On since ${format(new Date(vacationStart), 'MMM d')}. ` : ''}While on, tasks with "vacation pause" enabled are hidden everywhere and their streaks are protected. You can also hide whole categories on vacation from the Categories screen. Turn it off when you return and streaks will be forgiven automatically, or set an end date to have it happen for you.`}
      >
        <SettingsRow
          icon="airplane-outline"
          iconColor={vacationMode ? colors.accent : undefined}
          label="Vacation mode"
          hint="Hides tasks marked for vacation pause"
          toggle={vacationMode}
          onPress={() => {
            if (vacationMode) {
              forgivVacationStreaks();
              setVacationMode(false);
            } else {
              setVacationMode(true);
            }
          }}
        />
        {vacationMode && (
          <>
            <View style={styles.sep} />
            <SettingsRow
              icon="calendar-outline"
              label="End date"
              hint={vacationEnd
                ? 'Turns off automatically on this day'
                : 'Optional — turn off manually if not set'}
              value={vacationEnd ? format(new Date(vacationEnd), 'MMM d, yyyy') : 'None'}
              onPress={() => setShowVacationEndPicker(true)}
              accessibilityLabel="Vacation end date"
              trailing={vacationEnd ? (
                <TouchableOpacity
                  onPress={() => setVacationEnd(null)}
                  hitSlop={8}
                  style={{ marginLeft: spacing.xs }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear vacation end date"
                >
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : undefined}
            />
          </>
        )}
      </SettingsSection>

      <SettingsSection
        label="Time-limited tasks"
        footer={'A task with a time window (like "farmers market, 8am–1pm") moves to Expired once its window closes, whether or not it repeats.'}
      >
        <SettingsRow
          icon="time-outline"
          iconColor={autoRemoveExpiredTasks === null ? undefined : colors.accent}
          label="Auto-remove expired tasks"
          hint={autoRemoveExpiredTasks === null
            ? 'Kept in an Expired section until you delete them'
            : autoRemoveExpiredTasks === 0
              ? 'Deleted the moment their time window closes'
              : `Deleted ${expiredTaskGraceLabel(autoRemoveExpiredTasks).toLowerCase()} after their time window closes`}
          tight
        />
        <SettingsPills
          attached
          options={EXPIRED_TASK_GRACE_PILLS}
          selected={autoRemoveExpiredTasks}
          onSelect={setAutoRemoveExpiredTasks}
          accessibilityLabelFor={o => `Auto-remove expired tasks: ${o.label}`}
        />
      </SettingsSection>

      <SettingsSection
        label="Today"
        footer="Also available from Today's … menu."
      >
        <SettingsRow
          icon="eye-off-outline"
          iconColor={hideCategories ? colors.accent : undefined}
          label="Hide categories"
          hint={hideCategories ? 'Showing one flat list of tasks' : 'Group tasks under category headers'}
          toggle={hideCategories}
          onPress={() => setHideCategories(!hideCategories)}
        />
      </SettingsSection>

      <SettingsSection label="Projects">
        <SettingsRow
          icon="briefcase-outline"
          iconColor={autoArchiveProjectsOnComplete ? colors.accent : undefined}
          label="Auto-archive projects"
          hint={autoArchiveProjectsOnComplete
            ? 'A project archives itself once every task in it is done'
            : 'A finished project sits at 100% until you archive it'}
          toggle={autoArchiveProjectsOnComplete}
          onPress={() => setAutoArchiveProjectsOnComplete(!autoArchiveProjectsOnComplete)}
        />
      </SettingsSection>

      <CalendarPicker
        visible={showVacationEndPicker}
        value={vacationEnd ? new Date(vacationEnd) : null}
        mode="date"
        title="Vacation End Date"
        onConfirm={date => {
          const endOfDay = new Date(date);
          endOfDay.setHours(23, 59, 59, 999);
          setVacationEnd(endOfDay.toISOString());
          setShowVacationEndPicker(false);
        }}
        onCancel={() => setShowVacationEndPicker(false)}
      />
    </>
  );
}
