/**
 * OAuth for the MCP endpoint, so the normal Claude chat (claude.ai and the
 * phone app) can connect as a custom connector. Those only log in through
 * OAuth: there is no field for a static header, which is all auth.ts's shared
 * secret can offer.
 *
 * The SDK supplies the protocol (discovery metadata, dynamic client
 * registration, PKCE, the token endpoint) through `mcpAuthRouter`; what is
 * here is everything that is ours: where clients, codes and tokens live, the
 * approval page a person types the password into, and what a token is allowed
 * to do. server.ts maps it onto the SDK's `OAuthServerProvider`. It is kept
 * free of SDK imports for the same reason auth.ts is: so it runs under the
 * repo's own jest and tsc, which never see `mcp/node_modules`.
 *
 * Decisions worth not re-deriving:
 *
 * - **One password, set as a Fly secret, is the whole identity check.** There is
 *   one user. An account system would be a second copy of a fact Fly already
 *   holds (who can set secrets on this app), and more surface to get wrong.
 *   Below `MIN_PASSWORD_LENGTH` it refuses to start OAuth at all, since the
 *   approval page is on the open internet and only rate limiting stands between
 *   it and a guesser.
 * - **Only hashes are stored.** A code, an access token and a refresh token are
 *   random and only ever looked up, never shown again, so the table holds their
 *   SHA-256. A copy of the volume is not a copy of anyone's session.
 * - **Writing is opt-in per connection**, ticked on the approval page, and only
 *   offered when the deployment accepts writes at all (`MCP_WRITE_TOKEN` set),
 *   the same default-to-refusal rule auth.ts follows.
 * - **Refresh tokens rotate.** Each use spends the old one and issues a new
 *   pair, so a leaked refresh token stops working the next time the real client
 *   refreshes, and an idle connection lapses after `REFRESH_TTL_S`.
 * - **The approval form's hidden fields are re-checked**, not trusted: the SDK
 *   validated the client and redirect URI on the way in, but the POST that
 *   carries the password is a fresh request anyone can forge.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import BetterSqlite3 from 'better-sqlite3';

export const MIN_PASSWORD_LENGTH = 16;
export const CODE_TTL_S = 5 * 60;
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 60 * 24 * 60 * 60;

export const SCOPE_READ = 'read';
export const SCOPE_WRITE = 'write';

/** The registered-client shape, structurally the SDK's `OAuthClientInformationFull`. */
export interface OAuthClient {
  client_id: string;
  redirect_uris: string[];
  client_name?: string;
  [key: string]: unknown;
}

export interface IssuedTokens {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface VerifiedToken {
  token: string;
  clientId: string;
  scopes: string[];
  /** Seconds since the epoch, as the SDK's AuthInfo wants it. */
  expiresAt: number;
  resource?: URL;
}

/**
 * A refusal the SDK glue turns into its own error class. `code` is the OAuth
 * error code it maps to.
 */
export class OAuthRefusal extends Error {
  constructor(readonly code: 'invalid_grant' | 'invalid_token' | 'invalid_request' | 'invalid_target', message: string) {
    super(message);
  }
}

const hash = (secret: string): string => createHash('sha256').update(secret).digest('hex');
const newSecret = (): string => randomBytes(32).toString('base64url');

/** Compares by hash, so the time taken says nothing about either length. */
export function passwordMatches(supplied: string, expected: string): boolean {
  return timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(expected).digest());
}

export interface OAuthConfig {
  /** `MCP_OAUTH_PASSWORD`. */
  password: string;
  /** Whether a connection may be granted the write scope at all. */
  writesEnabled: boolean;
  /** The MCP endpoint's own URL, which a token is bound to. */
  resource: URL;
  now?: () => number;
}

/** Why OAuth can't be switched on with these settings, or null when it can. */
export function oauthConfigProblem(password: string | undefined, publicUrl: string | undefined): string | null {
  if (!password) return 'MCP_OAUTH_PASSWORD is unset: the Claude chat connector is off.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `MCP_OAUTH_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters: the Claude chat connector is off.`;
  }
  if (!publicUrl) return 'PUBLIC_URL is unset: the Claude chat connector is off.';
  try {
    if (new URL(publicUrl).protocol !== 'https:' && new URL(publicUrl).hostname !== 'localhost') {
      return 'PUBLIC_URL must be https: the Claude chat connector is off.';
    }
  } catch {
    return 'PUBLIC_URL is not a URL: the Claude chat connector is off.';
  }
  return null;
}

/** What the approval form posts back. Every field is untrusted. */
export interface ApprovalForm {
  client_id?: unknown;
  redirect_uri?: unknown;
  code_challenge?: unknown;
  state?: unknown;
  resource?: unknown;
  password?: unknown;
  allow_write?: unknown;
}

export type ApprovalResult =
  | { ok: true; redirect: string }
  | { ok: false; status: number; error: string; /** Set when the page can be shown again with the error. */ pending?: PendingAuthorization };

/** The params the authorize step hands the approval page. */
export interface PendingAuthorization {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  resource?: URL;
}

