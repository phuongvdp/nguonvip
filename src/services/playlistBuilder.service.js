import crawlerService from '@/src/services/crawler.service';
import xoilacService from '@/src/services/xoilac.service';
import phaohoaService from '@/src/services/phaohoa.service';
import giovangService from '@/src/services/giovang.service';
import {
  getApiSource,
  isJunkMatch,
  isMinorLeagueMatch,
  isWithinNextHours,
  mapPool,
  matchCacheKey,
  normalizeStreamList,
  sleep,
  streamsFromMatchCard,
  tagMatchSource,
  verifyStreamUrlPlayable
} from '@/src/utils/playerGet';

// Trận "sắp đá" chỉ lấy trong khoảng này để biết lịch thi đấu sắp tới —
// xa hơn thì lịch hay thay đổi (đổi giờ, hủy...), không đáng tin.
const UPCOMING_WINDOW_HOURS = 24;
// Do not let a slow streamer detail page delay the complete match list.
const STREAM_RESOLVE_TIMEOUT_MS = 4500;
const STREAM_RESOLVE_CONCURRENCY = 12;

const MULTI_SPORTS = ['football', 'basketball', 'tennis', 'badminton', 'volleyball'];

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
  const [
    gavangFb,
    gavangBb,
    phaohoaAll,
    phaohoaBb,
    giovangLive,
    ...xoilacLists
  ] = await Promise.all([
    safe(crawlerService.getLiveMatches('football'), 'gavang:football'),
    safe(crawlerService.getLiveMatches('basketball'), 'gavang:basketball'),
    safe(phaohoaService.getAllMatchesByTab('live', 'all', 50), 'phaohoa:all'),
    safe(phaohoaService.getAllMatchesByTab('live', 'basketball', 50), 'phaohoa:basketball'),
    safe(giovangService.getAllMatchesByTab('live'), 'giovang:live'),
    ...MULTI_SPORTS.map((sport) => safe(xoilacService.getMatchesByTab('live', sport), `xoilac:${sport}`))
  ]);

  const normalize = (res) => (Array.isArray(res) ? res : (res?.matches || res?.data || []));
  const isExcludedSport = (m) => /^(esports?|lol|dota2|csgo)$/i.test(String(m?.sport || m?.sportCategory || ''));

  const tagged = [];
  const seen = new Set();

  // Phaohoa / AFF Cup / 90Phut: skip isMinorLeagueMatch — these sources have
  // reliable/curated data; the competition-name whitelist would wrongly drop them.
  //
  // BUG FIX (nguồn gốc lỗi "resource unavailable" hàng loạt ở Gà Vàng & Xôi
  // Lạc): isJunkMatch() áp bộ lọc whitelist giải chuyên nghiệp cho CẢ HAI
  // nguồn gavang lẫn xoilac (xem docstring của isJunkMatch trong playerGet.js
  // — "Riêng Gà Vàng & Xôi Lạc"), nhưng chỗ gọi bên dưới trước đây chỉ kiểm
  // tra `source === 'gavang'`, bỏ sót xoilac hoàn toàn. Hậu quả: mọi trận
  // hạng thấp/giải lạ từ Xôi Lạc (vốn không có BLV/link ổn định) lọt thẳng
  // vào playlist thay vì bị loại, gây lỗi phát khi bấm vào. Đã sửa để áp
  // dụng cho cả 2 nguồn — SỬA CHỖ NÀY THÌ NHỚ SỬA CẢ 2 HÀM (fetchLiveLists
  // và fetchUpcomingLists) VÌ CÓ 2 BẢN SAO CỦA ĐOẠN LOGIC NÀY.
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

  const pushList = (list, source) => {
    for (const m of normalize(list)) {
      if (isExcludedSport(m)) continue;
      const key = m.matchId || m.stream?.liveUrl;
      if (!key || seen.has(`${source}:${key}`)) continue;
      const withSource = tagMatchSource(m, source);
      // FIX: trước đây bắt buộc phải scrape thấy tên BLV/commentator ngay ở
      // trang danh sách mới cho trận vào playlist (thêm hồi trước để tránh
      // trận live nhưng bấm vào không phát được trên điện thoại). Nhưng làm
      // vậy lọc NHẦM cả trận Xôi Lạc CÓ link phát được thật — vì việc scrape
      // đọc tên BLV ở trang danh sách rất dễ trật (đổi giao diện, BLV chưa
      // kịp hiện lúc vừa live...), trong khi bước resolveStreams() thật sự
      // (gọi trang chi tiết trận) đáng tin hơn nhiều. Việc "trận live không
      // phát được thì loại" đã có sẵn ở matchesToPlaylistEntries() (xem
      // m3uPlaylist.js — chỉ loại gavang/xoilac live KHÔNG resolve được
      // stream) nên bỏ điều kiện commentator ở đây KHÔNG làm lọt lại trận
      // chết — chỉ để lại quyết định "phát được hay không" cho đúng chỗ.
      // Vẫn giữ điều kiện này riêng cho Gà Vàng (chưa có báo lỗi tương tự).
      const hasCommentator = m.commentators?.length || m.streamers?.length || m.stream?.streamerName;
      if (source === 'gavang' && !hasCommentator) continue;
      if ((source === 'gavang' || source === 'xoilac') && isJunkMatch(withSource)) continue;
      if (isMinorLeagueMatch(withSource)) continue;
      seen.add(`${source}:${key}`);
      tagged.push(withSource);
    }
  };

  pushList(gavangFb, 'gavang');
  pushList(gavangBb, 'gavang');
  [phaohoaAll, phaohoaBb].forEach((res) => pushListNoFilter(res, 'phaohoa'));
  pushListNoFilter(giovangLive, 'giovang');
  xoilacLists.forEach((res) => pushList(res, 'xoilac'));

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
  const [
    gavangFb,
    gavangBb,
    phaohoaAll,
    phaohoaBb,
    giovangUpcoming,
    ...xoilacLists
  ] = await Promise.all([
    safe(crawlerService.getMatchesByTab('upcoming', 'football'), 'gavang:upcoming:football'),
    safe(crawlerService.getMatchesByTab('upcoming', 'basketball'), 'gavang:upcoming:basketball'),
    safe(phaohoaService.getAllMatchesByTab('upcoming', 'all', 50), 'phaohoa:upcoming:all'),
    safe(phaohoaService.getAllMatchesByTab('upcoming', 'basketball', 50), 'phaohoa:upcoming:basketball'),
    safe(giovangService.getAllMatchesByTab('upcoming'), 'giovang:upcoming'),
    ...MULTI_SPORTS.map((sport) => safe(xoilacService.getMatchesByTab('upcoming', sport), `xoilac:upcoming:${sport}`))
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

  const pushList = (list, source) => {
    for (const m of normalize(list)) {
      if (isExcludedSport(m)) continue;
      if (!withinWindow(m)) continue;
      const key = m.matchId || m.stream?.liveUrl;
      if (!key || seen.has(`${source}:${key}`)) continue;
      const withSource = tagMatchSource(m, source);
      if ((source === 'gavang' || source === 'xoilac') && isJunkMatch(withSource)) continue;
      if (isMinorLeagueMatch(withSource)) continue;
      seen.add(`${source}:${key}`);
      tagged.push(withSource);
    }
  };

  pushList(gavangFb, 'gavang');
  pushList(gavangBb, 'gavang');
  [phaohoaAll, phaohoaBb].forEach((res) => pushListNoFilter(res, 'phaohoa'));
  pushListNoFilter(giovangUpcoming, 'giovang');
  xoilacLists.forEach((res) => pushList(res, 'xoilac'));
  // Custom sources are plain user-added links — no schedule/API to pull
  // "upcoming" from, so they only ever show up once live.

  return tagged;
}

/** Mirror resolveStreams() from pages/index.jsx but calling services in-process. */
async function resolveStreams(match) {
  const fromCard = streamsFromMatchCard(match);
  if (fromCard?.length) return fromCard;

  const matchId = match.matchId;
  const liveUrl = match.stream?.liveUrl;
  if (!matchId && !liveUrl) return [];

  const apiSource = getApiSource(match);
  const maxAttempts = apiSource === 'xoilac' ? 3 : 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let raw = [];
      if (apiSource === 'xoilac') {
        if (!liveUrl) return [];
        raw = await xoilacService.getStreams(liveUrl);
      } else if (apiSource === 'phaohoa') {
        if (!matchId) return [];
        raw = await phaohoaService.getStreamLinks(matchId, match.sport || 'football');
      } else if (apiSource === 'giovang') {
        if (!liveUrl && !matchId) return [];
        const detail = await giovangService.getMatchDetail(liveUrl || matchId);
        raw = detail?.streams || [];
      } else {
        // gavang (default) — getStreamsForLiveUrl() tự thử cách JSON tĩnh
        // cũ trước, rồi mới rơi xuống trình duyệt headless nếu cần (site
        // hiện nạp link bằng JS phía client — xem chi tiết trong
        // crawlerService.getStreamsViaBrowser()).
        if (!matchId && !liveUrl) return [];
        raw = await crawlerService.getStreamsForLiveUrl(liveUrl, matchId);
      }

      const list = normalizeStreamList(raw || []);
      if (list.length) {
        // FIX "vẫn có link trận đấu mà không xem được" ở Gà Vàng: nguồn
        // này (crawlerService) lấy thẳng URL từ thuộc tính data-stream-url
        // trên trang, không tự kiểm tra domain đó còn phát được hay không
        // (khác Xôi Lạc — đã có isUrlReachable() riêng trong xoilac.service.js
        // với cùng cơ chế bên dưới). Xác minh thật (content-type, KHÔNG dựa
        // status code — xem lý do ở docblock verifyStreamUrlPlayable) trước
        // khi chấp nhận, để trận có link chết không lọt vào playlist/web.
        if (apiSource !== 'gavang') return list;
        const verified = await mapPool(list, 4, async (s) => {
          const url = s.playUrl || s.m3u8Url || s.flvUrl;
          return (await verifyStreamUrlPlayable(url)) ? s : null;
        });
        const playable = verified.filter(Boolean);
        if (playable.length) return playable;
      }
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
  // must not make Gà Vàng (or any other source) disappear from the UI.
  const liveReady = resolved.map((resolvedMatch, index) => resolvedMatch || liveMatches[index]);

  // Upcoming matches don't get streams resolved here (nothing to play yet —
  // the .m3u entry points at /api/playlist/resolve instead), but still need
  // to be deduped against each other AND against anything that's already
  // live (a source can list the same fixture under both tabs briefly).
  const liveKeys = new Set(liveReady.map((m) => `${m.source}:${matchCacheKey(m)}`));
  const upcomingReady = dedupeByKey(upcomingRaw).filter(
    (m) => !liveKeys.has(`${m.source}:${matchCacheKey(m)}`)
  );

  return sortPlayable([...liveReady, ...upcomingReady]);
}
