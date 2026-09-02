const { withEntitlementsPlist } = require('@expo/config-plugins');

// The HealthKit entitlement, behind everything in modules/todo-health-bridge.
//
// Three differences from withFamilyControls.js beside it, all worth knowing
// before touching this:
//
// - **There is a usage-description string, and it is required.** Unlike Family
//   Controls, whose sheet is entirely system-drawn, HealthKit shows the app's
//   own NSHealthShareUsageDescription in the permission sheet and the app is
//   terminated at the first read if the key is missing. It lives in app.json's
//   ios.infoPlist beside NSAlarmKitUsageDescription, which is where every other
//   usage string in this project lives.
// - **Only the read half is claimed.** There is no
//   NSHealthUpdateUsageDescription and no share request, because nothing here
//   writes: this app reads a number somebody else's app recorded. Asking for
//   write access it never uses would put a second, unearned row in the
//   permission sheet.
// - **No distribution approval to wait for.** Screen Time's entitlement is
//   granted per bundle id by a manual request that dev builds don't need and
//   TestFlight does. HealthKit has no such gate: turning the capability on is
//   the whole of it.
//
// `com.apple.developer.healthkit.access` (clinical records) is deliberately not
// set. That array opts into health-record types from providers, which is a
// different data class with its own review, and nothing here reads one.
const HEALTHKIT_ENTITLEMENT = 'com.apple.developer.healthkit';

const withHealthKit = config => {
  return withEntitlementsPlist(config, mod => {
    mod.modResults[HEALTHKIT_ENTITLEMENT] = true;
    return mod;
  });
};

module.exports = withHealthKit;
module.exports.HEALTHKIT_ENTITLEMENT = HEALTHKIT_ENTITLEMENT;
