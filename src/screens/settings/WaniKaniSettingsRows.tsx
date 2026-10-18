import React, { useMemo, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useWaniKaniStore } from '../../store/useWaniKaniStore';
import type { WaniKaniProblem, WaniKaniUser } from '../../services/wanikani';
import { CountStepper } from '../../components/CountStepper';
import { InlineAction } from '../../components/InlineAction';
import { TextField } from '../../components/TextField';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { isDemoModeActive } from '../../utils/demoState';
import { haptics } from '../../utils/haptics';
import {
  WANIKANI_APPRENTICE_CAP_DEFAULT,
  WANIKANI_APPRENTICE_CAP_MAX,
  WANIKANI_APPRENTICE_CAP_MIN,
  WANIKANI_APPRENTICE_CAP_STEP,
  WANIKANI_LESSONS_PER_DAY_MAX,
  WANIKANI_LESSONS_PER_DAY_MIN,
  WANIKANI_REVIEW_THRESHOLD_DEFAULT,
  WANIKANI_REVIEW_THRESHOLD_MAX,
  WANIKANI_REVIEW_THRESHOLD_MIN,
  WANIKANI_TOKEN_URL,
} from '../../utils/wanikaniTasks';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * The WaniKani generator's options, under its row on Automations: the API
 * token, how many reviews make a task, the daily lessons task and its
 * Apprentice cap, and whether a held task notifies. Its own file because the
 * token needs a draft and the account's status, which the other generators'
 * extras don't, and `GeneratedTasksSection` is long enough.
 */

function tokenHint(hasToken: boolean, user: WaniKaniUser | null, refreshing: boolean): string {
  if (!hasToken) return 'Create one on wanikani.com under Settings, API Tokens. Read-only access is enough.';
  if (user) return `Saved. Connected as ${user.username}, level ${user.level}.`;
  if (refreshing) return 'Saved. Checking it with WaniKani…';
  return 'Saved. Type a new one to replace it.';
}

