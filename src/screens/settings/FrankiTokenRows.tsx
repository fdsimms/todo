import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useNavigation } from '@react-navigation/native';
import { useFrankiStore } from '../../store/useFrankiStore';
import type { FrankiProblem } from '../../services/franki';
import { InlineAction } from '../../components/InlineAction';
import { TextField } from '../../components/TextField';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { isDemoModeActive } from '../../utils/demoState';
import { haptics } from '../../utils/haptics';
import { reviewQueueAt } from '../../utils/reviewQueue';
import type { FrankiSnapshot } from '../../utils/frankiTasks';
import { navigateToSettingsEntry } from '../../navigation/openSettings';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * The Franki status key row and the problem row under it. One component
 * rendered in two places (Automations, under the Franki generator, and
 * Privacy & AI, beside the other keys), so both write the same keychain entry
 * through `useFrankiStore.setToken`: `WaniKaniTokenRows`' arrangement.
 */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function connectedText(snapshot: FrankiSnapshot): string {
  const due = plural(reviewQueueAt(snapshot, new Date()), 'card', 'cards');
  const reading = snapshot.readListen;
  if (!reading) return `Saved. Connected: ${due} due.`;
  const texts = plural(reading.waiting, 'text', 'texts');
  return `Saved. Connected: ${due} due, ${texts} waiting in ${reading.name}.`;
}

function tokenHint(hasToken: boolean, snapshot: FrankiSnapshot | null, refreshing: boolean): string {
  if (!hasToken) return 'The READER_STATUS_TOKEN set in your Franki server’s .env file. It opens what’s due and nothing else.';
  if (snapshot) return connectedText(snapshot);
  if (refreshing) return 'Saved. Checking it with your server…';
  return 'Saved. Type a new one to replace it.';
}

function problemText(problem: FrankiProblem, detail: string | null): string {
  switch (problem) {
    case 'unauthorized':
      return 'Your Franki server didn’t accept this key. Copy READER_STATUS_TOKEN from its .env file again.';
    case 'notFound':
      return 'Your Franki server doesn’t have this yet. Update it (server/update.sh), then it will try again.';
    case 'unavailable':
      return detail
        ? `${detail} The app will try again in a few minutes.`
        : 'Couldn’t reach your Franki server. Check the address. The app will try again in a few minutes.';
  }
}

export function FrankiTokenRows({ entryId, linkToPrivacy = false }: {
  entryId: string;
  /** Offers a jump to the Privacy & AI copy while no key is saved. */
  linkToPrivacy?: boolean;
}): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const navigation = useNavigation();
  const account = useFrankiStore(useShallow(st => ({
    hasToken: st.hasToken,
    snapshot: st.snapshot,
    problem: st.problem,
    problemDetail: st.problemDetail,
    refreshing: st.refreshing,
    setToken: st.setToken,
  })));
  // Never seeded from the stored value: the key is write-only here.
  const [tokenDraft, setTokenDraft] = useState('');

  const saveToken = (token: string) => {
    void account.setToken(token).then(saved => {
      if (saved) return;
      Alert.alert(
        'Couldn’t save the key',
        isDemoModeActive() ? 'Keys aren’t saved in demo mode.' : 'The keychain didn’t take it. Paste it again.',
      );
    });
  };

  return (
    <>
      <SettingsRow
        entryId={entryId}
        icon="key-outline"
        iconColor={account.hasToken ? colors.accent : undefined}
        label="Status key"
        hint={tokenHint(account.hasToken, account.snapshot, account.refreshing)}
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
          placeholder={account.hasToken ? '••••••••' : 'Paste the key'}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="Franki status key"
        />
        {(linkToPrivacy && !account.hasToken) || account.hasToken ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.smd }}>
            {linkToPrivacy && !account.hasToken && (
              <InlineAction
                label="Open in Privacy & AI"
                variant="neutral"
                onPress={() => { haptics.tap(); navigateToSettingsEntry(navigation, 'frankiTokenPrivacy'); }}
              />
            )}
            {account.hasToken && (
              <InlineAction
                label="Remove key"
                variant="neutral"
                onPress={() => { haptics.tap(); saveToken(''); }}
              />
            )}
          </View>
        ) : null}
      </SettingsRow>
      {account.hasToken && account.problem !== null && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="alert-circle-outline"
            iconColor={colors.red}
            label={problemText(account.problem, account.problemDetail)}
            labelColor={colors.redText}
          />
        </>
      )}
    </>
  );
}
