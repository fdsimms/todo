import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/useSettingsStore';
import { CountStepper } from '../../components/CountStepper';
import { TextField } from '../../components/TextField';
import { useColors } from '../../theme/ThemeContext';
import {
  FRANKI_REVIEW_THRESHOLD_DEFAULT,
  FRANKI_REVIEW_THRESHOLD_MAX,
  FRANKI_REVIEW_THRESHOLD_MIN,
} from '../../utils/frankiTasks';
import { FrankiTokenRows } from './FrankiTokenRows';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * The Franki generator's options, under its row on Automations: the server's
 * address and status key, how many cards make a task, and the Read & Listen
 * task's own switch. `WaniKaniSettingsRows`' shape, for its reason.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function FrankiSettingsRows(): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const s = useSettingsStore(useShallow(st => ({
    server: st.frankiServer,
    threshold: st.frankiReviewThreshold,
    readTasks: st.frankiReadTasks,
    setServer: st.setFrankiServer,
    setThreshold: st.setFrankiReviewThreshold,
    setReadTasks: st.setFrankiReadTasks,
  })));
  return (
    <>
      <View style={styles.sep} />
      <SettingsRow
        entryId="frankiServer"
        icon="server-outline"
        iconColor={s.server ? colors.accent : undefined}
        label="Server"
        hint="Your Anki sync server’s address, the one Franki syncs with."
        alwaysShowHint
      >
        <TextField
          style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
          value={s.server}
          onChangeText={s.setServer}
          placeholder="e.g. anki.example.com"
          placeholderTextColor={colors.textTertiary}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="Franki server address"
        />
      </SettingsRow>

      <View style={styles.sep} />
      <FrankiTokenRows entryId="frankiToken" linkToPrivacy />

      <View style={styles.sep} />
      <SettingsRow
        entryId="frankiReviewThreshold"
        icon="time-outline"
        label="Add the task at"
        hint="How many cards have to be due. If fewer are, the task waits for the time Anki expects that many."
        value={plural(s.threshold, 'card', 'cards')}
        tight
      />
      <View style={styles.cadenceRow}>
        <CountStepper
          value={s.threshold}
          onChange={next => s.setThreshold(next ?? FRANKI_REVIEW_THRESHOLD_DEFAULT)}
          min={FRANKI_REVIEW_THRESHOLD_MIN}
          max={FRANKI_REVIEW_THRESHOLD_MAX}
          label="Cards due"
          describeValue={n => plural(n ?? FRANKI_REVIEW_THRESHOLD_DEFAULT, 'card', 'cards')}
        />
      </View>

      <View style={styles.sep} />
      <SettingsRow
        entryId="frankiReadTasks"
        icon="book-outline"
        iconColor={s.readTasks ? colors.accent : undefined}
        label="Read & Listen"
        hint={s.readTasks
          ? 'A task each day while a text is waiting and none was read today.'
          : 'No reading task'}
        toggle={s.readTasks}
        onPress={() => s.setReadTasks(!s.readTasks)}
      />
    </>
  );
}
