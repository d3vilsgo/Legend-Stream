import { safeLog } from "./safeLog";
import type { CatalogKind, PersistedCatalogItem } from "./catalogPersistence";

export type InstrumentedXtreamKind = Extract<CatalogKind, "live" | "vod">;

type CollisionSample = {
  sourceStreamIdFingerprint: string;
  finalItemIdFingerprint: string;
  playbackRefType: string;
  streamIdSource: "provider-stream-id" | "parsed-playback-ref" | "fallback-index" | "unresolved";
};

type CardinalityAttempt = {
  stagingId: string;
  kind: InstrumentedXtreamKind;
  rawRows: number | null;
  rawUniqueStreamIds: number | null;
  projectedRows: number | null;
  finalUniqueItemIds: number | null;
  finalIdCollisionCount: number | null;
  vodUniqueIds: number | null;
  stagedCount: number | null;
  publishCalled: boolean;
  publishSucceeded: boolean;
  activeCount: number | null;
  collisionSamples: CollisionSample[];
};

const attempts = new Map<string, CardinalityAttempt>();
const latestAttemptByKind = new Map<InstrumentedXtreamKind, string>();

function instrumentedKind(kind: CatalogKind): InstrumentedXtreamKind | null {
  return kind === "live" || kind === "vod" ? kind : null;
}

function fingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function rawObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function liveSourceIdentity(value: unknown, index: number): {
  streamId: string | null;
  source: CollisionSample["streamIdSource"];
} {
  const raw = rawObject(value);
  if (!raw) return { streamId: null, source: "unresolved" };

  const playbackRef = rawObject(raw.playbackRef);
  if (playbackRef?.type === "xtream-live" && typeof playbackRef.streamId === "string" && playbackRef.streamId) {
    return { streamId: playbackRef.streamId, source: "parsed-playback-ref" };
  }

  if (typeof raw.id !== "string") return { streamId: null, source: "unresolved" };
  const match = raw.id.match(/^[^:]+:(\d+):(.+)$/);
  if (!match) return { streamId: null, source: "unresolved" };

  if (Number(match[1]) === index && match[2] === String(index)) {
    return { streamId: null, source: "fallback-index" };
  }
  return { streamId: match[2], source: "provider-stream-id" };
}

function finalLiveId(item: PersistedCatalogItem) {
  return item.catalogKind === "live" ? item.id : null;
}

function playbackRefType(item: PersistedCatalogItem) {
  return item.catalogKind === "live" ? item.playbackRef.type : "unresolved";
}

function field(name: string, value: unknown): [string, unknown] {
  return [name, value];
}

function collisionFields(sample: CollisionSample) {
  return [
    field("sourceStreamIdFingerprint", sample.sourceStreamIdFingerprint),
    field("finalItemIdFingerprint", sample.finalItemIdFingerprint),
    field("playbackRefType", sample.playbackRefType),
    field("streamIdSource", sample.streamIdSource),
  ];
}

function emitAndDelete(attempt: CardinalityAttempt) {
  if (attempt.kind === "live") {
    safeLog.info("LS_XTREAM_CARDINALITY_LIVE", [
      field("rawRows", attempt.rawRows),
      field("rawUniqueStreamIds", attempt.rawUniqueStreamIds),
      field("projectedRows", attempt.projectedRows),
      field("finalUniqueItemIds", attempt.finalUniqueItemIds),
      field("finalIdCollisionCount", attempt.finalIdCollisionCount),
      field("stagedCount", attempt.stagedCount),
      field("activeCount", attempt.activeCount),
    ]);
    if ((attempt.finalIdCollisionCount ?? 0) > 0 && attempt.collisionSamples.length > 0) {
      safeLog.info("LS_XTREAM_CARDINALITY_LIVE_COLLISIONS", [
        field("collisionCount", attempt.finalIdCollisionCount),
        field("samples", attempt.collisionSamples.slice(0, 5).map(collisionFields)),
      ]);
    }
  } else {
    safeLog.info("LS_XTREAM_CARDINALITY_VOD", [
      field("rawRows", attempt.rawRows),
      field("projectedRows", attempt.projectedRows),
      field("vodUniqueIds", attempt.vodUniqueIds),
      field("stagedCount", attempt.stagedCount),
      field("publishCalled", attempt.publishCalled),
      field("publishSucceeded", attempt.publishSucceeded),
      field("activeCount", attempt.activeCount),
    ]);
  }

  attempts.delete(attempt.stagingId);
  if (latestAttemptByKind.get(attempt.kind) === attempt.stagingId) {
    latestAttemptByKind.delete(attempt.kind);
  }
}

