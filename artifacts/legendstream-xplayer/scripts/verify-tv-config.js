const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
const bannerPath = path.join(root, "android", "app", "src", "main", "res", "drawable", "tv_banner.png");

const fail = (message) => {
  console.error(`TV config verification failed: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(manifestPath)) fail("generated AndroidManifest.xml is missing");
const manifest = fs.readFileSync(manifestPath, "utf8");
[
  "android.intent.category.LAUNCHER",
  "android.intent.category.LEANBACK_LAUNCHER",
  'android:name="android.software.leanback"',
  'android:name="android.hardware.touchscreen"',
  'android:banner="@drawable/tv_banner"',
].forEach((needle) => {
  if (!manifest.includes(needle)) fail(`manifest does not contain ${needle}`);
});
if (!fs.existsSync(bannerPath)) fail("generated TV banner is missing");
const banner = fs.readFileSync(bannerPath);
if (banner.length < 100 || banner.subarray(1, 4).toString("ascii") !== "PNG") {
  fail("TV banner is not a valid PNG file");
}
console.log("Android TV manifest/banner verification passed.");
