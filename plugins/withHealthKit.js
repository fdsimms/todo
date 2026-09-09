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
// - **Only the read half is ever exercised, but the write string is still
//   required.** Nothing here writes: this app reads a number somebody else's
//   app recorded, and every `requestAuthorization`/`getRequestStatusForAuthorization`
//   call in TodoHealthBridgeModule.swift passes `toShare: []`, so no write
//   type is ever requested and the system permission sheet shows no share row.
//   But App Store Connect's Info.plist validator scans for the *selector*
//   `requestAuthorization(toShare:read:)` being linked at all, not for what's
//   in the set passed to it — so NSHealthUpdateUsageDescription still has to
//   exist in app.json's ios.infoPlist, worded to say plainly that nothing is
//   ever written, or every build is rejected before it reaches a device.
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
