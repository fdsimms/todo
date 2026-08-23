#!/usr/bin/env node
// Registers the repo's own git hooks and the merge driver that .gitattributes
// asks for. Both are per-clone git config rather than checked-in state, so
// there is nowhere to commit them to — this runs from npm postinstall so a
// fresh clone picks them up with `npm install` and nobody has to know.
//
// Never fails the install. A missing or unusable git (a tarball, a Docker
// build, a CI checkout that does not need hooks) just means no hooks.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

if (git('rev-parse', '--git-dir').status !== 0) process.exit(0);

const config = [
  ['core.hooksPath', '.githooks'],
  ['merge.generated-doc.name', 'regenerate docs generated from the tree'],
  ['merge.generated-doc.driver', 'node scripts/merge-generated-doc.js %O %A %B'],
];

for (const [key, value] of config) {
  if (git('config', key, value).status !== 0) {
    console.warn(`setup-git-hooks: could not set ${key}; skipping hook setup.`);
    process.exit(0);
  }
}
