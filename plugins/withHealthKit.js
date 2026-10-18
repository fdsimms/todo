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
// - **There are two strings, and both have to stay true.** The bridge writes a
//   handful of things (a nutrient a task logs, a weight, a meal, a finished
//   strength workout) and reads more, each list reviewed in
//   docs/arch/health-data.md. Read and share are requested together in one
//   sheet (`writeTypes` and `readTypes` in TodoHealthBridgeModule.swift, for
//   the revocation reason noted there), so NSHealthShareUsageDescription and
//   NSHealthUpdateUsageDescription in app.json's ios.infoPlist both appear on
//   it. Adding a read or a write type means rewording the matching string in
//   the same change.
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
