import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Image,
  ImageBackground,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusButton } from "@/components/FocusButton";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import {
  Channel,
  ProviderConfig,
  ProviderType,
  usePlayer,
} from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";

type ViewName = "home" | "live" | "library" | "settings" | "player";

const navItems: Array<{
  key: Exclude<ViewName, "player">;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}> = [
  { key: "home", label: "Home", icon: "home" },
  { key: "live", label: "Live TV", icon: "radio" },
  { key: "library", label: "Library", icon: "bookmark" },
];

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const {
    provider,
    providers,
    channels,
    epg,
    favorites,
    history,
    isHydrating,
    isLoading,
    error,
    refreshProvider,
    refreshEpg,
    toggleFavorite,
    recordWatched,
    setActiveProvider,
    removeProvider,
    clearError,
  } = usePlayer();
  const [view, setView] = useState<ViewName>("home");
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [editingProvider, setEditingProvider] = useState(false);

  if (isHydrating) return <LoadingScreen />;

  if (!provider || editingProvider) {
    return (
      <ProviderSetup
        existingProvider={editingProvider ? provider : null}
        onComplete={() => {
          setEditingProvider(false);
          setView("home");
        }}
        onCancel={provider ? () => setEditingProvider(false) : undefined}
      />
    );
  }

  const openChannel = (channel: Channel) => {
    setSelectedChannel(channel);
    setView("player");
    void recordWatched(channel.id);
  };
  const historyChannels = history
    .map((id) => channels.find((channel) => channel.id === id))
    .filter((channel): channel is Channel => Boolean(channel));
  const topInset = Math.max(insets.top, Platform.OS === "web" ? 67 : 0);
  const bottomInset = Math.max(insets.bottom, Platform.OS === "web" ? 34 : 0);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ImageBackground
        source={require("../../assets/images/backdrop.png")}
        style={StyleSheet.absoluteFill}
        imageStyle={styles.backdrop}
      >
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.background, opacity: 0.78 },
          ]}
        />
      </ImageBackground>
      <View
        style={[
          styles.shell,
          { paddingTop: topInset + 16, paddingBottom: bottomInset + 16 },
        ]}
      >
        <Header
          activeView={view}
          provider={provider}
          providers={providers}
          compact={width < 800}
          onNavigate={setView}
          onProviderChange={(id) => void setActiveProvider(id)}
        />
        {error ? (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: colors.card, borderColor: colors.destructive },
            ]}
          >
            <Feather name="alert-circle" size={17} color={colors.destructive} />
            <Text style={[styles.errorBannerText, { color: colors.foreground }]}>
              {error}
            </Text>
            <Pressable onPress={clearError} accessibilityLabel="Dismiss error">
              <Feather name="x" size={19} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : null}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          scrollEnabled
        >
          {view === "home" ? (
            <HomeView
              provider={provider}
              channels={channels}
              epgCount={epg.length}
              favoriteCount={favorites.length}
              historyChannels={historyChannels}
              compact={width < 800}
              isLoading={isLoading}
              onOpenLive={() => setView("live")}
              onOpenChannel={openChannel}
              onRefresh={() => void refreshProvider()}
              onRefreshEpg={() => void refreshEpg()}
            />
          ) : null}
          {view === "live" ? (
            <LiveView
              channels={channels.filter(
                (channel) => channel.providerId === provider.id,
              )}
              epg={epg}
              favorites={favorites}
              isLoading={isLoading}
              onOpenChannel={openChannel}
              onToggleFavorite={(id) => void toggleFavorite(id)}
              onRefresh={() => void refreshProvider()}
              onRefreshEpg={() => void refreshEpg()}
            />
          ) : null}
          {view === "library" ? (
            <LibraryView
              channels={channels}
              favorites={favorites}
              historyChannels={historyChannels}
              onOpenChannel={openChannel}
              onToggleFavorite={(id) => void toggleFavorite(id)}
            />
          ) : null}
          {view === "settings" ? (
            <SettingsView
              provider={provider}
              providers={providers}
              onEdit={() => setEditingProvider(true)}
              onProviderChange={(id) => void setActiveProvider(id)}
              onRemove={() => void removeProvider()}
            />
          ) : null}
          {view === "player" ? (
            <PlayerView
              channel={selectedChannel}
              historyChannels={historyChannels}
              onBack={() => setView("live")}
              onOpenChannel={openChannel}
            />
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function LoadingScreen() {
  const colors = useColors();
  return (
    <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
      <Image source={require("../../assets/images/icon.png")} style={styles.loadingIcon} />
      <View style={[styles.skeleton, { backgroundColor: colors.muted }]} />
      <View style={[styles.skeletonShort, { backgroundColor: colors.muted }]} />
      <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
        Preparing your player
      </Text>
    </View>
  );
}

function ProviderSetup({
  existingProvider,
  onComplete,
  onCancel,
}: {
  existingProvider: ProviderConfig | null;
  onComplete: () => void;
  onCancel?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { connectProvider, isSaving, error, clearError } = usePlayer();
  const [name, setName] = useState(existingProvider?.name ?? "");
  const [url, setUrl] = useState(existingProvider?.playlistUrl ?? "");
  const [type, setType] = useState<ProviderType>(existingProvider?.type ?? "m3u");
  const [username, setUsername] = useState(existingProvider?.username ?? "");
  const [password, setPassword] = useState(existingProvider?.password ?? "");
  const [mac, setMac] = useState(existingProvider?.mac ?? "");
  const [epgUrl, setEpgUrl] = useState(existingProvider?.epgUrl ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const isWide = width >= 800;
  const topInset = Math.max(insets.top, Platform.OS === "web" ? 67 : 0);
  const bottomInset = Math.max(insets.bottom, Platform.OS === "web" ? 34 : 0);

  const submit = async () => {
    clearError();
    const trimmedUrl = url.trim();
    if (!trimmedUrl || !/^https?:\/\//i.test(trimmedUrl)) {
      setValidationError("Enter a full provider URL beginning with https://");
      return;
    }
    if (type === "xtream" && (!username.trim() || !password.trim())) {
      setValidationError("Add the username and password supplied by your provider.");
      return;
    }
    if (type === "stalker" && !mac.trim()) {
      setValidationError("Add the MAG MAC address supplied by your provider.");
      return;
    }
    setValidationError(null);
    const saved = await connectProvider({
      name: name.trim() || "My provider",
      type,
      playlistUrl: trimmedUrl,
      url: trimmedUrl,
      username: type === "xtream" ? username.trim() : undefined,
      password: type === "xtream" ? password : undefined,
      mac: type === "stalker" ? mac.trim() : undefined,
      epgUrl: epgUrl.trim() || undefined,
    });
    if (saved) onComplete();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ImageBackground
        source={require("../../assets/images/backdrop.png")}
        style={StyleSheet.absoluteFill}
        imageStyle={styles.backdrop}
      >
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.background, opacity: 0.68 },
          ]}
        />
      </ImageBackground>
      <ScrollView
        contentContainerStyle={[
          styles.setupScroll,
          isWide && styles.setupScrollWide,
          { paddingTop: topInset + 26, paddingBottom: bottomInset + 26 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.setupBrand, isWide && styles.setupBrandWide]}>
          <Image source={require("../../assets/images/icon.png")} style={styles.brandIcon} />
          <View>
            <Text style={[styles.wordmark, { color: colors.foreground }]}>
              LEGEND<Text style={{ color: colors.primary }}>STREAM</Text>
            </Text>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              XPLAYER / ANDROID TV
            </Text>
          </View>
        </View>
        <View style={[styles.setupGrid, isWide && styles.setupGridWide]}>
          <View style={styles.setupIntro}>
            <Text style={[styles.kicker, { color: colors.primary }]}>
              YOUR SIGNAL. YOUR SCREEN.
            </Text>
            <Text style={[styles.setupTitle, { color: colors.foreground }]}>
              Bring your own{"\n"}world to the big screen.
            </Text>
            <Text style={[styles.setupBody, { color: colors.mutedForeground }]}>
              LegendStream XPlayer is a focused player for streams you already
              have. Add a provider, then browse and play your own legal sources.
            </Text>
            <View style={styles.promiseList}>
              <Promise icon="link-2" text="Your source stays yours" />
              <Promise icon="sliders" text="Built for D-pad and touch" />
              <Promise icon="shield" text="No channels included" />
            </View>
          </View>
          <View
            style={[
              styles.formCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.formHeading}>
              <View>
                <Text style={[styles.cardOverline, { color: colors.primary }]}>
                  {existingProvider ? "EDIT SOURCE" : "FIRST, ADD A SOURCE"}
                </Text>
                <Text style={[styles.formTitle, { color: colors.foreground }]}>
                  Connect your provider
                </Text>
              </View>
              <View style={[styles.stepBadge, { backgroundColor: colors.muted }]}>
                <Text style={[styles.stepText, { color: colors.mutedForeground }]}>
                  01 / 01
                </Text>
              </View>
            </View>
            <Field
              label="Source name"
              value={name}
              onChangeText={setName}
              placeholder="Living room"
              colors={colors}
            />
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              Provider format
            </Text>
            <View style={styles.typeRow}>
              <TypeChoice
                selected={type === "m3u"}
                label="M3U playlist"
                caption="A playlist URL"
                icon="list"
                onPress={() => setType("m3u")}
              />
              <TypeChoice
                selected={type === "xtream"}
                label="Xtream login"
                caption="Server credentials"
                icon="key"
                onPress={() => setType("xtream")}
              />
              <TypeChoice
                selected={type === "stalker"}
                label="Stalker portal"
                caption="MAG portal + MAC"
                icon="radio"
                onPress={() => setType("stalker")}
              />
            </View>
            <Field
              label={type === "m3u" ? "Playlist URL" : "Server / portal URL"}
              value={url}
              onChangeText={setUrl}
              placeholder="https://provider.example/playlist.m3u"
              colors={colors}
              autoCapitalize="none"
              keyboardType="url"
            />
            {type === "xtream" ? (
              <View style={styles.credentialsRow}>
                <Field
                  label="Username"
                  value={username}
                  onChangeText={setUsername}
                  placeholder="Username"
                  colors={colors}
                  containerStyle={styles.halfField}
                  autoCapitalize="none"
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  colors={colors}
                  containerStyle={styles.halfField}
                  secureTextEntry
                />
              </View>
            ) : null}
            {type === "stalker" ? (
              <Field
                label="MAG MAC address"
                value={mac}
                onChangeText={setMac}
                placeholder="00:1A:79:00:00:01"
                colors={colors}
                autoCapitalize="none"
              />
            ) : null}
            <Field
              label="XMLTV / EPG URL (optional)"
              value={epgUrl}
              onChangeText={setEpgUrl}
              placeholder="https://provider.example/guide.xml"
              colors={colors}
              autoCapitalize="none"
              keyboardType="url"
            />
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              Credentials stay on this device. LegendStream never supplies,
              hosts, or recommends IPTV content.
            </Text>
            {validationError || error ? (
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: colors.muted,
                    borderColor: colors.destructive,
                  },
                ]}
              >
                <Feather name="alert-circle" size={17} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>
                  {validationError ?? error}
                </Text>
              </View>
            ) : null}
            <FocusButton
              label={isSaving ? "Loading provider…" : "Load provider"}
              icon={isSaving ? "clock" : "arrow-right"}
              variant="primary"
              onPress={() => void submit()}
              disabled={isSaving}
              style={styles.submitButton}
            />
            {onCancel ? (
              <FocusButton
                label="Cancel"
                variant="ghost"
                onPress={onCancel}
                style={styles.cancelButton}
              />
            ) : null}
          </View>
        </View>
        <Text style={[styles.legal, { color: colors.mutedForeground }]}>
          Only connect sources you own or are authorized to access. No channels,
          copyrighted streams, or playlists are bundled with this player.
        </Text>
      </ScrollView>
    </View>
  );
}

