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
const SWIFT_FILES = [
  'TodoWidgetBundle.swift',
  'TodoWidgetData.swift',
  'TodoTodayWidget.swift',
  'CompleteTaskIntent.swift',
];
const INFO_PLIST_NAME = `${TARGET_NAME}-Info.plist`;
const ENTITLEMENTS_NAME = `${TARGET_NAME}.entitlements`;

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

    // addTarget() pre-wraps several string fields in literal quote
    // characters (e.g. `name: '"' + targetName + '"'`) instead of leaving
    // them plain and letting the pbxproj writer quote them as needed on
    // serialization (which it does correctly — see CODE_SIGN_ENTITLEMENTS
    // below, set as a plain string and written out fine). Xcode's own PBX
    // parser tolerates the redundant quoting, but any Node-side tool reading
    // these fields back for an exact string match — including EAS Build's
    // own credential-to-target correlation during non-interactive builds —
    // will never match "TodoWidget" / the plain bundle identifier against a
    // value that's actually `"TodoWidget"` / `"com.fdsimms...TodoWidget"`
    // with the quotes baked into the string itself. Overwrite with clean
    // values immediately so nothing downstream has to know about this.
    target.pbxNativeTarget.name = TARGET_NAME;
    target.pbxNativeTarget.productName = TARGET_NAME;

    // The PBXNativeTarget section's own `/* comment */` for this target's
    // uuid, and its entry in the PBXProject's `targets = (...)` list, were
    // both captured from the same still-quoted name at the point addTarget()
    // called addToPbxNativeTargetSection/addToPbxProjectSection internally —
    // overwriting .name above doesn't retroactively fix comments that were
    // already copied from it. Comments are cosmetic for xcodebuild itself,
    // but leaving one of these inconsistent with every other target's plain
    // (unquoted) comment is exactly the kind of thing a naive string match
    // elsewhere could trip on, so clean them up too.
    project.pbxNativeTargetSection()[`${target.uuid}_comment`] = TARGET_NAME;
    const projectTargets = project.pbxProjectSection()[project.getFirstProject().uuid].targets;
    const targetsListEntry = projectTargets.find(t => t.value === target.uuid);
    if (targetsListEntry) targetsListEntry.comment = TARGET_NAME;

    // addTarget() only writes signing info into the XCBuildConfigurations
    // below — it does NOT register the target in the PBXProject's
    // `attributes.TargetAttributes` dict. Xcode's own "requires a
    // development team" validation during archive reads THIS, not the
    // buildSettings, to resolve automatic signing — a target created via
    // Xcode's UI always gets both written together. Without this, the
    // archive fails even with DEVELOPMENT_TEAM set below.
    project.addTargetAttribute('DevelopmentTeam', DEVELOPMENT_TEAM, target);
    project.addTargetAttribute('ProvisioningStyle', 'Automatic', target);

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
    // addPbxGroup() unconditionally assigns its (here, omitted) `path`
    // parameter to pbxGroup.path — with no third argument, that's the JS
    // value `undefined`, which the writer serializes as the literal token
    // `path = undefined;` rather than omitting the key. Xcode then resolves
    // every child file in this group relative to a path that is literally
    // the 9-character string "undefined" (see e.g. the "Libraries"/
    // "Products" groups elsewhere in this same file, which correctly have
    // no `path` key at all since they're virtual, not disk-backed).
    delete group.pbxGroup.path;
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
    // CompleteTaskIntent.swift's Button(intent:)-driven interactive
    // checkbox needs this — App Intents-based widget interactivity is
    // iOS 17+, matching DEPLOYMENT_TARGET below.
    project.addFramework('AppIntents.framework', { target: target.uuid });

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

module.exports = withWidgetExtension;
