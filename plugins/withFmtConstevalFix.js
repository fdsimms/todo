const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Xcode 26.4+ ships Apple Clang 21, which enforces C++20 consteval rules
// more strictly and rejects fmt 11.0.2's (bundled by RCT-Folly on RN 0.81)
// FMT_STRING(...) checks as non-constant expressions — breaks
// `buildReactNativeFromSource` archives with "call to consteval function
// ... is not a constant expression" in fmt/format-inl.h. Fixed upstream by
// bumping fmt to 12.1.0, which only reached RN >= 0.83.9 — not available to
// us on 0.81.5 yet.
//
// fmt/include/fmt/base.h hardcodes `#define FMT_USE_CONSTEVAL 1` with no
// `#ifndef` guard, so a compiler -D flag can't override it (tried that
// first — it silently did nothing, since the header just redefines it back
// to 1 regardless). `pod install` vendors fmt's real source into Pods/fmt
// before post_install runs, so the hook rewrites that line in the actual
// header in place, falling back to fmt's runtime format-string validation.
// Behavior is identical — this only changes when the check happens. See
// facebook/react-native#55601.
const MARKER = 'withFmtConstevalFix';

const withFmtConstevalFix = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      const match = contents.match(/post_install do \|(\w+)\|/);
      if (!match) {
        throw new Error(`${MARKER}: could not find post_install hook in Podfile`);
      }
      if (!contents.includes(MARKER)) {
        const installerVar = match[1];
        const injected = `${match[0]}
    # ${MARKER}: fmt 11.0.2 fails to compile under Apple Clang 21 (Xcode
    # 26.4+) because FMT_STRING relies on consteval. Force
    # FMT_USE_CONSTEVAL to 0 in the vendored header so fmt falls back to
    # runtime format-string checks. Safe to remove once on React Native
    # >= 0.83.9 (fmt 12.1.0).
    fmt_base_header = File.join(${installerVar}.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base_header)
      original = File.read(fmt_base_header)
      patched = original.gsub(/^(#\\s*define\\s+FMT_USE_CONSTEVAL)\\s+1\\s*$/, '\\1 0')
      File.write(fmt_base_header, patched) if patched != original
    end
`;
        contents = contents.replace(match[0], injected);
      }
      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
};

module.exports = withFmtConstevalFix;