function problemText(problem: WaniKaniProblem): string {
  switch (problem) {
    case 'unauthorized':
      return 'WaniKani didn’t accept this token. Copy it again from Settings, API Tokens on wanikani.com.';
    case 'rateLimited':
      return 'WaniKani asked the app to slow down. It will try again in a few minutes.';
    case 'unavailable':
      return 'Couldn’t reach WaniKani. The app will try again in a few minutes.';
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function WaniKaniSettingsRows(): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const s = useSettingsStore(useShallow(st => ({
    threshold: st.wanikaniReviewThreshold,
    lessonsPerDay: st.wanikaniLessonsPerDay,
    apprenticeCap: st.wanikaniApprenticeCap,
    notify: st.wanikaniNotify,
    setThreshold: st.setWanikaniReviewThreshold,
    setLessonsPerDay: st.setWanikaniLessonsPerDay,
    setApprenticeCap: st.setWanikaniApprenticeCap,
    setNotify: st.setWanikaniNotify,
  })));
  const account = useWaniKaniStore(useShallow(st => ({
    hasToken: st.hasToken,
    user: st.user,
    problem: st.problem,
    refreshing: st.refreshing,
    setToken: st.setToken,
  })));
  // Never seeded from the stored value: the token is write-only here, as the
  // sync server's is. What the row reports is whether one is saved and whose.
  const [tokenDraft, setTokenDraft] = useState('');

  const saveToken = (token: string) => {
    void account.setToken(token).then(saved => {
      if (saved) return;
      Alert.alert(
        'Couldn’t save the token',
        isDemoModeActive() ? 'Tokens aren’t saved in demo mode.' : 'The keychain didn’t take it. Paste it again.',
      );
    });
  };

  return (
    <>
      <View style={styles.sep} />
      <SettingsRow
        entryId="wanikaniToken"
        icon="key-outline"
        iconColor={account.hasToken ? colors.accent : undefined}
        label="API token"
        hint={tokenHint(account.hasToken, account.user, account.refreshing)}
        alwaysShowHint
      >
        <TextField
          style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
          value={tokenDraft}
          onChangeText={setTokenDraft}
          onBlur={() => {
            const token = tokenDraft.trim();
            if (!token) return;
            setTokenDraft('');
            saveToken(token);
          }}
          placeholder={account.hasToken ? '••••••••' : 'e.g. 1a2b3c4d-…'}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="WaniKani API token"
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.smd }}>
          {/* Where to make one, while there's none or the one saved was refused. */}
          {(!account.hasToken || account.problem === 'unauthorized') && (
            <InlineAction
              label="Open WaniKani"
              icon="open-outline"
              onPress={() => {
                haptics.tap();
                void Linking.openURL(WANIKANI_TOKEN_URL).catch(() => {});
              }}
            />
          )}
          {account.hasToken && (
            <InlineAction
              label="Remove token"
              variant="neutral"
              onPress={() => { haptics.tap(); saveToken(''); }}
            />
          )}
        </View>
      </SettingsRow>
      {account.hasToken && account.problem !== null && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="alert-circle-outline"
            iconColor={colors.red}
            label={problemText(account.problem)}
            labelColor={colors.redText}
          />
        </>
      )}

      <View style={styles.sep} />
      <SettingsRow
        entryId="wanikaniReviewThreshold"
        icon="time-outline"
        label="Add the task at"
        hint="How many reviews have to be waiting. If fewer are, the task waits for the hour WaniKani expects that many."
        value={plural(s.threshold, 'review', 'reviews')}
        tight
      />
      <View style={styles.cadenceRow}>
        <CountStepper
          value={s.threshold}
          onChange={next => s.setThreshold(next ?? WANIKANI_REVIEW_THRESHOLD_DEFAULT)}
          min={WANIKANI_REVIEW_THRESHOLD_MIN}
          max={WANIKANI_REVIEW_THRESHOLD_MAX}
          label="Reviews waiting"
          describeValue={n => plural(n ?? WANIKANI_REVIEW_THRESHOLD_DEFAULT, 'review', 'reviews')}
        />
      </View>

      <View style={styles.sep} />
      <SettingsRow
        entryId="wanikaniLessonsPerDay"
        icon="sparkles-outline"
        iconColor={s.lessonsPerDay !== null ? colors.accent : undefined}
        label="Lessons"
        hint="A task each day to do this many lessons, on a day there are lessons to do."
        value={s.lessonsPerDay === null ? 'Off' : `${s.lessonsPerDay} a day`}
        tight
      />
      <View style={styles.cadenceRow}>
        <CountStepper
          value={s.lessonsPerDay}
          onChange={s.setLessonsPerDay}
          min={WANIKANI_LESSONS_PER_DAY_MIN}
          max={WANIKANI_LESSONS_PER_DAY_MAX}
          start={5}
          allowNull
          label="Lessons a day"
          describeValue={n => (n === null ? 'No lessons task' : `${plural(n, 'lesson', 'lessons')} a day`)}
        />
      </View>

      {s.lessonsPerDay !== null && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="wanikaniApprenticeCap"
            icon="layers-outline"
            label="Skip lessons at"
            hint="No lessons task on a day this many items or more are in Apprentice."
            value={s.apprenticeCap === null ? 'No limit' : plural(s.apprenticeCap, 'item', 'items')}
            tight
          />
          <View style={styles.cadenceRow}>
            <CountStepper
              value={s.apprenticeCap ?? WANIKANI_APPRENTICE_CAP_MAX}
              onChange={next => s.setApprenticeCap(next ?? WANIKANI_APPRENTICE_CAP_DEFAULT)}
              min={WANIKANI_APPRENTICE_CAP_MIN}
              max={WANIKANI_APPRENTICE_CAP_MAX}
              step={WANIKANI_APPRENTICE_CAP_STEP}
              label="Apprentice items"
              describeValue={n => plural(n ?? WANIKANI_APPRENTICE_CAP_DEFAULT, 'item', 'items')}
            />
          </View>
        </>
      )}

      <View style={styles.sep} />
      <SettingsRow
        entryId="wanikaniNotify"
        icon="notifications-outline"
        iconColor={s.notify ? colors.accent : undefined}
        label="Notify when reviews arrive"
        hint={s.notify
          ? 'A notification at the hour a held task appears.'
          : 'The task appears without a notification'}
        toggle={s.notify}
        onPress={() => s.setNotify(!s.notify)}
      />
    </>
  );
}
