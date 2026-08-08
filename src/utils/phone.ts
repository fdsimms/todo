/**
 * Phone numbers on tasks — "call the doctor" with the surgery's number on it.
 *
 * Task.phoneNumber holds the number *as typed*, and everything here is the
 * read side of that decision. Storing a canonical dial string instead would
 * mean deciding what "canonical" is, which needs a country the app never asks
 * for: +44 20 7946 0018, (555) 123-4567 and 0400 123 456 are all correct as
 * written and all wrong under someone else's normalisation. So the display is
 * verbatim and only `telUrl` sanitises, at the one moment a machine has to
 * read it.
 *
 * Nothing here validates a number against a real numbering plan — there is no
 * offline library for that, and a task carrying a number the phone won't dial
 * is a much smaller problem than a field that refuses the number you meant.
 * `looksLikePhoneNumber` is only strict enough to keep quick-add from offering
 * to call a year or a price.
 */

// Everything a dialler understands beyond the digits: a leading + for
// international, and the DTMF/pause characters an extension needs (",;*#").
// Spaces, dashes, dots, slashes and parentheses are presentation and go.
const DIAL_STRIP = /[^0-9+,;*#]/g;

/** Digits only, for length checks — the one thing every plan agrees on. */
export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * The number as `tel:` wants it, or null if there's nothing dialable in it.
 *
 * The + is kept only in the leading position, where it means "international";
 * anywhere else it's a typo, and passing it through would make the whole URL
 * un-dialable rather than just odd.
 */
export function telUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const intl = trimmed.startsWith('+');
  const dial = trimmed.replace(DIAL_STRIP, '').replace(/\+/g, '');
  if (!phoneDigits(dial)) return null;
  return `tel:${intl ? '+' : ''}${dial}`;
}

/** Whether this is worth putting a call button on the row for. */
export function isDialable(raw: string | null | undefined): boolean {
  return telUrl(raw) !== null;
}

/**
 * What a phone number typed into a *sentence* looks like — deliberately
 * stricter than what the field itself accepts.
 *
 * The field takes anything with a digit in it, because the user opened a phone
 * row and typed on a phone keypad: intent is not in question there. Quick-add
 * has no such signal — it is reading prose that happens to contain numbers —
 * so this only fires on shapes that are hard to mistake for a quantity, a year
 * or a price:
 *
 *   - a leading + and 7+ digits ("+44 20 7946 0018"), or
 *   - 10+ digits ("5551234567", "555 123 4567", "(555) 123 4567").
 *
 * A seven-digit local number ("555-1234") is deliberately left alone, even
 * though it's a perfectly real number: nothing separates it from "budget
 * 1000-2000" or an order number, and a wrong suggestion costs more here than a
 * missing one — it highlights half the input and hides the title suggestions,
 * where the miss just means using the Phone chip like any other field.
 */
export function looksLikePhoneNumber(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  // Anything outside the dial alphabet plus the usual separators means this is
  // prose, not a number.
  if (/[^0-9+()\-.\s,;*#]/.test(trimmed)) return false;
  // "10 15 20 25 30 35" is twelve digits and no phone number anyone wrote. Real
  // groupings top out around four ("+44 20 7946 0018"), so a longer run of them
  // is a list of numbers that happens to sit next to itself.
  if (trimmed.split(/[\s().-]+/).filter(Boolean).length > 5) return false;
  const digits = phoneDigits(trimmed);
  if (digits.length >= 10) return true;
  return digits.length >= 7 && trimmed.startsWith('+');
}
