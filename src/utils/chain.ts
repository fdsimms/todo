import type { ChainItem } from '../types';

/**
 * Chain-step lookup, shared by everything that needs to know which step a
 * chained task is currently on — its title (displayTitleFor) and its estimate
 * (estimatedMinutesFor) both resolve through here, so the "which step is
 * active" rule lives in one place rather than being restated per reader.
 */

/**
 * The fields a chain-carrying row exposes. All optional so the workload
 * helpers keep taking the loose `{ estimatedMinutes, effort }` shape they
 * always did — a caller with no chain fields simply has no active step.
 */
export interface ChainCarrier {
  chainEnabled?: boolean;
  chainIndex?: number;
  chainItems?: ChainItem[];
}

/**
 * The step a task is currently on, or null when it isn't stepping through a
 * chain. A single-item chain reads no differently from a plain task anywhere
 * in the UI (no badge, same behavior), so it deliberately doesn't count.
 *
 * The modulo matters: chainIndex wraps to 0 on a repeating chain, but a row
 * whose chainItems were edited down can outlive its own index.
 */
export function activeChainStep(task: ChainCarrier): ChainItem | null {
  const items = task.chainItems;
  if (!task.chainEnabled || !items || items.length <= 1) return null;
  return items[(task.chainIndex ?? 0) % items.length] ?? null;
}

/**
 * Normalize chainItems read back out of stored JSON (the `cycle_items` column,
 * and a template's saved items). Rows written before per-step estimates existed
 * have no `estimatedMinutes` key at all, and an absent key has to become an
 * explicit null rather than undefined — every reader tests it with `!= null`,
 * and the value is re-serialized on the next write.
 */
export function parseChainItems(raw: unknown): ChainItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: Partial<ChainItem>) => ({
    id: c?.id ?? '',
    title: c?.title ?? '',
    estimatedMinutes: typeof c?.estimatedMinutes === 'number' ? c.estimatedMinutes : null,
  }));
}
