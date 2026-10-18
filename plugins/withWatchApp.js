const fs = require('fs');
const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { APP_GROUP_ID } = require('./withAppGroup');
const { HEALTHKIT_ENTITLEMENT } = require('./withHealthKit');
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
// The two targets' EAS declarations are in app.json's `appExtensions`, with every
// other target's, and must match the bundle ids and entitlements built here: nothing
// checks that the two agree (see docs/native-targets.md).
const WATCH_TARGET = 'TodoWatch';
const WATCH_BUNDLE_SUFFIX = 'watchkitapp';
const COMPLICATION_TARGET = 'TodoWatchComplication';
const COMPLICATION_BUNDLE_SUFFIX = 'widgets';
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
  // The workout (phase 8): its model and actions, and its screens. The app's
  // alone: the complication shows no workout, and the snapshot's workout
  // section is decoded here rather than in the shared model, so the iPhone
  // widget never carries it.
  { dir: WATCH_DIR, name: 'WatchWorkout.swift' },
  { dir: WATCH_DIR, name: 'WatchWorkoutScreens.swift' },
  // The workout's HealthKit session (phase 9): heart rate, measured energy,
  // the app kept in front, and the workout saved to Health from the watch.
  { dir: WATCH_DIR, name: 'WatchHealthSession.swift' },
  TAP_LOG,
  SNAPSHOT_MODEL,
];
const COMPLICATION_SOURCES = [
  { dir: COMPLICATION_DIR, name: 'TodoWatchComplication.swift' },
  TAP_LOG,
  SNAPSHOT_MODEL,
];

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
// And three for its HealthKit workout session (phase 9; docs/native-targets.md,
// "The watch app"):
// - NSHealthShareUsageDescription and NSHealthUpdateUsageDescription: on
//   watchOS 6 and later the watch app asks for Health access on the wrist
//   itself, so it needs its own strings, saying what the watch reads and saves
//   (the phone's are in app.json and say what the phone does). Both keys'
//   pages: https://developer.apple.com/tutorials/data/documentation/bundleresources/information-property-list/nshealthshareusagedescription.json
//   and …/nshealthupdateusagedescription.json.
// - WKBackgroundModes with workout-processing, which a workout session needs
//   to keep running, and the app with it, with the wrist down (…/wkbackgroundmodes.json).
// GENERATE_INFOPLIST_FILE is also on (see below), so anything Xcode's own
// watch template would add that isn't listed here is still generated, and
// what is listed here wins.
const WATCH_HEALTH_SHARE_USAGE =
  'dundundun reads your heart rate and active energy while your watch runs a workout, to show your heart rate on the watch. Nothing is sent anywhere.';
const WATCH_HEALTH_UPDATE_USAGE =
  'dundundun saves a strength workout your watch measured to Health, with its heart rate and active energy, when you’ve chosen to save workouts to Apple Health. Deleting the workout in dundundun removes it and its energy.';

function watchInfoPlist(companionBundleIdentifier) {
  return plist(`${BUNDLE_KEYS}
	<key>WKApplication</key>
	<true/>
	<key>WKCompanionAppBundleIdentifier</key>
	<string>${companionBundleIdentifier}</string>
	<key>NSHealthShareUsageDescription</key>
	<string>${WATCH_HEALTH_SHARE_USAGE}</string>
	<key>NSHealthUpdateUsageDescription</key>
	<string>${WATCH_HEALTH_UPDATE_USAGE}</string>
	<key>WKBackgroundModes</key>
	<array>
		<string>workout-processing</string>
	</array>`);
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

// The watch app's: the App Group, and HealthKit for its workout session
// (phase 9). The entitlement's page lists no watchOS
// (https://developer.apple.com/tutorials/data/documentation/bundleresources/entitlements/com.apple.developer.healthkit.json),
// but Apple's workout-session guide has the capability added to the watch
// target, which is what Xcode's HealthKit capability writes there. The
// complication reads no Health, so it keeps the App Group alone. app.json's
// `appExtensions` entry for TodoWatch names it too, or EAS provisions the
// watch app without it (docs/native-targets.md).
function watchAppEntitlements() {
  return plist(`	<key>com.apple.security.application-groups</key>
	<array>
		<string>${APP_GROUP_ID}</string>
	</array>
	<key>${HEALTHKIT_ENTITLEMENT}</key>
	<true/>`);
}

const withWatchApp = config => {
  const companionBundleIdentifier = config.ios?.bundleIdentifier;
  const watchBundleIdentifier = `${companionBundleIdentifier}.${WATCH_BUNDLE_SUFFIX}`;
  // A nested bundle's id has to start with its container's.
  const complicationBundleIdentifier = `${watchBundleIdentifier}.${COMPLICATION_BUNDLE_SUFFIX}`;
  // The watch face masks the icon to a circle, so the iPhone's square artwork
  // is cropped rather than redrawn.
  const iconPath = config.ios?.icon?.light ?? config.icon;

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
      entitlements: watchAppEntitlements(),
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
