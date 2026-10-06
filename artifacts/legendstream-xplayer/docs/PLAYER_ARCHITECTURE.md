# LegendStream mobile player architecture

## Active route

1. `app/(tabs)/index.tsx` mounts `components/ProductShell.tsx`.
2. `ProductShell` chooses `StalkerMainPage` for Stalker and `OptimizedHomeScreenV6` for other providers or no provider. `OptimizedHomeScreenV6` re-exports `OptimizedHomeScreenPaged`; this is the active paged home implementation.
3. Both surfaces mount `NativeVideoPlayer` for a playable item. `NativeVideoPlayer` re-exports `CompatibilityVideoPlayerV2`; the older `CompatibilityVideoPlayer.tsx` remains in the tree but is not the entrypoint for these surfaces.
4. `CompatibilityVideoPlayerV2` coordinates source, playback state, orientation and media progress. It renders the memoized `components/player/VlcPlaybackSurface.tsx` and the `components/player/PlayerChrome.tsx` wrapper, which delegates the main controls to `PlayerChromeV2.tsx`.
5. `hooks/usePlayerOrientation.ts` owns the orientation lifecycle; `context/MediaLibraryContext.tsx` owns persistent media progress/history.

## Performance and ownership invariants

- Native VLC progress does not require a React state update for every event; UI clock/progress work is throttled.
- Resume progress persists periodically and at lifecycle boundaries, not at every native event.
- Chrome updates should not reconstruct the native VLC view. The native surface stays memoized.
- Large channel, VOD and episode selectors use virtualized lists.
- React controls/tap handling sit over VLC; the player enters landscape behind an orientation gate before mounting the video surface.
- AUTO/HW/SW is a decode policy and is separate from chrome state.

## Android compatibility baseline

- Minimum Android API 24 (Android 7).
- Native playback uses libVLC through `react-native-vlc-media-player` and the legacy/Paper architecture.
- Avoid global native engines for features that can use React Native's platform primitives.

Older V5 and compatibility files may remain for migration history or tests. Their presence does not make them the active route. Any deletion needs an import and source-reading-test audit (Issue #50).
