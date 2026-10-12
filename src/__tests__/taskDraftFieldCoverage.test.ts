/**
 * `newTaskFromDraft` builds a task field by field rather than spreading the
 * draft, so a field added to `Task` and not written there is silently dropped
 * on every create that goes through it: the editor's new task, quick add,
 * templates and the MCP server's create all do. It compiles, because the
 * fields are optional, and every test that sets the field with `updateTask`
 * after creating the task still passes.
 *
 * So every `Task` field is either named in `newTaskFromDraft` or listed below
 * with the reason it isn't. Adding a field to `Task` fails this suite until
 * you make that call. (`templateItemParity.test.ts` is the same check for
 * templates, and `mcp/src/__tests__/taskFieldCoverage.test.ts` for Claude.)
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

const NOT_NAMED: Record<string, string[]> = {
  // The calendar server's ids for events a reconcile writes. A fresh row has
  // no event yet, and one copied off a draft would point at another task's,
  // the rule the device ids beside them state where they are set to null.
  'set by the calendar reconcile, never by a draft': [
    'calendarEventExternalId', 'completionCalendarEventExternalId', 'timeBlockExternalId',
  ],
};

const ALL_NOT_NAMED = Object.values(NOT_NAMED).flat();

function taskFields(): string[] {
  const src = readFileSync(join(ROOT, 'src', 'types', 'index.ts'), 'utf8');
  const start = src.indexOf('export interface Task {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  return body.split('\n').flatMap(line => {
    const m = line.match(/^ {2}([A-Za-z_]\w*)\??:/);
    return m ? [m[1]] : [];
  });
}

function newTaskFromDraftSource(): string {
  const src = readFileSync(join(ROOT, 'src', 'utils', 'taskDraft.ts'), 'utf8');
  const start = src.indexOf('export function newTaskFromDraft(');
  const rest = src.slice(start);
  return rest.slice(0, rest.search(/\n}\n/));
}

const named = (source: string, field: string) => new RegExp(`\\b${field}\\b`).test(source);

describe('Task fields and newTaskFromDraft', () => {
  const fields = taskFields();
  const source = newTaskFromDraftSource();

  it('finds the interface and the function', () => {
    // A parse that quietly found nothing would pass everything below.
    expect(fields.length).toBeGreaterThan(100);
    expect(source).toContain('dueDate');
  });

  it('has a decision for every field', () => {
    expect(fields.filter(f => !named(source, f) && !ALL_NOT_NAMED.includes(f))).toEqual([]);
  });

  it('keeps the list honest', () => {
    const gone = ALL_NOT_NAMED.filter(f => !fields.includes(f));
    const nowNamed = ALL_NOT_NAMED.filter(f => named(source, f));
    const twice = ALL_NOT_NAMED.filter((f, i) => ALL_NOT_NAMED.indexOf(f) !== i);
    expect({ gone, nowNamed, twice }).toEqual({ gone: [], nowNamed: [], twice: [] });
  });
});
