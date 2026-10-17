/**
 * A person's nickname field can hold several names, separated by commas
 * ("cardiologist, heart doctor"), so one person answers to "@cardiologist" and
 * "@heart doctor" alike. It stays one string in `Person.nickname` rather than a
 * new column: nothing about storage, sync or backup changes, and a person with
 * one nickname (the normal case) reads exactly as before.
 *
 * **Every reader of "what do we call them" takes `primaryNickname`, and every
 * reader of "what do they answer to" takes `nicknamesOf`.** Reading the raw
 * field for either shows the comma-joined list in a title ("Call cardiologist,
 * heart doctor"). The first name listed is the one shown.
 */

/** Every nickname in the field, trimmed, without blanks or case-insensitive repeats. */
export function nicknamesOf(nickname: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of nickname.split(',')) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** The nickname shown in place of the name: the first one listed, or '' when there is none. */
export function primaryNickname(nickname: string): string {
  return nicknamesOf(nickname)[0] ?? '';
}
