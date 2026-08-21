const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Minimal PiP manifest plugin.
 * Keep orientation/configChanges ownership with Expo and
 * expo-screen-orientation; PiP only declares the two Activity capabilities it
 * actually needs.
 */
module.exports = function withLegendStreamPip(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application?.activity) return configWithManifest;

    const mainActivity = application.activity.find((activity) => {
      const filters = activity["intent-filter"] || [];
      return filters.some((filter) => {
        const actions = filter.action || [];
        return actions.some(
          (action) => action?.$?.["android:name"] === "android.intent.action.MAIN",
        );
      });
    }) || application.activity[0];

    if (!mainActivity?.$) return configWithManifest;

    mainActivity.$["android:supportsPictureInPicture"] = "true";
    mainActivity.$["android:resizeableActivity"] = "true";

    return configWithManifest;
  });
};
