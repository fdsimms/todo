import { isSyncedSettingKey } from '../db/syncTracking';
import { GENERATED_KIND_LIST } from '../utils/generatedTasks';

/**
 * Every automation's switch, and every rule list, travels between devices and
 * to the sync server. An allowlist defaults to silence, so a generator added
 * without its key here would quietly stay phone-only, and the MCP server's
 * automation tools would change a setting the phone never sees.
 */
describe('automation settings sync', () => {
  it('includes every generator\'s switch', () => {
    const missing = GENERATED_KIND_LIST.map(spec => spec.enabledKey).filter(key => !isSyncedSettingKey(key));
    expect(missing).toEqual([]);
  });

  it('includes every rule list', () => {
    for (const key of ['titleRules', 'weatherRules', 'eventRules', 'healthRules', 'screenTimeRules']) {
      expect({ key, synced: isSyncedSettingKey(key) }).toEqual({ key, synced: true });
    }
  });
});
