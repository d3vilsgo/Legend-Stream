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

  scenario("actual Stalker Live route owns the E0P diagnostic renderer", () => {
    assert.match(main, /import \{ StalkerEpgProbeControl \} from "@\/components\/catalog\/StalkerEpgProbeControl";/);
    assert.match(main, /presentedView === "live"[\s\S]*?<PagedLiveCatalog[\s\S]*?renderDiagnostic=\{\(channel\) => <StalkerEpgProbeControl provider=\{provider\} channel=\{channel\} \/>\}/);
    assert.match(paged, /const diagnostic = renderDiagnostic\?\.\(page\.items\[0\]\) \?\? null;/);
  });

  scenario("loading and no-channel state keep the diagnostic surface mounted", () => {
    assert.match(paged, /if \(stalkerLive && !categoriesReady\) return <CatalogLoadingSkeleton[^>]*>\{diagnostic\}<\/CatalogLoadingSkeleton>/);
    assert.match(paged, /if \(initialEmpty\) return <CatalogLoadingSkeleton[^>]*>\{diagnostic\}<\/CatalogLoadingSkeleton>/);
    assert.match(paged, /renderDiagnostic\?: \(channel\?: Channel\) => React\.ReactNode;/);
  });

  scenario("shared catalog remains opt-in and non-Stalker callers receive no E0P wiring", () => {
    assert.doesNotMatch(paged, /StalkerEpgProbeControl|R18_E0P/);
    assert.doesNotMatch(shared, /renderDiagnostic=|StalkerEpgProbeControl|R18_E0P/);
    assert.match(paged, /renderDiagnostic\?:/);
  });

  scenario("obsolete legacy mount is removed and probe remains Live-only", () => {
    assert.doesNotMatch(legacy, /StalkerEpgProbeControl|R18_E0P/);
    const liveStart = main.indexOf('{presentedView === "live" ? (');
    const moviesStart = main.indexOf('{presentedView === "movies" ? (');
    assert.ok(liveStart >= 0 && moviesStart > liveStart);
    const liveBlock = main.slice(liveStart, moviesStart);
    assert.match(liveBlock, /renderDiagnostic=/);
    assert.doesNotMatch(main.slice(moviesStart), /renderDiagnostic=/);
  });

  assert.equal(passed, 4);
  console.log("R18-E0P surface wiring scenarios: 4/4 passed");
}
