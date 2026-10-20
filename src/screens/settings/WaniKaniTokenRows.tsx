import React, { useMemo, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useWaniKaniStore } from '../../store/useWaniKaniStore';
import type { WaniKaniProblem, WaniKaniUser } from '../../services/wanikani';
import { InlineAction } from '../../components/InlineAction';
import { TextField } from '../../components/TextField';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { isDemoModeActive } from '../../utils/demoState';
import { haptics } from '../../utils/haptics';
import { WANIKANI_TOKEN_URL } from '../../utils/wanikaniTasks';
import { navigateToSettingsEntry } from '../../navigation/openSettings';
import { useNavigation } from '@react-navigation/native';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * The WaniKani token row and the problem row under it. One component rendered
 * in two places (Automations, under the WaniKani generator, and Privacy & AI,
 * beside the other keys), so both write the same keychain entry through
 * `useWaniKaniStore.setToken` and cannot disagree. Each place passes its own
 * `entryId`, since a row id names one spot for Settings search to jump to.
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

export function WaniKaniTokenRows({ entryId, linkToPrivacy = false }: {
  entryId: string;
  /** Offers a jump to the Privacy & AI copy while no token is saved. */
  linkToPrivacy?: boolean;
}): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const navigation = useNavigation();
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
      <SettingsRow
        entryId={entryId}
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
          {linkToPrivacy && !account.hasToken && (
            <InlineAction
              label="Open in Privacy & AI"
              variant="neutral"
              onPress={() => { haptics.tap(); navigateToSettingsEntry(navigation, 'wanikaniTokenPrivacy'); }}
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

    </>
  );
}
