import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import { readLatestIsolatedStalkerSessionForProbe } from "@/lib/stalkerIsolatedLogin";
import { probeStalkerSeriesCategories, probeStalkerSeriesPage, type StalkerSeriesProbeCategory, type StalkerSeriesProbeItem, type StalkerSeriesProbeObservation } from "@/lib/stalkerSeriesProbe";
import { probeStalkerSeriesPhysicalRowShape, type StalkerSeriesPhysicalShapeProbe, type StalkerSeriesRowShape } from "@/lib/stalkerSeriesShapeProbe";

function Observation({ title, value }: { title: string; value: StalkerSeriesProbeObservation | null }) {
  const colors = useColors();
  if (!value) return null;
  return <View style={[styles.observation, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <Text style={[styles.strong, { color: colors.foreground }]}>{title}: {value.classification}</Text>
    <Text style={{ color: colors.mutedForeground }}>shape={value.payloadShape} · http={value.httpStatus ?? "unavailable"} · count={value.itemCount}</Text>
    {value.totalItems !== undefined ? <Text style={{ color: colors.mutedForeground }}>total={value.totalItems} · max/page={value.maxPageItems ?? "?"} · cur_page={value.currentPage ?? "?"}</Text> : null}
    {value.error ? <Text style={{ color: colors.destructive }}>{value.error}</Text> : null}
  </View>;
}

function RowShape({ value }: { value: StalkerSeriesRowShape }) {
  const colors = useColors();
  return <View style={[styles.observation, { borderColor: colors.border }]}>
    <Text style={[styles.strong, { color: colors.foreground }]}>ROW {value.index}</Text>
    <Text style={{ color: colors.mutedForeground }}>fields=[{value.fieldNames.join(", ")}]</Text>
    <Text style={{ color: colors.mutedForeground }}>primitive types={Object.entries(value.primitiveTypes).map(([key, type]) => `${key}:${type}`).join(", ") || "none"}</Text>
    <Text style={{ color: colors.mutedForeground }}>safe primitives=[{value.safePrimitives.join(" · ") || "none"}]</Text>
    <Text style={{ color: colors.mutedForeground }}>arrays=[{value.arrayFields.map((field) => `${field.key}{len=${field.length}, first=${field.firstItemType ?? "none"}${field.firstItemFieldNames ? `, fields=${field.firstItemFieldNames.join("|")}` : ""}}`).join(" · ") || "none"}]</Text>
    <Text style={{ color: colors.mutedForeground }}>objects=[{value.objectFields.map((field) => `${field.key}{fields=${field.fieldNames.join("|")}}`).join(" · ") || "none"}]</Text>
    <Text style={{ color: colors.mutedForeground }}>sensitive fields=[{value.sensitiveFields.map((field) => `${field.key}{present=YES,type=${field.type}${field.length === undefined ? "" : `,length=${field.length}`}}`).join(" · ") || "none"}]</Text>
  </View>;
}

export function StalkerSeriesProbePanel() {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<StalkerSeriesProbeCategory[]>([]);
  const [items, setItems] = useState<StalkerSeriesProbeItem[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [categoryObservation, setCategoryObservation] = useState<StalkerSeriesProbeObservation | null>(null);
  const [pageObservation, setPageObservation] = useState<StalkerSeriesProbeObservation | null>(null);
  const [shapeProbe, setShapeProbe] = useState<StalkerSeriesPhysicalShapeProbe | null>(null);
  const categoryStarted = useRef(false);
  const pageStarted = useRef(false);
  const shapeStarted = useRef(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => active.current?.abort(), []);
  const freshSignal = () => {
    active.current?.abort();
    active.current = new AbortController();
    return active.current.signal;
  };

  const selectableCategories = useMemo(() => {
    const filtered = categories.filter((category) => category.id !== "*");
    return filtered.length ? filtered : categories;
  }, [categories]);
  const category = selectableCategories.find((candidate) => candidate.id === categoryId) ?? null;
  const series = items.find((candidate) => candidate.id === seriesId) ?? null;

  const runCategories = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || categoryStarted.current) return;
    categoryStarted.current = true;
    setBusy(true);
    const result = await probeStalkerSeriesCategories(session, freshSignal());
    setCategories(result.categories);
    setCategoryObservation(result.observation);
    setBusy(false);
  };

  const runPage = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || !category || pageStarted.current) return;
    pageStarted.current = true;
    setBusy(true);
    const result = await probeStalkerSeriesPage(session, category, freshSignal());
    setItems(result.items);
    setPageObservation(result.observation);
    setBusy(false);
  };

  const runShapeProbe = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || !series || shapeStarted.current) return;
    shapeStarted.current = true;
    setBusy(true);
    setShapeProbe(await probeStalkerSeriesPhysicalRowShape(session, series, freshSignal()));
    setBusy(false);
  };

  if (!expanded) return <View style={[styles.shell, { borderColor: colors.border, backgroundColor: colors.card }]}>
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={[styles.title, { color: colors.foreground }]}>Tanılama: Stalker Series fiziksel probu</Text>
      <Text style={{ color: colors.mutedForeground }}>R16-D4 Diagnostic only · response schema extraction.</Text>
    </View>
    <FocusButton label="Series probunu aç" icon="activity" variant="ghost" onPress={() => setExpanded(true)} />
  </View>;

  const d4Pass = shapeProbe?.observation.classification === "SUCCESS" && shapeProbe.rowShapes.length > 0;

  return <View style={[styles.panel, { borderColor: colors.primary, backgroundColor: colors.card }]}>
    <Text style={[styles.title, { color: colors.foreground }]}>R16-D4 · SERIES DETAIL ROW SHAPE</Text>
    <Text style={{ color: colors.mutedForeground }}>Shape extraction only · no VOD fallback · no create_link · p=1</Text>

    <FocusButton label={busy ? "Çalışıyor" : "BP1 · SERIES CATEGORIES"} disabled={busy || categoryStarted.current} onPress={() => void runCategories()} />
    <Observation title="BP1" value={categoryObservation} />

    {categoryObservation?.classification === "SUCCESS" ? <>
      <Text style={[styles.strong, { color: colors.foreground }]}>Bir kategori seç</Text>
      <View style={styles.list}>{selectableCategories.map((candidate) => <Pressable key={candidate.id} disabled={pageStarted.current} onPress={() => setCategoryId(candidate.id)} style={[styles.row, { borderColor: categoryId === candidate.id ? colors.primary : colors.border }]}><Text style={{ color: colors.foreground }}>{candidate.title}</Text></Pressable>)}</View>
      <FocusButton label="BP2 · SERIES LIST p=1" disabled={busy || !category || pageStarted.current} onPress={() => void runPage()} />
    </> : null}
    <Observation title="BP2" value={pageObservation} />

    {pageObservation?.classification === "SUCCESS" ? <>
      <Text style={[styles.strong, { color: colors.foreground }]}>Bir Series satırı seç</Text>
      <View style={styles.list}>{items.slice(0, 30).map((candidate) => <Pressable key={candidate.id} disabled={shapeStarted.current} onPress={() => setSeriesId(candidate.id)} style={[styles.row, { borderColor: seriesId === candidate.id ? colors.primary : colors.border }]}><Text style={{ color: colors.foreground }}>{candidate.title}</Text></Pressable>)}</View>
      {series ? <Text style={{ color: colors.mutedForeground }}>selected={series.title} · movie_id present=YES · type=string · length={series.id.length}</Text> : null}
      <FocusButton label="BP3 · R16-D4 SERIES DETAIL ROW SHAPE" disabled={busy || !series || shapeStarted.current} onPress={() => void runShapeProbe()} />
    </> : null}

    {shapeProbe ? <View style={[styles.observation, { borderColor: colors.border }]}>
      <Text style={[styles.strong, { color: colors.foreground }]}>BP3 D4: {d4Pass ? "PASS" : shapeProbe.observation.classification}</Text>
      <Text style={{ color: colors.mutedForeground }}>request=series/get_ordered_list · movie_id=&lt;opaque selected id&gt; · p=1</Text>
      <Text style={{ color: colors.mutedForeground }}>item_count={shapeProbe.observation.itemCount} · total_items={shapeProbe.observation.totalItems ?? "?"} · max_page_items={shapeProbe.observation.maxPageItems ?? "?"} · cur_page={shapeProbe.observation.currentPage ?? "?"}</Text>
      <Text style={{ color: colors.mutedForeground }}>root fields=[{shapeProbe.rootShape.fieldNames.join(", ")}] · data/js type={shapeProbe.rootShape.dataFieldType} · rows={shapeProbe.rootShape.rowsCount}</Text>
      <Text style={{ color: colors.mutedForeground }}>root objects=[{shapeProbe.rootShape.objectFields.map((field) => `${field.key}{${field.fieldNames.join("|")}}`).join(" · ") || "none"}]</Text>
    </View> : null}

    {shapeProbe?.rowShapes.map((row) => <RowShape key={row.index} value={row} />)}

    {d4Pass && shapeProbe ? <View style={[styles.observation, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.strong, { color: colors.foreground }]}>BP4 · EMBEDDED SERIES HIERARCHY</Text>
      <Text style={{ color: colors.mutedForeground }}>classification={shapeProbe.hierarchy.classification}</Text>
      <Text style={{ color: colors.mutedForeground }}>seasons={shapeProbe.hierarchy.totalSeasons} · embedded episodes={shapeProbe.hierarchy.totalEmbeddedEpisodes} · additional requests=0</Text>
      {shapeProbe.hierarchy.seasons.map((season) => <View key={season.id} style={styles.hierarchySeason}>
        <Text style={[styles.strong, { color: colors.foreground }]}>{season.label}</Text>
        <Text style={{ color: colors.mutedForeground }}>season_id={season.id} · episodes={season.episodeCount}</Text>
        <Text style={{ color: colors.mutedForeground }}>ids=[{season.episodeIds.join(",")}]</Text>
      </View>)}
    </View> : null}
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
  hierarchySeason: { gap: 2, paddingTop: 6 },
});
