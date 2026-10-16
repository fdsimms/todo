/**
 * The copy flag tools against a real replica: the phone writes a flag, the
 * tools list it and resolve it, and a resolved flag leaves the default list.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { copyFlagFind, listCopyFlags, resolveCopyFlag } from '../copyFlagTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the copy flag tools', () => {
  let replica: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM copy_flags');
    mockRaw.runSync(
      `INSERT INTO copy_flags (id, text, screen, note, status, resolution, created_at) VALUES (?,?,?,?,?,?,?)`,
      ['a', 'Colour theme', 'Settings', 'British', 'open', '', '2026-10-09T10:00:00.000Z'],
    );
    mockRaw.runSync(
      `INSERT INTO copy_flags (id, text, screen, note, status, resolution, created_at) VALUES (?,?,?,?,?,?,?)`,
      ['b', 'Old line', 'Today', '', 'resolved', 'Reworded', '2026-10-08T10:00:00.000Z'],
    );
    replica.refresh();
  });

  it('lists open flags by default, with how to fix them', () => {
    const { flags, note } = listCopyFlags(replica);
    expect(flags.map(f => f.id)).toEqual(['a']);
    expect(flags[0]).toMatchObject({ text: 'Colour theme', screen: 'Settings', note: 'British' });
    expect(note).toMatch(/resolve_copy_flag/);
    expect(flags[0].find).toBe("npm run copy -- --grep 'Colour theme'");
  });

  it('lists resolved or all flags on request', () => {
    expect(listCopyFlags(replica, { status: 'resolved' }).flags.map(f => f.id)).toEqual(['b']);
    expect(listCopyFlags(replica, { status: 'all' }).flags.map(f => f.id).sort()).toEqual(['a', 'b']);
  });

  it('resolves a flag with what it became', () => {
    const { flag } = resolveCopyFlag(replica, 'a', '  Color theme  ');
    expect(flag).toMatchObject({ status: 'resolved', resolution: 'Color theme' });
    expect(listCopyFlags(replica).flags).toEqual([]);
  });

  it('refuses an id it does not have', () => {
    expect(() => resolveCopyFlag(replica, 'nope', 'x')).toThrow(/No copy flag/);
  });

  describe('the find command', () => {
    it('searches the whole text when there is nothing to leave out', () => {
      expect(copyFlagFind('Colour theme')).toBe("npm run copy -- --grep 'Colour theme'");
    });

    it('searches the longest stretch without a digit, since a number on screen is a gap in the source', () => {
      expect(copyFlagFind('3 tasks left today, 2 overdue')).toBe("npm run copy -- --grep 'tasks left today,'");
    });

    it('falls back to the whole text when every stretch is too short to search for', () => {
      expect(copyFlagFind('7 of 12')).toBe("npm run copy -- --grep '7 of 12'");
    });

    it('matches either kind of apostrophe, and leaves no quote to break the shell', () => {
      const find = copyFlagFind('You can\u2019t undo this, it isn\'t saved');
      expect(find).toBe("npm run copy -- --grep 'You can.t undo this, it isn.t saved'");
      expect(find.slice(find.indexOf("'") + 1, -1)).not.toContain("'");
    });

    it('escapes what a regular expression would read as syntax', () => {
      expect(copyFlagFind('Delete (all)? Really.')).toBe("npm run copy -- --grep 'Delete \\(all\\)\\? Really\\.'");
    });

    it('collapses whitespace the way the inventory does, and caps a long paragraph', () => {
      expect(copyFlagFind('Two\n  lines')).toBe("npm run copy -- --grep 'Two lines'");
      const long = copyFlagFind('word '.repeat(40));
      expect(long.length).toBeLessThan("npm run copy -- --grep ''".length + 61);
    });
  });
});
