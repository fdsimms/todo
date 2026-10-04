import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import {
  ACCESS_TTL_S,
  CODE_TTL_S,
  MIN_PASSWORD_LENGTH,
  OAuthRefusal,
  REFRESH_TTL_S,
  oauthConfigProblem,
  openOAuthStore,
  passwordMatches,
  type OAuthClient,
} from '../oauth';

const PASSWORD = 'correct horse battery staple';
const RESOURCE = new URL('https://example.fly.dev/mcp');
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

function setup(opts: { writesEnabled?: boolean } = {}) {
  let t = 1_700_000_000_000;
  const store = openOAuthStore(':memory:', {
    password: PASSWORD,
    writesEnabled: opts.writesEnabled ?? true,
    resource: RESOURCE,
    now: () => t,
  });
  const client = store.registerClient({ redirect_uris: [REDIRECT], client_name: 'Claude' });
  const advance = (seconds: number) => { t += seconds * 1000; };
  const form = (extra: Record<string, unknown> = {}) => ({
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: 'challenge',
    state: 'xyz',
    resource: RESOURCE.href,
    password: PASSWORD,
    ...extra,
  });
  const codeFrom = (redirect: string) => new URL(redirect).searchParams.get('code')!;
  const signIn = (extra: Record<string, unknown> = {}) => {
    const result = store.approve(form(extra));
    if (!result.ok) throw new Error(result.error);
    return store.exchangeAuthorizationCode(client, codeFrom(result.redirect), REDIRECT, RESOURCE);
  };
  return { store, client, advance, form, codeFrom, signIn };
}

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof OAuthRefusal ? e.code : `not a refusal: ${String(e)}`;
  }
  return 'did not throw';
};

describe('oauthConfigProblem', () => {
  it('is off without a password, with a short one, or without an https URL', () => {
    expect(oauthConfigProblem(undefined, 'https://x.dev')).toMatch(/unset/);
    expect(oauthConfigProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1), 'https://x.dev')).toMatch(/shorter/);
    expect(oauthConfigProblem(PASSWORD, undefined)).toMatch(/PUBLIC_URL/);
    expect(oauthConfigProblem(PASSWORD, 'http://x.dev')).toMatch(/https/);
    expect(oauthConfigProblem(PASSWORD, 'https://x.dev')).toBeNull();
  });
});

describe('passwordMatches', () => {
  it('matches only the exact password', () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(passwordMatches(PASSWORD + ' ', PASSWORD)).toBe(false);
    expect(passwordMatches('', PASSWORD)).toBe(false);
  });
});

describe('approval', () => {
  it('redirects back with a code and the state when the password is right', () => {
    const { store, form } = setup();
    const result = store.approve(form());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = new URL(result.redirect);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('code')).toBeTruthy();
  });

  it('shows the page again with an error on a wrong password, and issues nothing', () => {
    const { store, form } = setup();
    const result = store.approve(form({ password: 'nope' }));
    expect(result).toMatchObject({ ok: false, status: 401, pending: { redirectUri: REDIRECT } });
    if (result.ok || !result.pending) return;
    expect(store.approvalPage(result.pending, result.error)).toContain('That password is not right.');
  });

  // The hidden fields come back in a POST anyone can forge.
  it('refuses a redirect the client never registered, or an unknown client', () => {
    const { store, form } = setup();
    expect(store.approve(form({ redirect_uri: 'https://evil.example/cb' }))).toMatchObject({ ok: false, status: 400 });
    expect(store.approve(form({ client_id: 'made-up' }))).toMatchObject({ ok: false, status: 400 });
    expect(store.approve(form({ code_challenge: '' }))).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses a token for some other server', () => {
    const { store, form } = setup();
    expect(store.approve(form({ resource: 'https://other.dev/mcp' }))).toMatchObject({ ok: false, status: 400 });
  });

  it('escapes what the client registered when it draws the page', () => {
    const { store } = setup();
    const evil = store.registerClient({ redirect_uris: [REDIRECT], client_name: '<script>x</script>' });
    const html = store.approvalPage({ client: evil, redirectUri: REDIRECT, codeChallenge: 'c', state: '"><b>' });
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('"><b>');
  });

  it('offers the write checkbox only when the server accepts writes', () => {
    const page = (writesEnabled: boolean) => {
      const { store, client } = setup({ writesEnabled });
      return store.approvalPage({ client, redirectUri: REDIRECT, codeChallenge: 'c' });
    };
    expect(page(true)).toContain('name="allow_write"');
    expect(page(false)).not.toContain('name="allow_write"');
  });
});

describe('scopes', () => {
  it('grants read only, unless writing was ticked', () => {
    const { signIn } = setup();
    expect(signIn().scope).toBe('read');
    expect(signIn({ allow_write: 'on' }).scope).toBe('read write');
  });

  it('never grants write when the server does not accept writes, ticked or not', () => {
    const { signIn } = setup({ writesEnabled: false });
    expect(signIn({ allow_write: 'on' }).scope).toBe('read');
  });
});

