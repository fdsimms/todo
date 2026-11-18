/**
 * Ask Claude: a chat in the app that changes the person's data through the
 * app's own MCP server (`mcp/`), so they don't have to go to the Claude app.
 *
 * The phone never runs a tool. Each message goes to the Messages API with the
 * MCP connector pointed at the server the phone already syncs with
 * (`mcpUrlFor`), and Anthropic's backend calls the tools. A write tool there
 * only previews (`mcp/src/confirmWrites.ts`), so Claude can propose a change
 * but not make one: `confirm_change` is switched off for it (`buildAskRequest`).
 * The sheet shows the preview's `willDo` lines with Confirm and Cancel, and a
 * Confirm calls `confirm_change` on the server itself (`confirmChangeRequest`),
 * which costs no model request. The result names the Activity batch it made,
 * so Undo takes back exactly that request (`revertBatch`, as Activity does).
 *
 * Pure: the request, the reading of a reply, and the reading of a confirm.
 * The calls are `src/services/askClaudeCalls.ts`; the screen is `AskClaudeSheet`.
 */

import { BUTTON_LABEL } from '../copy/shared';

/** The name the connector knows the server by, in the request and in each tool block. */
export const ASK_CLAUDE_SERVER = 'dundundun';

/** The MCP connector's beta. */
export const ASK_CLAUDE_BETA = 'mcp-client-2025-11-20';

/**
 * Loaded up front rather than through tool search: the reads nearly every
 * request starts with. Everything else (about 250 tools, most of the cost of a
 * request if all were loaded) is found by search when a request needs it.
 */
export const ASK_CLAUDE_LOADED_TOOLS = ['get_overview', 'search_tasks', 'get_task', 'list_tasks'] as const;

/**
 * The system prompt. Kept the same on every request, so it caches; anything
 * that changes (the date, the person's settings) comes from `get_overview`.
 */
export const ASK_CLAUDE_SYSTEM = [
  'You are Claude, inside the person’s dundundun app, opened from its Ask Claude sheet on their phone.',
  'You read and change their tasks, groceries, meal plan and the rest of the app through the dundundun tools.',
  'Call get_overview first in a conversation, for their time zone, their "today" and what they have switched on.',
  'Only a few tools are loaded at the start. When you need another, find it with tool_search_tool_bm25.',
  'Calling a write tool never changes anything: it returns a preview. The app shows the preview to the person with Confirm and Cancel buttons and makes the change itself when they tap Confirm. confirm_change is not available to you.',
  'So after a preview, stop: say in one short sentence what you’d change and that they can confirm it. Don’t repeat the preview’s lines, they’re already on screen.',
  'Messages that start with "(App:" come from the app, not the person. They say what the person did with a preview.',
  'This is a chat on a phone: keep replies short, plain text, no headings, tables or markdown.',
].join(' ');

/** A turn in the conversation, kept exactly as the API sent it (the API wants an assistant's blocks back unchanged). */
export interface AskTurn {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

/**
 * The server's MCP endpoint, from the sync server's address: the same server
 * serves both (`mcp/src/server.ts`), and Ask Claude can't work without that
 * sync anyway, since it is how a confirmed change reaches the phone. Null when
 * no sync server is set.
 */
export function mcpUrlFor(syncServerUrl: string | null | undefined): string | null {
  const base = (syncServerUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/i.test(base)) return null;
  return `${base}/mcp`;
}

export interface AskRequestInput {
  history: readonly AskTurn[];
  mcpUrl: string;
  writeToken: string;
}

/** The Messages API body, less `model`, which the caller adds. */
export function buildAskRequest({ history, mcpUrl, writeToken }: AskRequestInput): Record<string, unknown> {
  return {
    max_tokens: 4096,
    system: [{ type: 'text', text: ASK_CLAUDE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    mcp_servers: [{ type: 'url', url: mcpUrl, name: ASK_CLAUDE_SERVER, authorization_token: writeToken }],
    tools: [
      { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
      {
        type: 'mcp_toolset',
        mcp_server_name: ASK_CLAUDE_SERVER,
        default_config: { defer_loading: true },
        configs: {
          ...Object.fromEntries(ASK_CLAUDE_LOADED_TOOLS.map(name => [name, { defer_loading: false }])),
          // The person confirms, in the sheet, never the model.
          confirm_change: { enabled: false },
        },
      },
    ],
    messages: history,
  };
}

/**
 * The person's message as a user turn. What they did with the last reply's
 * previews goes first, as a note from the app, so Claude knows whether its
 * change was made before it answers the next thing.
 */
export function userTurn(text: string, notes: readonly string[] = []): AskTurn {
  if (notes.length === 0) return { role: 'user', content: text };
  return { role: 'user', content: [...notes.map(note => ({ type: 'text', text: note })), { type: 'text', text }] };
}

/** A preview a write tool returned, as the sheet shows it. */
export interface AskPreview {
  /** The `mcp_tool_use` block's id, which keys the card. */
  id: string;
  tool: string;
  willDo: string[];
  /** Null when the write would change nothing, which has nothing to confirm. */
  confirmToken: string | null;
}

export type AskItem = { kind: 'text'; text: string } | { kind: 'preview'; preview: AskPreview };

/** What the server's preview says when a write would change nothing (`mcp/src/server.ts`). */
const NOTHING_TO_CHANGE = 'Nothing in the app would change.';

interface Block { type?: string; text?: unknown; id?: unknown; name?: unknown; tool_use_id?: unknown; is_error?: unknown; content?: unknown }

function resultText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter((c: Block) => c?.type === 'text' && typeof c.text === 'string').map((c: Block) => c.text as string);
  return texts.length ? texts.join('') : null;
}

function readPreview(id: string, tool: string, text: string): AskPreview | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const v = value as { preview?: unknown; willDo?: unknown; confirmToken?: unknown };
  if (!v || v.preview !== true || !Array.isArray(v.willDo)) return null;
  const willDo = v.willDo.filter((l): l is string => typeof l === 'string');
  const nothing = willDo.length === 1 && willDo[0] === NOTHING_TO_CHANGE;
  return { id, tool, willDo, confirmToken: !nothing && typeof v.confirmToken === 'string' ? v.confirmToken : null };
}

/**
 * An assistant reply as the sheet shows it, in order: Claude's words, and a
 * card for each preview a write tool returned. Reads, searches, failed calls
 * and thinking show nothing of their own; Claude says what came of them.
 */
export function readAskReply(content: readonly unknown[]): AskItem[] {
  const toolNames = new Map<string, string>();
  const items: AskItem[] = [];
  for (const raw of content) {
    const block = raw as Block;
    if (block?.type === 'text' && typeof block.text === 'string') {
      const text = block.text.trim();
      if (!text) continue;
      const last = items[items.length - 1];
      if (last?.kind === 'text') last.text = `${last.text}\n\n${text}`;
      else items.push({ kind: 'text', text });
    } else if (block?.type === 'mcp_tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      toolNames.set(block.id, block.name);
    } else if (block?.type === 'mcp_tool_result' && typeof block.tool_use_id === 'string' && block.is_error !== true) {
      const text = resultText(block.content);
      const preview = text ? readPreview(block.tool_use_id, toolNames.get(block.tool_use_id) ?? '', text) : null;
      if (preview) items.push({ kind: 'preview', preview });
    }
  }
  return items;
}

/** The JSON-RPC call that makes a previewed change, sent by the phone to the server's MCP endpoint. */
export function confirmChangeRequest(preview: AskPreview): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'confirm_change', arguments: { confirmToken: preview.confirmToken, willDo: preview.willDo } },
  };
}

