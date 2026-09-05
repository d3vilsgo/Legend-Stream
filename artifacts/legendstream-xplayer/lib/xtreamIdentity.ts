const sanitizeIdPart = (value: string) => value.replace(/[^a-zA-Z0-9:_-]/g, "-");

export function stableXtreamLiveId(providerId: string, streamId: string | number) {
  return sanitizeIdPart(`${providerId}:xtream-live:${String(streamId)}`);
}

export function legacyXtreamLiveStreamId(channelId: string) {
  const match = channelId.match(/^[^:]+:\d+:(.+)$/);
  return match?.[1] || null;
}
