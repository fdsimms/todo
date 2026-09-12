/**
 * The HTTP SyncTransport: a payload store the user runs themselves (#2367).
 *
 * The second transport, and the reason there is a plural at all. CloudKit
 * carries phone to phone and cannot carry phone to anywhere else: its private
 * database is reachable outside an Apple platform only through a browser
 * sign-in whose token expires, which is no use to a server nobody is sitting
 * at. This one exists so a replica can be a peer. See docs/arch/mcp-server.md.
 *
 * It does not replace CloudKit and must not. `syncEngine` keys its cursors by
 * transport name, so the two run side by side with independent positions, and a
 * user with no server keeps exactly the sync they had.
 *
 * **The store is deliberately dumb.** Append an opaque string, read back the
 * ones after a cursor. It never parses a payload, which is what keeps the merge
 * rules on the devices where they are tested, and means the box holding the
 * data needs no idea what a task is.
 */
import { isDemoModeActive } from './demoState';
import type { PullResult, SyncTransport } from './syncEngine';

export const HTTP_SYNC_SOURCE = 'server';

/** How long a request may take before it counts as a failure. */
export const SYNC_REQUEST_TIMEOUT_MS = 20_000;

export interface HttpSyncConfig {
  /** Origin of the payload store, e.g. `https://sync.example.com`. */
  url: string;
  /** The bearer token the store was configured with. */
  token: string;
}

/**
 * Whether the user has configured this at all.
 *
 * Both halves or neither: a URL with no token cannot authenticate and a token
 * with no URL has nowhere to go, so "configured" is the one state worth having.
 * This is also the feature's opt-in, the same way a pasted API key is the
 * opt-in for the AI features rather than a switch beside them. A separate
 * toggle that also had to be on would be one more way for it to look broken.
 */
export function isHttpSyncConfigured(config: Partial<HttpSyncConfig> | null): config is HttpSyncConfig {
  return !!config?.url?.trim() && !!config?.token?.trim();
}

/** Trailing slashes are the ordinary paste error, and they double up in the path. */
function origin(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function request(config: HttpSyncConfig, path: string, init: RequestInit): Promise<Response> {
  // AbortSignal.timeout would be tidier and is not in every RN runtime this
  // ships to, so the controller is spelled out.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${origin(config.url)}${path}`, {
      ...init,
      // Cast because this file is typechecked by two programs with different
      // libs: the app's (React Native's `AbortSignal`) and `mcp/`'s (Node's
      // global one), which disagree on `onabort`'s nullability. The value is
      // the runtime's own controller either way, so the cast is to whichever
      // type the program compiling it already believes in.
      signal: controller.signal as unknown as RequestInit['signal'],
      headers: {
        ...init.headers,
        'content-type': 'application/json',
        authorization: `Bearer ${config.token}`,
      },
    });

    if (!response.ok) {
      // The status is worth surfacing because the two common ones mean
      // different things to the person reading the settings row: 401 is a token
      // to fix, anything 5xx is a server to restart.
      throw new Error(
        response.status === 401
          ? 'The sync server rejected this token.'
          : `The sync server returned ${response.status}.`
      );
    }
    return response;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('The sync server did not respond.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Demo mode is checked here as well as in `runSync`.
 *
 * `isSyncableDatabase` already refuses a demo database before a transport is
 * reached, so this is defence in depth rather than the only guard — which is
 * the rule for anything in this app that reaches past SQLite, because the cost
 * of being wrong is somebody's invented seed data landing on their real
 * devices. It no-ops rather than throwing: a refusal is not an error to report.
 */
export function httpSyncTransport(config: HttpSyncConfig): SyncTransport {
  return {
    name: HTTP_SYNC_SOURCE,

    async push(payload: string): Promise<void> {
      if (isDemoModeActive()) return;
      await request(config, '/sync/push', { method: 'POST', body: JSON.stringify({ payload }) });
    },

    async pull(since: string | null): Promise<PullResult> {
      if (isDemoModeActive()) return { payloads: [], cursor: null };

      const query = since === null ? '' : `?since=${encodeURIComponent(since)}`;
      const response = await request(config, `/sync/pull${query}`, { method: 'GET' });
      const body = (await response.json()) as unknown;

      return readPullBody(body);
    },
  };
}

/**
 * Parse a pull response defensively.
 *
 * Exported for its test rather than for a second caller: a store the user runs
 * is a store that can be half-upgraded or behind a proxy that rewrites bodies,
 * and the failure this avoids is a `cursor` of the wrong type being stored
 * verbatim and then handed back for ever. A malformed body reads as "nothing
 * new", which retries the same window rather than skipping it.
 */
export function readPullBody(body: unknown): PullResult {
  if (!body || typeof body !== 'object') return { payloads: [], cursor: null };
  const raw = body as { payloads?: unknown; cursor?: unknown };

  const payloads = Array.isArray(raw.payloads)
    ? raw.payloads.filter((p): p is string => typeof p === 'string')
    : [];
  const cursor = typeof raw.cursor === 'string' && raw.cursor !== '' ? raw.cursor : null;

  return { payloads, cursor };
}