export function openOAuthStore(path: string, config: OAuthConfig) {
  const db = new BetterSqlite3(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY NOT NULL,
      info TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      hash TEXT PRIMARY KEY NOT NULL,
      client_id TEXT NOT NULL,
      challenge TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scopes TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      hash TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scopes TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );
  `);

  const nowS = (): number => Math.floor((config.now ?? Date.now)() / 1000);
  const resourceHref = config.resource.href;

  const prune = (): void => {
    const t = nowS();
    db.prepare('DELETE FROM oauth_codes WHERE expires_at <= ?').run(t);
    db.prepare('DELETE FROM oauth_tokens WHERE expires_at <= ?').run(t);
  };
  prune();

  const getClient = (clientId: string): OAuthClient | undefined => {
    const row = db.prepare('SELECT info FROM oauth_clients WHERE client_id = ?').get(clientId) as
      | { info: string }
      | undefined;
    return row ? (JSON.parse(row.info) as OAuthClient) : undefined;
  };

  /** A token's resource must be this server's, when the client named one. */
  const checkResource = (resource: URL | string | undefined | null): void => {
    if (resource == null || resource === '') return;
    if (String(resource) !== resourceHref) {
      throw new OAuthRefusal('invalid_target', 'That resource is not this server.');
    }
  };

  const issue = (clientId: string, scopes: string[], resource: string | null): IssuedTokens => {
    prune();
    const access = newSecret();
    const refresh = newSecret();
    const t = nowS();
    const insert = db.prepare(
      'INSERT INTO oauth_tokens (hash, kind, client_id, scopes, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const scopeText = scopes.join(' ');
    db.transaction(() => {
      insert.run(hash(access), 'access', clientId, scopeText, resource, t + ACCESS_TTL_S);
      insert.run(hash(refresh), 'refresh', clientId, scopeText, resource, t + REFRESH_TTL_S);
    })();
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopeText };
  };

  return {
    getClient,

    registerClient(client: Omit<OAuthClient, 'client_id'> & { client_id?: string }): OAuthClient {
      const full = { ...client, client_id: client.client_id ?? newSecret() } as OAuthClient;
      db.prepare('INSERT OR REPLACE INTO oauth_clients (client_id, info, created_at) VALUES (?, ?, ?)').run(
        full.client_id,
        JSON.stringify(full),
        nowS()
      );
      return full;
    },

    /** The approval page for one pending authorization. */
    approvalPage(pending: PendingAuthorization, error?: string): string {
      return renderApprovalPage(pending, config.writesEnabled, error);
    },

    /**
     * The approval form's POST: checks the password and, when it matches,
     * mints a one-time code and says where to send the browser.
     */
    approve(form: ApprovalForm): ApprovalResult {
      const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
      const clientId = str(form.client_id);
      const redirectUri = str(form.redirect_uri);
      const challenge = str(form.code_challenge);
      const client = clientId ? getClient(clientId) : undefined;
      if (!client || !redirectUri || !challenge || !client.redirect_uris.includes(redirectUri)) {
        return { ok: false, status: 400, error: 'This sign-in link is not valid. Start again from Claude.' };
      }
      const resource = str(form.resource);
      try {
        checkResource(resource);
      } catch {
        return { ok: false, status: 400, error: 'This sign-in link is for a different server. Start again from Claude.' };
      }
      if (typeof form.password !== 'string' || !passwordMatches(form.password, config.password)) {
        return {
          ok: false,
          status: 401,
          error: 'That password is not right.',
          pending: { client, redirectUri, codeChallenge: challenge, state: str(form.state), resource: resource ? new URL(resource) : undefined },
        };
      }

      const scopes = config.writesEnabled && form.allow_write === 'on' ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ];
      const code = newSecret();
      prune();
      db.prepare(
        'INSERT INTO oauth_codes (hash, client_id, challenge, redirect_uri, scopes, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(hash(code), client.client_id, challenge, redirectUri, scopes.join(' '), resource ?? null, nowS() + CODE_TTL_S);

      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      const state = str(form.state);
      if (state) target.searchParams.set('state', state);
      return { ok: true, redirect: target.href };
    },

    challengeForAuthorizationCode(client: OAuthClient, code: string): string {
      const row = db
        .prepare('SELECT client_id, challenge, expires_at FROM oauth_codes WHERE hash = ?')
        .get(hash(code)) as { client_id: string; challenge: string; expires_at: number } | undefined;
      if (!row || row.client_id !== client.client_id || row.expires_at <= nowS()) {
        throw new OAuthRefusal('invalid_grant', 'Unknown or expired authorization code.');
      }
      return row.challenge;
    },

    exchangeAuthorizationCode(client: OAuthClient, code: string, redirectUri?: string, resource?: URL): IssuedTokens {
      const row = db
        .prepare('SELECT client_id, redirect_uri, scopes, resource, expires_at FROM oauth_codes WHERE hash = ?')
        .get(hash(code)) as
        | { client_id: string; redirect_uri: string; scopes: string; resource: string | null; expires_at: number }
        | undefined;
      // Spent whatever happens next: a code is good for one attempt.
      db.prepare('DELETE FROM oauth_codes WHERE hash = ?').run(hash(code));
      if (!row || row.client_id !== client.client_id || row.expires_at <= nowS()) {
        throw new OAuthRefusal('invalid_grant', 'Unknown or expired authorization code.');
      }
      if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
        throw new OAuthRefusal('invalid_grant', 'redirect_uri does not match the authorization request.');
      }
      checkResource(resource);
      if (resource && row.resource && resource.href !== row.resource) {
        throw new OAuthRefusal('invalid_target', 'resource does not match the authorization request.');
      }
      return issue(client.client_id, row.scopes.split(' '), row.resource ?? resource?.href ?? null);
    },

    exchangeRefreshToken(client: OAuthClient, refreshToken: string, scopes?: string[], resource?: URL): IssuedTokens {
      const row = db
        .prepare("SELECT client_id, scopes, resource, expires_at FROM oauth_tokens WHERE hash = ? AND kind = 'refresh'")
        .get(hash(refreshToken)) as
        | { client_id: string; scopes: string; resource: string | null; expires_at: number }
        | undefined;
      if (!row || row.client_id !== client.client_id || row.expires_at <= nowS()) {
        throw new OAuthRefusal('invalid_grant', 'Unknown or expired refresh token.');
      }
      checkResource(resource);
      const granted = row.scopes.split(' ');
      // A refresh may narrow what was granted, never widen it.
      const asked = scopes && scopes.length > 0 ? scopes : granted;
      if (asked.some(s => !granted.includes(s))) {
        throw new OAuthRefusal('invalid_request', 'A refresh cannot add scopes.');
      }
      db.prepare('DELETE FROM oauth_tokens WHERE hash = ?').run(hash(refreshToken));
      return issue(client.client_id, asked, row.resource);
    },

    verifyAccessToken(token: string): VerifiedToken {
      const row = db
        .prepare("SELECT client_id, scopes, resource, expires_at FROM oauth_tokens WHERE hash = ? AND kind = 'access'")
        .get(hash(token)) as { client_id: string; scopes: string; resource: string | null; expires_at: number } | undefined;
      if (!row || row.expires_at <= nowS()) throw new OAuthRefusal('invalid_token', 'Unknown or expired access token.');
      return {
        token,
        clientId: row.client_id,
        scopes: row.scopes.split(' '),
        expiresAt: row.expires_at,
        resource: row.resource ? new URL(row.resource) : undefined,
      };
    },

    /** Revokes either kind. An unknown token is not an error (RFC 7009). */
    revokeToken(client: OAuthClient, token: string): void {
      db.prepare('DELETE FROM oauth_tokens WHERE hash = ? AND client_id = ?').run(hash(token), client.client_id);
    },

    close(): void {
      db.close();
    },
  };
}

export type OAuthStore = ReturnType<typeof openOAuthStore>;

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function renderApprovalPage(pending: PendingAuthorization, writesEnabled: boolean, error?: string): string {
  const hidden = (name: string, value: string | undefined): string =>
    value === undefined ? '' : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  const who = escapeHtml(pending.client.client_name || 'An app');
  const write = writesEnabled
    ? `<label class="check"><input type="checkbox" name="allow_write"> Also let it make changes: add and complete tasks, and edit the grocery list</label>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to your todo app</title>
<style>
:root { --bg:#f2f2f7; --card:#fff; --text:#000; --muted:#6c6c70; --accent:#007aff; --red:#ff3b30; --line:#d1d1d6; }
@media (prefers-color-scheme: dark) { :root { --bg:#000; --card:#1c1c1e; --text:#fff; --muted:#98989f; --accent:#0a84ff; --red:#ff453a; --line:#38383a; } }
body { margin:0; background:var(--bg); color:var(--text); font:17px -apple-system, system-ui, sans-serif; }
main { max-width:420px; margin:48px auto; padding:0 16px; }
.card { background:var(--card); border-radius:12px; padding:24px; }
h1 { font-size:22px; margin:0 0 8px; }
p { color:var(--muted); margin:0 0 20px; line-height:1.4; }
input[type=password] { width:100%; box-sizing:border-box; font-size:17px; padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--text); }
.check { display:flex; gap:10px; align-items:flex-start; margin:16px 0 0; color:var(--text); line-height:1.4; }
.check input { margin-top:4px; }
button { width:100%; margin-top:20px; padding:14px; font-size:17px; font-weight:600; border:0; border-radius:10px; background:var(--accent); color:#fff; }
.error { color:var(--red); margin:0 0 16px; }
</style></head>
<body><main><div class="card">
<h1>Connect to your todo app</h1>
<p>${who} wants to read your tasks, projects, groceries and logs. Enter the password you set on the server to allow it.</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/oauth/approve">
${hidden('client_id', pending.client.client_id)}
${hidden('redirect_uri', pending.redirectUri)}
${hidden('code_challenge', pending.codeChallenge)}
${hidden('state', pending.state)}
${hidden('resource', pending.resource?.href)}
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required aria-label="Password">
${write}
<button type="submit">Allow</button>
</form>
</div></main></body></html>`;
}
