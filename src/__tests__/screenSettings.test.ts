import { SCREEN_SETTINGS, screenSettingsEntries } from '../utils/screenSettings';
import { SETTINGS_ENTRIES, visibleSettingsEntries } from '../utils/settingsIndex';
import { NAV_MENU_ROWS } from '../utils/navHubs';

const MENU_ROUTES = NAV_MENU_ROWS.flatMap(row =>
  row.kind === 'screen' ? [row.destination.route] : row.hub.members.map(m => m.route));

describe('screen settings', () => {
  const byId = new Map(SETTINGS_ENTRIES.map(e => [e.id, e]));

  it('names only rows that exist', () => {
    const missing = Object.entries(SCREEN_SETTINGS)
      .flatMap(([route, ids]) => ids.filter(id => !byId.has(id)).map(id => `${route}: ${id}`));
    expect(missing).toEqual([]);
  });

  // A row behind a parent toggle isn't rendered while the toggle is off, so a
  // jump to it lands on nothing. Name the parent instead.
  it('names only rows that always render', () => {
    const gated = Object.entries(SCREEN_SETTINGS)
      .flatMap(([route, ids]) => ids.filter(id => byId.get(id)?.requires).map(id => `${route}: ${id}`));
    expect(gated).toEqual([]);
  });

  it('is keyed by screens the menu reaches', () => {
    const unknown = Object.keys(SCREEN_SETTINGS).filter(route => !MENU_ROUTES.includes(route));
    expect(unknown).toEqual([]);
  });

  it('lists a screen\'s rows in its own order', () => {
    const rows = screenSettingsEntries('Calendar', visibleSettingsEntries('ios'));
    expect(rows.map(e => e.id)).toEqual(['calendarRead', 'deadlineCalendar', 'completionCalendar']);
  });

  it('leaves out rows that are hidden right now', () => {
    const noKitchen = visibleSettingsEntries('ios', false);
    expect(screenSettingsEntries('Recipes', noKitchen)).toEqual([]);
    const android = visibleSettingsEntries('android');
    expect(screenSettingsEntries('Calendar', android)).toEqual([]);
  });

  it('has nothing for a screen with no entry', () => {
    expect(screenSettingsEntries('Search', visibleSettingsEntries('ios'))).toEqual([]);
  });
});
