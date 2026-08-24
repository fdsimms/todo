import {
  DELIVERABLE_TEXT_MAX_LENGTH,
  asksOnCompletion,
  chainStepDatedByAnswer,
  deliverableDate,
  deliverableKindFor,
  deliverableMeta,
  formatDeliverableValue,
  formatTaskDeliverable,
  normalizeDeliverableValue,
} from '../utils/deliverables';

// "Book haircut" asks for the appointment date and hands it to "Get haircut";
// the second step asks nothing of its own.
const haircutChain = [
  { id: 'book', title: 'Book haircut', estimatedMinutes: null, deliverableKind: 'date' as const, deliverableDatesNextStep: true },
  { id: 'get', title: 'Get haircut', estimatedMinutes: null, deliverableKind: null, deliverableDatesNextStep: false },
];
const onStep = (chainIndex: number, deliverableKind: 'text' | 'date' | 'number' | null = null) => ({
  deliverableKind, chainEnabled: true, chainIndex, chainItems: haircutChain,
});

describe('asksOnCompletion', () => {
  it('is false for an ordinary task', () => {
    expect(asksOnCompletion({ deliverableKind: null })).toBe(false);
  });

  it('is true once a kind is set', () => {
    expect(asksOnCompletion({ deliverableKind: 'date' })).toBe(true);
  });

  it('follows the chain step rather than the task', () => {
    expect(asksOnCompletion(onStep(0))).toBe(true);
    expect(asksOnCompletion(onStep(1))).toBe(false);
  });

  it('is still true at a silent step when the task itself asks', () => {
    expect(asksOnCompletion(onStep(1, 'text'))).toBe(true);
  });
});

describe('deliverableKindFor', () => {
  it("prefers the active step's own question to the task's", () => {
    expect(deliverableKindFor(onStep(0, 'number'))).toBe('date');
  });

  it('falls back to the task at a step that declares nothing', () => {
    // Same fallback estimatedMinutesFor makes, and for the same reason: a
    // chain written before per-step questions existed behaves as it did.
    expect(deliverableKindFor(onStep(1, 'number'))).toBe('number');
    expect(deliverableKindFor(onStep(1))).toBeNull();
  });

  it('falls back to the task when there is no chain', () => {
    expect(deliverableKindFor({ deliverableKind: 'text' })).toBe('text');
    expect(deliverableKindFor({ deliverableKind: 'text', chainEnabled: false, chainIndex: 0, chainItems: haircutChain })).toBe('text');
  });

  it('falls back to the task for a single-item chain, which is not a chain', () => {
    expect(deliverableKindFor({
      deliverableKind: 'text', chainEnabled: true, chainIndex: 0, chainItems: [haircutChain[1]],
    })).toBe('text');
  });
});

describe('chainStepDatedByAnswer', () => {
  it('names the step the answer will schedule', () => {
    expect(chainStepDatedByAnswer(onStep(0))?.title).toBe('Get haircut');
  });

  it('is null at the last step, which has nowhere to send it', () => {
    expect(chainStepDatedByAnswer(onStep(1))).toBeNull();
  });

  it('is null for a date step that was not opted in', () => {
    const items = [{ ...haircutChain[0], deliverableDatesNextStep: false }, haircutChain[1]];
    expect(chainStepDatedByAnswer({ deliverableKind: null, chainEnabled: true, chainIndex: 0, chainItems: items }))
      .toBeNull();
  });

  it('is null for a non-date step, however the flag is set', () => {
    const items = [{ ...haircutChain[0], deliverableKind: 'text' as const }, haircutChain[1]];
    expect(chainStepDatedByAnswer({ deliverableKind: null, chainEnabled: true, chainIndex: 0, chainItems: items }))
      .toBeNull();
  });

  it('works off a date question the task declared and the step passes on', () => {
    const items = [{ ...haircutChain[0], deliverableKind: null }, haircutChain[1]];
    expect(chainStepDatedByAnswer({
      deliverableKind: 'date', chainEnabled: true, chainIndex: 0, chainItems: items,
    })?.title).toBe('Get haircut');
  });

  it('is null for a task with no chain at all', () => {
    expect(chainStepDatedByAnswer({ deliverableKind: 'date' })).toBeNull();
  });
});

