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
