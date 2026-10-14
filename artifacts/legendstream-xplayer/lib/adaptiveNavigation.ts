import type { PremiumScreenProfile } from "@/lib/design/screenProfiles";

export type AdaptiveNavigationModel<Key extends string> = {
  mode: PremiumScreenProfile["mode"];
  nativeTv: boolean;
  compact: boolean;
  touchTarget: 44 | 48 | 56;
  showMenuToggle: boolean;
  showTabLabels: "active-only" | "all";
  visibleItemKeys: Key[];
  activeKey: Key;
  availableContentWidth: number;
  availableContentHeight: number;
  backTarget: Key | null;
};

export function resolveAdaptiveNavigationModel<Key extends string>(input: {
  profile: PremiumScreenProfile;
  open: boolean;
  activeKey: Key;
  itemKeys: readonly Key[];
}): AdaptiveNavigationModel<Key> {
  const { profile, open, activeKey, itemKeys } = input;
  const nativeTv = profile.deviceClass === "tv" && !profile.tvPreview;
  const tablet = profile.deviceClass === "tablet";
  const preview = profile.tvPreview && !nativeTv;
  const isCompact = !nativeTv && !preview;
  const visibleItemKeys = nativeTv || preview || open ? [...itemKeys] : [];
  return {
    mode: profile.mode,
    nativeTv,
    compact: isCompact,
    touchTarget: nativeTv ? 56 : tablet ? 48 : 44,
    showMenuToggle: !nativeTv && !preview,
    showTabLabels: nativeTv || preview ? "all" : "active-only",
    visibleItemKeys,
    activeKey,
    availableContentWidth: profile.effectiveContentWidth,
    availableContentHeight: profile.effectiveContentHeight,
    backTarget: nativeTv && itemKeys[0] !== activeKey ? itemKeys[0] ?? null : null,
  };
}
