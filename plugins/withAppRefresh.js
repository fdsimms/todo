const { withInfoPlist } = require('@expo/config-plugins');

// The Info.plist half of modules/todo-app-refresh: short background app
// refreshes (BGAppRefreshTask) need the "fetch" background mode, and the
// task's identifier has to be listed as permitted before the app may register
// it. Appends to both arrays rather than replacing them, the way
// expo-background-task's own plugin does for "processing" and its
// identifier, so the order the two plugins run in doesn't matter.
//
// The identifier must match AppRefreshScheduler.identifier in
// modules/todo-app-refresh/ios/TodoAppRefresh.swift. That file checks the
// list before registering, since registering an identifier that isn't on it
// raises at launch.
const APP_REFRESH_IDENTIFIER = 'com.fdsimms.dundundun.app-refresh';

const withAppRefresh = config => {
  return withInfoPlist(config, mod => {
    const plist = mod.modResults;
    const modes = Array.isArray(plist.UIBackgroundModes) ? plist.UIBackgroundModes : [];
    if (!modes.includes('fetch')) modes.push('fetch');
    plist.UIBackgroundModes = modes;
    const ids = Array.isArray(plist.BGTaskSchedulerPermittedIdentifiers)
      ? plist.BGTaskSchedulerPermittedIdentifiers
      : [];
    if (!ids.includes(APP_REFRESH_IDENTIFIER)) ids.push(APP_REFRESH_IDENTIFIER);
    plist.BGTaskSchedulerPermittedIdentifiers = ids;
    return mod;
  });
};

module.exports = withAppRefresh;
