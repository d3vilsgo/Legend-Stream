import React, { useEffect } from "react";
import { Modal, Platform, ScrollView, Text, View } from "react-native";
import {
  TVPreviewFocusRegion,
  TVPreviewPressable,
  useTVPreviewFocus,
} from "@/components/tvPreview/TVPreviewFocus";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

export function SettingsDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const focus = useTVPreviewFocus();
  useEffect(
    () => focus.pushFocusScope("v4-settings-dialog"),
    [focus.pushFocusScope],
  );
  useEffect(
    () => focus.registerBackAction(onClose),
    [focus.registerBackAction, onClose],
  );
  return (
    <Modal
      visible
      animationType="none"
      onRequestClose={onClose}
      accessibilityViewIsModal
      onShow={() => {
        if (Platform.isTV) void focus.modalShown("v4-settings-dialog");
      }}
    >
      <TVPreviewFocusRegion>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ backgroundColor: theme.color.background }}
          contentContainerStyle={{
            padding: 24,
            gap: 12,
            width: "100%",
            maxWidth: 800,
            alignSelf: "center",
          }}
        >
          <Text
            style={{
              fontSize: 20,
              color: theme.color.foreground,
              fontWeight: "700",
            }}
          >
            {title}
          </Text>
          <SettingsDialogButton
            id="cancel"
            label="İptal / Geri"
            onPress={onClose}
          />
          {children}
        </ScrollView>
      </TVPreviewFocusRegion>
    </Modal>
  );
}
export function SettingsDialogButton({
  id,
  label,
  onPress,
  disabled = false,
}: {
  id: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TVPreviewPressable
      focusScope="v4-settings-dialog"
      focusId={`v4-settings-dialog-${id}`}
      eliteVisual
      focusVisualStyle={{ borderWidth: 1, borderColor: theme.color.focus }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderWidth: 1,
        borderColor: theme.color.border,
        borderRadius: 8,
        backgroundColor: theme.color.surface,
      }}
    >
      <Text style={{ color: theme.color.foreground, fontSize: 14 }}>
        {label}
      </Text>
    </TVPreviewPressable>
  );
}