function Header({
  activeView,
  provider,
  providers,
  compact,
  onNavigate,
  onProviderChange,
}: {
  activeView: ViewName;
  provider: ProviderConfig;
  providers: ProviderConfig[];
  compact: boolean;
  onNavigate: (view: ViewName) => void;
  onProviderChange: (id: string) => void;
}) {
  const colors = useColors();
  const navigation = (
    <>
      {navItems.map((item) => (
        <FocusButton
          key={item.key}
          label={item.label}
          icon={item.icon}
          variant={activeView === item.key ? "secondary" : "ghost"}
          onPress={() => onNavigate(item.key)}
          style={styles.navButton}
        />
      ))}
      <FocusButton
        label="Settings"
        icon="settings"
        variant={activeView === "settings" ? "secondary" : "ghost"}
        onPress={() => onNavigate("settings")}
        style={styles.navButton}
      />
    </>
  );
  const providerChip = (
    <View style={[styles.connectedChip, { backgroundColor: colors.muted }]}>
      <View style={[styles.statusDot, { backgroundColor: colors.primary }]} />
      <Text
        style={[styles.connectedText, { color: colors.mutedForeground }]}
        numberOfLines={1}
      >
        {providers.length > 1 ? `${providers.length} sources` : provider.name}
      </Text>
      {providers.length > 1 ? (
        <Pressable
          onPress={() =>
            onProviderChange(
              providers[
                (providers.findIndex((item) => item.id === provider.id) + 1) %
                  providers.length
              ].id,
            )
          }
          accessibilityLabel="Switch provider"
        >
          <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
  if (compact) {
    return (
      <View style={[styles.header, styles.headerCompact]}>
        <View style={styles.headerTopCompact}>
          <Pressable
            onPress={() => onNavigate("home")}
            style={styles.headerBrand}
            accessibilityRole="button"
            accessibilityLabel="Go to home"
          >
            <Image source={require("../../assets/images/icon.png")} style={styles.headerIcon} />
            <Text style={[styles.headerWordmark, { color: colors.foreground }]}>
              LEGEND<Text style={{ color: colors.primary }}>STREAM</Text>
            </Text>
          </Pressable>
          {providerChip}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.navCompact}
        >
          {navigation}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => onNavigate("home")}
        style={styles.headerBrand}
        accessibilityRole="button"
        accessibilityLabel="Go to home"
      >
        <Image source={require("../../assets/images/icon.png")} style={styles.headerIcon} />
        <Text style={[styles.headerWordmark, { color: colors.foreground }]}>
          LEGEND<Text style={{ color: colors.primary }}>STREAM</Text>
        </Text>
      </Pressable>
      <View style={styles.nav}>{navigation}</View>
      {providerChip}
    </View>
  );
}

function HomeView({
  provider,
  channels,
  epgCount,
  favoriteCount,
  historyChannels,
  compact,
  isLoading,
  onOpenLive,
  onOpenChannel,
  onRefresh,
  onRefreshEpg,
}: {
  provider: ProviderConfig;
  channels: Channel[];
  epgCount: number;
  favoriteCount: number;
  historyChannels: Channel[];
  compact: boolean;
  isLoading: boolean;
  onOpenLive: () => void;
  onOpenChannel: (channel: Channel) => void;
  onRefresh: () => void;
  onRefreshEpg: () => void;
}) {
  const colors = useColors();
  return (
    <View>
      <View style={[styles.heroRow, compact && styles.heroRowCompact]}>
        <View style={styles.heroCopy}>
          <Text style={[styles.kicker, { color: colors.primary }]}>
            WELCOME BACK / {provider.name.toUpperCase()}
          </Text>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>
            Your screen is{"\n"}ready for a signal.
          </Text>
          <Text style={[styles.pageBody, { color: colors.mutedForeground }]}>
            Browse your own live sources, follow the guide, and keep your most
            watched channels close. Nothing is bundled here.
          </Text>
          <View style={styles.heroActions}>
            <FocusButton
              label="Browse live TV"
              icon="radio"
              variant="primary"
              onPress={onOpenLive}
            />
            <FocusButton
              label={isLoading ? "Refreshing…" : "Refresh source"}
              icon="refresh-cw"
              variant="ghost"
              onPress={onRefresh}
              disabled={isLoading}
            />
            <FocusButton
              label="Refresh EPG"
              icon="calendar"
              variant="ghost"
              onPress={onRefreshEpg}
              disabled={isLoading}
            />
          </View>
        </View>
        <View
          style={[
            styles.signalCard,
            compact && styles.signalCardCompact,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.signalIcon, { backgroundColor: colors.muted }]}>
            <MaterialCommunityIcons
              name="satellite-variant"
              size={29}
              color={colors.primary}
            />
          </View>
          <Text style={[styles.signalTitle, { color: colors.foreground }]}>
            SOURCE CONNECTED
          </Text>
          <Text style={[styles.signalBody, { color: colors.mutedForeground }]}>
            {channels.length
              ? `${channels.length.toLocaleString()} live channels loaded`
              : "Provider responded, but no live channels were found."}
          </Text>
          <View style={[styles.signalRule, { backgroundColor: colors.border }]} />
          <Text style={[styles.signalMeta, { color: colors.mutedForeground }]}>
            FORMAT / {provider.type.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={[styles.statsRow, compact && styles.statsRowCompact]}>
        <Stat label="Live channels" value={channels.length.toLocaleString()} icon="radio" />
        <Stat label="Guide programs" value={epgCount.toLocaleString()} icon="calendar" />
        <Stat label="Favorites" value={favoriteCount.toLocaleString()} icon="star" />
      </View>
      <SectionHeading
        eyebrow="CONTINUE WATCHING"
        title={historyChannels.length ? "Back to your recent channels" : "Your guide is waiting"}
        detail={
          historyChannels.length
            ? "Fast switching starts here."
            : "Load a provider to populate Live TV and the EPG."
        }
      />
      {historyChannels.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelRail}>
          {historyChannels.map((channel) => (
            <ChannelTile
              key={channel.id}
              channel={channel}
              onPress={() => onOpenChannel(channel)}
              compact
            />
          ))}
        </ScrollView>
      ) : (
        <View
          style={[
            styles.emptyPanel,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.emptyMark, { backgroundColor: colors.muted }]}>
            <Feather name="inbox" size={28} color={colors.primary} />
          </View>
          <View style={styles.emptyTextWrap}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No channel history yet
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Choose a channel from Live TV and LegendStream will remember your
              last twelve for fast switching.
            </Text>
          </View>
          <FocusButton
            label="Open live guide"
            icon="arrow-right"
            variant="secondary"
            onPress={onOpenLive}
          />
        </View>
      )}
    </View>
  );
}

function LiveView({
  channels,
  epg,
  favorites,
  isLoading,
  onOpenChannel,
  onToggleFavorite,
  onRefresh,
  onRefreshEpg,
}: {
  channels: Channel[];
  epg: Array<{ channelId: string; title: string; start: number; end: number }>;
  favorites: string[];
  isLoading: boolean;
  onOpenChannel: (channel: Channel) => void;
  onToggleFavorite: (id: string) => void;
  onRefresh: () => void;
  onRefreshEpg: () => void;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const compact = width < 800;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const categories = useMemo(
    () => ["All", ...Array.from(new Set(channels.map((channel) => channel.category))).sort()],
    [channels],
  );
  const filteredChannels = useMemo(() => {
    const query = search.trim().toLowerCase();
    return channels.filter((channel) => {
      const matchesCategory = category === "All" || channel.category === category;
      return (
        matchesCategory &&
        (!query ||
          channel.name.toLowerCase().includes(query) ||
          channel.category.toLowerCase().includes(query))
      );
    });
  }, [channels, search, category]);

  const getNow = (channelId: string) => {
    const now = Date.now();
    return epg.find(
      (program) =>
        program.channelId === channelId &&
        program.start <= now &&
        program.end > now,
    );
  };

  return (
    <View>
      <View style={styles.sectionHeading}>
        <Text style={[styles.kicker, { color: colors.primary }]}>LIVE TV</Text>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Your channels, at a glance
        </Text>
        <Text style={[styles.pageBody, { color: colors.mutedForeground }]}>
          Search thousands of channels quickly, switch categories with the
          remote, and open any stream with one press.
        </Text>
      </View>
      <View style={styles.toolbar}>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search channels"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoCapitalize="none"
            accessibilityLabel="Search channels"
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} accessibilityLabel="Clear search">
              <Feather name="x" size={17} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        <FocusButton
          label={isLoading ? "Loading…" : "Refresh"}
          icon="refresh-cw"
          variant="ghost"
          onPress={onRefresh}
          disabled={isLoading}
        />
        <FocusButton
          label="EPG"
          icon="calendar"
          variant="ghost"
          onPress={onRefreshEpg}
          disabled={isLoading}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRail}
      >
        {categories.map((item) => (
          <FocusButton
            key={item}
            label={item}
            variant={category === item ? "secondary" : "ghost"}
            onPress={() => setCategory(item)}
            style={styles.categoryButton}
          />
        ))}
      </ScrollView>
      {filteredChannels.length ? (
        <FlatList
          data={filteredChannels}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          numColumns={Platform.OS === "web" && !compact ? 3 : 1}
          columnWrapperStyle={
            Platform.OS === "web" && !compact ? styles.columnWrapper : undefined
          }
          renderItem={({ item }) => (
            <ChannelRow
              channel={item}
              program={getNow(item.id)?.title}
              favorite={favorites.includes(item.id)}
              onPress={() => onOpenChannel(item)}
              onToggleFavorite={() => onToggleFavorite(item.id)}
            />
          )}
          contentContainerStyle={styles.channelList}
        />
      ) : (
        <View
          style={[
            styles.emptyPanel,
            styles.liveEmpty,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.emptyMark, { backgroundColor: colors.muted }]}>
            <Feather name="radio" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {channels.length ? "No channels match" : "No live streams loaded"}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            {channels.length
              ? "Try another search or category."
              : "Connect a playlist with channels you are authorized to watch."}
          </Text>
        </View>
      )}
    </View>
  );
}

