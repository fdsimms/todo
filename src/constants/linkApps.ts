import type { Task } from '../types';
import { activeChainStep, type ChainCarrier } from '../utils/chain';

export interface LinkApp {
  name: string;
  scheme: string; // stored in Task.linkUrl verbatim when selected
  icon: string;   // Ionicons name for the chip
  sfSymbol: string; // SF Symbol name for the same app, used by the Live Activity (native, no Ionicons there)
  /** Points into the groceries/recipes/meal plan area — see linkAppsFor. */
  kitchen?: boolean;
}

// Best-effort custom URL schemes for popular apps — not guaranteed to stay
// accurate across app updates, but "Custom URL" is always available as a
// fallback if one stops working.
export const KNOWN_LINK_APPS: LinkApp[] = [
  // First, and the one entry the "may stop working" caveat above doesn't apply
  // to — it's this app's own scheme. A recurring "Grocery run" task carrying
  // it opens the list, which is how groceries reach Today without a grocery
  // item ever having to pretend to be a task.
  { name: 'Groceries', scheme: 'dundundun://groceries', icon: 'cart-outline', sfSymbol: 'cart.fill', kitchen: true },
  // weather:// is undocumented by Apple and takes no location or query
  // parameters — it opens the Weather app to whatever it was last showing,
  // not necessarily the place a weather task's own reading came from. Still
  // one tap closer to the full forecast than the rule's own one-line title.
  { name: 'Weather', scheme: 'weather://', icon: 'partly-sunny-outline', sfSymbol: 'cloud.sun.fill' },
  { name: 'Duolingo', scheme: 'duolingo://', icon: 'school-outline', sfSymbol: 'graduationcap.fill' },
  { name: 'Spotify', scheme: 'spotify://', icon: 'musical-notes-outline', sfSymbol: 'music.note' },
  { name: 'YouTube', scheme: 'youtube://', icon: 'logo-youtube', sfSymbol: 'play.rectangle.fill' },
  { name: 'Gmail', scheme: 'googlegmail://', icon: 'mail-outline', sfSymbol: 'envelope.fill' },
  { name: 'Instagram', scheme: 'instagram://app', icon: 'logo-instagram', sfSymbol: 'camera.fill' },
  { name: 'Notion', scheme: 'notion://', icon: 'document-text-outline', sfSymbol: 'doc.text.fill' },
  { name: 'YNAB', scheme: 'ynab://', icon: 'wallet-outline', sfSymbol: 'wallet.pass.fill' },
];

/**
 * The chips to offer, given whether the groceries/recipes/meal plan area is on.
 *
 * Only the *offer* is withdrawn. A task that already carries
 * `dundundun://groceries` keeps it and keeps opening the list — the row is
 * something the user made, pointing at data that's still there, and the area
 * is one tap from coming back. What this stops is minting new ones while the
 * destination isn't in the menu.
 */
export function linkAppsFor(kitchenEnabled: boolean): LinkApp[] {
  return kitchenEnabled ? KNOWN_LINK_APPS : KNOWN_LINK_APPS.filter(a => !a.kitchen);
}

/** Known app name for a link scheme, else the raw URL — what a settings row or a caption names it. */
export function linkAppLabel(url: string): string {
  return KNOWN_LINK_APPS.find(app => app.scheme === url)?.name ?? url;
}

/** What the link reads need: the task's own link, plus its chain position. */
export type LinkSource = ChainCarrier & Pick<Task, 'linkUrl'>;

/**
 * What the link button opens, or null when there's nothing to open — the
 * single read for a task's link, the way `estimatedMinutesFor` is the single
 * read for a duration and `deliverableKindFor` for the completion question.
 *
 * Mid-chain it's the active step's own link when that step has one. The
 * task-level link rides `...effective` onto every successor, so with only
 * that to read, a chain whose steps point at different places ("Check
 * email" / "Check calendar") opened the first step's link at every step.
 *
 * Falls back to the task's link exactly as `estimatedMinutesFor` falls back
 * to the task's estimate — a chain that predates per-step links behaves
 * precisely as it did.
 */
export function linkFor(task: LinkSource): string | null {
  const step = activeChainStep(task);
  return step?.linkUrl ?? task.linkUrl ?? null;
}
