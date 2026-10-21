import React, { useState } from "react";
import { Platform, Text } from "react-native";
import { TVPreviewPressable } from "@/components/tvPreview/TVPreviewFocus";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

export function EliteV4PreviewToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TVPreviewPressable
      focusId="elite-v4-preview-toggle"
      focusScope="content"
      eliteVisual
      onPress={() => onChange(!enabled)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable
      accessibilityRole="button"
      accessibilityLabel={
        enabled ? "Elite V3 önizlemesine dön" : "Elite V4 önizlemesini aç"
      }
      style={({ pressed }) => ({
        position: "absolute",
        top: 18,
        right: 22,
        zIndex: 200,
        elevation: 200,
        minHeight: 38,
        paddingHorizontal: 14,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: focused ? theme.color.focus : theme.color.border,
        backgroundColor: theme.color.surfaceGlass,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <Text
        style={{
          color: enabled ? theme.color.accent : theme.color.foreground,
          fontSize: 12,
          fontWeight: "800",
        }}
      >
        {enabled ? "V3'e dön" : "V4 önizleme"}
      </Text>
    </TVPreviewPressable>
  );
}
