const fs = require('fs');
const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { APP_GROUP_ID } = require('./withAppGroup');

// Injects a WidgetKit extension target ("TodoWidget") into the generated
// Xcode project at prebuild time, without ejecting to a checked-in `ios/`
// folder. Written against the raw `xcode` project API (no first-party Expo
// helper exists for adding a brand-new native target) — see the methods used
// below in node_modules/xcode/lib/pbxProject.js if this ever needs updating
// for a new `xcode` package version.
const TARGET_NAME = 'TodoWidget';
const BUNDLE_ID_SUFFIX = 'TodoWidget';
// EAS Build's credential resolution only knows about the main app target
// (declared via app.json's bundleIdentifier); it never discovers this
// extension target, so it can't inject DEVELOPMENT_TEAM for it the way it
// does for the main target. Without an explicit team, non-interactive
// `xcodebuild -allowProvisioningUpdates` has no way to resolve which team to
// request a profile from and the archive step fails. Apple Team ID for the
// account this app is registered under (developer.apple.com/account →
// Membership details).
const DEVELOPMENT_TEAM = '4L5S4WA628';
// Widget extensions may target a higher minimum iOS than their host app —
// .containerBackground(for:) in TodoTodayWidget.swift requires iOS 17.
const DEPLOYMENT_TARGET = '17.0';
const SOURCE_DIR = path.join(__dirname, '..', 'targets', 'todo-widget');
const SWIFT_FILES = ['TodoWidgetBundle.swift', 'TodoWidgetData.swift', 'TodoTodayWidget.swift'];
const INFO_PLIST_NAME = `${TARGET_NAME}-Info.plist`;
const ENTITLEMENTS_NAME = `${TARGET_NAME}.entitlements`;

function widgetInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>Today</string>
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

// `xcode`'s addTarget() stores the target name pre-wrapped in literal quote
// characters (`name: '"' + targetName + '"'`), which propagates verbatim
// into the PBXNativeTarget section's comment. pbxTargetByName() does a plain
// string match against that comment, so it never matches an unquoted name —
// scan the section directly instead, stripping quotes before comparing.
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
    const project = mod.modResults;
    const platformProjectRoot = mod.modRequest.platformProjectRoot;
    const bundleIdentifier = `${config.ios?.bundleIdentifier}.${BUNDLE_ID_SUFFIX}`;

    const targetDir = path.join(platformProjectRoot, TARGET_NAME);
    fs.mkdirSync(targetDir, { recursive: true });

    for (const file of SWIFT_FILES) {
      fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(targetDir, file));
    }
    fs.writeFileSync(path.join(targetDir, INFO_PLIST_NAME), widgetInfoPlist());
    fs.writeFileSync(path.join(targetDir, ENTITLEMENTS_NAME), widgetEntitlements());

    // Re-running prebuild shouldn't inject a second copy of the target.
    if (findExistingTarget(project)) {
      return mod;
    }

    const target = project.addTarget(TARGET_NAME, 'app_extension', TARGET_NAME, bundleIdentifier);

    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    // Non-source files just need a file reference in the group — they're
    // wired in via build settings (INFOPLIST_FILE / CODE_SIGN_ENTITLEMENTS)
    // below, not a build phase.
    const group = project.addPbxGroup(
      [`${TARGET_NAME}/${INFO_PLIST_NAME}`, `${TARGET_NAME}/${ENTITLEMENTS_NAME}`],
      TARGET_NAME
    );
    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
    project.getPBXGroupByKey(mainGroupKey).children.push({ value: group.uuid, comment: TARGET_NAME });

    for (const file of SWIFT_FILES) {
      // Passing the group key (not just opt.target) both compiles the file
      // for this target and files it under the same navigator group as the
      // plist/entitlements above, instead of creating a duplicate reference.
      project.addSourceFile(`${TARGET_NAME}/${file}`, { target: target.uuid }, group.uuid);
    }

    project.addFramework('WidgetKit.framework', { target: target.uuid });
    project.addFramework('SwiftUI.framework', { target: target.uuid });

    const configListUuid = target.pbxNativeTarget.buildConfigurationList;
    const configList = project.pbxXCConfigurationList()[configListUuid];
    const buildConfigSection = project.pbxXCBuildConfigurationSection();
    for (const { value: configUuid } of configList.buildConfigurations) {
      const buildSettings = buildConfigSection[configUuid].buildSettings;
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

module.exports = withWidgetExtension;
