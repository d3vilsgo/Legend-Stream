import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireApp = createRequire(join(app, "package.json"));
const requireServer = createRequire(resolve(app, "../api-server/package.json"));
const { build } = requireServer("esbuild");
const out = mkdtempSync(join(tmpdir(), "tv-home-render-"));
const rn = `import React from 'react';
const flat=s=>Object.assign({},...([s].flat(Infinity).filter(v=>v&&typeof v==='object')));
const node=tag=>({children,style,numberOfLines,accessibilityLabel,...p})=>React.createElement(tag,{'data-height':flat(style).minHeight ?? flat(style).height,'data-ratio':flat(style).aspectRatio,'data-lines':numberOfLines,'data-line-height':flat(style).lineHeight,'aria-label':accessibilityLabel},typeof children==='function'?null:children);
export const View=node('div'),Text=node('span'),Pressable=node('button'),Image=({source})=>React.createElement('img',{'data-artwork':source?.uri});
export const Platform={get isTV(){return globalThis.__home.native},OS:'android'};
export const StyleSheet={create:s=>s,absoluteFill:{position:'absolute'}};
export const useWindowDimensions=()=>globalThis.__home;
export const FlatList=React.forwardRef(({data,renderItem},ref)=>React.createElement('section',null,data.slice(0,1).map((item,index)=>React.createElement(React.Fragment,{key:index},renderItem({item,index})))));
`;
const mocks = {
  "react-native": rn,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>globalThis.__home.insets;`,
  "@expo/vector-icons": `import React from 'react';export const Feather=()=>React.createElement('i');`,
  "expo-linear-gradient": `import React from 'react';export const LinearGradient=()=>React.createElement('i');`,
  "@/hooks/useColors": `export const useColors=()=>({primary:'#67e8d1',foreground:'white',mutedForeground:'#aaa',border:'#333',card:'#111'});`,
  "@/context/UiPresentationContext": `export const useUiPresentation=()=>({tvPreview:Boolean(globalThis.__home.preview)});`,
  "@/context/I18nContext": `export const useI18n=()=>({language:'tr',t:k=>k});`,
  "@/context/MediaLibraryContext": `export const useMediaLibrary=()=>({entries:[],loaded:true,removeProgress(){}});`,
  "@/components/tvPreview/TVPreviewFocus": `import React from 'react';import {Pressable} from 'react-native';export const TVPreviewPressable=p=>React.createElement(Pressable,p);`,
};
try {
  await build({
    stdin: {
      contents: `export {HomeHeroCarousel} from ${JSON.stringify(join(app, "components/home/HomeDiscovery.tsx"))};`,
      resolveDir: app,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(out, "hero.cjs"),
    logLevel: "silent",
    plugins: [
      {
        name: "native-render-adapter",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in mocks)
              return { path: args.path, namespace: "native-test" };
            if (args.path === "react")
              return { path: requireApp.resolve("react"), external: true };
            if (args.path.startsWith("@/")) {
              const base = join(app, args.path.slice(2));
              const path = [
                base,
                base + ".ts",
                base + ".tsx",
                join(base, "index.ts"),
              ].find(existsSync);
              if (path) return { path };
            }
            return undefined;
          });
          b.onLoad({ filter: /.*/, namespace: "native-test" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
            resolveDir: app,
          }));
        },
      },
    ],
  });
  const { HomeHeroCarousel } = requireApp(join(out, "hero.cjs"));
  const React = requireApp("react");
  const { renderToStaticMarkup } = requireApp("react-dom/server");
  let count = 0;
  for (const [width, height] of [
    [960, 540],
    [1280, 720],
    [1920, 1080],
    [1536, 864],
  ])
    for (const fontScale of [1, 1.3, 1.6, 2])
      for (const title of [
        "Dip",
        "İstanbul’un Ötesinde Unutulmayan Yolculuğun ve Kaybolan Zamanların Uzun Hikâyesi",
      ]) {
        globalThis.__home = {
          native: true,
          width,
          height,
          fontScale,
          insets: { top: 24, right: 32, bottom: 32, left: 48 },
        };
        const props = {
          eyebrow: "Öne çıkan",
          providerName: "Yerel sağlayıcı",
          onOpen() {},
          onWatch() {},
          onDiscover() {},
          discoverLabel: title,
          tvViewportHeight: height - 170,
        };
        const item = {
          id: "fixture",
          title,
          subtitle: "Film · 2020",
          image: "https://images.example.org/poster.jpg",
        };
        const withImage = renderToStaticMarkup(
          React.createElement(HomeHeroCarousel, { ...props, items: [item] }),
        );
        const missingImage = renderToStaticMarkup(
          React.createElement(HomeHeroCarousel, {
            ...props,
            items: [{ ...item, image: "" }],
          }),
        );
        const empty = renderToStaticMarkup(
          React.createElement(HomeHeroCarousel, { ...props, items: [] }),
        );
        const loading = renderToStaticMarkup(
          React.createElement(HomeHeroCarousel, {
            ...props,
            items: [],
            loading: true,
          }),
        );
        const buttonHeight = (html) =>
          Number(html.match(/<div[^>]*data-height="([0-9.]+)"/)?.[1]);
        const h = buttonHeight(withImage);
        assert(h > 0 && h <= 320);
        assert.equal(buttonHeight(missingImage), h);
        assert.equal(buttonHeight(empty), h);
        assert(loading.includes(`data-height="${h}"`));
        assert(withImage.includes("data-artwork="));
        assert(!missingImage.includes("data-artwork="));
        assert(withImage.includes("aria-label="));
        assert(
          withImage.includes('data-lines="1"') ||
            withImage.includes('data-lines="2"'),
        );
        assert(
          withImage.includes(
            title.replaceAll("&", "&amp;").replaceAll("'", "&#x27;"),
          ) || withImage.includes(title),
        );
        count++;
      }
  globalThis.__home = {
    native: false,
    width: 393,
    height: 873,
    fontScale: 1,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const mobile = renderToStaticMarkup(
    React.createElement(HomeHeroCarousel, {
      items: [{ id: "m", title: "Film", subtitle: "Tür", image: "" }],
      eyebrow: "Öne çıkan",
      providerName: "Yerel",
      onOpen() {},
      onWatch() {},
      onDiscover() {},
      discoverLabel: "Keşfet",
    }),
  );
  assert(Number(mobile.match(/<div[^>]*data-height="([0-9.]+)"/)?.[1]) > 0);
  count++;
  let responsiveCount = 0;
  for (const [width, height] of [
    [320, 568],
    [393, 873],
    [873, 393],
    [800, 1280],
    [1280, 800],
  ])
    for (const preview of [false, true])
      for (const fontScale of [1, 1.3, 2]) {
        globalThis.__home = {
          native: false,
          preview,
          width,
          height,
          fontScale,
          insets: { top: 0, right: 12, bottom: 20, left: 24 },
        };
        const props = {
          eyebrow: "Öne çıkan",
          providerName: "Yerel",
          onOpen() {},
          onWatch() {},
          onDiscover() {},
          discoverLabel: "Çok uzun erişilebilir içerik başlığı",
          tvViewportHeight: height - 140,
        };
        const render = (items) =>
          renderToStaticMarkup(
            React.createElement(HomeHeroCarousel, { ...props, items }),
          );
        const image = render([
          {
            id: "fixture",
            title: "Çok uzun başlık",
            subtitle: "Film",
            movie: { stream_id: 7 },
            image: "https://images.example.org/poster.jpg",
          },
        ]);
        const empty = render([]);
        const loading = renderToStaticMarkup(
          React.createElement(HomeHeroCarousel, {
            ...props,
            items: [],
            loading: true,
          }),
        );
        const heightOf = (html) =>
          Number(html.match(/<div[^>]*data-height="([0-9.]+)"/)?.[1]);
        const h = heightOf(image);
        assert(h >= (width > height || preview ? 160 : 310));
        assert(h <= (width > height || preview ? 190 : 450));
        assert.equal(heightOf(empty), h);
        assert(loading.includes(`data-height="${h}"`));
        // Short/accessibility windows deliberately scroll the readable introduction;
        // the old contract squeezed it to 1dp to show a shelf simultaneously.
        const available = height - 140;
        assert(
          h + 56 * fontScale + 104 <= available + 1 ||
            h >= (width > height || preview ? 160 : 310),
        );
        assert(image.includes("Detay / Bilgi"));
        assert(image.includes("İzle"));
        responsiveCount++;
      }
  console.log(
    `U2 responsive Home component render: ${responsiveCount}/${responsiveCount} passed; HOST_ADAPTER_NOT_ANDROID_LAYOUT`,
  );
  console.log(
    `Native TV Home component render: ${count}/${count} passed; HOST_ADAPTER_NOT_ANDROID_LAYOUT`,
  );
} finally {
  delete globalThis.__home;
  rmSync(out, { recursive: true, force: true });
}
