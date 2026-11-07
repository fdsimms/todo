import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { YnabAccountRows } from './YnabAccountRows';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * The YNAB generator's options, under its row on Automations: the token and
 * plan (shared with Kitchen's trip budget), and the overspent-category task's
 * own switch.
 */
export function YnabSettingsRows(): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const overspent = useSettingsStore(s => s.ynabOverspentTasks);
  const setOverspent = useSettingsStore(s => s.setYnabOverspentTasks);
  return (
    <>
      <View style={styles.sep} />
      <YnabAccountRows tokenEntryId="ynabToken" planEntryId="ynabPlan" linkToPrivacy />
      <View style={styles.sep} />
      <SettingsRow
        entryId="ynabOverspentTasks"
        icon="alert-circle-outline"
        iconColor={overspent ? colors.accent : undefined}
        label="Overspent categories"
        hint="A task for each category that goes below zero, once a month. It shows as ready to complete once the category is covered."
        toggle={overspent}
        onPress={() => setOverspent(!overspent)}
        accessibilityLabel="Overspent categories"
      />
    </>
  );
}