export function beginXtreamCardinalityAttempt(stagingId: string, kind: CatalogKind) {
  const observedKind = instrumentedKind(kind);
  if (!observedKind) return;
  const attempt: CardinalityAttempt = {
    stagingId,
    kind: observedKind,
    rawRows: null,
    rawUniqueStreamIds: null,
    projectedRows: null,
    finalUniqueItemIds: null,
    finalIdCollisionCount: null,
    vodUniqueIds: null,
    stagedCount: null,
    publishCalled: false,
    publishSucceeded: false,
    activeCount: null,
    collisionSamples: [],
  };
  attempts.set(stagingId, attempt);
  latestAttemptByKind.set(observedKind, stagingId);
}

export function observeXtreamCardinalityProjection(
  stagingId: string,
  kind: CatalogKind,
  values: readonly unknown[],
  projected: readonly PersistedCatalogItem[],
) {
  const observedKind = instrumentedKind(kind);
  if (!observedKind) return;
  const attempt = attempts.get(stagingId);
  if (!attempt || attempt.kind !== observedKind) return;

  attempt.rawRows = values.length;
  attempt.projectedRows = projected.length;

  if (observedKind === "vod") {
    attempt.vodUniqueIds = new Set(
      projected.flatMap((item) => item.catalogKind === "vod" ? [String(item.stream_id)] : []),
    ).size;
    return;
  }

  const rawIdentities = values.map(liveSourceIdentity);
  const rawUnique = new Set(
    rawIdentities.flatMap((identity) => identity.streamId === null ? [] : [identity.streamId]),
  );
  const finalIds = new Set(
    projected.flatMap((item) => {
      const id = finalLiveId(item);
      return id === null ? [] : [id];
    }),
  );
  attempt.rawUniqueStreamIds = rawUnique.size;
  attempt.finalUniqueItemIds = finalIds.size;
  attempt.finalIdCollisionCount = Math.max(0, rawUnique.size - finalIds.size);

  if (attempt.finalIdCollisionCount <= 0 || projected.length !== values.length) return;
  const byFinalId = new Map<string, {
    sourceIds: Set<string>;
    streamIdSource: CollisionSample["streamIdSource"];
    playbackRefType: string;
  }>();
  for (let index = 0; index < projected.length; index += 1) {
    const finalId = finalLiveId(projected[index]);
    const source = rawIdentities[index];
    if (!finalId || !source.streamId) continue;
    const current = byFinalId.get(finalId) ?? {
      sourceIds: new Set<string>(),
      streamIdSource: source.source,
      playbackRefType: playbackRefType(projected[index]),
    };
    current.sourceIds.add(source.streamId);
    byFinalId.set(finalId, current);
  }
  for (const [finalId, collision] of byFinalId) {
    if (collision.sourceIds.size < 2) continue;
    attempt.collisionSamples.push({
      sourceStreamIdFingerprint: fingerprint([...collision.sourceIds].sort().join("\u0000")),
      finalItemIdFingerprint: fingerprint(finalId),
      playbackRefType: collision.playbackRefType,
      streamIdSource: collision.streamIdSource,
    });
    if (attempt.collisionSamples.length >= 5) break;
  }
}

export function noteXtreamCardinalityPublishCalled(stagingId: string, kind: CatalogKind) {
  const observedKind = instrumentedKind(kind);
  if (!observedKind) return;
  const attempt = attempts.get(stagingId);
  if (attempt?.kind === observedKind) attempt.publishCalled = true;
}

export function noteXtreamCardinalityStagedCount(stagingId: string, kind: CatalogKind, stagedCount: number) {
  const observedKind = instrumentedKind(kind);
  if (!observedKind) return;
  const attempt = attempts.get(stagingId);
  if (attempt?.kind === observedKind) attempt.stagedCount = stagedCount;
}

export function finishXtreamCardinalityPublish(
  stagingId: string,
  kind: CatalogKind,
  published: boolean,
  activeCount: number | null,
) {
  const observedKind = instrumentedKind(kind);
  if (!observedKind) return;
  const attempt = attempts.get(stagingId);
  if (!attempt || attempt.kind !== observedKind) return;
  attempt.publishSucceeded = published;
  attempt.activeCount = published ? activeCount : null;
  emitAndDelete(attempt);
}

export function finishUnpublishedXtreamCardinalityAttempt(kind: CatalogKind) {
  const observedKind = instrumentedKind(kind);
  if (!observedKind) return;
  const stagingId = latestAttemptByKind.get(observedKind);
  if (!stagingId) return;
  const attempt = attempts.get(stagingId);
  if (attempt) emitAndDelete(attempt);
}