describe('deliverableDate', () => {
  it('parses a stored answer', () => {
    expect(deliverableDate('2026-09-12T12:00:00.000Z')?.toISOString()).toBe('2026-09-12T12:00:00.000Z');
  });

  it('is null for no answer and for anything unparseable', () => {
    expect(deliverableDate(null)).toBeNull();
    expect(deliverableDate(undefined)).toBeNull();
    expect(deliverableDate('')).toBeNull();
    expect(deliverableDate('next Tuesday-ish')).toBeNull();
  });
});

describe('normalizeDeliverableValue', () => {
  it('keeps trimmed text', () => {
    expect(normalizeDeliverableValue('text', '  The Anchor  ')).toBe('The Anchor');
  });

  it('treats empty and whitespace-only input as no answer', () => {
    expect(normalizeDeliverableValue('text', '')).toBeNull();
    expect(normalizeDeliverableValue('text', '   ')).toBeNull();
    expect(normalizeDeliverableValue('number', '  ')).toBeNull();
    expect(normalizeDeliverableValue('date', null)).toBeNull();
  });

  it('caps text at the maximum length', () => {
    const long = 'a'.repeat(DELIVERABLE_TEXT_MAX_LENGTH + 50);
    expect(normalizeDeliverableValue('text', long)).toHaveLength(DELIVERABLE_TEXT_MAX_LENGTH);
  });

  it('stores a number bare, whatever separators were typed', () => {
    expect(normalizeDeliverableValue('number', '2,400')).toBe('2400');
    expect(normalizeDeliverableValue('number', '2 400')).toBe('2400');
    expect(normalizeDeliverableValue('number', '-12.5')).toBe('-12.5');
  });

  it('refuses a number it cannot parse rather than storing something unreadable', () => {
    expect(normalizeDeliverableValue('number', 'about ten')).toBeNull();
    expect(normalizeDeliverableValue('number', '12abc')).toBeNull();
  });

  it('stores a date as an ISO string', () => {
    const value = normalizeDeliverableValue('date', new Date('2026-09-12T10:00:00.000Z').toISOString());
    expect(value).toBe('2026-09-12T10:00:00.000Z');
  });

  it('refuses an unparseable date', () => {
    expect(normalizeDeliverableValue('date', 'sometime')).toBeNull();
  });
});

describe('formatDeliverableValue', () => {
  it('groups a number for display without changing what is stored', () => {
    expect(formatDeliverableValue('number', '2400')).toBe('2,400');
    expect(formatDeliverableValue('number', '1234567')).toBe('1,234,567');
    expect(formatDeliverableValue('number', '-2400.75')).toBe('-2,400.75');
    expect(formatDeliverableValue('number', '999')).toBe('999');
  });

  it('renders a date absolutely, never as "Today"', () => {
    const today = new Date();
    const formatted = formatDeliverableValue('date', today.toISOString())!;
    expect(formatted).not.toMatch(/today/i);
    // A recorded decision is read long after the day it was made, so the
    // rendering has to stay true — the weekday and day are always in it.
    expect(formatted).toContain(String(today.getDate()));
  });

  it('includes the year only when it differs from this one', () => {
    const thisYear = new Date().getFullYear();
    const same = formatDeliverableValue('date', new Date(thisYear, 5, 12).toISOString())!;
    const other = formatDeliverableValue('date', new Date(thisYear + 2, 5, 12).toISOString())!;
    expect(same).not.toContain(String(thisYear));
    expect(other).toContain(String(thisYear + 2));
  });

  it('passes text through', () => {
    expect(formatDeliverableValue('text', 'The Anchor')).toBe('The Anchor');
  });

  it('has nothing to show for an unanswered task', () => {
    expect(formatDeliverableValue('text', null)).toBeNull();
  });
});

describe('formatTaskDeliverable', () => {
  it('is null for a task that never asked anything', () => {
    expect(formatTaskDeliverable({ deliverableKind: null, deliverableValue: 'stray' })).toBeNull();
  });

  it('is null for a decision task completed without an answer', () => {
    expect(formatTaskDeliverable({ deliverableKind: 'text', deliverableValue: null })).toBeNull();
  });

  it('renders the answer of an answered task', () => {
    expect(formatTaskDeliverable({ deliverableKind: 'number', deliverableValue: '2400' })).toBe('2,400');
  });
});

describe('deliverableMeta', () => {
  it('has a label and hint for every kind', () => {
    for (const kind of ['text', 'date', 'number'] as const) {
      const meta = deliverableMeta(kind);
      expect(meta.label).toBeTruthy();
      expect(meta.hint).toBeTruthy();
    }
  });
});
