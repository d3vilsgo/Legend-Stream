import assert from "node:assert/strict";
import { resolvePremiumScreenProfile } from "../lib/design/screenProfiles";
import { computePremiumHomeHeroMetrics } from "../lib/design/layoutMetrics";

const portrait = computePremiumHomeHeroMetrics(resolvePremiumScreenProfile({ mode: "mobilePortrait", width: 393, height: 873 }));
const landscape = computePremiumHomeHeroMetrics(resolvePremiumScreenProfile({ mode: "mobileLandscape", width: 873, height: 393 }));
const tv = computePremiumHomeHeroMetrics(resolvePremiumScreenProfile({ mode: "tv", width: 1920, height: 1080 }));

assert.ok(landscape.compact);
assert.ok(!portrait.compact);
assert.ok(landscape.height < portrait.height, "landscape hero must be shorter than portrait");
assert.ok(landscape.height <= 190, "landscape hero must not exceed token cap");
assert.ok(landscape.height <= 0.36 * resolvePremiumScreenProfile({mode:"mobileLandscape",width:873,height:393}).effectiveContentHeight + 1);
assert.ok(portrait.height > 0 && tv.height > 0);
console.log("premium home hero scenarios passed.");
