import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSyncStore } from '../store/useSyncStore';
import { useDemoStore } from '../store/useDemoStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { getNotificationPermission, requestNotificationPermissions } from '../utils/notifications';
import { alertPermissionOff } from '../utils/permissionAlert';
import {
  FIRST_RUN_DEFAULTS, firstRunSettings, shouldOfferFirstRun, type FirstRunAnswers,
} from '../utils/firstRun';

const YES_NO: SegmentOption<boolean>[] = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Opened again from Settings rather than on the first launch: the left
   * button says Cancel instead of Skip, since there is no first run to skip.
   */
  rerun?: boolean;
}

/**
 * The three questions a new install is asked once (`src/utils/firstRun.ts`),
 * and the same sheet when Settings > Feature areas runs setup again.
 *
 * Two of the answers are settings and the third is a permission, which is asked
 * for here, on the tap that says "yes", rather than in a Settings group nobody
 * has a reason to open yet. The sheet opens on the current settings, so Done
 * without touching anything changes nothing, and Skip never writes a setting.
 */
export function FirstRunSheet({ visible, onClose, rerun = false }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const setKitchenEnabled = useSettingsStore(s => s.setKitchenEnabled);
  const setSimpleMode = useSettingsStore(s => s.setSimpleMode);
  const setFirstRunDone = useSettingsStore(s => s.setFirstRunDone);

  const [answers, setAnswers] = useState<FirstRunAnswers>(FIRST_RUN_DEFAULTS);
  useEffect(() => {
    if (!visible) return;
    setAnswers({
      groceriesAndMeals: kitchenEnabled,
      keepItSimple: simpleMode,
      reminders: FIRST_RUN_DEFAULTS.reminders,
    });
    // Read when the sheet opens, not on every change underneath it.
  }, [visible]);

  const dismiss = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const askForReminders = async () => {
    // A denial can't be undone from inside the app (iOS never asks twice), so
    // when it has already happened the way forward is the Settings button.
    if ((await getNotificationPermission()) === 'denied') {
      alertPermissionOff(
        'Notifications are turned off',
        'Reminders need notification permission. Turn it on in Settings, then try again.',
      );
      return;
    }
    await requestNotificationPermissions();
  };

  const finish = () => {
    haptics.success();
    dismiss(() => {
      const next = firstRunSettings(answers);
      if (next.kitchenEnabled !== kitchenEnabled) setKitchenEnabled(next.kitchenEnabled);
      if (next.simpleMode !== simpleMode) setSimpleMode(next.simpleMode);
      setFirstRunDone(true);
      if (answers.reminders) void askForReminders();
    });
  };

  const skip = () => {
    haptics.tap();
    dismiss(() => setFirstRunDone(true));
  };

  return (
    <CardSheet
      name="FirstRunSheet"
      visible={visible}
      controller={card}
      onRequestClose={skip}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label={rerun ? 'Cancel' : 'Skip'} role="cancel" onPress={skip} minWidth={56} />
          <Text style={styles.heading}>Quick setup</Text>
          <SheetHeaderButton label="Done" onPress={finish} minWidth={56} style={styles.headerRight} />
        </View>
        <View style={styles.body}>
          <Text style={styles.hint}>
            Three setup questions. You can change any answer later in Settings.
          </Text>

          <View style={styles.question}>
            <Text style={styles.label}>Groceries & meals</Text>
            <Text style={styles.help}>A shopping list, recipes and a meal plan.</Text>
            <SegmentedControl
              label="Groceries & meals"
              options={YES_NO}
              value={answers.groceriesAndMeals}
              onChange={v => setAnswers(a => ({ ...a, groceriesAndMeals: v }))}
            />
          </View>

          <View style={styles.question}>
            <Text style={styles.label}>Simplified mode</Text>
            <Text style={styles.help}>
              Hides advanced features such as chains, timers, stacks and focus sessions. Choose Yes for a plain to-do list.
            </Text>
            <SegmentedControl
              label="Simplified mode"
              options={YES_NO}
              value={answers.keepItSimple}
              onChange={v => setAnswers(a => ({ ...a, keepItSimple: v }))}
            />
          </View>

          <View style={styles.question}>
            <Text style={styles.label}>Reminders</Text>
            <Text style={styles.help}>Sends a notification when a task has a reminder.</Text>
            <SegmentedControl
              label="Reminders"
              options={YES_NO}
              value={answers.reminders}
              onChange={v => setAnswers(a => ({ ...a, reminders: v }))}
            />
          </View>
        </View>
      </View>
    </CardSheet>
  );
}

/**
 * Puts `FirstRunSheet` up once, on a new install, when everything it depends on
 * has loaded. Mounted once at the app's root. It latches open, so a task the
 * person adds behind it can't take the sheet away mid-answer, and the sheet's
 * own Done and Skip both write `firstRunDone`, which is what ends it.
 */
export function FirstRunHost() {
  const done = useSettingsStore(s => s.firstRunDone);
  const settingsReady = useSettingsStore(s => s.initialized);
  const tasksReady = useTaskStore(s => s.initialized);
  const taskCount = useTaskStore(s => s.tasks.length);
  const syncOn = useSyncStore(s => s.enabled || s.serverUrl !== '');
  const demoActive = useDemoStore(s => s.active);

  const offer = shouldOfferFirstRun({
    done,
    loaded: settingsReady && tasksReady,
    taskCount,
    syncEnabled: syncOn,
    demoActive,
  });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (offer) setOpen(true);
  }, [offer]);

  return <FirstRunSheet visible={open && !done} onClose={() => setOpen(false)} />;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  hint: { color: colors.textSecondary, fontSize: font.sm },
  question: { gap: spacing.xs },
  label: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  help: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.xs },
});
