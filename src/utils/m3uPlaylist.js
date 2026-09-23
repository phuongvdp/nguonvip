import {
  formatKickoffTime,
  formatUpcomingBadge,
  getLiveBadge,
  getMatchTitle,
  getSourceKey,
  getSourceLabel,
  getSourceShortLabel,
  SOURCE_GROUP_ORDER,
  isFlvUrl,
  isM3u8Url,
  flvToM3u8Candidate,
  verifyStreamUrlPlayable,
  mapPool
} from '@/src/utils/playerGet';

// FIX (23/09/2026 — "nguồn Chuối Chiến trong all.m3u add trên app IPTV
// không xem được, dù link .m3u8 y hệt trên web vẫn phát bình thường"):
// CDN của Chuối Chiến (edgemaxcdn.org) — và tương tự các nguồn khác dùng
// CDN riêng — chặn hotlink theo Referer (xem REFERER_CANDIDATES_BY_SOURCE
// trong pages/api/proxy/hls.js, đã tự dò và xác nhận cần đúng Referer mới
// cho phát). Trang web tự gửi đúng Referer của chính nó nên phát được;
// nhưng app IPTV (VLC/TiviMate/Perfect Player/...) mở THẲNG link trong file
// .m3u tĩnh này thì KHÔNG gửi Referer nào — bị CDN từ chối. File .m3u này
// chạy hoàn toàn tĩnh trên GitHub (không có server để bọc qua
// /api/proxy/hls như bên web), nên phải nhúng Referer/User-Agent NGAY
// TRONG file .m3u bằng cú pháp #EXTVLCOPT — được VLC/TiviMate/Perfect
// Player/IPTV Smarters/... hỗ trợ sẵn để tự đính kèm header khi phát, không
// cần proxy. Referer dùng đúng domain "trang phụ" nơi player thật chạy của
// từng nguồn (khớp REFERER_BY_SOURCE trong pages/api/proxy/hls.js) — không
// đoán thêm domain khác ở đây để tránh lệch giữa 2 nơi.
const IPTV_HEADER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER_BY_SOURCE_FOR_IPTV = {
  chuoichientv: 'https://live05.chuoichientv.me/',
  giovang: process.env.GIOVANG_DOMAIN || 'https://giovang.city',
  khandaitv: process.env.KHANDAITV_DOMAIN || process.env.KHANDAITV_BASE_URL || 'https://khandai3.link',
  phalang: 'https://phalang.live'
};

/**
 * Thử nâng 1 link FLV lên bản HLS song song (nhiều CDN lộ cùng 1 stream ra
 * cả 2 đuôi .flv/.m3u8) — xác minh (HEAD ngắn) bản đoán đó CÒN PHÁT ĐƯỢC
 * THẬT hay không rồi mới ưu tiên dùng, không đoán suông. Không xác minh
 * được thì giữ nguyên FLV như cũ.
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
 * One stream source = one #EXTINF entry.
 * Entries are grouped by source (Pháo Hoa, Giờ Vàng) — both via a
 * `# ===== <Nguồn> =====` comment header (visible when opened as text) and
 * the `group-title` attribute (used by players like VLC/TiviMate to group
 * channels visually).
 *
 * @param {Array<{ match: object, stream: object }>} entries
 * @returns {string}
 */
