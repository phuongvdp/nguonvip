import {
  formatKickoffTime,
  formatUpcomingBadge,
  getLiveBadge,
  getMatchTitle,
  getSourceKey,
  getSourceLabel,
  getSourceReferer,
  getSourceShortLabel,
  SOURCE_GROUP_ORDER,
  isFlvUrl,
  isM3u8Url,
  flvToM3u8Candidate,
  verifyStreamUrlPlayable
} from '@/src/utils/playerGet';

/**
 * FIX "nguồn Xôi Lạc: web xem được, app IPTV trên Android TV box không xem
 * được": trang web dùng flv.js (components/VideoPlayer.jsx) nên phát FLV
 * bình thường, nhưng hầu hết app IPTV trên TV box (TiviMate, GSE, Perfect
 * Player...) chạy engine ExoPlayer — KHÔNG hỗ trợ tốt FLV, chỉ chạy ổn với
 * HLS (.m3u8). File .m3u xuất ra cho các app này trước đây vẫn nhét thẳng
 * link .flv vào nên không phát được trên TV box dù link vẫn còn sống.
 *
 * flvToM3u8Candidate() (playerGet.js) đã có sẵn cách đoán "bản HLS song
 * song" của link FLV (nhiều CDN kiểu Xôi Lạc lộ cùng 1 stream ra cả 2 đuôi
 * .flv/.m3u8) nhưng trước đây không được dùng ở đâu cả. Hàm này thử xác
 * minh (HEAD ngắn, giống isUrlReachable trong xoilac.service.js) bản đoán
 * đó CÒN PHÁT ĐƯỢC THẬT hay không rồi mới ưu tiên dùng cho file .m3u —
 * không đoán suông, tránh đưa app IPTV vào 1 link .m3u8 chết. Không xác
 * minh được thì giữ nguyên FLV như cũ (web + VLC vẫn phát bình thường).
 */
