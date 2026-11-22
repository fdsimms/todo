/**
 * Every `reconcileGeneratedTask` call either passes `blocksOnFinished` or names,
 * below, what else keeps a second device from writing a duplicate.
 *
 * Why it needs a check: whether a generated task is wanted is usually decided
 * from a device-local mark (`...LastDayKey`) or from data that does not sync
 * (the mood and journal entries stay off iCloud, and the calendar, Health and
 * the WaniKani and Franki reads are per device). A second device that has
 * synced the first one's finished row sees neither, finds no live row, and
 * writes its own. `reconcileGeneratedTask` only looks for a live row unless
 * `blocksOnFinished` is set, so the mistake is invisible in review and shows
 * only on a real second device. The mood, journal and dream check-ins shipped
 * it first, and the audit that followed found it on a dozen more.
 *
 * Reads the source rather than running the passes, the way `noRawModal.test.ts`
 * does: the passes need a store, a clock and a device source each.
 */
import { readFileSync } from 'fs';
import { sourceFiles } from '../testSupport/sourceFiles';
import { join } from 'path';

/**
 * A kind that does not pass `blocksOnFinished`, and what stands in for it. A
 * kind belongs here only with a reason that holds on a second device.
 */
const WITHOUT_BLOCK: Record<string, string> = {
  groceryUseUp: 'finishedUseUpFor: a finished task for the same item and use-by day withholds it',
  leftoverUseUp: 'finishedLeftoverUseUpFor: the same, for a leftover and its keep-until day',
  projectReview: 'projectsReviewedToday reads the synced completed and archived stamps; the decline is on the project',
  reachOut: 'reachOutsHandledRecently reads synced completed and archived stamps; the decline is on the person',
  waitingFollowUp: 'waitingFollowUpsHandledRecently reads synced stamps; the decline is on the waiting task',
  pantryCheck: 'wantedPantryChecks reads synced task rows; the decline is on the grocery item',
  supplyReorder: 'completing it stamps supplyDeclinedAtCount on the source task, which syncs',
  pantryReview: 'a cadence: latestOfferedDayKey reads the newest synced row. Its source is a day, so it would also work',
  backfill: 'a cadence: latestOfferedDayKey reads the newest synced row. blocksOnFinished would block a pool for good',
  weather: 'the day mark lives inside the synced weatherRules (lastFiredDayKey)',
  screenTime: 'the day mark lives inside the synced screenTimeRules',
  blockOffer: 'the day mark lives inside the synced blockOfferRules',
  health: 'the day mark lives inside the synced healthRules',
  // Not decided: queue-driven, and they correct themselves once the work is done.
  // Ticking one with work remaining can still duplicate it on another device.
  wanikani: 'open: its marks are per device and a wave is keyed to an hour, so blocksOnFinished needs a design call',
  franki: 'open: the same shape as wanikani',
};

/** The calls in one file: the text of each `reconcileGeneratedTask({ ... })` argument. */
function callsIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/reconcileGeneratedTask\(\{/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    out.push(source.slice(m.index!, i));
  }
  return out;
}

const SRC = join(__dirname, '..');
const calls = sourceFiles(SRC)
  .filter(f => !f.includes('__tests__'))
  .flatMap(f => callsIn(readFileSync(f, 'utf8')))
  .map(text => {
    const kind = text.match(/\n\s*kind: ([^,\n]+),/)?.[1] ?? '?';
    return { kind: kind.replace(/'/g, ''), blocks: text.includes('blocksOnFinished') };
  });

describe('generated tasks and a second device', () => {
  it('finds the calls', () => {
    // Guards the scan itself: a wrong path or pattern would pass everything below.
    expect(calls.length).toBeGreaterThan(30);
  });

  it('passes blocksOnFinished, or has a reason on the list above', () => {
    const missing = calls.filter(c => !c.blocks && !(c.kind in WITHOUT_BLOCK)).map(c => c.kind);
    expect(missing).toEqual([]);
  });

  it('lists no kind that passes it, or that is not generated here at all', () => {
    const stale = Object.keys(WITHOUT_BLOCK).filter(kind => {
      const own = calls.filter(c => c.kind === kind);
      return own.length === 0 || own.every(c => c.blocks);
    });
    expect(stale).toEqual([]);
  });
});
