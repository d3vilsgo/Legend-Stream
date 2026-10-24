import React, { useRef, useState } from "react";
import { Text } from "react-native";
import { usePlayer } from "@/context/PlayerContext";
import { contentFavoriteKey } from "@/lib/contentFavorites";
import type { LibraryTarget } from "@/lib/eliteV4Library";
import { TVPreviewPressable } from "@/components/tvPreview/TVPreviewFocus";
import { EliteV4FocusButton } from "./EliteV4FocusSurface";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";
export function EliteV4FavoriteAction({
  target,
  focusId,
  scope,
  neighbors,
  disabled = false,
}: {
  target: LibraryTarget;
  focusId: string;
  scope?: string;
  neighbors?: { up?: string; down?: string; left?: string; right?: string };
  disabled?: boolean;
}) {
  const player = usePlayer(),
    [busy, setBusy] = useState(false),
    lock = useRef(false),
    latest = useRef(player);
  latest.current = player;
  const selected = (player.mediaFavorites ?? []).some(
    (item) => contentFavoriteKey(item) === contentFavoriteKey(target),
  );
  const onPress = async () => {
    if (
      lock.current ||
      disabled ||
      latest.current.provider?.id !== target.providerId ||
      !latest.current.setMediaFavorite
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      await latest.current.setMediaFavorite(target, !selected);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const style = {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.small,
    backgroundColor: theme.color.surface,
  };
  const text = (
    <Text
      style={{
        color: selected ? theme.color.accent : theme.color.muted,
        fontSize: 13,
      }}
    >
      {selected ? "★ Favorilerimde" : "☆ Favorilere ekle"}
    </Text>
  );
  return scope ? (
    <TVPreviewPressable
      eliteVisual
      focusScope={scope}
      focusId={focusId}
      focusVisualStyle={{ borderWidth: 1, borderColor: theme.color.focus }}
      disabled={disabled}
      onPress={() => void onPress()}
      style={style}
      accessibilityLabel={selected ? "Favorilerden çıkar" : "Favorilere ekle"}
    >
      {text}
    </TVPreviewPressable>
  ) : (
    <EliteV4FocusButton
      focusId={focusId}
      region="content"
      selected={selected}
      disabled={disabled}
      onPress={() => void onPress()}
      neighbors={neighbors}
      style={style}
      accessibilityLabel={selected ? "Favorilerden çıkar" : "Favorilere ekle"}
    >
      {text}
    </EliteV4FocusButton>
  );
}
