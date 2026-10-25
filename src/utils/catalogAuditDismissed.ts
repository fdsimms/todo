import type { AuditFinding } from './catalogAudit';
import { groceryNameKey } from './groceryParse';

/**
 * "Leave it" on a Tidy catalog finding, remembered.
 *
 * A finding has no id of its own, so it is named by what it is about: its kind
 * and the name keys of its rows. **Keys, not ids, on purpose**: a row that is
 * renamed or merged stops matching its old finding, which is right (the name
 * changed, so the question is new), and a finding survives a restore or a
 * second device that holds the same names under different ids. The list is the
 * `catalogAuditDismissed` setting, which syncs (`SYNCED_SETTING_KEYS`), so a
 * "leave it" on one device holds on the other.
 */
export const CATALOG_AUDIT_DISMISSED_KEY = 'catalogAuditDismissed';

export function findingKey(finding: Pick<AuditFinding, 'kind' | 'items'>): string {
  return `${finding.kind}:${finding.items.map(i => groceryNameKey(i.name)).join('|')}`;
}

export function parseDismissed(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function withDismissed(list: readonly string[], key: string): string[] {
  return list.includes(key) ? [...list] : [...list, key];
}

export function visibleFindings<T extends Pick<AuditFinding, 'kind' | 'items'>>(
  findings: readonly T[],
  dismissed: readonly string[]
): T[] {
  const hidden = new Set(dismissed);
  return findings.filter(f => !hidden.has(findingKey(f)));
}
