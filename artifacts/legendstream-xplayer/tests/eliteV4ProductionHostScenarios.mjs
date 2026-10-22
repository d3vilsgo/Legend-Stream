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
  const state=[];let cursor=0;export const HostHooks={reset(){cursor=0;},clear(){state.length=0;cursor=0;}};export function useState(value){const index=cursor++;if(!(index in state))state[index]=typeof value==='function'?value():value;return [state[index],next=>{state[index]=typeof next==='function'?next(state[index]):next}];}
  let handle=200;export function useRef(value){return {current:value??{handle:handle++}};}
  export function useMemo(factory){return factory();}
  export function useCallback(callback){return callback;}
  export function useEffect(effect){if(effect?.toString().includes("Animated.timing"))effect();}
  export function createElement(type,props,...children){return {type,props:{...(props??{}),children}};}
  export default {createElement,Fragment:'Fragment',useContext,useState,useRef,useMemo,useCallback,useEffect};
`;
const nativeMock = `
  export const Pressable='Pressable',Image='Image',ImageBackground='ImageBackground',ScrollView='ScrollView',Text='Text',View='View';export const Platform={get isTV(){return globalThis.__eliteV4PlatformIsTV??false;},set isTV(value){globalThis.__eliteV4PlatformIsTV=value;}};
  export const Animated={View:'AnimatedView',Value:class{constructor(value){this.value=value;}},timing(value,{toValue}){return{start(){value.value=toValue;}}}};
  export function useWindowDimensions(){return {width:1280,height:720,scale:1,fontScale:1};}
  export function findNodeHandle(ref){return ref?.handle??null;}
