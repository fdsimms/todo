import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appHelp, isFixNote, loadPatchNotes, searchPatchNotes, type PatchNote } from '../helpTools';
import type { Replica, SettingsHit } from '../replica';

const notes: PatchNote[] = [
  { date: '2026-09-01', message: 'Tasks can now repeat on the second Tuesday of every month.' },
  { date: '2026-08-01', message: 'Fixed a repeat skipping a month in February.' },
  { date: '2026-07-01', message: 'A repeating task can stop after a number of times.' },
  { date: '2026-06-01', message: 'Groceries are sorted by aisle.' },
];

describe('searchPatchNotes', () => {
  it('ranks notes matching every term above the rest, ignoring how the question is phrased', () => {
    const found = searchPatchNotes(notes, 'how do I make a task repeat monthly');
    expect(found.notes[0].message).toMatch(/second Tuesday/);
  });

  it('falls back to the notes matching the most terms when none match all of them', () => {
    const found = searchPatchNotes(notes, 'groceries aisle widget');
    expect(found.notes.map(n => n.date)).toEqual(['2026-06-01']);
  });

  it('finds nothing for a question made only of filler', () => {
    expect(searchPatchNotes(notes, 'how do I')).toEqual({ matched: 0, notes: [] });
  });
});

describe('isFixNote', () => {
  it('spots a bug fix by its opening word', () => {
    expect(isFixNote(notes[1])).toBe(true);
    expect(isFixNote(notes[0])).toBe(false);
    expect(isFixNote({ date: '', message: 'Several small fixes: amounts scale.' })).toBe(true);
    expect(isFixNote({ date: '', message: 'More fixes: water is not a meal.' })).toBe(true);
    expect(isFixNote({ date: '', message: 'Fixing a meal plan is easier now.' })).toBe(false);
  });
});

describe('appHelp', () => {
  const settingsHit: SettingsHit = { label: 'Morning', path: 'Settings › Day and time › When the day turns over › Morning' };
  const other: SettingsHit = { label: 'Evening starts', path: 'Settings › Day and time › When the day turns over › Evening starts' };
  const searchSettings = jest.fn((q: string) => (q === 'midnight' || q === 'morning' ? [settingsHit] : q === 'start' ? [other, settingsHit] : []));
  const replica = { searchSettings } as unknown as Replica;

  it('leaves bug fixes out unless asked, and searches Settings term by term without repeating a row', () => {
    const help = appHelp(replica, { query: 'repeat' }, notes);
    expect(help.features.map(n => n.date)).toEqual(['2026-09-01', '2026-07-01']);
    expect(appHelp(replica, { query: 'repeat', includeFixes: true }, notes).features).toHaveLength(3);

    // Morning matches three of the terms and Evening one, so Morning leads
    // although the "start" search alone put Evening first.
    const day = appHelp(replica, { query: 'when does my morning start after midnight' }, notes);
    expect(day.settings).toEqual([settingsHit, other]);
    expect(searchSettings).toHaveBeenCalledWith('start');
  });

  it('says how many more notes matched than it returned', () => {
    expect(appHelp(replica, { query: 'repeat', limit: 1 }, notes).moreFeatures).toBe(1);
  });
});

describe('loadPatchNotes', () => {
  it('reads every fragment newest first and skips one that will not parse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'notes-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ message: 'Old', date: '2025-01-01' }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ message: 'New', date: '2026-01-01' }));
    writeFileSync(join(dir, 'c.json'), '{ not json');
    expect(loadPatchNotes(dir)).toEqual([{ message: 'New', date: '2026-01-01' }, { message: 'Old', date: '2025-01-01' }]);
  });

  it('finds the checkout\'s own notes', () => {
    expect(loadPatchNotes().length).toBeGreaterThan(1000);
  });
});
