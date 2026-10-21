import React, { useState } from "react";
import { Platform, Pressable, Text } from "react-native";
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
  const label = enabled ? "V3'E DÖN" : "YENİ ARAYÜZÜ DENE · ELITE V4";
  const accessibilityLabel = enabled
    ? "Elite V3 önizlemesine dön"
    : "Elite V4 önizlemesini aç";
  const buttonStyle = ({ pressed }: { pressed: boolean }) => ({
    position: "absolute" as const,
    top: 18,
    right: 22,
    zIndex: 200,
    elevation: 200,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: focused ? theme.color.foreground : theme.color.accent,
    backgroundColor: enabled ? theme.color.surfaceGlass : theme.color.accent,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    opacity: pressed ? 0.82 : 1,
  });
  const labelNode = (
    <Text
      style={{
        color: enabled ? theme.color.accent : theme.color.background,
        fontSize: 13,
        fontWeight: "800",
      }}
    >
      {label}
    </Text>
  );

  if (Platform.isTV) {
    return (
      <Pressable
        focusable
        hasTVPreferredFocus={!enabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={() => onChange(!enabled)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={buttonStyle}
      >
        {labelNode}
      </Pressable>
    );
  }

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
      accessibilityLabel={accessibilityLabel}
      style={buttonStyle}
    >
      {labelNode}
    </TVPreviewPressable>
  );
}
