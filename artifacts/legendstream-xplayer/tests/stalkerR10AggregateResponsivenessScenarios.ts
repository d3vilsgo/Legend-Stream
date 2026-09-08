import assert from "node:assert/strict";
import {
  STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE,
  normalizeStalkerLiveAggregateCooperatively,
} from "../lib/stalkerLiveDiscovery";
import { StalkerPortalError } from "../lib/stalkerPortal";

let passed = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}

function syntheticAggregate(total: number, onIdRead: () => void) {
  return {
    data: Array.from({ length: total }, (_, index) => {
      const portalId = String(index + 1);
      return {
        get id() {
          onIdRead();
          return portalId;
        },
        name: `Channel ${portalId}`,
        cmd: `ffmpeg opaque-command-${portalId}`,
        tv_genre_id: "1",
      };
    }),
    total_items: total,
  };
}

async function verifyBoundedAggregate(total: number) {
  let normalizedRowsObserved = 0;
  const rowsAtYield: number[] = [];
  let clock = 0;
  const payload = syntheticAggregate(total, () => {
    normalizedRowsObserved += 1;
    clock += 1;
  });

  const result = await normalizeStalkerLiveAggregateCooperatively({
    payload,
    providerId: "r10-synthetic",
    categories: [{ id: "1", name: "Live" }],
    networkWaitMs: 37,
    nowFn: () => clock,
    yieldFn: async () => {
      rowsAtYield.push(normalizedRowsObserved);
      clock += 1;
    },
  });

  assert.equal(result.kind, "complete");
  if (result.kind !== "complete") throw new Error("aggregate unexpectedly fell back");
  assert.equal(result.rows.length, total);
  assert.equal(normalizedRowsObserved, total);
  assert.equal(
    rowsAtYield.length,
    Math.ceil(total / STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE),
  );
  assert.equal(rowsAtYield[0], Math.min(total, STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE));

  let previous = 0;
  for (const observed of rowsAtYield) {
    const synchronousRowsSinceLastYield = observed - previous;
    assert.ok(synchronousRowsSinceLastYield > 0);
    assert.ok(
      synchronousRowsSinceLastYield <= STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE,
      `unbounded aggregate slice observed: ${synchronousRowsSinceLastYield}`,
    );
    previous = observed;
  }
}

async function main() {
  await scenario("1100-row aggregate yields at bounded 250-row normalization intervals", async () => {
    await verifyBoundedAggregate(1_100);
  });

  await scenario("5100-row aggregate remains cooperatively bounded", async () => {
    await verifyBoundedAggregate(5_100);
  });

  await scenario("10100-row aggregate remains cooperatively bounded", async () => {
    await verifyBoundedAggregate(10_100);
  });

  await scenario("duplicate stable id across aggregate chunks still fails closed", async () => {
    const data = Array.from({ length: STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE + 1 }, (_, index) => ({
      id: index === STALKER_AGGREGATE_NORMALIZE_CHUNK_SIZE ? 1 : index + 1,
      name: `Channel ${index + 1}`,
      cmd: `ffmpeg opaque-command-${index + 1}`,
      tv_genre_id: "1",
    }));
    let yields = 0;
    await assert.rejects(
      normalizeStalkerLiveAggregateCooperatively({
        payload: { data },
        providerId: "r10-duplicate",
        networkWaitMs: 0,
        yieldFn: async () => { yields += 1; },
      }),
      (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "INVALID_RESPONSE",
    );
    assert.equal(yields, 1);
  });

  assert.equal(passed, 4);
  process.stdout.write("stalker R10 aggregate responsiveness scenarios: 4/4 passed\n");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
