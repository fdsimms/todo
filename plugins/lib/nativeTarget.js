const fs = require('fs');
const path = require('path');
const { IOSConfig, withFinalizedMod } = require('@expo/config-plugins');

/**
 * Injecting an iOS app-extension target (or the watchOS app, see
 * addWatchAppTarget) into the generated Xcode project at prebuild time,
 * without ejecting to a checked-in `ios/` folder.
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
  const key = findTargetKey(project, targetName);
  return key ? project.pbxNativeTargetSection()[key] : null;
}

function findTargetKey(project, targetName) {
  const nativeTargets = project.pbxNativeTargetSection();
  for (const key of Object.keys(nativeTargets)) {
    if (key.endsWith('_comment')) continue;
    const target = nativeTargets[key];
    if (typeof target?.name === 'string' && target.name.replace(/^"|"$/g, '') === targetName) {
      return key;
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
function addAppExtensionTarget(options) {
  return addNativeTarget({ ...options, kind: 'app_extension' });
}

/**
 * A watchOS app embedded in the iPhone app, the single-target kind Xcode 14+
 * creates (no separate WatchKit extension). Same options as
 * addAppExtensionTarget, with `deploymentTarget` meaning
 * WATCHOS_DEPLOYMENT_TARGET, plus `resourceFolders` for the asset catalog a
 * watch app can't ship without (App Store validation refuses one with no icon).
 *
 * What differs from an extension, all of it below rather than in the plugin
 * because each is the kind of thing that fails late:
 *
 * - The product type is a plain `application`. The `xcode` package only knows
 *   the legacy two-target watch app (`watch2_app` + `watch2_extension`), so the
 *   target is added as an ordinary application and the watch-specific parts are
 *   build settings: SDKROOT watchos and device family 4.
 * - It is embedded by an "Embed Watch Content" copy phase into
 *   `$(CONTENTS_FOLDER_PATH)/Watch` (subfolder spec 16, the products
 *   directory), not the extensions' plugins folder. A watch app anywhere else
 *   is rejected at submission ("should be under Watch").
 * - No `frameworks`: Swift autolinks SwiftUI against the watchOS SDK, and
 *   `addFramework` silently skips a framework any other target already added
 *   (it dedupes on the file path, project-wide), so naming one here would link
 *   nothing and look like it did.
 * - The main target's dependency on it comes from withExplicitTargetDependency,
 *   which the calling plugin applies as well; it can't be done here.
 *
 * @param {object} options  as addAppExtensionTarget, minus `frameworks`
 * @param {{dir: string, name: string}[]} [options.resourceFolders]  folders
 *        (an `.xcassets`) copied in whole and added to the Resources phase
 */
function addWatchAppTarget(options) {
  return addNativeTarget({ ...options, frameworks: [], kind: 'watch_app' });
}

/**
 * An app extension that runs on the watch (a complication's WidgetKit
 * extension), embedded in the watch app named by `hostTargetName` rather than
 * in the iPhone app. Same options as addWatchAppTarget, plus that name; the
 * host must already have been added.
 *
 * addTarget() embeds every `app_extension` in the iPhone app: it adds a
 * "Copy Files" phase to the first target and files the product under the
 * first such phase in the project. Both are undone here and the product goes
 * into an "Embed Foundation Extensions" phase on the watch app instead
 * (subfolder spec 13, its PlugIns folder). An extension built for watchOS and
 * left in the iPhone app's PlugIns is refused at validation. The host's
 * dependency on it is withExplicitTargetDependency's, as for the watch app.
 *
 * @param {object} options  as addWatchAppTarget
 * @param {string} options.hostTargetName  the watch app it is embedded in
 */
function addWatchExtensionTarget(options) {
  return addNativeTarget({ ...options, frameworks: [], kind: 'watch_extension' });
}

