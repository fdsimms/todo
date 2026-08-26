const { withEntitlementsPlist } = require('@expo/config-plugins');

// AddTaskIntent's AppShortcut (modules/todo-widget-bridge/ios/AddTaskIntent.swift)
// works from the Shortcuts app, Spotlight and the Action Button's "Shortcut"
// picker with no entitlement at all — but a spoken Siri phrase ("Add a task
// in dundundun") is only routed to the intent with this entitlement present;
// without it Siri reports it doesn't understand the request even though the
// same shortcut runs fine tapped or from the Action Button. NSSiriUsageDescription
// (app.json's ios.infoPlist) is the other half — both are required together.
const withSiriShortcuts = config => {
  return withEntitlementsPlist(config, mod => {
    mod.modResults['com.apple.developer.siri'] = true;
    return mod;
  });
};

module.exports = withSiriShortcuts;
