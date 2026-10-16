import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.ELITE_PLAYWRIGHT_MODULE || "playwright",
);
const root = resolve(process.argv[2] || ".elite-showcase");
const evidence = resolve(process.argv[3] || "/tmp/legend-elite-evidence");
mkdirSync(evidence, { recursive: true });
const server = createServer((req, res) => {
  const path = resolve(
    root,
    "." + decodeURIComponent(req.url === "/" ? "/index.html" : req.url),
  );
  if (!path.startsWith(root + "/")) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".ttf")
          ? "font/ttf"
          : "text/html; charset=utf-8",
    );
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ELITE_BROWSER_EXECUTABLE
      ? {
          executablePath: process.env.ELITE_BROWSER_EXECUTABLE,
          args: [
            "--no-sandbox",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-dev-shm-usage",
            "--no-zygote",
            "--single-process",
          ],
        }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 2048, height: 1400 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const target = (id) => page.getByTestId(`elite-target:${id}`);
  await target("hero:discover").focus();
  await page
    .locator("#device")
    .screenshot({ path: join(evidence, "elite-home.png") });
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    ),
    "elite-target:hero:live",
  );
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    ),
    "elite-target:hero:discover",
  );
  await target("navigation:live").focus();
  assert.match(
    await page.getByTestId("elite-state").textContent(),
    /Active: home/,
  );
  assert.equal(
    await target("navigation:live").evaluate(
      (e) => getComputedStyle(e).borderColor,
    ),
    "rgb(255, 255, 255)",
  );
  await page.keyboard.press("Enter");
  await target("live:channels").waitFor();
  await target("live:demo:channel:2").focus();
  assert.match(
    await page.getByTestId("elite-state").textContent(),
    /Selected: demo:channel:1/,
  );
  await page.keyboard.press("Enter");
  assert.match(
    await page.getByTestId("elite-state").textContent(),
    /Selected: demo:channel:2/,
  );
  await page
    .locator("#device")
    .screenshot({ path: join(evidence, "elite-live.png") });
  await target("live:channels").focus();
  await page.keyboard.press("Enter");
  await target("overlay:close").waitFor();
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "elite-target:overlay:close",
  );
  assert.equal(
    await target("navigation:home").getAttribute("aria-disabled"),
    "true",
  );
  await page
    .locator("#device")
    .screenshot({ path: join(evidence, "elite-overlay.png") });
  await page.keyboard.press("ArrowDown");
  assert.match(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    ),
    /^elite-target:panel:/,
  );
  await page.keyboard.press("ArrowUp");
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    ),
    "elite-target:overlay:close",
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "elite-target:live:channels",
  );
  assert.equal(await target("overlay:close").count(), 0);
  let cases = 0;
  for (const preset of [
    "tv540",
    "tv720",
    "tv1080",
    "scaled4k",
    "mobile",
    "tablet",
  ])
    for (const font of ["0.85", "1", "1.3", "1.6", "2"])
      for (const safe of [false, true]) {
        await page.getByLabel("Pencere", { exact: true }).selectOption(preset);
        await page.getByLabel("Yazı ölçeği").selectOption(font);
        await page.getByLabel("Güvenli alan").setChecked(safe);
        await target("hero:discover").focus();
        await target("hero:discover").evaluate((e) =>
          e.scrollIntoView({ block: "nearest" }),
        );
        const box = await target("hero:discover").boundingBox(),
          device = await page.locator("#device").boundingBox();
        assert(box && device);
        assert(
          box.x >= device.x - 1 &&
            box.x + box.width <= device.x + device.width + 1,
          `${preset}/${font}/${safe} horizontal clipping`,
        );
        assert(
          box.y >= device.y - 1 &&
            box.y + box.height <= device.y + device.height + 1,
          `${preset}/${font}/${safe} vertical reveal`,
        );
        assert(box.width >= 48 && box.height >= 48);
        cases++;
      }
  await page.getByLabel("Pencere", { exact: true }).selectOption("mobile");
  await page.getByLabel("Yazı ölçeği").selectOption("1");
  await page.getByLabel("Güvenli alan").setChecked(false);
  await target("hero:discover").focus();
  await page
    .locator("#device")
    .screenshot({ path: join(evidence, "elite-mobile.png") });
  const externalRequests = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  await page.goto(pathToFileURL(join(root, "Legend-Elite-V1.html")).href);
  await target("hero:discover").waitFor();
  await target("hero:discover").click();
  await target("overlay:close").waitFor();
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  process.stdout.write(
    `Elite browser: ${cases}/60 responsive render/reveal cases, focus vs active/selected, OK, four-direction helper, overlay isolation and Escape restore and offline standalone HTML passed\n`,
  );
} finally {
  await browser?.close();
  server.close();
}
