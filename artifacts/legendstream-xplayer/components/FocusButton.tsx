import { Feather } from '@expo/vector-icons';
import React, { ReactNode, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { isAndroidTV, tvPreferredFocusProps } from '@/lib/tvPlatform';

interface FocusButtonProps {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
  tvPreferredFocus?: boolean;
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
  tvPreferredFocus = false,
}: FocusButtonProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const backgroundColor =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.secondary
        : 'transparent';
  const foregroundColor = variant === 'primary' ? colors.primaryForeground : colors.foreground;
  const tvFocused = isAndroidTV && focused;

  return (
    <Pressable
      {...tvPreferredFocusProps(tvPreferredFocus && !disabled)}
      testID={testID}
      focusable={!disabled}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.button,
        {
          backgroundColor,
          borderColor: tvFocused ? '#22d3ee' : colors.border,
          opacity: disabled ? 0.45 : 1,
        },
        tvFocused && styles.tvFocused,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon ? <Feather name={icon} size={18} color={tvFocused ? '#bdf8ff' : foregroundColor} /> : null}
      {children ?? <Text style={[styles.label, { color: tvFocused ? '#f7feff' : foregroundColor }]}>{label}</Text>}
    </Pressable>
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
  tvFocused: {
    transform: [{ scale: 1.065 }],
    shadowColor: '#22d3ee',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
    zIndex: 20,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    letterSpacing: 0.1,
  },
});