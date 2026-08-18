const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// mobile/ is a plain sibling folder next to the Next.js app in the same repo
// (no workspaces). Metro's default projectRoot already keeps module
// resolution scoped to mobile/'s own node_modules; this just stops the file
// watcher from also touching the Next.js app's files/node_modules.
config.watchFolders = [__dirname];

module.exports = withNativeWind(config, { input: "./global.css" });
