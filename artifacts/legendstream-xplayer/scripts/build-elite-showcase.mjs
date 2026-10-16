import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
// tsx's declared esbuild compiler; no new dependency or lockfile update.
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const out = resolve(process.argv[2] ?? join(root, ".elite-showcase"));
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, "showcase/elite.web.tsx")],
  outfile: join(out, "elite.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
  alias: { "react-native": require.resolve("react-native-web") },
  resolveExtensions: [
    ".web.tsx",
    ".tsx",
    ".web.ts",
    ".ts",
    ".web.js",
    ".js",
    ".json",
  ],
  mainFields: ["browser", "module", "main"],
  loader: { ".ttf": "file" },
  minify: true,
});
const fonts = dirname(require.resolve("@expo-google-fonts/inter/package.json"));
for (const [dir, name] of [
  ["400Regular", "Inter_400Regular"],
  ["700Bold", "Inter_700Bold"],
])
  copyFileSync(join(fonts, dir, name + ".ttf"), join(out, name + ".ttf"));
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Legend Elite — Tasarım Laboratuvarı</title><style>
@font-face{font-family:Inter_400Regular;src:url(Inter_400Regular.ttf)}@font-face{font-family:Inter_700Bold;src:url(Inter_700Bold.ttf)}
*{box-sizing:border-box}body{margin:0;background:#05070a;color:#f4f7fa;font-family:Inter_400Regular,system-ui}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 32px;border-bottom:1px solid #26313e;flex-wrap:wrap}header strong{letter-spacing:3px}small{color:#67e8d1}header span{display:block;color:#adb9c7;font-size:12px;margin-top:8px}nav{display:flex;gap:18px;align-items:center;flex-wrap:wrap}label{font-size:12px;color:#adb9c7}select{margin-left:8px;background:#1c2530;color:white;border:1px solid #34414f;padding:8px;border-radius:8px}main{overflow:auto;padding:28px}#device{margin:auto;border:1px solid #34414f;border-radius:16px;overflow:hidden;box-shadow:0 24px 80px #000}[data-testid^="elite-target:"]:focus{outline:none!important}footer{padding:12px 32px 24px;color:#adb9c7;font-size:12px}button:focus-visible,select:focus-visible{outline:2px solid #67e8d1;outline-offset:3px}</style></head><body><div id="root"></div><script src="elite.js"></script></body></html>`,
);
process.stdout.write(`Elite showcase: ${out}/index.html\n`);

let standalone = readFileSync(join(out, "index.html"), "utf8");
for (const name of ["Inter_400Regular", "Inter_700Bold"])
  standalone = standalone.replace(
    `url(${name}.ttf)`,
    `url(data:font/ttf;base64,${readFileSync(join(out, name + ".ttf")).toString("base64")})`,
  );
standalone = standalone.replace(
  '<script src="elite.js"></script>',
  "<script>" +
    readFileSync(join(out, "elite.js"), "utf8").replaceAll(
      "</script",
      "<\\/script",
    ) +
    "</script>",
);
writeFileSync(join(out, "Legend-Elite-V1.html"), standalone);
