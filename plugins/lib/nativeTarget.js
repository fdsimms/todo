const fs = require('fs');
const path = require('path');

/**
 * Injecting an iOS app-extension target into the generated Xcode project at
 * prebuild time, without ejecting to a checked-in `ios/` folder.
 *
 * This is the shared mechanics behind `withWidgetExtension.js` and
 * `withShareExtension.js` — the target creation itself, which is identical for
 * any extension point and is almost entirely workarounds. Written against the
 * raw `xcode` project API (no first-party Expo helper exists for adding a
 * brand-new native target); see the methods used below in
 * node_modules/xcode/lib/pbxProject.js if this ever needs updating for a new
 * `xcode` package version.
 *
 * It lives here rather than being copied per plugin because every one of the
 * fixes below was a failed build cycle to find (they're written up in
 * docs/native-targets.md), and each fails *late* — at archive or at submission,
 * not at build. A second copy is a second place the seventh one would have to
 * be found again. What stays in the calling plugin is what genuinely differs
 * between extension points: the Info.plist, the entitlements, the frameworks,
 * the deployment target, and which sources compile in.
 */

// EAS Build's credential resolution only knows about the main app target
// (declared via app.json's bundleIdentifier); it never discovers an extension
// target, so it can't inject DEVELOPMENT_TEAM for it the way it does for the
// main target. Without an explicit team, non-interactive `xcodebuild
// -allowProvisioningUpdates` has no way to resolve which team to request a
// profile from and the archive step fails. Apple Team ID for the account this
// app is registered under (developer.apple.com/account → Membership details).
const DEVELOPMENT_TEAM = '4L5S4WA628';

/**
 * `xcode`'s addTarget() stores the target name pre-wrapped in literal quote
 * characters (`name: '"' + targetName + '"'`), which propagates verbatim into
 * the PBXNativeTarget section's comment. pbxTargetByName() does a plain string
 * match against that comment, so it never matches an unquoted name — scan the
 * section directly instead, stripping quotes before comparing.
 */
function findExistingTarget(project, targetName) {
  const nativeTargets = project.pbxNativeTargetSection();
  for (const key of Object.keys(nativeTargets)) {
    if (key.endsWith('_comment')) continue;
    const target = nativeTargets[key];
    if (typeof target?.name === 'string' && target.name.replace(/^"|"$/g, '') === targetName) {
      return target;
    }
  }
  return null;
}

/**
 * Writes the target's sources and generated files into the platform project
 * directory, then adds the Xcode target itself unless one by that name is
 * already there (re-running prebuild must not inject a second copy).
 *
 * @param {object} options
 * @param {object} options.project           the `xcode` PBXProject from withXcodeProject
 * @param {string} options.platformProjectRoot  mod.modRequest.platformProjectRoot
 * @param {string} options.targetName        also the on-disk directory and PRODUCT_NAME
 * @param {string} options.bundleIdentifier  full identifier, app's own + a suffix
 * @param {string} options.deploymentTarget  IPHONEOS_DEPLOYMENT_TARGET for this target only
 * @param {{dir: string, name: string}[]} options.sourceFiles  copied in and compiled
 * @param {string} options.infoPlist         file contents, written as <targetName>-Info.plist
 * @param {string} options.entitlements      file contents, written as <targetName>.entitlements
 * @param {string[]} options.frameworks      e.g. ['WidgetKit.framework']
 * @param {Record<string, string>} [options.extraBuildSettings]  merged in last, so a
 *        target that needs a setting the defaults below don't cover can add one
 *        without every other target growing it too
 */