export async function preferHlsForIptv(stream) {
  const url = stream?.playUrl || stream?.m3u8Url || stream?.flvUrl || '';
  const alreadyHls = isM3u8Url(url);
  if (alreadyHls || !isFlvUrl(url)) return stream;

  const candidate = flvToM3u8Candidate(url);
  if (!candidate) return stream;

  const ok = await verifyStreamUrlPlayable(candidate).catch(() => false);
  if (!ok) return stream;

  return { ...stream, playUrl: candidate, m3u8Url: candidate, format: 'hls' };
}

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
  // FIX "a.filter is not a function": nếu entries truyền vào không phải
  // mảng (lỗi upstream/cache bất thường), coi như rỗng thay vì ném lỗi.
  entries = Array.isArray(entries) ? entries : [];

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
    // LUÔN dùng ngày-giờ đá thật làm phần đầu tên kênh (không phải nhãn
    // LIVE/phút thi đấu) — bắt buộc để mọi app IPTV tự sort danh sách
    // kênh theo TÊN vẫn ra đúng thứ tự thời gian, bất kể trận đó đang
    // live hay chưa đá. Nhãn LIVE/phút thi đấu (nếu có) gắn thêm ngay
    // sau, dạng "[LIVE 18']", để vẫn thấy trận nào đang live mà không
    // phá thứ tự sort. (Trước đó dùng formatMatchTime() ở đây — hàm đó
    // trả "18'" thay cho ngày-giờ với trận live, làm app sort theo tên
    // bị đẩy lệch chỗ các trận live — đây là lỗi vừa fix.)
    const time = formatKickoffTime(match) || match?.timeFormatted || '';
    const liveBadge = getLiveBadge(match);
    const liveTag = liveBadge ? `[LIVE ${liveBadge}]` : '';
    const title = getMatchTitle(match);
    const streamer = stream.streamerName || stream.name || 'Server';
    const fmt = entry.upcoming
      ? '[sắp diễn ra]'
      : (stream.format === 'flv' || /\.flv(\?|$)/i.test(url) ? '[flv]' : '[hls]');
    const nameParts = [time, liveTag, title, `(${streamer})`, fmt].filter(Boolean);
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
    // FIX "resource unavailable": kèm Referer đúng nguồn (VLC/TiviMate/
    // Perfect Player đều hiểu #EXTVLCOPT:http-referrer) để CDN không chặn
    // request khi player mở thẳng link — xem chi tiết ở getSourceReferer().
    const referer = getSourceReferer(match);
    if (referer) lines.push(`#EXTVLCOPT:http-referrer=${referer}`);
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
export async function matchesToPlaylistEntries(matches = [], { baseUrl = '' } = {}) {
  const entries = [];
  const safeMatches = Array.isArray(matches) ? matches : [];
  for (const match of safeMatches) {
    // BUG FIX: trước đây chỉ tìm stream có m3u8Url — nhiều nguồn (xoilac,
    // ninety, customSource, xoilacAffcup, crawler...) khi ưu tiên chọn kênh
    // FLV (cert hợp lệ hơn) chỉ trả về flvUrl, m3u8Url rỗng. Kết quả: trận
    // đang live hiển thị trên web (có link FLV) nhưng bị loại hoàn toàn
    // khỏi playlist vì .find(s => s?.m3u8Url) không khớp. Giờ chấp nhận
    // bất kỳ dạng URL nào đã resolve được (m3u8 / flv / playUrl chung).
    const matchStreams = Array.isArray(match?.streams) ? match.streams : [];
    const stream = matchStreams.find((s) => s?.m3u8Url || s?.flvUrl || s?.playUrl);
    if (stream) {
      entries.push({ match, stream: await preferHlsForIptv(stream) });
      continue;
    }

    // FIX "mất trận đang live khỏi playlist": bản cũ loại HẲN (continue,
    // không có gì thay thế) trận Gà Vàng/Xôi Lạc đang live mà bước resolve
    // lúc build cache (resolveStreams(), timeout 4.5s) chưa ra link — với
    // lý do "nhiều khả năng link chết thật". Nhưng phần lớn trường hợp chỉ
    // là lỗi TẠM THỜI (mạng chậm, CDN chập chờn, trang chi tiết đổi giao
    // diện...), trong khi trận vẫn đang live và link vẫn sẽ có. Loại hẳn
    // khiến trận biến mất khỏi playlist tới tận lần refresh cache sau
    // (15 phút) dù đang live thật.
    //
    // Từ giờ mọi nguồn (kể cả gavang/xoilac) đều thống nhất 1 cách xử lý:
    // trận live chưa có stream sẵn -> vẫn đưa vào playlist, trỏ tới
    // /api/playlist/resolve (route này TỰ RETRY riêng cho gavang/xoilac —
    // xem pages/api/playlist/resolve.js — nên khả năng ra link cao hơn cả
    // lần thử lúc build cache). Chỉ khi người xem thực sự bấm vào mà
    // resolver cũng không ra link (link chết thật) thì mới báo lỗi ở đó,
    // thay vì lặng lẽ giấu cả trận đi từ trước.
    const source = getSourceKey(match);
    const isLiveNoStream = !!match?.status?.isLive;

    if (!baseUrl) continue;
    const params = new URLSearchParams({
      source,
      matchId: match.matchId || '',
      url: match.stream?.liveUrl || '',
      sport: match.sport || 'football'
    });
    const resolverUrl = `${baseUrl}/api/playlist/resolve?${params.toString()}`;

    entries.push({
      match,
      // Chỉ gắn nhãn "sắp diễn ra" cho trận thật sự chưa đá — trận đang
      // live mà rơi vào nhánh này chỉ là do stream chưa kịp resolve sẵn,
      // không phải chưa bắt đầu, nên không gắn cờ `upcoming`.
      upcoming: !isLiveNoStream,
      stream: {
        m3u8Url: resolverUrl,
        streamerName: isLiveNoStream ? 'Đang tải link...' : formatUpcomingBadge(match)
      }
    });
  }
  return entries;
}
