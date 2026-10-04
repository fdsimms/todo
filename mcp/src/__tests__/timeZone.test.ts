import { adoptTimeZone } from '../timeZone';

describe('adoptTimeZone', () => {
  it('sets TZ to a real zone that is not already in effect', () => {
    const env: Record<string, string | undefined> = {};
    expect(adoptTimeZone('America/New_York', env)).toBe(true);
    expect(env.TZ).toBe('America/New_York');
    expect(adoptTimeZone('America/New_York', env)).toBe(false);
  });

  it('wins over an operator TZ once the phone has sent one', () => {
    const env: Record<string, string | undefined> = { TZ: 'UTC' };
    expect(adoptTimeZone('Europe/Berlin', env)).toBe(true);
    expect(env.TZ).toBe('Europe/Berlin');
  });

  it('leaves the environment alone for no zone or a bad one', () => {
    const env: Record<string, string | undefined> = { TZ: 'UTC' };
    expect(adoptTimeZone(null, env)).toBe(false);
    expect(adoptTimeZone('Not/AZone', env)).toBe(false);
    expect(env.TZ).toBe('UTC');
  });
});
