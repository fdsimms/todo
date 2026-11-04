import { NOTES_LIMIT, claudeChatUrl, projectChatPrompt, taskChatPrompt } from '../utils/askClaude';

describe('taskChatPrompt', () => {
  it('names the task and carries its id', () => {
    const p = taskChatPrompt({ id: 'abc123', title: 'Call the landlord', notes: '' });
    expect(p).toContain('my task “Call the landlord”');
    expect(p).toContain('id: abc123');
    expect(p).not.toContain('notes say');
  });

  it('includes the notes, trimmed', () => {
    const p = taskChatPrompt({ id: 'a', title: 'T', notes: '  ask about the deposit \n' });
    expect(p).toContain('Its notes say: ask about the deposit');
  });

  it('cuts long notes', () => {
    const p = taskChatPrompt({ id: 'a', title: 'T', notes: 'x'.repeat(NOTES_LIMIT + 50) });
    expect(p).toContain(`${'x'.repeat(NOTES_LIMIT)}…`);
    expect(p).not.toContain('x'.repeat(NOTES_LIMIT + 1));
  });

  it('falls back when the title is blank', () => {
    expect(taskChatPrompt({ id: 'a', title: '  ', notes: '' })).toContain('“untitled task”');
  });
});

describe('projectChatPrompt', () => {
  it('says project, not task', () => {
    const p = projectChatPrompt({ id: 'p1', title: 'Kitchen remodel', notes: '' });
    expect(p).toContain('my project “Kitchen remodel”');
    expect(p).toContain('id: p1');
  });
});

describe('claudeChatUrl', () => {
  it('encodes the prompt into the q parameter', () => {
    const prompt = 'Let’s talk about “A & B”?\n\nok';
    const url = claudeChatUrl(prompt);
    expect(url.startsWith('https://claude.ai/new?q=')).toBe(true);
    expect(decodeURIComponent(url.slice('https://claude.ai/new?q='.length))).toBe(prompt);
    expect(url).not.toMatch(/[\s&“”]/);
  });
});
