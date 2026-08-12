/**
 * "1st", "2nd", "3rd", "4th", "21st", "112th".
 *
 * The teens are the whole reason this isn't `${n}th` — 11/12/13 take "th"
 * despite ending in 1/2/3.
 *
 * It lived in `RecurrencePicker` until a second caller wanted it (the "extra
 * task" rule's every-Nth count). A component is the wrong home for a pure
 * string helper — the utils here are the half that can be tested in the `node`
 * environment Jest runs in, and a second copy is how the two spellings of an
 * ordinal would eventually disagree.
 *
 * Callers that use a negative as a sentinel (`recurrenceMonthDay: -1` meaning
 * "last day of the month") are expected to say so themselves before getting
 * here; the magnitude is what gets a suffix.
 */
export function ordinal(n: number): string {
  const abs = Math.abs(n);
  const teen = abs % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
