const { withEntitlementsPlist } = require('@expo/config-plugins');

// Shared container the main app and the TodoWidget extension both read/write
// through — see modules/todo-widget-bridge and targets/todo-widget.
const APP_GROUP_ID = 'group.com.fdsimms.dundundun';

const withAppGroup = config => {
  return withEntitlementsPlist(config, mod => {
    const existing = mod.modResults['com.apple.security.application-groups'] ?? [];
    if (!existing.includes(APP_GROUP_ID)) {
      mod.modResults['com.apple.security.application-groups'] = [...existing, APP_GROUP_ID];
    }
    return mod;
  });
};

module.exports = withAppGroup;
module.exports.APP_GROUP_ID = APP_GROUP_ID;
