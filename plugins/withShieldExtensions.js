const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { APP_GROUP_ID } = require('./withAppGroup');
const { FAMILY_CONTROLS_ENTITLEMENT } = require('./withFamilyControls');
const { addAppExtensionTarget } = require('./lib/nativeTarget');

// Injects the two extensions behind the screen somebody sees when they open a
// blocked app: one that draws it and one that answers its button. The
// Xcode-target plumbing lives in ./lib/nativeTarget.js, shared with the widget,
// the share extension and the activity monitor.
//
// **Two targets for one screen, and it cannot be one.** A
// ShieldConfigurationDataSource is never told about a tap — ShieldAction only
// ever reaches a ShieldActionDelegate — and the two sit at different extension
// points, in different frameworks (note the identifiers below differ by exactly
// the "UI" suffix, which is the easiest typo here to make and the hardest to
// notice: a wrong one is not a build error, it is an extension iOS never
// instantiates).
//
// **Each needs its own Family Controls distribution approval.** Apple grants
// that entitlement per bundle id, so the app's approval covers neither of
// these, the same way it did not cover the activity monitor. Until all of them
// are approved the build cannot go to TestFlight — see withActivityMonitor.js,
// which learned this first.
const CONFIG_TARGET_NAME = 'TodoShieldConfig';
const CONFIG_BUNDLE_ID_SUFFIX = 'ShieldConfig';
const ACTION_TARGET_NAME = 'TodoShieldAction';
const ACTION_BUNDLE_ID_SUFFIX = 'ShieldAction';

// Matching the activity monitor rather than the frameworks' own 15.0 floor:
// these read state written by the app beside a named ManagedSettingsStore, all
// of which is 16.0. A build that draws a shield it cannot explain is worse than
// one that leaves the system's own shield in place.
const DEPLOYMENT_TARGET = '16.0';

const CONFIG_SOURCE_DIR = path.join(__dirname, '..', 'targets', 'todo-shield-config');
const ACTION_SOURCE_DIR = path.join(__dirname, '..', 'targets', 'todo-shield-action');

// Compiled into the configuration extension as well as the app and the monitor,
// for the reason withActivityMonitor.js gives: the processes have to agree on a
// file name and a JSON shape exactly, and hand-maintained copies drift into a
// screen that silently explains nothing. The action extension deliberately gets
// no copy — it reads no shared state, because its answer is the same whatever
// the shield is for.
const BRIDGE_SOURCE_DIR = path.join(__dirname, '..', 'modules', 'todo-screentime-bridge', 'ios');

const CONFIG_SWIFT_FILES = [
  { dir: CONFIG_SOURCE_DIR, name: 'ShieldConfigurationExtension.swift' },
  { dir: BRIDGE_SOURCE_DIR, name: 'ScreenTimeShared.swift' },
];
const ACTION_SWIFT_FILES = [
  { dir: ACTION_SOURCE_DIR, name: 'ShieldActionExtension.swift' },
];

// Every key besides NSExtension is one Xcode's "New Target" template always
// includes as a $(BUILD_SETTING) placeholder — an omitted CFBundleIdentifier
// compiles to a literal `(null)` and fails Apple's "embedded binary must be
// prefixed with the parent app's bundle identifier" validation at *submission*,
// not at build. See docs/native-targets.md.
function shieldInfoPlist({ displayName, pointIdentifier, principalClass }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>${displayName}</string>
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
		<string>${pointIdentifier}</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).${principalClass}</string>
	</dict>
</dict>
</plist>
`;
}

// Family Controls for both — a Screen Time extension needs it in its own right.
// The App Group only for the configuration extension, which is the one that
// reads shared state; the action extension reads none, and an entitlement a
// target does not use is one more thing for provisioning to disagree about.
function shieldEntitlements({ appGroup }) {
  const groupBlock = appGroup
    ? `	<key>com.apple.security.application-groups</key>
	<array>
		<string>${APP_GROUP_ID}</string>
	</array>
`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>${FAMILY_CONTROLS_ENTITLEMENT}</key>
	<true/>
${groupBlock}</dict>
</plist>
`;
}

const withShieldExtensions = config => {
  return withXcodeProject(config, mod => {
    addAppExtensionTarget({
      project: mod.modResults,
      platformProjectRoot: mod.modRequest.platformProjectRoot,
      targetName: CONFIG_TARGET_NAME,
      bundleIdentifier: `${config.ios?.bundleIdentifier}.${CONFIG_BUNDLE_ID_SUFFIX}`,
      deploymentTarget: DEPLOYMENT_TARGET,
      sourceFiles: CONFIG_SWIFT_FILES,
      infoPlist: shieldInfoPlist({
        displayName: 'Shield',
        pointIdentifier: 'com.apple.ManagedSettingsUI.shield-configuration-service',
        principalClass: 'ShieldConfigurationExtension',
      }),
      entitlements: shieldEntitlements({ appGroup: true }),
      frameworks: [
        'ManagedSettings.framework',
        'ManagedSettingsUI.framework',
        // ScreenTimeShared.swift's `#if canImport(FamilyControls)` half. The
        // check is about the module existing in the SDK rather than being
        // linked, so that branch compiles here whether or not this target ever
        // decodes a selection — and then fails to link without this.
        'FamilyControls.framework',
      ],
      extraBuildSettings: {
        // The principal class above is `$(PRODUCT_MODULE_NAME).<class>`, and
        // the default for PRODUCT_MODULE_NAME derives from PRODUCT_NAME through
        // `:c99extidentifier`. A principal class that fails to resolve is not a
        // build error — iOS simply never instantiates the extension, so the
        // system's own blank shield is shown instead and nothing says why.
        // Same call withActivityMonitor.js and withShareExtension.js make.
        PRODUCT_MODULE_NAME: CONFIG_TARGET_NAME,
      },
    });

    addAppExtensionTarget({
      project: mod.modResults,
      platformProjectRoot: mod.modRequest.platformProjectRoot,
      targetName: ACTION_TARGET_NAME,
      bundleIdentifier: `${config.ios?.bundleIdentifier}.${ACTION_BUNDLE_ID_SUFFIX}`,
      deploymentTarget: DEPLOYMENT_TARGET,
      sourceFiles: ACTION_SWIFT_FILES,
      infoPlist: shieldInfoPlist({
        displayName: 'Shield Action',
        pointIdentifier: 'com.apple.ManagedSettings.shield-action-service',
        principalClass: 'ShieldActionExtension',
      }),
      entitlements: shieldEntitlements({ appGroup: false }),
      frameworks: ['ManagedSettings.framework'],
      extraBuildSettings: {
        PRODUCT_MODULE_NAME: ACTION_TARGET_NAME,
      },
    });

    return mod;
  });
};

module.exports = withShieldExtensions;
