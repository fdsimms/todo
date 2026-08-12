import {
  editorSearchTerms,
  matchesEditorQuery,
  filterEditorRows,
  type EditorSearchable,
} from '../utils/editorSearch';

const rows: EditorSearchable[] = [
  { key: 'date', label: 'Date', keywords: ['when', 'schedule', 'today'] },
  { key: 'deadline', label: 'Deadline', keywords: ['due', 'by'] },
  { key: 'waitingOn', label: 'Waiting on', keywords: ['blocked', 'depends on', 'after'] },
  { key: 'vacation', label: 'Vacation pause', keywords: ['away', 'holiday', 'skip'] },
  { key: 'link', label: 'Link', keywords: ['url', 'website'] },
];

describe('editorSearchTerms', () => {
  it('splits on whitespace and lowercases', () => {
    expect(editorSearchTerms('  Vacation   Pause ')).toEqual(['vacation', 'pause']);
  });

  it('is empty for a blank query, which means "not searching"', () => {
    expect(editorSearchTerms('')).toEqual([]);
    expect(editorSearchTerms('   ')).toEqual([]);
  });
});

describe('matchesEditorQuery', () => {
  const terms = editorSearchTerms;

  it('matches on the label', () => {
    expect(matchesEditorQuery(rows[0], terms('date'))).toBe(true);
  });

  it('matches a partial label', () => {
    expect(matchesEditorQuery(rows[2], terms('wait'))).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesEditorQuery(rows[3], terms('VACATION'))).toBe(true);
  });

  it('matches on a keyword the label never says', () => {
    expect(matchesEditorQuery(rows[2], terms('blocked'))).toBe(true);
    expect(matchesEditorQuery(rows[4], terms('url'))).toBe(true);
  });

  it('requires every term to match something', () => {
    expect(matchesEditorQuery(rows[3], terms('vacation away'))).toBe(true);
    expect(matchesEditorQuery(rows[3], terms('vacation zzz'))).toBe(false);
  });

  it('lets separate terms match separate haystacks', () => {
    // "pause" is in the label, "skip" only in the keywords.
    expect(matchesEditorQuery(rows[3], terms('pause skip'))).toBe(true);
  });

  it('matches everything when not searching, so an empty query is inert', () => {
    for (const row of rows) expect(matchesEditorQuery(row, [])).toBe(true);
  });

  it('tolerates a row with no keywords', () => {
    expect(matchesEditorQuery({ key: 'k', label: 'Kind' }, terms('kind'))).toBe(true);
    expect(matchesEditorQuery({ key: 'k', label: 'Kind' }, terms('away'))).toBe(false);
  });
});

describe('filterEditorRows', () => {
  it('returns the matching rows', () => {
    // Date and Deadline on their labels, Waiting on via "depends on",
    // Vacation pause via "holiday".
    expect(filterEditorRows(rows, editorSearchTerms('d')).map(r => r.key))
      .toEqual(['date', 'deadline', 'waitingOn', 'vacation']);
  });

  it('keeps the form order rather than ranking — a label match does not jump the queue', () => {
    // Date matches on the keyword "when" and Link on "website", either side of
    // the one row whose *label* carries the term. Ranked, "Waiting on" would
    // lead; in the form it stays where it sits.
    expect(filterEditorRows(rows, editorSearchTerms('w')).map(r => r.key))
      .toEqual(['date', 'waitingOn', 'vacation', 'link']);
  });

  it('returns everything, by identity, when not searching', () => {
    expect(filterEditorRows(rows, [])).toBe(rows);
  });

  it('returns nothing when a term matches no row', () => {
    expect(filterEditorRows(rows, editorSearchTerms('zzz'))).toEqual([]);
  });
});
