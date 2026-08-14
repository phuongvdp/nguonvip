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

  // QUAN TRỌNG: KHÔNG được gom vật lý theo nguồn (nhóm hết Xôi Lạc, rồi
  // hết Pháo Hoa, rồi hết Gà Vàng...) như bản cũ — làm vậy phá vỡ thứ tự
  // thời gian tổng thể giữa các nguồn, vì các nhóm được in ra theo thứ tự
  // CỐ ĐỊNH của SOURCE_GROUP_ORDER chứ không theo giờ thi đấu thực. Hậu
  // quả: 1 trận 0h ngày hôm sau của nguồn đứng trước trong danh sách vẫn
  // bị in ra TRƯỚC 1 trận 18h ngày hôm trước của nguồn đứng sau, dù trận
  // sau mới là trận đá trước. `entries` truyền vào đây đã được sort đúng
  // theo giờ thi đấu thực (matchTimeTimestamp) từ playlistBuilder.service.js
  // — chỉ cần giữ NGUYÊN thứ tự đó khi in ra. Việc gom nhóm theo nguồn cho
  // người xem vẫn được giữ nhờ thuộc tính `group-title` trên từng dòng
  // #EXTINF — VLC/TiviMate/hầu hết player IPTV tự nhóm kênh theo
  // group-title mà không cần các dòng nằm liền kề nhau trong file.
  const withUrl = entries.filter((entry) => {
    const url = entry.stream?.playUrl || entry.stream?.m3u8Url || entry.stream?.flvUrl || '';
    return !!url;
  });

  if (!withUrl.length) return lines.join('\n').trim() + '\n';

  // Dòng thống kê đầu file (giữ lại thông tin "mỗi nguồn bao nhiêu trận"
  // như bản cũ) — chỉ để tham khảo, KHÔNG dùng để sắp xếp lại danh sách.
  const countBySource = new Map();
  for (const entry of withUrl) {
    const key = entry?.match?.source || 'custom';
    countBySource.set(key, (countBySource.get(key) || 0) + 1);
  }
  const orderedKeys = [
    ...SOURCE_GROUP_ORDER.filter((k) => countBySource.has(k)),
    ...[...countBySource.keys()].filter((k) => !SOURCE_GROUP_ORDER.includes(k))
  ];
  const summary = orderedKeys.map((k) => `${getSourceShortLabel(k)} (${countBySource.get(k)} trận)`).join(', ');
  lines.push(`# ===== Tất cả trận, sắp theo giờ thi đấu thực — ${summary} =====`);
  lines.push('');

  let lastDateStr = '';
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

    // Dòng phân cách khi sang ngày mới (giờ Việt Nam) — chỉ để dễ đọc
    // bằng mắt khi mở file .m3u dạng text, không ảnh hưởng player parse.
    const dateStr = match?.dateStr || '';
    if (dateStr && dateStr !== lastDateStr) {
      lines.push(`# ----- Ngày ${dateStr} -----`);
      lastDateStr = dateStr;
    }

    const attrs = ['#EXTINF:-1'];
    if (logo) attrs.push(`tvg-logo="${logo}"`);
    attrs.push(`group-title="${group}"`);

    lines.push(`${attrs.join(' ')} , ${displayName}`);
    lines.push(url);
    lines.push('');
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