function LibraryView({
  channels,
  favorites,
  historyChannels,
  onOpenChannel,
  onToggleFavorite,
}: {
  channels: Channel[];
  favorites: string[];
  historyChannels: Channel[];
  onOpenChannel: (channel: Channel) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const colors = useColors();
  const favoriteChannels = favorites
    .map((id) => channels.find((channel) => channel.id === id))
    .filter((channel): channel is Channel => Boolean(channel));
  return (
    <View>
      <SectionHeading
        eyebrow="LIBRARY"
        title="Keep your signal close"
        detail="Favorites and recently watched channels stay on this device."
      />
      <Text style={[styles.subsectionTitle, { color: colors.foreground }]}>
        Favorites
      </Text>
      {favoriteChannels.length ? (
        <View style={styles.libraryList}>
          {favoriteChannels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              favorite
              onPress={() => onOpenChannel(channel)}
              onToggleFavorite={() => onToggleFavorite(channel.id)}
            />
          ))}
        </View>
      ) : (
        <EmptyMini icon="star" title="No favorites yet" detail="Star a channel from Live TV to pin it here." />
      )}
      <Text style={[styles.subsectionTitle, { color: colors.foreground }]}>
        Recently watched
      </Text>
      {historyChannels.length ? (
        <View style={styles.libraryList}>
          {historyChannels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              onPress={() => onOpenChannel(channel)}
              onToggleFavorite={() => onToggleFavorite(channel.id)}
              favorite={favorites.includes(channel.id)}
            />
          ))}
        </View>
      ) : (
        <EmptyMini icon="clock" title="Nothing watched yet" detail="Your last twelve channels will appear here." />
      )}
    </View>
  );
}

