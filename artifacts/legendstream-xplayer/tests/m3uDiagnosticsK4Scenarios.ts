import assert from "node:assert/strict";
import {
  createM3UShapeDiagnosticsObserver,
  formatM3UShapeDiagnosticsFields,
} from "../lib/m3uShapeDiagnostics";

const providerHost = "panel-secret.example";
const streamHost = "cdn-secret.example";
const username = "private-user";
const password = "private-password";
const token = "private-token";
const extensionName = "mkv";

const observer = createM3UShapeDiagnosticsObserver(
  `https://${providerHost}:8443/get.php?username=${username}&password=${password}&type=m3u_plus`,
);
observer.observe({
  streamUrl: `https://${streamHost}:9443/series/${username}/${password}/991.${extensionName}?token=${token}`,
  category: "Series",
  extinfDuration: "3600",
  tvgId: "private-tvg-id",
});

const output = formatM3UShapeDiagnosticsFields(observer.snapshot()).join("\n");
assert.match(output, /m3u\.originCompare\.total=1/);
assert.match(output, /m3u\.streamOrigin\.distinctOriginCount=1/);
assert.match(output, /m3u\.pathShape\.hasSeriesSegmentCount=1/);
assert.match(output, /m3u\.extension\.vodLikeCount=1/);
assert.match(output, /m3u\.extinfDuration\.positiveCount=1/);
assert.match(output, /m3u\.tvgId\.presentCount=1/);

for (const secret of [
  "://",
  providerHost,
  streamHost,
  username,
  password,
  token,
  "get.php",
  extensionName,
  "991",
  "private-tvg-id",
]) {
  assert.equal(output.toLowerCase().includes(secret.toLowerCase()), false, `telemetry leaked ${secret}`);
}

assert.doesNotMatch(output, /(?:^|[.=])(?:hostname|host|ip|url|pathname|username|password|token|extensionName)(?:[.=]|$)/i);
console.log("m3u diagnostics K4 scenarios: 1/1 passed");
