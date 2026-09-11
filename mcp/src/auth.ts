/**
 * The auth seam.
 *
 * A remote MCP server is an OAuth 2.1 resource server: it advertises
 * `/.well-known/oauth-protected-resource`, every request arrives with a bearer
 * token, and it validates that token against an authorization server before it
 * answers anything. **None of that exists yet** (see docs/arch/mcp-server.md,
 * "the part that is blocked on infrastructure"). What is here is a shared
 * secret, which is enough to develop against on a laptop and is not enough to
 * put on the internet.
 *
 * It is written as one function returning one verdict so that the real
 * implementation replaces exactly this, and so the thing it has to replace is
 * small enough to read. When that happens, `AuthResult` grows the token's
 * subject and scopes and the callers keep working.
 *
 * The default is refusal. An unset `MCP_AUTH_TOKEN` denies every request rather
 * than allowing every request, because the failure modes are not comparable: a
 * server that refuses everything is noticed in one minute, and a server that
 * allows everything is noticed after it has served somebody's entire task
 * history to whoever asked.
 */

export interface AuthResult {
  ok: boolean;
  /** Sent as the failure body. Deliberately vague, see below. */
  reason?: string;
  /** The `WWW-Authenticate` challenge to send with a 401. */
  challenge?: string;
}

export const UNCONFIGURED =
  'This server has no MCP_AUTH_TOKEN set, so it refuses every request. See mcp/README.md.';

/**
 * Constant-time-ish comparison. Not the real defence — the real defence is that
 * this whole function is temporary — but a length-independent compare costs two
 * lines and removes the most obvious way to learn a shared secret from a server
 * that answers thousands of requests.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Pulls the token out of an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * `expected` is the configured secret; undefined or empty means unconfigured,
 * which refuses.
 *
 * The refusal reason never distinguishes "no token" from "wrong token" to a
 * caller that supplied one. There is nothing to gain by telling somebody
 * probing the server which half they got right.
 */
export function authorize(authorization: string | undefined, expected: string | undefined): AuthResult {
  const challenge = 'Bearer realm="todo-mcp"';

  if (!expected) return { ok: false, reason: UNCONFIGURED, challenge };

  const supplied = bearerToken(authorization);
  if (!supplied) return { ok: false, reason: 'Missing bearer token.', challenge };

  if (!tokensMatch(supplied, expected)) {
    return { ok: false, reason: 'Not authorized.', challenge };
  }

  return { ok: true };
}
