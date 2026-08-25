from pathlib import Path
import re

ROOT = Path('artifacts/legendstream-xplayer/components')

# 1) TV-aware FocusButton: strong cyan focus ring/glow + animated scale, phone untouched.
focus_path = ROOT / 'FocusButton.tsx'
focus_path.write_text('''import { Feather } from '@expo/vector-icons';
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
''')

# 2) Provider chip: same TV focus language without changing phone visuals/behavior.
chip_path = ROOT / 'ProviderSubscriptionChip.tsx'
chip = chip_path.read_text()
chip = chip.replace(
    'import React, { useCallback, useEffect, useMemo, useState } from "react";\nimport { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";',
    'import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";\nimport { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";'
)
chip = chip.replace(
    '  const [error, setError] = useState<string | null>(null);\n',
    '  const [error, setError] = useState<string | null>(null);\n  const [focused, setFocused] = useState(false);\n  const focusScale = useRef(new Animated.Value(1)).current;\n\n  const setTvFocus = (next: boolean) => {\n    setFocused(next);\n    if (!Platform.isTV) return;\n    Animated.spring(focusScale, {\n      toValue: next ? 1.055 : 1,\n      damping: 18,\n      stiffness: 210,\n      mass: 0.45,\n      useNativeDriver: true,\n    }).start();\n  };\n'
)
old_chip = '''      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abonelik bilgilerini aç"
        onPress={() => {
          setOpen(true);
          if (canQuery && !loading) void refresh();
        }}
        style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.card }]}
      >'''
new_chip = '''      <Animated.View style={[Platform.isTV && focused ? styles.tvFocusGlow : null, { transform: [{ scale: focusScale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abonelik bilgilerini aç"
        focusable
        onFocus={() => setTvFocus(true)}
        onBlur={() => setTvFocus(false)}
        onPress={() => {
          setOpen(true);
          if (canQuery && !loading) void refresh();
        }}
        style={[
          styles.chip,
          {
            borderColor: Platform.isTV && focused ? colors.primary : colors.border,
            borderWidth: Platform.isTV && focused ? 2 : 1,
            backgroundColor: colors.card,
            shadowColor: Platform.isTV && focused ? colors.primary : undefined,
          },
        ]}
      >'''
if old_chip not in chip:
    raise SystemExit('provider chip opening block not found')
chip = chip.replace(old_chip, new_chip, 1)
chip = chip.replace('''      </Pressable>\n\n      <Modal''', '''      </Pressable>\n      </Animated.View>\n\n      <Modal''', 1)
chip = chip.replace(
    '  dot: { width: 8, height: 8, borderRadius: 4 },',
    '  tvFocusGlow: { borderRadius: 999, shadowOpacity: 0.55, shadowRadius: 15, shadowOffset: { width: 0, height: 0 }, elevation: 10 },\n  dot: { width: 8, height: 8, borderRadius: 4 },'
)
chip_path.write_text(chip)

# 3) Home-only cards: premium gradients + explicit D-pad focus for stat/account tiles.
home_path = ROOT / 'OptimizedHomeScreenV6.tsx'
home = home_path.read_text()

# First content card receives initial TV focus.
home = home.replace(
    '<Stat icon="radio" label={t("liveTv")} value={live.toLocaleString()} accent={colors.primary} onPress={() => onNavigate("live")} />',
    '<Stat icon="radio" label={t("liveTv")} value={live.toLocaleString()} accent={colors.primary} preferredFocus onPress={() => onNavigate("live")} />',
    1,
)

# Replace saved account inline Pressables with reusable focus-aware premium tiles.
pattern = re.compile(r'''\{providers\.map\(\(item\) => \{\n\s+const active = item\.id === provider\.id;\n\s+return <Pressable.*?\n\s+</Pressable>;\n\s+\}\)\}\n\s+<Pressable\n\s+onPress=\{onAdd\}.*?\n\s+</Pressable>''', re.S)
replacement = '''{providers.map((item) => (
          <HomeAccountTile
            key={item.id}
            item={item}
            active={item.id === provider.id}
            disabled={loading}
            onPress={() => onSwitch(item.id)}
          />
        ))}
        <HomeAccountTile add disabled={loading} onPress={onAdd} />'''
home, count = pattern.subn(replacement, home, count=1)
if count != 1:
    raise SystemExit(f'home account grid replacement count={count}')

