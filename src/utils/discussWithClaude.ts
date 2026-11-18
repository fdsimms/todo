import { useAskClaudeStore } from '../store/useAskClaudeStore';
import { useDemoStore } from '../store/useDemoStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSyncStore } from '../store/useSyncStore';
import { askClaudeReady } from './askClaudeChat';
import { claudeChatUrl } from './askClaude';
import { openExternalUrl } from './openExternalUrl';

/**
 * "Discuss with Claude" on a task or a project: the message about it, typed
 * into a chat for the person to send. In Ask Claude when it is set up (the
 * same check that draws its other entry points, `askClaudeReady`), so the chat
 * can change what it is about; otherwise in the Claude app, as before.
 *
 * Returns where it went. A caller inside a sheet closes that sheet when it was
 * Ask Claude, in the same handler: Ask Claude's sheet waits for it to go
 * (`SheetModal`'s `canShowSheet`), since two sheets can't be up at once.
 */
export function discussWithClaude(prompt: string): 'askClaude' | 'claudeApp' {
  const settings = useSettingsStore.getState();
  const inApp = askClaudeReady({
    enabled: settings.aiFeatureConfig.askClaude.enabled,
    hasApiKey: !!settings.anthropicApiKey,
    syncServerUrl: useSyncStore.getState().serverUrl,
    hasWriteToken: useAskClaudeStore.getState().hasToken,
    demo: useDemoStore.getState().active,
  });
  if (inApp) {
    useAskClaudeStore.getState().show(prompt);
    return 'askClaude';
  }
  void openExternalUrl(claudeChatUrl(prompt));
  return 'claudeApp';
}

/** The hint under a project's "Discuss with Claude", saying where it will open. */
export function discussProjectHint(askClaude: boolean): string {
  return askClaude ? 'Start a chat about this project in Ask Claude' : 'Start a chat about this project in the Claude app';
}
