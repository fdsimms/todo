/**
 * Every `TemplateItem` field is either one `create_template` / `update_template`
 * can set, or is named here as deliberately not exposed, with the reason.
 *
 * Same shape and same reason as `taskFieldCoverage.test.ts`: `TemplateItem`
 * mirrors a large slice of `Task`, nothing enforces the parity, and the zod
 * item schema in `server.ts` is a hand-kept subset. A field added to the type
 * alone compiles, passes every test and ships a setting no template written
 * through Claude can carry. It was about 20 fields behind when this was added.
 *
 * Handled means the name appears in the `itemSchema` block of `server.ts`.
 * Adding a field fails this suite until you expose it there (and in
 * `templatePlan.ts` if it needs a range or enum check) or list it below under
 * the group that is true.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

const NOT_EXPOSED: Record<string, string[]> = {
  // Pointers between the parts of a template. A plan names them instead (an
  // item's groupKey, onlyIfAnswer and waitsOn by item key, refTemplate), and the applier
  // resolves those to these ids. `id` and `conditions` are in the schema, as
  // an update-only handle and as conditions written by question name.
  'references a plan writes by name': ['groupId', 'answerGate', 'refTemplateId', 'refTemplateName', 'blockedByItemIds'],

  // Blocking apps, charging a penalty and writing a dose are read-only over MCP
  // on a task, and a template would be a way round that (docs/arch/mcp-server.md,
  // "Gates, penalties and a task's medication are read-only"). The completion
  // timer and meal slot are device-side behavior with no MCP use yet.
  'withheld on purpose, as they are on a task': [
    'gatesApps', 'penaltyMinutes', 'penaltyCutoffTime', 'medicationName', 'medicationAmount', 'medicationUnit',
    'completionTimerMinutes', 'completionTimerNote', 'logMealSlot',
  ],

  // Written as `chain` and `rotation` in a plan, which the applier turns into
  // these (step and member ids are kept by position and title on an edit).
  // The chain's position is runtime state: a template always starts at step one.
  'written as a nested plan field': ['chainEnabled', 'chainItems', 'chainIndex', 'rotationEnabled', 'rotationItems'],
};

const ALL_NOT_EXPOSED = Object.values(NOT_EXPOSED).flat();

function between(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  return src.slice(start, src.indexOf(endMarker, start));
}

function templateItemFields(): string[] {
  const src = readFileSync(join(ROOT, 'src', 'types', 'index.ts'), 'utf8');
  const body = between(src, 'export interface TemplateItem {', '\n}\n');
  return body.split('\n').flatMap(line => {
    const m = line.match(/^ {2}([A-Za-z_]\w*)\??:/);
    return m ? [m[1]] : [];
  });
}

const schema = between(
  readFileSync(join(ROOT, 'mcp', 'src', 'server.ts'), 'utf8'),
  'const itemSchema = z.object({',
  '\n});\n'
);
const mentioned = (field: string) => new RegExp(`^ {2}${field}:`, 'm').test(schema);

describe('TemplateItem fields and the template tools', () => {
  const fields = templateItemFields();

  it('finds the TemplateItem interface and the item schema', () => {
    expect(fields.length).toBeGreaterThan(40);
    expect(fields).toContain('dueOffsetDays');
    expect(schema).toContain('title:');
  });

  it('has a decision for every field', () => {
    expect(fields.filter(f => !mentioned(f) && !ALL_NOT_EXPOSED.includes(f))).toEqual([]);
  });

  it('lists no field twice', () => {
    expect(ALL_NOT_EXPOSED.filter((f, i) => ALL_NOT_EXPOSED.indexOf(f) !== i)).toEqual([]);
  });

  it('keeps the not-exposed list honest', () => {
    const gone = ALL_NOT_EXPOSED.filter(f => !fields.includes(f));
    const nowExposed = ALL_NOT_EXPOSED.filter(mentioned);
    expect({ gone, nowExposed }).toEqual({ gone: [], nowExposed: [] });
  });
});
