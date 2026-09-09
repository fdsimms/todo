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
// - **One write type, requested on its own.** Almost everything here still
//   reads: steps, sleep and eight nutrients, none of them ever written. The
//   one exception is dietary water, logged when a task that opted into it
//   completes (see healthCompletionSync.ts) — its own `requestWriteAuthorization`
//   call in TodoHealthBridgeModule.swift passes only `dietaryWater` in
//   `toShare`, separately from the read call, so reading steps never puts a
//   water-sharing row on the same permission sheet. NSHealthUpdateUsageDescription
//   in app.json's ios.infoPlist has to say what's actually written now, not
//   the "nothing, ever" wording this comment used to carry when the write
//   string was required but never truly exercised.
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
