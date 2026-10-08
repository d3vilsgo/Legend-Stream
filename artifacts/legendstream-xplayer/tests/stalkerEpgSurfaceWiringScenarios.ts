import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";

const source = (path: string) => readFileSync(new NodeURL(path, import.meta.url), "utf8");

export async function runStalkerEpgSurfaceWiringScenarios() {
  const main = source("../components/StalkerMainPage.tsx");
  const paged = source("../components/catalog/PagedCatalogViews.tsx");
  const legacy = source("../components/catalog/StalkerLiveCatalog.tsx");
  const shared = source("../components/OptimizedHomeScreenPaged.tsx");
  let passed = 0;

  const scenario = (name: string, run: () => void) => {
    run();
    passed += 1;
    console.log(`ok surface ${passed} - ${name}`);
  };

  scenario("actual Stalker Live route no longer mounts the E0P diagnostic renderer", () => {
    assert.doesNotMatch(main, /StalkerEpgProbeControl|EPG Yükle · E0P|renderDiagnostic=/);
    assert.doesNotMatch(paged, /renderDiagnostic|EPG Yükle · E0P|E0P tanısını kopyala/);
  });

  scenario("loading and no-channel states do not keep a diagnostic transcript mounted", () => {
    assert.match(paged, /if \(stalkerLive && !categoriesReady\) return <CatalogLoadingSkeleton text=\{t\("loading"\)\} \/>/);
    assert.match(paged, /if \(initialEmpty\) return <CatalogLoadingSkeleton text=\{t\("loading"\)\} \/>/);
  });

  scenario("shared catalog and non-Stalker callers receive no E0P wiring", () => {
    assert.doesNotMatch(paged, /StalkerEpgProbeControl|R18_E0P/);
    assert.doesNotMatch(shared, /renderDiagnostic=|StalkerEpgProbeControl|R18_E0P/);
  });

  scenario("obsolete legacy mount and Stalker product subviews stay free of E0P UI", () => {
    assert.doesNotMatch(legacy, /StalkerEpgProbeControl|R18_E0P/);
    const liveStart = main.indexOf('{presentedView === "live" ? (');
    const moviesStart = main.indexOf('{presentedView === "movies" ? (');
    assert.ok(liveStart >= 0 && moviesStart > liveStart);
    const liveBlock = main.slice(liveStart, moviesStart);
    assert.doesNotMatch(liveBlock, /StalkerEpgProbeControl|renderDiagnostic=/);
    assert.doesNotMatch(main.slice(moviesStart), /renderDiagnostic=/);
  });

  assert.equal(passed, 4);
  console.log("R18-E0P surface wiring scenarios: 4/4 passed");
}
