/** Isolated WEB review of production Home components, never Android/physical evidence.
 * Fixture data is explicit and cannot reach provider, metadata or playback services. */
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  req = createRequire(join(app, "package.json"));
const { build } = createRequire(req.resolve("tsx/package.json"))("esbuild");
const out = resolve(process.argv[2] || join(app, ".home-review")),
  temp = mkdtempSync(join(tmpdir(), "home-review-"));
mkdirSync(out, { recursive: true });
const baseline = process.argv[3] || "d66ce5de0c49566d3d2cf9260fb95782d8acbfef";
for (const [name, path] of [
  ["HomeBefore", "components/home/HomeDiscovery.tsx"],
  ["NavBefore", "components/navigation/ResponsiveContentNav.tsx"],
])
  writeFileSync(
    join(temp, name + ".tsx"),
    execFileSync(
      "git",
      ["show", baseline + ":artifacts/legendstream-xplayer/" + path],
      { cwd: app },
    ),
  );
const mocks = {
  "@/modules/legendstream-tv-remote": `export const subscribeNativeTvFocus=()=>({remove(){}});`,
  "@/lib/tvRemoteInspector": `export const inspectorRail=()=>{};`,
  "react-native": `export * from ${JSON.stringify(req.resolve("react-native-web"))};import * as W from ${JSON.stringify(req.resolve("react-native-web"))};export const Platform={...W.Platform,get isTV(){return globalThis.__review.native}};export const useWindowDimensions=()=>globalThis.__review;`,
  "@/hooks/useColors": `export const useColors=()=>({primary:'#67e8d1',foreground:'#f4f7fa',mutedForeground:'#a9bbc7',border:'#34434e',card:'#17232d',background:'#0d151e',muted:'#24353f',secondary:'#24353f'});`,
  "@/context/UiPresentationContext": `export const useUiPresentation=()=>({tvPreview:globalThis.__review.preview});`,
  "@/context/I18nContext": `export const useI18n=()=>({language:'tr',t:k=>({home:'Ana Sayfa',liveTv:'Canlı',movies:'Filmler',series:'Diziler'}[k]||k)});`,
  "@/context/MediaLibraryContext": `export const useMediaLibrary=()=>({entries:[{id:'fixture-progress',title:'Örnek Film · Son Yolculuk',position:120,duration:600,source:{providerId:'fixture-provider'}}],loaded:true,removeProgress(){}});`,
  "@/components/tvPreview/TVPreviewFocus": `export {Pressable as TVPreviewPressable} from 'react-native';export const useTVPreviewFocus=()=>({});`,
  "@/components/FocusButton": `import React from 'react';import {Pressable,Text} from 'react-native';export const FocusButton=({label,onPress})=><Pressable onPress={onPress} style={{padding:14,borderRadius:12,borderColor:'#43515d',borderWidth:1}}><Text style={{color:'white'}}>{label}</Text></Pressable>;`,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({top:0,right:0,left:0,bottom:12});`,
};
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{View,Text,ScrollView}from'react-native';import{HomeDiscovery as After}from ${JSON.stringify(join(app, "components/home/HomeDiscovery.tsx"))};import{HomeDiscovery as Before}from ${JSON.stringify(join(temp, "HomeBefore.tsx"))};import{ResponsiveContentNav as NavAfter}from ${JSON.stringify(join(app, "components/navigation/ResponsiveContentNav.tsx"))};import{ResponsiveContentNav as NavBefore}from ${JSON.stringify(join(temp, "NavBefore.tsx"))};
const params=new URLSearchParams(location.search),profiles={phone:{width:393,height:873,native:false,preview:false},preview:{width:873,height:393,native:false,preview:true},tv:{width:960,height:540,native:true,preview:false},tv720:{width:1280,height:720,native:true,preview:false},tv1080:{width:1920,height:1080,native:true,preview:false},tablet:{width:1280,height:800,native:false,preview:false},landscape:{width:873,height:393,native:false,preview:false}};globalThis.__review={...profiles[params.get('profile')||'phone'],fontScale:1};const p=globalThis.__review;const old=params.get('before')==='1',Home=old?Before:After,Nav=old?NavBefore:NavAfter;const nav=['home','live','movies','series','history','downloads','settings'].map(key=>({key,label:{home:'Ana Sayfa',live:'Canlı',movies:'Filmler',series:'Diziler',history:'Geçmiş',downloads:'İndirmeler',settings:'Ayarlar'}[key],icon:'home'}));
const movies=[{stream_id:'fixture-film-1',name:'Örnek Film · Son Yolculuk',genre:'Drama',plot:'Bu yalnız yerel sunum incelemesi için örnek katalog verisidir.'},{stream_id:'fixture-film-2',name:'Örnek Film · İstanbul'}],series=[{series_id:'fixture-series-1',name:'Örnek Dizi · Ufuk'}];function App(){const [status,setStatus]=useState('Örnek veriler; gerçek provider ve playback bağlı değil.');const select=(item)=>setStatus('Seçilen gerçek nesne kimliği: '+(item.stream_id||item.series_id||item));return <><header><strong>{old?'ÖNCE · ${baseline.slice(0, 8)}':'SONRA · çalışan kaynak bileşenleri'}</strong><p>WEB ÖNİZLEME / ÖRNEK KATALOG — Android, emulator veya fiziksel cihaz görüntüsü değildir.</p><nav><a href='?profile=phone'>Mobil portre</a> · <a href='?profile=preview'>Yatay / Preview</a> · <a href='?profile=tv'>960 TV dp</a> · <a href='?profile=tv720'>720 TV</a> · <a href='?profile=tv1080'>1080 TV</a> · <a href='?profile=tablet'>Tablet</a> · <a href='?profile=landscape'>Telefon yatay</a> · <a href={'?profile='+(params.get('profile')||'phone')+(old?'':'&before=1')}>{old?'Sonra':'Önce'}</a></nav><p>{status}</p></header><div id='device' style={{width:p.width,height:p.height}}><View style={{flex:1,backgroundColor:'#0d151e'}}><Text style={{color:'#67e8d1',fontSize:18,fontWeight:'800',padding:12}}>LEGENDSTREAM</Text><Nav items={nav} activeKey='home' onSelect={select}/><ScrollView style={{flex:1}} contentContainerStyle={{padding:18,paddingLeft:p.native?102:18}}><Home provider={{id:'fixture-provider',type:'xtream',name:'Örnek kaynak'}} live={2} vod={2} series={1} vodCategories={1} seriesCategories={1} catalogLoading={false} channels={[{id:'fixture-live',providerId:'fixture-provider',name:'Örnek Kanal',category:'Haber',streamUrl:''}]} history={[]} movies={movies} seriesItems={series} newChannels={[]} newMovies={[]} newSeries={[]} onNavigate={select} onOpenLive={select} onOpenMovie={select} onWatchMovie={select} onOpenSeries={select} onOpenMedia={select} onRemoveLive={()=>{}} tvViewportHeight={p.height-140}/></ScrollView>{!old?<Nav placement='bottom' items={nav} activeKey='home' onSelect={select}/>:null}{p.preview?<View style={{height:old?0:190,backgroundColor:'#17232d'}}><Text style={{color:'white',padding:14}}>Ayrılmış sanal kumanda alanı (bu önizlemede input simülasyonu yok)</Text></View>:null}</View></div></>;}createRoot(document.getElementById('root')).render(<App/>);`;
try {
  await build({
    stdin: { contents: entry, resolveDir: app, loader: "tsx" },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
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
    loader: { ".ttf": "dataurl", ".js": "jsx" },
    plugins: [
      {
        name: "review-adapters",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in mocks)
              return { path: args.path, namespace: "review" };
            if (args.path.startsWith("@/")) {
              const base = join(app, args.path.slice(2));
              const path = [
                base + ".tsx",
                base + ".ts",
                join(base, "index.ts"),
              ].find(existsSync);
              if (path) return { path };
            }
            if (
              args.importer.startsWith(temp) &&
              !args.path.startsWith(".") &&
              !args.path.startsWith("/")
            )
              return { path: req.resolve(args.path) };
          });
          b.onLoad({ filter: /.*/, namespace: "review" }, (args) => ({
            contents: mocks[args.path],
            loader: "tsx",
            resolveDir: app,
          }));
        },
      },
    ],
  }).then((result) =>
    writeFileSync(
      join(out, "LegendStream-Home-Once-Sonra-Web.html"),
      `<!doctype html><html lang='tr'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>LegendStream Home — Kaynak web incelemesi</title><style>body{margin:0;background:#080e15;color:white;font-family:system-ui}header{padding:20px}p{font-size:13px;color:#b7cad5}a{color:#67e8d1}#device{margin:12px auto 40px;display:flex;border:1px solid #485b67;overflow:hidden}#root{width:100%}button:focus-visible,[tabindex]:focus-visible{outline:3px solid white!important}</style><div id='root'></div><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></html>`,
    ),
  );
  process.stdout.write(
    "Home review: " + join(out, "LegendStream-Home-Once-Sonra-Web.html") + "\n",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
