import { useEffect } from 'react';
import { Linking } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { haptics } from './haptics';
import { resetToToday } from '../navigation/navigationRef';

export interface AddTaskLink {
  title: string;
  notes?: string;
}

// Must match app.json's `expo.scheme`. Update here if the app is ever renamed again.
const SCHEME = 'dundundun';

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

  const query = match[1] ?? '';
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

// Matches the bare scheme with no path — what the Today widget's
// `.widgetURL` opens (see targets/todo-widget/TodoTodayWidget.swift). Tapping
// the widget should always surface the Today tab's Today sub-view, even if
// the app was left on a different tab/view when backgrounded.
const OPEN_APP_RE = new RegExp(`^${SCHEME}:\\/\\/\\/?$`, 'i');

export function isOpenAppUrl(url: string): boolean {
  return typeof url === 'string' && OPEN_APP_RE.test(url.trim());
}

// Wires up deep-link handling for the app: the cold-start URL (the Shortcut
// launching the app) via getInitialURL, and warm links (app already running)
// via the 'url' event. Call once from the root component, after the store's
// initialize() has run so the SQLite DB exists.
export function useTaskDeepLinks(): void {
  useEffect(() => {
    const handle = (url: string | null) => {
      handleIncomingUrl(url);
      if (url && isOpenAppUrl(url)) resetToToday();
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);
}