export function buildM3uPlaylist(entries = []) {
  const lines = ['#EXTM3U', ''];
  entries = Array.isArray(entries) ? entries : [];

  // QUAN TRỌNG: KHÔNG được gom vật lý theo nguồn (nhóm hết Pháo Hoa, rồi
  // hết Giờ Vàng...) — làm vậy phá vỡ thứ tự thời gian tổng thể giữa các
  // nguồn. `entries` truyền vào đây đã được sort đúng theo giờ thi đấu
  // thực (matchTimeTimestamp) từ playlistBuilder.service.js — chỉ cần giữ
  // NGUYÊN thứ tự đó khi in ra. Việc gom nhóm theo nguồn cho người xem vẫn
  // được giữ nhờ thuộc tính `group-title` trên từng dòng #EXTINF —
  // VLC/TiviMate/hầu hết player IPTV tự nhóm kênh theo group-title mà
  // không cần các dòng nằm liền kề nhau trong file.
  const withUrl = entries.filter((entry) => {
    const url = entry.stream?.playUrl || entry.stream?.m3u8Url || entry.stream?.flvUrl || '';
    return !!url;
  });

  if (!withUrl.length) return lines.join('\n').trim() + '\n';

  // Dòng thống kê đầu file (giữ lại thông tin "mỗi nguồn bao nhiêu trận")
  // — chỉ để tham khảo, KHÔNG dùng để sắp xếp lại danh sách.
  const countBySource = new Map();
  for (const entry of withUrl) {
    const key = entry?.match?.source || 'unknown';
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
    // phá thứ tự sort.
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
    // FIX 23/09/2026 (xem chú thích REFERER_BY_SOURCE_FOR_IPTV phía trên):
    // chèn Referer/User-Agent qua #EXTVLCOPT ngay trước link thật, chỉ khi
    // nguồn đó có CDN cần Referer VÀ đây là link phát thật (không phải link
    // trang gốc/resolver tạm của trận chưa đấu — gắn header cho link đó
    // cũng không có ý nghĩa gì, link tạm không phải link CDN cần Referer).
    const sourceKey = getSourceKey(match);
    const referer = !entry.upcoming ? REFERER_BY_SOURCE_FOR_IPTV[sourceKey] : null;
    if (referer) {
      lines.push(`#EXTVLCOPT:http-referrer=${referer}`);
      lines.push(`#EXTVLCOPT:http-user-agent=${IPTV_HEADER_UA}`);
    }
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
  // Tách làm 2 bước: (1) gom hết entries KHÔNG chờ mạng gì cả (nhanh), rồi
  // (2) chạy preferHlsForIptv() SONG SONG có giới hạn số luồng (mapPool)
  // thay vì tuần tự từng cái — tránh cộng dồn thời gian xác minh khi có
  // nhiều trận FLV cùng lúc.
  const pendingUpgrades = [];
  const safeMatches = Array.isArray(matches) ? matches : [];
  for (const match of safeMatches) {
    const matchStreams = Array.isArray(match?.streams) ? match.streams : [];
    const stream = matchStreams.find((s) => s?.m3u8Url || s?.flvUrl || s?.playUrl);
    if (stream) {
      const entry = { match, stream };
      entries.push(entry);
      pendingUpgrades.push(entry);
      continue;
    }

    // Trận live chưa có stream sẵn -> vẫn đưa vào playlist, trỏ tới
    // /api/playlist/resolve (route này tự resolve link thật ngay lúc
    // player mở kênh).
    const source = getSourceKey(match);
    const isLiveNoStream = !!match?.status?.isLive;

    // FIX (20/09/2026 — chế độ playlist tĩnh HOÀN TOÀN không có server nào
    // chạy sống, chỉ có file trên GitHub): trước đây thiếu baseUrl thì BỎ
    // QUA hẳn trận này (`continue`) — nghĩa là mọi trận CHƯA ĐẤU (chưa có
    // stream sẵn) biến mất khỏi playlist tĩnh, dù trận đó có tồn tại và có
    // giờ đá rõ ràng. Theo yêu cầu: vẫn LIỆT KÊ trận chưa đấu (kèm giờ đá)
    // dù tạm thời CHƯA BẤM XEM ĐƯỢC (không có server để tra link thật) —
    // sẽ tự xem được ở lần GitHub Actions chạy kế tiếp SAU khi trận đã live
    // (lúc đó match.streams đã có sẵn, rơi vào nhánh phía trên, ghi thẳng
    // link CDN thật). Không có baseUrl thì không thể tạo link resolver
    // (route đó thậm chí không tồn tại) — dùng tạm link TRANG GỐC của trận
    // (match.stream.liveUrl, vốn đã có sẵn cho hầu hết nguồn dùng làm khoá
    // tra cứu) làm giá trị hiển thị/tham khảo, KHÔNG phải link phát —
    // player mở sẽ báo lỗi/không phát được cho tới khi có link thật, đúng
    // như đã thống nhất.
    const fallbackUrl = match?.stream?.liveUrl || '';
    const params = new URLSearchParams({
      source,
      matchId: match.matchId || '',
      url: fallbackUrl,
      sport: match.sport || 'football'
    });
    const resolverUrl = baseUrl
      ? `${baseUrl}/api/playlist/resolve?${params.toString()}`
      : fallbackUrl; // không có server -> dùng tạm link trang gốc, chưa phát được ngay

    if (!resolverUrl) continue; // thật sự không có gì để ghi (hiếm, nguồn thiếu cả link trang gốc)

    entries.push({
      match,
      // Chỉ gắn nhãn "sắp diễn ra" cho trận thật sự chưa đá — trận đang
      // live mà rơi vào nhánh này chỉ là do stream chưa kịp resolve sẵn,
      // không phải chưa bắt đầu, nên không gắn cờ `upcoming`.
      upcoming: !isLiveNoStream,
      stream: {
        m3u8Url: resolverUrl,
        streamerName: baseUrl
          ? (isLiveNoStream ? 'Đang tải link...' : formatUpcomingBadge(match))
          : 'Chưa có link — chờ cập nhật'
      }
    });
  }

  // Chạy song song, tối đa 8 xác minh cùng lúc — đủ nhanh để không kéo dài
  // tổng thời gian, vẫn tránh dội quá nhiều request cùng lúc vào CDN nguồn.
  await mapPool(pendingUpgrades, 8, async (entry) => {
    entry.stream = await preferHlsForIptv(entry.stream);
  });

  return entries;
}
