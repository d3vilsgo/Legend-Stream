# LegendStream mobile player architecture

## Runtime layers

1. `CompatibilityVideoPlayer.tsx` — playback orchestration only. Owns source switching, resume, codec mode, download state and throttled playback telemetry.
2. `components/player/VlcPlaybackSurface.tsx` — memoized native VLC surface. It must not be reconciled for clock/progress/chrome-only React state updates.
3. `components/player/PlayerChrome.tsx` — touch/UI layer. Owns the tap catcher, transient media HUD, seek bar, controls and virtualized selection panels.
4. `hooks/usePlayerOrientation.ts` — orientation lifecycle. VLC is not mounted until the first landscape layout is ready, preventing portrait-to-landscape stretch during player startup.
5. `MediaLibraryContext.tsx` — persistent resume/history storage with stable callbacks and redundant-write suppression.

## Performance invariants

- Never call `setState` for every native VLC progress event. UI clock/progress updates are throttled.
- Never persist resume position on every progress event. Persistence is periodic and lifecycle based.
- Do not allow React chrome updates to reconstruct/reconcile the VLC native view.
- Large channel/VOD/episode selectors must be virtualized (`FlatList`), not rendered as hundreds of `Pressable` rows in a `ScrollView`.
- VLC receives no touch events. A React tap layer above the native surface owns show/hide behavior so hidden controls can always be restored with one tap.
- The player mounts behind a black orientation gate and enters landscape before the native video surface is created.
- AUTO/HW/SW codec mode is a VLC decode policy; it is independent of the React control layer.

## Android compatibility baseline

- Minimum Android: API 24 / Android 7.
- Native player: libVLC through `react-native-vlc-media-player`.
- Architecture: legacy/Paper for VLC compatibility.
- Avoid adding Reanimated/keyboard native engines globally unless a feature demonstrably requires them; login forms use Android `adjustResize` plus native React Native keyboard primitives.

## Legacy cleanup

V1–V4 home screens and the old Media3 `UnifiedVideoPlayer` were removed after V5 + VLC became the only active mobile path. New playback work should extend the layers above rather than adding another parallel player implementation.
