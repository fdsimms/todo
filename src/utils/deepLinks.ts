import { useEffect } from 'react';
import { Linking } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { haptics } from './haptics';
import {
  resetToToday,
  resetToGroceries,
  resetToRecipes,
  resetToMealPlan,
  openQuickAddFromShortcut,
} from '../navigation/navigationRef';

export interface AddTaskLink {
  title: string;
  notes?: string;
}

// Must match app.json's `expo.scheme`. Update here if the app is ever renamed again.
const SCHEME = 'dundundun';

// Decodes a query string into a plain map. Shared by every link in this file
// that takes parameters rather than written out per link — the escaping rules
// below are the fiddly half, and a second copy is how one of them would come to
// handle `+` and the other not.
function parseQuery(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1);
    // `+` is a legal encoding for a space in query strings; decodeURIComponent
    // doesn't handle it, so normalise first. Swallow malformed escapes rather
    // than throwing on a stray `%`.
    const decode = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
      } catch {
        return s.replace(/\+/g, ' ');
      }
    };
    params[decode(rawKey)] = decode(rawVal);
  }
  return params;
}

// Parses an "add task" deep link of the form `dundundun://add?title=…[&notes=…]`.
// Kept pure and dependency-free (no expo-linking) so it stays unit-testable
// under the node jest env and correctly decodes dictated text — which arrives
// full of spaces, apostrophes and the occasional ampersand. Returns null for
// anything that isn't a well-formed add link with a non-empty title.
export function parseAddTaskUrl(url: string): AddTaskLink | null {
  if (typeof url !== 'string') return null;

  // Match the scheme + `add` action, tolerating `dundundun://add`, `dundundun:///add`
  // and a trailing slash before the query string.
  const match = new RegExp(`^${SCHEME}:\\/\\/\\/?add\\/?(?:\\?(.*))?$`, 'i').exec(url.trim());
  if (!match) return null;

  const params = parseQuery(match[1] ?? '');

  const title = (params.title ?? '').trim();
  if (!title) return null;

  const notes = (params.notes ?? '').trim();
  return notes ? { title, notes } : { title };
}

// Turns an incoming URL into a task. Safe to call for any URL — non-add links
// are ignored. Returns true when a task was created.
export function handleIncomingUrl(url: string | null): boolean {
  if (!url) return false;
  const parsed = parseAddTaskUrl(url);
  if (!parsed) return false;
  useTaskStore.getState().addTask({ title: parsed.title, notes: parsed.notes });
  haptics.success();
  return true;
}

// `dundundun://add` carrying no usable title — what the Today widget's "+"
// button opens. An add link *with* a title is a silent capture (a Shortcut
// dictated it, nobody is looking at the screen); with nothing to capture, the
// only sensible reading is "I want to type one", so it pops quick add instead
// of being dropped on the floor, which is what a title-less add link used to
// do. Defined in terms of parseAddTaskUrl rather than a second title check, so
// the two can't disagree about what counts as a title.
const ADD_PATH_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?add\\/?(?:\\?(.*))?$`, 'i');

export function isQuickAddUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  return ADD_PATH_RE.test(url.trim()) && parseAddTaskUrl(url) === null;
}

// Matches the bare scheme with no path — what the Today widget's
// `.widgetURL` opens (see targets/todo-widget/TodoTodayWidget.swift). Tapping
// the widget should always surface the Today tab's Today sub-view, even if
// the app was left on a different tab/view when backgrounded.
const OPEN_APP_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?$`, 'i');

export function isOpenAppUrl(url: string): boolean {
  return typeof url === 'string' && OPEN_APP_RE.test(url.trim());
}

// `dundundun://groceries` — what a recurring "Grocery run" task carries in its
// linkUrl, so the reminder to go opens the list to shop from.
const GROCERIES_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?groceries\\/?$`, 'i');

export function isGroceriesUrl(url: string): boolean {
  return typeof url === 'string' && GROCERIES_RE.test(url.trim());
}

// `dundundun://recipes` — the peer of the groceries link, so a "plan meals"
// task can open the recipe box directly.
const RECIPES_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?recipes\\/?$`, 'i');

export function isRecipesUrl(url: string): boolean {
  return typeof url === 'string' && RECIPES_RE.test(url.trim());
}

// `dundundun://mealplan[?date=YYYY-MM-DD]` — the third kitchen link, so a
// recurring "Plan the week" task opens the week it's asking about, and one of
// the weekly nudge's seven day tasks opens on its own day.
const MEAL_PLAN_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?mealplan\\/?(?:\\?(.*))?$`, 'i');

// A day key and nothing else. The screen looks this up as a date, so anything
// that isn't one is dropped back to "open the meal plan" rather than carried
// through to be parsed into an Invalid Date halfway down the render.
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isMealPlanUrl(url: string): boolean {
  return typeof url === 'string' && MEAL_PLAN_RE.test(url.trim());
}

/**
 * The day a meal-plan link asks to be opened on, or null for the bare link.
 *
 * Returns null both for "no date given" and "the date given is nonsense", which
 * are the same instruction as far as the screen is concerned: show the week
 * you'd have shown anyway. Non-meal-plan URLs return null too, so callers gate
 * on `isMealPlanUrl` first — the same shape `parseAddTaskUrl` has.
 */
export function mealPlanUrlDayKey(url: string): string | null {
  if (typeof url !== 'string') return null;
  const match = MEAL_PLAN_RE.exec(url.trim());
  if (!match) return null;
  const dayKey = (parseQuery(match[1] ?? '').date ?? '').trim();
  return DAY_KEY_RE.test(dayKey) ? dayKey : null;
}

/**
 * Handles a URL this app owns itself, returning true when it did.
 *
 * Lets a row route to an in-app destination without going through
 * Linking.openURL. That *would* work — iOS hands your own scheme back to you
 * and the 'url' listener below fires — but it's an app-switch round trip that
 * flashes, for a navigation that never left the app.
 */
export function openInAppUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isQuickAddUrl(url)) {
    openQuickAddFromShortcut();
    return true;
  }
  if (isGroceriesUrl(url)) {
    resetToGroceries();
    return true;
  }
  if (isRecipesUrl(url)) {
    resetToRecipes();
    return true;
  }
  if (isMealPlanUrl(url)) {
    resetToMealPlan(mealPlanUrlDayKey(url));
    return true;
  }
  if (isOpenAppUrl(url)) {
    resetToToday();
    return true;
  }
  return false;
}

// Wires up deep-link handling for the app: the cold-start URL (the Shortcut
// launching the app) via getInitialURL, and warm links (app already running)
// via the 'url' event. Call once from the root component, after the store's
// initialize() has run so the SQLite DB exists.
export function useTaskDeepLinks(): void {
  useEffect(() => {
    const handle = (url: string | null) => {
      handleIncomingUrl(url);
      if (url) openInAppUrl(url);
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);
}
