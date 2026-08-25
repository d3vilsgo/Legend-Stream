from pathlib import Path

path = Path("artifacts/legendstream-xplayer/components/OptimizedHomeScreenV6.tsx")
text = path.read_text()

# Lightweight gradient support already present in Expo runtime.
if 'import { LinearGradient } from "expo-linear-gradient";' not in text:
    text = text.replace(
        'import { Feather } from "@expo/vector-icons";\n',
        'import { Feather } from "@expo/vector-icons";\nimport { LinearGradient } from "expo-linear-gradient";\n',
        1,
    )

# Home-only premium header treatment. Other catalog/player views retain their existing header styling.
text = text.replace(
    '<View style={[s.header, { borderColor: colors.border }]}>\n      <View style={s.headerTop}>\n        <Text style={[s.brand, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>\n        <ProviderSubscriptionChip provider={shownProvider} />\n      </View>',
    '<View style={[s.header, { borderColor: colors.border }, view === "home" ? s.homeHeaderPremium : null]}>\n      <View style={[s.headerTop, view === "home" ? s.homeHeaderTopPremium : null]}>\n        <Text style={[s.brand, view === "home" ? s.homeBrandPremium : null, { color: colors.foreground }]}>LEGEND<Text style={{ color: colors.primary }}>STREAM</Text></Text>\n        <View style={view === "home" ? [s.homeProviderGlass, { borderColor: colors.border }] : undefined}>\n          <ProviderSubscriptionChip provider={shownProvider} />\n        </View>\n      </View>',
    1,
)