function addNativeTarget({
  kind,
  hostTargetName,
  project,
  platformProjectRoot,
  targetName,
  bundleIdentifier,
  deploymentTarget,
  sourceFiles,
  resourceFolders = [],
  infoPlist,
  entitlements,
  frameworks,
  extraBuildSettings = {},
}) {
  const isWatchApp = kind === 'watch_app';
  const isWatchExtension = kind === 'watch_extension';
  const onWatch = isWatchApp || isWatchExtension;
  const infoPlistName = `${targetName}-Info.plist`;
  const entitlementsName = `${targetName}.entitlements`;

  const targetDir = path.join(platformProjectRoot, targetName);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const { dir, name } of sourceFiles) {
    fs.copyFileSync(path.join(dir, name), path.join(targetDir, name));
  }
  for (const { dir, name } of resourceFolders) {
    fs.cpSync(path.join(dir, name), path.join(targetDir, name), { recursive: true });
  }
  fs.writeFileSync(path.join(targetDir, infoPlistName), infoPlist);
  fs.writeFileSync(path.join(targetDir, entitlementsName), entitlements);

  // Re-running prebuild shouldn't inject a second copy of the target. The
  // files above are rewritten either way, so an edit to a .swift source still
  // lands on a project that already has the target.
  if (findExistingTarget(project, targetName)) return null;

  const mainTarget = project.getFirstTarget();
  const mainPhasesBefore = mainTarget.firstTarget.buildPhases.map(phase => phase.value);
  const target = project.addTarget(
    targetName,
    isWatchApp ? 'application' : 'app_extension',
    targetName,
    bundleIdentifier
  );

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

  if (isWatchApp) {
    // addTarget() embeds an `app_extension` itself (the main target's
    // "Copy Files" phase) but does nothing for an `application`, so the watch
    // app's phase is made here. 'watch2_app' is only the folder-type key that
    // maps to subfolder spec 16; the target itself is not one.
    const { buildPhase } = project.addBuildPhase(
      [],
      'PBXCopyFilesBuildPhase',
      'Embed Watch Content',
      project.getFirstTarget().uuid,
      'watch2_app',
      '"$(CONTENTS_FOLDER_PATH)/Watch"'
    );
    // The phase embeds the build file addTarget() already minted for the
    // product, not a second reference to it. Added by hand rather than by
    // passing the product's name to addBuildPhase, which does find that build
    // file but labels it `"TodoWatch.app" in Resources` in the phase's list
    // (it re-guesses a group from the quoted path); the same kind of stale
    // comment the name clean-up above exists to avoid.
    const productRef = target.pbxNativeTarget.productReference;
    const buildFiles = project.pbxBuildFileSection();
    const productBuildFile = Object.keys(buildFiles).find(
      key => !key.endsWith('_comment') && buildFiles[key].fileRef === productRef
    );
    const embedComment = `${targetName}.app in Embed Watch Content`;
    buildFiles[`${productBuildFile}_comment`] = embedComment;
    buildPhase.files.push({ value: productBuildFile, comment: embedComment });
    // The dependency on this target is withExplicitTargetDependency's job, not
    // this function's; see there for why it can't happen here.
  }

  if (isWatchExtension) {
    // Out of the iPhone app (see addWatchExtensionTarget): the product's build
    // file is taken out of whichever copy phase addTarget() filed it under,
    // and the phase addTarget() added to the main target is dropped once
    // that leaves it empty.
    const productRef = target.pbxNativeTarget.productReference;
    const buildFiles = project.pbxBuildFileSection();
    const productBuildFile = Object.keys(buildFiles).find(
      key => !key.endsWith('_comment') && buildFiles[key].fileRef === productRef
    );
    const copyPhases = project.hash.project.objects.PBXCopyFilesBuildPhase;
    for (const key of Object.keys(copyPhases)) {
      if (key.endsWith('_comment')) continue;
      copyPhases[key].files = copyPhases[key].files.filter(file => file.value !== productBuildFile);
    }
    mainTarget.firstTarget.buildPhases = mainTarget.firstTarget.buildPhases.filter(phase => {
      const added = !mainPhasesBefore.includes(phase.value);
      const empty = copyPhases[phase.value] && copyPhases[phase.value].files.length === 0;
      if (added && empty) {
        delete copyPhases[phase.value];
        delete copyPhases[`${phase.value}_comment`];
        return false;
      }
      return true;
    });

    const hostKey = findTargetKey(project, hostTargetName);
    const { buildPhase } = project.addBuildPhase(
      [],
      'PBXCopyFilesBuildPhase',
      'Embed Foundation Extensions',
      hostKey,
      'app_extension'
    );
    const embedComment = `${targetName}.appex in Embed Foundation Extensions`;
    buildFiles[`${productBuildFile}_comment`] = embedComment;
    buildPhase.files.push({ value: productBuildFile, comment: embedComment });
  }

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

  for (const { name } of resourceFolders) {
    // addSourceFile's shape with the Resources phase in place of Sources.
    // Not addResourceFile(): it looks for a project-wide group named
    // "Resources" to correct the path against, and Expo's template has none,
    // so it throws on the missing group.
    const file = project.addFile(`${targetName}/${name}`, group.uuid, {});
    file.target = target.uuid;
    file.uuid = project.generateUuid();
    project.addToPbxBuildFileSection(file);
    project.addToPbxResourcesBuildPhase(file);
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
    if (onWatch) {
      // Overrides the project-level SDKROOT = iphoneos every target inherits.
      // The project's IPHONEOS_DEPLOYMENT_TARGET is still inherited and is
      // simply unread under the watchOS SDK.
      buildSettings.SDKROOT = 'watchos';
      buildSettings.WATCHOS_DEPLOYMENT_TARGET = deploymentTarget;
    } else {
      buildSettings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
    }
    buildSettings.SWIFT_VERSION = '5.0';
    buildSettings.TARGETED_DEVICE_FAMILY = onWatch ? '4' : '"1,2"';
    buildSettings.CURRENT_PROJECT_VERSION = '1';
    buildSettings.MARKETING_VERSION = '1.0';
    Object.assign(buildSettings, extraBuildSettings);
  }

  return target;
}

