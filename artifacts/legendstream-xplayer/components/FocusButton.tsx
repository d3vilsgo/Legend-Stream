import { inspectorAction } from "@/lib/tvRemoteInspector";
import { useNativeTvTarget } from "@/hooks/useNativeTvTarget";
import { Feather } from '@expo/vector-icons';
import React, { ReactNode, useId, useEffect, useRef, useState } from 'react';
import { type AccessibilityRole, type AccessibilityState, Animated, Platform, Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface FocusButtonProps {
  label: string;
  labelLines?: number;
  labelStyle?: StyleProp<TextStyle>;
  icon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
  hasTVPreferredFocus?: boolean;
  focusId?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  onFocusChange?: (focused: boolean) => void;
}

export function FocusButton({
  label,
  labelLines,
  labelStyle,
  icon,
  onPress,
  variant = 'secondary',
  disabled = false,
  style,
  children,
  testID,
  hasTVPreferredFocus = false,
  accessibilityRole = 'button',
  accessibilityState,
  onFocusChange,
  focusId,
}: FocusButtonProps) {
  const nativeRef = useRef<View>(null);
  const generatedId = useId();
  const id = focusId ?? testID ?? `button:${label}:${generatedId}`;
  const nativeFocus = useNativeTvTarget(nativeRef,id,"content",id.startsWith("nav:") ? "navigation" : "content",disabled,hasTVPreferredFocus);
  useEffect(() => { if(Platform.isTV) onFocusChange?.(nativeFocus.focused); },[nativeFocus.focused,onFocusChange]);
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const backgroundColor =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.secondary
        : 'transparent';
  const foregroundColor = variant === 'primary' ? colors.primaryForeground : colors.foreground;
  const tvFocused = Platform.isTV && nativeFocus.focused;

  const animateFocus = (next: boolean) => {
    setFocused(next);
    onFocusChange?.(next);
    if (!Platform.isTV) return;
    Animated.spring(scale, {
      toValue: 1,
      damping: 18,
      stiffness: 210,
      mass: 0.45,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[tvFocused ? styles.tvGlowWrap : null, { transform: [{ scale }] }]}>
      <Pressable
        ref={nativeRef}
        nativeID={id}
        onLayout={nativeFocus.register}
        testID={testID}
        focusable={!disabled}
        hasTVPreferredFocus={false}
        disabled={disabled}
        onPress={() => { onPress(); if(Platform.isTV) inspectorAction("onPress"); }}
        onFocus={() => animateFocus(true)}
        onBlur={() => animateFocus(false)}
        style={[
          styles.button,
          {
            backgroundColor,
            borderColor: tvFocused ? "#fff" : colors.border,
            borderWidth: Platform.isTV ? 3 : 1,
            opacity: disabled ? 0.45 : 1,
          },
          tvFocused ? { shadowColor: colors.primary } : null,
          style,
        ]}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        accessibilityLabel={label}
      >
        {icon ? <Feather name={icon} size={18} color={foregroundColor} /> : null}
        {children ?? <Text numberOfLines={labelLines} style={[styles.label, { color: foregroundColor }, labelStyle]}>{label}</Text>}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  tvGlowWrap: {
    shadowOpacity: 0.55,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
    borderRadius: 14,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    letterSpacing: 0.1,
  },
});