start = text.index('function Home(')
end = text.index('\nfunction useCategoryDrawerSwipe', start)
home = '''function Home({ provider, providers, live, vod, series, vodCategories, seriesCategories, loading, onRefresh, onNavigate, onSwitch, onAdd }: {
  provider: ProviderConfig; providers: ProviderConfig[]; live: number; vod: number | null; series: number | null; vodCategories: number; seriesCategories: number; loading: boolean;
  onRefresh: () => void; onNavigate: (view: ContentView) => void; onSwitch: (id: string) => void; onAdd: () => void;
}) {
  const colors = useColors(); const { t } = useI18n();
  const movieValue = vod === null
    ? (vodCategories > 0 ? t("categoryCount", { count: vodCategories.toLocaleString() }) : t("tapToLoad"))
    : vod.toLocaleString();
  const seriesValue = series === null
    ? (seriesCategories > 0 ? t("categoryCount", { count: seriesCategories.toLocaleString() }) : t("tapToLoad"))
    : series.toLocaleString();

  return <View style={s.homeShell}>
    <View style={s.homeHeroBlock}>
      <View style={s.homeEyebrowRow}>
        <View style={[s.homeLivePip, { backgroundColor: colors.primary }]} />
        <Text style={[s.homeKickerPremium, { color: colors.primary }]}>{t("activeConnection").toUpperCase()}</Text>
        <Text numberOfLines={1} style={[s.homeProviderName, { color: colors.mutedForeground }]}>/ {provider.name}</Text>
      </View>
      <Text style={[s.homeHeroPremium, { color: colors.foreground }]}>{t("liveTv")}, {t("movies").toLowerCase()} & {t("series").toLowerCase()}.</Text>
      <Text style={[s.homeHeroSub, { color: colors.mutedForeground }]}>{t("accountsRemembered")}</Text>
    </View>

    <View style={s.homeStatsPremium}>
      <Stat icon="radio" label={t("liveTv")} value={live.toLocaleString()} accent={colors.primary} onPress={() => onNavigate("live")} />
      <Stat icon="film" label={t("movies")} value={movieValue} accent="#49B9FF" onPress={() => onNavigate("movies")} />
      <Stat icon="tv" label={t("series")} value={seriesValue} accent="#8C8CFF" onPress={() => onNavigate("series")} />
      <Stat icon="download-cloud" label={t("download")} value="Offline" accent="#4ED6B7" onPress={() => onNavigate("downloads")} />
    </View>

    <View style={s.homeActionRow}>
      <FocusButton label={loading ? t("refreshingLive") : t("refreshLive")} icon="refresh-cw" variant="primary" onPress={onRefresh} disabled={loading} />
    </View>

    <View style={s.homeAccountsSection}>
      <View style={s.homeSectionHead}>
        <View style={{ flex: 1 }}>
          <Text style={[s.homeSectionTitle, { color: colors.foreground }]}>{t("savedConnections")}</Text>
          <Text style={[s.homeSectionSub, { color: colors.mutedForeground }]}>{t("accountsRemembered")}</Text>
        </View>
        <View style={[s.homeSectionRule, { backgroundColor: colors.primary }]} />
      </View>
      <View style={s.accountGridPremium}>
        {providers.map((item) => {
          const active = item.id === provider.id;
          return <Pressable
            key={item.id}
            disabled={loading}
            onPress={() => onSwitch(item.id)}
            style={({ pressed }) => [
              s.accountTilePremium,
              {
                borderColor: active ? colors.primary : "rgba(255,255,255,0.08)",
                backgroundColor: colors.card,
                opacity: pressed ? 0.78 : 1,
                transform: [{ scale: pressed ? 0.985 : 1 }],
              },
              active ? s.accountTileActive : null,
            ]}
          >
            <View style={s.accountTileTop}>
              <View style={[s.accountAvatar, { backgroundColor: active ? `${colors.primary}22` : "rgba(255,255,255,0.05)" }]}>
                <Feather name={item.type === "xtream" ? "radio" : item.type === "m3u" ? "list" : "server"} size={18} color={active ? colors.primary : colors.mutedForeground} />
              </View>
              {active ? <View style={[s.accountActivePill, { backgroundColor: `${colors.primary}1C` }]}><View style={[s.dot, { backgroundColor: colors.primary }]} /><Text style={{ color: colors.primary, fontSize: 11, fontWeight: "600" }}>{t("active")}</Text></View> : null}
            </View>
            <Text numberOfLines={1} style={[s.accountNamePremium, { color: colors.foreground }]}>{item.name}</Text>
            <Text numberOfLines={1} style={[s.accountMetaPremium, { color: colors.mutedForeground }]}>{item.username || item.type.toUpperCase()}</Text>
          </Pressable>;
        })}
        <Pressable
          onPress={onAdd}
          style={({ pressed }) => [
            s.accountTilePremium,
            s.addAccountTilePremium,
            { borderColor: "rgba(255,255,255,0.08)", backgroundColor: colors.card, opacity: pressed ? 0.76 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
          ]}
        >
          <View style={[s.accountAvatar, { backgroundColor: `${colors.primary}18` }]}><Feather name="plus" size={20} color={colors.primary} /></View>
          <Text style={[s.accountNamePremium, { color: colors.foreground }]}>{t("addAccount")}</Text>
          <Text style={[s.accountMetaPremium, { color: colors.mutedForeground }]}>{t("savedConnections")}</Text>
        </Pressable>
      </View>
    </View>
  </View>;
}
'''
text = text[:start] + home + text[end:]

start = text.index('function Stat(')
end = text.index('\nfunction Loading', start)
stat = '''function Stat({ icon, label, value, accent, onPress }: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  accent: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return <Pressable
    onPress={onPress}
    style={({ pressed }) => [s.statPremiumPress, { opacity: pressed ? 0.82 : 1, transform: [{ scale: pressed ? 0.982 : 1 }] }]}
  >
    <LinearGradient
      colors={["rgba(255,255,255,0.075)", "rgba(255,255,255,0.018)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[s.statPremium, { borderColor: "rgba(255,255,255,0.08)" }]}
    >
      <View style={s.statTopRow}>
        <View style={[s.statIconShell, { backgroundColor: `${accent}18` }]}><Feather name={icon} size={19} color={accent} /></View>
        <View style={[s.statAccent, { backgroundColor: accent }]} />
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[s.statValuePremium, { color: colors.foreground }]}>{value}</Text>
      <Text style={[s.statLabelPremium, { color: colors.mutedForeground }]}>{label}</Text>
    </LinearGradient>
  </Pressable>;
}
'''
text = text[:start] + stat + text[end:]

