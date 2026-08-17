import { Feather } from '@expo/vector-icons';
import React, { ReactNode, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
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

  return (
    <Pressable
      testID={testID}
      focusable={!disabled}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.button,
        { backgroundColor, borderColor: focused ? colors.primary : colors.border, opacity: disabled ? 0.45 : 1 },
        focused && { transform: [{ scale: 1.03 }] },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon ? <Feather name={icon} size={18} color={foregroundColor} /> : null}
      {children ?? <Text style={[styles.label, { color: foregroundColor }]}>{label}</Text>}
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
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    letterSpacing: 0.1,
  },
});