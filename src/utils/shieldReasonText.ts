import type { ShieldReasonEntry } from './appShield';

/**
 * The words the Screen Time page uses for why the apps are blocked, kept out
 * of the screen so they can be tested and so the page and the iOS shield
 * screen read the same way.
 *
 * Sentences rather than labels, and one line per thing the person can act on:
 * three gate tasks are three lines, because finishing any one of them is the
 * answer and the page is where they find out which. A time is formatted by the
 * caller (`formatTime`) because it has to follow the person's own 12/24-hour
 * setting, which a pure module cannot read.
 */

/** The most gate tasks named before the rest collapse into a count. */
export const MAX_NAMED_GATES = 3;

/** The lines for one reason, in the order they should be read. */
export function shieldReasonLines(entry: ShieldReasonEntry, formatTime: (iso: string) => string | null): string[] {
  switch (entry.reason) {
    case 'focus':
      return ['A focus session is running.'];
    case 'gate': {
      const titles = (entry.titles ?? []).filter(t => t.trim() !== '');
      if (titles.length === 0) return ['A task has to be done first.'];
      const named = titles.slice(0, MAX_NAMED_GATES).map(t => `${t} isn’t done yet.`);
      const rest = titles.length - named.length;
      return rest > 0 ? [...named, `${rest} more ${rest === 1 ? 'task isn’t' : 'tasks aren’t'} done yet.`] : named;
    }
    case 'penalty': {
      const time = entry.until ? formatTime(entry.until) : null;
      const cause = entry.cause?.trim() ? entry.cause.trim() : null;
      if (cause && time) return [`${cause} wasn’t done in time. Blocked until ${time}.`];
      if (cause) return [`${cause} wasn’t done in time.`];
      if (time) return [`A task wasn’t done in time. Blocked until ${time}.`];
      return ['A task wasn’t done in time.'];
    }
    case 'schedule': {
      const time = entry.until ? formatTime(entry.until) : null;
      const name = entry.name?.trim() ? entry.name.trim() : 'A schedule';
      return [time ? `${name} is blocking apps until ${time}.` : `${name} is blocking apps.`];
    }
    case 'manual': {
      const time = entry.until ? formatTime(entry.until) : null;
      if (entry.until === null || entry.until === undefined) return ['A block you started is on until you end it.'];
      return [time ? `A block you started runs until ${time}.` : 'A block you started is running.'];
    }
    case 'key':
      return ['Locked with a key tag. Tap one to unlock.'];
  }
}

/** What the status card leads with. */
export function shieldHeadline(reasonCount: number, selectedCount: number): string {
  if (reasonCount === 0) return 'Nothing is blocking your apps';
  // A reason with nothing chosen blocks nothing, and the card must not claim
  // otherwise: the reasons are set up and look perfectly well formed.
  if (selectedCount === 0) return 'No apps are chosen to block';
  return 'Your apps are blocked';
}

/** The line under the headline when there is something to say about it. */
export function shieldHeadlineNote(reasonCount: number, selectedCount: number): string | null {
  if (selectedCount === 0) {
    return reasonCount === 0
      ? 'Choose apps, then pick when they get blocked.'
      : 'Choose apps below, or these reasons have nothing to block.';
  }
  if (reasonCount === 0) return null;
  return 'The block lifts when every reason is gone, or when a key tag or the emergency button ends them.';
}

/** The count of what is picked, as the page's subtitle and the apps row's value. */
export function selectionLabel(applications: number, categories: number, websites = 0): string {
  const parts = [
    applications > 0 ? `${applications} ${applications === 1 ? 'app' : 'apps'}` : null,
    categories > 0 ? `${categories} ${categories === 1 ? 'category' : 'categories'}` : null,
    websites > 0 ? `${websites} ${websites === 1 ? 'website' : 'websites'}` : null,
  ].filter(Boolean);
  return parts.length === 0 ? 'None' : parts.join(', ');
}
