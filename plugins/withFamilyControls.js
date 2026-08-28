const { withEntitlementsPlist } = require('@expo/config-plugins');

// The Screen Time entitlement, behind everything in modules/todo-screentime-bridge:
// choosing apps (FamilyActivityPicker), shielding them during a focus session
// (ManagedSettings), and the usage thresholds the DeviceActivity monitor
// extension watches.
//
// Two things worth knowing before touching this, both of which fail late:
//
// - Apple gates the *distribution* half behind a manual approval request, per
//   bundle id, and separately for each Screen Time extension. A development
//   build works with the entitlement present; TestFlight and the App Store do
//   not, until the request for that bundle id clears. So the monitor extension
//   (plugins/withActivityMonitor.js) needs its own request, not just this one.
// - There is no usage-description string to pair this with, unlike
//   NSSiriUsageDescription beside withSiriShortcuts.js. The authorization sheet
//   is drawn by the system and carries its own wording, so nothing goes in
//   app.json's ios.infoPlist for this.
const FAMILY_CONTROLS_ENTITLEMENT = 'com.apple.developer.family-controls';

const withFamilyControls = config => {
  return withEntitlementsPlist(config, mod => {
    mod.modResults[FAMILY_CONTROLS_ENTITLEMENT] = true;
    return mod;
  });
};

module.exports = withFamilyControls;
module.exports.FAMILY_CONTROLS_ENTITLEMENT = FAMILY_CONTROLS_ENTITLEMENT;
