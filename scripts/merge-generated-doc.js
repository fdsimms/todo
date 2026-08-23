#!/usr/bin/env node
// Merge driver for the two docs that are generated from the tree and committed
// (docs/module-map.md, and the repo-stats block inside CLAUDE.md).
//
// It exists because a textual merge of two individually correct generations is
// not itself a correct generation, and it fails *silently*. docs/module-map.md
// is one line per module, so git merges it cleanly and nobody is prompted to
// regenerate: `git status` stays clean, since the file is committed and
// unchanged. What lands is a file no run of the generator could produce —
// `src/utils/focusWindow.ts` above `src/utils/focusSuggest.ts` when the
// generator sorts them the other way, `db/database.ts` claiming `+122 more`
// against an actual `+125` because a `+N` counter is a per-line summary and a
// merge picks one side's number rather than recounting. main then carries the
// drift, and every branch cut from it fails a check it did not cause.
//
// So the generated content is never merged at all. This driver blanks it out
// on all three sides, merges what is left (nothing, for module-map; the
// hand-written prose, for CLAUDE.md), and puts our side back as a placeholder.
// The placeholder is not meant to be correct — .githooks/post-merge reruns both
// generators immediately afterwards, which is what makes it correct. Conflicts
// in the prose around a generated block are still real conflicts and still
// stop the merge.
const fs = require('fs');
const { spawnSync } = require('child_process');

const [ancestor, ours, theirs] = process.argv.slice(2);

// Where the generated content lives in each file. A file with no markers is
// generated end to end.
const REGIONS = [
  { file: 'CLAUDE.md', begin: '<!-- BEGIN GENERATED: repo-stats -->', end: '<!-- END GENERATED: repo-stats -->' },
];

const read = f => fs.readFileSync(f, 'utf8');

// Replace the generated span with a single stable line, so the two sides are
// textually identical there and git has nothing to merge.
const PLACEHOLDER = '<<<GENERATED CONTENT — REGENERATED AFTER MERGE>>>';

function regionOf(text) {
  for (const r of REGIONS) {
    const start = text.indexOf(r.begin);
    const end = text.indexOf(r.end);
    if (start !== -1 && end !== -1 && end > start) return { start, end: end + r.end.length };
  }
  return null;
}

function blank(text) {
  const region = regionOf(text);
  if (!region) return PLACEHOLDER;
  return text.slice(0, region.start) + PLACEHOLDER + text.slice(region.end);
}

function restore(merged, originalOurs) {
  const region = regionOf(originalOurs);
  const kept = region ? originalOurs.slice(region.start, region.end) : originalOurs;
  return merged.split(PLACEHOLDER).join(kept);
}

const originalOurs = read(ours);

const tmp = [ancestor, ours, theirs].map((f, i) => {
  const p = `${ours}.generated-doc.${i}`;
  fs.writeFileSync(p, blank(read(f)));
  return p;
});

// -p writes the merge to stdout; a non-zero status means real conflicts, which
// can only be in the prose now.
const res = spawnSync('git', ['merge-file', '-p', '-L', 'ours', '-L', 'base', '-L', 'theirs', ...tmp], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
for (const p of tmp) fs.unlinkSync(p);

if (res.error || res.status === null || res.status < 0) {
  // Could not run the merge at all. Leave our side in place and report a
  // conflict rather than inventing a resolution.
  console.error(`merge-generated-doc: git merge-file failed: ${res.error || res.signal}`);
  process.exit(1);
}

fs.writeFileSync(ours, restore(res.stdout, originalOurs));
process.exit(res.status > 0 ? 1 : 0);
