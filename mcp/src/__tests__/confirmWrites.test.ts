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

  it('hash nested arguments independent of key order', () => {
    expect(requestHash('x', { a: { b: 1, c: 2 } })).toBe(requestHash('x', { a: { c: 2, b: 1 } }));
    expect(requestHash('x', { a: [1, 2] })).not.toBe(requestHash('x', { a: [2, 1] }));
  });
});

describe('describeEffects', () => {
  it('says each effect in plain words, field by field for an edit', () => {
    expect(describeEffects([
      { action: 'created', subject: 'task', title: 'Pay rent', taskId: 't' },
      { action: 'edited', subject: 'task', title: 'Call the bank', taskId: 't',
        revert: { before: { title: 'Call bank', seenAt: null }, after: { title: 'Call the bank', seenAt: 'x' } } },
      { action: 'moved', subject: 'task', title: 'Taxes', taskId: 't',
        revert: { before: { dueDate: '2026-10-04T04:00:00.000Z' }, after: { dueDate: '2026-10-07T04:00:00.000Z' } } },
      { action: 'created', subject: 'project', title: 'Move', taskId: null, count: 4 },
      { action: 'created', subject: 'grocery', title: 'Oat milk', taskId: null },
      { action: 'created', subject: 'mood', title: 'Mood check-in', taskId: null },
    ])).toEqual([
      'Create the task "Pay rent"',
      'Change "Call the bank": title from "Call bank" to "Call the bank"',
      'Move "Taxes": date from 2026-10-04 to 2026-10-07',
      'Create the project "Move" with 3 tasks',
      'Put "Oat milk" on the grocery list',
      'Record a mood check-in',
    ]);
  });
});
