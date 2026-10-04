import {
  NO_LINE_PENDING,
  confirmLineSuggestion,
  lineMarkerFields,
  linePendingFields,
  lineSuggestion,
  type LineParseContext,
} from '../utils/listLineParse';

const ctx: LineParseContext = {
  categories: ['Home', 'Work'],
  tags: ['urgent'],
  people: [{ id: 'p1', name: 'Gideon Reed', nickname: '' }],
  groups: [],
};

// A Monday morning, local time, so day words resolve the same in every zone.
const NOW = new Date(2026, 9, 5, 9, 0);

describe('lineMarkerFields', () => {
  it('adds a line with no markers exactly as typed', () => {
    expect(lineMarkerFields('passport and adapters', ctx)).toEqual({
      title: 'passport and adapters', category: null, tags: [], personIds: [],
    });
  });

  it('files a #category and a #tag, taking them out of the title', () => {
    const fields = lineMarkerFields('fix the gate #home #urgent', ctx);
    expect(fields.title).toBe('fix the gate');
    expect(fields.category).toBe('Home');
    expect(fields.tags).toEqual(['urgent']);
  });

  it('leaves a #word that names nothing as text, and creates nothing', () => {
    const fields = lineMarkerFields('sunscreen #beach', ctx);
    expect(fields.title).toBe('sunscreen #beach');
    expect(fields.category).toBeNull();
    expect(fields.tags).toEqual([]);
  });

  it('links an @person and keeps the mention in the title, as quick add does', () => {
    const fields = lineMarkerFields('ask @gideon about the tent', ctx);
    expect(fields.personIds).toEqual(['p1']);
    expect(fields.title).toBe('ask @gideon about the tent');
  });
});

describe('lineSuggestion', () => {
  it('offers a schedule phrase for Confirm', () => {
    const s = lineSuggestion('call the vet tomorrow', NOW, NOW);
    expect(s?.kind).toBe('schedule');
  });

  it('offers a !priority when there is no schedule', () => {
    const s = lineSuggestion('renew passport !high', NOW, NOW);
    expect(s?.kind).toBe('priority');
  });

  it('offers nothing for a plain line', () => {
    expect(lineSuggestion('passport and adapters', NOW, NOW)).toBeNull();
  });
});

describe('confirmLineSuggestion and linePendingFields', () => {
  it('takes the date phrase out of the text and dates the item', () => {
    const s = lineSuggestion('call the vet tomorrow', NOW, NOW)!;
    const { text, pending } = confirmLineSuggestion(s, NO_LINE_PENDING);
    expect(text).toBe('call the vet ');
    const { draft, seriesDates } = linePendingFields(pending);
    const due = new Date(draft.dueDate!);
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2026, 9, 6]);
    expect(draft.recurrenceType).toBe('none');
    expect(seriesDates).toBeNull();
  });

  it('sets a priority without touching the schedule', () => {
    const s = lineSuggestion('renew passport !high', NOW, NOW)!;
    const { text, pending } = confirmLineSuggestion(s, NO_LINE_PENDING);
    expect(text).toBe('renew passport ');
    const { draft } = linePendingFields(pending);
    expect(draft.priority).toBe(3);
    expect(draft.dueDate).toBeUndefined();
  });

  it('keeps a priority confirmed earlier when a date is confirmed after it', () => {
    const first = confirmLineSuggestion(lineSuggestion('renew passport !high', NOW, NOW)!, NO_LINE_PENDING);
    const second = confirmLineSuggestion(lineSuggestion(`${first.text}tomorrow`, NOW, NOW)!, first.pending);
    const { draft } = linePendingFields(second.pending);
    expect(draft.priority).toBe(3);
    expect(draft.dueDate).toBeDefined();
  });

  it('sets the reminder a "remind me to … at" line asks for, and drops the request from the text', () => {
    const s = lineSuggestion('remind me to call mom tomorrow at 4pm', NOW, NOW)!;
    const { text, pending } = confirmLineSuggestion(s, NO_LINE_PENDING);
    expect(text).toBe('call mom ');
    const reminder = new Date(linePendingFields(pending).draft.reminderTime!);
    expect([reminder.getDate(), reminder.getHours()]).toEqual([6, 16]);
  });

  it('hands every date of a set to applyTaskDates rather than dropping all but one', () => {
    const s = lineSuggestion('water the neighbors\' plants on the 10th and the 15th', NOW, NOW)!;
    const { pending } = confirmLineSuggestion(s, NO_LINE_PENDING);
    const { seriesDates } = linePendingFields(pending);
    expect(seriesDates?.map(d => d.getDate())).toEqual([10, 15]);
  });

  it('adds nothing for a line with nothing confirmed', () => {
    expect(linePendingFields(NO_LINE_PENDING)).toEqual({ draft: {}, seriesDates: null });
  });
});
