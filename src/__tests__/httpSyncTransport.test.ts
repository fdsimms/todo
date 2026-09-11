import { setDemoModeActive } from '../utils/demoState';
import {
  httpSyncTransport,
  isHttpSyncConfigured,
  readPullBody,
  HTTP_SYNC_SOURCE,
} from '../utils/httpSyncTransport';

const config = { url: 'https://sync.example.com', token: 'secret' };

/** The last request fetch was handed, so a test can assert on the wire form. */
let lastRequest: { url: string; init: RequestInit } | null = null;

function mockFetch(response: Partial<Response> & { jsonBody?: unknown }) {
  lastRequest = null;
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    lastRequest = { url, init };
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.jsonBody ?? {},
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  setDemoModeActive(false);
  mockFetch({});
});

afterEach(() => {
  setDemoModeActive(false);
  jest.restoreAllMocks();
});

describe('isHttpSyncConfigured', () => {
  it('needs both halves', () => {
    // A URL with no token cannot authenticate and a token with no URL has
    // nowhere to go, so neither half alone is a state worth acting on.
    expect(isHttpSyncConfigured(config)).toBe(true);
    expect(isHttpSyncConfigured({ url: config.url })).toBe(false);
    expect(isHttpSyncConfigured({ token: config.token })).toBe(false);
    expect(isHttpSyncConfigured({ url: '  ', token: 'secret' })).toBe(false);
    expect(isHttpSyncConfigured(null)).toBe(false);
  });
});

describe('the transport', () => {
  it('names itself, so its cursors do not collide with iCloud\'s', () => {
    expect(httpSyncTransport(config).name).toBe(HTTP_SYNC_SOURCE);
    expect(HTTP_SYNC_SOURCE).not.toBe('cloudkit');
  });

  it('sends the token and the payload, and tolerates a trailing slash', async () => {
    await httpSyncTransport({ ...config, url: 'https://sync.example.com/' }).push('{"format":1}');

    expect(lastRequest!.url).toBe('https://sync.example.com/sync/push');
    expect((lastRequest!.init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    expect(JSON.parse(lastRequest!.init.body as string)).toEqual({ payload: '{"format":1}' });
  });

  it('passes the cursor through, and omits it when there is none', async () => {
    mockFetch({ jsonBody: { payloads: [], cursor: null } });
    await httpSyncTransport(config).pull(null);
    expect(lastRequest!.url).toBe('https://sync.example.com/sync/pull');

    await httpSyncTransport(config).pull('42');
    expect(lastRequest!.url).toBe('https://sync.example.com/sync/pull?since=42');
  });

  it('says a rejected token is a token, not a server', async () => {
    mockFetch({ ok: false, status: 401 });
    // The two common failures need different things from the person reading
    // the settings row, so they must not share a message.
    await expect(httpSyncTransport(config).push('x')).rejects.toThrow('rejected this token');

    mockFetch({ ok: false, status: 502 });
    await expect(httpSyncTransport(config).push('x')).rejects.toThrow('returned 502');
  });
});

describe('the demo gate', () => {
  it('sends nothing and receives nothing while demo mode is on', async () => {
    setDemoModeActive(true);
    const transport = httpSyncTransport(config);

    await transport.push('{"seeded":"fiction"}');
    expect(await transport.pull(null)).toEqual({ payloads: [], cursor: null });

    // Not one request. isSyncableDatabase already refuses a demo database
    // before a transport is reached; this is the second gate, because the cost
    // of being wrong is seeded fiction landing on somebody's real devices.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses by no-op rather than by throwing', async () => {
    setDemoModeActive(true);
    // A refusal is not an error to report: throwing would put "Sync failed" in
    // Settings for a device doing exactly the right thing.
    await expect(httpSyncTransport(config).push('x')).resolves.toBeUndefined();
  });
});

describe('readPullBody', () => {
  it('reads a well-formed page', () => {
    expect(readPullBody({ payloads: ['a', 'b'], cursor: '7' })).toEqual({
      payloads: ['a', 'b'],
      cursor: '7',
    });
  });

  it('reads anything malformed as nothing new, rather than as a cursor', () => {
    // The failure this avoids is a cursor of the wrong type being stored
    // verbatim and handed back for ever. Nothing-new retries the same window;
    // a bad cursor skips it.
    for (const body of [null, undefined, 'nope', [], { cursor: 7 }, { cursor: '' }]) {
      expect(readPullBody(body)).toEqual({ payloads: [], cursor: null });
    }
  });

  it('drops non-string payloads rather than passing them to the parser', () => {
    expect(readPullBody({ payloads: ['a', 3, null, 'b'], cursor: '2' }).payloads).toEqual(['a', 'b']);
  });
});