function addAppExtensionTarget({
  project,
  platformProjectRoot,
  targetName,
  bundleIdentifier,
  deploymentTarget,
  sourceFiles,
  infoPlist,
  entitlements,
  frameworks,
  extraBuildSettings = {},
}) {
  const infoPlistName = `${targetName}-Info.plist`;
  const entitlementsName = `${targetName}.entitlements`;

  const targetDir = path.join(platformProjectRoot, targetName);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const { dir, name } of sourceFiles) {
    fs.copyFileSync(path.join(dir, name), path.join(targetDir, name));
  }
  fs.writeFileSync(path.join(targetDir, infoPlistName), infoPlist);
  fs.writeFileSync(path.join(targetDir, entitlementsName), entitlements);

  // Re-running prebuild shouldn't inject a second copy of the target. The
  // files above are rewritten either way, so an edit to a .swift source still
  // lands on a project that already has the target.
  if (findExistingTarget(project, targetName)) return null;

  const target = project.addTarget(targetName, 'app_extension', targetName, bundleIdentifier);

  // addTarget() pre-wraps several string fields in literal quote characters
  // (e.g. `name: '"' + targetName + '"'`) instead of leaving them plain and
  // letting the pbxproj writer quote them as needed on serialization (which it
  // does correctly — see CODE_SIGN_ENTITLEMENTS below, set as a plain string
  // and written out fine). Xcode's own PBX parser tolerates the redundant
  // quoting, but any Node-side tool reading these fields back for an exact
  // string match — including EAS Build's own credential-to-target correlation
  // during non-interactive builds — will never match "TodoWidget" / the plain
  // bundle identifier against a value that's actually `"TodoWidget"` /
  // `"com.fdsimms...TodoWidget"` with the quotes baked into the string itself.
  // Overwrite with clean values immediately so nothing downstream has to know
  // about this.
  target.pbxNativeTarget.name = targetName;
  target.pbxNativeTarget.productName = targetName;

  // The PBXNativeTarget section's own `/* comment */` for this target's uuid,
  // and its entry in the PBXProject's `targets = (...)` list, were both
  // captured from the same still-quoted name at the point addTarget() called
  // addToPbxNativeTargetSection/addToPbxProjectSection internally — overwriting
  // .name above doesn't retroactively fix comments that were already copied
  // from it. Comments are cosmetic for xcodebuild itself, but leaving one of
  // these inconsistent with every other target's plain (unquoted) comment is
  // exactly the kind of thing a naive string match elsewhere could trip on, so
  // clean them up too.
  project.pbxNativeTargetSection()[`${target.uuid}_comment`] = targetName;
  const projectTargets = project.pbxProjectSection()[project.getFirstProject().uuid].targets;
  const targetsListEntry = projectTargets.find(t => t.value === target.uuid);
  if (targetsListEntry) targetsListEntry.comment = targetName;

  // addTarget() only writes signing info into the XCBuildConfigurations below —
  // it does NOT register the target in the PBXProject's
  // `attributes.TargetAttributes` dict. Xcode's own "requires a development
  // team" validation during archive reads THIS, not the buildSettings, to
  // resolve automatic signing — a target created via Xcode's UI always gets
  // both written together. Without this, the archive fails even with
  // DEVELOPMENT_TEAM set below.
  project.addTargetAttribute('DevelopmentTeam', DEVELOPMENT_TEAM, target);
  project.addTargetAttribute('ProvisioningStyle', 'Automatic', target);

  project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
  project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

  // Non-source files just need a file reference in the group — they're wired in
  // via build settings (INFOPLIST_FILE / CODE_SIGN_ENTITLEMENTS) below, not a
  // build phase.
  const group = project.addPbxGroup(
    [`${targetName}/${infoPlistName}`, `${targetName}/${entitlementsName}`],
    targetName
  );
  // addPbxGroup() unconditionally assigns its (here, omitted) `path` parameter
  // to pbxGroup.path — with no third argument, that's the JS value `undefined`,
  // which the writer serializes as the literal token `path = undefined;` rather
  // than omitting the key. Xcode then resolves every child file in this group
  // relative to a path that is literally the 9-character string "undefined"
  // (see e.g. the "Libraries"/"Products" groups elsewhere in this same file,
  // which correctly have no `path` key at all since they're virtual, not
  // disk-backed).
  delete group.pbxGroup.path;
  const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
  project.getPBXGroupByKey(mainGroupKey).children.push({ value: group.uuid, comment: targetName });

  for (const { name } of sourceFiles) {
    // Passing the group key (not just opt.target) both compiles the file for
    // this target and files it under the same navigator group as the
    // plist/entitlements above, instead of creating a duplicate reference.
    project.addSourceFile(`${targetName}/${name}`, { target: target.uuid }, group.uuid);
  }

  for (const framework of frameworks) {
    project.addFramework(framework, { target: target.uuid });
  }

  const configListUuid = target.pbxNativeTarget.buildConfigurationList;
  const configList = project.pbxXCConfigurationList()[configListUuid];
  const buildConfigSection = project.pbxXCBuildConfigurationSection();
  for (const { value: configUuid } of configList.buildConfigurations) {
    const buildSettings = buildConfigSection[configUuid].buildSettings;
    buildSettings.PRODUCT_NAME = targetName;
    buildSettings.PRODUCT_BUNDLE_IDENTIFIER = bundleIdentifier;
    buildSettings.INFOPLIST_FILE = `${targetName}/${infoPlistName}`;
    buildSettings.CODE_SIGN_ENTITLEMENTS = `${targetName}/${entitlementsName}`;
    buildSettings.CODE_SIGN_STYLE = 'Automatic';
    buildSettings.DEVELOPMENT_TEAM = DEVELOPMENT_TEAM;
    buildSettings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
    buildSettings.SWIFT_VERSION = '5.0';
    buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
    buildSettings.CURRENT_PROJECT_VERSION = '1';
    buildSettings.MARKETING_VERSION = '1.0';
    Object.assign(buildSettings, extraBuildSettings);
  }

  return target;
}

module.exports = { addAppExtensionTarget, findExistingTarget, DEVELOPMENT_TEAM };