`;
try {
  await build({
    stdin: {
      contents: `export {Platform} from 'react-native';export {HostHooks} from 'react';export {HostRuntime} from 'host-runtime';export {ProductShellContent} from './components/ProductShell';export {EliteV4TvShell} from '@/components/eliteV4/EliteV4TvShell';export {EliteV4FocusSurface,EliteV4FocusButton} from './components/eliteV4/EliteV4FocusSurface';export {EliteV4Sidebar} from './components/eliteV4/EliteV4Sidebar';export {EliteV4Hero} from './components/eliteV4/EliteV4Hero';export {EliteV4ContentRail} from './components/eliteV4/EliteV4ContentRail';export {EliteV4Home} from './components/eliteV4/EliteV4Home';export {EliteV4PreviewToggle} from './components/eliteV4/EliteV4PreviewToggle';export {eliteV4Theme} from './lib/design/eliteV4Theme';`,
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
          build.onResolve(
            { filter: /^@\/components\/tvPreview\/TVPreviewFocus$/ },
            () => ({
              path: "tv-preview-focus",
              namespace: "host",
            }),
          );
          build.onResolve({ filter: /^@expo\/vector-icons$/ }, () => ({
            path: "icons",
            namespace: "host",
          }));
          build.onResolve({ filter: /^host-runtime$/ }, () => ({
            path: "host-runtime",
            namespace: "host",
          }));
          build.onResolve(
            { filter: /^\.\/tmdb\/MovieInfoServiceProvider$/ },
            () => ({ path: "movie-info-service-provider", namespace: "host" }),
          );
          build.onResolve(
            { filter: /^@\/components\/tvPreview\/TVRemoteInspector$/ },
            () => ({ path: "tv-remote-inspector", namespace: "host" }),
          );
          build.onResolve(
            { filter: /^@\/components\/OptimizedHomeScreenV6$/ },
            () => ({ path: "v3-home", namespace: "host" }),
          );
          build.onResolve(
            { filter: /^@\/components\/StalkerMainPage$/ },
            () => ({ path: "v3-stalker", namespace: "host" }),
          );
          build.onResolve({ filter: /^@\/context\/PlayerContext$/ }, () => ({
            path: "player-context",
            namespace: "host",
          }));
          build.onResolve(
            { filter: /^@\/context\/UiPresentationContext$/ },
            () => ({ path: "ui-presentation-context", namespace: "host" }),
          );
          build.onResolve({ filter: /^@\/lib\/productContract$/ }, () => ({
            path: "product-contract",
            namespace: "host",
          }));
          build.onResolve({ filter: /^@\/lib\/productShell$/ }, () => ({
            path: "product-shell",
            namespace: "host",
          }));
          build.onResolve({ filter: /^@\/lib\/stalkerPlaybackTrace$/ }, () => ({
            path: "stalker-trace",
            namespace: "host",
          }));
          build.onResolve(
            { filter: /^@\/components\/eliteV4\/EliteV4TvShell$/ },
            () => ({ path: "elite-v4-tv-shell", namespace: "host" }),
          );
          build.onResolve({ filter: /^expo-linear-gradient$/ }, () => ({
            path: "gradient",
            namespace: "host",
          }));
          build.onResolve(
            { filter: /^@\/components\/tmdb\/MovieInfoServiceProvider$/ },
            () => ({ path: "movie-info-service-provider", namespace: "host" }),
          );
          build.onResolve(
            { filter: /^@\/components\/tmdb\/MovieInfoModal$/ },
            () => ({ path: "movie-info-modal", namespace: "host" }),
          );
          build.onResolve(
            { filter: /^@\/lib\/tmdb\/movieInfoService$/ },
            () => ({ path: "movie-info-service", namespace: "host" }),
          );
          build.onResolve({ filter: /^@\/lib\/tmdb\/movieInfoModel$/ }, () => ({
            path: "movie-info-model",
            namespace: "host",
          }));
          build.onLoad({ filter: /.*/, namespace: "host" }, (args) => ({
            contents:
              args.path === "react"
                ? reactMock
                : args.path === "react-native"
                  ? nativeMock
                  : args.path === "host-runtime"
                    ? `export const HostRuntime={player:{provider:{id:'provider-1',type:'xtream'}},presentation:{tvPreview:true}};`
                    : args.path === "player-context"
                      ? `import {HostRuntime} from 'host-runtime'; export function usePlayer(){return HostRuntime.player;}`
                      : args.path === "ui-presentation-context"
                        ? `import {HostRuntime} from 'host-runtime'; export function useUiPresentation(){return HostRuntime.presentation;} export function UiPresentationProvider({children}){return children;}`
                        : args.path === "v3-home"
                          ? `export default function OptimizedHomeScreenV6(){return null;}`
                          : args.path === "v3-stalker"
                            ? `export default function StalkerMainPage(){return null;}`
                            : args.path === "product-contract"
                              ? `export function deriveProductCapabilities(){return {};}`
                              : args.path === "product-shell"
                                ? `export function selectTransitionalProductSurface(){return 'paged';}`
                                : args.path === "stalker-trace"
                                  ? `export function shortSafeId(value){return value??'none';} export function traceStalker(){}`
                                  : args.path === "tv-remote-inspector"
                                    ? `export function TVRemoteInspectorOverlay(){return null;} export function TVRemoteInspectorCollector(){return null;}`
                                    : args.path === "elite-v4-tv-shell"
                                      ? `import React from 'react'; export function EliteV4TvShell(props){return React.createElement('EliteV4TvShell',props);}`
                                      : args.path === "tv-preview-focus"
                                        ? `export function TVPreviewPressable(props){return {type:'TVPreviewPressable',props};} export function useOptionalTVPreviewFocus(){return {enabled:true};} export function TVPreviewControls(){return null;} export function TVPreviewFocusProvider({children}){return children;} export function TVPreviewFocusRegion({children}){return children;}`
                                        : args.path ===
                                            "movie-info-service-provider"
                                          ? `export function useMovieInfoService(){return {};} export function MovieInfoServiceProvider({children}){return children;}`
                                          : args.path === "movie-info-modal"
                                            ? `export function MovieInfoModal(props){return {type:'MovieInfoModal',props};}`
                                            : args.path === "movie-info-service"
                                              ? `export function beginMovieEnrichment(){return ()=>{};}`
                                              : args.path === "movie-info-model"
                                                ? `export function localXtreamMovie(item){return {title:item.name??item.title??''};} export function movieInfoPresentation(local,input){return {title:local.title};} export function pagedMovieInput(){return {};}`
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
    height: 250,
    width: 1160,
    firstRailFocusId: "featured-0",
    providerId: "provider-1",
    providerType: "xtream",
    onOpen: (item) => {
      opened = item;
    },
  });
  const findFocusButton = (node, id) => {
    if (!node || typeof node !== "object") return null;
    if (node.props?.focusId === id) return node;
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      const found = findFocusButton(child, id);
      if (found) return found;
    }
    return null;
  };
  const heroButton = findFocusButton(heroTree, "hero");
  heroButton.props.onPress();
  assert.equal(opened, homeItem);
  checks += 1;
  console.log(
    "PASS production Home Hero OK invokes the selected provider content action",
  );

  opened = null;
  const railTree = ui.EliteV4ContentRail({
    railId: "featured",
    title: "Öne Çıkanlar",
    items: [homeItem],
    cardWidth: 220,
    onOpen: (item) => {
      opened = item;
    },
  });
  const railButton =
    railTree.props.children[1].props.children.flat(Infinity)[0];
  railButton.props.onPress();
  assert.equal(opened, homeItem);
  assert.equal(railButton.props.focusId, "featured-0");
  checks += 1;
  console.log(
    "PASS production Home rail OK invokes the selected provider content action",
  );

  const seriesItem = {
    id: "series-22",
    kind: "series",
    title: "Dizi",
    image: "https://img.example/series.jpg",
  };
  const liveItem = {
    id: "live-trt",
    kind: "live",
    title: "TRT Haber",
    image: "https://img.example/logo.png",
  };
  const homeTree = ui.EliteV4Home({
    sections: {
      featured: [],
      continueWatching: [],
      live: [liveItem],
      movies: [homeItem],
      series: [seriesItem],
    },
    providerName: "Demo Provider",
    providerId: "provider-1",
    providerType: "xtream",
    loading: false,
    onOpen: () => {},
  });
  const flattenTree = (node, output = []) => {
    if (Array.isArray(node)) {
      node.forEach((child) => flattenTree(child, output));
      return output;
    }
    if (!node || typeof node !== "object") return output;
    if (node.type === ui.EliteV4Hero || node.type === ui.EliteV4ContentRail) {
      flattenTree(node.type(node.props), output);
      return output;
    }
    output.push(node);
    flattenTree(node.props?.children, output);
    return output;
  };
  const homeNodes = flattenTree(homeTree);
  const homeText = homeNodes
    .filter((node) => node.type === "Text")
    .map((node) => node.props.children)
    .flat(Infinity);
  assert.ok(homeText.includes("Canlı Kanallar"));
  assert.ok(homeText.includes("Filmler"));
  assert.ok(homeText.includes("Diziler"));
  assert.ok(homeNodes.some((node) => node.props?.focusId === "live-0"));
  assert.ok(homeNodes.some((node) => node.props?.focusId === "movies-0"));
  assert.ok(homeNodes.some((node) => node.props?.focusId === "series-0"));
  const renderedHero = homeNodes.find((node) => node.props?.focusId === "hero");
  assert.equal(renderedHero.props.neighbors.down, "live-0");
  assert.equal(
    homeNodes.find((node) => node.props?.focusId === "live-0").props.neighbors
      .left,
    "sidebar-home",
  );
  checks += 1;
  console.log(
    "PASS production EliteV4Home renders typed provider shelves with hidden empty sections",
  );

  const emptyHomeTree = ui.EliteV4Home({
    sections: {
      featured: [],
      continueWatching: [],
      live: [],
      movies: [],
      series: [],
    },
    providerName: "Empty Provider",
    providerId: "provider-1",
    providerType: "xtream",
    loading: false,
    onOpen: () => {},
  });
  const emptyNodes = flattenTree(emptyHomeTree);
  const emptyTexts = emptyNodes
    .filter((node) => node.type === "Text")
    .map((node) => node.props.children)
    .flat(Infinity);
  assert.ok(
    emptyTexts.includes("Bu sağlayıcıda gösterilecek içerik bulunamadı."),
  );
  assert.ok(!emptyTexts.includes("Filmler"));
  assert.ok(
    emptyNodes.some((node) => node.props?.focusId === "hero"),
    "empty Hero must retain an explicit Sidebar RIGHT target",
  );
  checks += 1;
  console.log(
    "PASS empty production Home hides catalog rails and keeps a reachable Hero focus target",
  );

  context.activeRegion = "content";
  const compact = ui.EliteV4Sidebar({ onReturnToV3: () => {} });
  assert.equal(
    compact.props.style.width.value,
    ui.eliteV4Theme.layout.sidebarCompact,
  );
  context.activeRegion = "sidebar";
  const expanded = ui.EliteV4Sidebar({ onReturnToV3: () => {} });
  assert.equal(
    expanded.props.style.width.value,
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
  console.log(
    "PASS production preview selector enables V4 and joins TV Preview focus",
  );

  let pressedV4 = false;
  const v4ButtonElement = ui.EliteV4FocusButton({
    focusId: "hero",
    region: "content",
    onPress: () => {
      pressedV4 = true;
    },
    children: "Hero",
  });
  const v4Button = v4ButtonElement.type(v4ButtonElement.props);
  assert.equal(v4Button.type, "TVPreviewPressable");
  assert.equal(v4Button.props.focusId, "elite-v4:hero");
  v4Button.props.onPress();
  assert.equal(pressedV4, true);
  checks += 1;
  console.log(
    "PASS production V4 controls expose their targets to virtual D-pad OK",
  );

  ui.Platform.isTV = true;
  assert.equal(ui.Platform.isTV, true);
  const nativeToggleElement = ui.EliteV4PreviewToggle({
    enabled: false,
    onChange: () => {},
  });
  const nativeToggle = nativeToggleElement;
  assert.equal(nativeToggle.type, "Pressable");
  assert.equal(nativeToggle.props.hasTVPreferredFocus, true);
  ui.Platform.isTV = false;
  checks += 1;
  console.log("PASS Native TV V3 entry focuses the V4 selector first");

  const shell = readFileSync(join(app, "components/ProductShell.tsx"), "utf8");
  const legacyHome = readFileSync(
    join(app, "components/OptimizedHomeScreenPaged.tsx"),
    "utf8",
  );
  const sidebarSource = readFileSync(
    join(app, "components/eliteV4/EliteV4Sidebar.tsx"),
    "utf8",
  );
  assert.match(shell, /useState\(false\)/);
  assert.doesNotMatch(shell, /setEliteV4Preview\(tvPreview\)/);
  assert.match(shell, /const previewAvailable = Platform\.isTV \|\| tvPreview/);
  assert.match(shell, /provider && previewAvailable && eliteV4Preview/);
  assert.match(shell, /<OptimizedHomeScreenV6 key=\{provider\.id\} \/>/);
  assert.match(sidebarSource, /right: "hero"/);
  assert.match(sidebarSource, /next: "sidebar-live"/);
  assert.match(sidebarSource, /previous: "sidebar-home"/);
  assert.match(sidebarSource, /up: entry.previous/);
  assert.match(sidebarSource, /down: entry.next/);
  assert.match(sidebarSource, /activeRegion === "sidebar"/);
  assert.match(legacyHome, /export default function OptimizedHomeScreenPaged/);
  assert.doesNotMatch(
    shell,
    /components\/home\/HomeDiscovery|components\/OptimizedHomeScreenPaged/,
  );
  checks += 1;
  console.log(
    "PASS ProductShell defaults to V3 and routes V4 through separate components",
  );

  const findElement = (node, predicate) => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findElement(child, predicate);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    return findElement(node.props?.children, predicate);
  };

  ui.HostHooks.clear();
  ui.Platform.isTV = false;
  ui.HostRuntime.player = {
    provider: { id: "provider-route-test", type: "xtream" },
  };
  ui.HostRuntime.presentation = { tvPreview: true };
  let route = ui.ProductShellContent();
  assert.equal(
    findElement(route, (node) => node.type === ui.EliteV4TvShell),
    null,
  );
  const previewToggleElement = findElement(
    route,
    (node) => node.type === ui.EliteV4PreviewToggle,
  );
  assert.ok(
    previewToggleElement,
    "V3 must expose a V4 selector in mobile TV Preview",
  );
  const mobileToggle = previewToggleElement.type(previewToggleElement.props);
  mobileToggle.props.onPress();
  ui.HostHooks.reset();
  route = ui.ProductShellContent();
  const mobileV4Shell = findElement(
    route,
    (node) => node.type === ui.EliteV4TvShell,
  );
  assert.ok(
    mobileV4Shell,
    "selecting V4 must render EliteV4TvShell from ProductShell",
  );
  assert.equal(
    findElement(route, (node) => node.type === ui.EliteV4PreviewToggle)?.props
      .enabled,
    true,
  );
  mobileV4Shell.props.onReturnToV3();
  ui.HostHooks.reset();
  route = ui.ProductShellContent();
  assert.equal(
    findElement(route, (node) => node.type === ui.EliteV4TvShell),
    null,
  );
  checks += 1;
  console.log(
    "PASS ProductShell route defaults to V3, activates V4, and returns to V3 in TV Preview",
  );

  ui.HostHooks.clear();
  ui.Platform.isTV = true;
  ui.HostRuntime.presentation = { tvPreview: false };
  route = ui.ProductShellContent();
  const nativeRouteToggleElement = findElement(
    route,
    (node) => node.type === ui.EliteV4PreviewToggle,
  );
  assert.ok(
    nativeRouteToggleElement,
    "Native TV must expose the V4 selector without TV Preview mode",
  );
  const nativeRouteToggle = nativeRouteToggleElement.type(
    nativeRouteToggleElement.props,
  );
  assert.equal(nativeRouteToggle.type, "Pressable");
  assert.equal(nativeRouteToggle.props.hasTVPreferredFocus, true);
  nativeRouteToggle.props.onPress();
  ui.HostHooks.reset();
  route = ui.ProductShellContent();
  const nativeV4Shell = findElement(
    route,
    (node) => node.type === ui.EliteV4TvShell,
  );
  assert.ok(nativeV4Shell, "Native TV V4 selection must render EliteV4TvShell");
  nativeV4Shell.props.onReturnToV3();
  ui.HostHooks.reset();
  assert.equal(
    findElement(
      ui.ProductShellContent(),
      (node) => node.type === ui.EliteV4TvShell,
    ),
    null,
  );
  ui.Platform.isTV = false;
  checks += 1;
  console.log("PASS Native TV selection renders V4 and restores the V3 route");

  assert.equal(checks, 12);
  console.log(`Elite V4 production host scenarios: ${checks}/12 passed`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
