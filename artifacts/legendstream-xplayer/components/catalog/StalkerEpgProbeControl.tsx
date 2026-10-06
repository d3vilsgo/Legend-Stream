import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import type { ProviderConfig } from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";
import type { Channel } from "@/lib/iptv";
import { safeLog } from "@/lib/safeLog";
import { StalkerEpgProbe } from "@/lib/stalkerEpgProbe";
import { StalkerEpgObservability } from "@/lib/stalkerEpgObservability";
import { getPersistedStalkerLivePlaybackRef } from "@/lib/stalkerLiveCache";
import { getOrCreateStalkerPortalSession } from "@/lib/stalkerPortalRuntime";

// Temporary explicit-action diagnostic. No common EPG setters or playback access.
export function StalkerEpgProbeControl({ provider, channel }: {
  provider: Pick<ProviderConfig, "id" | "type" | "url" | "mac">;
  channel?: Channel;
}) {
  const colors = useColors();
  const observable = useRef(new StalkerEpgObservability()).current;
  const history = useSyncExternalStore(observable.subscribe, observable.getSnapshot, observable.getSnapshot);
  const [copyFeedback, setCopyFeedback] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const owner = useRef<StalkerEpgProbe | null>(null);
  useEffect(() => {
    const probe = new StalkerEpgProbe();
    owner.current = probe;
    observable.setReady(Boolean(channel));
    return () => {
      owner.current = null;
      observable.abort();
    };
  }, [provider.id, provider.type, provider.url, provider.mac]);
  useEffect(() => { observable.setReady(Boolean(channel)); }, [channel, observable]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  if (provider.type !== "stalker") return null;
  return <View style={{ paddingVertical: 8 }}><Pressable
    accessibilityRole="button"
    accessibilityLabel="EPG Yükle · E0P"
    onPress={() => {
      setCopyFeedback("");
      const probe = owner.current;
      observable.press(Boolean(channel), probe, {
        getSession: () => getOrCreateStalkerPortalSession({
          providerId: provider.id, portalUrl: provider.url, mac: provider.mac ?? "",
        }),
        getIdentity: async () => {
          // One local canonical catalog lookup; never fetch another channel list.
          if (!channel) return {};
          try {
            const ref = await getPersistedStalkerLivePlaybackRef(provider.id, channel.id);
            return { portalId: ref?.portalId, tvgId: channel.tvgId };
          } catch { return { tvgId: channel.tvgId }; }
        },
        log: (event, fields) => safeLog.info(event, JSON.stringify(fields)),
      });
    }}
    style={{ paddingVertical: 8 }}
  >
    <Text style={{ color: colors.foreground }}>EPG Yükle · E0P</Text>
  </Pressable>
  <Text selectable style={{ color: colors.foreground, fontSize: 11, fontFamily: "monospace" }}>{history}</Text>
  <Pressable accessibilityRole="button" accessibilityLabel="E0P tanısını kopyala" onPress={() => {
    void observable.copy(Clipboard.setStringAsync, Constants.expoConfig?.version, Constants.expoConfig?.android?.versionCode, process.env.EXPO_PUBLIC_GIT_SHA).then((feedback) => {
      setCopyFeedback(feedback);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyFeedback(""), 3000);
    });
  }} style={{ paddingVertical: 8 }}><Text style={{ color: colors.foreground }}>Kopyala {copyFeedback}</Text></Pressable>
  </View>;
}
