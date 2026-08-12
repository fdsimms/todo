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
 * The number as `sms:` wants it — same normalisation as `telUrl`, `sms:`
 * scheme instead of `tel:`. Every messaging app that understands `tel:` links
 * understands `sms:` the same way, so there is nothing new to sanitise here
 * beyond swapping the scheme.
 */
export function smsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const intl = trimmed.startsWith('+');
  const dial = trimmed.replace(DIAL_STRIP, '').replace(/\+/g, '');
  if (!phoneDigits(dial)) return null;
  return `sms:${intl ? '+' : ''}${dial}`;
}

/**
 * Punctuate a number as it's typed, but only where there's one right answer.
 *
 * This is the one place that rewrites what the user typed, so it's narrow on
 * purpose — the module's whole premise is that "canonical" needs a country the
 * app never asks for. It reformats exactly two shapes, both unmistakably NANP:
 *
 *   - 10 digits whose 1st and 4th are 2–9 → `(555) 123-4567`
 *   - 11 digits starting with 1, same rule on the rest → `1 (555) 123-4567`
 *
 * Everything else passes through verbatim, and the refusals are the point:
 *
 *   - **Anything holding a `+`** is international and stays exactly as typed.
 *   - **A leading 0** is a trunk prefix, not an area code. `0400 123 456` is a
 *     ten-digit Australian mobile, and punctuating it as `(040) 012-3456` would
 *     be confidently wrong — which is worse than leaving it alone. The 4th-digit
 *     rule catches the same class from the other end.
 *   - **Letters, or any character outside the dial alphabet**, mean this isn't a
 *     bare number — an extension, a note, someone's own spacing — so it's left
 *     to stand.
 *   - **Seven digits** are deliberately not formatted, for the reason
 *     `looksLikePhoneNumber` gives: too many plans write 7–8 local digits their
 *     own way.
 *
 * Idempotent, because it always rebuilds from the digits and only ever emits
 * characters it also accepts — so it can run on every keystroke without
 * fighting the caret, and backspacing out of a formatted number simply drops
 * below ten digits and stops being reformatted.
 */
export function formatPhoneInput(raw: string): string {
  if (!raw || raw.includes('+')) return raw;
  // Anything we wouldn't have produced ourselves is the user's own formatting.
  if (/[^0-9()\-.\s]/.test(raw)) return raw;

  const digits = phoneDigits(raw);
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10) return raw;
  // NANP: area code and exchange both start 2–9. Nothing else is one.
  if (national[0] < '2' || national[3] < '2') return raw;

  const formatted = `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  return national === digits ? formatted : `1 ${formatted}`;
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