# Style substitutions are intentionally Home-specific; catalog/player styles remain untouched.
repls = {
'  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingBottom: 8 },': '  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingBottom: 8 },\n  homeHeaderPremium: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 },\n  homeHeaderTopPremium: { minHeight: 54 },\n  homeBrandPremium: { fontSize: 17, fontWeight: "700", letterSpacing: 2.1 },\n  homeProviderGlass: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.035)", paddingHorizontal: 2, paddingVertical: 1 },',
'  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 1.1, marginBottom: 8 },\n  hero: { fontSize: 38, lineHeight: 43, fontWeight: "900" },': '  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 1.1, marginBottom: 8 },\n  hero: { fontSize: 38, lineHeight: 43, fontWeight: "900" },\n  homeShell: { paddingTop: 8, paddingBottom: 18 },\n  homeHeroBlock: { paddingTop: 12, paddingBottom: 10, maxWidth: 900 },\n  homeEyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },\n  homeLivePip: { width: 6, height: 6, borderRadius: 6 },\n  homeKickerPremium: { fontSize: 11, fontWeight: "600", letterSpacing: 1.7 },\n  homeProviderName: { flexShrink: 1, fontSize: 12, fontWeight: "400" },\n  homeHeroPremium: { fontSize: 40, lineHeight: 46, fontWeight: "300", letterSpacing: -0.8 },\n  homeHeroSub: { fontSize: 14, lineHeight: 21, fontWeight: "400", marginTop: 10, maxWidth: 640 },',
'  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginVertical: 24 },\n  stat: { flexGrow: 1, minWidth: 145, borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },\n  statValue: { fontSize: 28, fontWeight: "900" },': '  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginVertical: 24 },\n  stat: { flexGrow: 1, minWidth: 145, borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },\n  statValue: { fontSize: 28, fontWeight: "900" },\n  homeStatsPremium: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 24, marginBottom: 20 },\n  statPremiumPress: { flexGrow: 1, flexBasis: 156, minWidth: 150 },\n  statPremium: { minHeight: 154, borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 17, overflow: "hidden" },\n  statTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 19 },\n  statIconShell: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center" },\n  statAccent: { width: 26, height: 2, borderRadius: 2, opacity: 0.75 },\n  statValuePremium: { fontSize: 29, lineHeight: 34, fontWeight: "300", letterSpacing: -0.5 },\n  statLabelPremium: { fontSize: 12, lineHeight: 18, fontWeight: "500", marginTop: 5 },\n  homeActionRow: { alignItems: "flex-start", marginTop: 2 },',
'  accountGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },\n  accountTile: { minWidth: 145, flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },': '  accountGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },\n  accountTile: { minWidth: 145, flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },\n  homeAccountsSection: { marginTop: 34 },\n  homeSectionHead: { flexDirection: "row", alignItems: "flex-end", gap: 14, marginBottom: 15 },\n  homeSectionTitle: { fontSize: 21, lineHeight: 27, fontWeight: "500", letterSpacing: -0.25 },\n  homeSectionSub: { fontSize: 12, lineHeight: 18, fontWeight: "400", marginTop: 3 },\n  homeSectionRule: { width: 34, height: 2, borderRadius: 2, opacity: 0.65, marginBottom: 5 },\n  accountGridPremium: { flexDirection: "row", flexWrap: "wrap", gap: 12 },\n  accountTilePremium: { minWidth: 165, flexGrow: 1, flexBasis: 190, minHeight: 124, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 15, justifyContent: "flex-end" },\n  accountTileActive: { shadowColor: "#00D4FF", shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },\n  accountTileTop: { position: "absolute", top: 14, left: 14, right: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },\n  accountAvatar: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center" },\n  accountActivePill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 6 },\n  accountNamePremium: { fontSize: 15, lineHeight: 20, fontWeight: "600", marginTop: 38 },\n  accountMetaPremium: { fontSize: 11, lineHeight: 16, fontWeight: "400", marginTop: 3 },\n  addAccountTilePremium: { justifyContent: "flex-start", gap: 2 },',
}
for old, new in repls.items():
    if old not in text:
        raise SystemExit(f"style anchor missing: {old[:80]}")
    text = text.replace(old, new, 1)

path.write_text(text)
