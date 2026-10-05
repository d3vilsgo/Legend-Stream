import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text } from "react-native";
import type { ProviderConfig } from "@/context/PlayerContext";
import { useColors } from "@/hooks/useColors";
import type { Channel } from "@/lib/iptv";
import { safeLog } from "@/lib/safeLog";
import { StalkerEpgProbe } from "@/lib/stalkerEpgProbe";
import { getPersistedStalkerLivePlaybackRef } from "@/lib/stalkerLiveCache";
import { getOrCreateStalkerPortalSession } from "@/lib/stalkerPortalRuntime";

// Temporary explicit-action diagnostic. No common EPG setters or playback access.
export function StalkerEpgProbeControl({ provider, channel }: {
  provider: Pick<ProviderConfig, "id" | "type" | "url" | "mac">;
  channel?: Channel;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const owner = useRef<StalkerEpgProbe | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const probe = new StalkerEpgProbe();
    owner.current = probe;
    generation.current += 1;
    setBusy(false);
    return () => {
      generation.current += 1;
      owner.current = null;
      probe.cancel();
    };
  }, [provider.id, provider.type, provider.url, provider.mac]);

  if (provider.type !== "stalker") return null;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="EPG Yükle · E0P"
    disabled={busy || !channel}
    onPress={() => {
      const probe = owner.current;
      if (!probe || !channel) return;
      const current = generation.current;
      setBusy(true);
      void probe.run({
        getSession: () => getOrCreateStalkerPortalSession({
          providerId: provider.id, portalUrl: provider.url, mac: provider.mac ?? "",
        }),
        getIdentity: async () => {
          // One local canonical catalog lookup; never fetch another channel list.
          try {
            const ref = await getPersistedStalkerLivePlaybackRef(provider.id, channel.id);
            return { portalId: ref?.portalId, tvgId: channel.tvgId };
          } catch { return { tvgId: channel.tvgId }; }
        },
        log: (event, fields) => safeLog.info(event, JSON.stringify(fields)),
      }).finally(() => {
        if (generation.current === current) setBusy(false);
      });
    }}
    style={{ paddingVertical: 8, opacity: busy || !channel ? 0.5 : 1 }}
  >
    <Text style={{ color: colors.foreground }}>{busy ? "EPG tanısı çalışıyor…" : "EPG Yükle · E0P"}</Text>
  </Pressable>;
}