describe('codes', () => {
  it('hands back the PKCE challenge it was approved with', () => {
    const { store, client, form, codeFrom } = setup();
    const r = store.approve(form());
    if (!r.ok) throw new Error();
    expect(store.challengeForAuthorizationCode(client, codeFrom(r.redirect))).toBe('challenge');
  });

  it('is good for one exchange only', () => {
    const { store, client, form, codeFrom } = setup();
    const r = store.approve(form());
    if (!r.ok) throw new Error();
    const code = codeFrom(r.redirect);
    store.exchangeAuthorizationCode(client, code, REDIRECT);
    expect(refusal(() => store.exchangeAuthorizationCode(client, code, REDIRECT))).toBe('invalid_grant');
  });

  it('expires', () => {
    const { store, client, form, codeFrom, advance } = setup();
    const r = store.approve(form());
    if (!r.ok) throw new Error();
    advance(CODE_TTL_S);
    expect(refusal(() => store.exchangeAuthorizationCode(client, codeFrom(r.redirect), REDIRECT))).toBe('invalid_grant');
  });

  it('belongs to the client it was issued to, at the redirect it named', () => {
    const { store, client, form, codeFrom } = setup();
    const other = store.registerClient({ redirect_uris: [REDIRECT] });
    const r1 = store.approve(form());
    const r2 = store.approve(form());
    if (!r1.ok || !r2.ok) throw new Error();
    expect(refusal(() => store.exchangeAuthorizationCode(other, codeFrom(r1.redirect), REDIRECT))).toBe('invalid_grant');
    expect(refusal(() => store.exchangeAuthorizationCode(client, codeFrom(r2.redirect), 'https://claude.ai/other'))).toBe('invalid_grant');
  });
});

describe('tokens', () => {
  it('verifies an access token until it expires', () => {
    const { store, signIn, advance } = setup();
    const tokens = signIn({ allow_write: 'on' });
    expect(store.verifyAccessToken(tokens.access_token)).toMatchObject({ scopes: ['read', 'write'], resource: RESOURCE });
    advance(ACCESS_TTL_S);
    expect(refusal(() => store.verifyAccessToken(tokens.access_token))).toBe('invalid_token');
  });

  it('never accepts a refresh token as an access token', () => {
    const { store, signIn } = setup();
    expect(refusal(() => store.verifyAccessToken(signIn().refresh_token))).toBe('invalid_token');
  });

  it('rotates a refresh token: the new pair works and the old refresh token is spent', () => {
    const { store, client, signIn } = setup();
    const first = signIn();
    const second = store.exchangeRefreshToken(client, first.refresh_token);
    expect(store.verifyAccessToken(second.access_token).clientId).toBe(client.client_id);
    expect(refusal(() => store.exchangeRefreshToken(client, first.refresh_token))).toBe('invalid_grant');
  });

  it('lets a refresh narrow the scopes but never widen them', () => {
    const { store, client, signIn } = setup();
    expect(refusal(() => store.exchangeRefreshToken(client, signIn().refresh_token, ['read', 'write']))).toBe('invalid_request');
    expect(store.exchangeRefreshToken(client, signIn({ allow_write: 'on' }).refresh_token, ['read']).scope).toBe('read');
  });

  it('lapses a refresh token left unused', () => {
    const { store, client, signIn, advance } = setup();
    const tokens = signIn();
    advance(REFRESH_TTL_S);
    expect(refusal(() => store.exchangeRefreshToken(client, tokens.refresh_token))).toBe('invalid_grant');
  });

  it('revokes', () => {
    const { store, client, signIn } = setup();
    const tokens = signIn();
    store.revokeToken(client, tokens.access_token);
    expect(refusal(() => store.verifyAccessToken(tokens.access_token))).toBe('invalid_token');
  });

  it('stores only hashes, never a token itself', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'oauth-')), 'oauth.db');
    const store = openOAuthStore(file, { password: PASSWORD, writesEnabled: true, resource: RESOURCE });
    const client = store.registerClient({ redirect_uris: [REDIRECT] });
    const r = store.approve({ client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: 'c', password: PASSWORD });
    if (!r.ok) throw new Error(r.error);
    const tokens = store.exchangeAuthorizationCode(client, new URL(r.redirect).searchParams.get('code')!, REDIRECT);
    store.close();
    const raw = new BetterSqlite3(file, { readonly: true });
    const dump = JSON.stringify(raw.prepare('SELECT * FROM oauth_tokens').all());
    raw.close();
    expect(dump).not.toContain(tokens.access_token);
    expect(dump).not.toContain(tokens.refresh_token);
    expect(dump).toContain(createHash('sha256').update(tokens.access_token).digest('hex'));
  });
});
