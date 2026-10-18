import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(req.resolve("tsx/package.json"))("esbuild");
const out = mkdtempSync(join(tmpdir(), "u41-rail-host-"));
let slots = [];
let cursor = 0;
const host = globalThis.__u41 = {
  width: 720, height: 480, fontScale: 1, tv: true, preview: false,
  reset() { slots = []; cursor = 0; },
  state(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next) => {
      slots[index] = typeof next === "function" ? next(slots[index]) : next;
    }];
  },
  ref(initial) {
    const index = cursor++;
    return slots[index] ?? (slots[index] = { current: initial });
  },
  render(fn, props) { cursor = 0; return fn(props); },
};
const mocks = {
  react: `const h=globalThis.__u41;
    export const useState=x=>h.state(x),useRef=x=>h.ref(x),
      useReducer=(fn,v)=>{const [value,set]=h.state(v);return [value,event=>set(old=>fn(old,event))]},
      useMemo=f=>f(),useEffect=()=>{},useCallback=f=>f;
    export default {createElement:(tag,props,...children)=>({tag,props:{...props,children}})};`,
  "react-native": `const h=globalThis.__u41;
    export const View="View",Text="Text",TextInput="TextInput",
      ScrollView="ScrollView",FlatList="FlatList",Image="Image",
      Modal="Modal",Pressable="Pressable",ActivityIndicator="ActivityIndicator";
    export const BackHandler={addEventListener:()=>({remove(){}})};
    export const Keyboard={addListener:()=>({remove(){}})};
    export const Platform={get isTV(){return h.tv},OS:"android"};
    export const StyleSheet={create:x=>x};
    export const useWindowDimensions=()=>({width:h.width,height:h.height,fontScale:h.fontScale,scale:1});`,
  "react-native-safe-area-context": 'export const useSafeAreaInsets=()=>({top:8,left:12,right:12,bottom:8});',
  "@expo/vector-icons": 'export const Feather="Feather";',
  "@/components/FocusButton": 'export const FocusButton="FocusButton";',
  "@/components/navigation/CompactLandscapeNavButton": 'export const CompactLandscapeNavButton="CompactLandscapeNavButton";',
  "@/components/tvPreview/TVPreviewFocus": 'export const TVPreviewPressable="TVPreviewPressable";',
  "@/context/UiPresentationContext": 'export const useUiPresentation=()=>({tvPreview:globalThis.__u41.preview});',
  "@/context/PlayerContext": 'export const selectProgramsAt=()=>({});',
  "@/hooks/useColors": 'export const useColors=()=>({foreground:"#fff",mutedForeground:"#aaa",border:"#333"});',
  "@/lib/adaptiveNavigation": 'export const resolveAdaptiveNavigationModel=()=>({nativeTv:globalThis.__u41.tv,backTarget:"home"});',
  "@/lib/design/screenProfiles": 'export const resolvePremiumCatalogProfile=()=>({horizontalPadding:12});',
  "@/lib/playerRemoteOwnership": 'export const hasPlayerBackOwner=()=>false;',
};
try {
  await build({
    stdin: {
      contents: `export { ResponsiveContentNav } from ${JSON.stringify(join(app,"components/navigation/ResponsiveContentNav.tsx"))};export { EliteLiveCatalog } from ${JSON.stringify(join(app,"components/elite/EliteLiveCatalog.tsx"))};`,
      resolveDir: app, loader: "tsx",
    },
    bundle: true, platform: "node", format: "cjs", outfile: join(out,"production.cjs"), logLevel: "silent",
    plugins: [{
      name: "u41-production-adapter",
      setup(builder) {
        builder.onResolve({filter:/.*/},args=>{
          if (args.path in mocks) return {path:args.path,namespace:"host-mock"};
          if(args.path.startsWith("@/")){
            const base=join(app,args.path.slice(2));
            const path=[base,base+".ts",base+".tsx",join(base,"index.ts")].find(existsSync);
            if(path) return {path};
          }
        });
        builder.onLoad({filter:/.*/,namespace:"host-mock"},args=>({contents:mocks[args.path],loader:"js",resolveDir:app}));
      },
    }],
  });
  const { ResponsiveContentNav, EliteLiveCatalog } = req(join(out,"production.cjs"));
  const all=(root,predicate,found=[])=>{
    if(Array.isArray(root))root.forEach(x=>all(x,predicate,found));
    else if(root && typeof root==="object" && "tag" in root){
      if(predicate(root))found.push(root);
      all(root.props?.children,predicate,found);
    }
    return found;
  };
  const only=(root,predicate)=>{
    const result=all(root,predicate);
    assert.equal(result.length,1);
    return result[0];
  };
  const items=["home","live","movies","series"].map(key=>({key,label:key,icon:"tv"}));
  const chosen=[];
  const props={items,activeKey:"home",onSelect:key=>chosen.push(key)};
  let passed=0;
  for(const [width,height] of [[720,480],[1920,1080]]) {
    host.reset(); Object.assign(host,{width,height,tv:true,preview:false});
    let tree=host.render(ResponsiveContentNav,props);
    const root=only(tree,node=>node.tag==="View"&&node.props.accessibilityLabel==="Ana gezinme");
    assert.equal(root.props.style[1].flexDirection,"column");
    assert.equal(root.props.style[1].position,"absolute");
    assert.equal(all(tree,node=>node.tag==="ScrollView").length,0);
    for(const item of items) {
      const button=only(tree,node=>node.props?.focusId==="nav:"+item.key);
      assert.equal(button.tag,"FocusButton");
      assert.equal(button.props.label,"");
      assert.equal(button.props.accessibilityLabel,item.label);
    }
    only(tree,node=>node.props?.focusId==="nav:movies").props.onFocusChange(true);
    tree=host.render(ResponsiveContentNav,props);
    assert.equal(only(tree,node=>node.props?.focusId==="nav:movies").props.label,"movies");
    for(const item of items)only(tree,node=>node.props?.focusId==="nav:"+item.key).props.onPress();
    assert.deepEqual(chosen.splice(0),items.map(x=>x.key));
    only(tree,node=>node.props?.focusId==="nav:movies").props.onFocusChange(false);
    tree=host.render(ResponsiveContentNav,props);
    assert.equal(only(tree,node=>node.props?.focusId==="nav:movies").props.label,"");
    passed++;
  }
  host.reset();Object.assign(host,{tv:false,preview:true,width:873,height:393});
  const preview=host.render(ResponsiveContentNav,props);
  assert.equal(all(preview,node=>node.tag==="CompactLandscapeNavButton").length,4);
  passed++;
  host.reset();Object.assign(host,{tv:false,preview:false,width:393,height:873});
  const mobile=host.render(ResponsiveContentNav,props);
  assert.equal(all(mobile,node=>node.tag==="FocusButton").length,0);
  passed++;
  for(const [width,height] of [[720,480],[1920,1080]]) {
    host.reset();Object.assign(host,{tv:true,preview:false,width,height});
    const channels=[{id:"channel-7",name:"News"},{id:"channel-11",name:"Movies"}];
    const opened=[];
    const liveProps={
      categories:[{id:"general",name:"General"}],category:"general",onCategory(){},
      channels,epgByChannel:new Map(),clock:0,favorites:[],loading:false,
      loadingMore:false,search:"",onSearch(){},onRefresh(){},onLoadMore(){},
      onOpen:channel=>opened.push(channel.id),onFavorite(){},idPrefix:"u41",
    };
    let live=host.render(EliteLiveCatalog,liveProps);
    const onLayout=only(live,node=>node.tag==="View"&&typeof node.props.onLayout==="function");
    onLayout.props.onLayout({nativeEvent:{layout:{width,height}}});
    live=host.render(EliteLiveCatalog,liveProps);
    const list=only(live,node=>node.tag==="FlatList");
    assert.equal(list.props.data.length,2);
    const channel=list.props.renderItem({item:channels[1],index:1});
    only(channel,node=>node.props?.focusId==="u41:channel:channel-11").props.onPress();
    assert.deepEqual(opened,["channel-11"]);
    passed++;
  }
  console.log(`U4.1 production StageRail/Live host: ${passed}/${passed} PASS; ANDROID_FOCUSFINDER_PENDING_RC`);
} finally {
  delete globalThis.__u41;
  rmSync(out,{recursive:true,force:true});
}
