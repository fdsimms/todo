#!/usr/bin/env node
// Registers the repo's own git hooks. core.hooksPath is per-clone git config
// rather than checked-in state, so there is nowhere to commit it to — this runs
// from npm postinstall so a fresh clone picks it up with `npm install` and
// nobody has to know.
//
// It used to register a `generated-doc` merge driver here too. That is gone:
// needing per-clone config was the whole problem, since GitHub runs no
// postinstall and so saw a conflict in the generated docs on every open PR.
// .gitattributes asks for `union` now, which is built into git.
//
// Never fails the install. A missing or unusable git (a tarball, a Docker
// build, a CI checkout that does not need hooks) just means no hooks.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

if (git('rev-parse', '--git-dir').status !== 0) process.exit(0);

const config = [['core.hooksPath', '.githooks']];

for (const [key, value] of config) {
  if (git('config', key, value).status !== 0) {
    console.warn(`setup-git-hooks: could not set ${key}; skipping hook setup.`);
    process.exit(0);
  }
}
