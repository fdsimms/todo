const { withEntitlementsPlist } = require('@expo/config-plugins');

// The private CloudKit database the app syncs through — see
// modules/todo-cloudkit-bridge and src/utils/cloudKitTransport.ts.
//
// Private, not shared or public: every record is in the signed-in Apple ID's
// own container, readable by nobody else including Apple. That is the whole
// reason CloudKit needs no passphrase and no pairing step, and it is what a
// relay would have needed client-side encryption to match.
const ICLOUD_CONTAINER_ID = 'iCloud.com.fdsimms.dundundun';

const withCloudKit = config => {
  return withEntitlementsPlist(config, mod => {
    const services = mod.modResults['com.apple.developer.icloud-services'] ?? [];
    if (!services.includes('CloudKit')) {
      mod.modResults['com.apple.developer.icloud-services'] = [...services, 'CloudKit'];
    }

    const containers = mod.modResults['com.apple.developer.icloud-container-identifiers'] ?? [];
    if (!containers.includes(ICLOUD_CONTAINER_ID)) {
      mod.modResults['com.apple.developer.icloud-container-identifiers'] = [
        ...containers,
        ICLOUD_CONTAINER_ID,
      ];
    }

    // Deliberately absent: com.apple.developer.ubiquity-container-identifiers
    // (iCloud Drive documents) and ubiquity-kvstore-identifier. Neither is used
    // — sync goes through CloudKit records, not files — and an entitlement the
    // app doesn't need is one more thing for provisioning to fail on.
    return mod;
  });
};

module.exports = withCloudKit;
module.exports.ICLOUD_CONTAINER_ID = ICLOUD_CONTAINER_ID;
