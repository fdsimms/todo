/**
 * Email addresses on tasks — "email the landlord" with the address on it.
 *
 * Task.emailAddress holds the address as typed, mirroring how
 * `src/utils/phone.ts` treats Task.phoneNumber: no canonicalisation, no
 * validation beyond "worth putting a compose button on the row". `mailtoUrl`
 * is the one place a machine has to read it.
 */

/** The address as `mailto:` wants it, or null if there's nothing to compose to. */
export function mailtoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return `mailto:${encodeURIComponent(trimmed).replace(/%40/g, '@')}`;
}

/** Whether this is worth putting a compose button on the row for. */
export function isEmailable(raw: string | null | undefined): boolean {
  return mailtoUrl(raw) !== null;
}
