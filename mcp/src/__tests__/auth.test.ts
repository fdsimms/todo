import { UNCONFIGURED, authorize, bearerToken } from '../auth';

describe('bearerToken', () => {
  it('reads a bearer header in any casing, with surrounding space', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
    expect(bearerToken('  bearer   abc123  ')).toBe('abc123');
  });

  it('returns null for anything that is not one', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken('Basic abc123')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
  });
});

describe('authorize', () => {
  it('refuses everything when no token is configured', () => {
    // The default has to be refusal: a server that refuses is noticed in a
    // minute, and one that allows is noticed after it has served a task
    // history to whoever asked.
    expect(authorize('Bearer anything', undefined)).toMatchObject({ ok: false, reason: UNCONFIGURED });
    expect(authorize(undefined, '')).toMatchObject({ ok: false, reason: UNCONFIGURED });
  });

  it('accepts the configured token and refuses a wrong one', () => {
    expect(authorize('Bearer secret', 'secret').ok).toBe(true);
    expect(authorize('Bearer nope', 'secret').ok).toBe(false);
    expect(authorize('Bearer secre', 'secret').ok).toBe(false);
    expect(authorize('Bearer secrets', 'secret').ok).toBe(false);
  });

  it('never says which half a caller got wrong', () => {
    // A probe learns nothing from the difference between "no token" and "wrong
    // token" here, because there is no difference to learn.
    const missing = authorize(undefined, 'secret');
    const wrong = authorize('Bearer nope', 'secret');
    expect(missing.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    expect(wrong.reason).not.toContain('nope');
  });

  it('sends a challenge with every refusal and none with a pass', () => {
    expect(authorize(undefined, 'secret').challenge).toBe('Bearer realm="todo-mcp"');
    expect(authorize('Bearer secret', 'secret').challenge).toBeUndefined();
  });
});
