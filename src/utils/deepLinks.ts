import { useEffect } from 'react';
import { Linking } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useFocusStore } from '../store/useFocusStore';
import { useWidgetCompletionStore } from '../store/useWidgetCompletionStore';
import { haptics } from './haptics';
import {
  resetToToday,
  resetToGroceries,
  resetToRecipes,
  resetToMealPlan,
  resetToKitchen,
  resetToPeople,
  resetToProjectPull,
  resetToFocusSession,
  openQuickAddFromShortcut,
} from '../navigation/navigationRef';
import { MEAL_SLOTS, type MealSlot } from '../types';

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

// `dundundun://groceries[?finish=1]` — what a recurring "Grocery run" task
// carries in its linkUrl, so the reminder to go opens the list to shop from.
const GROCERIES_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?groceries\\/?(?:\\?(.*))?$`, 'i');

export function isGroceriesUrl(url: string): boolean {
  return typeof url === 'string' && GROCERIES_RE.test(url.trim());
}

/**
 * Does a groceries link ask for the finish sheet on arrival?
 *
 * `dundundun://groceries?finish=1` — the Finish button on the shopping trip's
 * Live Activity (targets/todo-widget/TripLiveActivity.swift). A Live Activity
 * button's intent can only run in the background, so ending a trip from the
 * Lock Screen has to be a plain deep link that opens the app, the same
 * mechanism the timer activity's Done button uses; unlike that one this
 * doesn't *do* anything on arrival, it opens the sheet that asks what the
 * store had. Which is the whole reason the trip activity had no button until
 * now: finishing is a question, not a verb, so it only makes sense inside the
 * app.
 *
 * Any other value — `finish=0`, a bare `?finish`, a different param — is a no,
 * because the only thing that ever writes this link writes `1`. The bare
 * `dundundun://groceries` a "Grocery run" task carries lands on the list
 * exactly as it always has.
 */
