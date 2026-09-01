const { withXcodeProject } = require('@expo/config-plugins');

// Links FoundationModels.framework into the main app target as a *weak*
// (optional) framework — see modules/todo-foundation-models. Foundation Models
// is iOS 26+ only; weak-linking lets the binary still load on older iOS
// instead of refusing to launch, so the app's deployment target does not need
// to move to 26. Every call into the framework is additionally gated at the
// Swift call site with `if #available(iOS 26, *)` — the weak link only handles
// the dynamic-linker side of "this symbol may not exist at runtime."
//
// The same shape as plugins/withAlarmKit.js, and for the same reason it is not
// plugins/withWidgetExtension.js: the model runs in-process in the main app,
// so none of that file's target-injection workarounds apply here.
const withFoundationModels = config => {
  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    const target = project.getFirstTarget();
    project.addFramework('FoundationModels.framework', { target: target.uuid, weak: true });
    return mod;
  });
};

module.exports = withFoundationModels;
