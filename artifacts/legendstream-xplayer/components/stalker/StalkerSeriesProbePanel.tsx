import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import { readLatestIsolatedStalkerSessionForProbe } from "@/lib/stalkerIsolatedLogin";
import {
  discoverStalkerSeriesDetails,
  inspectStalkerSeriesNestedContainers,
  probeStalkerSeriesCategories,
  probeStalkerSeriesCreateLink,
  probeStalkerSeriesPage,
  seriesProbeRowLabel,
  type StalkerSeriesCreateLinkObservation,
  type StalkerSeriesDetailDiscovery,
  type StalkerSeriesNestedContainer,
  type StalkerSeriesProbeCategory,
  type StalkerSeriesProbeItem,
  type StalkerSeriesProbeObservation,
} from "@/lib/stalkerSeriesProbe";

type Stage = "IDLE" | "CATEGORIES" | "PAGE" | "DETAILS" | "EPISODES" | "LINK";

function Observation({ title, value }: { title: string; value: StalkerSeriesProbeObservation | StalkerSeriesCreateLinkObservation | null }) {
  const colors = useColors();
  if (!value) return null;
  return <View style={[styles.observation, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <Text style={[styles.strong, { color: colors.foreground }]}>{title}: {value.classification}</Text>
    <Text style={{ color: colors.mutedForeground }}>shape={value.payloadShape} · http={value.httpStatus ?? "unavailable"} · count={value.itemCount}</Text>
    {value.fieldNames.length ? <Text style={{ color: colors.mutedForeground }}>fields={value.fieldNames.join(", ")}</Text> : null}
    {value.samplePrimitives.length ? <Text style={{ color: colors.mutedForeground }}>sample={value.samplePrimitives.join(" · ")}</Text> : null}
    {"resolvedScheme" in value && value.resolvedScheme ? <Text style={{ color: colors.mutedForeground }}>resolved scheme={value.resolvedScheme}</Text> : null}
    {"wrapperPrefix" in value ? <Text style={{ color: colors.mutedForeground }}>wrapper prefix={value.wrapperPrefix ? "YES" : "NO"}</Text> : null}
    {"extraTransportHints" in value ? <Text style={{ color: colors.mutedForeground }}>header/cookie hint={value.extraTransportHints ? "YES" : "NO"}</Text> : null}
    {value.error ? <Text style={{ color: colors.destructive }}>{value.error}</Text> : null}
  </View>;
}

export function StalkerSeriesProbePanel() {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [stage, setStage] = useState<Stage>("IDLE");
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<StalkerSeriesProbeCategory[]>([]);
  const [items, setItems] = useState<StalkerSeriesProbeItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [categoryObservation, setCategoryObservation] = useState<StalkerSeriesProbeObservation | null>(null);
  const [pageObservation, setPageObservation] = useState<StalkerSeriesProbeObservation | null>(null);
  const [detailDiscovery, setDetailDiscovery] = useState<StalkerSeriesDetailDiscovery | null>(null);
  const [selectedContainerPath, setSelectedContainerPath] = useState<string | null>(null);
  const [selectedSeasonIndex, setSelectedSeasonIndex] = useState<number | null>(null);
  const [episodeContainers, setEpisodeContainers] = useState<StalkerSeriesNestedContainer[]>([]);
  const [selectedEpisodeContainerPath, setSelectedEpisodeContainerPath] = useState<string | null>(null);
  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState<number | null>(null);
  const [linkObservation, setLinkObservation] = useState<StalkerSeriesCreateLinkObservation | null>(null);
  const categoryStarted = useRef(false);
  const pageStarted = useRef(false);
  const detailStarted = useRef(false);
  const linkStarted = useRef(false);
  const activeController = useRef<AbortController | null>(null);

  useEffect(() => () => activeController.current?.abort(), []);
  const freshSignal = () => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    return controller.signal;
  };

  const selectableCategories = useMemo(() => {
    const nonAll = categories.filter((item) => item.id !== "*");
    return nonAll.length ? nonAll : categories;
  }, [categories]);
  const selectedCategory = selectableCategories.find((item) => item.id === selectedCategoryId) ?? null;
  const selectedSeries = items.find((item) => item.id === selectedSeriesId) ?? null;
  const selectedContainer = detailDiscovery?.containers.find((item) => item.path === selectedContainerPath) ?? null;
  const selectedSeason = selectedContainer && selectedSeasonIndex != null ? selectedContainer.rows[selectedSeasonIndex] ?? null : null;
  const selectedEpisodeContainer = episodeContainers.find((item) => item.path === selectedEpisodeContainerPath) ?? null;
  const selectedEpisode = selectedEpisodeContainer && selectedEpisodeIndex != null
    ? selectedEpisodeContainer.rows[selectedEpisodeIndex] ?? null
    : selectedSeason && typeof selectedSeason.cmd === "string" ? selectedSeason : null;

  const runCategories = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || categoryStarted.current) return;
    categoryStarted.current = true;
    setBusy(true);
    setStage("CATEGORIES");
    const result = await probeStalkerSeriesCategories(session, freshSignal());
    setCategories(result.categories);
    setCategoryObservation(result.observation);
    setBusy(false);
  };

  const runPage = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || !selectedCategory || pageStarted.current) return;
    pageStarted.current = true;
    setBusy(true);
    setStage("PAGE");
    const result = await probeStalkerSeriesPage(session, selectedCategory, freshSignal());
    setItems(result.items);
    setPageObservation(result.observation);
    setBusy(false);
  };

  const runDetails = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || !selectedSeries || detailStarted.current) return;
    detailStarted.current = true;
    setBusy(true);
    setStage("DETAILS");
    const result = await discoverStalkerSeriesDetails(session, selectedSeries, freshSignal());
    setDetailDiscovery(result);
    setBusy(false);
  };

  const selectSeasonRow = (index: number) => {
    if (!selectedContainer) return;
    setSelectedSeasonIndex(index);
    setSelectedEpisodeIndex(null);
    setSelectedEpisodeContainerPath(null);
    const row = selectedContainer.rows[index];
    setEpisodeContainers(row ? inspectStalkerSeriesNestedContainers(row) : []);
    setStage("EPISODES");
  };

  const runCreateLink = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || !selectedEpisode || linkStarted.current) return;
    linkStarted.current = true;
    setBusy(true);
    setStage("LINK");
    const result = await probeStalkerSeriesCreateLink(session, selectedEpisode, freshSignal());
    setLinkObservation(result.observation);
    setBusy(false);
  };

  if (!expanded) {
    return <View style={[styles.shell, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Tanılama: Stalker Series fiziksel probu</Text>
        <Text style={{ color: colors.mutedForeground }}>R16-D Diagnostic only · Production Series değildir.</Text>
      </View>
      <FocusButton label="Series probunu aç" icon="activity" variant="ghost" onPress={() => setExpanded(true)} />
    </View>;
  }

  return <View style={[styles.panel, { borderColor: colors.primary, backgroundColor: colors.card }]}>
    <Text style={[styles.title, { color: colors.foreground }]}>R16-D · Series Diagnostic only</Text>
    <Text style={{ color: colors.mutedForeground }}>Stage: {stage} · p=1 only · no aggregate fallback</Text>
    <FocusButton label={busy ? "Çalışıyor" : "BP1 · Series Categories"} disabled={busy || categoryStarted.current} onPress={() => void runCategories()} />
    <Observation title="BP1" value={categoryObservation} />

    {categoryObservation?.classification === "SUCCESS" ? <>
      <Text style={[styles.strong, { color: colors.foreground }]}>Bir kategori seç</Text>
      <View style={styles.list}>{selectableCategories.map((category) => <Pressable
        key={category.id}
        disabled={pageStarted.current}
        onPress={() => setSelectedCategoryId(category.id)}
        style={[styles.row, { borderColor: selectedCategoryId === category.id ? colors.primary : colors.border }]}
      ><Text style={{ color: colors.foreground }}>{category.title}</Text></Pressable>)}</View>
      <FocusButton label="BP2 · Selected category p=1" disabled={busy || !selectedCategory || pageStarted.current} onPress={() => void runPage()} />
    </> : null}
    <Observation title="BP2" value={pageObservation} />

    {pageObservation?.classification === "SUCCESS" ? <>
      <Text style={[styles.strong, { color: colors.foreground }]}>Bir Series satırı seç</Text>
      <View style={styles.list}>{items.slice(0, 30).map((item) => <Pressable
        key={item.id}
        disabled={detailStarted.current}
        onPress={() => setSelectedSeriesId(item.id)}
        style={[styles.row, { borderColor: selectedSeriesId === item.id ? colors.primary : colors.border }]}
      ><Text style={{ color: colors.foreground }}>{item.title}</Text></Pressable>)}</View>
      <FocusButton label="BP3 · Series info / season discovery" disabled={busy || !selectedSeries || detailStarted.current} onPress={() => void runDetails()} />
    </> : null}

    {detailDiscovery ? <View style={[styles.observation, { borderColor: colors.border }]}>
      <Text style={[styles.strong, { color: colors.foreground }]}>BP3: {detailDiscovery.classification}</Text>
      <Text style={{ color: colors.mutedForeground }}>source={detailDiscovery.source} · candidates={detailDiscovery.candidateCount}</Text>
      {detailDiscovery.classification === "EVIDENCE_REQUIRED" ? <Text style={{ color: colors.destructive }}>Ayrı Series-info action/param için source/provider evidence yok; tahmin yapılmadı.</Text> : null}
    </View> : null}

    {detailDiscovery?.classification === "SUCCESS" ? <>
      <Text style={[styles.strong, { color: colors.foreground }]}>Nested container seç</Text>
      <View style={styles.list}>{detailDiscovery.containers.map((container) => <Pressable
        key={container.path}
        disabled={selectedSeasonIndex != null}
        onPress={() => setSelectedContainerPath(container.path)}
        style={[styles.row, { borderColor: selectedContainerPath === container.path ? colors.primary : colors.border }]}
      ><Text style={{ color: colors.foreground }}>{container.path} ({container.rows.length})</Text></Pressable>)}</View>
      {selectedContainer ? <View style={styles.list}>{selectedContainer.rows.map((row, index) => <Pressable
        key={`${selectedContainer.path}-${index}`}
        disabled={selectedSeasonIndex != null}
        onPress={() => selectSeasonRow(index)}
        style={[styles.row, { borderColor: selectedSeasonIndex === index ? colors.primary : colors.border }]}
      ><Text style={{ color: colors.foreground }}>{seriesProbeRowLabel(row)}</Text></Pressable>)}</View> : null}
    </> : null}

    {selectedSeason ? <>
      <Text style={[styles.strong, { color: colors.foreground }]}>Selected season/row fields: {Object.keys(selectedSeason).sort().join(", ")}</Text>
      {episodeContainers.length ? <>
        <Text style={{ color: colors.mutedForeground }}>Episode container seç</Text>
        <View style={styles.list}>{episodeContainers.map((container) => <Pressable
          key={container.path}
          disabled={selectedEpisodeIndex != null}
          onPress={() => setSelectedEpisodeContainerPath(container.path)}
          style={[styles.row, { borderColor: selectedEpisodeContainerPath === container.path ? colors.primary : colors.border }]}
        ><Text style={{ color: colors.foreground }}>{container.path} ({container.rows.length})</Text></Pressable>)}</View>
        {selectedEpisodeContainer ? <View style={styles.list}>{selectedEpisodeContainer.rows.map((row, index) => <Pressable
          key={`${selectedEpisodeContainer.path}-${index}`}
          disabled={selectedEpisodeIndex != null}
          onPress={() => setSelectedEpisodeIndex(index)}
          style={[styles.row, { borderColor: selectedEpisodeIndex === index ? colors.primary : colors.border }]}
        ><Text style={{ color: colors.foreground }}>{seriesProbeRowLabel(row)}</Text></Pressable>)}</View> : null}
      </> : <Text style={{ color: colors.mutedForeground }}>Nested episode container yok. Seçili satırda cmd varsa doğrudan episode candidate olarak kullanılabilir.</Text>}
      <FocusButton label="BP4 · Episode create_link" disabled={busy || !selectedEpisode || typeof selectedEpisode.cmd !== "string" || linkStarted.current} onPress={() => void runCreateLink()} />
    </> : null}
    <Observation title="BP4" value={linkObservation} />
  </View>;
}

const styles = StyleSheet.create({
  shell: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18 },
  panel: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10, marginTop: 18 },
  title: { fontWeight: "900", fontSize: 16 },
  strong: { fontWeight: "800" },
  list: { gap: 6 },
  row: { borderWidth: 1, borderRadius: 10, padding: 10 },
  observation: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 3 },
});
