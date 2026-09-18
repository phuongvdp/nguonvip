import phaohoaService from '@/src/services/phaohoa.service';
import giovangService from '@/src/services/giovang.service';
import khandaitvService from '@/src/services/khandaitv.service';
import chuoichientvService from '@/src/services/chuoichientv.service';
import phalangService from '@/src/services/phalang.service';
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
const STREAM_RESOLVE_TIMEOUT_MS = 4500;
const STREAM_RESOLVE_CONCURRENCY = 12;

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

async function safe(promise, label) {
  try {
    return await promise;
  } catch (err) {
    console.error(`[playlist-builder] ${label} failed:`, err.message);
    return [];
  }
}

async function resolveWithinDeadline(match) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve([]), STREAM_RESOLVE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([resolveStreams(match), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Mirror fetchLiveLists() from pages/index.jsx but calling services in-process. */
async function fetchLiveLists() {
  const [phaohoaAll, phaohoaBb, giovangLive, khandaitvAll, khandaitvBb, chuoichientvLive, phalangLive] = await Promise.all([
    safe(phaohoaService.getAllMatchesByTab('live', 'all', 50), 'phaohoa:all'),
    safe(phaohoaService.getAllMatchesByTab('live', 'basketball', 50), 'phaohoa:basketball'),
    safe(giovangService.getAllMatchesByTab('live'), 'giovang:live'),
    safe(khandaitvService.getAllMatchesByTab('live', 'all', 50), 'khandaitv:all'),
    safe(khandaitvService.getAllMatchesByTab('live', 'basketball', 50), 'khandaitv:basketball'),
    safe(chuoichientvService.getAllMatchesByTab('live'), 'chuoichientv:live'),
    safe(phalangService.getAllMatchesByTab('live'), 'phalang:live')
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

  [phaohoaAll, phaohoaBb].forEach((res) => pushListNoFilter(res, 'phaohoa'));
  pushListNoFilter(giovangLive, 'giovang');
  [khandaitvAll, khandaitvBb].forEach((res) => pushListNoFilter(res, 'khandaitv'));
  pushListNoFilter(chuoichientvLive, 'chuoichientv');
  pushListNoFilter(phalangLive, 'phalang');

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
  const [phaohoaAll, phaohoaBb, giovangUpcoming, khandaitvAll, khandaitvBb, chuoichientvUpcoming, phalangUpcoming] = await Promise.all([
    safe(phaohoaService.getAllMatchesByTab('upcoming', 'all', 50), 'phaohoa:upcoming:all'),
    safe(phaohoaService.getAllMatchesByTab('upcoming', 'basketball', 50), 'phaohoa:upcoming:basketball'),
    safe(giovangService.getAllMatchesByTab('upcoming'), 'giovang:upcoming'),
    safe(khandaitvService.getAllMatchesByTab('upcoming', 'all', 50), 'khandaitv:upcoming:all'),
    safe(khandaitvService.getAllMatchesByTab('upcoming', 'basketball', 50), 'khandaitv:upcoming:basketball'),
    safe(chuoichientvService.getAllMatchesByTab('upcoming'), 'chuoichientv:upcoming'),
    safe(phalangService.getAllMatchesByTab('upcoming'), 'phalang:upcoming')
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

  [phaohoaAll, phaohoaBb].forEach((res) => pushListNoFilter(res, 'phaohoa'));
  pushListNoFilter(giovangUpcoming, 'giovang');
  [khandaitvAll, khandaitvBb].forEach((res) => pushListNoFilter(res, 'khandaitv'));
  pushListNoFilter(chuoichientvUpcoming, 'chuoichientv');
  pushListNoFilter(phalangUpcoming, 'phalang');

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
      if (source === 'phaohoa') {
        if (!matchId) return [];
        raw = await phaohoaService.getStreamLinks(matchId, match.sport || 'football');
      } else if (source === 'khandaitv') {
        if (!matchId) return [];
        raw = await khandaitvService.getStreamLinks(matchId, match.sport || 'football');
      } else if (source === 'chuoichientv') {
        if (!matchId) return [];
        raw = await chuoichientvService.getStreamLinks(matchId);
      } else if (source === 'phalang') {
        if (!matchId) return [];
        raw = await phalangService.getStreamLinks(matchId, match.stream?.streamerName);
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
  const resolved = await mapPool(liveMatches, STREAM_RESOLVE_CONCURRENCY, async (match) => {
    const streams = await resolveWithinDeadline(match);
    return streams.length ? { ...match, streams } : null;
  });
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
