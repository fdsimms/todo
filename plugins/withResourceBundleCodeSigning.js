const { withPodfile } = require('@expo/config-plugins');

const MARKER = '# withResourceBundleCodeSigning';

// Xcode 14+ requires every target touched by a distribution archive to have
// a resolvable code-signing identity, including CocoaPods-generated
// resource bundle targets (product type "com.apple.product-type.bundle") —
// most pods never set one since bundles historically didn't need signing.
// React Native's own Podfile post_install hook
// (node_modules/react-native/scripts/cocoapods/utils.rb,
// turn_off_resource_bundle_react_core) only patches this for the
// `React-Core` pod specifically. This extends the same fix to every pod's
// resource bundle targets, since the "TodoWidget" extension target added by
// withWidgetExtension.js pulled other pods' bundle targets into the same
// signing requirement. See https://github.com/facebook/react-native/issues/34673
const withResourceBundleCodeSigning = config => {
  return withPodfile(config, mod => {
    if (mod.modResults.contents.includes(MARKER)) {
      return mod;
    }
    mod.modResults.contents += `
${MARKER}
post_install do |installer|
  installer.pods_project.targets.each do |target|
    next unless target.respond_to?(:product_type) && target.product_type == 'com.apple.product-type.bundle'
    target.build_configurations.each do |config|
      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
    end
  end
end
`;
    return mod;
  });
};

module.exports = withResourceBundleCodeSigning;
