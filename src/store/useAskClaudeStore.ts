import { create } from 'zustand';
import { isDemoModeActive } from '../utils/demoState';
import { MCP_WRITE_TOKEN_SECURE_KEY, loadSecureKey, saveSecureKey } from '../utils/secureApiKey';

/**
 * Whether a write token for Ask Claude is saved (`MCP_WRITE_TOKEN_SECURE_KEY`).
 * The token itself is never held here, only whether there is one: it is read
 * out of the keychain for each request, the way `useFrankiStore` holds its key.
 * The conversation is the sheet's own state (`AskClaudeSheet`), since it lasts
 * as long as the sheet does and nothing else reads it.
 */
interface AskClaudeState {
  hasToken: boolean;
  /** Whether the sheet is open. Held here because Today's header and the side menu both open it (`AskClaudeHost`). */
  open: boolean;
  show: () => void;
  hide: () => void;
  /** Reads whether a token is saved. Called once from the root component. */
  initialize: () => Promise<void>;
  /** Saves a token (an empty one removes it). Reports whether it stuck. */
  setToken: (token: string) => Promise<boolean>;
}

export const useAskClaudeStore = create<AskClaudeState>(set => ({
  hasToken: false,
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),

  async initialize() {
    if (isDemoModeActive()) return;
    const token = await loadSecureKey(MCP_WRITE_TOKEN_SECURE_KEY);
    set({ hasToken: !!token });
  },

  async setToken(token: string) {
    const trimmed = token.trim();
    const saved = await saveSecureKey(MCP_WRITE_TOKEN_SECURE_KEY, trimmed);
    if (saved) set({ hasToken: !!trimmed });
    return saved;
  },
}));
