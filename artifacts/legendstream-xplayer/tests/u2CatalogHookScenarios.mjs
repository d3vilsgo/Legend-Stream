import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireApp = createRequire(join(app, "package.json"));
const { build } = createRequire(resolve(app, "../api-server/package.json"))(
  "esbuild",
);
const out = mkdtempSync(join(tmpdir(), "u2-grid-hook-"));
const mocks = {
  react: `export const useRef=v=>globalThis.__grid.ref(v);export const useState=v=>globalThis.__grid.state(v);`,
  "react-native": `export const Platform={get isTV(){return globalThis.__grid.native}};export const useWindowDimensions=()=>globalThis.__grid.window;export class FlatList {}`,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({top:0,left:12,right:24,bottom:20});`,
  "@/context/UiPresentationContext": `export const useUiPresentation=()=>({tvPreview:globalThis.__grid.preview});`,
  "@/components/tvPreview/TVPreviewFocus": `export const useOptionalTVPreviewFocus=()=>globalThis.__grid.focus;`,
};
try {
  await build({
    entryPoints: [join(app, "hooks/useResponsiveCatalogGrid.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "hook.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "hook-host",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in mocks)
              return { path: args.path, namespace: "mock" };
            if (args.path.startsWith("@/")) {
              const base = join(app, args.path.slice(2));
              const path = [base, base + ".ts", base + ".tsx"].find(existsSync);
              if (path) return { path };
            }
          });
          b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
            resolveDir: app,
          }));
        },
      },
    ],
  });
  const { useResponsiveCatalogGrid } = requireApp(join(out, "hook.cjs"));
  const ids = Array.from({ length: 60 }, (_, i) => `vod:${i}`);
  let slots = [],
    cursor = 0;
  const scrolls = [],
    restored = [];
  const state = (globalThis.__grid = {
    native: false,
    preview: false,
    window: { width: 393, height: 873, fontScale: 1, scale: 3 },
    focus: {
      nativeScope: "content",
      focusedId: null,
      restoreFocus: async (id) => {
        restored.push(id);
        return true;
      },
    },
    ref(v) {
      const i = cursor++;
      return slots[i] ?? (slots[i] = { current: v });
    },
    state(v) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = v;
      return [
        slots[i],
        (next) => {
          slots[i] = next;
        },
      ];
    },
  });
  globalThis.requestAnimationFrame = (fn) => fn();
  const render = (scope = "provider:a", data = ids) => {
    cursor = 0;
    return useResponsiveCatalogGrid(data, scope);
  };
  const attach = (grid) => {
    grid.listProps.ref.current = {
      scrollToIndex: (v) => scrolls.push(v),
      scrollToOffset: (v) => scrolls.push(v),
    };
  };
  let grid = render();
  attach(grid);
  grid.listProps.onViewableItemsChanged({
    viewableItems: [{ index: 19, isViewable: true }],
  });
  const portrait = grid.columns;
  state.window = { ...state.window, width: 873, height: 393 };
  grid = render();
  attach(grid);
  assert(grid.columns > portrait);
  grid.listProps.onContentSizeChange();
  assert.equal(scrolls.at(-1).index, Math.floor(19 / grid.columns));
  grid.listProps.onViewableItemsChanged({
    viewableItems: [{ index: 19, isViewable: true }],
  });
  assert.equal(restored.length, 0); // Touch scrolling never manufactures focus.
  state.preview = true;
  state.focus.focusedId = ids[19];
  grid = render();
  attach(grid);
  grid.listProps.onContentSizeChange();
  grid.listProps.onViewableItemsChanged({
    viewableItems: [{ index: 19, isViewable: true }],
  });
  assert.equal(restored.at(-1), ids[19]);
  grid.listProps.onLayout({ nativeEvent: { layout: { width: 360 } } });
  grid = render();
  attach(grid);
  assert(grid.columns <= 2); // Actual list width, not the landscape window width.
  grid.listProps.onContentSizeChange();
  assert.equal(scrolls.at(-1).index, Math.floor(19 / grid.columns));
  let before = scrolls.length;
  grid = render("provider:b");
  attach(grid);
  grid.listProps.onContentSizeChange();
  assert.equal(scrolls.length, before);
  grid.listProps.onViewableItemsChanged({
    viewableItems: [{ index: 19, isViewable: true }],
  });
  state.window = { ...state.window, width: 1280, height: 800 };
  grid = render("provider:b", ids.slice(0, 5));
  attach(grid);
  grid.listProps.onContentSizeChange();
  assert.equal(scrolls.length, before);
  grid = render("provider:b");
  grid.listProps.onViewableItemsChanged({
    viewableItems: [{ index: 19, isViewable: true }],
  });
  state.window = { ...state.window, width: 600, height: 960 };
  grid = render("provider:b");
  attach(grid);
  state.focus.nativeScope = "movie-info";
  grid.listProps.onContentSizeChange();
  assert.equal(scrolls.length, before);
  state.focus.nativeScope = "content";
  state.native = true;
  slots = [];
  grid = render();
  assert(!("onViewableItemsChanged" in grid.listProps)); // Native TV remains on its existing restore owner.
  assert(grid.columns >= 1);
  // Production TV hook: list measurement from an old orientation must not
  // survive a window resize before the next onLayout event arrives.
  grid.listProps.onLayout({ nativeEvent: { layout: { width: 310 } } });
  grid = render();
  const narrowColumns = grid.columns;
  state.window = { ...state.window, width: 1920, height: 1080 };
  grid = render();
  assert(grid.columns > narrowColumns);
  console.log(
    "U2 production catalog hook: 10/10 passed; HOST_HOOK_NOT_ANDROID_LAYOUT",
  );
} finally {
  delete globalThis.__grid;
  delete globalThis.requestAnimationFrame;
  rmSync(out, { recursive: true, force: true });
}
