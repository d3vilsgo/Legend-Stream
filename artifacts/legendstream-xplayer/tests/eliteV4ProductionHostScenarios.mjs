import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(resolve(app, "../api-server/package.json"))(
  "esbuild",
);
const out = mkdtempSync(join(tmpdir(), "elite-v4-host-"));
let checks = 0;
const reactMock = `
  export function createContext(value){const context={_value:value};context.Provider={_context:context};return context;}
  export function useContext(context){return context._value;}
  export function useState(value){let current=typeof value==='function'?value():value;return [current,next=>{current=typeof next==='function'?next(current):next}];}
  let handle=200;export function useRef(value){return {current:value??{handle:handle++}};}
  export function useMemo(factory){return factory();}
  export function useCallback(callback){return callback;}
  export function useEffect(_effect){}
  export function createElement(type,props,...children){return {type,props:{...(props??{}),children}};}
  export default {createElement,useContext,useState,useRef,useMemo,useCallback,useEffect};
`;
const nativeMock = `
  export const Pressable='Pressable',Image='Image',ImageBackground='ImageBackground',ScrollView='ScrollView',Text='Text',View='View';export const Platform={isTV:false};
  export function findNodeHandle(ref){return ref?.handle??null;}
`;
try {
  await build({
    stdin: {
      contents: `export {EliteV4FocusSurface,EliteV4FocusButton} from './components/eliteV4/EliteV4FocusSurface';export {EliteV4Sidebar} from './components/eliteV4/EliteV4Sidebar';export {EliteV4Hero} from './components/eliteV4/EliteV4Hero';export {EliteV4ContentRail} from './components/eliteV4/EliteV4ContentRail';export {EliteV4Home} from './components/eliteV4/EliteV4Home';export {EliteV4PreviewToggle} from './components/eliteV4/EliteV4PreviewToggle';export {eliteV4Theme} from './lib/design/eliteV4Theme';`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "elite-v4.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "host-mocks",
        setup(build) {
          build.onResolve({ filter: /^react$/ }, () => ({
            path: "react",
            namespace: "host",
          }));
          build.onResolve({ filter: /^react-native$/ }, () => ({
            path: "react-native",
            namespace: "host",
          }));
          build.onResolve({ filter: /^@\/components\/tvPreview\/TVPreviewFocus$/ }, () => ({
            path: "tv-preview-focus",
            namespace: "host",
          }));
          build.onResolve({ filter: /^@expo\/vector-icons$/ }, () => ({
            path: "icons",
            namespace: "host",
          }));
          build.onResolve({ filter: /^expo-linear-gradient$/ }, () => ({
            path: "gradient",
            namespace: "host",
          }));
          build.onLoad({ filter: /.*/, namespace: "host" }, (args) => ({
            contents:
              args.path === "react"
                ? reactMock
                : args.path === "react-native"
                  ? nativeMock
                  : args.path === "tv-preview-focus"
                    ? `export function TVPreviewPressable(props){return {type:'TVPreviewPressable',props};} export function useOptionalTVPreviewFocus(){return {enabled:true};}`
                    : `export const ${args.path === "icons" ? "Feather" : "LinearGradient"}='${args.path}';`,
            loader: "js",
          }));
        },
      },
    ],
  });

  const ui = req(join(out, "elite-v4.cjs"));
  const ctxElement = ui.EliteV4FocusSurface({ children: "body" });
  const context = ctxElement.props.value;
  ctxElement.type._context._value = context;
  const refs = new Map([
    ["sidebar-home", { handle: 101 }],
    ["hero", { handle: 102 }],
    ["rail-0", { handle: 103 }],
    ["rail-1", { handle: 104 }],
  ]);
  const neighbors = {
    "sidebar-home": { right: "hero" },
    hero: { left: "sidebar-home", down: "rail-0", right: "rail-0" },
    "rail-0": { left: "sidebar-home", right: "rail-1", up: "hero" },
    "rail-1": { left: "rail-0", up: "hero" },
  };
  for (const [id, ref] of refs)
    context.register(
      {
        id,
        region: id.startsWith("sidebar") ? "sidebar" : "content",
        neighbors: neighbors[id],
      },
      ref,
    );

  const focusButton = (focusId, region, selected = false) =>
    ui.EliteV4FocusButton({
      focusId,
      region,
      neighbors: neighbors[focusId],
      onPress: () => {},
      selected,
      children: "button",
    });
  const sidebarHome = focusButton("sidebar-home", "sidebar", true);
  const heroFocus = focusButton("hero", "content");
  const railFocus = focusButton("rail-0", "content");
  assert.equal(sidebarHome.props.nextFocusRight, 102);
  assert.equal(heroFocus.props.nextFocusLeft, 101);
  assert.equal(heroFocus.props.nextFocusDown, 103);
  assert.equal(railFocus.props.nextFocusUp, 102);
  checks += 1;
  console.log(
    "PASS rendered production focus buttons publish real nextFocus IDs",
  );

  const homeItem = {
    id: "movie-501",
    kind: "movie",
    title: "Örnek Film",
    subtitle: "Dram · 2025",
    image: "https://img.example/backdrop.jpg",
  };
  let opened = null;
  const heroTree = ui.EliteV4Hero({
    item: homeItem,
    onOpen: (item) => {
      opened = item;
    },
  });
  const heroButton = heroTree.props.children[2].props.children[3];
  heroButton.props.onPress();
  assert.equal(opened, homeItem);
  checks += 1;
  console.log(
    "PASS production Home Hero OK invokes the selected provider content action",
  );

  opened = null;
  const railTree = ui.EliteV4ContentRail({
    items: [homeItem],
    onOpen: (item) => {
      opened = item;
    },
  });
  const railButton =
    railTree.props.children[1].props.children.flat(Infinity)[0];
  railButton.props.onPress();
  assert.equal(opened, homeItem);
  assert.equal(railButton.props.focusId, "rail-0");
  checks += 1;
  console.log(
    "PASS production Home rail OK invokes the selected provider content action",
  );

  context.activeRegion = "content";
  const compact = ui.EliteV4Sidebar({ onReturnToV3: () => {} });
  assert.equal(
    compact.props.style.width,
    ui.eliteV4Theme.layout.sidebarCompact,
  );
  context.activeRegion = "sidebar";
  const expanded = ui.EliteV4Sidebar({ onReturnToV3: () => {} });
  assert.equal(
    expanded.props.style.width,
    ui.eliteV4Theme.layout.sidebarExpanded,
  );
  checks += 1;
  console.log(
    "PASS production Sidebar uses compact and expanded region widths",
  );

  let selected = null;
  const toggleElement = ui.EliteV4PreviewToggle({
    enabled: false,
    onChange: (value) => {
      selected = value;
    },
  });
  const toggle = toggleElement.type(toggleElement.props);
  toggle.props.onPress();
  assert.equal(selected, true);
  assert.equal(toggle.type, "TVPreviewPressable");
  assert.equal(toggle.props.focusId, "elite-v4-preview-toggle");
  checks += 1;
  console.log("PASS production preview selector enables V4 and joins TV Preview focus");

  let pressedV4 = false;
  const v4ButtonElement = ui.EliteV4FocusButton({
    focusId: "hero", region: "content", onPress: () => { pressedV4 = true; }, children: "Hero",
  });
  const v4Button = v4ButtonElement.type(v4ButtonElement.props);
  assert.equal(v4Button.type, "TVPreviewPressable");
  assert.equal(v4Button.props.focusId, "elite-v4:hero");
  v4Button.props.onPress();
  assert.equal(pressedV4, true);
  checks += 1;
  console.log("PASS production V4 controls expose their targets to virtual D-pad OK");

  const shell = readFileSync(join(app, "components/ProductShell.tsx"), "utf8");
  const legacyHome = readFileSync(
    join(app, "components/OptimizedHomeScreenPaged.tsx"),
    "utf8",
  );
  assert.match(shell, /useState\(false\)/);
  assert.match(shell, /provider && previewAvailable && eliteV4Preview/);
  assert.match(shell, /<OptimizedHomeScreenV6 key=\{provider\.id\} \/>/);
  assert.match(legacyHome, /export default function OptimizedHomeScreenPaged/);
  assert.doesNotMatch(
    shell,
    /components\/home\/HomeDiscovery|components\/OptimizedHomeScreenPaged/,
  );
  checks += 1;
  console.log(
    "PASS ProductShell defaults to V3 and routes V4 through separate components",
  );

  assert.equal(checks, 7);
  console.log(`Elite V4 production host scenarios: ${checks}/7 passed`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
