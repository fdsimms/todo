import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { annotationsFor, READ_TOOLS, WRITE_TOOLS } from '../toolAnnotations';

/**
 * server.ts cannot run under jest (it imports the SDK), so the tool names are
 * read out of its source instead. Crude, and enough: a new tool that is not in
 * the table would otherwise ship claiming nothing, which for a read means a
 * permission prompt on every call.
 */
function registeredToolNames(): string[] {
  const source = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');
  return [...source.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map(m => m[1]);
}

describe('tool annotations', () => {
  it('classify every tool the server registers, each exactly once', () => {
    const names = registeredToolNames();
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      const inRead = name in READ_TOOLS;
      const inWrite = name in WRITE_TOOLS;
      expect({ name, classified: inRead !== inWrite }).toEqual({ name, classified: true });
    }
  });

  it('mark reads read-only and writes not, and claim nothing for a name they do not know', () => {
    expect(annotationsFor('list_tasks')).toEqual({ title: 'List tasks', readOnlyHint: true, openWorldHint: false });
    expect(annotationsFor('update_task')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(annotationsFor('something_new')).toEqual({});
  });
});
