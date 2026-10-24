import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = readFileSync(
  join(root, ".github/workflows/android-apk.yml"),
  "utf8",
);
const start = source.indexOf(
  "          import hashlib, json, os, pathlib, sys, zipfile",
);
const end = source.indexOf("          PY_RC", start);
assert.ok(start > 0 && end > start);
const script = source
  .slice(start, end)
  .split("\n")
  .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
  .join("\n");
const out = mkdtempSync(join(tmpdir(), "p6-manifest-contract-"));
const env = {
  ...process.env,
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
  GITHUB_RUN_ID: "12345",
};
let checks = 0;
try {
  const create = (abis) => {
    const path = join(out, "fixture.apk");
    const r = spawnSync(
      "python",
      [
        "-c",
        "import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1],'w'); [z.writestr('lib/'+a+'/libvlc.so',b'fixture-native-boundary') for a in json.loads(sys.argv[2])]; z.close()",
        path,
        JSON.stringify(abis),
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    return path;
  };
  const execute = (path) =>
    spawnSync(
      "python",
      ["-", path, "PUBLIC_CERT_FIXTURE", "com.legendstream.xplayer", "60003"],
      { input: script, encoding: "utf8", env },
    );
  let apk = create(["arm64-v8a", "armeabi-v7a"]);
  let result = execute(apk);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(
    readFileSync(join(out, "rc1-build-manifest.json"), "utf8"),
  );
  assert.equal(manifest.sourceCommit, env.GITHUB_SHA);
  assert.equal(manifest.gitShaDisplayedInApp, "01234567");
  assert.deepEqual(manifest.abis, ["arm64-v8a", "armeabi-v7a"]);
  assert.equal(manifest.versionCode, 60003);
  assert.equal(manifest.package, "com.legendstream.xplayer");
  checks++;
  const checksum = readFileSync(apk + ".sha256", "utf8").split(" ")[0];
  assert.equal(manifest.sha256, checksum);
  assert.equal(manifest.bytes, readFileSync(apk).length);
  assert.match(checksum, /^[a-f0-9]{64}$/);
  checks++;
  result = execute(create(["arm64-v8a"]));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Universal ABI verification failed/);
  checks++;
  result = execute(create(["arm64-v8a", "armeabi-v7a", "x86"]));
  assert.notEqual(result.status, 0);
  checks++;
  const verifyCall = source.indexOf(
    'verify_apk "$ARM64_APK" "$EXPECTED_UNIVERSAL_CODE"',
  );
  assert.ok(verifyCall > 0 && verifyCall < start);
  assert.match(source, /apksigner.*verify|verify --verbose --print-certs/);
  assert.match(source, /cert_sha.*EXPECTED_CERT_SHA256/s);
  checks++;
  const gate = source.indexOf("Require exact-SHA Quality before RC APK build"),
    build = source.indexOf("      - name: Build release APKs");
  assert.ok(gate >= 0 && gate < build);
  assert.match(source, /run\.head_sha === context\.sha/);
  assert.match(source, /run\.conclusion !== 'success'/);
  assert.match(source, /release-staging\/rc1-build-manifest\.json/);
  checks++;
  console.log(
    `Elite V4 RC artifact contract: ${checks}/6 passed; FIXTURE_ZIP_NOT_APK_SIGNATURE_ACCEPTANCE`,
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}
