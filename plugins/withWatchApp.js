const fs = require('fs');
const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { addWatchAppTarget, withExplicitTargetDependency } = require('./lib/nativeTarget');

// Injects the Apple Watch app ("TodoWatch"): a single-target SwiftUI watchOS
// app embedded in the iPhone app. The Xcode-target plumbing, and what makes a
// watch app different from an extension there, lives in
// ./lib/nativeTarget.js (addWatchAppTarget); what's here is what's specific to
// this app.
//
// This is the first step of the watch app and deliberately does nothing yet: it
// exists to prove the target builds, signs, uploads to TestFlight and installs,
// before any watch code depends on it. See docs/native-targets.md.
//
// **Off unless DUNDUNDUN_WATCH_APP is "1"**, which only eas.json's
// `watch-canary` profile sets. EAS applies a build profile's `env` both when
// EAS CLI evaluates this config locally (to resolve credentials) and on the
// builder (where prebuild runs), so one variable switches the target *and* its
// EAS declaration together, and a production build stays exactly what it was
// before this plugin existed. That's also why the declaration is added here
// rather than written into app.json: a static entry would have EAS provision a
// target the production project doesn't contain.
const TARGET_NAME = 'TodoWatch';
const BUNDLE_ID_SUFFIX = 'watchkitapp';
// watchOS 11 is the first with interactive widgets, which the complication
// will want, and runs on the same watches as watchOS 26.
const DEPLOYMENT_TARGET = '11.0';
const SOURCE_DIR = path.join(__dirname, '..', 'targets', 'todo-watch');
const SWIFT_FILES = ['TodoWatchApp.swift'];
const ASSET_CATALOG = 'Assets.xcassets';

function watchAppEnabled() {
  return process.env.DUNDUNDUN_WATCH_APP === '1';
}

// Same placeholder rule as every other target's Info.plist (see
// withWidgetExtension.js): a $(BUILD_SETTING) only gets substituted into a key
// that is actually present. Two keys are the watch's own:
// - WKApplication marks a single-target watchOS app (the legacy two-target
//   kind used WKWatchKitApp instead).
// - WKCompanionAppBundleIdentifier names the iPhone app it belongs to, and
//   must equal that app's CFBundleIdentifier.
// GENERATE_INFOPLIST_FILE is also on (see below), so anything Xcode's own
// watch template would add that isn't listed here is still generated, and
// what is listed here wins.
function watchInfoPlist(companionBundleIdentifier) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>dundundun</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>$(MARKETING_VERSION)</string>
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>WKApplication</key>
	<true/>
	<key>WKCompanionAppBundleIdentifier</key>
	<string>${companionBundleIdentifier}</string>
</dict>
</plist>
`;
}

// Nothing yet. Kept as a file (rather than no entitlements at all) because
// the shared helper always points CODE_SIGN_ENTITLEMENTS at one, and the
// watch app will want an App Group of its own once it has a complication.
function watchEntitlements() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
`;
}

// The `extra.eas.build.experimental.ios.appExtensions` entry, without which
// EAS never provisions the target and never stamps its build number (the
// upload is then refused for a CFBundleVersion that doesn't match the app's).
// Replaces an entry with the same bundle id rather than adding a second one,
// since a config can be evaluated more than once.
function withWatchAppCredentials(config, bundleIdentifier) {
  config.extra = config.extra ?? {};
  config.extra.eas = config.extra.eas ?? {};
  config.extra.eas.build = config.extra.eas.build ?? {};
  config.extra.eas.build.experimental = config.extra.eas.build.experimental ?? {};
  const experimental = config.extra.eas.build.experimental;
  experimental.ios = experimental.ios ?? {};
  const extensions = (experimental.ios.appExtensions ?? []).filter(
    ext => ext.bundleIdentifier !== bundleIdentifier
  );
  experimental.ios.appExtensions = [
    ...extensions,
    { targetName: TARGET_NAME, bundleIdentifier, entitlements: {} },
  ];
  return config;
}

const withWatchApp = config => {
  if (!watchAppEnabled()) return config;

  const companionBundleIdentifier = config.ios?.bundleIdentifier;
  const bundleIdentifier = `${companionBundleIdentifier}.${BUNDLE_ID_SUFFIX}`;
  // The watch face masks the icon to a circle, so the iPhone's square artwork
  // is cropped rather than redrawn. Good enough to prove the catalog builds.
  const iconPath = config.ios?.icon?.light ?? config.icon;

  config = withWatchAppCredentials(config, bundleIdentifier);
  config = withExplicitTargetDependency(config, TARGET_NAME);

  return withXcodeProject(config, mod => {
    const { platformProjectRoot, projectRoot } = mod.modRequest;
    addWatchAppTarget({
      project: mod.modResults,
      platformProjectRoot,
      targetName: TARGET_NAME,
      bundleIdentifier,
      deploymentTarget: DEPLOYMENT_TARGET,
      sourceFiles: SWIFT_FILES.map(name => ({ dir: SOURCE_DIR, name })),
      resourceFolders: [{ dir: SOURCE_DIR, name: ASSET_CATALOG }],
      infoPlist: watchInfoPlist(companionBundleIdentifier),
      entitlements: watchEntitlements(),
      extraBuildSettings: {
        ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
        GENERATE_INFOPLIST_FILE: 'YES',
      },
    });

    // The catalog's AppIcon.appiconset/Contents.json names `icon.png`; the
    // image itself is the app's own icon, copied in here so there's one source
    // for it. A watch app with no icon is refused at App Store validation, not
    // at build time.
    fs.copyFileSync(
      path.join(projectRoot, iconPath),
      path.join(platformProjectRoot, TARGET_NAME, ASSET_CATALOG, 'AppIcon.appiconset', 'icon.png')
    );

    return mod;
  });
};

module.exports = withWatchApp;
