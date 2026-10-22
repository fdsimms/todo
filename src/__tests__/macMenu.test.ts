import {
  buildMenuItems,
  menuCommandTarget,
  menuTitleCase,
  shortcutsWithMenuBar,
  sinkShortcuts,
  windowTitleFor,
} from '../utils/macMenu';
import { KEY_SHORTCUTS, MENU_SHORTCUTS, chordKey, describeShortcuts } from '../utils/keyShortcuts';
import { visibleMenuRows, type NavMenuOptions } from '../utils/navHubs';

const options: NavMenuOptions = {
  kitchenEnabled: true,
  simpleMode: false,
  counts: { stacks: 0, templates: 0 },
  screenTimeSupported: true,
  workoutsEnabled: false,
};

describe('menuTitleCase', () => {
  it('capitalizes each word but the small ones after the first', () => {
    expect(menuTitleCase('Groceries & meals')).toBe('Groceries & Meals');
    expect(menuTitleCase('Meal plan')).toBe('Meal Plan');
    expect(menuTitleCase('a day of the week')).toBe('A Day of the Week');
  });
});

describe('buildMenuItems', () => {
  const items = buildMenuItems(visibleMenuRows(options));

  it('gives every item its own id', () => {
    const ids = items.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never binds one chord twice', () => {
    const chords = items.filter(i => i.input !== '').map(i => chordKey(i));
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('puts only chords in a menu, never a plain key', () => {
    for (const item of items.filter(i => i.input !== '')) expect(item.modifiers.length).toBeGreaterThan(0);
  });

  it('lists the side menu in Go, with hubs as submenus', () => {
    const go = items.filter(i => i.menu === 'go');
    expect(go.find(i => i.id === 'go:Projects')).toMatchObject({ title: 'Projects', submenu: '' });
    expect(go.find(i => i.id === 'go:MealPlan')).toMatchObject({ title: 'Meal Plan', submenu: 'Groceries & Meals' });
  });

  it('leaves out what the app has switched off', () => {
    const noKitchen = buildMenuItems(visibleMenuRows({ ...options, kitchenEnabled: false }), ['viewUnscheduled']);
    expect(noKitchen.find(i => i.id === 'go:Groceries')).toBeUndefined();
    expect(noKitchen.find(i => i.title === 'Unscheduled')).toBeUndefined();
  });

  it('has a Settings item with ⌘,', () => {
    expect(items.find(i => i.menu === 'settings')).toMatchObject({ title: 'Settings…', input: ',', modifiers: ['command'] });
  });
});

describe('menuCommandTarget', () => {
  it('resolves a shortcut item and a Go item', () => {
    expect(menuCommandTarget('shortcut:menuViewLater')).toMatchObject({ kind: 'shortcut', shortcut: { action: 'viewLater' } });
    expect(menuCommandTarget('shortcut:newTaskCommand')).toMatchObject({ kind: 'shortcut', shortcut: { action: 'newTask' } });
    expect(menuCommandTarget('go:Calendar')).toEqual({ kind: 'go', route: 'Calendar' });
  });

  it('refuses an id it does not know', () => {
    expect(menuCommandTarget('shortcut:nope')).toBeNull();
    expect(menuCommandTarget('go:')).toBeNull();
    expect(menuCommandTarget('whatever')).toBeNull();
  });
});

describe('sinkShortcuts', () => {
  it('takes the menu chords off the sink and keeps every plain key', () => {
    const sink = sinkShortcuts(buildMenuItems(visibleMenuRows(options)));
    const ids = sink.map(s => s.id);
    expect(ids).not.toContain('newTaskCommand');
    expect(ids).not.toContain('searchCommand');
    expect(ids).not.toContain('showShortcuts');
    expect(ids).toEqual(expect.arrayContaining(['newTask', 'search', 'undo', 'redo', 'closeSheet', 'viewToday']));
  });

  it('keeps the whole list when there is no menu', () => {
    expect(sinkShortcuts([])).toEqual([...KEY_SHORTCUTS]);
  });
});

describe('MENU_SHORTCUTS', () => {
  it('shares no chord with the key sink', () => {
    const sink = new Set(KEY_SHORTCUTS.map(chordKey));
    for (const s of MENU_SHORTCUTS) expect(sink.has(chordKey(s))).toBe(false);
  });

  it('shows up in the shortcuts list when there is a menu bar', () => {
    const text = describeShortcuts([], shortcutsWithMenuBar());
    expect(text).toContain('1 or ⌘1: Today');
    expect(text).toContain('⌘,: Settings');
  });
});

describe('windowTitleFor', () => {
  it('names a menu screen the way the side menu does', () => {
    expect(windowTitleFor('Today')).toBe('Today');
    expect(windowTitleFor('MealPlan')).toBe('Meal plan');
    expect(windowTitleFor('Cookbooks')).toBe('Cookbooks');
    expect(windowTitleFor('SettingsGroup')).toBe('Settings');
  });

  it("falls back to the app's name for a pushed page or nothing", () => {
    expect(windowTitleFor('RecipeDetail')).toBe('dundundun');
    expect(windowTitleFor(null)).toBe('dundundun');
  });
});
