import {
  getSavedPlayerCodecMode,
  setSavedPlayerCodecMode,
  type SavedPlayerCodecMode,
} from "@/lib/playerPreferences";
import { getManualEpgSnapshot } from "@/lib/manualEpgMode";
import React, { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Platform,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { usePlayer, type ProviderConfig } from "@/context/PlayerContext";
import { useMediaLibrary } from "@/context/MediaLibraryContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { useI18n } from "@/context/I18nContext";
import {
  DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS,
  getPlayerChromeTimeoutSeconds,
  setPlayerChromeTimeoutSeconds,
  type PlayerChromeTimeoutSeconds,
} from "@/lib/playerPreferences";
import { clearPlayerDiagnostics } from "@/lib/playerDiagnostics";
import { hasPlayerBackOwner } from "@/lib/playerRemoteOwnership";
import { useOptionalTVPreviewFocus } from "@/components/tvPreview/TVPreviewFocus";
import { EliteV4FocusButton, useEliteV4Focus } from "./EliteV4FocusSurface";
import { EliteV4AccountEditor } from "./EliteV4AccountEditor";
import { SettingsDialog, SettingsDialogButton } from "./EliteV4SettingsDialog";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

const categories = [
  ["accounts", "Hesaplar ve listeler"],
  ["player", "Oynatıcı"],
  ["content", "Katalog ve EPG"],
  ["language", "Dil ve görünüm"],
  ["storage", "Geçmiş ve bakım"],
] as const;
type Category = (typeof categories)[number][0];
type Row = {
  id: string;
  label: string;
  action: () => void;
  selected?: boolean;
  disabled?: boolean;
};
type Confirmation = {
  label: string;
  scope: string;
  owner: string;
  origin: string;
  action: () => Promise<unknown>;
};
export function EliteV4Settings({
  active,
  onBack,
  onLibrary,
}: {
  active: boolean;
  onBack: () => void;
  onLibrary: (route: "history" | "favorites") => void;
}) {
  const player = usePlayer(),
    library = useMediaLibrary(),
    catalog = useCatalogSync(),
    i18n = useI18n(),
    focus = useEliteV4Focus(),
    preview = useOptionalTVPreviewFocus();
  const viewport = useWindowDimensions(),
    wide = viewport.width >= 900;
  const [category, setCategory] = useState<Category>("accounts"),
    [seconds, setSeconds] = useState<PlayerChromeTimeoutSeconds>(
      DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS,
    ),
    [ready, setReady] = useState(false);
  const [codec, setCodec] = useState<SavedPlayerCodecMode>("auto");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [editor, setEditor] = useState<{
      existing: ProviderConfig | null;
      owner: string;
      origin: string;
    } | null>(null);
  const confirmationRef = useRef(confirmation),
    editorRef = useRef(editor);
  confirmationRef.current = confirmation;
  editorRef.current = editor;
  const lock = useRef(false),
    alive = useRef(true),
    panel = useRef<ScrollView>(null),
    offsets = useRef<Record<string, number>>({});
  const latest = useRef({ active, providerId: player.provider?.id, category });
  latest.current = { active, providerId: player.provider?.id, category };
  const modal = Boolean(confirmation || editor),
    modalRef = useRef(modal);
  modalRef.current = modal;
  const owner = player.provider?.id ?? "";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    void getSavedPlayerCodecMode().then((v) => {
      if (current) setCodec(v);
    });
    void getPlayerChromeTimeoutSeconds().then((v) => {
      if (current) {
        setSeconds(v);
        setReady(true);
      }
    });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    setConfirmation(null);
    setEditor(null);
    setError(null);
    setNotice(null);
  }, [owner]);
  const catId = (c: Category) => `v4-settings-category-${c}`;
  const rowId = (id: string) => `v4-settings-${id}`;
  const valid = (captured = owner) =>
    alive.current &&
    latest.current.active &&
    latest.current.providerId === captured;
  const closeModal = () => {
    const origin = confirmation?.origin ?? editor?.origin ?? catId(category);
    if (editor) player.cancelProviderConnect();
    setConfirmation(null);
    setEditor(null);
    modalRef.current = false;
    requestAnimationFrame(() => {
      if (alive.current && latest.current.active) focus.focus(origin);
    });
  };
  const back = () => {
    if (!active) return;
    if (modalRef.current) {
      closeModal();
      return;
    }
    if (focus.focusedId?.startsWith("v4-settings-category-")) {
      onBack();
      return;
    }
    focus.focus(catId(category));
  };
  useEffect(() => {
    if (!active || modal) return;
    return preview?.registerBackAction(back);
  }, [active, modal, category, focus.focusedId, preview?.registerBackAction]);
  useEffect(() => {
    if (!active || modal || !Platform.isTV) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (hasPlayerBackOwner()) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [active, modal, category, focus.focusedId]);
  const run = async (operation: () => Promise<unknown>, captured = owner) => {
    if (!valid(captured) || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await operation();
      if (result === false) throw new Error("SETTINGS_OPERATION_FAILED");
      if (valid(captured))
        setNotice("İstek tamamlandı. Güncel durum panelde gösterilir.");
    } catch {
      if (valid(captured))
        setError(
          "İşlem tamamlanamadı. Mevcut kayıtlarınızı kontrol edip yeniden deneyin.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const ask = (
    id: string,
    label: string,
    scope: string,
    action: () => Promise<unknown>,
  ) => {
    if (!valid() || lock.current || modalRef.current) return;
    modalRef.current = true;
    setConfirmation({ label, scope, action, owner, origin: rowId(id) });
  };
  const openEditor = (item: ProviderConfig | null, id: string) => {
    if (!valid() || lock.current || modalRef.current) return;
    // Use masked form fields with the existing connect contract; never render raw secure-store values.
    modalRef.current = true;
    setEditor({ existing: item, owner, origin: rowId(id) });
  };
  const guarded = (id: string, action: () => void) => () => {
    if (
      !valid() ||
      lock.current ||
      modalRef.current ||
      latest.current.category !== category
    )
      return;
    action();
  };
  let rows: Row[] = [];
  let description = "";
  const row = (
    id: string,
    label: string,
    operation: () => Promise<unknown>,
    disabled = false,
  ) => ({ id, label, disabled, action: () => void run(operation) });
  if (category === "accounts") {
    description =
      "Kayıtlı hesaplar; parolalar ve bağlantı token’ları burada gösterilmez.";
    rows = [
      { id: "add", label: "Hesap ekle", action: () => openEditor(null, "add") },
      ...player.providers.flatMap((p) => [
        {
          id: `account-${p.id}`,
          label: `${p.name} · ${p.type.toUpperCase()} · ${p.id === owner ? "Aktif" : p.needsCredentials ? "Bilgi gerekli" : p.loadError ? "Son bağlantı hatalı" : "Kayıtlı"}`,
          selected: p.id === owner,
          action: () => {
            if (p.needsCredentials) openEditor(p, `account-${p.id}`);
            else void run(() => player.setActiveProvider(p.id));
          },
        },
        {
          id: `edit-${p.id}`,
          label: `${p.name} — Düzenle`,
          action: () => openEditor(p, `edit-${p.id}`),
        },
        {
          id: `remove-${p.id}`,
          label: `${p.name} — Hesabı sil…`,
          action: () =>
            ask(
              `remove-${p.id}`,
              "Hesap silinsin mi?",
              `Yalnız “${p.name}” hesabı kaldırılır. Bu hesaba ait medya favorileri mevcut veri politikasına göre kaldırılır. Diğer hesaplara dokunulmaz.`,
              () => player.removeProvider(p.id),
            ),
        },
      ]),
      row(
        "playlist-refresh",
        "Aktif playlist / canlı veriyi yenile",
        () => player.refreshProvider(owner),
        player.isLoading,
      ),
    ];
  } else if (category === "player") {
    description =
      "Bu süre Player tarafından açılışta okunur. Ses, altyazı ve ekran oranı oynatma sırasında mevcut Player panelinden seçilir. Çözme tercihi mevcut VLC anahtarıyla saklanır ve sonraki Player açılışında uygulanır.";
    rows = ([3, 5, 10] as const).map((v) => ({
      ...row(
        `timeout-${v}`,
        `Kontroller: ${v} saniye`,
        async () => {
          await setPlayerChromeTimeoutSeconds(v);
          if (valid()) setSeconds(v);
        },
        !ready,
      ),
      selected: seconds === v,
    }));
    rows.push(
      ...(["auto", "hardware", "software"] as const).map((mode) => ({
        ...row(
          `codec-${mode}`,
          `Çözme: ${mode === "auto" ? "Otomatik" : mode === "hardware" ? "Donanım" : "Yazılım"}`,
          async () => {
            await setSavedPlayerCodecMode(mode);
            if (valid()) setCodec(mode);
          },
          !ready,
        ),
        selected: codec === mode,
      })),
    );
  } else if (category === "content") {
    description = `Katalog durumu: ${catalog.isSyncing || catalog.isRefreshing ? "Yenileniyor" : (catalog.syncState?.phase ?? "Beklemede")}. Son başarılı güncelleme: ${catalog.lastSuccessfulAt ? new Date(catalog.lastSuccessfulAt).toLocaleString() : "Henüz yok"}. TMDB metadata tr-TR kullanır. EPG zaman kayması ve global sıralama tercihi desteklenmez; sıralama katalog ekranındadır.`;
    const policy = catalog.refreshPolicy;
    rows = [
      {
        ...row(
          "auto",
          `Otomatik katalog yenileme: ${policy.automaticRefreshEnabled ? "Açık" : "Kapalı"}`,
          () =>
            catalog.setRefreshPolicy({
              ...policy,
              automaticRefreshEnabled: !policy.automaticRefreshEnabled,
            }),
          !catalog.refreshPolicyReady,
        ),
        selected: policy.automaticRefreshEnabled,
      },
      ...([24, 72] as const).map((hours) => ({
        ...row(
          `interval-${hours}`,
          `Yenileme aralığı: ${hours} saat`,
          () =>
            catalog.setRefreshPolicy({
              ...policy,
              refreshIntervalHours: hours,
            }),
          !catalog.refreshPolicyReady,
        ),
        selected: policy.refreshIntervalHours === hours,
      })),
      row(
        "catalog-refresh",
        "Kataloğu şimdi yenile",
        () => catalog.refreshCatalog(),
        catalog.isSyncing || catalog.isRefreshing || player.isLoading,
      ),
      row(
        "epg-refresh",
        "Aktif hesabın EPG verisini yenile",
        async () => {
          await player.loadEpgManually(owner);
          const result = getManualEpgSnapshot();
          if (result.providerId !== owner || result.manualResult !== "success")
            throw new Error("EPG_NOT_SUCCESS");
        },
        player.isEpgLoading || player.isLoading,
      ),
    ];
    if (player.provider?.type === "stalker")
      description +=
        " Stalker yenilemesi mevcut Live kapsamıyla sınırlıdır; portal desteği belirleyicidir.";
  } else if (category === "language") {
    description =
      "Uygulamanın mevcut dil altyapısı kullanılır. V4'te henüz çevrilmemiş metinler Türkçe kalabilir. Elite V4 görünümü sabittir; bağımsız tema anahtarı yoktur.";
    rows = i18n.languages.map((item) => ({
      ...row(`language-${item.code}`, item.label, () =>
        i18n.setLanguage(item.code, { verified: true }),
      ),
      selected: i18n.language === item.code,
    }));
  } else {
    description =
      "Temizleme yalnız aktif hesabı etkiler. Uygulama verilerini veya bütün hesapları sıfırlama seçeneği yoktur. Genel katalog/TMDB önbelleği temizleme sözleşmesi bulunmadığı için bu işlem sunulmaz.";
    rows = [
      {
        id: "history",
        label: "İzleme geçmişini yönet",
        action: () => onLibrary("history"),
      },
      {
        id: "favorites",
        label: "Favorileri yönet",
        action: () => onLibrary("favorites"),
      },
      {
        id: "clear-live",
        label: "Son izlenen kanalları temizle…",
        action: () =>
          ask(
            "clear-live",
            "Canlı geçmiş temizlensin mi?",
            "Yalnız aktif hesabın son izlenen kanalları silinir. Medya ilerlemesi ve favoriler korunur.",
            () => player.clearHistory(),
          ),
      },
      {
        id: "clear-media",
        label: "Medya geçmişi ve Devam Et kayıtlarını temizle…",
        action: () =>
          ask(
            "clear-media",
            "Medya kayıtları temizlensin mi?",
            "Yalnız aktif hesabın film/bölüm geçmişi ve resume konumları silinir. Favoriler ve diğer hesaplar korunur.",
            () => library.clearProgress(),
          ),
      },
      {
        id: "diagnostics",
        label: "Player tanılama kaydını temizle…",
        action: () =>
          ask(
            "diagnostics",
            "Tanılama kaydı temizlensin mi?",
            "Cihazdaki Player tanılama günlüğü temizlenir. Hesap, geçmiş ve favoriler değişmez.",
            () => clearPlayerDiagnostics(),
          ),
      },
    ];
  }
  const unavailable =
    player.isLoading || catalog.isSyncing || catalog.isRefreshing;
  return (
    <View style={{ flex: 1, minHeight: 0, padding: wide ? 18 : 10, gap: 10 }}>
      <Text
        style={{
          color: theme.color.foreground,
          fontSize: 20,
          fontWeight: "700",
        }}
      >
        Ayarlar
      </Text>
      <View
        style={{
          flex: 1,
          minHeight: 0,
          flexDirection: wide ? "row" : "column",
          gap: 12,
        }}
      >
        <ScrollView
          horizontal={!wide}
          style={wide ? { width: 210, flexGrow: 0 } : { flexGrow: 0 }}
          contentContainerStyle={{ gap: 6, padding: 2 }}
          showsHorizontalScrollIndicator={false}
        >
          {categories.map(([key, label], index) => (
            <EliteV4FocusButton
              key={key}
              focusId={catId(key)}
              region="content"
              selected={key === category}
              disabled={!active || modal}
              neighbors={{
                left: wide
                  ? "sidebar-settings"
                  : catId(categories[Math.max(0, index - 1)][0]),
                right: wide
                  ? rowId(rows[0]?.id ?? "")
                  : catId(
                      categories[Math.min(categories.length - 1, index + 1)][0],
                    ),
                up: wide
                  ? catId(categories[Math.max(0, index - 1)][0])
                  : "sidebar-settings",
                down: wide
                  ? catId(
                      categories[Math.min(categories.length - 1, index + 1)][0],
                    )
                  : rowId(rows[0]?.id ?? ""),
              }}
              onPress={() => {
                if (lock.current || modalRef.current || !active) return;
                setCategory(key);
                setError(null);
                setNotice(null);
                panel.current?.scrollTo({ y: 0 });
              }}
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: 8,
                backgroundColor: theme.color.surface,
              }}
            >
              <Text style={{ color: theme.color.foreground, fontSize: 13 }}>
                {label}
              </Text>
            </EliteV4FocusButton>
          ))}
        </ScrollView>
        <ScrollView
          ref={panel}
          style={{ flex: 1, minHeight: 0 }}
          contentContainerStyle={{ gap: 8, padding: 2, paddingBottom: 30 }}
        >
          <Text
            style={{ color: theme.color.muted, fontSize: 12, lineHeight: 18 }}
          >
            {description}
          </Text>
          {busy ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: theme.color.accent }}
            >
              İşlem sürüyor…
            </Text>
          ) : null}
          {error ||
          player.error ||
          library.storageError ||
          player.scopedError?.providerId === owner ? (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.color.danger }}
            >
              {error ||
                library.storageError ||
                "Kaynak/veri işlemi başarısız. Kayıtlarınızı kontrol ederek yeniden deneyin."}
            </Text>
          ) : null}
          {notice ? (
            <Text style={{ color: theme.color.muted }}>{notice}</Text>
          ) : null}
          {rows.map((item, index) => (
            <EliteV4FocusButton
              key={item.id}
              focusId={rowId(item.id)}
              region="content"
              selected={item.selected}
              disabled={
                !active ||
                modal ||
                item.disabled ||
                (!busy && unavailable && category === "accounts")
              }
              accessibilityLabel={item.label}
              neighbors={{
                left: catId(category),
                up: index ? rowId(rows[index - 1].id) : catId(category),
                down:
                  index < rows.length - 1
                    ? rowId(rows[index + 1].id)
                    : catId(category),
              }}
              onLayout={(e) => {
                offsets.current[item.id] = e.nativeEvent.layout.y;
              }}
              onFocused={() =>
                panel.current?.scrollTo({
                  y: Math.max(0, (offsets.current[item.id] ?? 0) - 12),
                  animated: true,
                })
              }
              onPress={guarded(item.id, item.action)}
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: 8,
                backgroundColor: theme.color.surface,
              }}
            >
              <Text
                numberOfLines={2}
                style={{ color: theme.color.foreground, fontSize: 14 }}
              >
                {item.label}
              </Text>
            </EliteV4FocusButton>
          ))}
        </ScrollView>
      </View>
      {confirmation ? (
        <SettingsDialog
          title={confirmation.label}
          onClose={() => {
            if (confirmationRef.current === confirmation) closeModal();
          }}
        >
          <Text style={{ color: theme.color.muted }}>{confirmation.scope}</Text>
          <SettingsDialogButton
            id="confirm"
            label={busy ? "İşlem sürüyor…" : "Onayla"}
            onPress={() => {
              const selected = confirmation;
              if (
                confirmationRef.current !== selected ||
                !valid(selected.owner) ||
                lock.current ||
                !modalRef.current
              )
                return;
              void run(async () => {
                await selected.action();
                if (
                  valid(selected.owner) &&
                  confirmationRef.current === selected
                ) {
                  setConfirmation(null);
                  modalRef.current = false;
                  requestAnimationFrame(() => {
                    if (valid(selected.owner)) focus.focus(selected.origin);
                  });
                }
              }, selected.owner);
            }}
          />
        </SettingsDialog>
      ) : null}
      {editor ? (
        <EliteV4AccountEditor
          key={editor.existing?.id ?? "new"}
          existing={editor.existing}
          onClose={() => {
            if (editorRef.current === editor) closeModal();
          }}
          onSubmit={async (value) => {
            const selected = editor;
            if (
              editorRef.current !== selected ||
              !valid(selected.owner) ||
              !modalRef.current
            )
              throw new Error("SETTINGS_STALE");
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            try {
              const ok = await player.connectProvider(value);
              if (!ok) throw new Error("CONNECT_FAILED");
              if (alive.current) {
                setEditor(null);
                modalRef.current = false;
                requestAnimationFrame(() => {
                  if (alive.current && latest.current.active)
                    focus.focus(catId("accounts"));
                });
              }
            } finally {
              lock.current = false;
              if (alive.current) setBusy(false);
            }
          }}
        />
      ) : null}
    </View>
  );
}
