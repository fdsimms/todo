const fs = require('fs');
const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { APP_GROUP_ID } = require('./withAppGroup');
const {
  addWatchAppTarget,
  addWatchExtensionTarget,
  withExplicitTargetDependency,
} = require('./lib/nativeTarget');

// Injects the Apple Watch app ("TodoWatch", targets/todo-watch) and its
// complication ("TodoWatchComplication", targets/todo-watch-complication), the
// complication embedded in the watch app and the watch app in the iPhone app.
// The Xcode-target plumbing, and what makes a watch target different from an
// extension there, lives in ./lib/nativeTarget.js; what's here is what's
// specific to these two.
//
// Data reaches the watch over WatchConnectivity, not the App Group: the watch
// is another device. The iPhone's half of that is WatchSession.swift in
// modules/todo-widget-bridge, compiled into the app like the rest of that
// module. See docs/native-targets.md, "The watch app".
//
// **The two targets are off unless DUNDUNDUN_WATCH_APP is "1"**, which only
// eas.json's `watch-canary` profile sets, until a canary build has gone all the
// way to an install. EAS applies a build profile's `env` both when EAS CLI
// evaluates this config locally (to resolve credentials) and on the builder
// (where prebuild runs), so one variable switches the targets *and* their EAS
// declarations together. That's also why the declarations are added here
// rather than written into app.json: a static entry would have EAS provision
// targets the production project doesn't contain. The iPhone half is in every
// build, and does nothing without a paired watch that has the app installed.
const WATCH_TARGET = 'TodoWatch';
const WATCH_BUNDLE_SUFFIX = 'watchkitapp';
const COMPLICATION_TARGET = 'TodoWatchComplication';
const COMPLICATION_BUNDLE_SUFFIX = 'complication';
// watchOS 11 is the first with interactive widgets, and runs on the same
// watches as watchOS 26.
const DEPLOYMENT_TARGET = '11.0';
const WATCH_DIR = path.join(__dirname, '..', 'targets', 'todo-watch');
const COMPLICATION_DIR = path.join(__dirname, '..', 'targets', 'todo-watch-complication');
const WIDGET_DIR = path.join(__dirname, '..', 'targets', 'todo-widget');
const ASSET_CATALOG = 'Assets.xcassets';

// The widget's snapshot model, compiled into both watch targets as it is: the
// watch receives the same JSON shape (with larger caps) and keeps it under the
// same file name, so the decoder, its update-order tolerance and its
// time-passing helpers are shared rather than copied. Foundation and SwiftUI
// only, so it builds for watchOS unchanged.
const SNAPSHOT_MODEL = { dir: WIDGET_DIR, name: 'TodoWidgetData.swift' };
// The watch's own taps, read by both the app (which writes them) and the
// complication (which counts them).
const TAP_LOG = { dir: WATCH_DIR, name: 'WatchTaps.swift' };

const WATCH_SOURCES = [
  { dir: WATCH_DIR, name: 'TodoWatchApp.swift' },
  { dir: WATCH_DIR, name: 'WatchStore.swift' },
  { dir: WATCH_DIR, name: 'WatchScreens.swift' },
  TAP_LOG,
  SNAPSHOT_MODEL,
];
const COMPLICATION_SOURCES = [
  { dir: COMPLICATION_DIR, name: 'TodoWatchComplication.swift' },
  TAP_LOG,
  SNAPSHOT_MODEL,
];

function watchAppEnabled() {
  return process.env.DUNDUNDUN_WATCH_APP === '1';
}

// Same placeholder rule as every other target's Info.plist (see
// withWidgetExtension.js): a $(BUILD_SETTING) only gets substituted into a key
// that is actually present.
const BUNDLE_KEYS = `	<key>CFBundleDevelopmentRegion</key>
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
	<string>$(CURRENT_PROJECT_VERSION)</string>`;

