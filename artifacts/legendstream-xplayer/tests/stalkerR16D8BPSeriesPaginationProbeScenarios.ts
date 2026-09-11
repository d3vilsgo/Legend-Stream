import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildSeriesFieldInventory,
  compareSeriesIdSets,
  createStalkerSeriesPaginationEvidenceProbe,
  fingerprintSeriesId,
  STALKER_SERIES_D8_BP_LIMITS,
} from "../lib/stalkerSeriesPaginationEvidenceProbe";

type Params = Record<string, string | number | boolean | undefined>;

const fakeSecrets = [
  "FAKE_CMD_SECRET",
  "FAKE_TOKEN_SECRET",
  "FAKE_COOKIE_SECRET",
  "FAKE_MAC_SECRET",
  "https://secret.invalid/private.jpg?token=FAKE_URL_SECRET",
  "Bearer FAKE_AUTH_SECRET",
];

const pageRows = [
  [
    { id: "series:001", name: "Alpha", description: "A", year: "2024", cover_image: "https://cdn.invalid/a.jpg", cmd: fakeSecrets[0], token: fakeSecrets[1], cookie: fakeSecrets[2], mac: fakeSecrets[3], url: fakeSecrets[4], authorization: fakeSecrets[5] },
    { id: "series:002", name: "Beta", description: "", year: "2023", cover_image: "/images/b.jpg" },
    { id: "series:003", name: "Gamma", description: "C", rating: 8.2, cover_image: "" },
  ],
  [
    { id: "series:004", name: "Delta" },
    { id: "series:005", name: "Epsilon" },
    { id: "series:006", name: "Zeta" },
  ],
  [
    { id: "series:006", name: "Zeta" },
    { id: "series:007", name: "Eta" },
  ],
];

