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
  tagMatchSource
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
      // Be more lenient: accept matches if explicitly marked as live OR if status name suggests live
      const isExplicitlyLive = m?.status?.isLive === true;
      const statusNameSuggestsLive = m?.status?.name && 
        m.status.name.toLowerCase().includes('live');
      
      if (!isExplicitlyLive && !statusNameSuggestsLive) continue;
      
      const key = m.matchId || m.stream?.liveUrl;
      if (!key || seen.has(`${source}:${key}`)) continue;
      const withSource = tagMatchSource(m, source);
      if (source === 'xoilac' && !(m.commentators?.length || m.streamers?.length || m.stream?.streamerName)) continue;
      if (source === 'gavang' && isJunkMatch(withSource)) continue;
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
      if (source === 'xoilac' && !(m.commentators?.length || m.streamers?.length || m.stream?.streamerName)) continue;
      if (source === 'gavang' && isJunkMatch(withSource)) continue;
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
        // gavang (default)
        let id = matchId;
        if (!id && liveUrl) id = await crawlerService.getMatchIdFromUrl(liveUrl);
        if (!id) return [];
        raw = await crawlerService.getStreamLinksByMatchId(id);
      }

      const list = normalizeStreamList(raw || []);
      if (list.length) return list;
      if (attempt < maxAttempts) await sleep(500 * attempt);
    } catch {
      if (attempt < maxAttempts) await sleep(500 * attempt);
    }
  }

  return [];
}

function sortPlayable(list) {
  return [...list].sort((a, b) => (a.matchTimeTimestamp || 0) - (b.matchTimeTimestamp || 0));
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