/**
 * Makes the main app target (or `hostTargetName`, for an extension embedded in
 * the watch app) depend on `targetName` explicitly, as Xcode's own watch app
 * template does, so building a watchOS target inside an iOS archive doesn't
 * rest on the scheme inferring that dependency across platforms.
 *
 * The extensions have no explicit dependency at all, and that's by accident:
 * addTarget() asks for one, but addTargetDependency only writes into the
 * PBXTargetDependency and PBXContainerItemProxy sections if they already exist,
 * and Expo's template has neither, so the call does nothing and the extensions
 * build on the scheme's "find implicit dependencies" (it sees their products in
 * a copy phase). Creating those sections is what this has to do, and once they
 * exist every later addTarget() call starts writing a dependency too. Since
 * Expo runs the last-registered plugin's mod first, doing it inside
 * withXcodeProject would quietly rewire every extension added after it. So it
 * runs as a finalized mod, after every target has been added and the project
 * written, and re-reads the project from disk. Re-running prebuild doesn't add
 * a second dependency.
 */
function withExplicitTargetDependency(config, targetName, hostTargetName = null) {
  return withFinalizedMod(config, [
    'ios',
    async mod => {
      const project = IOSConfig.XcodeUtils.getPbxproj(mod.modRequest.projectRoot);
      const targetKey = findTargetKey(project, targetName);
      const hostKey = hostTargetName ? findTargetKey(project, hostTargetName) : project.getFirstTarget().uuid;
      if (!targetKey || !hostKey) return mod;

      const objects = project.hash.project.objects;
      const alreadyDepends = Object.values(objects.PBXTargetDependency ?? {}).some(
        dependency => typeof dependency === 'object' && dependency.target === targetKey
      );
      if (alreadyDepends) return mod;

      objects.PBXTargetDependency = objects.PBXTargetDependency ?? {};
      objects.PBXContainerItemProxy = objects.PBXContainerItemProxy ?? {};
      project.addTargetDependency(hostKey, [targetKey]);
      fs.writeFileSync(project.filepath, project.writeSync());
      return mod;
    },
  ]);
}

module.exports = {
  addAppExtensionTarget,
  addWatchAppTarget,
  addWatchExtensionTarget,
  findExistingTarget,
  withExplicitTargetDependency,
  DEVELOPMENT_TEAM,
};
