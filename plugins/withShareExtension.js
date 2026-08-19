const fs = require('fs');
const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { APP_GROUP_ID } = require('./withAppGroup');

// Injects the Share extension target ("TodoShare") into the generated Xcode
// project at prebuild time — "Share → dundundun" from Safari, which hands a
// recipe page's address to the app.
//
// Deliberately a near-copy of withWidgetExtension.js rather than a shared
// helper the two both call. Every workaround below is a comment explaining a
// specific bug in the `xcode` package or a specific way EAS Build fails, and
// factoring them into a generic addNativeTarget() would leave a caller unable
// to see why any of it is there — which is how one of them gets "cleaned up"
// and costs another build cycle to rediscover. Two targets is not yet enough
// duplication to be worth that. A third would be.
//
// See docs/native-targets.md before changing anything here.
const TARGET_NAME = 'TodoShare';
const BUNDLE_ID_SUFFIX = 'TodoShare';
// Same team as the widget target and for the same reason — EAS Build's
// credential resolution only discovers the main app target, so an extension
// with no explicit team fails non-interactive signing at the archive step.
const DEVELOPMENT_TEAM = '4L5S4WA628';
// The app's own floor, not the widget's 17.0. Nothing here needs a modern API,
// and a target built above the host app's minimum simply won't install on a
// device the app itself supports.
const DEPLOYMENT_TARGET = '15.1';
const SOURCE_DIR = path.join(__dirname, '..', 'targets', 'todo-share');
const SWIFT_FILES = ['ShareViewController.swift'];
const INFO_PLIST_NAME = `${TARGET_NAME}-Info.plist`;
const ENTITLEMENTS_NAME = `${TARGET_NAME}.entitlements`;

// Every key besides NSExtension/CFBundleDisplayName is one Xcode's "New Target"
// template always writes as a $(BUILD_SETTING) placeholder. Xcode only
// substitutes these if the key is actually present in the source plist — an
// absent one compiles to `(null)` rather than being injected, which then fails
// Apple's "embedded binary must be prefixed with the parent bundle id"
// validation at *submission*, long after the build passed. See the widget
// plugin's note; this is the same list.
//
// NSExtensionActivationSupportsWebURLWithMaxCount is what keeps dundundun out
// of the share sheet for photos, files and selected text. The feature is "send
// me a recipe page", so anything that isn't a web address shouldn't offer it —
// an extension that appears everywhere and then says "nothing to import" is
// worse than one that doesn't appear.
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
			</dict>
		</dict>
	</dict>
</dict>
</plist>
`;
}

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

// `xcode`'s addTarget() stores the name pre-wrapped in literal quote characters,
// which propagates into the PBXNativeTarget section's comment — so
// pbxTargetByName()'s plain string match never finds it. Scan the section
// directly, stripping quotes before comparing.
function findExistingTarget(project) {
  const nativeTargets = project.pbxNativeTargetSection();
  for (const key of Object.keys(nativeTargets)) {
    if (key.endsWith('_comment')) continue;
    const target = nativeTargets[key];
    if (typeof target?.name === 'string' && target.name.replace(/^"|"$/g, '') === TARGET_NAME) {
      return target;
    }
  }
  return null;
}

const withShareExtension = config => {
  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    const platformProjectRoot = mod.modRequest.platformProjectRoot;
    const bundleIdentifier = `${config.ios?.bundleIdentifier}.${BUNDLE_ID_SUFFIX}`;

    const targetDir = path.join(platformProjectRoot, TARGET_NAME);
    fs.mkdirSync(targetDir, { recursive: true });

    for (const name of SWIFT_FILES) {
      fs.copyFileSync(path.join(SOURCE_DIR, name), path.join(targetDir, name));
    }
    fs.writeFileSync(path.join(targetDir, INFO_PLIST_NAME), shareInfoPlist());
    fs.writeFileSync(path.join(targetDir, ENTITLEMENTS_NAME), shareEntitlements());

    // Re-running prebuild shouldn't inject a second copy of the target.
    if (findExistingTarget(project)) {
      return mod;
    }

    const target = project.addTarget(TARGET_NAME, 'app_extension', TARGET_NAME, bundleIdentifier);

    // addTarget() bakes literal quote characters into these fields, which any
    // Node-side exact string match — including EAS Build's credential-to-target
    // correlation — will never match. Overwrite with clean values immediately.
    target.pbxNativeTarget.name = TARGET_NAME;
    target.pbxNativeTarget.productName = TARGET_NAME;

    // The section comment and the PBXProject targets-list entry were both copied
    // from the still-quoted name before the lines above ran; overwriting .name
    // doesn't retroactively fix them.
    project.pbxNativeTargetSection()[`${target.uuid}_comment`] = TARGET_NAME;
    const projectTargets = project.pbxProjectSection()[project.getFirstProject().uuid].targets;
    const targetsListEntry = projectTargets.find(t => t.value === target.uuid);
    if (targetsListEntry) targetsListEntry.comment = TARGET_NAME;

    // Xcode's "requires a development team" archive validation reads
    // TargetAttributes, not buildSettings. addTarget() writes neither.
    project.addTargetAttribute('DevelopmentTeam', DEVELOPMENT_TEAM, target);
    project.addTargetAttribute('ProvisioningStyle', 'Automatic', target);

    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    const group = project.addPbxGroup(
      [`${TARGET_NAME}/${INFO_PLIST_NAME}`, `${TARGET_NAME}/${ENTITLEMENTS_NAME}`],
      TARGET_NAME
    );
    // addPbxGroup() with no `path` argument writes the literal token
    // `path = undefined;`, which Xcode then resolves children against as the
    // 9-character string "undefined".
    delete group.pbxGroup.path;
    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
    project.getPBXGroupByKey(mainGroupKey).children.push({ value: group.uuid, comment: TARGET_NAME });

    for (const name of SWIFT_FILES) {
      project.addSourceFile(`${TARGET_NAME}/${name}`, { target: target.uuid }, group.uuid);
    }

    // UIKit and Foundation come from the SDK for an iOS target; only
    // UniformTypeIdentifiers (UTType.url in ShareViewController) needs asking
    // for. The widget target's WidgetKit/SwiftUI/AppIntents have no equivalent
    // here — nothing in this extension renders anything but a label.
    project.addFramework('UniformTypeIdentifiers.framework', { target: target.uuid });

    const configListUuid = target.pbxNativeTarget.buildConfigurationList;
    const configList = project.pbxXCConfigurationList()[configListUuid];
    const buildConfigSection = project.pbxXCBuildConfigurationSection();
    for (const { value: configUuid } of configList.buildConfigurations) {
      const buildSettings = buildConfigSection[configUuid].buildSettings;
      buildSettings.PRODUCT_NAME = TARGET_NAME;
      buildSettings.PRODUCT_BUNDLE_IDENTIFIER = bundleIdentifier;
      buildSettings.INFOPLIST_FILE = `${TARGET_NAME}/${INFO_PLIST_NAME}`;
      buildSettings.CODE_SIGN_ENTITLEMENTS = `${TARGET_NAME}/${ENTITLEMENTS_NAME}`;
      buildSettings.CODE_SIGN_STYLE = 'Automatic';
      buildSettings.DEVELOPMENT_TEAM = DEVELOPMENT_TEAM;
      buildSettings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
      buildSettings.SWIFT_VERSION = '5.0';
      buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
      buildSettings.CURRENT_PROJECT_VERSION = '1';
      buildSettings.MARKETING_VERSION = '1.0';
    }

    return mod;
  });
};

module.exports = withShareExtension;
