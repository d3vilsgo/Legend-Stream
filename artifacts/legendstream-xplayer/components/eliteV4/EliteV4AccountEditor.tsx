import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  usePlayer,
  type ProviderConfig,
  type ProviderType,
} from "@/context/PlayerContext";
import { SettingsDialog, SettingsDialogButton } from "./EliteV4SettingsDialog";
import { eliteV4Theme as theme } from "@/lib/design/eliteV4Theme";

type Config = Parameters<ReturnType<typeof usePlayer>["connectProvider"]>[0];
export function validateSettingsAccount(value: Config): string | null {
  if (!/^https?:\/\//i.test(value.playlistUrl || value.url || ""))
    return "http:// veya https:// ile başlayan kaynak adresi gerekir.";
  if (value.type === "xtream" && (!value.username?.trim() || !value.password))
    return "Xtream için kullanıcı adı ve parola gerekir.";
  if (value.type === "stalker" && !value.mac?.trim())
    return "Stalker için gerçek MAC adresi gerekir.";
  return null;
}
export function EliteV4AccountEditor({
  existing,
  onClose,
  onSubmit,
}: {
  existing: ProviderConfig | null;
  onClose: () => void;
  onSubmit: (value: Config) => Promise<void>;
}) {
  const [type, setType] = useState<ProviderType>(
    existing?.declaredType ?? existing?.type ?? "xtream",
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.playlistUrl || existing?.url || "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState(existing?.password ?? "");
  const [mac, setMac] = useState(existing?.mac ?? "");
  const [epg, setEpg] = useState(existing?.epgUrl ?? "");
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const lock = useRef(false);
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const field = (
    id: string,
    label: string,
    value: string,
    set: (s: string) => void,
    secret = false,
  ) => (
    <View key={id} style={{ gap: 4 }}>
      <SettingsDialogButton
        id={id}
        label={label}
        onPress={() => inputRefs.current[id]?.focus()}
      />
      <TextInput
        ref={(node) => {
          inputRefs.current[id] = node;
        }}
        accessibilityLabel={label}
        value={value}
        onChangeText={set}
        secureTextEntry={secret}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={() => setError(null)}
        style={{
          color: theme.color.foreground,
          borderColor: theme.color.focus,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          fontSize: 14,
        }}
      />
    </View>
  );
  const submit = async () => {
    if (lock.current) return;
    const value: Config = {
      providerId: existing?.id,
      type,
      name: name.trim() || type.toUpperCase(),
      playlistUrl: url.trim(),
      username: type === "xtream" ? username.trim() : undefined,
      password: type === "xtream" ? password : undefined,
      mac: type === "stalker" ? mac.trim() : undefined,
      epgUrl: type !== "stalker" ? epg.trim() || undefined : undefined,
    };
    const invalid = validateSettingsAccount(value);
    if (invalid) {
      setError(invalid);
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await onSubmit(value);
    } catch {
      if (alive.current)
        setError("Hesap kaydedilemedi. Bağlantı ve bilgileri kontrol edin.");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <SettingsDialog
      title={existing ? "Hesabı düzenle" : "Hesap ekle"}
      onClose={onClose}
    >
      <Text style={{ color: theme.color.muted }}>
        Bilgiler mevcut güvenli hesap altyapısıyla kaydedilir. Kaynak ve parola
        alanları gizlidir.
      </Text>
      {(["xtream", "m3u", "stalker"] as const).map((v) => (
        <SettingsDialogButton
          key={v}
          disabled={Boolean(existing) && type !== v}
          id={v}
          label={`${type === v ? "✓ " : ""}${v.toUpperCase()}`}
          onPress={() => {
            if (!lock.current && !existing) setType(v);
          }}
        />
      ))}
      {field("name", "Hesap adı", name, setName)}
      {field("url", "Sunucu / playlist adresi", url, setUrl, true)}
      {type === "xtream" ? (
        <>
          {field("username", "Kullanıcı adı", username, setUsername, true)}
          {field("password", "Parola", password, setPassword, true)}
        </>
      ) : null}
      {type === "stalker"
        ? field("mac", "MAC adresi", mac, setMac, true)
        : field("epg", "EPG adresi (isteğe bağlı)", epg, setEpg, true)}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.color.danger }}>
          {error}
        </Text>
      ) : null}
      <SettingsDialogButton
        id="save"
        label={busy ? "Bağlanıyor…" : "Kaydet ve bağlan"}
        onPress={() => void submit()}
      />
    </SettingsDialog>
  );
}
