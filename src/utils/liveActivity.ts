import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { Task } from '../types';
import { KNOWN_LINK_APPS } from '../constants/linkApps';
import { useSettingsStore } from '../store/useSettingsStore';

// The Lock Screen and the Dynamic Island's expanded center both give this
// roughly two lines; past this the tail is dropped anyway, so trim before
// crossing the bridge rather than letting SwiftUI truncate arbitrarily.
const TITLE_MAX = 60;

// Not an end condition — the activity only ever ends when the app becomes
// active again (see useLiveActivitySync below). This just controls how long
// before the Live Activity starts describing itself as stale ("Still open?")
// instead of looking like current work.
export const STALE_AFTER_SECONDS = 2 * 60 * 60;

export interface LinkDescription {
  label: string; // "" when there's nothing useful to say
  sfSymbol: string;
}

// KNOWN_LINK_APPS carries Ionicons names for the editor's chips; SwiftUI needs
// SF Symbols, so that mapping lives on LinkApp.sfSymbol alongside it. Falls
// back to the URL's host for an arbitrary https link, and to a bare "link"
// glyph for anything else (a custom scheme with no known host, or garbage).
export function describeLink(linkUrl: string): LinkDescription {
  const known = KNOWN_LINK_APPS.find(app => linkUrl.startsWith(app.scheme));
  if (known) return { label: known.name, sfSymbol: known.sfSymbol };

  // Only trust the parsed "host" for actual web URLs. WHATWG's URL parser
  // treats anything after `//` as an authority regardless of scheme, so an
  // unrecognized custom scheme like "slack://open?team=1" would otherwise
  // read "open" as a hostname — a path segment, not a real host.
  if (linkUrl.startsWith('http://') || linkUrl.startsWith('https://')) {
    try {
      const host = new URL(linkUrl).hostname.replace(/^www\./, '');
      if (host) return { label: host, sfSymbol: 'safari' };
    } catch {
      // Malformed http(s) URL — fall through to the generic case below.
    }
  }

  return { label: '', sfSymbol: 'link' };
}

function truncate(title: string): string {
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

export interface LiveActivityRequest {
  taskId: string;
  title: string;
  subtitle: string;
  symbolName: string;
  streakCount: number;
  staleAfterSeconds: number;
}

// Pure. Returns null for every reason not to start one, so the caller is a
// single null check and every rule here is unit-testable under the node env.
export function buildLiveActivityRequest(
  task: Task,
  opts: { enabled: boolean },
): LiveActivityRequest | null {
  if (!opts.enabled) return null;
  if (!task.linkUrl) return null;
  if (task.completed) return null;

  const { label, sfSymbol } = describeLink(task.linkUrl);
  return {
    taskId: task.id,
    title: truncate(task.title),
    subtitle: label,
    symbolName: sfSymbol,
    streakCount: task.streakCount,
    staleAfterSeconds: STALE_AFTER_SECONDS,
  };
}

// Lazily required so importing this module never crashes in Expo Go or on
// Android, where the local `todo-widget-bridge` native module doesn't exist —
// same shape as writeToNativeBridge in widgetSync.ts.
export async function startLinkLiveActivity(task: Task): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const request = buildLiveActivityRequest(task, {
    enabled: useSettingsStore.getState().linkLiveActivity,
  });
  if (!request) return;
  try {
    const { startLinkLiveActivity: start } = require('todo-widget-bridge') as {
      startLinkLiveActivity: (
        taskId: string,
        title: string,
        subtitle: string,
        symbolName: string,
        streakCount: number,
        staleAfterSeconds: number,
      ) => Promise<boolean>;
    };
    // Awaited, not fire-and-forget like the rest of this bridge: Activity.request
    // throws unless the app is foreground when it runs, and the caller's very
    // next statement is Linking.openURL, which takes the foreground away.
    await start(
      request.taskId,
      request.title,
      request.subtitle,
      request.symbolName,
      request.streakCount,
      request.staleAfterSeconds,
    );
  } catch {
    // No dev client build with the native module present (e.g. Expo Go) — no-op.
  }
}

function endLinkLiveActivities(): void {
  if (Platform.OS !== 'ios') return;
  try {
    const { endLinkLiveActivities: end } = require('todo-widget-bridge') as {
      endLinkLiveActivities: () => Promise<boolean>;
    };
    end().catch(() => {});
  } catch {
    // No dev client build with the native module present (e.g. Expo Go) — no-op.
  }
}

// Ends the link Live Activity whenever the app comes to the foreground —
// which is the only end condition there is. That covers both halves of the
// intended flow with one listener: coming back from Duolingo by hand, and
// tapping the activity's Done button (CompleteTaskIntent.openAppWhenRun
// foregrounds the app, so the same 'active' transition fires either way). The
// mount call additionally clears an activity left behind by a previous app
// process that was killed while one was live.
export function useLiveActivitySync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    endLinkLiveActivities();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') endLinkLiveActivities();
    });
    return () => subscription.remove();
  }, []);
}
