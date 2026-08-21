const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Enable Android Picture-in-Picture with the smallest possible manifest delta.
 *
 * Do not rewrite MainActivity configChanges here. Expo and the screen-orientation
 * plugin already own that lifecycle surface; adding a second configChanges policy
 * previously made player/orientation regressions much harder to isolate.
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
