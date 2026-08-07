const { withXcodeProject } = require('@expo/config-plugins');

// Links AlarmKit.framework into the main app target as a *weak* (optional)
// framework — see modules/todo-alarmkit-bridge. AlarmKit is iOS 26+ only;
// weak-linking lets the binary still load on older iOS instead of refusing
// to launch, so the app's deployment target does not need to move to 26.
// Every call into the framework is additionally gated at the Swift call
// site with `if #available(iOS 26, *)` (TodoAlarmKitModule.swift) — the
// weak link only handles the dynamic-linker side of "this symbol may not
// exist at runtime."
//
// Unlike plugins/withWidgetExtension.js, this does not add a new Xcode
// target — AlarmKit's basic scheduling API runs in-process in the main app,
// so none of that file's target-injection workarounds (addTarget quoting
// bug, TargetAttributes signing, addPbxGroup path bug) apply here.
const withAlarmKit = config => {
  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    const target = project.getFirstTarget();
    project.addFramework('AlarmKit.framework', { target: target.uuid, weak: true });
    return mod;
  });
};

module.exports = withAlarmKit;