function SettingsView({
  provider,
  providers,
  onEdit,
  onProviderChange,
  onRemove,
}: {
  provider: ProviderConfig;
  providers: ProviderConfig[];
  onEdit: () => void;
  onProviderChange: (id: string) => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <View>
      <SectionHeading
        eyebrow="SETTINGS"
        title="Your player, your rules"
        detail="Manage the sources used by this device."
      />
      <View
        style={[
          styles.settingsCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.settingTop}>
          <View style={[styles.settingIcon, { backgroundColor: colors.muted }]}>
            <Feather name="link" size={23} color={colors.primary} />
          </View>
          <View style={styles.settingInfo}>
            <Text style={[styles.settingTitle, { color: colors.foreground }]}>
              {provider.name}
            </Text>
            <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
              {provider.type === "m3u"
                ? "M3U playlist"
                : provider.type === "xtream"
                  ? "Xtream Codes"
                  : "Stalker Portal"}{" "}
              · {provider.channelCount ?? 0} channels
            </Text>
          </View>
          <View style={[styles.activePill, { backgroundColor: colors.muted }]}>
            <View style={[styles.statusDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.activeText, { color: colors.primary }]}>ACTIVE</Text>
          </View>
        </View>
        <View style={[styles.urlBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Text style={[styles.urlLabel, { color: colors.mutedForeground }]}>
            SOURCE URL
          </Text>
          <Text style={[styles.urlText, { color: colors.foreground }]} numberOfLines={1}>
            {provider.playlistUrl}
          </Text>
        </View>
        <View style={styles.settingActions}>
          <FocusButton label="Edit provider" icon="edit-2" variant="secondary" onPress={onEdit} />
          <FocusButton label="Remove provider" icon="trash-2" variant="ghost" onPress={() => setConfirmRemove(true)} />
        </View>
        {providers.length > 1 ? (
          <View style={styles.providerSwitcher}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              Switch source
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>
              {providers.map((item) => (
                <FocusButton
                  key={item.id}
                  label={item.name}
                  variant={item.id === provider.id ? "secondary" : "ghost"}
                  onPress={() => onProviderChange(item.id)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
        {confirmRemove ? (
          <View
            style={[
              styles.confirmBox,
              { borderColor: colors.destructive, backgroundColor: colors.muted },
            ]}
          >
            <Text style={[styles.confirmTitle, { color: colors.foreground }]}>
              Remove this source from the device?
            </Text>
            <Text style={[styles.confirmBody, { color: colors.mutedForeground }]}>
              This only removes your saved connection. It does not cancel or
              change your provider account.
            </Text>
            <View style={styles.confirmActions}>
              <FocusButton label="Keep source" variant="ghost" onPress={() => setConfirmRemove(false)} />
              <FocusButton label="Remove" variant="secondary" onPress={onRemove} />
            </View>
          </View>
        ) : null}
      </View>
      <Text style={[styles.legal, { color: colors.mutedForeground }]}>
        LegendStream XPlayer is a playback interface only. It does not provide,
        host, or recommend channels.
      </Text>
    </View>
  );
}

function PlayerView({
  channel,
  historyChannels,
  onBack,
  onOpenChannel,
}: {
  channel: Channel | null;
  historyChannels: Channel[];
  onBack: () => void;
  onOpenChannel: (channel: Channel) => void;
}) {
  const colors = useColors();
  return (
    <View>
      <View style={styles.playerHeader}>
        <FocusButton label="Back to live" icon="arrow-left" variant="ghost" onPress={onBack} />
        <Text style={[styles.playerHeaderTitle, { color: colors.foreground }]}>
          PLAYER
        </Text>
        <View style={[styles.hdBadge, { borderColor: colors.border }]}>
          <Text style={[styles.hdText, { color: colors.mutedForeground }]}>
            HLS / DASH / TS
          </Text>
        </View>
      </View>
      <View style={[styles.playerSurface, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {channel ? (
          <NativeVideoPlayer source={channel.streamUrl} title={channel.name} />
        ) : (
          <View style={styles.playerWaiting}>
            <View style={[styles.playerCenter, { backgroundColor: colors.muted }]}>
              <Feather name="play" size={25} color={colors.primary} />
            </View>
            <Text style={[styles.waitingTitle, { color: colors.foreground }]}>
              Select a channel to start playback
            </Text>
            <Text style={[styles.waitingBody, { color: colors.mutedForeground }]}>
              The Android player uses the native hardware-backed video pipeline
              when available.
            </Text>
          </View>
        )}
      </View>
      {channel ? (
        <View style={styles.playerInfo}>
          <Text style={[styles.kicker, { color: colors.primary }]}>
            NOW PLAYING / {channel.category.toUpperCase()}
          </Text>
          <Text style={[styles.playerTitle, { color: colors.foreground }]}>
            {channel.name}
          </Text>
          <Text style={[styles.pageBody, { color: colors.mutedForeground }]}>
            Native controls expose full-screen and Picture-in-Picture. Audio
            tracks and subtitles are passed through when the source advertises
            them.
          </Text>
          <View style={[styles.diagnostics, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.diagnosticsTitle, { color: colors.foreground }]}>
              Playback diagnostics
            </Text>
            <Text style={[styles.diagnosticsLine, { color: colors.mutedForeground }]}>
              Source: {channel.streamType || "M3U"} · {Platform.OS === "android" ? "Android hardware pipeline" : "Preview mode"}
            </Text>
            <Text numberOfLines={1} style={[styles.diagnosticsLine, { color: colors.mutedForeground }]}>
              URL: {channel.streamUrl}
            </Text>
          </View>
        </View>
      ) : null}
      {historyChannels.length ? (
        <View style={styles.playerHistory}>
          <Text style={[styles.subsectionTitle, { color: colors.foreground }]}>
            Fast channel switching
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelRail}>
            {historyChannels.map((item) => (
              <ChannelTile key={item.id} channel={item} onPress={() => onOpenChannel(item)} compact />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function ChannelRow({
  channel,
  program,
  favorite = false,
  onPress,
  onToggleFavorite,
}: {
  channel: Channel;
  program?: string;
  favorite?: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.channelRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.channelMain, focused && { borderColor: colors.primary, backgroundColor: colors.muted }]}
        accessibilityRole="button"
        accessibilityLabel={`Play ${channel.name}`}
      >
        <ChannelLogo channel={channel} />
        <View style={styles.channelMeta}>
          <Text numberOfLines={1} style={[styles.channelName, { color: colors.foreground }]}>
            {channel.name}
          </Text>
          <Text numberOfLines={1} style={[styles.channelCategory, { color: colors.mutedForeground }]}>
            {program || channel.category}
          </Text>
        </View>
      </Pressable>
      <Pressable onPress={onToggleFavorite} style={styles.favoriteButton} accessibilityLabel={favorite ? "Remove favorite" : "Add favorite"}>
        <Feather name={favorite ? "star" : "star"} size={19} color={favorite ? colors.primary : colors.mutedForeground} />
      </Pressable>
      <Pressable onPress={onPress} style={styles.playButton} accessibilityLabel={`Play ${channel.name}`}>
        <Feather name="play" size={17} color={colors.primaryForeground} />
      </Pressable>
    </View>
  );
}

function ChannelTile({
  channel,
  onPress,
  compact = false,
}: {
  channel: Channel;
  onPress: () => void;
  compact?: boolean;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.channelTile,
        compact && styles.channelTileCompact,
        { backgroundColor: colors.card, borderColor: focused ? colors.primary : colors.border },
        focused && { transform: [{ scale: 1.03 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Play ${channel.name}`}
    >
      <ChannelLogo channel={channel} />
      <Text numberOfLines={1} style={[styles.channelName, { color: colors.foreground }]}>
        {channel.name}
      </Text>
      <Text numberOfLines={1} style={[styles.channelCategory, { color: colors.mutedForeground }]}>
        {channel.category}
      </Text>
    </Pressable>
  );
}

function ChannelLogo({ channel }: { channel: Channel }) {
  const colors = useColors();
  if (channel.logoUrl) {
    return <Image source={{ uri: channel.logoUrl }} style={styles.channelLogo} />;
  }
  return (
    <View style={[styles.channelLogo, styles.channelLogoFallback, { backgroundColor: colors.muted }]}>
      <Text style={[styles.channelLogoText, { color: colors.primary }]}>
        {channel.name.slice(0, 2).toUpperCase()}
      </Text>
    </View>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
}) {
  const colors = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name={icon} size={18} color={colors.primary} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function EmptyMini({
  icon,
  title,
  detail,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  detail: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.emptyMini, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.emptyMiniIcon, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={18} color={colors.primary} />
      </View>
      <View>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{detail}</Text>
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  colors,
  containerStyle,
  ...inputProps
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  colors: ReturnType<typeof useColors>;
  containerStyle?: object;
  autoCapitalize?: "none" | "sentences";
  keyboardType?: "url" | "default";
  secureTextEntry?: boolean;
}) {
  return (
    <View style={containerStyle}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        {...inputProps}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted, borderColor: colors.border }]}
        selectionColor={colors.primary}
      />
    </View>
  );
}

function Promise({
  icon,
  text,
}: {
  icon: keyof typeof Feather.glyphMap;
  text: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.promise}>
      <Feather name={icon} size={16} color={colors.primary} />
      <Text style={[styles.promiseText, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

function TypeChoice({
  selected,
  label,
  caption,
  icon,
  onPress,
}: {
  selected: boolean;
  label: string;
  caption: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.typeChoice,
        {
          borderColor: focused || selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.secondary : colors.muted,
        },
        focused && { transform: [{ scale: 1.02 }] },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Feather name={icon} size={18} color={selected ? colors.primary : colors.mutedForeground} />
      <View>
        <Text style={[styles.typeLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.typeCaption, { color: colors.mutedForeground }]}>{caption}</Text>
      </View>
    </Pressable>
  );
}

function SectionHeading({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeading}>
      <Text style={[styles.kicker, { color: colors.primary }]}>{eyebrow}</Text>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.pageBody, { color: colors.mutedForeground }]}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  backdrop: { resizeMode: "cover", opacity: 0.85 },
  shell: { flex: 1, paddingHorizontal: 22 },
  content: { paddingTop: 28, paddingBottom: 36 },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 20 },
  headerCompact: { minHeight: 0, alignItems: "stretch", gap: 10 },
  headerTopCompact: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 185 },
  headerIcon: { width: 35, height: 35, borderRadius: 10 },
  headerWordmark: { fontFamily: "Inter_700Bold", fontSize: 14, letterSpacing: 1.4 },
  nav: { flex: 1, flexDirection: "row", justifyContent: "center", gap: 4 },
  navCompact: { gap: 4, paddingRight: 8 },
  navButton: { minHeight: 43, paddingHorizontal: 12, borderColor: "transparent" },
  connectedChip: { maxWidth: 180, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 7 },
  connectedText: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 0.4, flexShrink: 1 },
  errorBanner: { borderWidth: 1, borderRadius: 12, padding: 11, flexDirection: "row", alignItems: "center", gap: 9, marginTop: 12 },
  errorBannerText: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17, flex: 1 },
  heroRow: { flexDirection: "row", justifyContent: "space-between", gap: 28, marginTop: 26, marginBottom: 32 },
  heroRowCompact: { flexDirection: "column", gap: 20, marginTop: 20, marginBottom: 26 },
  heroCopy: { flex: 1, maxWidth: 660, paddingTop: 20 },
  kicker: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 2.1 },
  pageTitle: { fontFamily: "Inter_700Bold", fontSize: 43, lineHeight: 49, letterSpacing: -1.3, marginTop: 11 },
  pageBody: { fontFamily: "Inter_400Regular", fontSize: 16, lineHeight: 25, maxWidth: 590, marginTop: 14 },
  heroActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 28 },
  signalCard: { width: 250, minHeight: 235, borderRadius: 18, borderWidth: 1, padding: 22, justifyContent: "center" },
  signalCardCompact: { width: "100%", minHeight: 175, padding: 18 },
  signalIcon: { width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 16, marginBottom: 18 },
  signalTitle: { fontFamily: "Inter_700Bold", fontSize: 12, letterSpacing: 1.5 },
  signalBody: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, marginTop: 8 },
  signalRule: { height: 1, width: "100%", marginVertical: 18 },
  signalMeta: { fontFamily: "Inter_600SemiBold", fontSize: 10, letterSpacing: 1.2 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 44 },
  statsRowCompact: { gap: 8, marginBottom: 32 },
  stat: { flex: 1, minHeight: 108, borderWidth: 1, borderRadius: 15, padding: 16 },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 27, marginTop: 11 },
  statLabel: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 3 },
  sectionHeading: { marginBottom: 17 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 25, marginTop: 8, letterSpacing: -0.4 },
  emptyPanel: { minHeight: 126, borderWidth: 1, borderRadius: 18, padding: 22, flexDirection: "row", alignItems: "center", gap: 17 },
  emptyMark: { width: 60, height: 60, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  emptyTextWrap: { flex: 1 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  emptyBody: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, marginTop: 5, maxWidth: 570 },
  liveEmpty: { flexDirection: "column", alignItems: "center", justifyContent: "center", paddingVertical: 62, textAlign: "center" },
  channelRail: { gap: 12, paddingBottom: 22 },
  channelTile: { width: 190, minHeight: 112, borderWidth: 1, borderRadius: 14, padding: 14 },
  channelTileCompact: { width: 166 },
  channelName: { fontFamily: "Inter_700Bold", fontSize: 14, marginTop: 10 },
  channelCategory: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 4 },
  channelLogo: { width: 38, height: 38, borderRadius: 10 },
  channelLogoFallback: { alignItems: "center", justifyContent: "center" },
  channelLogoText: { fontFamily: "Inter_700Bold", fontSize: 12, letterSpacing: 0.6 },
  setupScroll: { flexGrow: 1, paddingHorizontal: 24 },
  setupScrollWide: { paddingHorizontal: "8%" },
  setupBrand: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 29 },
  setupBrandWide: { marginBottom: 35 },
  brandIcon: { width: 51, height: 51, borderRadius: 15 },
  wordmark: { fontFamily: "Inter_700Bold", fontSize: 18, letterSpacing: 2.2 },
  eyebrow: { fontFamily: "Inter_600SemiBold", fontSize: 9, letterSpacing: 1.5, marginTop: 3 },
  setupGrid: { gap: 31 },
  setupGridWide: { flexDirection: "row", alignItems: "center", gap: 70 },
  setupIntro: { flex: 1, maxWidth: 610 },
  setupTitle: { fontFamily: "Inter_700Bold", fontSize: 39, lineHeight: 45, letterSpacing: -1.3, marginTop: 10 },
  setupBody: { fontFamily: "Inter_400Regular", fontSize: 16, lineHeight: 25, marginTop: 16, maxWidth: 545 },
  promiseList: { gap: 12, marginTop: 23 },
  promise: { flexDirection: "row", alignItems: "center", gap: 10 },
  promiseText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  formCard: { borderRadius: 20, borderWidth: 1, padding: 23, width: "100%", maxWidth: 560, alignSelf: "center" },
  formHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  cardOverline: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1.7 },
  formTitle: { fontFamily: "Inter_700Bold", fontSize: 23, marginTop: 7 },
  stepBadge: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8 },
  stepText: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 0.6, marginBottom: 7, marginTop: 12 },
  input: { minHeight: 49, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, fontFamily: "Inter_400Regular", fontSize: 14 },
  typeRow: { flexDirection: "row", gap: 8 },
  typeChoice: { flex: 1, minHeight: 61, borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  typeLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  typeCaption: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 2 },
  credentialsRow: { flexDirection: "row", gap: 9 },
  halfField: { flex: 1 },
  helper: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17, marginTop: 14 },
  errorBox: { borderWidth: 1, borderRadius: 10, padding: 11, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  errorText: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17, flex: 1 },
  submitButton: { marginTop: 19 },
  cancelButton: { marginTop: 8 },
  legal: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 25, alignSelf: "center", maxWidth: 780 },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingIcon: { width: 65, height: 65, borderRadius: 18, marginBottom: 25 },
  skeleton: { height: 11, width: 180, borderRadius: 6, opacity: 0.8 },
  skeletonShort: { height: 8, width: 108, borderRadius: 5, opacity: 0.55, marginTop: 10 },
  loadingText: { fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 19 },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 12 },
  searchBox: { flex: 1, minHeight: 50, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  searchInput: { flex: 1, minHeight: 48, fontFamily: "Inter_400Regular", fontSize: 14 },
  categoryRail: { gap: 8, paddingBottom: 17 },
  categoryButton: { minHeight: 42, paddingHorizontal: 14 },
  channelList: { gap: 10, paddingBottom: 30 },
  columnWrapper: { gap: 10 },
  channelRow: { flex: 1, minHeight: 78, maxWidth: 760, borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  channelMain: { flex: 1, minHeight: 76, borderWidth: 1, borderColor: "transparent", paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  channelMeta: { flex: 1 },
  favoriteButton: { minHeight: 76, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  playButton: { minHeight: 76, width: 56, alignItems: "center", justifyContent: "center", backgroundColor: "#19d8e8" },
  subsectionTitle: { fontFamily: "Inter_700Bold", fontSize: 19, marginTop: 22, marginBottom: 12 },
  libraryList: { gap: 10 },
  emptyMini: { minHeight: 76, borderWidth: 1, borderRadius: 14, padding: 13, flexDirection: "row", alignItems: "center", gap: 12 },
  emptyMiniIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  settingsCard: { borderRadius: 18, borderWidth: 1, padding: 20, maxWidth: 760 },
  settingTop: { flexDirection: "row", alignItems: "center" },
  settingIcon: { width: 51, height: 51, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  settingInfo: { flex: 1, marginLeft: 14 },
  settingTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  settingSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 5 },
  activePill: { borderRadius: 16, paddingHorizontal: 10, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  activeText: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 1 },
  urlBox: { padding: 13, borderWidth: 1, borderRadius: 10, marginTop: 21 },
  urlLabel: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 1.2 },
  urlText: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 7 },
  settingActions: { flexDirection: "row", gap: 9, marginTop: 18 },
  providerSwitcher: { marginTop: 12 },
  confirmBox: { borderWidth: 1, borderRadius: 11, padding: 14, marginTop: 17 },
  confirmTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  confirmBody: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, marginTop: 6 },
  confirmActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  playerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 17 },
  playerHeaderTitle: { fontFamily: "Inter_700Bold", fontSize: 13, letterSpacing: 1.4 },
  hdBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7 },
  hdText: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1 },
  playerSurface: { width: "100%", aspectRatio: 16 / 8.7, minHeight: 230, maxHeight: 520, borderRadius: 17, overflow: "hidden", borderWidth: 1 },
  playerWaiting: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  playerCenter: { width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center", marginBottom: 13 },
  waitingTitle: { fontFamily: "Inter_700Bold", fontSize: 19, textAlign: "center" },
  waitingBody: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 6, textAlign: "center", maxWidth: 450 },
  playerInfo: { paddingVertical: 27, maxWidth: 700 },
  playerTitle: { fontFamily: "Inter_700Bold", fontSize: 25, marginTop: 7 },
  diagnostics: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 18, gap: 6 },
  diagnosticsTitle: { fontFamily: "Inter_700Bold", fontSize: 13 },
  diagnosticsLine: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17 },
  playerHistory: { marginTop: 8 },
});