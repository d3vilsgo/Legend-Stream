import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const source = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const nativePlayer = source("components/NativeVideoPlayer.tsx");
const compatibilityPlayer = source("components/CompatibilityVideoPlayerV2.tsx");
const vlcSurface = source("components/player/VlcPlaybackSurface.tsx");
const playerChrome = source("components/player/PlayerChrome.tsx");
const home = source("components/OptimizedHomeScreenPaged.tsx");
const vod = source("components/stalker/StalkerVodSurface.tsx");
const series = source("components/stalker/StalkerSeriesProductSurface.tsx");
const seriesProduct = source("lib/stalkerSeriesProduct.ts");

// A/B/C: one canonical player core, no media-specific player fork, exact media kinds.
assert.match(nativePlayer, /CompatibilityVideoPlayer as NativeVideoPlayer/);
for (const productSource of [home, vod, series]) assert.match(productSource, /NativeVideoPlayer/);
assert.doesNotMatch([compatibilityPlayer, vlcSurface, vod, series].join("\n"), /function\s+(?:VodPlayer|SeriesPlayer|LivePlayer)\b|class\s+(?:VodPlayer|SeriesPlayer|LivePlayer)\b/);
assert.match(home, /kind:\s*"live"/);
assert.match(home, /kind:\s*"movie"/);
assert.match(home, /kind:\s*"episode"/);
assert.match(vod, /mediaKind="movie"/);
assert.match(seriesProduct, /mediaKind:\s*"episode"/);
assert.match(series, /mediaKind=\{player\.mediaKind\}/);

// D/E/F/G: explicit first-frame UX, shared by every NativeVideoPlayer invocation.
assert.match(vlcSurface, /const \[firstFramePending, setFirstFramePending\] = useState\(true\)/);
assert.match(vlcSurface, /Akış hazırlanıyor…/);
assert.match(vlcSurface, /ActivityIndicator/);
assert.match(vlcSurface, /const handleLoad[\s\S]*?setFirstFramePending\(false\)/);
assert.match(vlcSurface, /const handleProgress[\s\S]*?setFirstFramePending\(false\)/);
assert.match(vlcSurface, /const handlePlaying[\s\S]*?setFirstFramePending\(false\)/);
assert.match(vlcSurface, /const handleError[\s\S]*?setFirstFramePending\(false\)[\s\S]*?onError\(\)/);
assert.match(vlcSurface, /return \(\) => \{[\s\S]*?setFirstFramePending\(false\)[\s\S]*?vlc_unmount/);
assert.match(vlcSurface, /setFirstFramePending\(true\)[\s\S]*?setRuntimeCodecMode\("software"\)/);

// H/I/J: player exit returns to existing detail state; Series season state is not cleared by player exit.
assert.match(vod, /onFullscreenExit=\{\(\) => setView\("details"\)\}/);
assert.match(series, /onFullscreenExit=\{\(\) => setPlayer\(null\)\}/);
const playerExitSlice = series.slice(series.indexOf("if (player)"), series.indexOf("return <StalkerSeriesProductCatalog"));
assert.doesNotMatch(playerExitSlice, /setSelectedSeasonId\(null\)/);
assert.match(series, /selectedSeasonId=\{selectedSeasonId\}/);

// K/L/M: Live-only queue/EPG and movie/episode-only progress semantics remain in the canonical core.
assert.match(compatibilityPlayer, /currentKind !== "live"/);
assert.match(compatibilityPlayer, /registerEpgChannels/);
assert.match(compatibilityPlayer, /currentKind === "live"[\s\S]*?resolveLiveQueue/);
assert.match(compatibilityPlayer, /snapshot\.kind !== "movie" && snapshot\.kind !== "episode"/);
assert.match(compatibilityPlayer, /saveProgress\(/);
assert.match(compatibilityPlayer, /snapshot\.kind === "movie" \|\| snapshot\.kind === "episode"/);

// N: audio/subtitle track selectors remain wired through the same shell.
assert.match(compatibilityPlayer, /audioTracks=\{audioTracks\}/);
assert.match(compatibilityPlayer, /textTracks=\{textTracks\}/);
assert.match(compatibilityPlayer, /onSelectSubtitle/);
assert.match(compatibilityPlayer, /onSelectAudio/);
assert.match(playerChrome, /audioTracks/);
assert.match(playerChrome, /textTracks/);

// O + shell parity: shared orientation, chrome timing, background tap, error and exit lifecycle.
assert.match(compatibilityPlayer, /usePlayerOrientation\(autoFullscreen\)/);
assert.match(compatibilityPlayer, /DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS/);
assert.match(compatibilityPlayer, /onBackgroundPress=\{onBackgroundPress\}/);
assert.match(compatibilityPlayer, /errorText=\{errorText\}/);
assert.match(compatibilityPlayer, /orientation\.beginExit\(\)/);
assert.match(compatibilityPlayer, /await orientation\.restore\(\)/);
assert.match(compatibilityPlayer, /onFullscreenExit\?\.\(\)/);
assert.match(vod, /autoFullscreen/);
assert.match(series, /autoFullscreen/);
assert.match(home, /autoFullscreen/);

console.log("R16-D8-C2 canonical player UX parity source/runtime contracts: PASS");
