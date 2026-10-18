import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(app, "package.json"));
const { build } = createRequire(req.resolve("tsx/package.json"))("esbuild");
const dir = mkdtempSync(join(tmpdir(), "tv-p0-production-"));
let cursor = 0, slots = [], effects = [], calls = 0;
const host = globalThis.__tvP0 = {
  width: 960, height: 540, fontScale: 1, isTV: true, effects: [], effectIndex: 0, savedEffects: [],
  state(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  },
  ref(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
  effect(fn,deps) { const i=this.effectIndex++; const before=this.savedEffects[i]; if (!before || !deps || deps.some((v,j)=>!Object.is(v,before[j]))) { this.savedEffects[i]=deps; this.effects.push(fn); } },
  reset() { slots = []; cursor = 0; this.effects = []; this.effectIndex = 0; this.savedEffects = []; },
  render(component, props) { cursor = 0; this.effectIndex = 0; this.effects = []; const result = component(props); for (const effect of this.effects) effect(); return result; },
};
const mocks = {
  react: `const h=globalThis.__tvP0;
    export const useState=v=>h.state(v),useReducer=(fn,v)=>{const [value,set]=h.state(v);return [value,event=>set(old=>fn(old,event))]},
    useRef=v=>h.ref(v),useMemo=f=>f(),useEffect=(f,d)=>h.effect(f,d),useId=()=> "id";
    export default {createElement:(tag,props,...children)=>({tag,props:{...props,children}})};`,
  "react-native": `const h=globalThis.__tvP0;
    export const View="View",Text="Text",TextInput="TextInput",ScrollView="ScrollView",FlatList="FlatList",
    Image="Image",Pressable="Pressable",ActivityIndicator="ActivityIndicator",Modal="Modal";
    export const BackHandler={addEventListener:()=>({remove(){}})};
    export const Keyboard={addListener:()=>({remove(){}})};
    export const Platform={get isTV(){return h.isTV},OS:"android"};
    export const StyleSheet={create:x=>x};
    export const useWindowDimensions=()=>({width:h.width,height:h.height,fontScale:h.fontScale,scale:1});`,
  "react-native-safe-area-context": 'export const useSafeAreaInsets=()=>({top:0,left:0,right:0,bottom:0});',
  "@expo/vector-icons": 'export const Feather="Feather";',
  "@/components/tvPreview/TVPreviewFocus": 'export const TVPreviewPressable="TVPreviewPressable";',
  "@/components/FocusButton": 'export const FocusButton="FocusButton";',
  "@/components/navigation/CompactLandscapeNavButton": 'export const CompactLandscapeNavButton="CompactLandscapeNavButton";',
  "@/context/PlayerContext": 'export const selectProgramsAt=()=>({});',
  "@/hooks/useColors": 'export const useColors=()=>({foreground:"#fff",mutedForeground:"#888",border:"#333"});',
  "@/context/UiPresentationContext": 'export const useUiPresentation=()=>({tvPreview:false});',
  "@/lib/playerRemoteOwnership": 'export const hasPlayerBackOwner=()=>false;',
  "@/lib/adaptiveNavigation": 'export const resolveAdaptiveNavigationModel=x=>({nativeTv:true,backTarget:x.activeKey==="home"?null:"home"});',
  "@/lib/design/screenProfiles": 'export const resolvePremiumCatalogProfile=()=>({horizontalPadding:8});',
};
try {
  await build({
    stdin: { contents: `export {EliteLiveCatalog} from ${JSON.stringify(join(app,"components/elite/EliteLiveCatalog.tsx"))}; export {ResponsiveContentNav} from ${JSON.stringify(join(app,"components/navigation/ResponsiveContentNav.tsx"))};`, resolveDir:app, loader:"tsx" },
    bundle:true,platform:"node",format:"cjs",outfile:join(dir,"entry.cjs"),logLevel:"silent",
    plugins:[{name:"rn-production-adapter",setup(b){
      b.onResolve({filter:/.*/},arg=>{
        if(arg.path in mocks)return {path:arg.path,namespace:"p0-mock"};
        if(arg.path.startsWith("@/")){
          const base=join(app,arg.path.slice(2));
          const file=[base,base+".ts",base+".tsx",join(base,"index.ts")].find(existsSync);
          if(file)return {path:file};
        }
        return undefined;
      });
      b.onLoad({filter:/.*/,namespace:"p0-mock"},arg=>({contents:mocks[arg.path],loader:"js",resolveDir:app}));
    }}],
  });
  const { EliteLiveCatalog,ResponsiveContentNav }=req(join(dir,"entry.cjs"));
  const find=(root,predicate)=>{
    const hits=[];
    const visit=node=>{
      if(Array.isArray(node)){node.forEach(visit);return;}
      if(!node || typeof node!=="object")return;
      if("tag" in node){if(predicate(node))hits.push(node);visit(node.props?.children);}
    };
    visit(root);return hits;
  };
  const one=(root,predicate)=>{const x=find(root,predicate);assert.equal(x.length,1);return x[0];};
  const channels=[{id:"a",name:"First Channel",logoUrl:null},{id:"b",name:"Second Channel",logoUrl:null}];
  let opened=[],categoryCalls=[],searchCalls=[],pass=0;
  const liveProps={
    categories:[{id:"cat",name:"News"}],category:"cat",onCategory:id=>categoryCalls.push(id),
    channels,epgByChannel:new Map(),clock:0,favorites:[],loading:false,loadingMore:false,error:null,
    search:"",onSearch:q=>searchCalls.push(q),onRefresh(){},onLoadMore(){},
    onOpen:channel=>opened.push(channel.id),onFavorite(){},idPrefix:"accept",
  };
  const check=(name,fn)=>{fn();pass++;console.log("ok tv-p0 "+pass+" - "+name);};
  host.reset();
  let live=host.render(EliteLiveCatalog,liveProps);
  const list=()=>one(live,n=>n.tag==="FlatList");
  check("populated production FlatList binds channels",()=>assert.deepEqual(list().props.data,channels));
  check("first production row registers reachable focus ID",()=>{
    const row=list().props.renderItem({item:channels[0],index:0});
    assert.equal(one(row,n=>n.props?.focusId==="accept:channel:a").props.accessibilityRole,"button");
  });
  check("OK on first channel forwards exact playback identity",()=>{
    const row=list().props.renderItem({item:channels[0],index:0});
    one(row,n=>n.props?.focusId==="accept:channel:a").props.onPress();
    assert.deepEqual(opened,["a"]);
  });
  check("FlatList layout accepts usable viewport measurement",()=>{
    list().props.onLayout({nativeEvent:{layout:{width:350,height:260}}});
    live=host.render(EliteLiveCatalog,liveProps);
    assert.match(one(live,n=>n.tag==="View" && typeof n.props.accessibilityHint==="string").props.accessibilityHint,/260/);
  });
  check("category controls preserve callback owner",()=>{
    one(live,n=>n.props?.focusId==="accept:category:cat").props.onPress();
    assert.deepEqual(categoryCalls,["cat"]);
  });
  for(const [name,overrides,expected] of [
    ["loading",{channels:[],loading:true},"Kanallar yükleniyor"],
    ["empty",{channels:[],loading:false},"Kanal bulunamadı"],
    ["error",{channels:[],error:"network"},"Kanallar alınamadı"],
  ]){
    check(name+" state has distinct production empty slot",()=>{
      host.reset();const root=host.render(EliteLiveCatalog,{...liveProps,...overrides});
      const empty=one(root,n=>n.tag==="FlatList").props.ListEmptyComponent;
      assert(find(empty,n=>n.tag==="Text").some(n=>n.props.children.some(x=>typeof x==="string"&&x.includes(expected))));
    });
  }
  check("search toggle mounts actual channel input without altering provider callback",()=>{
    host.reset();live=host.render(EliteLiveCatalog,liveProps);
    one(live,n=>n.props?.focusId==="accept:search-toggle").props.onPress();
    live=host.render(EliteLiveCatalog,liveProps);
    assert.equal(one(live,n=>n.tag==="TextInput").props.value,"");
    assert.deepEqual(searchCalls,[]);
  });
  check("search close retains selected channel identity and prior scroll",()=>{
    const focused = one(live,n=>n.tag==="TextInput");
    assert(focused.props.ref && "current" in focused.props.ref);
    const tracked = [];
    list().props.ref.current = {scrollToOffset:input=>tracked.push(input.offset)};
    const row = list().props.renderItem({item:channels[0],index:0});
    one(row,n=>n.props?.focusId==="accept:channel:a").props.onPress();
    list().props.onScroll({nativeEvent:{contentOffset:{y:44}}});
    one(live,n=>n.props?.focusId==="accept:search-toggle").props.onPress();
    live=host.render(EliteLiveCatalog,liveProps);
    const retained=list().props.renderItem({item:channels[0],index:0});
    assert.equal(one(retained,n=>n.props?.focusId==="accept:channel:a").props.accessibilityState.selected,true);
    assert(tracked.includes(44));
  });
  for(const [width,height] of [[720,480],[1280,720],[1920,1080]]){
    check(width+"x"+height+" keeps channel list mounted alongside categorical target",()=>{
      host.width=width;host.height=height;host.reset();
      let root=host.render(EliteLiveCatalog,liveProps);
      one(root,n=>n.tag==="View" && n.props.onLayout).props.onLayout({nativeEvent:{layout:{width,height}}});
      root=host.render(EliteLiveCatalog,liveProps);
      assert.equal(one(root,n=>n.tag==="FlatList").props.data[0].id,"a");
      assert.equal(find(root,n=>n.props?.focusId==="accept:channel:a").length,0);
      assert.equal(find(root,n=>n.props?.focusId==="accept:category:cat").length,1);
    });
  }
  host.width=960;host.height=540;
  const tabs=["home","live","movies","series"];
  let navigated=[];
  const navProps={items:tabs.map(key=>({key,label:key,icon:"tv"})),activeKey:"live",onSelect:key=>navigated.push(key)};
  host.reset();const nav=host.render(ResponsiveContentNav,navProps);
  check("four production TV tabs are renderable focus targets",()=>{
    for(const key of tabs)assert.equal(one(nav,n=>n.props?.focusId==="nav:"+key).tag,"FocusButton");
  });
  check("physical focus is distinct from active route",()=>{
    assert.equal(one(nav,n=>n.props?.focusId==="nav:live").props.accessibilityState.selected,true);
    assert.equal(one(nav,n=>n.props?.focusId==="nav:movies").props.accessibilityState.selected,false);
    assert.equal(typeof one(nav,n=>n.props?.focusId==="nav:movies").props.onFocusChange,"function");
  });
  check("all nav tabs route through production onSelect",()=>{
    for(const key of tabs)one(nav,n=>n.props?.focusId==="nav:"+key).props.onPress();
    assert.deepEqual(navigated,tabs);
  });
  check("native navigation does not own horizontal ScrollView",()=>assert.equal(find(nav,n=>n.tag==="ScrollView").length,0));
  check("StageRail expands on focus and collapses on content handoff without route change",()=>{
    const railWidth=tree=>one(tree,n=>n.tag==="View"&&n.props.accessibilityLabel==="Ana gezinme").props.style.flat().find(v=>v&&typeof v.width==="number").width;
    one(nav,n=>n.props?.focusId==="nav:movies").props.onFocusChange(false);
    const compact=host.render(ResponsiveContentNav,navProps);
    const capsule=railWidth(compact);
    assert.equal(one(compact,n=>n.props?.focusId==="nav:movies").props.label,"");
    one(compact,n=>n.props?.focusId==="nav:movies").props.onFocusChange(true);
    const expanded=host.render(ResponsiveContentNav,navProps);
    assert(railWidth(expanded)>capsule);
    assert.equal(one(expanded,n=>n.props?.focusId==="nav:movies").props.label,"movies");
    assert.equal(one(expanded,n=>n.props?.focusId==="nav:live").props.accessibilityState.selected,true);
    one(expanded,n=>n.props?.focusId==="nav:movies").props.onFocusChange(false);
    const collapsed=host.render(ResponsiveContentNav,navProps);
    assert.equal(railWidth(collapsed),capsule);
    assert.equal(one(collapsed,n=>n.props?.focusId==="nav:movies").props.label,"");
  });
  console.log(`P0 production component host: ${pass}/${pass} assertions passed; ANDROID_FOCUSFINDER_PHYSICAL_PENDING_RC`);
} finally {rmSync(dir,{recursive:true,force:true});}
