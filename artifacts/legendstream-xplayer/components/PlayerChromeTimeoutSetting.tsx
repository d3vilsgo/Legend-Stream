import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
import {
  clearPlayerDiagnostics,
  getPlayerDiagnostics,
  PlayerDiagnosticEntry,
} from "@/lib/playerDiagnostics";
import {
  DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS,
  getPlayerChromeTimeoutSeconds,
  PLAYER_CHROME_TIMEOUT_OPTIONS,
  PlayerChromeTimeoutSeconds,
  setPlayerChromeTimeoutSeconds,
} from "@/lib/playerPreferences";

const copy: Record<string, { title: string; description: string; suffix: string }> = {
  tr: {
    title: "Oynatıcı kontrol süresi",
    description: "Yayın bilgi kartı ve kumanda çubuğunun ekranda ne kadar kalacağını seçin.",
    suffix: "sn",
  },
  en: {
    title: "Player controls duration",
    description: "Choose how long the media info and control bars stay visible.",
    suffix: "sec",
  },
  de: {
    title: "Dauer der Player-Steuerung",
    description: "Legt fest, wie lange Medieninfo und Steuerleiste sichtbar bleiben.",
    suffix: "Sek.",
  },
  fr: {
    title: "Durée des commandes",
    description: "Choisissez combien de temps les informations et commandes restent visibles.",
    suffix: "s",
  },
  es: {
    title: "Duración de controles",
    description: "Elige cuánto tiempo permanecen visibles la información y los controles.",
    suffix: "s",
  },
  it: {
    title: "Durata controlli player",
    description: "Scegli per quanto tempo restano visibili informazioni e controlli.",
    suffix: "s",
  },
  ru: {
    title: "Время показа управления",
    description: "Выберите, как долго видны информация о видео и панель управления.",
    suffix: "с",
  },
};

const formatDetails = (entry: PlayerDiagnosticEntry) => {
  if (!entry.details) return "";
  return Object.entries(entry.details)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" · ");
};

export function PlayerChromeTimeoutSetting() {
  const colors = useColors();
  const { language } = useI18n();
  const labels = useMemo(() => copy[language] ?? copy.en, [language]);
  const tr = language === "tr";
  const [seconds, setSeconds] = useState<PlayerChromeTimeoutSeconds>(DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS);
  const [diagnostics, setDiagnostics] = useState<PlayerDiagnosticEntry[]>([]);

  const refreshDiagnostics = useCallback(() => {
    void getPlayerDiagnostics().then((entries) => setDiagnostics(entries.slice(-10).reverse()));
  }, []);

  useEffect(() => {
    let mounted = true;
    getPlayerChromeTimeoutSeconds().then((value) => {
      if (mounted) setSeconds(value);
    });
    getPlayerDiagnostics().then((entries) => {
      if (mounted) setDiagnostics(entries.slice(-10).reverse());
    });
    return () => { mounted = false; };
  }, []);

  const select = (value: PlayerChromeTimeoutSeconds) => {
    setSeconds(value);
    void setPlayerChromeTimeoutSeconds(value).catch(() => undefined);
  };

  const clearDiagnostics = () => {
    void clearPlayerDiagnostics()
      .then(() => setDiagnostics([]))
      .catch(() => undefined);
  };

  return (
    <>
      <View style={{ marginTop: 24 }}>
        <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "800" }}>{labels.title}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 6, marginBottom: 8, lineHeight: 19 }}>{labels.description}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
          {PLAYER_CHROME_TIMEOUT_OPTIONS.map((value) => (
            <FocusButton
              key={value}
              label={`${value} ${labels.suffix}`}
              variant={seconds === value ? "secondary" : "ghost"}
              onPress={() => select(value)}
            />
          ))}
        </ScrollView>
      </View>

      <View style={{ marginTop: 24 }}>
        <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "800" }}>
          {tr ? "Son oynatıcı tanılama kaydı" : "Recent player diagnostics"}
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 6, lineHeight: 19 }}>
          {tr
            ? "Bir çökme tekrar ederse, son başarılı VLC ve ekran-yönü olayları burada kalır. Yayın adresi veya şifre kaydedilmez."
            : "If a crash repeats, the last successful VLC and orientation events remain here. Stream URLs and passwords are not stored."}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <FocusButton label={tr ? "Yenile" : "Refresh"} icon="refresh-cw" onPress={refreshDiagnostics} />
          <FocusButton label={tr ? "Kaydı temizle" : "Clear log"} icon="trash-2" variant="ghost" onPress={clearDiagnostics} />
        </View>

        <View style={{ marginTop: 10, gap: 7 }}>
          {diagnostics.length ? diagnostics.map((entry, index) => (
            <View
              key={`${entry.at}:${entry.event}:${index}`}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 9,
              }}
            >
              <Text style={{ color: colors.foreground, fontWeight: "800" }}>{entry.event}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                {new Date(entry.at).toLocaleString()}
              </Text>
              {formatDetails(entry) ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
                  {formatDetails(entry)}
                </Text>
              ) : null}
            </View>
          )) : (
            <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
              {tr ? "Henüz tanılama kaydı yok." : "No diagnostic entries yet."}
            </Text>
          )}
        </View>
      </View>
    </>
  );
}
