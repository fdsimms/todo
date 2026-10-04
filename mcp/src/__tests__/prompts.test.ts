import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMPTS } from '../prompts';

/** Tool names server.ts registers, read from its source (it cannot run under jest). */
function registeredToolNames(): Set<string> {
  const source = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');
  return new Set([...source.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map(m => m[1]));
}

describe('prompts', () => {
  const tools = registeredToolNames();

  it('name only tools the server registers', () => {
    for (const prompt of PROMPTS) {
      const text = prompt.text({ busy: '10-11 standup', project: 'Garage', question: 'pin a task' });
      const named = [...text.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map(m => m[1]);
      for (const name of named) {
        expect({ prompt: prompt.name, tool: name, registered: tools.has(name) }).toEqual({ prompt: prompt.name, tool: name, registered: true });
      }
    }
  });

  it('have unique names, and fill in their arguments', () => {
    expect(new Set(PROMPTS.map(p => p.name)).size).toBe(PROMPTS.length);
    const day = PROMPTS.find(p => p.name === 'plan_my_day')!;
    expect(day.text({ busy: '2-3 dentist' })).toMatch(/2-3 dentist/);
    expect(day.text({})).toMatch(/Ask me what meetings/);
  });
});
