import { dbGetSetting, dbSetSetting, dbLinkSchemesInUse } from '../db/database';
import { RETIRED_LINK_APPS, knownLinkAppFor, linkAppsFor, type LinkApp } from '../constants/linkApps';
import { generateId } from './id';

/**
 * Links the person saved as chips in the Link picker ("ADP", "Costco"), beside
 * the handful of built-in apps in `KNOWN_LINK_APPS`. A saved link is a name and
 * the URL it opens, nothing else: it is stored on a task verbatim, exactly like
 * a typed one, so removing a saved link never changes a task that used it.
 *
 * **One JSON setting, and it syncs** (`SYNCED_SETTING_KEYS`), the `savedPlaces`
 * shape: a name and a URL mean the same on every device.
 *
 * Compared by URL, not by name. Two saved links may share a name (a person's
 * own call), but one URL is one chip, because the picker marks a chip selected
 * by comparing it to the task's stored link.
 */
export const SAVED_LINKS_KEY = 'savedLinks';
export const SAVED_LINKS_LIMIT = 30;
const ADOPTED_FLAG = 'saved_links_adopted_done';

export interface SavedLink {
  id: string;
  name: string;
  url: string;
}

/** The comparison key for a URL: trimmed and lowercased, so a retyped link is the same chip. */
export function savedLinkKey(url: string): string {
  return url.trim().toLowerCase();
}

function readEntry(raw: unknown): SavedLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  const url = typeof v.url === 'string' ? v.url.trim() : '';
  if (!name || !url || typeof v.id !== 'string' || !v.id) return null;
  return { id: v.id, name, url };
}

/** Tolerant of a missing or malformed stored value: entries that don't read are dropped. */
export function parseSavedLinks(raw: string | null | undefined): SavedLink[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: SavedLink[] = [];
    for (const item of value) {
      const read = readEntry(item);
      const key = read ? savedLinkKey(read.url) : '';
      if (!read || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(read);
    }
    return out;
  } catch {
    return [];
  }
}

/** Whether the URL is already a chip, built in or saved, so there is nothing to save. */
export function isChipUrl(links: readonly SavedLink[], url: string | null | undefined): boolean {
  if (!url) return false;
  return knownLinkAppFor(url) !== null || links.some(l => savedLinkKey(l.url) === savedLinkKey(url));
}

/** Whether "Save link" is worth offering for what is typed in the field. */
export function canSaveLink(links: readonly SavedLink[], typed: string | null | undefined): boolean {
  const url = (typed ?? '').trim();
  return !!url && links.length < SAVED_LINKS_LIMIT && !isChipUrl(links, url);
}

/**
 * A starting name for a link, for the prompt to prefill: the site without
 * "www." and the ending (https://www.costco.com/x gives Costco), or the scheme
 * of an app link (adp:// gives Adp). The person edits it, so a poor guess costs
 * a keystroke, not a wrong name.
 */
export function suggestLinkName(url: string): string {
  const trimmed = url.trim();
  const match = /^([a-z][a-z0-9+.-]*):(?:\/\/)?([^/?#]*)/i.exec(trimmed);
  let word = trimmed;
  if (match) {
    const scheme = match[1].toLowerCase();
    const host = match[2].replace(/^www\./i, '');
    word = scheme === 'http' || scheme === 'https'
      ? (host.split('.').filter(Boolean).slice(-2, -1)[0] ?? host)
      : scheme;
  }
  const clean = word.replace(/[^a-z0-9]+/gi, ' ').trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : '';
}

/**
 * The list with this link saved. Empty fields, a URL that is already a chip and
 * a new link past the limit leave the list as it was.
 */
export function addSavedLink(links: readonly SavedLink[], input: { name: string; url: string }): SavedLink[] {
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name || !url || isChipUrl(links, url) || links.length >= SAVED_LINKS_LIMIT) return [...links];
  return [...links, { id: generateId(), name, url }];
}

/** Renames one link. Refused (list unchanged) for an empty name. */
export function renameSavedLink(links: readonly SavedLink[], id: string, name: string): SavedLink[] {
  const trimmed = name.trim();
  if (!trimmed) return [...links];
  return links.map(l => (l.id === id ? { ...l, name: trimmed } : l));
}

export function removeSavedLink(links: readonly SavedLink[], id: string): SavedLink[] {
  return links.filter(l => l.id !== id);
}

/**
 * The chips to offer: the built-in apps (Groceries only while the kitchen area
 * is on), then the saved links. Both are the `LinkApp` shape so a picker maps
 * one list; `saved` is what says which a long-press can rename or remove.
 */
export interface LinkChip extends LinkApp {
  saved: boolean;
  /** The saved link's id; null on a built-in app. */
  savedId: string | null;
}

export function linkChips(links: readonly SavedLink[], kitchenEnabled: boolean): LinkChip[] {
  const builtIn: LinkChip[] = linkAppsFor(kitchenEnabled).map(a => ({ ...a, saved: false, savedId: null }));
  const own: LinkChip[] = links.map(l => ({
    name: l.name, scheme: l.url, icon: 'link-outline', sfSymbol: 'link', saved: true, savedId: l.id,
  }));
  return [...builtIn, ...own];
}

/**
 * Saved links for the built-in apps this version stopped offering, found among
 * the ones a task or reward already carries (`inUse`, the schemes read from the
 * database). A person who linked a task to Duolingo keeps a Duolingo chip, and
 * one who never did doesn't get six they didn't ask for. The id is derived from
 * the scheme, not random: every device runs this once, and two random ids would
 * make two copies of one link after a sync.
 */
export function adoptRetiredLinks(links: readonly SavedLink[], inUse: readonly string[]): SavedLink[] {
  const used = new Set(inUse.map(savedLinkKey));
  let next = [...links];
  for (const app of RETIRED_LINK_APPS) {
    if (!used.has(savedLinkKey(app.scheme)) || isChipUrl(next, app.scheme) || next.length >= SAVED_LINKS_LIMIT) continue;
    next = [...next, { id: `retired-${app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: app.name, url: app.scheme }];
  }
  return next;
}

export function readSavedLinks(): SavedLink[] {
  return parseSavedLinks(dbGetSetting(SAVED_LINKS_KEY));
}

export function writeSavedLinks(links: readonly SavedLink[]): void {
  dbSetSetting(SAVED_LINKS_KEY, JSON.stringify(links));
}

/**
 * The one-time launch step behind `adoptRetiredLinks`: reads which retired
 * schemes a task, chain step, reward, template item or title rule carries and saves those. Behind a flag
 * so it costs one setting read after the first launch. The flag is device-local
 * on purpose: the result is idempotent and keyed by scheme, so a second device
 * running it too lands on the same ids.
 */
export function adoptRetiredLinkApps(): void {
  if (dbGetSetting(ADOPTED_FLAG) === '1') return;
  const inUse = dbLinkSchemesInUse(RETIRED_LINK_APPS.map(a => a.scheme));
  const current = readSavedLinks();
  const next = adoptRetiredLinks(current, inUse);
  if (next.length !== current.length) writeSavedLinks(next);
  dbSetSetting(ADOPTED_FLAG, '1');
}
