import {
  DELIVERABLE_TEXT_MAX_LENGTH,
  asksOnCompletion,
  deliverableMeta,
  formatDeliverableValue,
  formatTaskDeliverable,
  normalizeDeliverableValue,
} from '../utils/deliverables';

describe('asksOnCompletion', () => {
  it('is false for an ordinary task', () => {
    expect(asksOnCompletion({ deliverableKind: null })).toBe(false);
  });

  it('is true once a kind is set', () => {
    expect(asksOnCompletion({ deliverableKind: 'date' })).toBe(true);
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
