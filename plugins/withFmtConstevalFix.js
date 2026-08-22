const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Xcode 26.4+ ships a stricter Clang that rejects fmt 11.0.2's (bundled by
// RCT-Folly on RN 0.81) FMT_STRING(...) consteval checks as non-constant
// expressions, breaking `buildReactNativeFromSource` archives with
// "call to consteval function ... is not a constant expression" in
// fmt/format-inl.h. Fixed upstream by bumping fmt to 12.1.0, which only
// reached RN >= 0.83.9 — not available to us on 0.81.5 yet. Disabling
// FMT_USE_CONSTEVAL on the fmt pod's own target falls back to fmt's
// pre-C++20 constexpr path, which still compiles fine. See
// facebook/react-native#55601.
const withFmtConstevalFix = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      const marker = 'post_install do |installer|';
      if (!contents.includes(marker)) {
        throw new Error('withFmtConstevalFix: could not find post_install hook in Podfile');
      }
      if (!contents.includes('FMT_USE_CONSTEVAL=0')) {
        const injected = `${marker}
    installer.pods_project.targets.each do |target|
      next unless target.name == 'fmt'
      target.build_configurations.each do |bc|
        defs = bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
        defs = [defs] if defs.is_a?(String)
        bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs + ['FMT_USE_CONSTEVAL=0']
      end
    end
`;
        contents = contents.replace(marker, injected);
      }
      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
};

module.exports = withFmtConstevalFix;
