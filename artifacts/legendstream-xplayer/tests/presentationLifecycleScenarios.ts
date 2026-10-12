import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDevicePresentation } from "../lib/devicePresentation";
import { createOrientationOwnershipCoordinator } from "../lib/orientationOwnership";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
let passed = 0;
const scenario = async (name: string, run: () => void | Promise<void>) => {
  await run();
  passed += 1;
  console.log(`ok presentation lifecycle ${passed} - ${name}`);
};

async function main() {
  await scenario(
    "phone catalog policy is portrait in both dimension orders",
    () => {
      for (const [width, height] of [
        [393, 873],
        [873, 393],
      ]) {
        const result = resolveDevicePresentation({
          width,
          height,
          nativeTv: false,
        });
        assert.equal(result.deviceClass, "phone");
        assert.equal(result.catalogOrientation, "portrait");
      }
    },
  );

  await scenario(
    "tablet catalog policy remains free in portrait and landscape",
    () => {
      assert.equal(
        resolveDevicePresentation({ width: 800, height: 1280, nativeTv: false })
          .catalogOrientation,
        "free",
      );
      assert.equal(
        resolveDevicePresentation({ width: 1280, height: 800, nativeTv: false })
          .catalogOrientation,
        "free",
      );
    },
  );

  await scenario("native TV classification remains separate", () => {
    const result = resolveDevicePresentation({
      width: 1920,
      height: 1080,
      nativeTv: true,
    });
    assert.deepEqual([result.deviceClass, result.catalogMode], ["tv", "tv"]);
  });

  await scenario(
    "player acquires ownership only after pending catalog work settles",
    async () => {
      const coordinator = createOrientationOwnershipCoordinator();
      const calls: string[] = [];
      let releaseLock!: () => void;
      const lockPending = new Promise<void>((resolveLock) => {
        releaseLock = resolveLock;
      });
      coordinator.registerCatalogPolicy("portrait", {
        lockPortrait: async () => {
          calls.push("catalog-lock-start");
          await lockPending;
          calls.push("catalog-lock-end");
        },
        unlock: () => {
          calls.push("catalog-unlock");
        },
      });
      await Promise.resolve();
      assert.deepEqual(calls, ["catalog-lock-start"]);
      const acquired = coordinator
        .acquirePlayer()
        .then(() => calls.push("player-acquired"));
      releaseLock();
      await acquired;
      assert.deepEqual(calls, [
        "catalog-lock-start",
        "catalog-lock-end",
        "player-acquired",
      ]);
    },
  );

  await scenario(
    "phone player exit hands portrait ownership back before catalog render",
    async () => {
      const coordinator = createOrientationOwnershipCoordinator();
      const calls: string[] = [];
      coordinator.registerCatalogPolicy("portrait", {
        lockPortrait: () => {
          calls.push("portrait");
        },
        unlock: () => {
          calls.push("unlock");
        },
      });
      await coordinator.acquirePlayer();
      calls.length = 0;
      assert.equal(await coordinator.handoffPlayerToCatalog(), true);
      calls.push("catalog-render");
      assert.deepEqual(calls, ["portrait", "catalog-render"]);
    },
  );

  await scenario(
    "phone player portrait to landscape exits into portrait catalog",
    async () => {
      const coordinator = createOrientationOwnershipCoordinator();
      const calls: string[] = ["player-portrait", "player-landscape"];
      coordinator.registerCatalogPolicy("portrait", {
        lockPortrait: () => {
          calls.push("catalog-portrait");
        },
        unlock: () => {
          calls.push("catalog-free");
        },
      });
      await coordinator.acquirePlayer();
      calls.length = 2;
      await coordinator.handoffPlayerToCatalog();
      assert.deepEqual(calls, [
        "player-portrait",
        "player-landscape",
        "catalog-portrait",
      ]);
    },
  );

  await scenario(
    "phone player landscape to portrait keeps portrait catalog handoff",
    async () => {
      const coordinator = createOrientationOwnershipCoordinator();
      const calls: string[] = ["player-landscape", "player-portrait"];
      coordinator.registerCatalogPolicy("portrait", {
        lockPortrait: () => {
          calls.push("catalog-portrait");
        },
        unlock: () => {
          calls.push("catalog-free");
        },
      });
      await coordinator.acquirePlayer();
      calls.length = 2;
      await coordinator.handoffPlayerToCatalog();
      assert.deepEqual(calls, [
        "player-landscape",
        "player-portrait",
        "catalog-portrait",
      ]);
    },
  );

  await scenario(
    "tablet player exit restores free rotation before catalog render",
    async () => {
      const coordinator = createOrientationOwnershipCoordinator();
      const calls: string[] = [];
      coordinator.registerCatalogPolicy("free", {
        lockPortrait: () => {
          calls.push("portrait");
        },
        unlock: () => {
          calls.push("unlock");
        },
      });
      await coordinator.acquirePlayer();
      calls.length = 0;
      await coordinator.handoffPlayerToCatalog();
      calls.push("catalog-render");
      assert.deepEqual(calls, ["unlock", "catalog-render"]);
    },
  );

  await scenario(
    "native TV preserve policy does not issue mobile locks",
    async () => {
      const coordinator = createOrientationOwnershipCoordinator();
      const calls: string[] = [];
      coordinator.registerCatalogPolicy("preserve", {
        lockPortrait: () => {
          calls.push("portrait");
        },
        unlock: () => {
          calls.push("unlock");
        },
      });
      await coordinator.acquirePlayer();
      await coordinator.handoffPlayerToCatalog();
      assert.deepEqual(calls, []);
    },
  );

  await scenario(
    "rapid player enter exit cycles leave catalog as owner",
    async () => {
      const coordinator = createOrientationOwnershipCoordinator();
      coordinator.registerCatalogPolicy("portrait", {
        lockPortrait: () => undefined,
        unlock: () => undefined,
      });
      for (let index = 0; index < 5; index += 1) {
        await coordinator.acquirePlayer();
        await coordinator.handoffPlayerToCatalog();
      }
      assert.equal(coordinator.snapshot().owner, "catalog");
    },
  );

  await scenario(
    "stale delayed catalog policy cannot run after player acquisition",
    async () => {
      const coordinator = createOrientationOwnershipCoordinator();
      const calls: string[] = [];
      coordinator.registerCatalogPolicy("portrait", {
        lockPortrait: () => {
          calls.push("portrait");
        },
        unlock: () => {
          calls.push("unlock");
        },
      });
      await coordinator.acquirePlayer();
      assert.equal(coordinator.snapshot().owner, "player");
      await Promise.resolve();
      assert.deepEqual(calls, []);
    },
  );

  await scenario("provider switch does not own orientation policy", () => {
    const shell = source("components/ProductShell.tsx");
    const context = source("context/UiPresentationContext.tsx");
    assert.doesNotMatch(
      shell,
      /ScreenOrientation|registerCatalogOrientationPolicy/,
    );
    assert.match(context, /registerCatalogOrientationPolicy/);
  });

  await scenario(
    "background foreground reasserts only the active catalog owner",
    () => {
      const context = source("context/UiPresentationContext.tsx");
      assert.match(context, /state === "active"/);
      assert.match(context, /reassertCatalogOrientationPolicy/);
    },
  );

  await scenario(
    "player handoff completes before fullscreen exit callback",
    () => {
      const hook = source("hooks/usePlayerOrientation.ts");
      const player = source("components/CompatibilityVideoPlayerV2.tsx");
      assert.match(hook, /await handoffPlayerOrientationToCatalog\(\)/);
      assert.ok(
        player.indexOf("await orientation.restore()") <
          player.indexOf("onFullscreenExit?.()"),
      );
      for (const forbidden of [
        "setTimeout",
        "playbackUrl",
        "LibVLC",
        "credential",
        "Stalker",
        "Xtream",
        "M3U",
      ]) {
        assert.equal(
          source("lib/orientationOwnership.ts").includes(forbidden),
          false,
          `ownership leaked ${forbidden}`,
        );
      }
    },
  );

  assert.equal(passed, 14);
  console.log("presentation lifecycle scenarios: 14/14 passed");
}

void main();
