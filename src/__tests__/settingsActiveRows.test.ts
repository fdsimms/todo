import { activeSettingsEntryIds, searchableSettingsEntries, type SettingsGateState, type SyncGateState } from '../utils/settingsActiveRows';
import { GENERATED_KIND_LIST } from '../utils/generatedTasks';

function settings(overrides: Partial<SettingsGateState> = {}): SettingsGateState {
  const generators = Object.fromEntries(GENERATED_KIND_LIST.map(spec => [spec.enabledKey, false]));
  return {
    ...generators,
    healthReadEnabled: false,
    healthWriteEnabled: false,
    calendarReadEnabled: false,
    kitchenEnabled: true,
    simpleMode: false,
    postponeCheckEnabled: false,
    focusLongRestEvery: null,
    focusShieldEnabled: false,
    penaltyShieldEnabled: false,
    gateShieldEnabled: false,
    vacationMode: false,
    dailyAgendaEnabled: false,
    quietHoursStart: null,
    appLockEnabled: false,
    productLookupEnabled: false,
    cookRecapEnabled: false,
    mealLogPrompt: false,
    onDeviceAiEnabled: false,
    remindersImportEnabled: false,
    travelEstimates: false,
    transitAlerts: false,
    ...overrides,
  } as SettingsGateState;
}

const noSync: SyncGateState = { supported: true, enabled: false, serverUrl: '', hasServerToken: false };

describe('activeSettingsEntryIds', () => {
  it('is empty with everything off', () => {
    expect([...activeSettingsEntryIds(settings(), noSync)]).toEqual([]);
  });

  it('turns quiet hours on from a start time, since that is how the toggle is derived', () => {
    expect(activeSettingsEntryIds(settings({ quietHoursStart: '22:00' }), noSync).has('quietHours')).toBe(true);
  });

  it("counts a generator as on only when the read it needs is on too", () => {
    const travelOnly = settings({ travelTasks: true } as Partial<SettingsGateState>);
    expect(activeSettingsEntryIds(travelOnly, noSync).has('gen:travel')).toBe(false);
    const withCalendar = settings({ travelTasks: true, calendarReadEnabled: true } as Partial<SettingsGateState>);
    expect(activeSettingsEntryIds(withCalendar, noSync).has('gen:travel')).toBe(true);
  });

  it('needs the leave-by generator on before its nested switches count', () => {
    const nestedOnly = settings({ travelEstimates: true, transitAlerts: true });
    expect(activeSettingsEntryIds(nestedOnly, noSync).has('travelEstimates')).toBe(false);
    const all = settings({
      travelTasks: true, calendarReadEnabled: true, travelEstimates: true, transitAlerts: true,
    } as Partial<SettingsGateState>);
    const on = activeSettingsEntryIds(all, noSync);
    expect(on.has('travelEstimates')).toBe(true);
    expect(on.has('transitAlerts')).toBe(true);
  });

  it('counts either sync destination', () => {
    expect(activeSettingsEntryIds(settings(), { ...noSync, enabled: true }).has('syncEnabled')).toBe(true);
    expect(activeSettingsEntryIds(settings(), { ...noSync, enabled: true, supported: false }).has('syncEnabled')).toBe(false);
    const server = { ...noSync, serverUrl: 'https://example.com', hasServerToken: true };
    expect(activeSettingsEntryIds(settings(), server).has('syncServerToken')).toBe(true);
    expect(activeSettingsEntryIds(settings(), { ...server, hasServerToken: false }).has('syncServerToken')).toBe(false);
  });
});

describe('searchableSettingsEntries', () => {
  it('leaves out a row whose parent is off and keeps it once the parent is on', () => {
    const off = searchableSettingsEntries('ios', settings(), noSync).map(e => e.id);
    expect(off).not.toContain('quietHoursStart');
    const on = searchableSettingsEntries('ios', settings({ quietHoursStart: '22:00' }), noSync).map(e => e.id);
    expect(on).toContain('quietHoursStart');
  });

  it('takes the kitchen rows away with the kitchen', () => {
    const withKitchen = searchableSettingsEntries('ios', settings(), noSync).length;
    const without = searchableSettingsEntries('ios', settings({ kitchenEnabled: false }), noSync).length;
    expect(without).toBeLessThan(withKitchen);
  });
});
