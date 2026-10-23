import { EliteV4FavoriteAction } from "./EliteV4FavoriteAction";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePlayer, type ProviderConfig } from "@/context/PlayerContext";
import { useCatalogSync } from "@/context/CatalogSyncContext";
import { useCatalogPage } from "@/hooks/useCatalogPage";
import { usePagedSeriesInfo } from "@/hooks/usePagedSeriesInfo";
import { getCachedCatalogCategories } from "@/lib/catalogPageRepository";
import type { CatalogPageSort } from "@/lib/catalogPaging";
import { SeriesInfoModal } from "@/components/series/SeriesInfoModal";
import { pagedSeriesDetail, stalkerSeriesDetail } from "@/lib/seriesInfo";
import {
  v4PagedSeries,
  v4StalkerSeries,
  type V4Series,
} from "@/lib/eliteV4Series";
import type { MediaPlaybackRef } from "@/lib/mediaProgress";
import {
  readCurrentStalkerProductSession,
  isCurrentStalkerProductSession,
} from "@/lib/stalkerProductSession";
import { subscribeStalkerPortalRuntime } from "@/lib/stalkerPortalRuntime";
import {
  createStalkerSeriesProductController,
  findStalkerSeriesGlobalCategory,
  mergeStalkerSeriesItems,
  searchStalkerSeriesCatalog,
  sortStalkerSeriesItems,
  buildStalkerSeriesPlayableIntent,
  type StalkerSeriesProductCategory,
  type StalkerSeriesProductItem,
  type StalkerSeriesProductDetail,
  type StalkerSeriesProductController,
} from "@/lib/stalkerSeriesProduct";
import {
  EliteV4MoviesView,
  EliteV4MoviesUnavailable,
} from "./EliteV4MoviesCatalog";

export type V4SeriesPlayable = {
  providerId: string;
  url: string;
  title: string;
  subtitle: string;
  progressRef: MediaPlaybackRef;
  episodeContext?: {
    seriesId: string;
    seasonId: string;
    episodeNumber?: number;
  };
};
type Props = {
  active?: boolean;
  onBack: () => void;
  onPlayable: (value: V4SeriesPlayable) => void;
};
type DetailProps = Props & {
  provider: ProviderConfig;
  item: V4Series;
  close: () => void;
};
export function EliteV4PagedSeriesDetail({
  provider,
  item,
  close,
  active = true,
  onPlayable,
}: DetailProps) {
  const latest = useRef({ active, item });
  latest.current = { active, item };
  const flow = usePagedSeriesInfo({
    provider,
    enabled: true,
    playing: !active,
    onPlayable: (value) => {
      if (latest.current.active && latest.current.item === item)
        onPlayable({ ...value, providerId: provider.id });
    },
  });
  useEffect(() => {
    if (item.source.kind === "paged") flow.open(item.source.item, "series");
  }, [item.id, provider]);
  const detail =
    flow.model ||
    (item.source.kind === "paged"
      ? pagedSeriesDetail(
          provider.id,
          provider.type as "xtream" | "m3u",
          item.source.item,
          null,
        )
      : null);
  if (!detail) return null;
  return (
    <SeriesInfoModal
      favoriteAction={
        <EliteV4FavoriteAction
          target={{
            providerId: provider.id,
            kind: "series",
            catalogId: item.id,
            title: item.title,
          }}
          focusId="v4-series-info-favorite"
          scope="series-info"
        />
      }
      variant="eliteV4"
      metadataInput={item.input}
      providerId={provider.id}
      detail={detail}
      loading={flow.state?.loading ?? true}
      error={flow.state?.error}
      busy={flow.state?.busy}
      visible={active}
      onClose={() => {
        flow.close();
        close();
      }}
      onRetry={flow.retry}
      onEpisode={flow.play}
    />
  );
}
function PagedSeries({
  provider,
  ...props
}: Props & { provider: ProviderConfig }) {
  const { snapshot, lastSuccessfulAt } = useCatalogSync();
  const [category, setCategory] = useState("__all__"),
    [search, setSearch] = useState("");
  const [sort, setSort] = useState<CatalogPageSort>("default");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const revision = lastSuccessfulAt ?? 0;
  const scope = JSON.stringify([
    provider.id,
    provider.type,
    revision,
    category,
    search,
    sort,
  ]);
  const page = useCatalogPage({
    provider,
    providerType: provider.type as "xtream" | "m3u",
    kind: "series",
    categoryId: category,
    search,
    sort,
    enabled: true,
    catalogRevision: revision,
    snapshotCount:
      snapshot.providerId === provider.id &&
      category === "__all__" &&
      !search.trim()
        ? { totalCount: snapshot.counts.series, countKnown: snapshot.ready }
        : undefined,
  });
  useEffect(() => {
    let alive = true;
    void getCachedCatalogCategories(
      provider.id,
      "series",
      provider.type === "m3u",
    )
      .then((rows) => {
        if (alive)
          setCategories(
            rows.map((row) => ({
              id: String(row.category_id),
              name: row.category_name,
            })),
          );
      })
      .catch(() => {
        if (alive) setCategories([]);
      });
    return () => {
      alive = false;
    };
  }, [provider.id, revision]);
  return (
    <EliteV4MoviesView
      series
      favoritesEnabled
      {...props}
      scope={scope}
      items={v4PagedSeries(
        provider.id,
        provider.type as "xtream" | "m3u",
        String(revision),
        page.items,
      )}
      categories={[
        { id: "__all__", name: "Tümü" },
        ...categories.filter((c) => c.id !== "__all__"),
      ]}
      category={category}
      onCategory={setCategory}
      search={search}
      onSearch={setSearch}
      sort={sort}
      onSort={setSort}
      supportsAdded={provider.type === "xtream"}
      loading={page.loadingInitial}
      loadingMore={page.loadingMore}
      hasMore={page.hasMore}
      error={!!page.error}
      count={page.countKnown ? page.totalCount : null}
      onMore={page.loadMore}
      onReload={page.reload}
      onPlay={() => undefined}
      renderInfo={(item, _origin, close) => (
        <EliteV4PagedSeriesDetail
          key={`${scope}:${item.id}`}
          {...props}
          provider={provider}
          item={item}
          close={close}
        />
      )}
    />
  );
}

