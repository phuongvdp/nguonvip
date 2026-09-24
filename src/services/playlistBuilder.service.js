// FIX (20/09/2026 — "Pháo Hoa bị chết domain, loại bỏ nguồn Pháo Hoa"):
// không import/gọi phaohoaService nữa — domain nguồn (phaohoa1.live) đã
// ngừng hoạt động hẳn, mọi request gửi tới chỉ tốn thời gian chờ rồi lỗi
// (DNS not found), không mang lại trận nào. Giữ nguyên file
// src/services/phaohoa.service.js (không xoá — phòng khi domain khác của
// Pháo Hoa hoạt động lại sau này, chỉ cần import lại + thêm lại các dòng
// gọi bên dưới là dùng lại được ngay).
import giovangService from '@/src/services/giovang.service';
import khandaitvService from '@/src/services/khandaitv.service';
import chuoichientvService from '@/src/services/chuoichientv.service';
import phalangService from '@/src/services/phalang.service';
import gavangService from '@/src/services/gavang.service';
import saokeService from '@/src/services/saoke.service';
import {
  isWithinNextHours,
  mapPool,
  matchCacheKey,
  sleep,
  streamsFromMatchCard,
  tagMatchSource
} from '@/src/utils/playerGet';

// Trận "sắp đá" chỉ lấy trong khoảng này để biết lịch thi đấu sắp tới —
// xa hơn thì lịch hay thay đổi (đổi giờ, hủy...), không đáng tin.
const UPCOMING_WINDOW_HOURS = 24;
// Do not let a slow streamer detail page delay the complete match list.
// FIX (20/09/2026 — "Giờ Vàng đều bị 'chưa có link'"): mốc 4500ms này ban
// đầu hợp lý cho những nguồn gọi thẳng 1 API JSON (chuoichientv, phalang).
// Nhưng Giờ Vàng (và Khán Đài) phải MỞ CẢ 1 TRÌNH DUYỆT THẬT (Puppeteer) để
// tải trang, đọc DOM sau khi chạy JS xong — vốn đã chậm hơn hẳn 1 lệnh gọi
// API, cộng thêm chạy trên máy chủ GitHub Actions (CPU/mạng yếu hơn hẳn máy
// cá nhân, lại chạy tới 12 tab song song cạnh tranh tài nguyên, xem
// STREAM_RESOLVE_CONCURRENCY) — 4.5 giây gần như KHÔNG BAO GIỜ đủ, dẫn tới
// toàn bộ trận Giờ Vàng rơi vào nhánh "chưa có link" dù trận đang live thật.
// Trước đây (còn 1 server sống) hậu quả nhẹ — chỉ chậm 1 nhịp, người xem
// bấm lại /api/playlist/resolve sẽ tự thử lại. Giờ (chế độ tĩnh, không
// server) KHÔNG còn cơ hội thử lại giữa 2 lần GitHub Actions chạy (5 phút),
// nên phải đủ thời gian NGAY TRONG LẦN CHẠY NÀY. Tách riêng mốc thời gian
// theo loại nguồn: nguồn cần trình duyệt được rộng rãi hơn hẳn.
const STREAM_RESOLVE_TIMEOUT_MS = 4500;
const STREAM_RESOLVE_TIMEOUT_MS_BROWSER = 18000;
const BROWSER_BASED_SOURCES = new Set(['giovang', 'khandaitv']);
const STREAM_RESOLVE_CONCURRENCY = 12;
// Riêng nguồn cần trình duyệt: giảm số tab mở song song — 12 tab Chrome
// cùng lúc trên máy chủ CI 2 nhân rất dễ khiến MỌI tab đều chậm/timeout dây
// chuyền thay vì vài tab chậm riêng lẻ.
const STREAM_RESOLVE_CONCURRENCY_BROWSER = 4;

const MULTI_SPORTS = ['football', 'basketball', 'tennis', 'badminton', 'volleyball'];

