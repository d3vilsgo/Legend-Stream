const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Adds Android largeHeap as a safety margin only. The real OOM fix is to avoid
 * materializing large Xtream XMLTV payloads for large catalogs.
 */
module.exports = function withAndroidLargeHeap(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const application = configWithManifest.modResults.manifest.application?.[0];
    if (!application) return configWithManifest;

    application.$ = application.$ || {};
    application.$["android:largeHeap"] = "true";
    return configWithManifest;
  });
};
