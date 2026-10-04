/**
 * A jump to a bottom-tab route goes through `navigateToTab`, not a bare
 * `navigate('<tab>')`, wherever a pushed card can be on top.
 *
 * React Navigation v7 stopped offering an unhandled `navigate` to child
 * navigators. With a card (Settings, a recipe, a project, a person) focused,
 * the root stack is the navigator that receives the action, it has no route
 * named after a tab, and the action is dropped, silently in a release build.
 * Nothing about the call looks wrong and it works from every tab, so the
 * check has to be mechanical. `navigateToTab` (navigationRef.ts) explains the
 * shape that works.
 *
 * Two places are checked: the navigation ref, which deep links, widgets,
 * quick actions and notification taps all go through and which can fire with
 * anything on screen, and the card screens themselves. A hook or component a
 * card renders can't be found from here; those take the rule from the
 * helper's doc comment.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { MENU_ROUTES } from '../utils/navHubs';

const SRC = join(__dirname, '..');
const NAVIGATOR = readFileSync(join(SRC, 'navigation', 'AppNavigator.tsx'), 'utf8');
const NAV_REF = 'navigation/navigationRef.ts';

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));

// Every tab route is a key of AppNavigator's TAB_SCREENS table, which is what
// it renders its Tab.Screens from.
const TAB_SCREENS_BLOCK = NAVIGATOR.slice(NAVIGATOR.indexOf('const TAB_SCREENS'), NAVIGATOR.indexOf('};', NAVIGATOR.indexOf('const TAB_SCREENS')));
const TAB_ROUTES = [...TAB_SCREENS_BLOCK.matchAll(/^\s+(\w+): freezeWhenBlurred\(/gm)].map(m => m[1]);
const CARD_ROUTES = [...NAVIGATOR.matchAll(/<RootStack\.Screen\s+name="(\w+)"/g)]
  .map(m => m[1])
  .filter(name => name !== 'MainTabs');

/** `navigate('Weight'`, `navigate("Weight"` or `navigate({ name: 'Weight'`, for any tab route. */
const TAB_TARGET = new RegExp(
  String.raw`navigate\(\s*(?:\{\s*name:\s*)?['"](${TAB_ROUTES.join('|')})['"]`
);

describe('navigating to a tab route', () => {
  it('reads the navigator', () => {
    // Guards the parse: an empty list would make every check below vacuous.
    expect(TAB_ROUTES).toEqual(expect.arrayContaining(['Today', 'Groceries', 'Weight', 'MealPlan']));
    expect(CARD_ROUTES).toEqual(expect.arrayContaining(['Settings', 'RecipeDetail', 'ProjectDetail']));
    expect(TAB_ROUTES.length).toBeGreaterThan(20);
  });

  // A menu row with no screen behind it would open nothing, and so would a tab
  // slot set to it. TAB_SCREENS is the one table both are drawn from.
  it('has a screen for every route the menu reaches', () => {
    expect(MENU_ROUTES.filter(route => !TAB_ROUTES.includes(route))).toEqual([]);
  });

  it('still catches the bare form', () => {
    expect(TAB_TARGET.test(`navigationRef.navigate({ name: 'Weight', params: {} })`)).toBe(true);
    expect(TAB_TARGET.test(`navigation.navigate('MealPlan', { a: 1 })`)).toBe(true);
    expect(TAB_TARGET.test(`navigation.navigate('RecipeDetail', { recipeId })`)).toBe(false);
  });

  it('never goes through the navigation ref by bare name', () => {
    const ref = files.find(f => f.rel === NAV_REF);
    expect(ref).toBeDefined();
    const offenders = files
      .filter(f => /navigationRef\.navigate\(|navRef\.current\?\.navigate\(/.test(f.src))
      .flatMap(f => f.src.split('\n').filter(line => /navigationRef\.navigate\(|navRef\.current\?\.navigate\(/.test(line))
        .filter(line => TAB_TARGET.test(line))
        .map(line => `${f.rel}: ${line.trim()}`));
    // Multi-line `navigationRef.navigate({\n name: 'X'` is the shape the
    // helpers used to have, so check that too in the one file that holds them.
    const multiLine = [...ref!.src.matchAll(/navigationRef\.navigate\(\{\s*name:\s*'(\w+)'/g)]
      .map(m => m[1])
      .filter(name => TAB_ROUTES.includes(name));
    expect(offenders).toEqual([]);
    expect(multiLine).toEqual([]);
  });

  it('never reaches MainTabs by hand outside navigateToTab', () => {
    const offenders = files
      .filter(f => f.rel !== NAV_REF && /navigate\(\s*(?:\{\s*name:\s*)?['"]MainTabs['"]/.test(f.src))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('is never done by bare name from a card screen', () => {
    const cardFiles = CARD_ROUTES.map(name => `screens/${name}Screen.tsx`);
    expect(files.filter(f => cardFiles.includes(f.rel)).length).toBe(CARD_ROUTES.length);
    const offenders = files
      .filter(f => cardFiles.includes(f.rel) || f.rel.startsWith('screens/settings/'))
      .filter(f => TAB_TARGET.test(f.src))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });
});
