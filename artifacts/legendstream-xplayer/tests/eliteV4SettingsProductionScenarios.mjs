import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  req = createRequire(join(app, "package.json"));
const { build } = createRequire(resolve(app, "../api-server/package.json"))(
  "esbuild",
);
const out = mkdtempSync(join(tmpdir(), "v4-settings-"));
const harness = readFileSync(
  join(app, "tests/eliteV4LibraryProductionScenarios.mjs"),
  "utf8",
);
const react = harness.match(/const react = `([\s\S]*?)`;\nconst runtime/)[1];
const oldRAF = globalThis.requestAnimationFrame,
  oldFetch = globalThis.fetch;
globalThis.requestAnimationFrame = (fn) => {
  fn();
  return 1;
};
globalThis.fetch = () => {
  throw Error("UNEXPECTED_NETWORK");
};
try {
  await build({
    stdin: {
      resolveDir: app,
      loader: "tsx",
      contents: `export {EliteV4Settings} from './components/eliteV4/EliteV4Settings';export {EliteV4AccountEditor,validateSettingsAccount} from './components/eliteV4/EliteV4AccountEditor';export {SettingsDialog,SettingsDialogButton} from './components/eliteV4/EliteV4SettingsDialog';export {getPlayerChromeTimeoutSeconds,setPlayerChromeTimeoutSeconds,getSavedPlayerCodecMode,setSavedPlayerCodecMode} from './lib/playerPreferences';export {I18nProvider} from './context/I18nContext';export {Host} from 'react';export {R} from 'settings-runtime';`,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "settings.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "boundaries",
        setup(b) {
          const mocks = {
            react,
            "settings-runtime": `export const R={width:1280,player:null,library:null,catalog:null,i18n:null,focus:{focusedId:'v4-settings-category-accounts',focus:id=>R.focused.push(id)},focused:[],scopes:[],backs:[],writes:[],storage:new Map(),fail:false};`,
            "react-native": `import {R} from 'settings-runtime';export const View='View',Text='Text',ScrollView='ScrollView',Modal='Modal',TextInput='TextInput';export const Platform={isTV:true};export const BackHandler={addEventListener(_,fn){R.nativeBack=fn;return{remove(){R.nativeBack=null;}}}};export const useWindowDimensions=()=>({width:R.width,height:720});`,
            "@/context/PlayerContext": `import {R} from 'settings-runtime';export const usePlayer=()=>R.player;`,
            "@/context/MediaLibraryContext": `import {R} from 'settings-runtime';export const useMediaLibrary=()=>R.library;`,
            "@/context/CatalogSyncContext": `import {R} from 'settings-runtime';export const useCatalogSync=()=>R.catalog;`,
            "@/context/I18nContext": `import {R} from 'settings-runtime';export const useI18n=()=>R.i18n;`,
            "@/lib/playerDiagnostics": `import {R} from 'settings-runtime';export async function clearPlayerDiagnostics(){R.calls.push(['diagnostics']);}`,
            "@/lib/playerRemoteOwnership": `import {R} from 'settings-runtime';export const hasPlayerBackOwner=()=>R.playerBack;`,
            "@/lib/manualEpgMode": `import {R} from 'settings-runtime';export const getManualEpgSnapshot=()=>R.epg;`,
            "@/components/tvPreview/TVPreviewFocus": `import {R} from 'settings-runtime';export const TVPreviewPressable='ModalButton',TVPreviewFocusRegion='Region';export function useTVPreviewFocus(){return{pushFocusScope:id=>{R.scopes.push(id);return()=>R.scopes.pop();},registerBackAction:fn=>{R.backs.push(fn);return()=>R.backs.pop();},modalShown:async id=>R.shown=id};}export const useOptionalTVPreviewFocus=useTVPreviewFocus;`,
            "./EliteV4FocusSurface": `import {R} from 'settings-runtime';export const EliteV4FocusButton='FocusButton';export const useEliteV4Focus=()=>R.focus;`,
            "@react-native-async-storage/async-storage": `import {R} from 'settings-runtime';export default{getItem:async key=>R.read?R.read(key):R.storage.get(key)??null,setItem:async(key,value)=>{if(R.fail)throw Error('STORAGE_FAILURE');R.writes.push([key,value]);R.storage.set(key,value);}};`,
            "expo-localization": `export const getLocales=()=>[{languageCode:'tr'}];`,
          };
          b.onResolve({ filter: /.*/ }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "mock" }
              : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "tsx",
          }));
        },
      },
    ],
  });
  const ui = req(join(out, "settings.cjs")),
    { R, Host: H } = ui;
  const frames = new Set(),
    render = (key, fn) => {
      frames.add(key);
      const n = H.render(key, fn);
      H.commit(key);
      return n;
    };
  const nodes = (n) =>
    !n
      ? []
      : Array.isArray(n)
        ? n.flatMap(nodes)
        : typeof n === "object"
          ? [n, ...nodes(n.props?.children)]
          : [];
  const find = (n, id) => nodes(n).find((x) => x.props?.focusId === id);
  const text = (n) =>
    nodes(n)
      .filter((x) => x.type === "Text")
      .flatMap((x) => x.props.children)
      .filter((x) => typeof x === "string")
      .join(" ");
  const flush = async () => {
    await new Promise((r) => setImmediate(r));
  };
  let count = 0;
  const test = async (label, fn) => {
    for (const f of frames) H.cleanup(f);
    frames.clear();
    R.calls = [];
    R.focused = [];
    R.storage.clear();
    R.writes = [];
    R.fail = false;
    R.read = null;
    R.width = 1280;
    R.playerBack = false;
    R.player = {
      provider: { id: "a", type: "xtream", name: "A" },
      providers: [
        { id: "a", type: "xtream", name: "A" },
        { id: "b", type: "m3u", name: "B" },
        { id: "s", type: "stalker", name: "S" },
      ],
      isLoading: false,
      isEpgLoading: false,
      setActiveProvider: async (id) => {
        R.calls.push(["switch", id]);
        return true;
      },
      refreshProvider: async (id) => {
        R.calls.push(["playlist", id]);
        return true;
      },
      loadEpgManually: async (id) => {
        R.calls.push(["epg", id]);
        R.epg = { providerId: id, manualResult: "success" };
      },
      clearHistory: async () =>
        R.calls.push(["clear-live", R.player.provider.id]),
      removeProvider: async (id) => R.calls.push(["remove", id]),
      connectProvider: async (v) => {
        R.calls.push(["connect", v]);
        return true;
      },
      cancelProviderConnect: () => R.calls.push(["cancel"]),
    };
    R.library = {
      clearProgress: async () =>
        R.calls.push(["clear-media", R.player.provider.id]),
    };
    R.catalog = {
      refreshPolicy: {
        version: 1,
        automaticRefreshEnabled: true,
        refreshIntervalHours: 24,
      },
      refreshPolicyReady: true,
      setRefreshPolicy: async (v) => R.calls.push(["policy", v]),
      refreshCatalog: async () => R.calls.push(["catalog"]),
      isSyncing: false,
      isRefreshing: false,
    };
    R.i18n = {
      language: "tr",
      languages: [
        { code: "tr", label: "Türkçe" },
        { code: "en", label: "English" },
      ],
      setLanguage: async (...v) => R.calls.push(["language", ...v]),
    };
    await fn();
    console.log(`PASS V4 Settings ${++count} - ${label}`);
  };
  const props = {
    active: true,
    onBack: () => R.calls.push(["back"]),
    onLibrary: (r) => R.calls.push(["library", r]),
  };
  const screen = () => render("settings", () => ui.EliteV4Settings(props));
  const press = (tree, id) => {
    const n = find(tree, id);
    assert.ok(n, id);
    assert.ok(!n.props.disabled, id + " enabled");
    n.props.onPress();
  };
  const cat = async (key) => {
    let n = screen();
    press(n, "v4-settings-category-" + key);
    n = screen();
    await flush();
    return screen();
  };
  const modal = (tree) => nodes(tree).find((n) => n.type === ui.SettingsDialog);
  const confirm = (tree) =>
    nodes(tree)
      .find(
        (n) => n.type === ui.SettingsDialogButton && n.props.id === "confirm",
      )
      .props.onPress();
  await test("production account panel exposes real identities and no credentials", async () => {
    const n = screen();
    assert.ok(find(n, "v4-settings-account-s"));
    assert.ok(!text(n).includes("password"));
    press(n, "v4-settings-account-b");
    await flush();
    assert.deepEqual(R.calls, [["switch", "b"]]);
  });
  await test("duplicate OK is locked while provider switch is pending", async () => {
    let done;
    R.player.setActiveProvider = async (id) => {
      R.calls.push(["switch", id]);
      await new Promise((r) => (done = r));
    };
    const n = screen(),
      button = find(n, "v4-settings-account-b");
    button.props.onPress();
    button.props.onPress();
    assert.equal(R.calls.length, 1);
    R.player.isLoading = true;
    assert.equal(find(screen(), "v4-settings-account-b").props.disabled, false);
    done();
    await flush();
  });
  await test("stale account and category callbacks cannot change another panel/account", async () => {
    let n = screen(),
      old = find(n, "v4-settings-account-b").props.onPress;
    await cat("player");
    old();
    assert.equal(R.calls.length, 0);
    R.player = { ...R.player, provider: { id: "other", type: "m3u" } };
    screen();
    old();
    assert.equal(R.calls.length, 0);
  });
  await test("delete requires explicit confirmation and cancellation does nothing", async () => {
    let n = screen();
    press(n, "v4-settings-remove-b");
    n = screen();
    assert.equal(R.calls.length, 0);
    assert.ok(modal(n).props.children);
    modal(n).props.onClose();
    screen();
    assert.equal(R.calls.length, 0);
    assert.equal(R.focused.at(-1), "v4-settings-remove-b");
  });
  await test("confirmed deletion targets only selected saved provider", async () => {
    let n = screen();
    press(n, "v4-settings-remove-b");
    n = screen();
    confirm(n);
    confirm(n);
    await flush();
    assert.deepEqual(R.calls, [["remove", "b"]]);
  });
  await test("account change invalidates an already-open destructive confirmation", async () => {
    let n = await cat("storage");
    press(n, "v4-settings-clear-media");
    n = screen();
    const old = nodes(n).find(
      (n) => n.type === ui.SettingsDialogButton && n.props.id === "confirm",
    ).props.onPress;
    R.player = { ...R.player, provider: { id: "b", type: "m3u" } };
    screen();
    old();
    assert.equal(R.calls.length, 0);
  });
  await test("cancelled confirmation callback cannot execute after a different modal opens", async () => {
    let n = await cat("storage");
    press(n, "v4-settings-clear-live");
    n = screen();
    const old = nodes(n).find(
      (n) => n.type === ui.SettingsDialogButton && n.props.id === "confirm",
    ).props.onPress;
    modal(n).props.onClose();
    screen();
    press(screen(), "v4-settings-clear-media");
    screen();
    old();
    await flush();
    assert.equal(R.calls.length, 0);
  });
  await test("history cleanup is scoped and favorites are managed without clearing", async () => {
    let n = await cat("storage");
    press(n, "v4-settings-clear-live");
    n = screen();
    confirm(n);
    await flush();
    n = screen();
    press(n, "v4-settings-favorites");
    assert.deepEqual(R.calls, [
      ["clear-live", "a"],
      ["library", "favorites"],
    ]);
  });
  await test("real Player preference writes existing key and survives re-read", async () => {
    await cat("player");
    let n = screen();
    press(n, "v4-settings-timeout-10");
    await flush();
    assert.equal(await ui.getPlayerChromeTimeoutSeconds(), 10);
    assert.deepEqual(R.writes.at(-1), [
      "@legendstream/player-chrome-timeout-v1",
      "10",
    ]);
  });
  await test("existing VLC codec preference is validated and persisted by the production control", async () => {
    let n = await cat("player");
    press(n, "v4-settings-codec-software");
    await flush();
    assert.equal(await ui.getSavedPlayerCodecMode(), "software");
    assert.equal(R.storage.get("@legendstream/codec-mode-v1"), "software");
    R.storage.set("@legendstream/codec-mode-v1", "invalid");
    assert.equal(await ui.getSavedPlayerCodecMode(), "auto");
    await assert.rejects(ui.setSavedPlayerCodecMode("invalid"));
  });
  await test("invalid and failed Player preference uses fallback and visible error", async () => {
    R.storage.set("@legendstream/player-chrome-timeout-v1", "99");
    assert.equal(await ui.getPlayerChromeTimeoutSeconds(), 3);
    await assert.rejects(ui.setPlayerChromeTimeoutSeconds(99));
    await cat("player");
    R.fail = true;
    press(screen(), "v4-settings-timeout-5");
    await flush();
    assert.match(text(screen()), /tamamlanamadı/);
    assert.equal(R.storage.get("@legendstream/player-chrome-timeout-v1"), "99");
  });
  await test("catalog policy and intervals call existing sync context", async () => {
    let n = await cat("content");
    press(n, "v4-settings-auto");
    await flush();
    n = screen();
    press(n, "v4-settings-interval-72");
    await flush();
    assert.equal(R.calls[0][1].automaticRefreshEnabled, false);
    assert.equal(R.calls[1][1].refreshIntervalHours, 72);
  });
  await test("catalog, playlist and EPG invoke real provider-bound operations", async () => {
    let n = screen();
    press(n, "v4-settings-playlist-refresh");
    await flush();
    n = await cat("content");
    press(n, "v4-settings-catalog-refresh");
    await flush();
    n = screen();
    press(n, "v4-settings-epg-refresh");
    await flush();
    assert.deepEqual(R.calls, [["playlist", "a"], ["catalog"], ["epg", "a"]]);
  });
  await test("EPG empty/failure is not reported as successful data refresh", async () => {
    R.player.loadEpgManually = async () => {
      R.epg = { providerId: "a", manualResult: "empty" };
    };
    let n = await cat("content");
    press(n, "v4-settings-epg-refresh");
    await flush();
    assert.match(text(screen()), /tamamlanamadı/);
  });
  await test("language control requests verified persistence through existing context", async () => {
    let n = await cat("language");
    press(n, "v4-settings-language-en");
    await flush();
    assert.deepEqual(R.calls, [["language", "en", { verified: true }]]);
  });
  await test("real I18n context saves, restores and rejects failed verified changes", async () => {
    const language = () =>
      render("i18n", () => ui.I18nProvider({ children: null })).props.value;
    let v = language();
    await flush();
    await v.setLanguage("en", { verified: true });
    assert.equal(language().language, "en");
    assert.equal(R.storage.get("@legendstream/language-v1"), "en");
    H.cleanup("i18n");
    frames.delete("i18n");
    language();
    await flush();
    assert.equal(language().language, "en");
    R.fail = true;
    await assert.rejects(language().setLanguage("de", { verified: true }));
    assert.equal(language().language, "en");
  });
  await test("late language hydration cannot overwrite a newer verified selection", async () => {
    let release;
    R.read = () => new Promise((r) => (release = r));
    const root = render("i18n", () => ui.I18nProvider({ children: null }));
    R.read = null;
    await root.props.value.setLanguage("en", { verified: true });
    release("tr");
    await flush();
    assert.equal(
      render("i18n", () => ui.I18nProvider({ children: null })).props.value
        .language,
      "en",
    );
  });
  await test("BACK moves panel to category then Sidebar without Player interception", async () => {
    screen();
    R.focus.focusedId = "v4-settings-timeout-3";
    R.nativeBack();
    assert.equal(R.focused.at(-1), "v4-settings-category-accounts");
    R.focus.focusedId = "v4-settings-category-accounts";
    screen();
    R.nativeBack();
    assert.deepEqual(R.calls, [["back"]]);
    R.playerBack = true;
    assert.equal(R.nativeBack(), false);
  });
  await test("modal production scope owns BACK and disables background controls", async () => {
    let n = screen();
    press(n, "v4-settings-remove-b");
    n = screen();
    assert.equal(find(n, "v4-settings-add").props.disabled, true);
    const dialog = modal(n);
    const d = render("dialog", () => dialog.type(dialog.props));
    assert.ok(R.scopes.includes("v4-settings-dialog"));
    d.props.onShow();
    assert.equal(R.shown, "v4-settings-dialog");
    R.backs.at(-1)();
    assert.equal(modal(screen()), undefined);
  });
  await test("responsive single column and empty account list retain reachable add action", async () => {
    R.width = 393;
    R.player.providers = [];
    const n = screen();
    assert.ok(find(n, "v4-settings-add"));
    const views = nodes(n).filter((x) => x.type === "View");
    assert.ok(views.some((n) => n.props.style?.flexDirection === "column"));
  });
  await test("focus graph links categories, rows and Sidebar with automatic reveal callbacks", async () => {
    let n = screen(),
      first = find(n, "v4-settings-add");
    assert.equal(first.props.neighbors.left, "v4-settings-category-accounts");
    assert.equal(
      find(n, "v4-settings-category-accounts").props.neighbors.left,
      "sidebar-settings",
    );
    assert.equal(typeof first.props.onFocused, "function");
  });
  await test("account editor validates all provider contracts and masks credential fields", async () => {
    assert.ok(
      ui.validateSettingsAccount({
        type: "xtream",
        playlistUrl: "https://host",
      }),
    );
    assert.ok(
      ui.validateSettingsAccount({
        type: "stalker",
        playlistUrl: "https://host",
      }),
    );
    assert.equal(
      ui.validateSettingsAccount({
        type: "m3u",
        playlistUrl: "https://host/list",
      }),
      null,
    );
    const n = render("editor", () =>
      ui.EliteV4AccountEditor({
        existing: null,
        onClose: () => {},
        onSubmit: async () => {},
      }),
    );
    for (const label of ["Sunucu / playlist adresi", "Kullanıcı adı", "Parola"])
      assert.equal(
        nodes(n).find(
          (x) => x.type === "TextInput" && x.props.accessibilityLabel === label,
        ).props.secureTextEntry,
        true,
      );
  });
  await test("account editor OK submits only validated captured identity once", async () => {
    let done;
    const existing = {
      id: "s",
      type: "stalker",
      name: "S",
      url: "https://portal",
      mac: "00:11:22:33:44:55",
    };
    const n = render("editor", () =>
      ui.EliteV4AccountEditor({
        existing,
        onClose: () => {},
        onSubmit: async (value) => {
          R.calls.push(value);
          await new Promise((r) => (done = r));
        },
      }),
    );
    const save = nodes(n).find(
      (x) => x.type === ui.SettingsDialogButton && x.props.id === "save",
    );
    save.props.onPress();
    save.props.onPress();
    assert.equal(R.calls.length, 1);
    assert.equal(R.calls[0].providerId, "s");
    assert.equal(R.calls[0].mac, existing.mac);
    done();
    await flush();
  });
  await test("production Settings passes edited account identity to the existing connect contract", async () => {
    let n = screen();
    press(n, "v4-settings-edit-b");
    n = screen();
    const editor = nodes(n).find((n) => n.type === ui.EliteV4AccountEditor);
    const config = {
      providerId: "b",
      type: "m3u",
      name: "B",
      playlistUrl: "https://playlist.invalid/current",
    };
    await editor.props.onSubmit(config);
    assert.deepEqual(R.calls, [["connect", config]]);
    assert.equal(R.focused.at(-1), "v4-settings-category-accounts");
  });
  await test("inactive production Settings ignores old actions", async () => {
    const n = render("settings", () =>
      ui.EliteV4Settings({ ...props, active: false }),
    );
    find(n, "v4-settings-account-b").props.onPress();
    assert.equal(R.calls.length, 0);
  });
  console.log(
    `Elite V4 Settings production host: ${count}/${count} passed; HOST_NOT_PHYSICAL`,
  );
} finally {
  globalThis.requestAnimationFrame = oldRAF;
  globalThis.fetch = oldFetch;
  rmSync(out, { recursive: true, force: true });
}
