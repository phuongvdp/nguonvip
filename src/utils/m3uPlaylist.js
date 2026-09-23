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
// cần proxy.
//
// FIX 2 (23/09/2026 — "1 số trận Phá Làng/Chuối Chiến VẪN không xem được
// dù đã có #EXTVLCOPT"): bản đầu GÁN CỨNG 1 Referer/nguồn — sai với đúng
// bài học mà chính /api/proxy/hls.js đã rút ra trước đây (xem
// REFERER_CANDIDATES_BY_SOURCE bên đó): nhiều CDN không nhất quán — có CDN
// (vd link "Server 1" trơn của Phá Làng, lấy trực tiếp từ source_live) TỰ
// PHÁT ĐƯỢC KHÔNG CẦN REFERER, gán thêm Referer sai vào có thể càng khiến
// CDN từ chối; có CDN khác (vd pull.digitalcdn.net của Phá Làng khi có
// BLV, hoặc 1 số endpoint edgemaxcdn.org của Chuối Chiến) lại đòi ĐÚNG 1
// domain cụ thể mới cho qua, sai domain là bị 401/403/451 ngay — và không
// đoán trước được chính xác domain nào cho từng link cụ thể, vì cùng 1
// nguồn có thể trả về nhiều loại CDN con khác nhau tuỳ trận. KHÔNG đoán mù
// 1 giá trị tĩnh nữa — DÒ THẬT bằng 1 request thử (Range 0-0, tải rất ít
// dữ liệu) tới ĐÚNG link CDN của trận đó, thử lần lượt các ứng viên
// (giống hệt danh sách REFERER_CANDIDATES_BY_SOURCE trong
// pages/api/proxy/hls.js — giữ đồng bộ 2 nơi), ứng viên nào không bị CDN
// trả 401/403/451 thì dùng đúng ứng viên đó (kể cả khi ứng viên thắng là
// "không gửi Referer nào cả" — lúc đó KHÔNG ghi dòng #EXTVLCOPT nào, đúng
// như trường hợp "Server 1" trơn). Nhớ lại theo HOSTNAME CDN (không phải
// theo từng link riêng — link .m3u8 mỗi trận khác nhau nhưng cùng 1 CDN
// thường cùng 1 chính sách) để các trận sau CÙNG 1 tiến trình (`--watch`)
// không phải dò lại từ đầu mỗi 2 phút, đỡ tốn thời gian + tránh dội quá
// nhiều request thử vào CDN nguồn.
const IPTV_HEADER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Giữ ĐỒNG BỘ danh sách ứng viên với REFERER_CANDIDATES_BY_SOURCE trong
// pages/api/proxy/hls.js — sửa 1 nơi thì nhớ sửa nơi kia theo, tránh lệch.
const REFERER_CANDIDATES_BY_SOURCE = {
  chuoichientv: ['https://live05.chuoichientv.me/', 'https://chuoichientv.link/', null],
  giovang: [process.env.GIOVANG_DOMAIN || 'https://giovang.city', null],
  khandaitv: [process.env.KHANDAITV_DOMAIN || process.env.KHANDAITV_BASE_URL || 'https://khandai3.link', null],
  phalang: ['https://phalang.live', 'https://phalang.live/', null]
};

const IPTV_REFERER_PROBE_TIMEOUT_MS = 4000;
// null nằm trong danh sách nghĩa là "không gửi Referer nào" — luôn xếp
// CUỐI khi không nhớ được lựa chọn thắng trước đó (xem workingRefererByHost),
// vì đa số CDN thật sự cần Referer đúng, chỉ 1 số ít không cần.
const workingRefererByHost = new Map();

function isHotlinkBlockStatus(status) {
  return status === 401 || status === 403 || status === 451;
}

