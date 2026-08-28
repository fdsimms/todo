const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { APP_GROUP_ID } = require('./withAppGroup');
const { FAMILY_CONTROLS_ENTITLEMENT } = require('./withFamilyControls');
const { addAppExtensionTarget } = require('./lib/nativeTarget');

// Injects the DeviceActivity monitor extension ("TodoActivityMonitor") — the
// process iOS wakes when one of the app's usage thresholds is crossed. The
// Xcode-target plumbing lives in ./lib/nativeTarget.js, shared with the widget
// and share extensions; what's here is what's specific to this extension point.
//
// **This target needs its own Family Controls distribution approval.** Apple
// grants that entitlement per bundle id, and a Screen Time extension is a
// separate bundle id from the app — so the request that clears the app does
// not clear this. Until both are approved the build cannot go to TestFlight.
const TARGET_NAME = 'TodoActivityMonitor';
const BUNDLE_ID_SUFFIX = 'ActivityMonitor';
// DeviceActivityMonitor's own floor is 15.0, but every API this uses either
// side of the App Group (FamilyActivitySelection encoding, the named
// ManagedSettingsStore the app writes) is 16.0, and an extension armed by a
// build that can't arm it is worse than no extension.
const DEPLOYMENT_TARGET = '16.0';
const SOURCE_DIR = path.join(__dirname, '..', 'targets', 'todo-activity-monitor');
const SWIFT_FILES = ['TodoActivityMonitor.swift'];

// Compiled into BOTH this extension and the app. The canonical copy lives with
// the bridge module, where TodoScreenTimeBridge.podspec's `**/*.swift` glob
// already compiles it into the app; it is copied in here so both processes get
// the identical file names and JSON shapes. Same arrangement — and same
// reasoning — as the ActivityKit attributes shared with the widget: two
// hand-maintained copies would drift into a threshold that silently never
// fires, with nothing at build time to catch it.
const BRIDGE_SOURCE_DIR = path.join(__dirname, '..', 'modules', 'todo-screentime-bridge', 'ios');
const SHARED_SWIFT_FILES = ['ScreenTimeShared.swift'];

const ALL_SWIFT_FILES = [
  ...SWIFT_FILES.map(name => ({ dir: SOURCE_DIR, name })),
  ...SHARED_SWIFT_FILES.map(name => ({ dir: BRIDGE_SOURCE_DIR, name })),
];

// Every key besides NSExtension is one Xcode's "New Target" template always
// includes as a $(BUILD_SETTING) placeholder. Xcode only substitutes these if
// the key is actually present in the source plist — an omitted CFBundleIdentifier
// compiles to a literal `(null)` and fails Apple's "embedded binary must be
// prefixed with the parent app's bundle identifier" validation at *submission*,
// not at build. See docs/native-targets.md.
function monitorInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>Screen Time</string>
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
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.deviceactivity.monitor-extension</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).TodoActivityMonitor</string>
	</dict>
</dict>
</plist>
`;
}

// Both entitlements: the App Group it writes crossings into, and Family
// Controls, which a Screen Time extension needs in its own right — it is a
// separate bundle id, so the app having it grants this nothing.
function monitorEntitlements() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>${FAMILY_CONTROLS_ENTITLEMENT}</key>
	<true/>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>${APP_GROUP_ID}</string>
	</array>
</dict>
</plist>
`;
}

const withActivityMonitor = config => {
  return withXcodeProject(config, mod => {
    addAppExtensionTarget({
      project: mod.modResults,
      platformProjectRoot: mod.modRequest.platformProjectRoot,
      targetName: TARGET_NAME,
      bundleIdentifier: `${config.ios?.bundleIdentifier}.${BUNDLE_ID_SUFFIX}`,
      deploymentTarget: DEPLOYMENT_TARGET,
      sourceFiles: ALL_SWIFT_FILES,
      infoPlist: monitorInfoPlist(),
      entitlements: monitorEntitlements(),
      frameworks: [
        'DeviceActivity.framework',
        // ScreenTimeShared.swift's `#if canImport(FamilyControls)` half — the
        // selection encoding. Not weak-linked the way the app-side podspec does
        // it: this target's deployment target is 16.0, above the framework's
        // own floor.
        'FamilyControls.framework',
      ],
      extraBuildSettings: {
        // NSExtensionPrincipalClass above is
        // `$(PRODUCT_MODULE_NAME).TodoActivityMonitor`, and the default for
        // PRODUCT_MODULE_NAME derives from PRODUCT_NAME through
        // `:c99extidentifier`. A principal class that fails to resolve is not a
        // build error — iOS simply never instantiates the extension, so a
        // threshold silently never fires. Pin it rather than leave the whole
        // feature riding on a string substitution nothing checks. Same call
        // withShareExtension.js makes.
        PRODUCT_MODULE_NAME: TARGET_NAME,
      },
    });

    return mod;
  });
};

module.exports = withActivityMonitor;
