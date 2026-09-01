import assert from "node:assert/strict";

async function main() {
  const hydration = await import("../lib/m3uCatalogHydration") as any;
  assert.equal(
    typeof hydration.buildM3UDirectHydrationCooperatively,
    "function",
    "runtime M3U hydration must expose a cooperative chunked implementation",
  );

  const provider = {
    id: "provider-large",
    url: "https://panel.example/get.php?username=alice&password=swordfish&type=m3u_plus&output=ts",
  };
  const liveRows = Array.from({ length: 8_001 }, (_, index) => ({
    schemaVersion: 1,
    catalogKind: "live",
    id: `live-${index}`,
    providerId: provider.id,
    name: `Live ${index}`,
    category: "Live",
    playbackRef: {
      type: "m3u-path",
      kind: "live",
      streamId: String(index + 1),
      containerExtension: "ts",
    },
  }));

  let yieldCount = 0;
  const result = await hydration.buildM3UDirectHydrationCooperatively(
    provider,
    liveRows,
    [],
    [],
    {
      batchSize: 200,
      yieldFn: async () => {
        yieldCount += 1;
      },
    },
  );

  assert.equal(result.counts.live, 8_001);
  assert.equal(result.counts.vod, 0);
  assert.equal(result.counts.series, 0);
  assert.equal(
    yieldCount,
    40,
    "8,001 rows at batchSize=200 must yield exactly between the 41 batches",
  );

  console.log("m3u hydration yield scenarios: 1/1 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
