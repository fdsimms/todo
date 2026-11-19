import type { BusyEvent } from '../utils/calendarBusy';
import { onCallConflicts, onCallSpans, type OnCallConfig } from '../utils/onCall';
import {
  matchedOnCallSwaps,
  onCallSwapContext,
  onCallSwapSourceId,
  onCallSwapTitle,
} from '../utils/onCallSwapTasks';

const at = (h: number, m = 0, day = 21) => new Date(2026, 10, day, h, m);
const CONFIG: OnCallConfig = { calendarIds: [], words: ['on call'] };
const NOW = at(8, 0, 19);

function timed(title: string, from: Date, to: Date, overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: `${title}-${from.getTime()}`, title, start: from.toISOString(), end: to.toISOString(), allDay: false,
    calendarId: 'c', location: null, status: 'confirmed', availability: 'busy', ...overrides,
  };
}
function allDay(title: string, firstDay: number, lastDay = firstDay, overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: `${title}-${firstDay}`, title,
    start: new Date(Date.UTC(2026, 10, firstDay)).toISOString(),
    end: new Date(Date.UTC(2026, 10, lastDay + 1)).toISOString(),
    allDay: true, calendarId: 'c', location: null, status: 'confirmed', availability: 'busy', ...overrides,
  };
}

const shift = timed('on call', at(9), at(17));
const spans = onCallSpans([shift], CONFIG);

describe('onCallConflicts', () => {
  it('finds a timed event that runs into a shift, and not one that clears it', () => {
    const clash = timed('Dinner', at(16), at(18));
    const clear = timed('Late dinner', at(17), at(19));
    expect(onCallConflicts([clash, clear], CONFIG, spans)).toEqual([clash]);
  });
  it('is not fooled by the shift itself, a canceled event or one marked Free', () => {
    const events = [
      shift,
      timed('Cancelled', at(10), at(11), { status: 'canceled' }),
      timed('Focus', at(10), at(11), { availability: 'free' }),
    ];
    expect(onCallConflicts(events, CONFIG, spans)).toEqual([]);
  });
  it('counts an all-day event on a shift day and against an all-day shift', () => {
    const birthday = allDay('Mom birthday', 21);
    expect(onCallConflicts([birthday], CONFIG, spans)).toEqual([birthday]);
    const weekend = onCallSpans([allDay('on call', 21, 22)], CONFIG);
    const wedding = timed('Wedding', at(14, 0, 22), at(22, 0, 22));
    expect(onCallConflicts([wedding, allDay('Holiday', 23)], CONFIG, weekend)).toEqual([wedding]);
  });
  it('has nothing to find with no shifts', () => {
    expect(onCallConflicts([timed('Dinner', at(16), at(18))], CONFIG, [])).toEqual([]);
  });
});

describe('matchedOnCallSwaps', () => {
  const dinner = timed('Dinner', at(16), at(18));
  it('writes one per conflict, due on the event', () => {
    const [match] = matchedOnCallSwaps([dinner], NOW, {});
    expect(match.sourceId).toBe(onCallSwapSourceId(dinner));
    expect(match.endsAt).toBe(dinner.end);
  });
  it('leaves an event already handled, so a deleted or ticked task stays gone', () => {
    const handled = { [onCallSwapSourceId(dinner)]: dinner.end };
    expect(matchedOnCallSwaps([dinner], NOW, handled)).toEqual([]);
  });
  it('also honors a key written before the server named the event', () => {
    const named = { ...dinner, externalId: 'server-1' };
    const handled = { [`${dinner.id}|${dinner.start}#onCallSwap`]: dinner.end };
    expect(matchedOnCallSwaps([named], NOW, handled)).toEqual([]);
  });
  it('skips an event that is over', () => {
    expect(matchedOnCallSwaps([dinner], at(19), {})).toEqual([]);
  });
});

describe('onCallSwapTitle', () => {
  it('names the event, and an untitled or very long one sensibly', () => {
    expect(onCallSwapTitle({ title: 'Dinner with Lena' })).toBe('Find someone to swap on call for Dinner with Lena');
    expect(onCallSwapTitle({ title: '  ' })).toBe('Find someone to swap on call for an event');
    expect(onCallSwapTitle({ title: 'x'.repeat(100) }).endsWith('…')).toBe(true);
  });
});

describe('onCallSwapContext', () => {
  const dinner = timed('Dinner', at(16), at(18));
  const task = { generatedKind: 'onCallSwap' as const, generatedSourceId: onCallSwapSourceId(dinner) };
  const when = (e: { start: string }) => `at ${e.start}`;
  it('says when the event is while it still clashes', () => {
    expect(onCallSwapContext(task, [dinner], true, NOW, when)).toEqual({ label: `at ${dinner.start}`, stale: false });
  });
  it('says it no longer conflicts once the event is gone or moved clear, before it starts', () => {
    expect(onCallSwapContext(task, [], true, NOW, when)).toEqual({ label: 'No longer conflicts', stale: true });
  });
  it('says nothing for an event that has started, or before the read has landed', () => {
    expect(onCallSwapContext(task, [], true, at(17), when)).toBeNull();
    expect(onCallSwapContext(task, [], false, NOW, when)).toBeNull();
  });
  it('is null for any other task', () => {
    expect(onCallSwapContext({ generatedKind: null, generatedSourceId: null }, [dinner], true, NOW, when)).toBeNull();
    expect(onCallSwapContext({ generatedKind: 'eventTask', generatedSourceId: task.generatedSourceId }, [dinner], true, NOW, when)).toBeNull();
  });
});
