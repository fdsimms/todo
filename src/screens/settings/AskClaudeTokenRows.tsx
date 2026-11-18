import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useAskClaudeStore } from '../../store/useAskClaudeStore';
import { useSyncStore } from '../../store/useSyncStore';
import { InlineAction } from '../../components/InlineAction';
import { TextField } from '../../components/TextField';
import { useColors } from '../../theme/ThemeContext';
import { spacing } from '../../theme';
import { mcpUrlFor } from '../../utils/askClaudeChat';
import { isDemoModeActive } from '../../utils/demoState';
import { haptics } from '../../utils/haptics';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * Ask Claude's write token, under its switch in Privacy & AI. `FrankiTokenRows`'
 * shape: write-only, saved on blur, with a way to remove it. The server
 * address isn't asked for: it is the sync server's (`mcpUrlFor`), so the hint
 * says so when there isn't one.
 */
function tokenHint(hasServer: boolean, hasToken: boolean): string {
  if (!hasServer) return 'Ask Claude works through your sync server. Set one up in Settings, Sync, first.';
  if (hasToken) return 'Saved. Type a new one to replace it.';
  return 'The MCP_WRITE_TOKEN set on your dundundun server. Claude uses it to look things up and propose changes, and this phone uses it to make the ones you confirm.';
}

export function AskClaudeTokenRows(): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const hasToken = useAskClaudeStore(s => s.hasToken);
  const setToken = useAskClaudeStore(s => s.setToken);
  const hasServer = useSyncStore(s => mcpUrlFor(s.serverUrl) !== null);
  // Never seeded from the stored value: the token is write-only here.
  const [draft, setDraft] = useState('');

  const save = (token: string) => {
    void setToken(token).then(saved => {
      if (saved) return;
      Alert.alert(
        'Couldn’t save the token',
        isDemoModeActive() ? 'Tokens aren’t saved in demo mode.' : 'The keychain didn’t take it. Paste it again.',
      );
    });
  };

  return (
    <SettingsRow
      entryId="ai:askClaude:token"
      label="Server write token"
      hint={tokenHint(hasServer, hasToken)}
      alwaysShowHint
    >
      <TextField
        style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
        value={draft}
        onChangeText={setDraft}
        onBlur={() => {
          const token = draft.trim();
          if (!token) return;
          setDraft('');
          save(token);
        }}
        placeholder={hasToken ? '••••••••' : 'Paste the token'}
        placeholderTextColor={colors.textTertiary}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel="Ask Claude server write token"
      />
      {hasToken && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.smd }}>
          <InlineAction
            label="Remove token"
            variant="neutral"
            onPress={() => { haptics.tap(); save(''); }}
          />
        </View>
      )}
    </SettingsRow>
  );
}
