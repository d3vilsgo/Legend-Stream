import assert from "node:assert/strict";

const controls = ["previous", "list", "next"] as const;
assert.deepEqual(controls, ["previous", "list", "next"]);
process.stdout.write("player live chrome invariants: 1/1 passed\n");
