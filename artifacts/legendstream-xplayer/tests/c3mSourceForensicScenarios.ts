import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  beginStalkerPlaybackTrace, clearStalkerTraceEntries, describeC3MSource,
  getStalkerTraceEntries, nextC3MPlayerInstanceSequence,
  sameC3MCatalogIdentity, traceStalker,
} from "../lib/stalkerPlaybackTrace";

const catalogA = "legendstream-catalog://stalker/live/provider-secret/channel-secret";
const catalogB = "legendstream-catalog://stalker/live/provider-secret/another-secret";
const resolved = "https://secret.example/live?token=secret";
assert.equal(describeC3MSource(catalogA), "CATALOG_RUNTIME");
assert.equal(describeC3MSource(resolved), "HTTP_RESOLVED");
assert.equal(describeC3MSource("file:///local"), "LOCAL");
assert.equal(sameC3MCatalogIdentity(catalogA, `${catalogA}`), "YES");
assert.equal(sameC3MCatalogIdentity(catalogA, catalogB), "NO");
assert.equal(sameC3MCatalogIdentity(catalogA, resolved), "UNKNOWN");
assert.equal(nextC3MPlayerInstanceSequence() + 1, nextC3MPlayerInstanceSequence());
clearStalkerTraceEntries();
const traceId = beginStalkerPlaybackTrace();
traceStalker("C3M_SOURCE_TRANSITION", { traceId, fromKind: describeC3MSource(catalogA), toKind: describeC3MSource(resolved), sameCatalogIdentity: sameC3MCatalogIdentity(catalogA, resolved), sameUri: false, sourceProducer: "PLAYER_SELECTION", rawUrl: resolved, fromUri: catalogA });
const serialized = JSON.stringify(getStalkerTraceEntries());
assert.doesNotMatch(serialized, /secret|token|example|catalog:\/\//);
assert.equal(getStalkerTraceEntries()[0]?.details.sourceProducer, "PLAYER_SELECTION");
const player = readFileSync(resolve(__dirname, "../components/CompatibilityVideoPlayerV2.tsx"), "utf8");
assert.match(player, /previousResolve\.source !== currentSource/);
assert.match(player, /c3mProducer\.current = "PLAYER_SELECTION";\s*setCurrentSource\(item\.source\)/);
assert.equal((player.match(/setCurrentSource\(/g) ?? []).length, 1);
assert.match(player, /setResolvedSource\(next\)/);
console.log("PASS C3M source semantics, player sequence, producer path, secret exclusion");
