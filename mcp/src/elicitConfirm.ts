/**
 * Asks the person through the client's own prompt (MCP elicitation) instead of
 * the token round trip, when the client supports it. The prompt carries the
 * server's `willDo` lines, so the description is the server's, as with the
 * token flow. Accept writes now; decline or cancel leaves the preview unspent.
 * Anything else (no elicitation capability, a transport that cannot ask, an
 * error) returns the preview untouched, so the confirmToken flow still works.
 *
 * Its own file, with no SDK import, so a test can load it: the root typecheck
 * runs before the MCP package's dependencies are installed, and a test that
 * imports server.ts fails it.
 */
import type { ConfirmTokens } from './confirmWrites';

type ToolResult = { content: { type: 'text'; text: string }[] };

/** The part of the SDK's `Server` this needs, shaped so the real one satisfies it. */
export interface Elicitor {
  getClientCapabilities(): { elicitation?: unknown } | undefined;
  elicitInput(params: {
    message: string;
    requestedSchema: { type: 'object'; properties: { confirm: { type: 'boolean'; title: string; default: boolean } } };
  }): Promise<{ action: string; content?: Record<string, unknown> }>;
}

const reply = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

export async function confirmByElicitation(
  low: Elicitor,
  tokens: ConfirmTokens,
  previewed: ToolResult,
  write: () => Promise<ToolResult>,
): Promise<ToolResult> {
  let details: { preview?: boolean; willDo?: string[]; confirmToken?: string } | undefined;
  try {
    details = JSON.parse(previewed.content[0]?.text ?? '');
  } catch {
    return previewed;
  }
  if (!details?.preview || !Array.isArray(details.willDo) || typeof details.confirmToken !== 'string') return previewed;
  if (!low.getClientCapabilities()?.elicitation) return previewed;
  let answer: Awaited<ReturnType<Elicitor['elicitInput']>>;
  try {
    answer = await low.elicitInput({
      message: details.willDo.join('\n'),
      requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean', title: 'Make this change', default: true } } },
    });
  } catch {
    return previewed;
  }
  if (answer.action !== 'accept' || answer.content?.confirm === false) {
    return reply({ declined: true, next: 'The person said no. Nothing was changed. Do not retry this change; ask what they would like instead.' });
  }
  const taken = tokens.take(details.confirmToken, details.willDo);
  if (!taken.ok) return reply({ error: taken.reason });
  return write();
}
