import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import { readLatestIsolatedStalkerSessionForProbe } from "@/lib/stalkerIsolatedLogin";
import {
  discoverStalkerSeriesDetails,
  probeStalkerSeriesCategories,
  probeStalkerSeriesCreateLink,
  probeStalkerSeriesPage,
  type StalkerSeriesCreateLinkObservation,
  type StalkerSeriesDetailDiscovery,
  type StalkerSeriesEpisode,
  type StalkerSeriesProbeCategory,
  type StalkerSeriesProbeItem,
  type StalkerSeriesProbeObservation,
  type StalkerSeriesSeason,
} from "@/lib/stalkerSeriesProbe";

type Stage = "IDLE" | "CATEGORIES" | "PAGE" | "DETAILS" | "EPISODES" | "LINK";

function Observation({ title, value }: { title: string; value: StalkerSeriesProbeObservation | StalkerSeriesCreateLinkObservation | null }) {
  const colors = useColors();
  if (!value) return null;
  return <View style={[styles.observation, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <Text style={[styles.strong, { color: colors.foreground }]}>{title}: {value.classification}</Text>
    <Text style={{ color: colors.mutedForeground }}>shape={value.payloadShape} · http={value.httpStatus ?? "unavailable"} · count={value.itemCount}</Text>
    {value.totalItems !== undefined ? <Text style={{ color: colors.mutedForeground }}>total={value.totalItems} · max/page={value.maxPageItems ?? "?"} · cur_page={value.currentPage ?? "?"}</Text> : null}
    {value.fieldNames.length ? <Text style={{ color: colors.mutedForeground }}>fields={value.fieldNames.join(", ")}</Text> : null}
    {value.samplePrimitives.length ? <Text style={{ color: colors.mutedForeground }}>sample={value.samplePrimitives.join(" · ")}</Text> : null}
    {"resolvedScheme" in value && value.resolvedScheme ? <Text style={{ color: colors.mutedForeground }}>resolved scheme={value.resolvedScheme}</Text> : null}
    {"wrapperPrefix" in value ? <Text style={{ color: colors.mutedForeground }}>wrapper prefix={value.wrapperPrefix ? "YES" : "NO"}</Text> : null}
    {"extraTransportHints" in value ? <Text style={{ color: colors.mutedForeground }}>header/cookie hint={value.extraTransportHints ? "YES" : "NO"}</Text> : null}
    {value.error ? <Text style={{ color: colors.destructive }}>{value.error}</Text> : null}
  </View>;
}

function safeStageLabel(discovery: StalkerSeriesDetailDiscovery | null) {
  if (!discovery) return "IDLE";
  return discovery.classification;
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
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [categoryObservation, setCategoryObservation] = useState<StalkerSeriesProbeObservation | null>(null);
  const [pageObservation, setPageObservation] = useState<StalkerSeriesProbeObservation | null>(null);
  const [detailDiscovery, setDetailDiscovery] = useState<StalkerSeriesDetailDiscovery | null>(null);
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
  const seasons: StalkerSeriesSeason[] = detailDiscovery?.seasons ?? [];
  const episodes: StalkerSeriesEpisode[] = detailDiscovery?.episodes ?? [];
  const selectedSeason = seasons.find((item) => item.id === selectedSeasonId) ?? null;
  const visibleEpisodes = selectedSeason
    ? episodes.filter((item) => item.seasonId === selectedSeason.id || selectedSeason.id === "unassigned")
    : [];
  const selectedEpisode = visibleEpisodes.find((item) => item.id === selectedEpisodeId) ?? null;

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
    if (result.seasons.length === 1) setSelectedSeasonId(result.seasons[0]!.id);
    setStage("EPISODES");
    setBusy(false);
  };

  const runCreateLink = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || !selectedEpisode || linkStarted.current) return;
    linkStarted.current = true;
    setBusy(true);
    setStage("LINK");
    const result = await probeStalkerSeriesCreateLink(session, selectedEpisode.row, freshSignal());
    setLinkObservation(result.observation);
    setBusy(false);
  };

  if (!expanded) {
    return <View style={[styles.shell, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Tanılama: Stalker Series fiziksel probu</Text>
        <Text style={{ color: colors.mutedForeground }}>R16-D2 Diagnostic only · Production Series değildir.</Text>
      </View>
      <FocusButton label="Series probunu aç" icon="activity" variant="ghost" onPress={() => setExpanded(true)} />
    </View>;
  }

  return <View style={[styles.panel, { borderColor: colors.primary, backgroundColor: colors.card }]}>
    <Text style={[styles.title, { color: colors.foreground }]}>R16-D2 · Series Season / Episode Probe</Text>
    <Text style={{ color: colors.mutedForeground }}>Stage: {stage} · p=1 only · max 3 detail candidates · no persistence</Text>

    <FocusButton label={busy ? "Çalışıyor" : "BP1 · SERIES CATEGORIES"} disabled={busy || categoryStarted.current} onPress={() => void runCategories()} />
    <Observation title="BP1" value={categoryObservation} />

    {categoryObservation?.classification === "SUCCESS" ? <>
      <Text style={[styles.strong, { color: colors.foreground }]}>Bir kategori seç</Text>
      <View style={styles.list}>{selectableCategories.map((category) => <Pressable
        key={category.id}
        disabled={pageStarted.current}
        onPress={() => setSelectedCategoryId(category.id)}
        style={[styles.row, { borderColor: selectedCategoryId === category.id ? colors.primary : colors.border }]}
      ><Text style={{ color: colors.foreground }}>{category.title}</Text></Pressable>)}</View>
      <FocusButton label="BP2 · SERIES LIST p=1" disabled={busy || !selectedCategory || pageStarted.current} onPress={() => void runPage()} />
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
      {selectedSeries ? <Text style={{ color: colors.mutedForeground }}>selected={selectedSeries.title} · raw id={selectedSeries.id}</Text> : null}
      <FocusButton label="BP3 · DETAIL / SEASON DIALECT" disabled={busy || !selectedSeries || detailStarted.current} onPress={() => void runDetails()} />
    </> : null}

    {detailDiscovery ? <View style={[styles.observation, { borderColor: colors.border }]}>
      <Text style={[styles.strong, { color: colors.foreground }]}>BP3: {safeStageLabel(detailDiscovery)}</Text>
      <Text style={{ color: colors.mutedForeground }}>source={detailDiscovery.source} · candidates={detailDiscovery.candidateCount} · used={detailDiscovery.candidateNumberUsed ?? "none"}</Text>
      {detailDiscovery.observations.map((item) => <Text key={item.candidateNumber} style={{ color: colors.mutedForeground }}>
        candidate {item.candidateNumber}: {item.type}/{item.action} · keys={item.paramKeys.join(",")} · {item.hierarchyClassification}
      </Text>)}
    </View> : null}

    {detailDiscovery ? <View style={[styles.observation, { borderColor: colors.border }]}>
      <Text style={[styles.strong, { color: colors.foreground }]}>BP4 EPISODES: {episodes.length ? "PASS" : detailDiscovery.classification}</Text>
      <Text style={{ color: colors.mutedForeground }}>seasons={seasons.length} · episodes={episodes.length}</Text>
    </View> : null}

    {seasons.length ? <>
      <Text style={[styles.strong, { color: colors.foreground }]}>Bir season seç</Text>
      <View style={styles.list}>{seasons.map((season) => <Pressable
        key={season.id}
        disabled={selectedSeasonId !== null && selectedSeasonId !== season.id}
        onPress={() => { setSelectedSeasonId(season.id); setSelectedEpisodeId(null); }}
        style={[styles.row, { borderColor: selectedSeasonId === season.id ? colors.primary : colors.border }]}
      ><Text style={{ color: colors.foreground }}>{season.label} · id={season.id}</Text></Pressable>)}</View>
    </> : null}

    {selectedSeason ? <>
      <Text style={{ color: colors.mutedForeground }}>selected season={selectedSeason.label} · id={selectedSeason.id}</Text>
      <Text style={[styles.strong, { color: colors.foreground }]}>Bir episode seç</Text>
      <View style={styles.list}>{visibleEpisodes.map((episode) => <Pressable
        key={episode.id}
        disabled={selectedEpisodeId !== null && selectedEpisodeId !== episode.id}
        onPress={() => setSelectedEpisodeId(episode.id)}
        style={[styles.row, { borderColor: selectedEpisodeId === episode.id ? colors.primary : colors.border }]}
      ><Text style={{ color: colors.foreground }}>{episode.label}</Text></Pressable>)}</View>
    </> : null}

    {selectedEpisode ? <>
      <Text style={{ color: colors.mutedForeground }}>selected episode={selectedEpisode.label}</Text>
      <FocusButton label="BP5 · CREATE_LINK" disabled={busy || linkStarted.current || typeof selectedEpisode.row.cmd !== "string"} onPress={() => void runCreateLink()} />
    </> : null}
    <Observation title="BP5" value={linkObservation} />
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