export type ConfirmOutcome = { ok: true; batchId: string | null } | { ok: false; reason: string };

/**
 * The server's answer to `confirmChangeRequest`. It may come back as plain
 * JSON or as one server-sent event, depending on the transport's mood, so both
 * are read. A refusal (`{ error }` in the tool's text) is the server's own
 * sentence, written for a person.
 */
export function readConfirmResponse(body: string): ConfirmOutcome {
  const dataLines = body.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim());
  const raw = dataLines.length ? dataLines.join('') : body.trim();
  let message: { result?: { content?: unknown; isError?: unknown }; error?: { message?: unknown } };
  try {
    message = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'The server sent back something that could not be read.' };
  }
  if (message.error) {
    return { ok: false, reason: typeof message.error.message === 'string' ? message.error.message : 'The server refused the change.' };
  }
  const text = resultText(message.result?.content);
  if (!text) return { ok: false, reason: 'The server sent back something that could not be read.' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return message.result?.isError === true ? { ok: false, reason: text } : { ok: true, batchId: null };
  }
  const v = value as { error?: unknown; batchId?: unknown };
  if (v && typeof v.error === 'string') return { ok: false, reason: v.error };
  return { ok: true, batchId: v && typeof v.batchId === 'string' ? v.batchId : null };
}

/** What the person did with a preview, as the app's note on their next message (`userTurn`). */
export type PreviewOutcome = 'confirmed' | 'cancelled' | 'undone' | 'failed';

export function previewNote(preview: AskPreview, outcome: PreviewOutcome): string {
  const what = preview.willDo.join('; ');
  switch (outcome) {
    case 'confirmed': return `(App: the person tapped Confirm and the change was made: ${what}.)`;
    case 'cancelled': return `(App: the person tapped Cancel, so nothing changed: ${what}.)`;
    case 'undone': return `(App: the person confirmed this change and then undid it, so it is not in effect: ${what}.)`;
    case 'failed': return `(App: the person tapped Confirm but the server refused, so nothing changed: ${what}.)`;
  }
}

/** The line a confirmed card shows: the preview's own words, so the card says what was done. */
export function doneLine(preview: AskPreview): string {
  return preview.willDo.length === 1 ? BUTTON_LABEL.done : `${BUTTON_LABEL.done}, ${preview.willDo.length} changes`;
}

/**
 * The server's refusal of a confirm, for a person. Its own sentences are
 * written for the model (they name `preview_change`), so the three a person
 * can meet are said again in the sheet's terms.
 */
export function confirmRefusalText(reason: string): string {
  if (/more than 15 minutes old/i.test(reason)) return 'This change is more than 15 minutes old, so it wasn’t made. Ask again for a fresh one.';
  if (/already used/i.test(reason)) return 'This change was already made.';
  if (/no preview has that/i.test(reason)) return 'Your server no longer has this change, so it wasn’t made. Ask again for a fresh one.';
  return `Your server didn’t make the change: ${reason}`;
}

/**
 * Whether Ask Claude can be offered at all, so an entry point is drawn only
 * when a message could go out (`routeForFeature`'s rule: no entry point for a
 * feature that would only answer with an error). The same gates the calls
 * check, in `requireFeature` and `askClaudeCalls`' connection.
 */
export function askClaudeReady(s: {
  enabled: boolean;
  hasApiKey: boolean;
  syncServerUrl: string | null | undefined;
  hasWriteToken: boolean;
  demo: boolean;
}): boolean {
  return s.enabled && s.hasApiKey && s.hasWriteToken && !s.demo && mcpUrlFor(s.syncServerUrl) !== null;
}