function plist(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

// Two keys are the watch app's own:
// - WKApplication marks a single-target watchOS app (the legacy two-target
//   kind used WKWatchKitApp instead).
// - WKCompanionAppBundleIdentifier names the iPhone app it belongs to, and
//   must equal that app's CFBundleIdentifier.
// GENERATE_INFOPLIST_FILE is also on (see below), so anything Xcode's own
// watch template would add that isn't listed here is still generated, and
// what is listed here wins.
function watchInfoPlist(companionBundleIdentifier) {
  return plist(`${BUNDLE_KEYS}
	<key>WKApplication</key>
	<true/>
	<key>WKCompanionAppBundleIdentifier</key>
	<string>${companionBundleIdentifier}</string>`);
}

function complicationInfoPlist() {
  return plist(`${BUNDLE_KEYS}
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.widgetkit-extension</string>
	</dict>`);
}

// Both targets share an App Group *on the watch*: the app writes the snapshot
// and its taps there and the complication reads them. Same identifier as the
// iPhone's group, which is a separate container on a separate device.
function appGroupEntitlements() {
  return plist(`	<key>com.apple.security.application-groups</key>
	<array>
		<string>${APP_GROUP_ID}</string>
	</array>`);
}

// The `extra.eas.build.experimental.ios.appExtensions` entries, without which
// EAS never provisions the targets and never stamps their build numbers (the
// upload is then refused for a CFBundleVersion that doesn't match the app's).
// Replaces an entry with the same bundle id rather than adding a second one,
// since a config can be evaluated more than once.
function withWatchCredentials(config, entries) {
  config.extra = config.extra ?? {};
  config.extra.eas = config.extra.eas ?? {};
  config.extra.eas.build = config.extra.eas.build ?? {};
  config.extra.eas.build.experimental = config.extra.eas.build.experimental ?? {};
  const experimental = config.extra.eas.build.experimental;
  experimental.ios = experimental.ios ?? {};
  const ids = new Set(entries.map(entry => entry.bundleIdentifier));
  experimental.ios.appExtensions = [
    ...(experimental.ios.appExtensions ?? []).filter(ext => !ids.has(ext.bundleIdentifier)),
    ...entries,
  ];
  return config;
}

const withWatchApp = config => {
  if (!watchAppEnabled()) return config;

  const companionBundleIdentifier = config.ios?.bundleIdentifier;
  const watchBundleIdentifier = `${companionBundleIdentifier}.${WATCH_BUNDLE_SUFFIX}`;
  // A nested bundle's id has to start with its container's.
  const complicationBundleIdentifier = `${watchBundleIdentifier}.${COMPLICATION_BUNDLE_SUFFIX}`;
  // The watch face masks the icon to a circle, so the iPhone's square artwork
  // is cropped rather than redrawn.
  const iconPath = config.ios?.icon?.light ?? config.icon;
  const entitlements = { 'com.apple.security.application-groups': [APP_GROUP_ID] };

  config = withWatchCredentials(config, [
    { targetName: WATCH_TARGET, bundleIdentifier: watchBundleIdentifier, entitlements },
    { targetName: COMPLICATION_TARGET, bundleIdentifier: complicationBundleIdentifier, entitlements },
  ]);
  config = withExplicitTargetDependency(config, WATCH_TARGET);
  config = withExplicitTargetDependency(config, COMPLICATION_TARGET, WATCH_TARGET);

  return withXcodeProject(config, mod => {
    const { platformProjectRoot, projectRoot } = mod.modRequest;
    addWatchAppTarget({
      project: mod.modResults,
      platformProjectRoot,
      targetName: WATCH_TARGET,
      bundleIdentifier: watchBundleIdentifier,
      deploymentTarget: DEPLOYMENT_TARGET,
      sourceFiles: WATCH_SOURCES,
      resourceFolders: [{ dir: WATCH_DIR, name: ASSET_CATALOG }],
      infoPlist: watchInfoPlist(companionBundleIdentifier),
      entitlements: appGroupEntitlements(),
      extraBuildSettings: {
        ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
        GENERATE_INFOPLIST_FILE: 'YES',
      },
    });

    // After the watch app, which it is embedded in.
    addWatchExtensionTarget({
      project: mod.modResults,
      platformProjectRoot,
      targetName: COMPLICATION_TARGET,
      hostTargetName: WATCH_TARGET,
      bundleIdentifier: complicationBundleIdentifier,
      deploymentTarget: DEPLOYMENT_TARGET,
      sourceFiles: COMPLICATION_SOURCES,
      infoPlist: complicationInfoPlist(),
      entitlements: appGroupEntitlements(),
    });

    // The catalog's AppIcon.appiconset/Contents.json names `icon.png`; the
    // image itself is the app's own icon, copied in here so there's one source
    // for it. A watch app with no icon is refused at App Store validation, not
    // at build time.
    fs.copyFileSync(
      path.join(projectRoot, iconPath),
      path.join(platformProjectRoot, WATCH_TARGET, ASSET_CATALOG, 'AppIcon.appiconset', 'icon.png')
    );

    return mod;
  });
};

module.exports = withWatchApp;