// FIX (25/08/2026 — theo yêu cầu "chỉ giữ Pháo Hoa + Giờ Vàng"): đã xoá hẳn
// Gà Vàng, Xôi Lạc, VSC9, 90 Phút, AFF Cup, Custom Sources khỏi file này —
// chỉ còn 2 nguồn phaohoaService/giovangService. Toàn bộ logic riêng cho
// các nguồn cũ (whitelist giải chuyên nghiệp isJunkMatch, xác minh
// m3u8Url/flvUrl riêng cho Gà Vàng, dò lại nhiều lần cho Xôi Lạc...) đã bị
// xoá theo — 2 nguồn còn lại vốn không cần các bước đó (dữ liệu ổn định,
// luôn trả sẵn .m3u8 hợp lệ).
//
// FIX (09/09/2026 — theo yêu cầu): thêm khandaitvService (nguồn Khán Đài
// TV, domain khandai3.link — ĐỘC LẬP với domain Pháo Hoa, không ăn theo
// phaohoa.live) — cùng schema/cách gọi API với phaohoaService (cùng
// backend, khác domain) nên mọi chỗ gọi phaohoaService bên dưới đều được
// nhân đôi cho khandaitvService, KHÔNG cần bộ lọc riêng gì thêm.
// LƯU Ý: Khán Đài hiện KHÔNG lấy được dữ liệu (Cloudflare chặn IP máy chủ
// Vercel) — code vẫn giữ nguyên, sẽ tự hoạt động lại nếu sau này qua được.
//
// FIX (17/09/2026 — theo yêu cầu): thêm chuoichientvService (nguồn Chuối
// Chiên TV, API riêng api-v2.chuoichientv.net) — KHÁC HẲN backend/schema
// với Pháo Hoa/Khán Đài, có hàm getAllMatchesByTab(tab) RIÊNG (chỉ 1 tham
// số, không cần tách sport/pageSize như 2 nguồn kia vì API đã trả gộp mọi
// môn thể thao trong 1 lần gọi) — nên gọi đơn giản hơn, không nhân đôi theo
// basketball như phaohoa/khandaitv bên dưới.
//
// FIX RUNTIME (26/08/2026 — "cả 2 nguồn lỗi không quét được trận nào"):
// đợt dọn code ở trên lỡ tay XOÁ LUÔN isMinorLeagueMatch() khỏi
// playerGet.js (hàm đó thuộc bộ lọc giải cỏ chỉ dành riêng cho Gà Vàng/Xôi
// Lạc) NHƯNG file này vẫn còn IMPORT và GỌI nó ở 2 chỗ bên dưới — import 1
// tên không tồn tại khiến cả module lỗi ngay khi load, kéo theo toàn bộ
// quét trận (cả Pháo Hoa lẫn Giờ Vàng) chết theo dù bản thân 2 nguồn này
// không hề có vấn đề gì. Bỏ hẳn import + 2 lời gọi đó — Pháo Hoa/Giờ Vàng
// vốn là dữ liệu có cấu trúc rõ ràng từ API riêng, không cần bộ lọc "giải
// cỏ" kiểu quét-trang-HTML như Gà Vàng/Xôi Lạc trước đây.

// FIX (18/09/2026 — theo yêu cầu): thêm phalangService (nguồn Phá Làng TV,
// API riêng api.plapi202624081158.com) — có getAllMatchesByTab(tab) RIÊNG
// giống chuoichientv (1 tham số, API trả gộp sẵn is_live boolean), nên gọi
// đơn giản, không nhân đôi theo basketball như phaohoa/khandaitv bên dưới.

// FIX (23/09/2026 — theo yêu cầu): thêm gavangService (nguồn Gà Vàng TV,
// domain gavanglinkp.tv — cũng đổi domain thường xuyên như các nguồn khác,
// override qua GAVANG_DOMAIN). KHÁC HẲN mọi nguồn trên: không gọi API JSON
// hay cần Puppeteer — trang chủ render SẴN toàn bộ danh sách trận ngay
// trong HTML tĩnh, chỉ cần fetch HTML + cheerio (xem gavang.service.js) —
// nhẹ và nhanh hơn cả API-based lẫn browser-based. Có getAllMatchesByTab(tab)
// RIÊNG giống chuoichientv/phalang (1 tham số), nên gọi đơn giản.

async function safe(promise, label) {
  try {
    return await promise;
  } catch (err) {
    console.error(`[playlist-builder] ${label} failed:`, err.message);
    return [];
  }
}

