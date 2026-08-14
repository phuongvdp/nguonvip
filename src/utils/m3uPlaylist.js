import {
  formatMatchTime,
  formatUpcomingBadge,
  getMatchTitle,
  getSourceKey,
  getSourceLabel,
  getSourceShortLabel,
  SOURCE_GROUP_ORDER
} from '@/src/utils/playerGet';

/**
 * Build an IPTV-style M3U playlist from live match + stream entries.
 * One stream source = one #EXTINF entry (matches demo format).
 * Entries are grouped by source (Xôi Lạc, Pháo Hoa, Gà Vàng...) — both via
 * a `# ===== <Nguồn> =====` comment header (visible when opened as text)
 * and the `group-title` attribute (used by players like VLC/TiviMate to
 * group channels visually).
 *
 * @param {Array<{ match: object, stream: object }>} entries
 * @returns {string}
 */
export function buildM3uPlaylist(entries = []) {
  const lines = ['#EXTM3U', ''];

  // Gom theo nguồn, giữ nguyên thứ tự (theo giờ) trong từng nhóm — entries
  // truyền vào đã được sort theo giờ từ trước.
  const buckets = new Map();
  for (const entry of entries) {
    const key = entry?.match?.source || 'custom';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  }
  const orderedKeys = [
    ...SOURCE_GROUP_ORDER.filter((k) => buckets.has(k)),
    ...[...buckets.keys()].filter((k) => !SOURCE_GROUP_ORDER.includes(k))
  ];

  for (const sourceKey of orderedKeys) {
    const groupEntries = buckets.get(sourceKey);
    const withUrl = groupEntries.filter((entry) => {
      const url = entry.stream?.playUrl || entry.stream?.m3u8Url || entry.stream?.flvUrl || '';
      return !!url;
    });
    if (!withUrl.length) continue;

    lines.push(`# ===== ${getSourceShortLabel(sourceKey)} (${withUrl.length} trận) =====`);

    for (const entry of withUrl) {
      const { match, stream } = entry;
      const url = stream?.playUrl || stream?.m3u8Url || stream?.flvUrl || '';

      const logo = match?.homeTeam?.logo || match?.competition?.logo || '';
      const group = getSourceLabel(match);
      const time = formatMatchTime(match);
      const title = getMatchTitle(match);
      const streamer = stream.streamerName || stream.name || 'Server';
      const fmt = entry.upcoming
        ? '[sắp diễn ra]'
        : (stream.format === 'flv' || /\.flv(\?|$)/i.test(url) ? '[flv]' : '[hls]');
      const nameParts = [time, title, `(${streamer})`, fmt].filter(Boolean);
      const displayName = nameParts.join(' ');

      const attrs = ['#EXTINF:-1'];
      if (logo) attrs.push(`tvg-logo="${logo}"`);
      attrs.push(`group-title="${group}"`);

      lines.push(`${attrs.join(' ')} , ${displayName}`);
      lines.push(url);
      lines.push('');
    }
  }

  return lines.join('\n').trim() + '\n';
}

/**
 * Flatten matches into playlist entries.
 * - Live match (has a resolved stream): one match → one stream (first m3u8
 *   only) to avoid duplicate channels.
 * - Upcoming match (next 24h, no stream yet): entry points at
 *   /api/playlist/resolve — the player looks up the real link only when it
 *   actually opens the channel (works whenever the source publishes it,
 *   before or after kickoff). Needs an absolute `baseUrl` since the .m3u
 *   file is opened by players on a different machine; skipped without one.
 */
export function matchesToPlaylistEntries(matches = [], { baseUrl = '' } = {}) {
  const entries = [];
  for (const match of matches) {
    const stream = (match.streams || []).find((s) => s?.m3u8Url);
    if (stream) {
      entries.push({ match, stream });
      continue;
    }

    // A live card without a stream is useful on the website while the source
    // is catching up, but it must not be emitted as an "upcoming" resolver.
    if (match?.status?.isLive) continue;

    if (!baseUrl) continue;

    const source = getSourceKey(match);
    const params = new URLSearchParams({
      source,
      matchId: match.matchId || '',
      url: match.stream?.liveUrl || '',
      sport: match.sport || 'football'
    });
    const resolverUrl = `${baseUrl}/api/playlist/resolve?${params.toString()}`;

    entries.push({
      match,
      upcoming: true,
      stream: {
        m3u8Url: resolverUrl,
        streamerName: formatUpcomingBadge(match)
      }
    });
  }
  return entries;
}
