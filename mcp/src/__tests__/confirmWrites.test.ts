import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfirmTokens, describeEffects, CONFIRM_TTL_MS } from '../confirmWrites';

describe('confirm tokens', () => {
  it('hand back the previewed request, once', () => {
    const tokens = createConfirmTokens();
    const token = tokens.issue('update_task', { id: 't1', title: 'A' }, ['Change "A"']);
    expect(tokens.take(token)).toEqual({ ok: true, tool: 'update_task', args: { id: 't1', title: 'A' }, summary: ['Change "A"'] });
    expect(tokens.take(token)).toMatchObject({ ok: false, reason: expect.stringMatching(/already used/) });
  });

  it('tell an expired preview from one that never existed', () => {
    let now = 0;
    const tokens = createConfirmTokens(() => now);
    const a = tokens.issue('complete_task', { id: 't1' }, []);
    expect(tokens.take('made-up')).toMatchObject({ ok: false, reason: expect.stringMatching(/do not make one up/) });
    now = CONFIRM_TTL_MS + 1;
    expect(tokens.take(a)).toMatchObject({ ok: false, reason: expect.stringMatching(/15 minutes/) });
  });

  it('survive a restart: a token issued by one instance is taken by another on the same file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'confirm-')), 'confirm.db');
    const token = createConfirmTokens(Date.now, path).issue('complete_task', { id: 't1' }, ['Complete "A"']);
    expect(createConfirmTokens(Date.now, path).take(token, ['Complete "A"'])).toMatchObject({ ok: true, tool: 'complete_task' });
  });

  it('refuse a confirm that does not repeat the previewed lines, without spending the token', () => {
    const tokens = createConfirmTokens();
    const token = tokens.issue('complete_task', { id: 't1' }, ['Complete the task "A"']);
    expect(tokens.take(token, [])).toMatchObject({ ok: false, reason: expect.stringContaining('Complete the task \\"A\\"') });
    expect(tokens.take(token, ['Complete the task "A"'])).toMatchObject({ ok: true, summary: ['Complete the task "A"'] });
  });
});

describe('describeEffects', () => {
  // The replica's dayKeyOf: the local calendar day of an instant.
  const dayOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('says plainly that a deleted template is not an archive', () => {
    expect(describeEffects([
      { action: 'cleared', subject: 'template', title: 'Trip', taskId: null },
      { action: 'moved', subject: 'template', title: '3 templates', taskId: null },
    ], dayOf)).toEqual([
      'Delete the template "Trip". It cannot be restored from here.',
      'Reorder "3 templates"',
    ]);
  });

  it('says each effect in plain words, field by field for an edit', () => {
    expect(describeEffects([
      { action: 'created', subject: 'task', title: 'Pay rent', taskId: 't' },
      { action: 'edited', subject: 'task', title: 'Call the bank', taskId: 't',
        revert: { before: { title: 'Call bank', seenAt: null }, after: { title: 'Call the bank', seenAt: 'x' } } },
      { action: 'moved', subject: 'task', title: 'Taxes', taskId: 't',
        revert: { before: { dueDate: '2026-10-04T00:00:00' }, after: { dueDate: '2026-10-07T00:00:00' } } },
      { action: 'created', subject: 'project', title: 'Move', taskId: null, count: 4 },
      { action: 'created', subject: 'grocery', title: 'Oat milk', taskId: null },
      { action: 'created', subject: 'mood', title: 'Mood check-in', taskId: null },
    ], dayOf)).toEqual([
      'Create the task "Pay rent"',
      'Change "Call the bank": title from "Call bank" to "Call the bank"',
      'Move "Taxes": date from 2026-10-04 to 2026-10-07',
      'Create the project "Move" with 3 tasks',
      'Put "Oat milk" on the grocery list',
      'Record a mood check-in',
    ]);
  });
});

describe('describeEffects, field changes', () => {
  // The replica's dayKeyOf, as above: a local day, never a cut of the UTC
  // string, or the day and the clock time disagree away from Greenwich.
  const dayOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const entry = (before: Record<string, unknown>, after: Record<string, unknown>) => ({
    action: 'edited' as const, subject: 'task' as const, title: 'Pay rent', taskId: 't1', revert: { before, after },
  });

  it('names the project and blocker instead of printing their ids', () => {
    const names = { project: (id: string) => (id === 'p1' ? 'Home' : undefined), task: (id: string) => (id === 't9' ? 'Find lease' : undefined), stack: () => undefined };
    const lines = describeEffects([entry({ projectId: null, blockedByIds: [] }, { projectId: 'p1', blockedByIds: ['t9'] })], dayOf, names);
    expect(lines).toEqual(['Change "Pay rent": project from nothing to "Home"; waits on from none to "Find lease"']);
  });

  it('names fields it used to drop, and labels weekdays, priority and a reminder time', () => {
    const lines = describeEffects([entry(
      { weatherWait: null, recurrenceDays: [1], priority: 1, reminderTime: null },
      { weatherWait: 'sunny', recurrenceDays: [1, 5], priority: 3, reminderTime: new Date(2026, 9, 9, 9, 30).toISOString() },
    )], dayOf);
    expect(lines[0]).toContain('waits for weather from nothing to "sunny"');
    expect(lines[0]).toContain('repeat days from Monday to Monday, Friday');
    expect(lines[0]).toContain('priority from 1 of 4 to 3 of 4');
    expect(lines[0]).toMatch(/reminder from nothing to 2026-10-09 at \d{1,2}:30 [AP]M/);
  });

  it('appends a suffix, and counts identical lines once', () => {
    expect(describeEffects([{ ...entry({ title: 'A' }, { title: 'B' }), suffix: ' (also applies to 2 later dates)' }], dayOf))
      .toEqual(['Change "Pay rent": title from "A" to "B" (also applies to 2 later dates)']);
    const same = { action: 'cleared' as const, subject: 'task' as const, title: 'Take meds', taskId: null, note: 'Delete the 2026-09-14 entry of "Take meds"' };
    expect(describeEffects([same, same, same], dayOf)).toEqual(['Delete the 2026-09-14 entry of "Take meds" (3 times)']);
  });
});
