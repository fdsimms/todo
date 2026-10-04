jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn() }));

import {
  AGENT_NOTES_KEY, AGENT_NOTES_LIMIT, addAgentNote, editAgentNote, parseAgentNotes, removeAgentNote, type AgentNote,
} from '../utils/agentNotes';
import { isSyncedSettingKey } from '../db/syncTracking';

let n = 0;
const id = () => `n${++n}`;
const now = new Date('2026-10-04T12:00:00');

describe('agent notes', () => {
  it('sync', () => {
    expect(isSyncedSettingKey(AGENT_NOTES_KEY)).toBe(true);
  });

  it('add to the end, and return the existing note for the same text instead of a duplicate', () => {
    const first = addAgentNote([], ' Errands on Saturdays ', now, id);
    expect(first).toMatchObject({ ok: true, note: { text: 'Errands on Saturdays' } });
    if (!first.ok) throw new Error();
    const again = addAgentNote(first.notes, 'errands on saturdays', now, id);
    expect(again.ok && again.notes).toHaveLength(1);
  });

  it('refuse a blank note, an overlong one, and one past the limit', () => {
    expect(addAgentNote([], '   ', now, id).ok).toBe(false);
    expect(addAgentNote([], 'x'.repeat(501), now, id).ok).toBe(false);
    const full: AgentNote[] = Array.from({ length: AGENT_NOTES_LIMIT }, (_, i) => ({ id: `f${i}`, text: `Note ${i}`, at: '' }));
    expect(addAgentNote(full, 'One more', now, id)).toEqual({ ok: false, reason: expect.stringMatching(/Remove one/) });
  });

  it('edit and remove by id; an edit to nothing removes', () => {
    const notes: AgentNote[] = [{ id: 'a', text: 'One', at: '' }, { id: 'b', text: 'Two', at: '' }];
    expect(editAgentNote(notes, 'a', 'Uno').map(x => x.text)).toEqual(['Uno', 'Two']);
    expect(editAgentNote(notes, 'a', '  ').map(x => x.id)).toEqual(['b']);
    expect(removeAgentNote(notes, 'b').map(x => x.id)).toEqual(['a']);
  });

  it('read tolerantly', () => {
    expect(parseAgentNotes(null)).toEqual([]);
    expect(parseAgentNotes('nonsense')).toEqual([]);
    expect(parseAgentNotes(JSON.stringify([{ id: 'a', text: ' Hi ', at: 'x' }, { text: 'no id' }, 3])))
      .toEqual([{ id: 'a', text: 'Hi', at: 'x' }]);
  });
});
