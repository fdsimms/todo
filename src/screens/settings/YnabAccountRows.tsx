import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useNavigation } from '@react-navigation/native';
import { useYnabStore } from '../../store/useYnabStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { YnabProblem } from '../../services/ynab';
import { InlineAction } from '../../components/InlineAction';
import { TextField } from '../../components/TextField';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { isDemoModeActive } from '../../utils/demoState';
import { haptics } from '../../utils/haptics';
import { animateLayout } from '../../utils/layoutAnimation';
import { YNAB_TOKEN_URL } from '../../utils/ynabTasks';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { navigateToSettingsEntry } from '../../navigation/openSettings';
import { SettingsRow } from './SettingsRow';
import { SettingsChoiceTray } from './SettingsChoiceTray';
import { makeSettingsStyles } from './settingsStyles';

/**
 * The YNAB token row, the problem row under it, and (with `planEntryId`) the
 * plan picker. Rendered in three places: Automations under the YNAB task,
 * Kitchen under the trip budget, and Privacy & AI beside the other keys
 * (token only). All of them write the one keychain entry through
 * `useYnabStore.setToken` and the one `ynabPlanId` setting, so they cannot
 * disagree. Each place passes its own entry ids, since a row id names one
 * spot for Settings search to jump to. WaniKaniTokenRows' shape.
 */

function tokenHint(hasToken: boolean, planCount: number | null, refreshing: boolean): string {
  if (!hasToken) return 'Create one in YNAB under Account Settings, Developer Settings.';
  if (planCount !== null) return `Saved. Connected to ${planCount} ${planCount === 1 ? 'plan' : 'plans'}.`;
  if (refreshing) return 'Saved. Checking it with YNAB…';
  return 'Saved. Type a new one to replace it.';
}

function problemText(problem: YnabProblem): string {
  switch (problem) {
    case 'unauthorized':
      return 'YNAB didn’t accept this token. Create a new one in YNAB under Developer Settings.';
    case 'notFound':
      return 'YNAB doesn’t have the chosen plan any more. Choose another one.';
    case 'rateLimited':
      return 'YNAB asked the app to slow down. It will try again in 15 minutes.';
    case 'unavailable':
      return 'Couldn’t reach YNAB. The app will try again in a few minutes.';
  }
}

export function YnabAccountRows({ tokenEntryId, planEntryId, linkToPrivacy = false }: {
  tokenEntryId: string;
  /** Shows the plan picker under the token, with this entry id. */
  planEntryId?: string;
  /** Offers a jump to the Privacy & AI copy while no token is saved. */
  linkToPrivacy?: boolean;
}): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const navigation = useNavigation();
  const account = useYnabStore(useShallow(st => ({
    hasToken: st.hasToken,
    plans: st.plans,
    problem: st.problem,
    refreshing: st.refreshing,
    setToken: st.setToken,
    loadPlans: st.loadPlans,
  })));
  const planId = useSettingsStore(st => st.ynabPlanId);
  const setPlanId = useSettingsStore(st => st.setYnabPlanId);
  // Never seeded from the stored value: the token is write-only here.
  const [tokenDraft, setTokenDraft] = useState('');
  const [planOpen, setPlanOpen] = useState(false);

  const saveToken = (token: string) => {
    void account.setToken(token).then(saved => {
      if (saved) return;
      Alert.alert(
        'Couldn’t save the token',
        isDemoModeActive() ? 'Tokens aren’t saved in demo mode.' : 'The keychain didn’t take it. Paste it again.',
      );
    });
  };

  const chosenPlan = account.plans?.find(p => p.id === planId) ?? null;
  const togglePlans = () => {
    haptics.tap();
    // The list is read when the token is saved; a launch with a token already
    // saved reads it here, the first time somebody asks to choose.
    if (!planOpen && account.plans === null) void account.loadPlans();
    animateLayout();
    setPlanOpen(!planOpen);
  };

  return (
    <>
      <SettingsRow
        entryId={tokenEntryId}
        icon="key-outline"
        iconColor={account.hasToken ? colors.accent : undefined}
        label="Personal access token"
        hint={tokenHint(account.hasToken, account.plans?.length ?? null, account.refreshing)}
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
          placeholder={account.hasToken ? '••••••••' : 'Paste the token from YNAB'}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="YNAB personal access token"
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.smd }}>
          {(!account.hasToken || account.problem === 'unauthorized') && (
            <InlineAction
              label="Open YNAB"
              icon="open-outline"
              onPress={() => {
                haptics.tap();
                void openExternalUrl(YNAB_TOKEN_URL, 'link');
              }}
            />
          )}
          {linkToPrivacy && !account.hasToken && (
            <InlineAction
              label="Open in Privacy & AI"
              variant="neutral"
              onPress={() => { haptics.tap(); navigateToSettingsEntry(navigation, 'ynabTokenPrivacy'); }}
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
      {planEntryId !== undefined && (
        <>
          <View style={styles.sep} />
          {/* Shown without a token too, so the row Settings search finds is
              always on the page; it says what it is waiting for. */}
          <SettingsRow
            entryId={planEntryId}
            icon="albums-outline"
            iconColor={planId && account.hasToken ? colors.accent : undefined}
            label="Plan"
            hint={!account.hasToken
              ? 'Add a token above to choose one'
              : planId ? undefined : 'Which YNAB plan to read'}
            value={account.hasToken ? chosenPlan?.name ?? (planId ? 'Chosen' : undefined) : undefined}
            expanded={account.hasToken && planOpen}
            disabled={!account.hasToken}
            onPress={togglePlans}
            accessibilityLabel="Choose the YNAB plan"
          />
          {account.hasToken && planOpen && (
            <SettingsChoiceTray
              caption="Read from"
              options={(account.plans ?? []).map(p => ({ id: p.id, title: p.name }))}
              selectedId={planId}
              onSelect={plan => {
                haptics.tap();
                setPlanId(plan.id);
                animateLayout();
                setPlanOpen(false);
              }}
              emptyText={account.plans === null ? 'Loading plans from YNAB…' : 'This YNAB account has no plans.'}
              accessibilityLabelFor={plan => `Read from ${plan.title}`}
            />
          )}
        </>
      )}
    </>
  );
}
