import { createConfirmTokens, describeEffects, requestHash, CONFIRM_TTL_MS } from '../confirmWrites';

describe('confirm tokens', () => {
  it('confirm exactly the request that was previewed, once', () => {
    const tokens = createConfirmTokens();
    const token = tokens.issue('update_task', { id: 't1', title: 'A', tags: ['x'] }, ['Change "A"']);
    // Key order is not part of the request.
    expect(tokens.redeem(token, 'update_task', { tags: ['x'], title: 'A', id: 't1' })).toEqual({ ok: true, summary: ['Change "A"'] });
    expect(tokens.redeem(token, 'update_task', { id: 't1', title: 'A', tags: ['x'] })).toMatchObject({ ok: false, reason: expect.stringMatching(/already used/) });
  });

  it('refuse a changed request, another tool, and an expired preview', () => {
    let now = 0;
    const tokens = createConfirmTokens(() => now);
    const a = tokens.issue('complete_task', { id: 't1' }, []);
    expect(tokens.redeem(a, 'complete_task', { id: 't2' })).toMatchObject({ ok: false, reason: expect.stringMatching(/different request/) });
    const b = tokens.issue('complete_task', { id: 't1' }, []);
    expect(tokens.redeem(b, 'defer_task', { id: 't1' })).toMatchObject({ ok: false });
    const c = tokens.issue('complete_task', { id: 't1' }, []);
    now = CONFIRM_TTL_MS + 1;
    expect(tokens.redeem(c, 'complete_task', { id: 't1' })).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) });
  });

  it('refuse a confirm that does not repeat the previewed lines, without spending the token', () => {
    const tokens = createConfirmTokens();
    const token = tokens.issue('complete_task', { id: 't1' }, ['Complete the task "A"']);
    expect(tokens.redeem(token, 'complete_task', { id: 't1' }, [])).toMatchObject({ ok: false, reason: expect.stringContaining('Complete the task \\"A\\"') });
    expect(tokens.redeem(token, 'complete_task', { id: 't1' }, ['Complete the task "A"'])).toEqual({ ok: true, summary: ['Complete the task "A"'] });
  });

  it('hash nested arguments independent of key order', () => {
    expect(requestHash('x', { a: { b: 1, c: 2 } })).toBe(requestHash('x', { a: { c: 2, b: 1 } }));
    expect(requestHash('x', { a: [1, 2] })).not.toBe(requestHash('x', { a: [2, 1] }));
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
  // A local day key, as the replica's own dayOf is: slicing the ISO string is a
  // UTC date, which is a day off far from Greenwich.
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
    expect(lines[0]).toMatch(/reminder from nothing to 2026-10-09 at 9:30 AM/);
  });

  it('appends a suffix, and counts identical lines once', () => {
    expect(describeEffects([{ ...entry({ title: 'A' }, { title: 'B' }), suffix: ' (also applies to 2 later dates)' }], dayOf))
      .toEqual(['Change "Pay rent": title from "A" to "B" (also applies to 2 later dates)']);
    const same = { action: 'cleared' as const, subject: 'task' as const, title: 'Take meds', taskId: null, note: 'Delete the 2026-09-14 entry of "Take meds"' };
    expect(describeEffects([same, same, same], dayOf)).toEqual(['Delete the 2026-09-14 entry of "Take meds" (3 times)']);
  });
});
