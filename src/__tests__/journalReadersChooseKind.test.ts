/**
 * A screen that reads the journal store has to have decided what to do about
 * notes.
 *
 * A note (lyrics, an idea) is not about the day it was typed on, so anything
 * that draws journal writing as part of a day (the mood day page, Looking back)
 * reads through `diaryEntries`, which drops them. Forgetting that is invisible
 * in review and typechecks: song lines would just turn up on the mood page.
 * See "Notes, the third kind" in `docs/arch/journal.md`.
 *
 * So a file that reads `useJournalStore` is either listed below, with the
 * reason it already handles every kind correctly, or it calls `diaryEntries`.
 * A new reader fails here until it is one or the other.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SRC, sourceFiles } from '../testSupport/sourceFiles';

/** Files that read the store and are right for all three kinds, and why. */
const KIND_AWARE: Record<string, string> = {
  'components/JournalDaySheet.tsx': 'takes the kind it was opened for and filters by it',
  'components/JournalEntrySheet.tsx': 'works on the kind it was opened for',
  'components/JournalMonthSheet.tsx': 'takes the kind it was opened for and filters by it',
  'components/JournalPhotoStrip.tsx': 'photos belong to an entry whatever its kind',
  'hooks/useNavMenuOptions.ts': 'counts each kind separately',
  'hooks/useRecordTaskReady.ts': 'only answers a journal or dream reminder; notes have none',
  'navigation/AppNavigator.tsx': 'counts each kind separately',
  'screens/JournalScreen.tsx': 'the Journal, Dreams and Notes screens, split by kind',
  'screens/PersonDetailScreen.tsx': 'lists entries about a person, labeled by kind',
  'store/useJournalStore.ts': 'the store itself',
  'store/useTaskStore.ts': 'the reminder generators, which only run for journal and dream',
  'utils/demoSeed.ts': 'seeds each kind',
  'utils/maintenancePasses.ts': 'sweeps photos on every entry',
  'utils/widgetSync.ts': 'files queued entries under the kind they were queued with',
};

/** The mood screens, which draw the journal as part of a day. */
const DAY_READERS = ['screens/MoodDayScreen.tsx', 'screens/MoodScreen.tsx'];

const files = sourceFiles(SRC).map(f => ({ rel: f.slice(SRC.length + 1), src: readFileSync(f, 'utf8') }));
const readers = files.filter(f => f.src.includes('useJournalStore'));

describe('who reads the journal store', () => {
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(readers.length).toBeGreaterThan(10);
  });

  it('has every reader either listed with a reason or calling diaryEntries', () => {
    const undecided = readers
      .filter(f => !(f.rel in KIND_AWARE) && !f.src.includes('diaryEntries('))
      .map(f => f.rel);
    expect(undecided).toEqual([]);
  });

  it('does not list a file that no longer reads the store', () => {
    const stale = Object.keys(KIND_AWARE).filter(rel => !readers.some(f => f.rel === rel));
    expect(stale).toEqual([]);
  });

  it('keeps the mood screens reading through diaryEntries', () => {
    for (const rel of DAY_READERS) {
      const file = files.find(f => f.rel === rel);
      expect(file).toBeDefined();
      expect(file!.src).toContain('diaryEntries(');
      // A day reader is never also listed as fine for every kind.
      expect(rel in KIND_AWARE).toBe(false);
    }
  });
});