async function resolveWithinDeadline(match) {
  const timeoutMs = BROWSER_BASED_SOURCES.has(match?.source)
    ? STREAM_RESOLVE_TIMEOUT_MS_BROWSER
    : STREAM_RESOLVE_TIMEOUT_MS;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve([]), timeoutMs);
  });
  try {
    return await Promise.race([resolveStreams(match), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Mirror fetchLiveLists() from pages/index.jsx but calling services in-process. */
async function fetchLiveLists() {
  const [giovangLive, khandaitvAll, khandaitvBb, chuoichientvLive, phalangLive, gavangLive, saokeLive] = await Promise.all([
    safe(giovangService.getAllMatchesByTab('live'), 'giovang:live'),
    safe(khandaitvService.getAllMatchesByTab('live', 'all', 50), 'khandaitv:all'),
    safe(khandaitvService.getAllMatchesByTab('live', 'basketball', 50), 'khandaitv:basketball'),
    safe(chuoichientvService.getAllMatchesByTab('live'), 'chuoichientv:live'),
    safe(phalangService.getAllMatchesByTab('live'), 'phalang:live'),
    safe(gavangService.getAllMatchesByTab('live'), 'gavang:live'),
    safe(saokeService.getAllMatchesByTab('live'), 'saoke:live')
  ]);

  const normalize = (res) => (Array.isArray(res) ? res : (res?.matches || res?.data || []));
  const isExcludedSport = (m) => /^(esports?|lol|dota2|csgo)$/i.test(String(m?.sport || m?.sportCategory || ''));

  const tagged = [];
  const seen = new Set();

  const pushListNoFilter = (list, source) => {
    for (const m of normalize(list)) {
      if (isExcludedSport(m)) continue;
      if (!m?.status?.isLive) continue;
      const key = m.matchId || m.stream?.liveUrl;
      if (!key || seen.has(`${source}:${key}`)) continue;
      seen.add(`${source}:${key}`);
      tagged.push(tagMatchSource(m, source));
    }
  };

  pushListNoFilter(giovangLive, 'giovang');
  [khandaitvAll, khandaitvBb].forEach((res) => pushListNoFilter(res, 'khandaitv'));
  pushListNoFilter(chuoichientvLive, 'chuoichientv');
  pushListNoFilter(phalangLive, 'phalang');
  pushListNoFilter(gavangLive, 'gavang');
  pushListNoFilter(saokeLive, 'saoke');

  return tagged;
}

/**
 * Same shape as fetchLiveLists() but for matches that haven't kicked off
 * yet — used to show the upcoming-24h schedule in the playlist. These
 * don't get a resolved stream (nothing to play yet); the .m3u entry links
 * to /api/playlist/resolve instead, which looks up the real link the
 * moment the player actually opens the channel.
 */
async function fetchUpcomingLists() {
  const [giovangUpcoming, khandaitvAll, khandaitvBb, chuoichientvUpcoming, phalangUpcoming, gavangUpcoming, saokeUpcoming] = await Promise.all([
    safe(giovangService.getAllMatchesByTab('upcoming'), 'giovang:upcoming'),
    safe(khandaitvService.getAllMatchesByTab('upcoming', 'all', 50), 'khandaitv:upcoming:all'),
    safe(khandaitvService.getAllMatchesByTab('upcoming', 'basketball', 50), 'khandaitv:upcoming:basketball'),
    safe(chuoichientvService.getAllMatchesByTab('upcoming'), 'chuoichientv:upcoming'),
    safe(phalangService.getAllMatchesByTab('upcoming'), 'phalang:upcoming'),
    safe(gavangService.getAllMatchesByTab('upcoming'), 'gavang:upcoming'),
    safe(saokeService.getAllMatchesByTab('upcoming'), 'saoke:upcoming')
  ]);

  const normalize = (res) => (Array.isArray(res) ? res : (res?.matches || res?.data || []));
  const isExcludedSport = (m) => /^(esports?|lol|dota2|csgo)$/i.test(String(m?.sport || m?.sportCategory || ''));

  const tagged = [];
  const seen = new Set();

  const withinWindow = (m) => isWithinNextHours(m, UPCOMING_WINDOW_HOURS);

  const pushListNoFilter = (list, source) => {
    for (const m of normalize(list)) {
      if (isExcludedSport(m)) continue;
      if (!withinWindow(m)) continue;
      const key = m.matchId || m.stream?.liveUrl;
      if (!key || seen.has(`${source}:${key}`)) continue;
      seen.add(`${source}:${key}`);
      tagged.push(tagMatchSource(m, source));
    }
  };

  pushListNoFilter(giovangUpcoming, 'giovang');
  [khandaitvAll, khandaitvBb].forEach((res) => pushListNoFilter(res, 'khandaitv'));
  pushListNoFilter(chuoichientvUpcoming, 'chuoichientv');
  pushListNoFilter(phalangUpcoming, 'phalang');
  pushListNoFilter(gavangUpcoming, 'gavang');
  pushListNoFilter(saokeUpcoming, 'saoke');

  return tagged;
}

/** Mirror resolveStreams() from pages/index.jsx but calling services in-process. */
async function resolveStreams(match) {
  const fromCard = streamsFromMatchCard(match);
  if (fromCard?.length) return fromCard;

  const matchId = match.matchId;
  const liveUrl = match.stream?.liveUrl;
  if (!matchId && !liveUrl) return [];

  const source = match.source;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let raw = [];
      if (source === 'khandaitv') {
        if (!matchId) return [];
        raw = await khandaitvService.getStreamLinks(matchId, match.sport || 'football');
      } else if (source === 'chuoichientv') {
        if (!matchId) return [];
        raw = await chuoichientvService.getStreamLinks(matchId);
      } else if (source === 'phalang') {
        if (!matchId) return [];
        raw = await phalangService.getStreamLinks(matchId, match.stream?.streamerName);
      } else if (source === 'gavang') {
        if (!matchId) return [];
        raw = await gavangService.getStreamLinks(matchId);
      } else if (source === 'saoke') {
        if (!matchId) return [];
        raw = await saokeService.getStreamLinks(matchId);
      } else if (source === 'giovang') {
        if (!liveUrl && !matchId) return [];
        const detail = await giovangService.getMatchDetail(liveUrl || matchId);
        raw = detail?.streams || [];
      } else {
        return [];
      }

      if (raw?.length) return raw;
      if (attempt < maxAttempts) await sleep(500 * attempt);
    } catch {
      if (attempt < maxAttempts) await sleep(500 * attempt);
    }
  }

  return [];
}

function sortPlayable(list) {
  // Thiếu matchTimeTimestamp (dữ liệu nguồn không có) -> đẩy XUỐNG CUỐI
  // thay vì coi như 0 (tức "năm 1970", tự động nhảy lên đầu danh sách) —
  // tránh lặp lại kiểu lỗi timestamp sai đơn vị/thiếu field từng làm cả
  // danh sách trận trên nhiều nguồn bị lộn xộn.
  const fallback = Number.MAX_SAFE_INTEGER;
  return [...list].sort((a, b) => (a.matchTimeTimestamp || fallback) - (b.matchTimeTimestamp || fallback));
}

function dedupeByKey(list) {
  const seenKey = new Set();
  return list.filter((m) => {
    const key = `${m.source}:${matchCacheKey(m)}`;
    if (!matchCacheKey(m) || seenKey.has(key)) return false;
    seenKey.add(key);
    return true;
  });
}

/**
 * Full scan: pull live + upcoming (next 24h) matches from every source,
 * resolve a playable stream for each live one, and return the ready-to-serve
 * list (already deduped + sorted). This is the "expensive" operation the
 * cache exists to shield callers from.
 */
export async function buildAggregatedMatches() {
  const [liveRaw, upcomingRaw] = await Promise.all([
    fetchLiveLists(),
    fetchUpcomingLists()
  ]);

  const liveMatches = dedupeByKey(liveRaw);

  // FIX (20/09/2026): trước đây gộp chung TẤT CẢ nguồn vào 1 mapPool với
  // 1 mức độ song song duy nhất (12) — hợp lý cho nguồn gọi API tức thời,
  // nhưng nguồn cần trình duyệt (giovang/khandaitv) mở 12 tab Chrome cùng
  // lúc trên máy CI (2 nhân) làm MỌI tab đều chậm dây chuyền, dễ vượt cả
  // mốc thời gian đã nới rộng (xem STREAM_RESOLVE_TIMEOUT_MS_BROWSER). Tách
  // riêng 2 nhóm, mỗi nhóm 1 mức song song phù hợp, quét đồng thời với
  // nhau (không phải tuần tự — không mất thêm thời gian tổng thể).
  const browserMatches = [];
  const otherMatches = [];
  liveMatches.forEach((match, index) => {
    (BROWSER_BASED_SOURCES.has(match?.source) ? browserMatches : otherMatches).push({ match, index });
  });

  const resolveEntry = async ({ match }) => {
    const streams = await resolveWithinDeadline(match);
    return streams.length ? { ...match, streams } : null;
  };

  const [browserResolved, otherResolved] = await Promise.all([
    mapPool(browserMatches, STREAM_RESOLVE_CONCURRENCY_BROWSER, resolveEntry),
    mapPool(otherMatches, STREAM_RESOLVE_CONCURRENCY, resolveEntry)
  ]);

  const resolved = new Array(liveMatches.length);
  browserMatches.forEach(({ index }, i) => { resolved[index] = browserResolved[i]; });
  otherMatches.forEach(({ index }, i) => { resolved[index] = otherResolved[i]; });

  // Keep every live card for the website. A temporary streamer lookup failure
  // must not make a source disappear from the UI.
  const liveReady = resolved.map((resolvedMatch, index) => resolvedMatch || liveMatches[index]);

  // Upcoming matches don't get streams resolved here (nothing to play yet —
  // the .m3u entry points at /api/playlist/resolve instead), but still need
  // to be deduped against each other AND against anything that's already
  // live (a source can list the same fixture under both tabs briefly).
  const liveKeys = new Set(liveReady.map((m) => `${m.source}:${matchCacheKey(m)}`));
  const upcomingReady = dedupeByKey(upcomingRaw)
    .filter((m) => !liveKeys.has(`${m.source}:${matchCacheKey(m)}`));

  return sortPlayable([...liveReady, ...upcomingReady]);
}
