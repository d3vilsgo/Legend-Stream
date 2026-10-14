const { withAndroidManifest } = require("expo/config-plugins");
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const LEANBACK_ACTION = "android.intent.action.MAIN";
const LEANBACK_CATEGORY = "android.intent.category.LEANBACK_LAUNCHER";

module.exports = function withAndroidTv(config) {
  config = withDangerousMod(config, ["android", async (modConfig) => {
    const source = path.join(modConfig.modRequest.projectRoot, "assets/images/tv-banner.png");
    const destination = path.join(modConfig.modRequest.platformProjectRoot, "app/src/main/res/drawable-nodpi/tv_banner.png");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    return modConfig;
  }]);
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    manifest["uses-feature"] = manifest["uses-feature"] || [];
    const features = manifest["uses-feature"];
    const setFeature = (name, required) => {
      const entry = features.find((feature) => feature.$?.["android:name"] === name);
      if (entry) entry.$["android:required"] = required;
      else features.push({ $: { "android:name": name, "android:required": required } });
    };
    setFeature("android.software.leanback", "false");
    setFeature("android.hardware.touchscreen", "false");

    const application = manifest.application?.[0];
    const activity = application?.activity?.find((item) => item.$?.["android:name"]?.endsWith(".MainActivity"));
    if (!activity) throw new Error("Android TV plugin could not find MainActivity in generated manifest");
    activity.$["android:banner"] = "@drawable/tv_banner";
    activity["intent-filter"] = activity["intent-filter"] || [];
    const hasLeanbackFilter = activity["intent-filter"].some((filter) =>
      filter.action?.some((item) => item.$?.["android:name"] === LEANBACK_ACTION) &&
      filter.category?.some((item) => item.$?.["android:name"] === LEANBACK_CATEGORY),
    );
    if (!hasLeanbackFilter) {
      activity["intent-filter"].push({
        action: [{ $: { "android:name": LEANBACK_ACTION } }],
        category: [
          { $: { "android:name": LEANBACK_CATEGORY } },
          { $: { "android:name": "android.intent.category.DEFAULT" } },
        ],
      });
    }
    return configWithManifest;
  });
};
