import React, { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import { readLatestIsolatedStalkerSessionForProbe } from "@/lib/stalkerIsolatedLogin";
import {
  probeStalkerVodCategories,
  probeStalkerVodCreateLink,
  probeStalkerVodPage,
  type StalkerVodCreateLinkObservation,
  type StalkerVodProbeCategory,
  type StalkerVodProbeItem,
  type StalkerVodProbeObservation,
} from "@/lib/stalkerVodProbe";

type Stage = "IDLE" | "CATEGORIES" | "PAGE" | "LINK";

function Observation({ title, value }: { title: string; value: StalkerVodProbeObservation | StalkerVodCreateLinkObservation | null }) {
  const colors = useColors();
  if (!value) return null;
  return <View style={[styles.observation, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <Text style={[styles.observationTitle, { color: colors.foreground }]}>{title}: {value.classification}</Text>
    <Text style={{ color: colors.mutedForeground }}>root={value.rootType}</Text>
    {"count" in value ? <Text style={{ color: colors.mutedForeground }}>count={value.count}</Text> : null}
    {value.fieldTypes.length ? <Text style={{ color: colors.mutedForeground }}>fields={value.fieldTypes.join(", ")}</Text> : null}
    {"paginationFieldTypes" in value && value.paginationFieldTypes.length ? <Text style={{ color: colors.mutedForeground }}>pagination={value.paginationFieldTypes.join(", ")}</Text> : null}
    {"resolvedScheme" in value && value.resolvedScheme ? <Text style={{ color: colors.mutedForeground }}>resolved scheme={value.resolvedScheme}</Text> : null}
    {"extraTransportHints" in value ? <Text style={{ color: colors.mutedForeground }}>extra headers/cookies hinted={value.extraTransportHints ? "YES" : "NO"}</Text> : null}
    {value.error ? <Text style={{ color: colors.destructive }}>{value.error}</Text> : null}
  </View>;
}

export function StalkerVodProbePanel() {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [stage, setStage] = useState<Stage>("IDLE");
  const [categories, setCategories] = useState<StalkerVodProbeCategory[]>([]);
  const [items, setItems] = useState<StalkerVodProbeItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [categoryObservation, setCategoryObservation] = useState<StalkerVodProbeObservation | null>(null);
  const [pageObservation, setPageObservation] = useState<StalkerVodProbeObservation | null>(null);
  const [linkObservation, setLinkObservation] = useState<StalkerVodCreateLinkObservation | null>(null);
  const [busy, setBusy] = useState(false);
  const categoryStarted = useRef(false);
  const pageStarted = useRef(false);
  const linkStarted = useRef(false);

  const selectedCategory = useMemo(
    () => categories.find((item) => item.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const runCategories = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || categoryStarted.current) return;
    categoryStarted.current = true;
    setBusy(true);
    setStage("CATEGORIES");
    setCategories([]);
    setItems([]);
    setSelectedCategoryId(null);
    setSelectedItemId(null);
    setPageObservation(null);
    setLinkObservation(null);
    const result = await probeStalkerVodCategories(session);
    setCategories(result.categories);
    setCategoryObservation(result.observation);
    setBusy(false);
  };

  const runPage = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || !selectedCategory || categoryObservation?.classification !== "SUCCESS" || pageStarted.current) return;
    pageStarted.current = true;
    setBusy(true);
    setStage("PAGE");
    setItems([]);
    setSelectedItemId(null);
    setLinkObservation(null);
    const result = await probeStalkerVodPage(session, selectedCategory);
    setItems(result.items);
    setPageObservation(result.observation);
    setBusy(false);
  };

  const runCreateLink = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || !selectedItem || pageObservation?.classification !== "SUCCESS" || !selectedItem.cmd || linkStarted.current) return;
    linkStarted.current = true;
    setBusy(true);
    setStage("LINK");
    const result = await probeStalkerVodCreateLink(session, selectedItem);
    setLinkObservation(result.observation);
    setBusy(false);
  };

  if (!expanded) {
    return <View style={[styles.shell, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Tanılama: Stalker VOD fiziksel probu</Text>
        <Text style={{ color: colors.mutedForeground }}>Üretim VOD değildir. Yalnız BP1 → BP2 → BP3 sıralı, tek-atımlık kontrollü istekler.</Text>
      </View>
      <FocusButton label="Probu aç" icon="activity" variant="ghost" onPress={() => setExpanded(true)} />
    </View>;
  }

  return <View style={[styles.panel, { borderColor: colors.primary, backgroundColor: colors.card }]}>
    <Text style={[styles.title, { color: colors.foreground }]}>R16-BP · Diagnostic only</Text>
    <Text style={{ color: colors.mutedForeground }}>Stage: {stage}</Text>
    <FocusButton label={busy ? "Çalışıyor" : "BP1 · VOD Categories"} disabled={busy || categoryStarted.current} onPress={() => void runCategories()} />
    <Observation title="BP1" value={categoryObservation} />

    {categoryObservation?.classification === "SUCCESS" ? <>
      <Text style={[styles.label, { color: colors.foreground }]}>Gerçek kategori seç</Text>
      <View style={styles.list}>{categories.map((category) => <Pressable
        key={category.id}
        accessibilityRole="button"
        onPress={() => setSelectedCategoryId(category.id)}
        style={[styles.row, { borderColor: selectedCategoryId === category.id ? colors.primary : colors.border }]}
      >
        <Text style={{ color: colors.foreground, fontWeight: "700", flex: 1 }}>{category.title}</Text>
        <Text style={{ color: colors.mutedForeground }}>{category.idField}/{category.titleField}</Text>
      </Pressable>)}</View>
      <FocusButton label={busy ? "Çalışıyor" : "BP2 · Selected category p=1"} disabled={busy || !selectedCategory || pageStarted.current} onPress={() => void runPage()} />
    </> : null}
    <Observation title="BP2" value={pageObservation} />

    {pageObservation?.classification === "SUCCESS" ? <>
      <Text style={[styles.label, { color: colors.foreground }]}>Gerçek VOD satırı seç</Text>
      <View style={styles.list}>{items.map((item) => <Pressable
        key={item.id}
        accessibilityRole="button"
        onPress={() => setSelectedItemId(item.id)}
        style={[styles.row, { borderColor: selectedItemId === item.id ? colors.primary : colors.border }]}
      >
        <Text style={{ color: colors.foreground, fontWeight: "700", flex: 1 }}>{item.title}</Text>
        <Text style={{ color: colors.mutedForeground }}>{item.idField}/{item.titleField}/{item.cmdField}</Text>
      </Pressable>)}</View>
      <FocusButton label={busy ? "Çalışıyor" : "BP3 · VOD create_link"} disabled={busy || !selectedItem?.cmd || linkStarted.current} onPress={() => void runCreateLink()} />
    </> : null}
    <Observation title="BP3" value={linkObservation} />
  </View>;
}

const styles = StyleSheet.create({
  shell: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18 },
  panel: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10, marginTop: 18 },
  title: { fontWeight: "900", fontSize: 16 },
  label: { fontWeight: "800", marginTop: 4 },
  list: { gap: 6 },
  row: { borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", gap: 10, alignItems: "center" },
  observation: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 3 },
  observationTitle: { fontWeight: "800" },
});
