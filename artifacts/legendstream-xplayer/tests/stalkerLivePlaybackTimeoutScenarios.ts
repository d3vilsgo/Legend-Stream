import assert from "node:assert/strict";
import { resolveStalkerLiveCreateLink } from "../lib/stalkerLiveCatalog";
import { StalkerPortalError } from "../lib/stalkerPortal";

async function main() {
  const session = {
    request: async () => {
      throw new StalkerPortalError("TIMEOUT", "Stalker portal request timed out.");
    },
  };

  await assert.rejects(
    resolveStalkerLiveCreateLink(session, "ffmpeg http://canonical.invalid/cmd"),
    (caught: unknown) => caught instanceof StalkerPortalError && caught.code === "TIMEOUT",
  );
  console.log("stalker live create_link timeout scenarios: 1/1 passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