async function probeReferer(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IPTV_REFERER_PROBE_TIMEOUT_MS);
  try {
    const headers = { 'User-Agent': IPTV_HEADER_UA, Range: 'bytes=0-0' };
    if (referer) {
      headers.Referer = referer;
      try {
        headers.Origin = new URL(referer).origin;
      } catch {
        // referer không phải URL hợp lệ (không nên xảy ra với danh sách cố định trên) -> bỏ qua Origin
      }
    }
    const res = await fetch(url, { headers, signal: controller.signal });
    return !isHotlinkBlockStatus(res.status);
  } catch {
    // Lỗi mạng/timeout khi DÒ THỬ không có nghĩa link chết — có thể do
    // chính máy chủ GitHub Actions bị CDN chặn IP (khác hẳn máy người dùng
    // thật sẽ mở link), nên KHÔNG loại bỏ ứng viên vì lý do này, tránh gán
    // nhầm "không cần Referer" chỉ vì lần dò từ CI bị chặn IP. Coi như dò
    // thất bại (không dùng ứng viên này) nhưng vẫn thử ứng viên tiếp theo.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dò xem CDN của link `url` (nguồn `source`) chấp nhận Referer nào — trả về
 * chuỗi Referer thắng, hoặc `null` nếu CDN không cần Referer / không dò
 * được ứng viên nào (khi đó KHÔNG ghi #EXTVLCOPT, để link ở dạng trần —
 * an toàn hơn là gán 1 Referer chưa xác minh có thể làm CDN càng chặn).
 */
async function resolveIptvReferer(url, source) {
  const candidates = REFERER_CANDIDATES_BY_SOURCE[source];
  if (!candidates) return null;

  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  const remembered = workingRefererByHost.get(host);
  if (remembered !== undefined) return remembered;

  for (const referer of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await probeReferer(url, referer);
    if (ok) {
      workingRefererByHost.set(host, referer);
      return referer;
    }
  }
  // FIX (23/09/2026 — "nguồn Chuối Chiến không có #EXTVLCOPT như các nguồn
  // khác nên không xem được"): dò THẤT BẠI với CẢ 3 ứng viên (kể cả "không
  // Referer") không có nghĩa CDN thật sự không cần Referer — CHÍNH pages/
  // api/proxy/hls.js trước đây đã ghi nhận đúng hiện tượng này với CDN
  // hdplaylink.com của Chuối Chiến: dù thử "không gửi Referer/Origin" vẫn
  // bị chặn y hệt -> kết luận nhiều khả năng CDN chặn theo IP máy chủ
  // trung tâm dữ liệu (Vercel/GitHub Actions), KHÔNG liên quan Referer.
  // Máy chủ CI ở đây cũng là IP trung tâm dữ liệu -> dò từ đây với CDN kiểu
  // này LUÔN thất bại bất kể Referer, cho kết quả giả (false negative) —
  // trong khi máy thật của người xem (IP nhà mạng bình thường) thì Referer
  // đúng vẫn phát được tốt. Vì vậy: KHÔNG bỏ trắng khi dò thất bại toàn bộ —
  // quay về dùng ứng viên ĐẦU TIÊN (best-guess đã biết là hay đúng nhất,
  // xem REFERER_CANDIDATES_BY_SOURCE) thay vì không ghi gì — có Referer
  // (dù chưa chắc 100%) vẫn tốt hơn hẳn để trần không Referer, vì phần lớn
  // trường hợp CDN các nguồn này THẬT SỰ cần đúng Referer mới phát được
  // (đã xác nhận qua thực tế người dùng test — thêm Referer sửa được đa số
  // trận). Không nhớ lại (workingRefererByHost) cho trường hợp này, để lần
  // dò sau (2 phút kế) vẫn thử lại từ đầu, phòng khi CDN chỉ chặn tạm thời.
  const bestGuess = candidates.find((c) => c);
  return bestGuess || null;
}

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
    // FIX 23/09/2026 (xem resolveIptvReferer() phía trên): referer đã được
    // DÒ THỬ THẬT và gắn sẵn vào entry.iptvReferer trong
    // matchesToPlaylistEntries() — ở đây chỉ đọc lại, không đoán/dò gì
    // thêm. entry.iptvReferer === null nghĩa là CDN không cần Referer
    // (hoặc dò thất bại) -> không ghi #EXTVLCOPT nào, để link trần.
    if (entry.iptvReferer) {
      lines.push(`#EXTVLCOPT:http-referrer=${entry.iptvReferer}`);
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
    // FIX (23/09/2026 — "nguồn Chuối Chiến: BLV 'Chuối Tây'/'Chuối Chao'
    // (CDN edgemaxcdn.org) không xem được dù đã thử đủ Referer"): đã xác
    // nhận qua thực tế (VLC desktop, IP nhà mạng thật — không phải do IP
    // máy chủ CI — đã thử 4 Referer khác nhau) rằng CDN `EDGEMAX` này chặn
    // CỨNG bất kể Referer, nhiều khả năng cần cookie/token phiên riêng mà
    // 1 file .m3u tĩnh không thể giả lập được — KHÔNG có cách nào phát
    // được từ playlist tĩnh này. Không lọc theo TÊN BLV (tên có thể đổi/
    // thêm BLV mới dùng lại đúng CDN này) — lọc theo chính field `cdn` mà
    // detectCdn() trong chuoichientv.service.js đã tự phân loại. Nếu trận
    // đó có BLV khác (CDN khác: HDPLAYLINK/CLOUDFLARE) thì dùng BLV đó
    // thay thế; nếu TẤT CẢ BLV của trận đều là EDGEMAX, coi như "chưa có
    // stream" (rơi xuống nhánh chưa live ở dưới) để không hiện link chắc
    // chắn không xem được.
    const playableStreams = matchStreams.filter((s) => s?.m3u8Url || s?.flvUrl || s?.playUrl);
    // FIX 2 (23/09/2026 — BLV khác dùng CDN `HDPLAYLINK`, VẪN bị chặn dù
    // test từ trình duyệt/IP thật của người dùng, không phải máy chủ CI —
    // loại bỏ luôn khả năng "chặn IP máy chủ" từng nghi cho CDN này ở
    // pages/api/proxy/hls.js): mở rộng danh sách CDN đã xác nhận chặn cứng
    // (không sửa được bằng Referer) sang cả HDPLAYLINK, không riêng EDGEMAX
    // nữa.
    const BROKEN_CHUOICHIENTV_CDNS = new Set(['EDGEMAX', 'HDPLAYLINK']);
    const stream = playableStreams.find((s) => !BROKEN_CHUOICHIENTV_CDNS.has(s?.cdn));
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
    // FIX 23/09/2026 (xem resolveIptvReferer() đầu file): dò Referer THẬT
    // cho đúng link CDN cuối cùng (sau khi đã nâng FLV->HLS nếu có) — phải
    // làm SAU preferHlsForIptv() vì link có thể vừa đổi. entry.upcoming
    // không tồn tại ở nhánh này (chỉ trận có stream sẵn mới vào
    // pendingUpgrades) nên luôn dò, không cần điều kiện thêm.
    const finalUrl = entry.stream?.playUrl || entry.stream?.m3u8Url || entry.stream?.flvUrl || '';
    const sourceKey = getSourceKey(entry.match);
    entry.iptvReferer = finalUrl ? await resolveIptvReferer(finalUrl, sourceKey) : null;
  });

  return entries;
}
