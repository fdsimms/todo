import { useSyncStore } from '../store/useSyncStore';
import { useUnattendedStore } from '../store/useUnattendedStore';
import { agentUndoPlan, revertBatch, revertableInBatch } from '../utils/agentUndo';
import { agentUndoReaders, applyAgentUndo } from '../utils/agentUndoRun';
import {
  ASK_CLAUDE_BETA,
  buildAskRequest,
  confirmChangeRequest,
  confirmRefusalText,
  mcpUrlFor,
  readConfirmResponse,
  type AskPreview,
  type AskTurn,
  type ConfirmOutcome,
} from '../utils/askClaudeChat';
import { isDemoModeActive } from '../utils/demoState';
import { MCP_WRITE_TOKEN_SECURE_KEY, loadSecureKey } from '../utils/secureApiKey';
import { callAnthropic, describeAIError, requireFeature } from './aiSuggestions';

/**
 * Ask Claude's three calls: a message to Claude (through the MCP connector),
 * a Confirm to the person's own server, and an Undo on the phone. The rules
 * are in `src/utils/askClaudeChat.ts`.
 */

/** A reply can take several tool calls on the server, each a round trip from Anthropic to it. */
const ASK_TIMEOUT_MS = 90_000;
const CONFIRM_TIMEOUT_MS = 30_000;
/** How many times a reply paused on a long run of tool calls is picked up again before giving up. */
const MAX_CONTINUATIONS = 3;

const NO_TOKEN = 'No MCP write token';
const NO_SERVER = 'No sync server';
const DECLINED = 'Claude declined';

async function connection(): Promise<{ mcpUrl: string; writeToken: string }> {
  const mcpUrl = mcpUrlFor(useSyncStore.getState().serverUrl);
  if (!mcpUrl) throw new Error(NO_SERVER);
  const writeToken = await loadSecureKey(MCP_WRITE_TOKEN_SECURE_KEY);
  if (!writeToken) throw new Error(NO_TOKEN);
  return { mcpUrl, writeToken };
}

/**
 * Sends the conversation and returns Claude's reply as one assistant turn,
 * kept exactly as the API sent it, so it can go back in the next request.
 * A reply that paused partway (a long run of server-side tool calls) is sent
 * back to be continued, and the pieces are joined into the one turn.
 */
export async function askClaude(history: readonly AskTurn[]): Promise<AskTurn> {
  const { apiKey, model } = requireFeature('askClaude');
  const { mcpUrl, writeToken } = await connection();
  const content: unknown[] = [];
  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
    const messages: AskTurn[] = content.length ? [...history, { role: 'assistant', content: [...content] }] : [...history];
    const data = await callAnthropic(
      buildAskRequest({ history: messages, mcpUrl, writeToken }),
      apiKey, model, ASK_TIMEOUT_MS, [ASK_CLAUDE_BETA],
    );
    content.push(...(data.content ?? []));
    if (data.stop_reason === 'refusal') throw new Error(DECLINED);
    if (data.stop_reason !== 'pause_turn') break;
  }
  return { role: 'assistant', content };
}

/** A failure from `askClaude`, in words for the person. */
export function describeAskError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === NO_TOKEN) return 'Add your server’s write token in Settings, Privacy & AI, under Ask Claude.';
  if (message === NO_SERVER) return 'Ask Claude works through your sync server. Set one up in Settings, Sync.';
  if (message === DECLINED) return 'Claude didn’t answer that one. Try asking another way.';
  // A refusal naming the server is the connector failing to reach it, which a
  // different model won't fix, so not describeAIError's advice.
  const reason = (error as { reason?: string } | null)?.reason ?? '';
  if (message.startsWith('API error 4') && /mcp|server|connect/i.test(reason)) {
    return `Claude couldn’t reach your server (${reason}). Check the sync address and the write token in Settings.`;
  }
  return describeAIError(error, 'askClaude');
}

/**
 * Makes a previewed change by calling `confirm_change` on the person's server
 * directly. No model request: the person's tap is the approval, and the
 * server kept the request when it issued the token.
 */
export async function confirmPreview(preview: AskPreview): Promise<ConfirmOutcome> {
  if (isDemoModeActive()) return { ok: false, reason: 'Changes aren’t made in demo mode.' };
  if (!preview.confirmToken) return { ok: false, reason: 'There’s nothing to confirm in this one.' };
  let mcpUrl: string;
  let writeToken: string;
  try {
    ({ mcpUrl, writeToken } = await connection());
  } catch (e) {
    return { ok: false, reason: describeAskError(e) };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIRM_TIMEOUT_MS);
  try {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${writeToken}`,
      },
      body: JSON.stringify(confirmChangeRequest(preview)),
      // Cast for the reason httpSyncTransport.ts gives.
      signal: controller.signal as unknown as RequestInit['signal'],
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'Your server didn’t accept the write token. Check it in Settings, Privacy & AI, under Ask Claude.' };
    }
    if (!response.ok) return { ok: false, reason: `Your server answered with an error (${response.status}), so nothing changed. Try again.` };
    const outcome = readConfirmResponse(await response.text());
    return outcome.ok ? outcome : { ok: false, reason: confirmRefusalText(outcome.reason) };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, reason: 'Your server didn’t answer in time. Check Activity before trying again, in case the change went through.' };
    }
    return { ok: false, reason: 'Couldn’t reach your server, so nothing changed. Check your connection and try again.' };
  } finally {
    clearTimeout(timer);
  }
}

export type UndoOutcome =
  | { ok: true; reverted: number; skipped: number }
  | { ok: false; reason: string };

/**
 * Takes back what one confirmed change did, the way Activity's "Undo all"
 * does (`revertBatch`), so every guard there holds: a record changed since is
 * left alone. The change was made on the server, so it is pulled first if it
 * hasn't reached this phone yet, and the undo is sent on straight after.
 */
export async function undoConfirmed(batchId: string): Promise<UndoOutcome> {
  const planFor = (e: Parameters<typeof agentUndoPlan>[0]) => agentUndoPlan(e, agentUndoReaders());
  const pending = () => revertableInBatch(useUnattendedStore.getState().entries, batchId, planFor);
  if (pending() === 0) await useSyncStore.getState().syncNow().catch(() => null);
  if (pending() === 0) {
    return { ok: false, reason: 'This change hasn’t reached this phone yet, or was already changed since. Try again in a moment, or undo it from Activity.' };
  }
  const result = revertBatch(useUnattendedStore.getState().entries, batchId, planFor, applyAgentUndo);
  void useSyncStore.getState().syncNow().catch(() => null);
  return { ok: true, ...result };
}
