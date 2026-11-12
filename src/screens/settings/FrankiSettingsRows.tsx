import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/useSettingsStore';
import { CountStepper } from '../../components/CountStepper';
import type { SegmentOption } from '../../components/SegmentedControl';
import { TextField } from '../../components/TextField';
import { useColors } from '../../theme/ThemeContext';
import {
  FRANKI_GOAL_MINUTES_DEFAULT,
  FRANKI_GOAL_MINUTES_MAX,
  FRANKI_GOAL_MINUTES_MIN,
  FRANKI_GOAL_MINUTES_STEP,
  FRANKI_REVIEW_THRESHOLD_DEFAULT,
  FRANKI_REVIEW_THRESHOLD_MAX,
  FRANKI_REVIEW_THRESHOLD_MIN,
  type FrankiReviewMode,
} from '../../utils/frankiTasks';
import { FrankiTokenRows } from './FrankiTokenRows';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { makeSettingsStyles } from './settingsStyles';

/**
 * The Franki generator's options, under its row on Automations: the server's
 * address and status key, how the reviews task works (once a day, or in waves
 * of how many cards), the Read & Listen task's own switch, the study-time goal
 * and whether reading counts toward it. `WaniKaniSettingsRows`' shape, for its
 * reason.
 */

const MODE_OPTIONS: SegmentOption<FrankiReviewMode>[] = [
  { value: 'daily', label: 'Once a day' },
  { value: 'waves', label: 'When enough are due' },
];

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
    mode: st.frankiReviewMode,
    goal: st.frankiGoalMinutes,
    countReading: st.frankiCountReading,
    setServer: st.setFrankiServer,
    setThreshold: st.setFrankiReviewThreshold,
    setReadTasks: st.setFrankiReadTasks,
    setMode: st.setFrankiReviewMode,
    setGoal: st.setFrankiGoalMinutes,
    setCountReading: st.setFrankiCountReading,
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
        entryId="frankiReviewMode"
        icon="albums-outline"
        label="Reviews task"
        hint={s.mode === 'daily'
          ? 'One task a day for all of today’s cards, ready once they’re done. New cards count once Share today’s counts is on in Franki, under Settings, Read & Listen.'
          : 'A task each time enough cards are due.'}
        alwaysShowHint
        tight
      />
      <SettingsSegments
        attached
        options={MODE_OPTIONS}
        selected={s.mode}
        onSelect={s.setMode}
        accessibilityLabelFor={o => `Reviews task: ${o.label}`}
      />
      {s.mode === 'waves' && (
        <>
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
        </>
      )}

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

      <View style={styles.sep} />
      <SettingsRow
        entryId="frankiGoalMinutes"
        icon="hourglass-outline"
        iconColor={s.goal !== null ? colors.accent : undefined}
        label="Study goal"
        hint="A task each day until you’ve studied this long in Franki."
        toggle={s.goal !== null}
        onPress={() => s.setGoal(s.goal === null ? FRANKI_GOAL_MINUTES_DEFAULT : null)}
        tight={s.goal !== null}
      />
      {s.goal !== null && (
        <View style={styles.cadenceRow}>
          <CountStepper
            value={s.goal}
            onChange={next => s.setGoal(next ?? FRANKI_GOAL_MINUTES_DEFAULT)}
            min={FRANKI_GOAL_MINUTES_MIN}
            max={FRANKI_GOAL_MINUTES_MAX}
            step={FRANKI_GOAL_MINUTES_STEP}
            label="Minutes a day"
            describeValue={n => `${n ?? FRANKI_GOAL_MINUTES_DEFAULT} min a day`}
          />
        </View>
      )}

      <View style={styles.sep} />
      <SettingsRow
        entryId="frankiCountReading"
        icon="headset-outline"
        iconColor={s.countReading ? colors.accent : undefined}
        label="Count Read & Listen time"
        hint={s.countReading
          ? 'Time reading and listening counts as study time: toward the goal, on the tasks and in Stats.'
          : 'Only time answering cards counts as study time.'}
        toggle={s.countReading}
        onPress={() => s.setCountReading(!s.countReading)}
      />
    </>
  );
}
