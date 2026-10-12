#!/usr/bin/env node
// EAS Build runs this on the builder before `npm install`, for every build
// (package.json's "eas-build-pre-install"), so it may use nothing but Node's
// builtins. Every iOS build embeds the Apple Watch app (plugins/withWatchApp.js),
// so it acts on every iOS build.
//
// Since Xcode 15 the watchOS platform is a separate download, and archiving an
// app that embeds a watch app fails without it ("watchOS ... is not installed.
// To use with Xcode, first download and install the platform"). EAS doesn't
// document whether its images carry it, so look for a watchOS runtime matching
// the SDK and fetch the platform only when there isn't one: a download costs
// minutes of build time, a missing platform costs the whole build.
const { execFileSync } = require('child_process');

if (process.env.EAS_BUILD_PLATFORM !== 'ios') {
  process.exit(0);
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

let sdkVersion = '';
try {
  sdkVersion = run('xcrun', ['--sdk', 'watchos', '--show-sdk-version']);
} catch {
  // No watchOS SDK at all reads the same as no platform: download it.
}

let runtimes = '';
try {
  runtimes = run('xcrun', ['simctl', 'list', 'runtimes']);
} catch {
  // Same: an unreadable list is treated as an empty one.
}

if (sdkVersion && runtimes.includes(`watchOS ${sdkVersion}`)) {
  console.log(`watchOS ${sdkVersion} platform already installed`);
} else {
  console.log(`watchOS platform for SDK "${sdkVersion || 'unknown'}" not found, downloading`);
  execFileSync('xcodebuild', ['-downloadPlatform', 'watchOS'], { stdio: 'inherit' });
}
