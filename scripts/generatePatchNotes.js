// Regenerates src/generated/patchNotes.json from git history so the
// Settings screen's "What's New" popup can show recent changes without
// a backend. Runs automatically from metro.config.js on every `expo
// start` / `expo export`, and explicitly in CI before `eas build` (see
// .github/workflows/eas-build.yml) so production builds ship real data.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const COUNT = 4;
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'generated', 'patchNotes.json');
const REPO_ROOT = path.join(__dirname, '..');
const FIELD_SEP = '\x1f';

function generatePatchNotes() {
  let output;
  try {
    output = execSync(
      `git log --no-merges -n ${COUNT} --pretty=format:%s${FIELD_SEP}%ad --date=short`,
      { encoding: 'utf8', cwd: REPO_ROOT }
    );
  } catch {
    // No git history available (e.g. a shallow archive without .git) —
    // leave whatever is already on disk in place.
    return;
  }

  const notes = output
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [message, date] = line.split(FIELD_SEP);
      return { message, date };
    });

  if (notes.length === 0) return;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(notes, null, 2) + '\n');
}

if (require.main === module) {
  generatePatchNotes();
}

module.exports = generatePatchNotes;
