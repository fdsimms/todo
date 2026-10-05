/**
 * A function called from a Reanimated worklet has to be a worklet itself.
 *
 * `useAnimatedStyle`, `useDerivedValue` and friends run their callback on the
 * UI thread. The Babel plugin turns the callback into a worklet, but not what
 * it calls: a plain function from a util file is a JS-thread function, and
 * calling it from the UI thread is a fatal error the moment the component
 * mounts. It typechecks, no Jest test ever runs a worklet, and it only
 * surfaces on a device, so it shipped once as a Rewards screen that crashed on
 * open, and again on every cold start (the app restores the last screen).
 * The fix is a `'worklet'` directive as the first statement of the callee.
 *
 * Reads the source (see `noRawModal.test.ts` for why). Checks the inline
 * callback handed to each hook for calls to a bare identifier bound outside
 * it, and resolves that binding to a function whose first statement is
 * `'worklet'`. Member calls (`Math.cos`, `x.value.toFixed`) are not checked.
 * A callback passed by name rather than written inline is skipped, so write it
 * inline or mark the function and keep its callees worklets too.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { parse } from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

const SRC = join(__dirname, '..');

/** Hooks and helpers whose function argument runs on the UI thread. */
const WORKLET_HOOKS = new Set([
  'useAnimatedStyle', 'useAnimatedProps', 'useDerivedValue', 'useAnimatedReaction',
  'useAnimatedScrollHandler', 'useFrameCallback', 'runOnUI',
]);
/** Packages whose exports are already worklet-safe. */
const SAFE_PACKAGES = new Set(['react-native-reanimated', 'react-native-worklets']);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__') sourceFiles(full, found);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

function parseFile(file: string): t.File {
  return parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
}

function hasWorkletDirective(fn: t.Function): boolean {
  return t.isBlockStatement(fn.body) && fn.body.directives.some(d => d.value.value === 'worklet');
}

function resolveModule(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The function an exported name is declared as in `file`, if it's a plain function. */
function exportedFunction(file: string, name: string): t.Function | null {
  let found: t.Function | null = null;
  traverse(parseFile(file), {
    ExportNamedDeclaration(path) {
      const d = path.node.declaration;
      if (t.isFunctionDeclaration(d) && d.id?.name === name) found = d;
      if (t.isVariableDeclaration(d)) {
        for (const v of d.declarations) {
          if (t.isIdentifier(v.id) && v.id.name === name && (t.isArrowFunctionExpression(v.init) || t.isFunctionExpression(v.init))) {
            found = v.init;
          }
        }
      }
    },
  });
  return found;
}

function violationsIn(file: string): string[] {
  const out: string[] = [];
  traverse(parseFile(file), {
    CallExpression(hook) {
      const callee = hook.node.callee;
      if (!t.isIdentifier(callee) || !WORKLET_HOOKS.has(callee.name)) return;
      for (const arg of hook.get('arguments')) {
        if (!arg.isFunction()) continue;
        const fnPath = arg as NodePath<t.Function>;
        fnPath.traverse({
          CallExpression(call) {
            const c = call.node.callee;
            if (!t.isIdentifier(c)) return;
            const binding = call.scope.getBinding(c.name);
            // A global (`Number`, `String`) or something declared inside the callback.
            if (!binding || fnPath.scope.getBinding(c.name) === binding && fnPath.isAncestor(binding.path)) return;
            const where = `${file.startsWith(SRC) ? file.slice(SRC.length + 1) : file}:${call.node.loc?.start.line} ${c.name}() called from ${callee.name}`;
            const decl = binding.path.node;
            if (t.isImportSpecifier(decl) || t.isImportDefaultSpecifier(decl)) {
              const spec = (binding.path.parent as t.ImportDeclaration).source.value;
              if (SAFE_PACKAGES.has(spec)) return;
              const target = resolveModule(file, spec);
              const imported = t.isImportSpecifier(decl) && t.isIdentifier(decl.imported) ? decl.imported.name : 'default';
              const fn = target && imported !== 'default' ? exportedFunction(target, imported) : null;
              if (!fn || !hasWorkletDirective(fn)) out.push(where);
              return;
            }
            const fn = t.isFunctionDeclaration(decl) ? decl
              : t.isVariableDeclarator(decl) && (t.isArrowFunctionExpression(decl.init) || t.isFunctionExpression(decl.init)) ? decl.init
              : null;
            // Not a function we can see (a prop, a hook result): out of scope.
            if (fn && !hasWorkletDirective(fn)) out.push(where);
          },
        });
      }
    },
  });
  return out;
}

describe('functions called from a worklet are worklets', () => {
  const files = sourceFiles(SRC).filter(f => /use(AnimatedStyle|AnimatedProps|DerivedValue|AnimatedReaction|AnimatedScrollHandler|FrameCallback)|runOnUI/.test(readFileSync(f, 'utf8')));

  it('finds the files that use worklet hooks', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no UI-thread call to a plain function', () => {
    expect(files.flatMap(violationsIn)).toEqual([]);
  });

  it('catches the Rewards crash: an unmarked util called from useAnimatedStyle', () => {
    const { mkdtempSync, writeFileSync } = require('fs') as typeof import('fs');
    const tmp = mkdtempSync(join(require('os').tmpdir(), 'worklet-'));
    writeFileSync(join(tmp, 'util.ts'), 'export function plain(x: number) { return x; }\nexport function marked(x: number) { \'worklet\'; return x; }\n');
    writeFileSync(join(tmp, 'bad.tsx'), "import { plain } from './util';\nuseAnimatedStyle(() => ({ opacity: plain(1) }));\n");
    writeFileSync(join(tmp, 'good.tsx'), "import { marked } from './util';\nuseAnimatedStyle(() => ({ opacity: marked(1) + Math.cos(0) }));\n");
    expect(violationsIn(join(tmp, 'bad.tsx'))).toHaveLength(1);
    expect(violationsIn(join(tmp, 'good.tsx'))).toEqual([]);
  });
});
