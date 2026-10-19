import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(req.resolve("tsx/package.json"))("esbuild");
const out = mkdtempSync(join(tmpdir(), "focus-owner-host-"));
const h = (globalThis.__focusOwner = {
  slots: [],
  cursor: 0,
  effects: [],
  listeners: [],
  registered: [],
  clicks: 0,
  state(v) {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = v;
    return [this.slots[i], (v) => (this.slots[i] = v)];
  },
  ref(v) {
    const i = this.cursor++;
    return this.slots[i] ?? (this.slots[i] = { current: v });
  },
  effect(fn, deps) {
    const i = this.cursor++;
    const old = this.slots[i];
    if (!old || deps.some((d, j) => d !== old.deps[j])) {
      this.slots[i] = { deps, cleanup: old?.cleanup };
      this.effects.push(() => {
        this.slots[i].cleanup?.();
        this.slots[i].cleanup = fn();
      });
    }
  },
  flush() {
    while (this.effects.length) this.effects.shift()();
  },
  render(fn, props) {
    this.cursor = 0;
    return fn(props);
  },
});
const mocks = {
  react: `const h=globalThis.__focusOwner;export const useState=v=>h.state(v),useRef=v=>h.ref(v),useEffect=(f,d)=>h.effect(f,d),useLayoutEffect=useEffect,useCallback=f=>f,useId=()=>"host";export default {createElement:(tag,props,...children)=>({tag,props:{...props,children}})};`,
  "react-native": `export const Platform={isTV:true},View="View",Text="Text",Pressable="Pressable",findNodeHandle=()=>17,StyleSheet={create:x=>x},Animated={View:"AnimatedView",Value:class{},spring:()=>({start(){throw Error("Native focus must not animate through JS")}})};`,
  "@expo/vector-icons": `export const Feather="Feather";`,
  "@/hooks/useColors": `export const useColors=()=>({});`,
  "@/lib/tvRemoteInspector": `export const inspectorAction=()=>{};`,
  "@/modules/legendstream-tv-remote": `const h=globalThis.__focusOwner;export const registerTvTarget=(...a)=>h.registered.push(a),unregisterTvTarget=()=>{},subscribeNativeTvFocus=f=>{h.listeners.push(f);return {remove(){h.listeners=h.listeners.filter(x=>x!==f)}}};`,
};
try {
  await build({
    entryPoints: [join(app, "components/FocusButton.tsx")],
    outfile: join(out, "host.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
    plugins: [
      {
        name: "native-event-adapter",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.path in mocks) return { path: a.path, namespace: "mock" };
            if (a.path.startsWith("@/")) {
              const p = join(app, a.path.slice(2));
              return { path: [p, p + ".ts", p + ".tsx"].find(existsSync) };
            }
          });
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: mocks[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const { FocusButton } = req(join(out, "host.cjs"));
  const changes = [];
  const props = {
    focusId: "nav:home",
    label: "Home",
    onFocusChange: (...a) => changes.push(a),
    onPress: () => h.clicks++,
  };
  const render = () => {
    const tree = h.render(FocusButton, props);
    h.flush();
    return tree.props.children[0];
  };
  let button = render();
  assert.equal(button.tag, "Pressable");
  assert.equal(h.registered[0][1], "nav:home");
  assert.equal(h.registered[0][3], "navigation");
  changes.length = 0;
  button.props.onFocus();
  button.props.onBlur();
  assert.deepEqual(changes, []);
  h.listeners.forEach((f) => f({ tag: 17, id: "nav:home" }));
  button = render();
  assert.deepEqual(changes.at(-1), [true, "nav:home"]);
  h.listeners.forEach((f) => f({ tag: 22, id: "nav:movies" }));
  button = render();
  assert.deepEqual(changes.at(-1), [false, "nav:movies"]);
  // A delayed React focus event cannot reopen the rail after native content focus.
  h.listeners.forEach((f) => f({ tag: 30, id: "vod:7" }));
  button = render();
  changes.length = 0;
  button.props.onFocus();
  assert.deepEqual(changes, []);
  button.props.onPress();
  assert.equal(h.clicks, 1);
  for (let i = 0; i < 20; i++) {
    h.listeners.forEach((f) =>
      f({ tag: i % 2 ? 30 : 17, id: i % 2 ? "vod:7" : "nav:home" }),
    );
    button = render();
  }
  assert.deepEqual(changes.at(-1), [false, "vod:7"]);
  h.slots.forEach((x) => x?.cleanup?.());
  assert.equal(h.listeners.length, 0);
  console.log(
    "Native FocusButton + useNativeTvTarget production host: 8/8 PASS; PHYSICAL_PENDING",
  );
} finally {
  rmSync(out, { recursive: true, force: true });
  delete globalThis.__focusOwner;
}
