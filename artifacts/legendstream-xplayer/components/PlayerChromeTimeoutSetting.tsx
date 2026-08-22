import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useI18n } from "@/context/I18nContext";
import { useColors } from "@/hooks/useColors";
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

export function PlayerChromeTimeoutSetting() {
  const colors = useColors();
  const { language } = useI18n();
  const labels = useMemo(() => copy[language] ?? copy.en, [language]);
  const [seconds, setSeconds] = useState<PlayerChromeTimeoutSeconds>(DEFAULT_PLAYER_CHROME_TIMEOUT_SECONDS);

  useEffect(() => {
    let mounted = true;
    getPlayerChromeTimeoutSeconds().then((value) => {
      if (mounted) setSeconds(value);
    });
    return () => { mounted = false; };
  }, []);

  const select = (value: PlayerChromeTimeoutSeconds) => {
    setSeconds(value);
    void setPlayerChromeTimeoutSeconds(value).catch(() => undefined);
  };

  return (
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
  );
}