export function EliteV4StalkerSeriesDetail({
  provider,
  item,
  controller,
  close,
  active = true,
  onPlayable,
}: DetailProps & { controller: StalkerSeriesProductController }) {
  const [detail, setDetail] = useState<StalkerSeriesProductDetail | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const epoch = useRef(0),
    abort = useRef<AbortController | null>(null),
    lock = useRef(false),
    latest = useRef({ active, item });
  latest.current = { active, item };
  const session = useMemo(
    () => readCurrentStalkerProductSession({ ...provider, type: "stalker" }),
    [provider],
  );
  const current = (ticket: number) =>
    epoch.current === ticket &&
    latest.current.item.id === item.id &&
    isCurrentStalkerProductSession(
      { ...provider, type: "stalker" },
      session.session,
    );
  useEffect(() => {
    if (active) lock.current = false;
  }, [active]);
  useEffect(() => {
    const ticket = ++epoch.current,
      request = new AbortController();
    abort.current?.abort();
    abort.current = request;
    setDetail(null);
    setLoading(true);
    setError(null);
    lock.current = false;
    if (item.source.kind === "stalker")
      void controller
        .loadDetail(item.source.item, request.signal)
        .then((value) => {
          if (current(ticket) && !request.signal.aborted) setDetail(value);
        })
        .catch(() => {
          if (current(ticket) && !request.signal.aborted)
            setError("Portal dizi hiyerarşisini sunamadı. Yeniden deneyin.");
        })
        .finally(() => {
          if (current(ticket) && !request.signal.aborted) setLoading(false);
        });
    return () => {
      ++epoch.current;
      request.abort();
      controller.clear();
    };
  }, [controller, item.id, revision]);
  const play = async (seasonId: string, episodeId: string) => {
    if (
      !latest.current.active ||
      !current(epoch.current) ||
      lock.current ||
      !detail ||
      loading ||
      !detail.seasons.some(
        (s) => s.id === seasonId && s.episodes.some((e) => e.id === episodeId),
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const ticket = ++epoch.current,
      request = new AbortController();
    abort.current?.abort();
    abort.current = request;
    try {
      const url = await controller.resolveEpisode(
        detail.seriesId,
        seasonId,
        episodeId,
        request.signal,
      );
      if (!current(ticket) || request.signal.aborted || !latest.current.active)
        return;
      const intent = buildStalkerSeriesPlayableIntent(
        provider.id,
        detail,
        seasonId,
        episodeId,
        url,
      );
      onPlayable({
        providerId: provider.id,
        url: intent.url,
        title: intent.title,
        subtitle: intent.subtitle,
        episodeContext: {
          seriesId: detail.seriesId,
          seasonId,
          episodeNumber: detail.seasons
            .find((s) => s.id === seasonId)
            ?.episodes.find((e) => e.id === episodeId)?.episodeNumber,
        },
        progressRef: {
          type: "stalker-episode",
          seriesId: detail.seriesId,
          seasonId,
          episodeId,
        },
      });
    } catch {
      if (current(ticket) && !request.signal.aborted) {
        lock.current = false;
        setError("Portal bölüm bağlantısını açamadı. Tekrar deneyin.");
      }
    } finally {
      if (current(ticket)) setBusy(false);
    }
  };
  if (item.source.kind !== "stalker") return null;
  return (
    <SeriesInfoModal
      favoriteAction={
        <EliteV4FavoriteAction
          target={{
            providerId: provider.id,
            kind: "series",
            catalogId: item.id,
            title: item.title,
          }}
          focusId="v4-series-info-favorite"
          scope="series-info"
        />
      }
      variant="eliteV4"
      metadataInput={item.input}
      providerId={provider.id}
      detail={stalkerSeriesDetail(
        provider.id,
        session.providerScopeId,
        item.source.item,
        detail,
      )}
      loading={loading}
      busy={busy}
      error={
        error ||
        (detail?.hierarchyTruncated
          ? "Portal hiyerarşisi sınırlandırıldı; yalnız doğrulanmış bölümler gösteriliyor."
          : null)
      }
      visible={active}
      onClose={() => {
        ++epoch.current;
        abort.current?.abort();
        close();
      }}
      onRetry={() => {
        setBusy(false);
        setRevision((v) => v + 1);
      }}
      onEpisode={(season, episode) => void play(season, episode)}
    />
  );
}

export function EliteV4StalkerSeries({
  provider,
  ...props
}: Props & { provider: ProviderConfig }) {
  const [sessionRevision, setSessionRevision] = useState(0);
  const session = useMemo(
    () => readCurrentStalkerProductSession({ ...provider, type: "stalker" }),
    [provider, sessionRevision],
  );
  const controller = useMemo(
    () => createStalkerSeriesProductController(session.session, provider.id),
    [session.session, provider.id],
  );
  const [categories, setCategories] = useState<StalkerSeriesProductCategory[]>(
      [],
    ),
    [category, setCategory] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState<CatalogPageSort>("default");
  const [items, setItems] = useState<StalkerSeriesProductItem[]>([]),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [count, setCount] = useState<number | null>(null),
    [revision, setRevision] = useState(0);
  const epoch = useRef(0),
    abort = useRef<AbortController | null>(null),
    page = useRef(1),
    inFlight = useRef(false),
    categoryEpoch = useRef(0);
  const valid = (ticket: number) =>
    epoch.current === ticket &&
    isCurrentStalkerProductSession(
      { ...provider, type: "stalker" },
      session.session,
    );
  useEffect(
    () =>
      subscribeStalkerPortalRuntime((id) => {
        if (id === provider.id) {
          ++epoch.current;
          abort.current?.abort();
          setSessionRevision((v) => v + 1);
        }
      }),
    [provider.id],
  );
  useEffect(() => {
    const request = new AbortController(),
      ticket = ++categoryEpoch.current;
    setCategories([]);
    setCategory(null);
    setItems([]);
    setLoading(true);
    setError(false);
    void controller
      .loadCategories(request.signal)
      .then((rows) => {
        if (
          !(
            categoryEpoch.current === ticket &&
            isCurrentStalkerProductSession(
              { ...provider, type: "stalker" },
              session.session,
            )
          ) ||
          request.signal.aborted
        )
          return;
        setCategories(rows);
        setCategory(
          (findStalkerSeriesGlobalCategory(rows) ?? rows[0])?.id ?? null,
        );
        setLoading(false);
      })
      .catch(() => {
        if (
          categoryEpoch.current === ticket &&
          isCurrentStalkerProductSession(
            { ...provider, type: "stalker" },
            session.session,
          ) &&
          !request.signal.aborted
        ) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      ++categoryEpoch.current;
      ++epoch.current;
      request.abort();
      abort.current?.abort();
      controller.clear();
    };
  }, [controller, revision]);
  const load = async (append = false) => {
    const selected = categories.find((c) => c.id === category);
    if (!selected || (append && inFlight.current)) return;
    abort.current?.abort();
    const request = new AbortController();
    abort.current = request;
    const ticket = ++epoch.current;
    inFlight.current = true;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setLoadingMore(false);
      setItems([]);
      setHasMore(false);
      setCount(null);
      page.current = 1;
    }
    setError(false);
    try {
      if (search.trim()) {
        const rows = await searchStalkerSeriesCatalog(
          controller,
          categories,
          search.trim(),
          request.signal,
          selected.id,
        );
        if (!valid(ticket) || request.signal.aborted) return;
        setItems(rows);
        setCount(rows.length);
        setHasMore(false);
      } else {
        const next = await controller.loadPage(
          selected,
          append ? page.current + 1 : 1,
          request.signal,
        );
        if (!valid(ticket) || request.signal.aborted) return;
        setItems((previous) =>
          append ? mergeStalkerSeriesItems(previous, next.items) : next.items,
        );
        page.current = next.currentPage;
        setHasMore(next.hasNextPage);
        setCount(next.totalItems ?? null);
      }
    } catch {
      if (valid(ticket) && !request.signal.aborted) setError(true);
    } finally {
      if (valid(ticket) && !request.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
        inFlight.current = false;
      }
    }
  };
  useEffect(() => {
    if (!category) return;
    const timer = setTimeout(() => void load(), search.trim() ? 300 : 0);
    return () => {
      clearTimeout(timer);
      ++epoch.current;
      abort.current?.abort();
      inFlight.current = false;
    };
  }, [controller, category, search, revision]);
  const scope = JSON.stringify([
    provider.id,
    session.providerScopeId,
    category,
    search,
    sort,
    revision,
  ]);
  return (
    <EliteV4MoviesView
      series
      favoritesEnabled
      {...props}
      scope={scope}
      items={v4StalkerSeries(
        provider.id,
        session.providerScopeId,
        sortStalkerSeriesItems(items, sort === "added" ? "default" : sort),
      )}
      categories={categories.map((c) => ({ id: c.id, name: c.title }))}
      category={category}
      onCategory={setCategory}
      search={search}
      onSearch={setSearch}
      sort={sort}
      onSort={setSort}
      partialSort
      loading={loading}
      loadingMore={loadingMore}
      hasMore={hasMore}
      error={error}
      count={count}
      onMore={() => void load(true)}
      onReload={() => setRevision((v) => v + 1)}
      onPlay={() => undefined}
      renderInfo={(item, _origin, close) => (
        <EliteV4StalkerSeriesDetail
          key={`${scope}:${item.id}`}
          {...props}
          provider={provider}
          item={item}
          controller={controller}
          close={close}
        />
      )}
    />
  );
}
class SeriesBoundary extends React.Component<
  React.PropsWithChildren<Props>,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <EliteV4MoviesUnavailable
        series
        {...this.props}
        message="Dizi sağlayıcı oturumu açılamadı. Sağlayıcı bağlantısını kontrol edin."
      />
    ) : (
      this.props.children
    );
  }
}
export function EliteV4SeriesCatalog(props: Props) {
  const { provider } = usePlayer();
  if (!provider) return null;
  return (
    <SeriesBoundary key={provider.id} {...props}>
      {provider.type === "stalker" ? (
        <EliteV4StalkerSeries provider={provider} {...props} />
      ) : provider.type === "xtream" || provider.type === "m3u" ? (
        <PagedSeries provider={provider} {...props} />
      ) : (
        <EliteV4MoviesUnavailable
          series
          {...props}
          message="Bu sağlayıcı dizi kataloğu sunmuyor."
        />
      )}
    </SeriesBoundary>
  );
}