async function main() {
  const calls: Params[] = [];
  const session = {
    async handshake() { return { authenticated: true as const }; },
    async request(params: Params) {
      calls.push({ ...params });
      if (params.action !== "get_ordered_list") throw new Error("unexpected action");
      if (params.category === "raw-category:42") {
        const page = Number(params.p);
        const rows = pageRows[page - 1] ?? [];
        return { js: { cur_page: page - 1, total_items: 30, max_page_items: 10, data: rows } };
      }
      if (params.movie_id === "series:001") {
        return {
          js: {
            selected_item: { description: "detail metadata", year: "2024" },
            data: [
              { season_num: 1, series: [1, 2], cmd: "FAKE_DETAIL_CMD" },
              { season_num: 2, series: [3], cmd: "FAKE_DETAIL_CMD_2" },
            ],
          },
        };
      }
      throw new Error(`unexpected request ${JSON.stringify(params)}`);
    },
  };

  const controller = createStalkerSeriesPaginationEvidenceProbe(session as any);
  const evidence = await controller.runPages({ id: "raw-category:42", title: "Drama" });

  assert.deepEqual(calls.slice(0, 3), [
    { type: "series", action: "get_ordered_list", category: "raw-category:42", p: 1 },
    { type: "series", action: "get_ordered_list", category: "raw-category:42", p: 2 },
    { type: "series", action: "get_ordered_list", category: "raw-category:42", p: 3 },
  ]);
  assert.equal(calls.length, 3);
  await assert.rejects(() => controller.runPages({ id: "raw-category:42", title: "Drama" }));
  assert.equal(calls.length, 3, "single-use guard must prevent a fourth page request");

  assert.deepEqual(evidence.pages.map((page) => page.responseCurPage), [0, 1, 2]);
  assert.deepEqual(evidence.pages.map((page) => page.returnedRowCount), [3, 3, 2]);
  assert.equal(evidence.pages[1]!.overlapWithPreviousPage, 0);
  assert.equal(evidence.pages[1]!.newIdsVsPreviousPage, 3);
  assert.equal(evidence.pages[1]!.identicalSetWithPreviousPage, false);
  assert.equal(evidence.pages[2]!.overlapWithPreviousPage, 1);
  assert.equal(evidence.pages[2]!.newIdsVsPreviousPage, 1);

  const expectedFingerprint = fingerprintSeriesId("series:001");
  assert.equal(fingerprintSeriesId("series:001"), expectedFingerprint);
  assert.notEqual(expectedFingerprint, "series:001");
  assert.equal(expectedFingerprint.length, 8);
  assert.equal(evidence.pages[0]!.firstRowFingerprint, expectedFingerprint);

  assert.deepEqual(compareSeriesIdSets(new Set(["b", "c"]), new Set(["a", "b"])), { overlap: 1, fresh: 1, identical: false });

  const inventory = buildSeriesFieldInventory(pageRows[0]!);
  const description = inventory.fieldInventory.find((field) => field.field === "description")!;
  assert.equal(description.presentCount, 3);
  assert.equal(description.nonEmptyCount, 2);
  assert.deepEqual(description.primitiveTypes, ["string"]);
  const cmd = inventory.fieldInventory.find((field) => field.field === "cmd")!;
  assert.equal(cmd.sensitive, true);
  const cover = inventory.imageCandidates.find((field) => field.field === "cover_image")!;
  assert.equal(cover.presentCount, 3);
  assert.equal(cover.nonEmptyCount, 2);
  assert.equal(cover.valueShape, "mixed");
  assert.equal(inventory.imageCandidates.some((field) => field.field === "screenshot_uri"), false);

  assert.equal(evidence.metadata.description.observed, true);
  assert.equal(evidence.metadata.description.nonEmpty, true);
  assert.equal(evidence.metadata.year.observed, true);
  assert.equal(evidence.metadata.rating.observed, true);
  assert.equal(evidence.metadata.genre.observed, false);
  assert.equal(evidence.metadata.director.observed, false);
  assert.equal(evidence.metadata.actors.observed, false);

  const serialized = JSON.stringify(evidence);
  for (const secret of fakeSecrets) assert.equal(serialized.includes(secret), false, `diagnostic output leaked ${secret}`);
  for (const rawId of ["series:001", "series:002", "series:003", "raw-category:42"]) assert.equal(serialized.includes(rawId), false, `diagnostic output leaked raw id ${rawId}`);

  const candidate = evidence.detailCandidates.find((item) => item.key === expectedFingerprint)!;
  assert.ok(candidate);
  const detail = await controller.runDetail(candidate.key);
  assert.deepEqual(calls.at(-1), { type: "series", action: "get_ordered_list", movie_id: "series:001", p: 1 });
  assert.equal(calls.length, 4);
  assert.deepEqual(detail.detailSeriesMetadataFields, ["description", "year"]);
  assert.equal(detail.detailSeasonRows, 2);
  assert.deepEqual(detail.detailEmbeddedEpisodeCounts, [2, 1]);
  assert.equal(detail.detailMetadataSource, "LIST_AND_DETAIL");
  assert.equal(JSON.stringify(detail).includes("FAKE_DETAIL_CMD"), false);
  await assert.rejects(() => controller.runDetail(candidate.key));
  assert.equal(calls.length, 4, "single-use guard must prevent a second detail request");
  assert.equal(calls.filter((call) => call.action === "create_link").length, 0);

  assert.equal(STALKER_SERIES_D8_BP_LIMITS.maxPageRequests, 3);
  assert.equal(STALKER_SERIES_D8_BP_LIMITS.maxDetailRequests, 1);
  assert.equal(STALKER_SERIES_D8_BP_LIMITS.maxCreateLinkRequests, 0);
  assert.equal(STALKER_SERIES_D8_BP_LIMITS.playerHandoffs, 0);
  assert.equal(STALKER_SERIES_D8_BP_LIMITS.fallbackDialects, 0);

  const root = path.resolve(__dirname, "..");
  const helperSource = fs.readFileSync(path.join(root, "lib/stalkerSeriesPaginationEvidenceProbe.ts"), "utf8");
  const panelSource = fs.readFileSync(path.join(root, "components/stalker/StalkerSeriesPaginationProbePanel.tsx"), "utf8");
  const productSurface = fs.readFileSync(path.join(root, "components/stalker/StalkerSeriesProductSurface.tsx"), "utf8");
  assert.doesNotMatch(helperSource, /screenshot_uri/);
  assert.match(panelSource, /DISCOVERY ONLY · NO PLAYBACK · MAX 3 PAGE REQUESTS/);
  assert.match(panelSource, /raw ID gösterilmez/);
  assert.doesNotMatch(panelSource, /NativeVideoPlayer|create_link.*onPress/);
  assert.doesNotMatch(productSurface, /PaginationEvidenceProbe|D8-BP/);

  console.log("R16-D8-BP bounded Series pagination + metadata evidence probe scenarios: PASS");
}

void main();