export function groceriesUrlFinish(url: string): boolean {
  if (typeof url !== 'string') return false;
  const match = GROCERIES_RE.exec(url.trim());
  if (!match) return false;
  return (parseQuery(match[1] ?? '').finish ?? '').trim() === '1';
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
 * The slot a meal-plan link asks to open the picker on, or null when it doesn't
 * ask for one.
 *
 * `dundundun://mealplan?date=2026-08-22&pick=lunch` — the link an unanswered
 * meal task carries (see `mealSlotLinkUrl`), so its first step is one tap from
 * the sheet that answers it rather than a trip through the week to find the
 * right row. Answered slots carry the bare dated link and return null here,
 * which is how the same row stops offering to re-decide once it's been decided.
 *
 * Validated against MEAL_SLOTS rather than passed through: this ends up as a
 * navigation param the Meal Plan screen hands straight to the picker's
 * `defaultSlot`, and an unknown string there would select no chip at all.
 */
export function mealPlanUrlPickSlot(url: string): MealSlot | null {
  if (typeof url !== 'string') return null;
  const match = MEAL_PLAN_RE.exec(url.trim());
  if (!match) return null;
  const slot = (parseQuery(match[1] ?? '').pick ?? '').trim();
  return (MEAL_SLOTS as readonly string[]).includes(slot) ? (slot as MealSlot) : null;
}

// `dundundun://kitchen[?item=…]` — what the grocery and leftover "Use up X"
// tasks carry (see kitchenInventory.kitchenLinkUrl), so tapping one opens the
// pantry/fridge view rather than the bare grocery list the groceries link
// opens, and opens straight to the one row named by `item` when there is one.
const KITCHEN_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?kitchen\\/?(?:\\?(.*))?$`, 'i');

// `dundundun://projects[?pull=…]` — a quiet project's review task (see
// utils/projectReviewTasks.projectReviewLinkUrl). The bare form opens the pull
// sheet over the whole board, the same thing the Today options row does; with
// a project id it opens scoped to that one.
const PROJECTS_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?projects\\/?(?:\\?(.*))?$`, 'i');

export function isProjectsUrl(url: string): boolean {
  return typeof url === 'string' && PROJECTS_RE.test(url.trim());
}

/**
 * The project a projects link asks the pull sheet to scope to, or null for the
 * bare link.
 *
 * Opaque like `kitchenUrlItemId`: it's whatever id the task was generated
 * from, matched straight against the live project list, and it may well no
 * longer resolve — the project can be deleted or archived between the task
 * being written and the row being tapped. That scopes the plan to nothing and
 * shows the sheet's own empty state, which is what it's for.
 */
export function projectsUrlPullId(url: string): string | null {
  if (typeof url !== 'string') return null;
  const match = PROJECTS_RE.exec(url.trim());
  if (!match) return null;
  const id = (parseQuery(match[1] ?? '').pull ?? '').trim();
  return id || null;
}

export function isKitchenUrl(url: string): boolean {
  return typeof url === 'string' && KITCHEN_RE.test(url.trim());
}

// `dundundun://completeTask?id=…` — the Done button on a task's timer Live
// Activity (see the Lock Screen/Dynamic Island button in
// targets/todo-widget/TimerLiveActivity.swift). A Live Activity button's
// intent can only run in the background — there's no AppIntent mechanism
// that opens the containing app from one — so this reuses the same deep-link
// scheme every other Live Activity/widget tap already opens the app with,
// carrying the task id as a query param instead of an App Group queue file.
const COMPLETE_TASK_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?completeTask\\/?(?:\\?(.*))?$`, 'i');

export function isCompleteTaskUrl(url: string): boolean {
  return typeof url === 'string' && COMPLETE_TASK_RE.test(url.trim());
}

export function completeTaskUrlId(url: string): string | null {
  if (typeof url !== 'string') return null;
  const match = COMPLETE_TASK_RE.exec(url.trim());
  if (!match) return null;
  const id = (parseQuery(match[1] ?? '').id ?? '').trim();
  return id || null;
}

// `dundundun://stopTimer?key=cook:<id>|prep:<id>` — the peer of completeTask
// above for a recipe's cook/prep Live Activity Done button. "Stop" here
// means the same thing tapping Stop in the app does: log the elapsed time
// (see stopCookTimer/stopPrepTimer in useRecipeStore.ts).
const STOP_TIMER_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?stopTimer\\/?(?:\\?(.*))?$`, 'i');

export function isStopTimerUrl(url: string): boolean {
  return typeof url === 'string' && STOP_TIMER_RE.test(url.trim());
}

export function stopTimerUrlKey(url: string): string | null {
  if (typeof url !== 'string') return null;
  const match = STOP_TIMER_RE.exec(url.trim());
  if (!match) return null;
  const key = (parseQuery(match[1] ?? '').key ?? '').trim();
  return key || null;
}

// `dundundun://focus[?do=next|pause|resume]` — the focus session's Live
// Activity (targets/todo-widget/FocusLiveActivity.swift). One host with an
// action param rather than four hosts, the same shape `groceries?finish=1`
// uses: they all land in the same place, and the bare link is the plain "open
// the session" a tap anywhere non-interactive on the activity gives.
//
// The action is applied *and* the session opens, unlike the trip activity's
// Finish link, which only opens a sheet: pausing or moving to the next step is
// a verb the store can answer on its own, and the session sheet arriving on
// top is how you see that it did. Every one of these opens the app either way
// — a Live Activity button's intent can only run in the background, which is
// the constraint TimerLiveActivity.swift's header spells out.
const FOCUS_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?focus\\/?(?:\\?(.*))?$`, 'i');

export type FocusLinkAction = 'next' | 'pause' | 'resume';

const FOCUS_ACTIONS: readonly FocusLinkAction[] = ['next', 'pause', 'resume'];

export function isFocusUrl(url: string): boolean {
  return typeof url === 'string' && FOCUS_RE.test(url.trim());
}

/**
 * What a focus link asks the session to do before it opens, or null when it
 * only asks to be opened.
 *
 * Validated against the three actions rather than passed through, same rule
 * `mealPlanUrlPickSlot` follows: an unknown verb is answered as "just open the
 * session", which is what the bare link does and the only safe reading — a
 * focus link is the one deep link in here that *changes* the thing it opens.
 */
export function focusUrlAction(url: string): FocusLinkAction | null {
  if (typeof url !== 'string') return null;
  const match = FOCUS_RE.exec(url.trim());
  if (!match) return null;
  const action = (parseQuery(match[1] ?? '').do ?? '').trim();
  return (FOCUS_ACTIONS as readonly string[]).includes(action) ? (action as FocusLinkAction) : null;
}

/**
 * The specific pantry item or fridge container a kitchen link asks to open,
 * or null for the bare link.
 *
 * Opaque on purpose: it's whatever kitchenEntryId built, and KitchenScreen
 * matches it straight against a live KitchenEntry.id, so nothing here needs
 * to know its shape — or that it might no longer resolve to anything (the
 * item was used up and its row is gone by the time the link is tapped).
 */
export function kitchenUrlItemId(url: string): string | null {
  if (typeof url !== 'string') return null;
  const match = KITCHEN_RE.exec(url.trim());
  if (!match) return null;
  const id = (parseQuery(match[1] ?? '').item ?? '').trim();
  return id || null;
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
    resetToGroceries(groceriesUrlFinish(url));
    return true;
  }
  if (isRecipesUrl(url)) {
    resetToRecipes();
    return true;
  }
  if (isMealPlanUrl(url)) {
    resetToMealPlan(mealPlanUrlDayKey(url), mealPlanUrlPickSlot(url));
    return true;
  }
  if (isKitchenUrl(url)) {
    resetToKitchen(kitchenUrlItemId(url));
    return true;
  }
  if (isProjectsUrl(url)) {
    resetToProjectPull(projectsUrlPullId(url));
    return true;
  }
  if (isCompleteTaskUrl(url)) {
    const id = completeTaskUrlId(url);
    // Same hand-off the Today widget's checkbox uses (see
    // processPendingWidgetCompletions in widgetSync.ts) — enqueueing rather
    // than calling completeTask() directly lets TodayScreen play the same
    // tap-to-complete animation before the task actually disappears.
    if (id) {
      useWidgetCompletionStore.getState().enqueue([id]);
      resetToToday();
    }
    return true;
  }
  if (isFocusUrl(url)) {
    const action = focusUrlAction(url);
    const focus = useFocusStore.getState();
    if (action === 'next') focus.advance();
    else if (action === 'pause') focus.pause();
    else if (action === 'resume') focus.resume();
    // Opened whatever the action was, including when there's no session left
    // to act on — every one of these arrives from a tap on the session's own
    // Live Activity, so landing anywhere else would be a tap that appeared to
    // do nothing.
    resetToFocusSession();
    return true;
  }
  if (isStopTimerUrl(url)) {
    const key = stopTimerUrlKey(url);
    if (key?.startsWith('cook:')) useRecipeStore.getState().stopCookTimer(key.slice('cook:'.length));
    else if (key?.startsWith('prep:')) useRecipeStore.getState().stopPrepTimer(key.slice('prep:'.length));
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
