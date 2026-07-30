const { getDefaultConfig } = require('expo/metro-config');

// Refresh the "What's New" patch notes from git history before every
// bundle — see scripts/generatePatchNotes.js.
require('./scripts/generatePatchNotes')();

const config = getDefaultConfig(__dirname);

module.exports = config;
