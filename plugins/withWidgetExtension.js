const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { APP_GROUP_ID } = require('./withAppGroup');
const { addAppExtensionTarget } = require('./lib/nativeTarget');

// Injects a WidgetKit extension target ("TodoWidget") into the generated
// Xcode project at prebuild time, without ejecting to a checked-in `ios/`
// folder. The Xcode-target plumbing itself — and every workaround it needs —
// lives in ./lib/nativeTarget.js, shared with withShareExtension.js; what's
// here is what's specific to being a widget.
const TARGET_NAME = 'TodoWidget';
const BUNDLE_ID_SUFFIX = 'TodoWidget';
// Widget extensions may target a higher minimum iOS than their host app —
// .containerBackground(for:) in TodoTodayWidget.swift requires iOS 17.
const DEPLOYMENT_TARGET = '17.0';
const SOURCE_DIR = path.join(__dirname, '..', 'targets', 'todo-widget');
const SWIFT_FILES = [
  'TodoWidgetBundle.swift',
  'TodoWidgetData.swift',
  'WidgetShared.swift',
  'WidgetConfigIntents.swift',
  'TodoTodayWidget.swift',
  'TodoGroceryWidget.swift',
  'TodoKitchenWidget.swift',
  'TimerLiveActivity.swift',
  'TripLiveActivity.swift',
  'FocusLiveActivity.swift',
];
// Files that must compile into BOTH this extension and the app. The
// canonical copy lives with the bridge module, where TodoWidgetBridge.podspec's
// `**/*.{h,m,swift}` glob already compiles it into the app; it's copied in
// here so both processes get the identical declaration.
//
// Two unrelated reasons land a file in this list:
//
// - The three ActivityAttributes files: ActivityKit pairs an Activity started
//   by the app with the ActivityConfiguration that renders it by the attributes
//   type's *name* and a Codable round-trip of its properties, so any drift
//   between two hand-maintained copies would show up only as a Live Activity
//   that starts and then never appears. One file, copied.
// - CompleteTaskIntent: an AppIntent that brings the app to the foreground has
//   to be compiled into the app target, because a widget extension can only run
//   intents in the background (see docs/native-targets.md). It still has to
//   compile here too, since TodoTodayWidget.swift's `Button(intent:)` names the
//   type. Extension-only is what silently broke the widget checkbox.
const BRIDGE_SOURCE_DIR = path.join(__dirname, '..', 'modules', 'todo-widget-bridge', 'ios');
const SHARED_SWIFT_FILES = [
  'TimerActivityAttributes.swift',
  'TripActivityAttributes.swift',
  'FocusActivityAttributes.swift',
  'CompleteTaskIntent.swift',
];

const ALL_SWIFT_FILES = [
  ...SWIFT_FILES.map(name => ({ dir: SOURCE_DIR, name })),
  ...SHARED_SWIFT_FILES.map(name => ({ dir: BRIDGE_SOURCE_DIR, name })),
];

// Every key here besides NSExtension/CFBundleDisplayName is one Xcode's own
// "New Target" template always includes as a $(BUILD_SETTING) placeholder —
// Xcode only substitutes these during Info.plist processing if the key is
// actually present in the source file; it does not inject any of them into
// a compiled Info.plist that omits the key entirely (confirmed the hard way:
// omitting CFBundleIdentifier produced a compiled .appex with a `(null)`
// bundle identifier, failing Apple's "embedded binary must be prefixed with
// the parent app's bundle identifier" packaging validation).
function widgetInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>Today</string>
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
		<string>com.apple.widgetkit-extension</string>
	</dict>
</dict>
</plist>
`;
}

function widgetEntitlements() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>${APP_GROUP_ID}</string>
	</array>
</dict>
</plist>
`;
}

const withWidgetExtension = config => {
  return withXcodeProject(config, mod => {
    addAppExtensionTarget({
      project: mod.modResults,
      platformProjectRoot: mod.modRequest.platformProjectRoot,
      targetName: TARGET_NAME,
      bundleIdentifier: `${config.ios?.bundleIdentifier}.${BUNDLE_ID_SUFFIX}`,
      deploymentTarget: DEPLOYMENT_TARGET,
      sourceFiles: ALL_SWIFT_FILES,
      infoPlist: widgetInfoPlist(),
      entitlements: widgetEntitlements(),
      frameworks: [
        'WidgetKit.framework',
        'SwiftUI.framework',
        // The Button(intent:)-driven interactive checkbox in
        // TodoTodayWidget.swift needs this — App Intents-based widget
        // interactivity is iOS 17+, matching DEPLOYMENT_TARGET above. (The
        // intent itself is in SHARED_SWIFT_FILES, compiled into both targets.)
        'AppIntents.framework',
        // TimerLiveActivity.swift's `import ActivityKit`. Not weak-linked here
        // the way the app-side podspec does it — this target's deployment
        // target is 17.0, above ActivityKit's 16.1 floor. ActivityConfiguration
        // and DynamicIsland themselves live in WidgetKit, already added above.
        'ActivityKit.framework',
      ],
    });

    return mod;
  });
};

module.exports = withWidgetExtension;
