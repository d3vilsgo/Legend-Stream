import React, { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { useColors } from "@/hooks/useColors";
import { readLatestIsolatedStalkerSessionForProbe } from "@/lib/stalkerIsolatedLogin";
import { probeStalkerSeriesCategories, type StalkerSeriesProbeCategory } from "@/lib/stalkerSeriesProbe";
import {
  createStalkerSeriesPaginationEvidenceProbe,
  type StalkerSeriesDetailEvidence,
  type StalkerSeriesPaginationEvidence,
} from "@/lib/stalkerSeriesPaginationEvidenceProbe";

export function StalkerSeriesPaginationProbePanel() {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<StalkerSeriesProbeCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<StalkerSeriesPaginationEvidence | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<StalkerSeriesDetailEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const categoryLoaded = useRef(false);
  const pageProbeStarted = useRef(false);
  const detailProbeStarted = useRef(false);
  const controllerRef = useRef<ReturnType<typeof createStalkerSeriesPaginationEvidenceProbe> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedCategory = useMemo(() => categories.find((item) => item.id === categoryId) ?? null, [categories, categoryId]);

  const signal = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  };

  const loadCategories = async () => {
    const session = readLatestIsolatedStalkerSessionForProbe();
    if (!session || categoryLoaded.current) return;
    categoryLoaded.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await probeStalkerSeriesCategories(session, signal());
      setCategories(result.categories.filter((item) => item.id !== "*"));
      controllerRef.current = createStalkerSeriesPaginationEvidenceProbe(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Series categories probe failed.");
    } finally {
      setBusy(false);
    }
  };

  const runPages = async () => {
    if (!selectedCategory || !controllerRef.current || pageProbeStarted.current) return;
    pageProbeStarted.current = true;
    setBusy(true);
    setError(null);
    try {
      setEvidence(await controllerRef.current.runPages(selectedCategory, signal()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Series pagination probe failed.");
    } finally {
      setBusy(false);
    }
  };

  const runDetail = async () => {
    if (!detailKey || !controllerRef.current || detailProbeStarted.current) return;
    detailProbeStarted.current = true;
    setBusy(true);
    setError(null);
    try {
      setDetail(await controllerRef.current.runDetail(detailKey, signal()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Series detail evidence probe failed.");
    } finally {
      setBusy(false);
    }
  };

  return <View style={[styles.panel, { borderColor: colors.primary, backgroundColor: colors.card }]}>
    <Text style={[styles.title, { color: colors.foreground }]}>R16-D8-BP · SERIES LIST PAGINATION + METADATA PROBE</Text>
    <Text style={{ color: colors.mutedForeground }}>DISCOVERY ONLY · NO PLAYBACK · MAX 3 PAGE REQUESTS</Text>
    <Text style={{ color: colors.mutedForeground }}>Exactly p=1, p=2, p=3 · one selected category · detail max=1 · create_link=0</Text>

    <FocusButton label={busy ? "Çalışıyor" : "D8-BP · SERIES CATEGORIES"} disabled={busy || categoryLoaded.current} onPress={() => void loadCategories()} />

    {categories.length ? <>
      <Text style={[styles.strong, { color: colors.foreground }]}>Bir Series kategorisi seç</Text>
      <View style={styles.list}>{categories.map((category) => <Pressable
        key={category.id}
        disabled={pageProbeStarted.current}
        onPress={() => setCategoryId(category.id)}
        style={[styles.row, { borderColor: category.id === categoryId ? colors.primary : colors.border }]}
      ><Text style={{ color: colors.foreground }}>{category.title}</Text></Pressable>)}</View>
      <FocusButton label="RUN BOUNDED p=1 / p=2 / p=3" disabled={busy || !selectedCategory || pageProbeStarted.current} onPress={() => void runPages()} />
    </> : null}

    {evidence ? <>
      <View style={[styles.block, { borderColor: colors.border }]}>
        <Text style={[styles.strong, { color: colors.foreground }]}>PAGINATION EVIDENCE</Text>
        {evidence.pages.map((page) => <Text key={page.requestedPage} style={{ color: colors.mutedForeground }}>
          p={page.requestedPage} · cur_page={page.responseCurPage ?? "MISSING"} · total={page.totalItems ?? "MISSING"} · max/page={page.maxPageItems ?? "MISSING"} · rows={page.returnedRowCount} · first={page.firstRowFingerprint ?? "MISSING"} · last={page.lastRowFingerprint ?? "MISSING"} · overlap={page.overlapWithPreviousPage} · new={page.newIdsVsPreviousPage} · identical={page.identicalSetWithPreviousPage === undefined ? "N/A" : page.identicalSetWithPreviousPage ? "YES" : "NO"}
        </Text>)}
      </View>

      <View style={[styles.block, { borderColor: colors.border }]}>
        <Text style={[styles.strong, { color: colors.foreground }]}>FIELD INVENTORY · MAX 3 REAL ROWS</Text>
        {evidence.fieldInventory.map((field) => <Text key={field.field} style={{ color: colors.mutedForeground }}>
          {field.field}: {field.sensitive ? "SENSITIVE_REDACTED · " : ""}present={field.presentCount}/3 · nonEmpty={field.nonEmptyCount}/3 · types={field.primitiveTypes.join("|") || "none"}
        </Text>)}
      </View>

      <View style={[styles.block, { borderColor: colors.border }]}>
        <Text style={[styles.strong, { color: colors.foreground }]}>IMAGE / POSTER CANDIDATES</Text>
        {evidence.imageCandidates.length ? evidence.imageCandidates.map((field) => <Text key={field.field} style={{ color: colors.mutedForeground }}>
          {field.field}: present={field.presentCount}/3 · nonEmpty={field.nonEmptyCount}/3 · shape={field.valueShape}
        </Text>) : <Text style={{ color: colors.mutedForeground }}>POSTER_CANDIDATE_FIELD: NONE</Text>}
      </View>

      <View style={[styles.block, { borderColor: colors.border }]}>
        <Text style={[styles.strong, { color: colors.foreground }]}>USER-FACING METADATA</Text>
        {Object.entries(evidence.metadata).map(([field, value]) => <Text key={field} style={{ color: colors.mutedForeground }}>
          {field}: OBSERVED={value.observed ? "YES" : "NO"} · NON_EMPTY={value.nonEmpty ? "YES" : "NO"} · TYPE={value.types.join("|") || "none"}
        </Text>)}
        <Text style={{ color: colors.mutedForeground }}>other fields=[{evidence.otherUserFacingFields.join(", ") || "none"}]</Text>
      </View>

      <Text style={[styles.strong, { color: colors.foreground }]}>p=1 içinden bir Series seç · raw ID gösterilmez</Text>
      <View style={styles.list}>{evidence.detailCandidates.map((candidate) => <Pressable
        key={candidate.key}
        disabled={detailProbeStarted.current}
        onPress={() => setDetailKey(candidate.key)}
        style={[styles.row, { borderColor: detailKey === candidate.key ? colors.primary : colors.border }]}
      ><Text style={{ color: colors.foreground }}>{candidate.title} · fingerprint={candidate.key}</Text></Pressable>)}</View>
      <FocusButton label="RUN ONE DETAIL INSPECTION" disabled={busy || !detailKey || detailProbeStarted.current} onPress={() => void runDetail()} />
    </> : null}

    {detail ? <View style={[styles.block, { borderColor: colors.border }]}>
      <Text style={[styles.strong, { color: colors.foreground }]}>DETAIL EVIDENCE</Text>
      <Text style={{ color: colors.mutedForeground }}>request=series/get_ordered_list · movie_id=&lt;opaque exact id&gt; · p=1</Text>
      <Text style={{ color: colors.mutedForeground }}>DETAIL_SERIES_METADATA_FIELDS=[{detail.detailSeriesMetadataFields.join(", ") || "none"}]</Text>
      <Text style={{ color: colors.mutedForeground }}>DETAIL_SEASON_ROWS={detail.detailSeasonRows}</Text>
      <Text style={{ color: colors.mutedForeground }}>DETAIL_EMBEDDED_EPISODE_COUNTS=[{detail.detailEmbeddedEpisodeCounts.join(", ")}]</Text>
      <Text style={{ color: colors.mutedForeground }}>DETAIL_METADATA_SOURCE={detail.detailMetadataSource}</Text>
      <Text style={{ color: colors.mutedForeground }}>create_link=0 · player handoff=0 · playback=0 · fallback=0</Text>
    </View> : null}

    {error ? <Text style={{ color: colors.destructive }}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10, marginTop: 14 },
  title: { fontWeight: "900", fontSize: 16 },
  strong: { fontWeight: "800" },
  list: { gap: 6 },
  row: { borderWidth: 1, borderRadius: 10, padding: 10 },
  block: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 3 },
});
