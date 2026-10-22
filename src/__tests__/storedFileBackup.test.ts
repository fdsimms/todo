import { collectStoredFiles, restoreStoredFiles, storedFileNamesIn } from '../utils/storedFileBackup';

const tables = {
  journal_entries: [
    { id: 'j1', photos: JSON.stringify(['a.jpg', 'b.jpg']) },
    { id: 'j2', photos: null },
    { id: 'j3', photos: JSON.stringify(['a.jpg', '../escape.jpg']) },
  ],
};

describe('stored files in a backup', () => {
  it('reads the names off the rows, once each, refusing anything that is not a plain file name', () => {
    expect(storedFileNamesIn(tables)).toEqual({ 'journal-photos': ['a.jpg', 'b.jpg'] });
  });

  it('embeds the files it can read and leaves out the ones that are gone', () => {
    const files = collectStoredFiles(tables, (_folder, name) => (name === 'a.jpg' ? 'QUJD' : null));
    expect(files).toEqual({ 'journal-photos': { 'a.jpg': 'QUJD' } });
  });

  it('writes back only into folders it knows, under plain names, and counts failures', () => {
    const written: string[] = [];
    const failed = restoreStoredFiles(
      {
        'journal-photos': { 'a.jpg': 'QUJD', 'bad.jpg': 'X', '../x.jpg': 'Y' },
        'somewhere-else': { 'c.jpg': 'Z' },
      },
      (folder, name) => {
        if (name === 'bad.jpg') throw new Error('disk full');
        written.push(`${folder}/${name}`);
      },
    );
    expect(written).toEqual(['journal-photos/a.jpg']);
    expect(failed).toBe(1);
  });
});