# Replace Stat implementation with animated TV focus version.
start = home.index('function Stat({')
end = home.index('\nfunction Loading(', start)
stat_impl = '''function Stat({ icon, label, value, accent, onPress, preferredFocus = false }: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  accent: string;
  onPress: () => void;
  preferredFocus?: boolean;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
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
  return <Animated.View style={[s.statPremiumPress, tvFocused ? s.homeTvGlow : null, tvFocused ? { shadowColor: colors.primary } : null, { transform: [{ scale }] }]}>
    <Pressable
      focusable
      hasTVPreferredFocus={Platform.isTV && preferredFocus}
      onFocus={() => animateFocus(true)}
      onBlur={() => animateFocus(false)}
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.82 : 1 }]}
    >
      <LinearGradient
        colors={[`${accent}1A`, "rgba(255,255,255,0.055)", "rgba(255,255,255,0.014)"]}
        locations={[0, 0.42, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          s.statPremium,
          {
            borderColor: tvFocused ? colors.primary : "rgba(255,255,255,0.08)",
            borderWidth: tvFocused ? 2 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={[s.statMotif, { borderColor: accent }]} />
        <View style={s.statTopRow}>
          <View style={[s.statIconShell, { backgroundColor: `${accent}18` }]}><Feather name={icon} size={19} color={accent} /></View>
          <View style={[s.statAccent, { backgroundColor: accent }]} />
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[s.statValuePremium, { color: colors.foreground }]}>{value}</Text>
        <Text style={[s.statLabelPremium, { color: colors.mutedForeground }]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  </Animated.View>;
}

function HomeAccountTile({ item, active = false, add = false, disabled = false, onPress }: {
  item?: ProviderConfig;
  active?: boolean;
  add?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const tvFocused = Platform.isTV && focused;
  const animateFocus = (next: boolean) => {
    setFocused(next);
    if (!Platform.isTV) return;
    Animated.spring(scale, {
      toValue: next ? 1.05 : 1,
      damping: 18,
      stiffness: 210,
      mass: 0.45,
      useNativeDriver: true,
    }).start();
  };
  const icon = add ? "plus" : item?.type === "xtream" ? "radio" : item?.type === "m3u" ? "list" : "server";
  return <Animated.View style={[s.accountTileAnimationWrap, tvFocused ? s.homeTvGlow : null, tvFocused ? { shadowColor: colors.primary } : null, { transform: [{ scale }] }]}>
    <Pressable
      focusable={!disabled}
      disabled={disabled}
      onFocus={() => animateFocus(true)}
      onBlur={() => animateFocus(false)}
      onPress={onPress}
      style={({ pressed }) => [
        s.accountTilePremium,
        add ? s.addAccountTilePremium : null,
        {
          borderColor: tvFocused || active ? colors.primary : "rgba(255,255,255,0.08)",
          borderWidth: tvFocused ? 2 : StyleSheet.hairlineWidth,
          backgroundColor: colors.card,
          opacity: disabled ? 0.5 : pressed ? 0.78 : 1,
        },
        active ? s.accountTileActive : null,
      ]}
    >
      {add ? <>
        <View style={[s.accountAvatar, { backgroundColor: `${colors.primary}18` }]}><Feather name="plus" size={20} color={colors.primary} /></View>
        <Text style={[s.accountNamePremium, { color: colors.foreground }]}>{t("addAccount")}</Text>
        <Text style={[s.accountMetaPremium, { color: colors.mutedForeground }]}>{t("savedConnections")}</Text>
      </> : <>
        <View style={s.accountTileTop}>
          <View style={[s.accountAvatar, { backgroundColor: active ? `${colors.primary}22` : "rgba(255,255,255,0.05)" }]}>
            <Feather name={icon as React.ComponentProps<typeof Feather>["name"]} size={18} color={active || tvFocused ? colors.primary : colors.mutedForeground} />
          </View>
          {active ? <View style={[s.accountActivePill, { backgroundColor: `${colors.primary}1C` }]}><View style={[s.dot, { backgroundColor: colors.primary }]} /><Text style={{ color: colors.primary, fontSize: 11, fontWeight: "600" }}>{t("active")}</Text></View> : null}
        </View>
        <Text numberOfLines={1} style={[s.accountNamePremium, { color: colors.foreground }]}>{item?.name}</Text>
        <Text numberOfLines={1} style={[s.accountMetaPremium, { color: colors.mutedForeground }]}>{item?.username || item?.type.toUpperCase()}</Text>
      </>}
    </Pressable>
  </Animated.View>;
}
'''
home = home[:start] + stat_impl + home[end:]

# Add styles for motif / TV focus while preserving phone presentation.
home = home.replace(
    '  statPremiumPress: { flexGrow: 1, flexBasis: 156, minWidth: 150 },',
    '  statPremiumPress: { flexGrow: 1, flexBasis: 156, minWidth: 150, borderRadius: 24 },\n  homeTvGlow: { shadowOpacity: 0.48, shadowRadius: 18, shadowOffset: { width: 0, height: 0 }, elevation: 10 },',
    1,
)
home = home.replace(
    '  statTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 19 },',
    '  statMotif: { position: "absolute", width: 118, height: 118, borderRadius: 59, borderWidth: 1, opacity: 0.10, right: -34, top: -36 },\n  statTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 19 },',
    1,
)
home = home.replace(
    '  accountTilePremium: { minWidth: 165, flexGrow: 1, flexBasis: 190, minHeight: 124, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 15, justifyContent: "flex-end" },',
    '  accountTileAnimationWrap: { minWidth: 165, flexGrow: 1, flexBasis: 190, borderRadius: 22 },\n  accountTilePremium: { width: "100%", minHeight: 124, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 15, justifyContent: "flex-end" },',
    1,
)

home_path.write_text(home)
print('home stage 1 TV focus patch applied')
