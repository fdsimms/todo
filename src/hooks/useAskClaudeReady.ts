import { useAskClaudeStore } from '../store/useAskClaudeStore';
import { useDemoStore } from '../store/useDemoStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSyncStore } from '../store/useSyncStore';
import { askClaudeReady } from '../utils/askClaudeChat';

/** Whether Ask Claude's entry points are drawn (`askClaudeReady` has the rule). */
export function useAskClaudeReady(): boolean {
  const enabled = useSettingsStore(s => s.aiFeatureConfig.askClaude.enabled);
  const hasApiKey = useSettingsStore(s => !!s.anthropicApiKey);
  const syncServerUrl = useSyncStore(s => s.serverUrl);
  const hasWriteToken = useAskClaudeStore(s => s.hasToken);
  const demo = useDemoStore(s => s.active);
  return askClaudeReady({ enabled, hasApiKey, syncServerUrl, hasWriteToken, demo });
}
