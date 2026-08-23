const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER_START = "// @legendstream abi-splits:start";
const MARKER_END = "// @legendstream abi-splits:end";

const SPLIT_BLOCK = `${MARKER_START}
    def legendStreamAbiSplitEnabled = project.hasProperty("abiSplit")

    splits {
        abi {
            enable legendStreamAbiSplitEnabled
            reset()
            include "arm64-v8a", "armeabi-v7a"
            universalApk false
        }
    }

    applicationVariants.all { variant ->
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
      configWithGradle.modResults.contents = source;
      return configWithGradle;
    }

    const androidBlock = source.indexOf("android {");
    if (androidBlock === -1) {
      throw new Error("Could not find android { block in generated app/build.gradle");
    }

    const insertionPoint = androidBlock + "android {".length;
    source =
      source.slice(0, insertionPoint) +
      `\n${SPLIT_BLOCK}\n` +
      source.slice(insertionPoint);

    configWithGradle.modResults.contents = source;
    return configWithGradle;
  });
};
