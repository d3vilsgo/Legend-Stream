const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER_START = "// @legendstream abi-splits:start";
const MARKER_END = "// @legendstream abi-splits:end";
const UNIVERSAL_FILTER_START = "// @legendstream universal-abi-filter:start";
const UNIVERSAL_FILTER_END = "// @legendstream universal-abi-filter:end";

const UNIVERSAL_FILTER_BLOCK = `${UNIVERSAL_FILTER_START}
        if (project.hasProperty("abiUniversal")) {
            // Filter native libraries from every Android dependency, not only React Native.
            ndk {
                abiFilters "arm64-v8a", "armeabi-v7a"
            }
        }
${UNIVERSAL_FILTER_END}`;

const SPLIT_BLOCK = `${MARKER_START}
    def legendStreamAbiSplitEnabled = project.hasProperty("abiSplit")
    def legendStreamAbiOnly = project.findProperty("abiOnly")?.toString()
    def legendStreamUniversalApk = project.hasProperty("abiUniversal")

    splits {
        abi {
            enable legendStreamAbiSplitEnabled
            reset()
            if (legendStreamAbiOnly) {
                include legendStreamAbiOnly
            } else {
                include "arm64-v8a", "armeabi-v7a"
            }
            universalApk false
        }
    }

    applicationVariants.all { variant ->
        if (legendStreamUniversalApk) {
            variant.outputs.each { output ->
                // Keep one universal APK upgrade-compatible with either ABI split.
                output.versionCodeOverride = variant.versionCode * 1000 + 3
            }
        }
        if (legendStreamAbiSplitEnabled) {
            variant.outputs.each { output ->
                def abi = output.getFilter(com.android.build.OutputFile.ABI)
                if (abi != null) {
                    def abiCode = ["armeabi-v7a": 1, "arm64-v8a": 2][abi]
                    output.versionCodeOverride = variant.versionCode * 1000 + abiCode
                }
            }
        }
    }
${MARKER_END}`;

module.exports = function withAndroidAbiSplits(config) {
  return withAppBuildGradle(config, (configWithGradle) => {
    if (configWithGradle.modResults.language !== "groovy") {
      throw new Error("LegendStream ABI split plugin expects a Groovy app/build.gradle");
    }

    let source = configWithGradle.modResults.contents;

    const existingStart = source.indexOf(MARKER_START);
    const existingEnd = source.indexOf(MARKER_END);
    if (existingStart !== -1 && existingEnd !== -1 && existingEnd > existingStart) {
      source =
        source.slice(0, existingStart) +
        SPLIT_BLOCK +
        source.slice(existingEnd + MARKER_END.length);
    } else {
      const androidBlock = source.indexOf("android {");
      if (androidBlock === -1) {
        throw new Error("Could not find android { block in generated app/build.gradle");
      }
      const insertionPoint = androidBlock + "android {".length;
      source =
        source.slice(0, insertionPoint) +
        `\n${SPLIT_BLOCK}\n` +
        source.slice(insertionPoint);
    }

    const universalFilterStart = source.indexOf(UNIVERSAL_FILTER_START);
    const universalFilterEnd = source.indexOf(UNIVERSAL_FILTER_END);
    if (universalFilterStart !== -1 && universalFilterEnd !== -1 && universalFilterEnd > universalFilterStart) {
      source =
        source.slice(0, universalFilterStart) +
        UNIVERSAL_FILTER_BLOCK +
        source.slice(universalFilterEnd + UNIVERSAL_FILTER_END.length);
    } else {
      const defaultConfigBlock = source.indexOf("defaultConfig {");
      if (defaultConfigBlock === -1) {
        throw new Error("Could not find defaultConfig { block in generated app/build.gradle");
      }
      const insertionPoint = defaultConfigBlock + "defaultConfig {".length;
      source =
        source.slice(0, insertionPoint) +
        `\n${UNIVERSAL_FILTER_BLOCK}\n` +
        source.slice(insertionPoint);
    }

    configWithGradle.modResults.contents = source;
    return configWithGradle;
  });
};
