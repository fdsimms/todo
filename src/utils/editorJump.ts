/**
 * Where an editor sheet's cards and rows sit in its scroll: what the jump bar
 * under the header (`EditorJumpBar`) reads to say which card you're in and to
 * scroll to one, and what the task editor's summary reads to scroll to the row
 * a word in it names.
 *
 * Positions arrive from `onLayout`, each relative to its own parent: a card's
 * wrapper against the scroll content, the card against that wrapper, a row
 * against the card. They're kept that way and summed when asked for, so a row
 * moving inside its card (a field above it opening) only has to report itself.
 *
 * Kept off React state. The offset changes on every scroll event, and an
 * editor holding it would re-render the whole sheet each frame; the bar
 * subscribes to `getSnapshot` instead, which only changes when what it draws
 * does.
 */

export interface ScrollMetrics {
  offset: number;
  content: number;
  viewport: number;
}

/**
 * A card counts as the one you're in once its top is this close below the top
 * of the scroll, so the highlight moves as a card's heading reaches the bar
 * rather than once the heading has gone under it.
 */
export const ACTIVE_THRESHOLD = 24;

/** Room left above whatever is scrolled to, so its heading isn't flush against the bar. */
export const JUMP_PAD = 8;

/**
 * How long a jump keeps its card highlighted. The animated scroll passes over
 * every card between here and there, and the highlight walking through each of
 * them reads as the bar not knowing where it's going.
 */
export const JUMP_HOLD_MS = 600;

export interface SectionOffset {
  key: string;
  y: number;
}

/**
 * The card you're in: the last one whose top has reached the threshold. At the
 * very bottom it's the last card, because the short cards at the end can't
 * scroll up to the threshold at all, and above the first card it's the first,
 * which is the one coming up.
 */
export function activeSectionKey(
  sections: SectionOffset[],
  metrics: ScrollMetrics,
  threshold = ACTIVE_THRESHOLD,
): string | null {
  if (sections.length === 0) return null;
  const sorted = [...sections].sort((a, b) => a.y - b.y);
  const max = Math.max(0, metrics.content - metrics.viewport);
  if (max > 0 && metrics.offset >= max - 1) return sorted[sorted.length - 1].key;
  let active = sorted[0].key;
  for (const s of sorted) {
    if (s.y <= metrics.offset + threshold) active = s.key;
  }
  return active;
}

/** The offset that puts `y` just under the top of the scroll, as far as the scroll can go. */
export function scrollTargetFor(y: number, metrics: ScrollMetrics, pad = JUMP_PAD): number {
  const max = Math.max(0, metrics.content - metrics.viewport);
  return Math.min(max, Math.max(0, y - pad));
}

export interface JumpSnapshot {
  /** The highlighted card, or null while no card is on screen. */
  active: string | null;
  /** The cards currently rendered, in the bar's order. */
  present: readonly string[];
  /** The rendered cards with at least one field set, for the bar's dots. */
  withValue: readonly string[];
}

interface SectionLayout {
  y: number | null;
  cardY: number;
  rows: Map<string, number>;
  hasValue: boolean;
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((k, i) => k === b[i]);

export class EditorJumpTracker {
  private readonly sections = new Map<string, SectionLayout>();
  private metrics: ScrollMetrics = { offset: 0, content: 0, viewport: 0 };
  private held: { key: string; until: number } | null = null;
  private snapshot: JumpSnapshot = { active: null, present: [], withValue: [] };
  private readonly listeners = new Set<() => void>();

  /**
   * `order` is every card the bar can show, in its order. A card reporting a
   * key outside it is still measured (its rows can be scrolled to) but never
   * appears in the bar.
   */
  constructor(
    private readonly order: readonly string[],
    private readonly now: () => number = Date.now,
  ) {}

  private section(key: string): SectionLayout {
    let s = this.sections.get(key);
    if (!s) {
      s = { y: null, cardY: 0, rows: new Map(), hasValue: false };
      this.sections.set(key, s);
    }
    return s;
  }

  /** A card's top in the scroll content, or null once it stops rendering. */
  setSectionY(key: string, y: number | null): void {
    this.section(key).y = y;
    this.recompute();
  }

  /** The card's own top within its wrapper, below the heading. */
  setCardY(key: string, y: number): void {
    this.section(key).cardY = y;
  }

  setRowY(sectionKey: string, rowKey: string, y: number): void {
    this.section(sectionKey).rows.set(rowKey, y);
  }

  setHasValue(key: string, hasValue: boolean): void {
    this.section(key).hasValue = hasValue;
    this.recompute();
  }

  setScroll(metrics: ScrollMetrics): void {
    this.metrics = metrics;
    this.recompute();
  }

  getMetrics(): ScrollMetrics {
    return this.metrics;
  }

  sectionY(key: string): number | null {
    return this.sections.get(key)?.y ?? null;
  }

  /** A row's top in the scroll content, or null while its card isn't rendered. */
  rowY(rowKey: string): number | null {
    for (const s of this.sections.values()) {
      const y = s.rows.get(rowKey);
      if (y !== undefined && s.y !== null) return s.y + s.cardY + y;
    }
    return null;
  }

  /**
   * The offset to scroll to for a card, holding it highlighted while the
   * scroll travels. Null when the card isn't rendered.
   */
  jumpTo(key: string): number | null {
    const y = this.sectionY(key);
    if (y === null) return null;
    this.held = { key, until: this.now() + JUMP_HOLD_MS };
    this.recompute();
    return scrollTargetFor(y, this.metrics);
  }

  getSnapshot = (): JumpSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private recompute(): void {
    const present = this.order.filter(k => this.sections.get(k)?.y != null);
    const withValue = present.filter(k => this.sections.get(k)!.hasValue);
    const held = this.held && this.held.until > this.now() && present.includes(this.held.key)
      ? this.held.key
      : null;
    if (!held) this.held = null;
    const active = held ?? activeSectionKey(
      present.map(k => ({ key: k, y: this.sections.get(k)!.y! })),
      this.metrics,
    );
    const prev = this.snapshot;
    if (prev.active === active && sameList(prev.present, present) && sameList(prev.withValue, withValue)) return;
    this.snapshot = { active, present, withValue };
    this.listeners.forEach(l => l());
  }
}
