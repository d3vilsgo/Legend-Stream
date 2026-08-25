import { Feather } from '@expo/vector-icons';
import React, { ReactNode, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface FocusButtonProps {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
  hasTVPreferredFocus?: boolean;
}

export function FocusButton({
  label,
  icon,
  onPress,
  variant = 'secondary',
  disabled = false,
  style,
  children,
  testID,
  hasTVPreferredFocus = false,
}: FocusButtonProps) {
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
  const tvFocused = Platform.isTV && focused;

  const animateFocus = (next: boolean) => {
    setFocused(next);
    if (!Platform.isTV) return;
    Animated.spring(scale, {
      toValue: next ? 1.055 : 1,
      damping: 18,
      stiffness: 210,
      mass: 0.45,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[tvFocused ? styles.tvGlowWrap : null, { transform: [{ scale }] }]}>
      <Pressable
        testID={testID}
        focusable={!disabled}
        hasTVPreferredFocus={Platform.isTV && hasTVPreferredFocus}
        disabled={disabled}
        onPress={onPress}
        onFocus={() => animateFocus(true)}
        onBlur={() => animateFocus(false)}
        style={[
          styles.button,
          {
            backgroundColor,
            borderColor: tvFocused ? colors.primary : focused ? colors.primary : colors.border,
            borderWidth: tvFocused ? 2 : 1,
            opacity: disabled ? 0.45 : 1,
          },
          tvFocused ? { shadowColor: colors.primary } : null,
          style,
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {icon ? <Feather name={icon} size={18} color={foregroundColor} /> : null}
        {children ?? <Text style={[styles.label, { color: foregroundColor }]}>{label}</Text>}
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
