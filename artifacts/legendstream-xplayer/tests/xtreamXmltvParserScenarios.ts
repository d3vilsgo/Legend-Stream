import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Execute the actual parser declarations in isolation: importing iptv.ts in
// Node initializes native playback modules unrelated to XMLTV parsing.
const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../lib/iptv.ts"), "utf8");
const tree = ts.createSourceFile("iptv.ts", source, ts.ScriptTarget.Latest);
const names = new Set(["parseXmlDate", "stripTags", "channelIdMap", "parseProgramme", "parseXmltv", "parseXmltvAsync", "XTREAM_XMLTV_SYNC_BUDGET_MS"]);
const declarations = tree.statements.filter((statement) =>
  (ts.isFunctionDeclaration(statement) && names.has(statement.name?.text ?? "")) ||
  (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && names.has(item.name.text))),
);
assert.equal(declarations.length, names.size, "all parser declarations are present");
const javascript = ts.transpileModule(declarations.map((node) => node.getText(tree).replace(/^export /, "")).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

type Row = { id: string; channelId: string; start: number; end: number; title: string; description?: string };
type ChannelSeed = { id: string; name: string; tvgId: string };
type Parse = (xml: string, channels: ChannelSeed[], now?: number, signal?: AbortSignal, diagnostic?: boolean) => Promise<Row[]>;
let schedulerTurns = 0;
let controllerToAbort: AbortController | null = null;
const scheduler = () => new Promise<void>((done) => setTimeout(() => {
  schedulerTurns += 1;
  controllerToAbort?.abort();
  done();
}, 0));
const parseAttributes = (value: string) => Object.fromEntries(
  [...value.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
);
const functions = new Function(
  "decodeEpgText", "parseAttributes", "recordXtreamEpgCpuStage", "recordXtreamEpgParseYield", "yieldToUi", "yieldXtreamXmltvEventLoop",
  `${javascript}\nreturn { parseXmltv, parseXmltvAsync };`,
)(
  (value: string) => value, parseAttributes, () => undefined, () => undefined,
  () => Promise.resolve(), scheduler,
) as { parseXmltv: (xml: string, channels: ChannelSeed[]) => Row[]; parseXmltvAsync: Parse };

const now = Date.UTC(2026, 8, 22, 12);
const stamp = (hour: number) => `20260922${String(hour).padStart(2, "0")}0000 +0000`;
const channels = Array.from({ length: 120 }, (_, i) => ({ id: `id-${i}`, name: `Channel ${i}`, tvgId: `channel-${i}` }));
const entries = channels.flatMap((channel) => Array.from({ length: 5 }, (_, i) =>
  `<programme channel="${channel.tvgId}" start="${stamp(9 + i)}" stop="${stamp(10 + i)}"><title>${channel.name} ${i}</title><desc>Detail ${i}</desc></programme>`,
));
const xml = `<tv>${entries.reverse().join("")}` +
  `<programme channel="unknown" start="${stamp(9)}" stop="${stamp(10)}"><title>Ignore</title></programme>` +
  `<programme channel="channel-0" start="${stamp(9)}">unfinished</tv>`;

void (async () => {
  const expected = functions.parseXmltv(xml, channels);
  const actual = await functions.parseXmltvAsync(xml, channels, now, undefined, true);
  assert.equal(actual.length, 600);
  assert.deepEqual(actual, expected, "scheduling preserves IDs, channel matching, titles, descriptions, dates, and order");
  assert.ok(schedulerTurns >= 5, "large XML invokes the event-loop scheduler repeatedly");
  controllerToAbort = new AbortController();
  await assert.rejects(
    functions.parseXmltvAsync(xml, channels, now, controllerToAbort.signal, true),
    /EPG background attempt aborted/,
  );
  assert.ok(schedulerTurns >= 6, "aborted work reached a cooperative boundary");
  process.stdout.write("xtream XMLTV parser equivalence, malformed input, yields, and cancellation: PASS\n");
})().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
