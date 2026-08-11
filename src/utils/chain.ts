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

/** Adds the one extra field `isChainFinish` needs beyond `ChainCarrier`. */
export interface ChainCompletionCarrier extends ChainCarrier {
  recurrenceType?: string;
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

/** The current-step and (if any) next-step titles for a chain preview row. */
export interface ChainPreview {
  currentIdx: number;
  total: number;
  currentTitle: string;
  nextTitle: string | null;
}

/**
 * What the expanded row's chain summary should show: the CURRENT step leads
 * (it's the only actionable one), followed by the next step if there is one.
 * A finished earlier step is never included — with the row truncated to one
 * line, spending width on something already done pushed the upcoming step
 * past the truncation point.
 */
export function chainPreview(task: ChainCarrier): ChainPreview | null {
  const items = task.chainItems;
  if (!items || items.length === 0) return null;
  const total = items.length;
  const currentIdx = (task.chainIndex ?? 0) % total;
  const nextItem = currentIdx + 1 < total ? items[currentIdx + 1] : null;
  return {
    currentIdx,
    total,
    currentTitle: items[currentIdx].title,
    nextTitle: nextItem ? nextItem.title : null,
  };
}

/**
 * True when completing this task right now would finish a chain for good —
 * the last step, with no Repeat to loop it back to the first. Mirrors
 * completeTask's `atChainEnd && !recurs` (useTaskStore.ts): the one case
 * `spawnsNext` comes out false and the task just ends like an ordinary
 * one-off, with nothing else marking the moment as "a whole routine done"
 * rather than "one task done". Never true mid-chain or on a repeating chain,
 * both of which spawn straight into the next step/cycle.
 */
export function isChainFinish(task: ChainCompletionCarrier): boolean {
  const items = task.chainItems;
  if (!task.chainEnabled || !items || items.length === 0) return false;
  if ((task.recurrenceType ?? 'none') !== 'none') return false;
  return (task.chainIndex ?? 0) >= items.length - 1;
}
