import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("app.json"));
const manifestPlugin = read("plugins/withAndroidTv.js");
const abiPlugin = read("plugins/withAndroidAbiSplits.js");
const workflow = readFileSync(path.resolve(root, "../../.github/workflows/android-apk.yml"), "utf8");
const presentation = read("context/UiPresentationContext.tsx");
const focus = read("components/tvPreview/TVPreviewFocus.tsx");
const productShell = read("components/ProductShell.tsx");

assert.equal(app.expo.android.package, "com.legendstream.xplayer");
assert.equal(app.expo.android.versionCode, 60);
assert.equal(app.expo.plugins.includes("./plugins/withAndroidTv"), true);
const buildProperties = app.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties");
assert.ok(buildProperties);
assert.equal(buildProperties[1].android.minSdkVersion, 24);
assert.deepEqual(buildProperties[1].android.buildArchs, ["arm64-v8a", "armeabi-v7a"]);

assert.match(manifestPlugin, /android\.software\.leanback/);
assert.match(manifestPlugin, /android\.hardware\.touchscreen/);
assert.match(manifestPlugin, /category\.LEANBACK_LAUNCHER/);
assert.match(manifestPlugin, /android:banner/);
assert.match(manifestPlugin, /tv-banner\.png/);
assert.match(presentation, /nativeTv:\s*Platform\.isTV/);
assert.match(productShell, /<TVPreviewControls\s*\/>/);
assert.match(focus, /if\s*\(!tvPreview\)\s*return null/);
assert.match(focus, /focusable=\{!disabled && \(focus\.enabled \|\| Platform\.isTV/);
assert.match(focus, /Platform\.isTV && nativeFocused/);

for (const mode of ["arm64", "dual-abi", "universal"]) assert.match(workflow, new RegExp(`- ${mode}`));
assert.match(workflow, /-PabiUniversal/);
assert.match(workflow, /EXPECTED_UNIVERSAL_CODE=.*\+ 3/);
assert.match(workflow, /lib\/\$abi\/libvlc\.so/);
assert.match(workflow, /Universal APK missing ABI directory/);
assert.match(workflow, /verify --verbose --print-certs/);
assert.match(workflow, /EXPECTED_CERT_SHA256/);
assert.match(workflow, /universal_artifact_name/);
assert.match(workflow, /HEAD_COMMIT_MESSAGE.*\[universal\]/);
assert.match(abiPlugin, /variant\.versionCode \* 1000 \+ 3/);
assert.match(abiPlugin, /if \(project\.hasProperty\("abiUniversal"\)\)[\s\S]*?ndk \{[\s\S]*?abiFilters "arm64-v8a", "armeabi-v7a"/);
assert.match(abiPlugin, /def legendStreamAbiSplitEnabled = project\.hasProperty\("abiSplit"\)/);
assert.match(abiPlugin, /if \(legendStreamAbiSplitEnabled\)[\s\S]*?output\.versionCodeOverride/);

console.log("Native Android TV and universal APK build contract scenarios passed.");
