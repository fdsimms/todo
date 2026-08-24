const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { APP_GROUP_ID } = require('./withAppGroup');
const { addAppExtensionTarget } = require('./lib/nativeTarget');

// Injects a Share extension target ("TodoShareExtension") into the generated
// Xcode project at prebuild time — the "dundundun" row in another app's share
// sheet, for a recipe page the user is looking at. The Xcode-target plumbing
// lives in ./lib/nativeTarget.js, shared with withWidgetExtension.js; what's
// here is what's specific to being a share extension.
//
// See targets/todo-share/ for what it actually does (capture the URL, queue it
// in the App Group) and docs/arch/recipes.md for the rest of the round trip.
const TARGET_NAME = 'TodoShareExtension';
const BUNDLE_ID_SUFFIX = 'ShareExtension';
// Matches the app's own floor rather than the widget's 17.0 — nothing in
// ShareViewController.swift is newer than iOS 13, and an extension that
// silently doesn't appear in the share sheet on a device the app itself runs on
// would be a much quieter failure than the widget's.
const DEPLOYMENT_TARGET = '15.1';
const SOURCE_DIR = path.join(__dirname, '..', 'targets', 'todo-share');
const SWIFT_FILES = ['ShareViewController.swift', 'SharedRecipeQueue.swift'].map(name => ({
  dir: SOURCE_DIR,
  name,
}));

// The $(BUILD_SETTING) placeholders here are load-bearing and every one of them
// needs a real key present in this source plist — Xcode substitutes during
// Info.plist processing but never *injects* a key the file omits, so a missing
// one compiles to `(null)` rather than failing (see docs/native-targets.md).
//
// Two keys beyond the widget's set:
//
//  • NSExtensionPrincipalClass names the view controller iOS instantiates, and
//    a Swift class's Objective-C name is module-qualified —
//    $(PRODUCT_MODULE_NAME) resolves to the value pinned in extraBuildSettings
//    below rather than being left to default off PRODUCT_NAME.
//  • NSExtensionActivationRule decides which apps show dundundun at all. Both
//    keys are wanted: an app sharing a page properly attaches a web URL, and
//    plenty of others share a plain string with the link inside it, which
//    ShareViewController runs a link detector over. MaxCount 1 keeps the row
//    out of share sheets for a multi-select of ten things, where "import a
//    recipe" isn't the offer being made.
function shareInfoPlist() {
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
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.share-services</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
		<key>NSExtensionAttributes</key>
		<dict>
			<key>NSExtensionActivationRule</key>
			<dict>
				<key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
				<integer>1</integer>
				<key>NSExtensionActivationSupportsTextWithMaxCount</key>
				<integer>1</integer>
			</dict>
		</dict>
	</dict>
</dict>
</plist>
`;
}

// The App Group is the whole point of the target — it's the only thing this
// process shares with the app.
function shareEntitlements() {
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

const withShareExtension = config => {
  return withXcodeProject(config, mod => {
    addAppExtensionTarget({
      project: mod.modResults,
      platformProjectRoot: mod.modRequest.platformProjectRoot,
      targetName: TARGET_NAME,
      bundleIdentifier: `${config.ios?.bundleIdentifier}.${BUNDLE_ID_SUFFIX}`,
      deploymentTarget: DEPLOYMENT_TARGET,
      sourceFiles: SWIFT_FILES,
      infoPlist: shareInfoPlist(),
      entitlements: shareEntitlements(),
      // UIKit and Foundation are autolinked by Swift's own import directives;
      // both are named anyway so the target's Frameworks phase says what it
      // needs rather than relying on that, same as the widget's does.
      frameworks: ['UIKit.framework', 'Foundation.framework'],
      extraBuildSettings: {
        // NSExtensionPrincipalClass above is `$(PRODUCT_MODULE_NAME).ShareViewController`,
        // and the default for PRODUCT_MODULE_NAME is derived from PRODUCT_NAME
        // through the `:c99extidentifier` operator. That derivation is correct
        // for this name, but a principal class that fails to resolve doesn't
        // fail the build — iOS just declines to launch the extension, showing
        // nothing at all when the share row is tapped. Pin it rather than leave
        // the share sheet's behaviour riding on a string substitution.
        PRODUCT_MODULE_NAME: TARGET_NAME,
      },
    });

    return mod;
  });
};

module.exports = withShareExtension;
